// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ILaunchpadGraduation {
    /// @notice True once the token's market cap has crossed the graduation
    ///         threshold (40,000 USD by default). Read live from the pool.
    function shouldGraduate(address token) external view returns (bool);
}

/// @title LaunchToken
/// @notice Fixed-supply ERC-20 launched through the Launchpad. While the
///         token is below the graduation market cap, anti-whale limits are
///         enforced on every transfer: a maximum transaction size, a maximum
///         wallet holding, and an optional buy cooldown. The limits lift
///         automatically, permanently and without any admin action the first
///         time a transfer observes the market cap above the threshold.
contract LaunchToken is ERC20 {
    error NotLaunchpad();
    error PoolAlreadySet();
    error MaxTransactionExceeded(uint256 amount, uint256 maxTx);
    error MaxWalletExceeded(uint256 resultingBalance, uint256 maxWallet);
    error BuyCooldownActive(uint256 availableAt);

    event LimitsRemoved(uint256 timestamp);
    event ExemptionSet(address indexed account, bool exempt);

    /// @notice The launchpad that deployed this token.
    address public immutable launchpad;
    /// @notice The Uniswap V3 pool for this token (set once at launch).
    address public pool;
    /// @notice The wallet that created the token through the launchpad.
    address public immutable creator;

    /// @notice Max tokens per transaction while limits are active.
    uint256 public immutable maxTxAmount;
    /// @notice Max tokens a single wallet can hold while limits are active.
    uint256 public immutable maxWalletAmount;
    /// @notice Seconds a wallet must wait between buys (0 disables).
    uint256 public immutable buyCooldown;
    /// @notice True until the graduation market cap is reached.
    bool public limitsActive = true;

    mapping(address => bool) public isExempt;
    mapping(address => uint256) public lastBuyAt;

    string private _metadataURI;

    constructor(
        address launchpad_,
        string memory name_,
        string memory symbol_,
        string memory metadataURI_,
        uint256 totalSupply_,
        address creator_,
        uint256 maxTxAmount_,
        uint256 maxWalletAmount_,
        uint256 buyCooldown_
    ) ERC20(name_, symbol_) {
        launchpad = launchpad_;
        creator = creator_;
        maxTxAmount = maxTxAmount_;
        maxWalletAmount = maxWalletAmount_;
        buyCooldown = buyCooldown_;
        _metadataURI = metadataURI_;

        isExempt[launchpad_] = true;
        _mint(launchpad_, totalSupply_);
    }

    /// @notice Off-chain metadata (description, logo, website, socials).
    function metadataURI() external view returns (string memory) {
        return _metadataURI;
    }

    modifier onlyLaunchpad() {
        if (msg.sender != launchpad) revert NotLaunchpad();
        _;
    }

    function setPool(address pool_) external onlyLaunchpad {
        if (pool != address(0)) revert PoolAlreadySet();
        pool = pool_;
        isExempt[pool_] = true;
        emit ExemptionSet(pool_, true);
    }

    /// @notice Exempt protocol infrastructure (position manager, swap router,
    ///         treasury) from wallet limits. Only callable by the launchpad.
    function setExempt(address account, bool exempt) external onlyLaunchpad {
        isExempt[account] = exempt;
        emit ExemptionSet(account, exempt);
    }

    /// @notice Anyone can trigger the graduation check explicitly.
    function checkGraduation() public {
        if (!limitsActive || pool == address(0)) return;
        try ILaunchpadGraduation(launchpad).shouldGraduate(address(this)) returns (bool graduate) {
            if (graduate) {
                limitsActive = false;
                emit LimitsRemoved(block.timestamp);
            }
        } catch {
            // Never let a failing market cap read brick transfers.
        }
    }

    function _update(address from, address to, uint256 value) internal override {
        if (limitsActive && from != address(0) && to != address(0)) {
            bool fromExempt = isExempt[from];
            bool toExempt = isExempt[to];

            if (!(fromExempt && toExempt)) {
                if (value > maxTxAmount) revert MaxTransactionExceeded(value, maxTxAmount);
            }
            if (!toExempt) {
                uint256 resulting = balanceOf(to) + value;
                if (resulting > maxWalletAmount) revert MaxWalletExceeded(resulting, maxWalletAmount);
            }
            if (buyCooldown != 0 && from == pool && !toExempt) {
                uint256 availableAt = lastBuyAt[to] + buyCooldown;
                if (block.timestamp < availableAt) revert BuyCooldownActive(availableAt);
                lastBuyAt[to] = block.timestamp;
            }
        }

        super._update(from, to, value);

        // The pool price is already updated when a swap pays out, so the
        // check sees the post-trade market cap and limits lift on the exact
        // trade that crosses the threshold.
        checkGraduation();
    }
}
