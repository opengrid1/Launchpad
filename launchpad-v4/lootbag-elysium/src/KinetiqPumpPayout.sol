// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface ICoin {
    function addReward(uint256 amount) external;
    function take(address account) external returns (uint256);
    function earned(address account) external view returns (uint256);
}

interface ISwapper {
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address recipient)
        external
        returns (uint256);
}

interface IHookFlush {
    function flush(address quote) external;
}

interface IERC20P {
    function transfer(address to, uint256 v) external returns (bool);
    function approve(address s, uint256 v) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
}

interface IWrappedP {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/// @title KinetiqPumpPayout
/// @notice Holds every KinetiqPump coin's holder rewards and pays them out. The hook sends the holders' share of each
///         trade's fee here (in the coin's quote currency) and the coin records each holder's part of it. Every five
///         minutes, counted from the coin's launch, a payout round turns the holders' parts into that round's reward
///         token (KNTQ or WHYPE) and sends it straight to their wallets. Rounds take turns through the rewards the
///         creator picked. A holder never has to claim, but always can: `claim` sends their part in the quote currency.
///         Whatever is paid in WHYPE is unwrapped first, so the holder receives HYPE itself in their wallet and has
///         nothing to unwrap. A wallet that cannot take HYPE (a contract with no way to receive it) gets the WHYPE.
/// @dev Rounds are run by keepers (the swap needs a minimum out, which a keeper prices off-chain). If keepers stop,
///      nothing is stuck: every holder's part stays in their coin's books and `claim` pays it. A recipient that can't
///      receive the reward (a token that blocks the transfer) has it kept here for them to withdraw.
contract KinetiqPumpPayout {
    error NotOwner();
    error NotHook();
    error NotFactory();
    error NotKeeper();
    error UnknownCoin();
    error WrongReward();
    error ZeroAddress();
    error AlreadySet();
    error Reentered();
    error NotWrapped();

    event Registered(address indexed coin, address quote, address[] rewards, uint64 launchedAt);
    event Credited(address indexed coin, uint256 amount);
    event Paid(address indexed coin, uint256 indexed round, address reward, uint256 quoteIn, uint256 rewardOut, uint256 holders);
    event Claimed(address indexed coin, address indexed account, uint256 amount);
    event Held(address indexed token, address indexed account, uint256 amount);
    event KeeperSet(address keeper, bool on);

    uint256 public constant ROUND = 5 minutes;

    address public owner;
    address public pendingOwner;
    address public factory;
    address public hook;
    ISwapper public swapper;
    /// @notice the wrapped native coin (WHYPE): what is paid in it is unwrapped and sent as HYPE
    address public weth;
    mapping(address => bool) public keeper;
    uint256 private _lock = 1;

    struct Coin {
        address quote;
        uint64 launchedAt;
        address[] rewards;
    }

    mapping(address => Coin) internal _coins;
    /// @notice quote currency held for each coin's holders and not yet paid out
    mapping(address => uint256) public held;
    /// @notice rewards that could not be sent to a wallet, kept for it: token => wallet => amount
    mapping(address => mapping(address => uint256)) public unsent;

    constructor(address owner_) {
        owner = owner_;
    }

    // ------------------------------------------------------------------ setup

    function init(address factory_, address hook_, address swapper_, address weth_) external {
        if (msg.sender != owner) revert NotOwner();
        if (factory != address(0)) revert AlreadySet();
        if (factory_ == address(0) || hook_ == address(0) || swapper_ == address(0) || weth_ == address(0)) revert ZeroAddress();
        factory = factory_;
        hook = hook_;
        swapper = ISwapper(swapper_);
        weth = weth_;
    }

    /// @dev HYPE only arrives here from WHYPE, when a payment is unwrapped
    receive() external payable {
        if (msg.sender != weth) revert NotWrapped();
    }

    /// @dev paying HYPE hands control to the wallet being paid: it can't come back in while a payment is under way
    modifier once() {
        if (_lock != 1) revert Reentered();
        _lock = 2;
        _;
        _lock = 1;
    }

    function setKeeper(address k, bool on) external {
        if (msg.sender != owner) revert NotOwner();
        keeper[k] = on;
        emit KeeperSet(k, on);
    }

    function transferOwnership(address to) external {
        if (msg.sender != owner) revert NotOwner();
        pendingOwner = to;
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // ------------------------------------------------------------------ in

    function register(address coin, address quote, address[] calldata rewards) external {
        if (msg.sender != factory) revert NotFactory();
        Coin storage c = _coins[coin];
        c.quote = quote;
        c.launchedAt = uint64(block.timestamp);
        c.rewards = rewards;
        emit Registered(coin, quote, rewards, uint64(block.timestamp));
    }

    /// @notice The hook has booked `amount` of the coin's quote for its holders (it sends the tokens on its next flush)
    function credit(address coin, uint256 amount) external {
        if (msg.sender != hook) revert NotHook();
        held[coin] += amount;
        ICoin(coin).addReward(amount);
        emit Credited(coin, amount);
    }

    // ------------------------------------------------------------------ views

    function coinInfo(address c) external view returns (address quote, uint64 launchedAt, address[] memory rewards) {
        Coin storage x = _coins[c];
        return (x.quote, x.launchedAt, x.rewards);
    }

    function round(address c) public view returns (uint256) {
        return (block.timestamp - _coins[c].launchedAt) / ROUND;
    }

    /// @notice The reward token of the coin's current round
    function currentReward(address c) public view returns (address) {
        Coin storage x = _coins[c];
        if (x.quote == address(0)) revert UnknownCoin();
        return x.rewards[round(c) % x.rewards.length];
    }

    /// @notice When the coin's next round starts
    function nextRoundAt(address c) external view returns (uint256) {
        return _coins[c].launchedAt + (round(c) + 1) * ROUND;
    }

    // ------------------------------------------------------------------ out

    /// @notice Pays `holders` their part of `coin`'s rewards in the current round's reward token. A keeper calls it
    ///         with the holders worth paying (others wait for a later round) and the least the swap may return.
    function pay(address c, address[] calldata holders, uint256 minOut) external once returns (uint256 out) {
        if (!keeper[msg.sender]) revert NotKeeper();
        Coin storage x = _coins[c];
        if (x.quote == address(0)) revert UnknownCoin();
        address reward = x.rewards[round(c) % x.rewards.length];
        uint256 n = holders.length;
        uint256[] memory parts = new uint256[](n);
        uint256 total;
        for (uint256 i; i < n; i++) {
            parts[i] = ICoin(c).take(holders[i]);
            total += parts[i];
        }
        if (total == 0) return 0;
        held[c] -= total;
        IHookFlush(hook).flush(x.quote);
        if (reward == x.quote) {
            out = total;
        } else {
            IERC20P(x.quote).approve(address(swapper), total);
            out = swapper.swap(x.quote, reward, total, minOut, address(this));
        }
        uint256 sent;
        for (uint256 i; i < n; i++) {
            if (parts[i] == 0) continue;
            uint256 a = i == n - 1 ? out - sent : (out * parts[i]) / total;
            sent += a;
            _give(reward, holders[i], a);
        }
        emit Paid(c, round(c), reward, total, out, n);
    }

    /// @notice A holder takes their own part of `coin`'s rewards now, in the coin's quote currency
    function claim(address c) external once returns (uint256 amount) {
        Coin storage x = _coins[c];
        if (x.quote == address(0)) revert UnknownCoin();
        amount = ICoin(c).take(msg.sender);
        if (amount == 0) return 0;
        held[c] -= amount;
        IHookFlush(hook).flush(x.quote);
        _give(x.quote, msg.sender, amount);
        emit Claimed(c, msg.sender, amount);
    }

    /// @notice Takes rewards that could not be sent to the caller earlier
    function withdrawUnsent(address token) external once {
        uint256 a = unsent[token][msg.sender];
        unsent[token][msg.sender] = 0;
        require(a != 0 && _send(token, msg.sender, a), "unsent");
    }

    function _give(address token, address to, uint256 a) internal {
        if (a == 0) return;
        if (token == weth) {
            // HYPE itself, straight to the wallet. The gas is capped so one wallet can't make a round too costly;
            // a wallet that won't take it has the HYPE wrapped again and gets the WHYPE below instead.
            IWrappedP(weth).withdraw(a);
            (bool paid,) = to.call{value: a, gas: 50_000}("");
            if (paid) return;
            IWrappedP(weth).deposit{value: a}();
        }
        if (!_send(token, to, a)) {
            unsent[token][to] += a;
            emit Held(token, to, a);
        }
    }

    function _send(address token, address to, uint256 a) internal returns (bool) {
        (bool ok, bytes memory r) = token.call{gas: 200_000}(abi.encodeCall(IERC20P.transfer, (to, a)));
        return ok && (r.length == 0 || abi.decode(r, (bool)));
    }
}
