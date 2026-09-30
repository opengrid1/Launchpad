// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";
import {PoseidonT4} from "poseidon-solidity/PoseidonT4.sol";

interface ISpendVerifier {
    function verifyProof(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[9] calldata pub) external view returns (bool);
}

interface IVaultRouter {
    function buy(address coin, bytes calldata route, uint256 minCoinOut) external payable returns (uint256 coinOut);
    function sell(address coin, uint256 amountIn, bytes calldata route, uint256 minEthOut) external returns (uint256 ethOut);
}

interface IVaultFactory {
    function listings(address token) external view returns (address creator, address pair, uint16 taxBps, uint64 createdAt, bytes32 poolId);
}

interface ISanctionsList {
    function isSanctioned(address addr) external view returns (bool);
}

interface IRewardCoin {
    function claimRewards() external returns (uint256);
    function pairAsset() external view returns (address);
}

/// @title EstonksVault
/// @notice Private balances and private trading for Estonks coins.
///
///         Anyone deposits ETH or an Estonks coin; the deposit becomes a note in
///         a Poseidon Merkle tree, owned by a key only the depositor's private
///         wallet knows. Notes are spent with a zero-knowledge proof
///         (circuits/spend.circom) that shows ownership, membership and
///         conservation of value without revealing which note is spent. A spend
///         can move value to new notes (a private transfer), withdraw it to any
///         address, or trade it: the vault buys or sells the coin through the
///         Estonks router and records the result as a new note whose owner the
///         vault never learns.
///
///         Note:        commitment = Poseidon(asset, amount, partial)
///         Partial:     partial    = Poseidon(ownerKey, blinding)
///         Nullifier:   Poseidon(commitment, leafIndex, secretKey)
///
///         Public on chain: every deposit and withdrawal (address, asset,
///         amount) and every private trade's coin, size and price, with this
///         vault as the trader. Private: which notes belong to whom, and which
///         deposit paid for which trade or withdrawal.
///
///         Trust: the admin can pause new deposits and trades, and choose where
///         the private-trade fee goes. Nothing can pause, redirect or block a
///         withdrawal or transfer, and no key can move a note.
///
///         Coins held here earn their coins' holder rewards like any wallet.
///         Nobody can claim them per note, so {harvest} sends them to the STONK
///         distributor, where they pay STONK holders.
contract EstonksVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FIELD = 21888242871839275222246405745257275088548364400416711303379718081614746492417;
    uint256 public constant LEVELS = 20;
    uint256 public constant MAX_AMOUNT = 1 << 248;
    uint16 public constant FEE_BPS = 50; // 0.5% of every private trade, in ETH
    address public constant ETH = address(0);

    uint8 public constant KIND_TRANSFER = 0;
    uint8 public constant KIND_WITHDRAW = 1;
    uint8 public constant KIND_BUY = 2;
    uint8 public constant KIND_SELL = 3;

    ISpendVerifier public immutable verifier;
    IVaultRouter public immutable router;
    IVaultFactory public immutable factory;
    ISanctionsList public immutable sanctions;
    address public immutable rewardsRecipient;
    address public immutable admin;

    address public feeRecipient;
    bool public depositsPaused;
    bool public tradesPaused;

    // Merkle tree of notes.
    uint256 public nextIndex;
    uint256 public root;
    uint256[LEVELS] public zeros;
    uint256[LEVELS] private filled;
    mapping(uint256 => bool) public knownRoot;

    mapping(uint256 => bool) public spent;
    /// @notice Value held in notes, per asset. The vault always holds at least this much.
    mapping(address => uint256) public liabilities;
    /// @notice Private-trade fees waiting for the fee recipient, in ETH.
    uint256 public feesOwed;

    struct Proof {
        uint256[2] a;
        uint256[2][2] b;
        uint256[2] c;
    }

    /// @dev The proof's public values, in the circuit's order.
    struct Pub {
        uint256 root;
        uint256[2] nullifier;
        uint256[2] outCommitment;
        uint256 partialOut;
        uint256 asset;
        uint256 publicOut;
    }

    /// @dev What the spend does with `publicOut`. Bound into the proof (with the
    ///      encrypted notes) through extDataHash, so no relayer can change it.
    struct Ext {
        uint8 kind;
        address recipient; // withdraw: where the value goes
        address relayer; // who is paid `relayerFee`
        uint256 relayerFee; // transfer/withdraw: in the spent asset; buy/sell: in ETH
        address coin; // buy/sell: the coin traded
        bytes route; // buy/sell: the router's ETH <-> pair route
        uint256 minOut; // buy: least coins; sell: least ETH before fees
    }

    /// @dev One per leaf. `amount` and `partial` are set only when the vault
    ///      built the note itself (deposits, trade results); otherwise zero.
    event Note(uint256 indexed index, uint256 commitment, address asset, uint256 amount, uint256 partialNote, bytes encrypted);
    event Spent(uint256 indexed nullifier);
    event Deposited(address indexed from, address indexed asset, uint256 amount);
    event Withdrawn(address indexed to, address indexed asset, uint256 amount);
    event PrivateTrade(address indexed coin, bool buy, uint256 amountIn, uint256 amountOut, uint256 fee);
    event Harvested(address indexed coin, address indexed pair, uint256 amount);
    event FeesClaimed(address indexed to, uint256 amount);
    event PauseSet(bool deposits, bool trades);
    event FeeRecipientSet(address indexed recipient);

    error NotAdmin();
    error Paused();
    error Sanctioned();
    error BadAmount();
    error BadAsset();
    error BadNote();
    error UnknownRoot();
    error AlreadySpent();
    error BadProof();
    error BadKind();
    error TreeFull();
    error Insolvent();
    error EthTransfer();
    error ZeroAddress();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(
        ISpendVerifier verifier_,
        IVaultRouter router_,
        IVaultFactory factory_,
        ISanctionsList sanctions_,
        address rewardsRecipient_,
        address admin_
    ) {
        if (address(verifier_) == address(0) || address(router_) == address(0) || address(factory_) == address(0) || rewardsRecipient_ == address(0) || admin_ == address(0)) revert ZeroAddress();
        verifier = verifier_;
        router = router_;
        factory = factory_;
        sanctions = sanctions_;
        rewardsRecipient = rewardsRecipient_;
        admin = admin_;
        feeRecipient = admin_;

        uint256 z = uint256(keccak256("estonks.vault.empty")) % FIELD;
        for (uint256 i = 0; i < LEVELS; i++) {
            zeros[i] = z;
            filled[i] = z;
            z = PoseidonT3.hash([z, z]);
        }
        root = z;
        knownRoot[z] = true;
    }

    receive() external payable {
        if (msg.sender != address(router)) revert EthTransfer();
    }

    // ---------------------------------------------------------------------
    // Deposit
    // ---------------------------------------------------------------------

    /// @notice Turn ETH (asset = 0) or an Estonks coin into a private note owned
    ///         by whoever knows the key behind `partialNote`.
    function deposit(address asset, uint256 amount, uint256 partialNote, bytes calldata encrypted) external payable nonReentrant {
        if (depositsPaused) revert Paused();
        _screen(msg.sender);
        if (amount == 0 || amount >= MAX_AMOUNT) revert BadAmount();
        if (partialNote == 0 || partialNote >= FIELD) revert BadNote();
        if (asset == ETH) {
            if (msg.value != amount) revert BadAmount();
        } else {
            if (msg.value != 0 || !_listed(asset)) revert BadAsset();
            uint256 before = IERC20(asset).balanceOf(address(this));
            IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
            if (IERC20(asset).balanceOf(address(this)) - before != amount) revert BadAmount();
        }
        liabilities[asset] += amount;
        uint256 commitment = PoseidonT4.hash([uint256(uint160(asset)), amount, partialNote]);
        _insertPair(commitment, zeros[0], asset, amount, partialNote, encrypted, "");
        emit Deposited(msg.sender, asset, amount);
    }

    // ---------------------------------------------------------------------
    // Spend: transfer, withdraw, private buy, private sell
    // ---------------------------------------------------------------------

    /// @notice Spend notes with a proof. Anyone may submit it (a relayer pays the
    ///         gas and takes `ext.relayerFee`); what happens is fixed by the proof.
    /// @param encrypted [output note 0, output note 1, trade result note], each
    ///        readable only by its owner.
    function spend(Proof calldata proof, Pub calldata pub, Ext calldata ext, bytes[3] calldata encrypted) external nonReentrant {
        if (!knownRoot[pub.root]) revert UnknownRoot();
        if (pub.nullifier[0] == pub.nullifier[1]) revert AlreadySpent();
        if (pub.asset >> 160 != 0) revert BadAsset();
        address asset = address(uint160(pub.asset));

        uint256 extHash = uint256(keccak256(abi.encode(ext, encrypted))) % FIELD;
        uint256[9] memory signals = [
            pub.root, pub.nullifier[0], pub.nullifier[1], pub.outCommitment[0], pub.outCommitment[1],
            pub.partialOut, pub.asset, pub.publicOut, extHash
        ];
        if (!verifier.verifyProof(proof.a, proof.b, proof.c, signals)) revert BadProof();

        for (uint256 i = 0; i < 2; i++) {
            uint256 n = pub.nullifier[i];
            if (spent[n]) revert AlreadySpent();
            spent[n] = true;
            emit Spent(n);
        }
        if (pub.outCommitment[0] >= FIELD || pub.outCommitment[1] >= FIELD) revert BadNote();
        _insertPair(pub.outCommitment[0], pub.outCommitment[1], ETH, 0, 0, encrypted[0], encrypted[1]);

        liabilities[asset] -= pub.publicOut; // reverts if notes of this asset never held that much

        if (ext.kind == KIND_TRANSFER) {
            if (pub.partialOut != 0 || pub.publicOut != ext.relayerFee) revert BadKind();
            _send(asset, ext.relayer, ext.relayerFee);
        } else if (ext.kind == KIND_WITHDRAW) {
            if (pub.partialOut != 0 || ext.relayerFee > pub.publicOut) revert BadKind();
            if (ext.recipient == address(0)) revert ZeroAddress();
            _screen(ext.recipient);
            uint256 out = pub.publicOut - ext.relayerFee;
            _send(asset, ext.recipient, out);
            _send(asset, ext.relayer, ext.relayerFee);
            emit Withdrawn(ext.recipient, asset, out);
        } else if (ext.kind == KIND_BUY) {
            _buy(asset, pub, ext, encrypted[2]);
        } else if (ext.kind == KIND_SELL) {
            _sell(asset, pub, ext, encrypted[2]);
        } else {
            revert BadKind();
        }
        _checkSolvent(asset);
    }

    function _buy(address asset, Pub calldata pub, Ext calldata ext, bytes calldata encrypted) private {
        if (tradesPaused) revert Paused();
        if (asset != ETH || pub.partialOut == 0 || pub.partialOut >= FIELD || !_listed(ext.coin)) revert BadKind();
        uint256 fee = (pub.publicOut * FEE_BPS) / 10_000;
        if (fee + ext.relayerFee >= pub.publicOut) revert BadAmount();
        uint256 ethIn = pub.publicOut - fee - ext.relayerFee;
        feesOwed += fee;
        _send(ETH, ext.relayer, ext.relayerFee);
        uint256 coinOut = router.buy{value: ethIn}(ext.coin, ext.route, ext.minOut);
        if (coinOut == 0 || coinOut >= MAX_AMOUNT) revert BadAmount();
        _result(ext.coin, coinOut, pub.partialOut, encrypted);
        emit PrivateTrade(ext.coin, true, ethIn, coinOut, fee);
        _checkSolvent(ext.coin);
    }

    function _sell(address asset, Pub calldata pub, Ext calldata ext, bytes calldata encrypted) private {
        if (tradesPaused) revert Paused();
        if (asset == ETH || ext.coin != asset || pub.partialOut == 0 || pub.partialOut >= FIELD) revert BadKind();
        IERC20(asset).forceApprove(address(router), pub.publicOut);
        uint256 ethOut = router.sell(asset, pub.publicOut, ext.route, ext.minOut);
        uint256 fee = (ethOut * FEE_BPS) / 10_000;
        if (fee + ext.relayerFee >= ethOut) revert BadAmount();
        uint256 net = ethOut - fee - ext.relayerFee;
        feesOwed += fee;
        _send(ETH, ext.relayer, ext.relayerFee);
        _result(ETH, net, pub.partialOut, encrypted);
        emit PrivateTrade(asset, false, pub.publicOut, net, fee);
        _checkSolvent(ETH);
    }

    /// @dev Finish a trade's result note on chain from the amount actually received.
    function _result(address asset, uint256 amount, uint256 partialNote, bytes calldata encrypted) private {
        liabilities[asset] += amount;
        uint256 commitment = PoseidonT4.hash([uint256(uint160(asset)), amount, partialNote]);
        _insertPair(commitment, zeros[0], asset, amount, partialNote, encrypted, "");
    }

    // ---------------------------------------------------------------------
    // Rewards the vault earns, fees, admin
    // ---------------------------------------------------------------------

    /// @notice Claim the holder rewards `coin` pays this vault and send them to
    ///         the STONK distributor. Anyone.
    function harvest(address coin) external nonReentrant returns (uint256 amount) {
        if (!_listed(coin)) revert BadAsset();
        address pair = IRewardCoin(coin).pairAsset();
        uint256 before = IERC20(pair).balanceOf(address(this));
        IRewardCoin(coin).claimRewards();
        amount = IERC20(pair).balanceOf(address(this)) - before;
        if (amount > 0) IERC20(pair).safeTransfer(rewardsRecipient, amount);
        emit Harvested(coin, pair, amount);
    }

    /// @notice Pay the private-trade fees to the fee recipient. Anyone.
    function claimFees() external nonReentrant returns (uint256 amount) {
        amount = feesOwed;
        feesOwed = 0;
        _send(ETH, feeRecipient, amount);
        emit FeesClaimed(feeRecipient, amount);
    }

    /// @notice Pause new deposits and/or private trades. Withdrawals and transfers never pause.
    function setPaused(bool deposits, bool trades) external onlyAdmin {
        depositsPaused = deposits;
        tradesPaused = trades;
        emit PauseSet(deposits, trades);
    }

    function setFeeRecipient(address recipient) external onlyAdmin {
        if (recipient == address(0)) revert ZeroAddress();
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _listed(address coin) private view returns (bool) {
        if (coin == ETH) return false;
        (,,, uint64 createdAt,) = factory.listings(coin);
        return createdAt != 0;
    }

    function _screen(address who) private view {
        if (address(sanctions) != address(0) && sanctions.isSanctioned(who)) revert Sanctioned();
    }

    function _send(address asset, address to, uint256 amount) private {
        if (amount == 0) return;
        if (to == address(0)) revert ZeroAddress();
        if (asset == ETH) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert EthTransfer();
        } else {
            IERC20(asset).safeTransfer(to, amount);
        }
    }

    function _checkSolvent(address asset) private view {
        uint256 held = asset == ETH ? address(this).balance : IERC20(asset).balanceOf(address(this));
        uint256 owed = liabilities[asset] + (asset == ETH ? feesOwed : 0);
        if (held < owed) revert Insolvent();
    }

    /// @dev Append two leaves (a pair keeps every insert one hash per level).
    function _insertPair(uint256 a, uint256 b, address asset, uint256 amount, uint256 partialNote, bytes calldata encA, bytes memory encB) private {
        uint256 index = nextIndex;
        if (index + 2 > (1 << LEVELS)) revert TreeFull();
        uint256 node = PoseidonT3.hash([a, b]);
        uint256 pos = index >> 1;
        for (uint256 lvl = 1; lvl < LEVELS; lvl++) {
            if (pos & 1 == 0) {
                filled[lvl] = node;
                node = PoseidonT3.hash([node, zeros[lvl]]);
            } else {
                node = PoseidonT3.hash([filled[lvl], node]);
            }
            pos >>= 1;
        }
        nextIndex = index + 2;
        root = node;
        knownRoot[node] = true;
        emit Note(index, a, asset, amount, partialNote, encA);
        emit Note(index + 1, b, ETH, 0, 0, encB);
    }
}
