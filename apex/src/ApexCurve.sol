// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ApexToken} from "./ApexToken.sol";

interface IApexBond {
    function bond(uint256 tokenAmount) external payable;
}

/// @title ApexCurve — stepped bonding-curve sale for APEX (Phase 1, pre-bond).
/// @notice ETH in -> APEX out along an 8-tier stepped curve. Selling back charges a 5% fee
///         that is paid out to current holders as ETH dividends. The raised ETH is held by
///         this contract and CANNOT be withdrawn by the owner — it can only leave by (a) a
///         seller's refund, or (b) bonding into the pool. There is intentionally no admin
///         ETH-withdraw function: pre-bond buyer funds are not the deployer's to take.
/// @dev Refunds walk the tiers symmetrically to buys, so `raised` always equals the curve
///      integral up to `sold` and the contract can never owe more ETH than it holds.
contract ApexCurve {
    ApexToken public immutable token;
    address public owner;

    // Curve shape (all set at deploy).
    uint256 public immutable basePrice; // wei of ETH per 1e18 APEX, at tier 0
    uint256 public immutable tierMultiplierBps; // price step per tier (e.g. 15000 = +50%)
    uint256 public immutable tiersCount; // number of tiers (e.g. 8)
    uint256 public immutable tokensPerTier; // APEX per tier (e.g. 1000e18)
    uint256 public immutable lpReserve; // APEX reserved for the pool at bond (e.g. 2000e18)
    uint256 public immutable sellFeeBps; // sell fee, to ETH dividends (e.g. 500 = 5%)
    uint256 public immutable minBondRaise; // floor for manual bondNow()

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address public hook; // ApexHook (v4) that holds the bonded pool; set before bonding

    uint256 public sold; // APEX sold on the curve so far
    uint256 public raised; // ETH currently held for the curve (== integral up to `sold`)
    bool public bonded;

    event Bought(address indexed buyer, uint256 ethIn, uint256 tokensOut, uint256 sold);
    event Sold(address indexed seller, uint256 tokensIn, uint256 ethOut, uint256 fee, uint256 sold);
    event Bonded(uint256 raisedEth, uint256 lpTokens);
    event OwnershipTransferred(address indexed prev, address indexed next);

    uint256 private _locked = 1;

    modifier nonReentrant() {
        require(_locked == 1, "reentrancy");
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(
        ApexToken token_,
        uint256 basePrice_,
        uint256 tierMultiplierBps_,
        uint256 tiersCount_,
        uint256 tokensPerTier_,
        uint256 lpReserve_,
        uint256 sellFeeBps_,
        uint256 minBondRaise_
    ) {
        require(address(token_) != address(0), "token zero");
        require(basePrice_ > 0 && tiersCount_ > 0 && tokensPerTier_ > 0, "bad curve");
        require(tierMultiplierBps_ >= 10_000, "mult < 1x");
        require(sellFeeBps_ <= 2_000, "fee too high");
        token = token_;
        owner = msg.sender;
        basePrice = basePrice_;
        tierMultiplierBps = tierMultiplierBps_;
        tiersCount = tiersCount_;
        tokensPerTier = tokensPerTier_;
        lpReserve = lpReserve_;
        sellFeeBps = sellFeeBps_;
        minBondRaise = minBondRaise_;
    }

    /// @notice Total APEX sellable on the curve (excludes the LP reserve).
    function curveSupply() public view returns (uint256) {
        return tiersCount * tokensPerTier;
    }

    /// @notice Price (wei ETH per 1e18 APEX) at tier index `k`.
    function priceAtTier(uint256 k) public view returns (uint256 p) {
        p = basePrice;
        for (uint256 i = 0; i < k; i++) {
            p = (p * tierMultiplierBps) / 10_000;
        }
    }

    /// @notice Current marginal (spot) price.
    function spotPrice() external view returns (uint256) {
        uint256 tier = sold / tokensPerTier;
        if (tier >= tiersCount) tier = tiersCount - 1;
        return priceAtTier(tier);
    }

    // ------------------------------------------------------------------ buy
    /// @notice Buy APEX with ETH along the stepped curve. Refunds any leftover (e.g. on sellout).
    function buy(uint256 minTokensOut) external payable nonReentrant returns (uint256 tokensOut) {
        require(!bonded, "bonded");
        require(msg.value > 0, "no eth");
        uint256 cap = curveSupply();
        require(sold < cap, "sold out");

        uint256 remaining = msg.value;
        while (remaining > 0 && sold < cap) {
            uint256 tier = sold / tokensPerTier;
            uint256 tokensLeftInTier = (tier + 1) * tokensPerTier - sold;
            uint256 price = priceAtTier(tier);
            uint256 costFill = (tokensLeftInTier * price) / 1e18;

            if (costFill > 0 && remaining >= costFill) {
                tokensOut += tokensLeftInTier;
                sold += tokensLeftInTier;
                remaining -= costFill;
            } else {
                uint256 t = (remaining * 1e18) / price;
                if (t > tokensLeftInTier) t = tokensLeftInTier;
                uint256 cost = (t * price) / 1e18;
                tokensOut += t;
                sold += t;
                remaining -= cost;
                break;
            }
        }

        require(tokensOut > 0, "zero out");
        require(tokensOut >= minTokensOut, "slippage");
        raised += (msg.value - remaining);

        if (remaining > 0) {
            (bool ok,) = msg.sender.call{value: remaining}("");
            require(ok, "refund");
        }
        token.transfer(msg.sender, tokensOut);

        if (sold >= cap) _bond();
        emit Bought(msg.sender, msg.value - remaining, tokensOut, sold);
    }

    // ------------------------------------------------------------------ sell
    /// @notice Sell APEX back to the curve. Refund = (curve area for the top `amount` tokens)
    ///         minus a 5% fee; the fee is distributed to holders as ETH dividends.
    function sell(uint256 amount, uint256 minEthOut) external nonReentrant returns (uint256 ethOut) {
        require(!bonded, "bonded");
        require(amount > 0, "zero");
        require(sold >= amount, "exceeds sold");

        require(token.transferFrom(msg.sender, address(this), amount), "transferFrom");

        uint256 remaining = amount;
        uint256 gross;
        while (remaining > 0 && sold > 0) {
            uint256 tier = (sold - 1) / tokensPerTier;
            uint256 filledInTier = sold - tier * tokensPerTier;
            uint256 take = remaining < filledInTier ? remaining : filledInTier;
            gross += (take * priceAtTier(tier)) / 1e18;
            sold -= take;
            remaining -= take;
        }

        uint256 fee = (gross * sellFeeBps) / 10_000;
        ethOut = gross - fee;
        require(ethOut >= minEthOut, "slippage");
        raised -= gross;

        if (ethOut > 0) {
            (bool ok,) = msg.sender.call{value: ethOut}("");
            require(ok, "refund");
        }
        if (fee > 0) token.distributeEth{value: fee}();
        emit Sold(msg.sender, amount, ethOut, fee, sold);
    }

    // ------------------------------------------------------------------ bond
    /// @notice Manually graduate once the raise clears the floor. Auto-bond also fires on sellout.
    function bondNow() external {
        require(msg.sender == owner, "not owner");
        require(!bonded, "bonded");
        require(raised >= minBondRaise, "thin pool");
        _bond();
    }

    /// @notice Wire the v4 hook that will receive the liquidity at bond. Owner, pre-bond only.
    function setHook(address h) external {
        require(msg.sender == owner, "not owner");
        require(!bonded, "bonded");
        require(h != address(0), "zero");
        hook = h;
    }

    /// @dev Finalize the curve. When a hook is set, seed the v4 pool with `lpReserve` APEX +
    ///      `raised` ETH and burn any unsold curve tokens so they can't be dumped later.
    function _bond() internal {
        bonded = true;
        uint256 ethForLp = raised;
        emit Bonded(ethForLp, lpReserve);

        if (hook != address(0)) {
            uint256 unsold = curveSupply() - sold;
            if (unsold > 0) token.transfer(DEAD, unsold);
            raised = 0;
            token.transfer(hook, lpReserve);
            IApexBond(hook).bond{value: ethForLp}(lpReserve);
        }
    }

    function transferOwnership(address next) external {
        require(msg.sender == owner, "not owner");
        require(next != address(0), "zero");
        emit OwnershipTransferred(owner, next);
        owner = next;
    }
}
