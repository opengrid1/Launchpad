// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20B {
    function transfer(address to, uint256 v) external returns (bool);
    function transferFrom(address f, address t, uint256 v) external returns (bool);
    function approve(address s, uint256 v) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
}

interface ISwapperB {
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address recipient)
        external
        returns (uint256);
}

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 id, bytes calldata data) external returns (bytes4);
}

/// @title KinetiqPumpBags
/// @notice 1,000 NFTs, each with its own vault. Minting one burns 100,000 $LOOT and costs a fixed amount of KNTQ
///         (`MINT_KNTQ`, set at deployment): 90% of it is split equally into the vaults of the Bags already minted,
///         10% goes to KinetiqPump. This contract is also the Bag pot: 25% of KinetiqPump's fee income lands here. Once an hour
///         the pot spends 5% of its KNTQ on the day's token (the days take turns through a short list, KNTQ among
///         them) and puts an equal amount into every Bag's vault.
///         Only a Bag's holder can withdraw its vault, at any time, and the vault goes with the Bag when it changes
///         hands. Resales pay a 5% royalty to KinetiqPump.
/// @dev Vaults are kept per token as an amount-per-Bag accumulator: a Bag's vault in a token is everything added per
///      Bag since it was minted (or last withdrawn). The pot is whatever this contract holds beyond the vaults. The
///      hourly drop and fee conversions need a swap with a minimum out, so keepers run them; a drop of KNTQ itself
///      needs no swap and anyone can run it. The owner can change the day list, the keepers, the treasury and the
///      metadata URI. The owner can't take the pot or any vault.
contract KinetiqPumpBags {
    error NotOwner();
    error NotKeeper();
    error SoldOut();
    error NotHolder();
    error TooSoon();
    error BadList();
    error ZeroAddress();
    error NotApproved();
    error NonexistentToken();
    error UnsafeRecipient();
    error LootSet();

    event Transfer(address indexed from, address indexed to, uint256 indexed id);
    event Approval(address indexed owner, address indexed spender, uint256 indexed id);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event Minted(uint256 indexed id, address indexed to);
    event Dropped(address indexed token, uint256 spentKntq, uint256 total, uint256 perBag);
    event Withdrawn(uint256 indexed id, address indexed token, address indexed to, uint256 amount);
    event Converted(address indexed token, uint256 amountIn, uint256 kntqOut);

    string public constant name = "KinetiqPump Jars";
    string public constant symbol = "JAR";
    uint256 public constant MAX = 1000;
    uint256 public constant MINT_LOOT = 100_000e18;
    /// @notice what a mint costs in KNTQ, and the part of it (90%) that goes into the existing Bags' vaults
    uint256 public immutable MINT_KNTQ;
    uint256 public immutable MINT_TO_BAGS;
    uint256 public constant DROP_EVERY = 1 hours;
    uint256 public constant DROP_BPS = 500; // 5% of the pot
    uint256 public constant ROYALTY_BPS = 500;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    address public immutable kntq;
    ISwapperB public immutable swapper;
    address public loot;
    address public owner;
    address public pendingOwner;
    address public treasury;
    string public baseURI;
    mapping(address => bool) public keeper;

    uint256 public minted;
    uint256 public lastDrop;
    address[] internal _days;
    /// @dev every token ever on the day list (each new Bag starts at the current amount of all of them)
    address[] internal _everListed;
    mapping(address => bool) internal _listedEver;

    mapping(uint256 => address) internal _ownerOf;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    /// @notice amount added per Bag so far, per token
    mapping(address => uint256) public perBag;
    /// @notice what is in all vaults together, per token (not the pot)
    mapping(address => uint256) public inVaults;
    mapping(uint256 => mapping(address => uint256)) internal _base;
    mapping(uint256 => mapping(address => bool)) internal _seen;

    constructor(address kntq_, address swapper_, address owner_, address treasury_, address[] memory days_, uint256 mintKntq_) {
        if (kntq_ == address(0) || swapper_ == address(0) || owner_ == address(0) || treasury_ == address(0)) {
            revert ZeroAddress();
        }
        if (mintKntq_ == 0) revert BadList();
        MINT_KNTQ = mintKntq_;
        MINT_TO_BAGS = (mintKntq_ * 9) / 10;
        kntq = kntq_;
        swapper = ISwapperB(swapper_);
        owner = owner_;
        treasury = treasury_;
        _setDays(days_);
    }

    // ------------------------------------------------------------------ owner

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @notice $LOOT's address, set once when it launches
    function setLoot(address loot_) external onlyOwner {
        if (loot != address(0)) revert LootSet();
        loot = loot_;
    }

    function setDays(address[] calldata d) external onlyOwner {
        _setDays(d);
    }

    function _setDays(address[] memory d) internal {
        if (d.length == 0 || d.length > 8) revert BadList();
        delete _days;
        for (uint256 i; i < d.length; i++) {
            if (d[i] == address(0)) revert BadList();
            _days.push(d[i]);
            if (!_listedEver[d[i]]) {
                _listedEver[d[i]] = true;
                _everListed.push(d[i]);
                if (_everListed.length > 24) revert BadList();
            }
        }
    }

    function setKeeper(address k, bool on) external onlyOwner {
        keeper[k] = on;
    }

    function setTreasury(address t) external onlyOwner {
        if (t == address(0)) revert ZeroAddress();
        treasury = t;
    }

    function setBaseURI(string calldata u) external onlyOwner {
        baseURI = u;
    }

    function transferOwnership(address to) external onlyOwner {
        pendingOwner = to;
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // ------------------------------------------------------------------ views

    function dayTokens() external view returns (address[] memory) {
        return _days;
    }

    /// @notice the token today's drops buy (days take turns, counted in UTC days)
    function today() public view returns (address) {
        return _days[(block.timestamp / 1 days) % _days.length];
    }

    /// @notice the pot: this contract's KNTQ beyond what is already in the vaults
    function pot() public view returns (uint256) {
        return IERC20B(kntq).balanceOf(address(this)) - inVaults[kntq];
    }

    /// @notice what Bag `id`'s vault holds in `token`
    function vault(uint256 id, address token) public view returns (uint256) {
        if (_ownerOf[id] == address(0)) revert NonexistentToken();
        return perBag[token] - _baseOf(id, token);
    }

    function _baseOf(uint256 id, address token) internal view returns (uint256) {
        return _seen[id][token] ? _base[id][token] : _mintBase[id][token];
    }

    /// @dev each Bag's starting point per token, recorded lazily: a Bag only shares in what is added after its mint
    mapping(uint256 => mapping(address => uint256)) internal _mintBase;
    mapping(uint256 => uint256) public mintedAt;

    // ------------------------------------------------------------------ mint

    /// @notice Mints the next Bag: burns 100,000 $LOOT and pays `MINT_KNTQ` of KNTQ (approve both first)
    function mint() external returns (uint256 id) {
        if (minted >= MAX) revert SoldOut();
        _pull(loot, msg.sender, DEAD, MINT_LOOT);
        _pull(kntq, msg.sender, address(this), MINT_KNTQ);
        _send(kntq, treasury, MINT_KNTQ - MINT_TO_BAGS);
        // the Bags' 90% goes into the vaults of the Bags that exist already (the first mint's stays in the pot)
        if (minted != 0) _add(kntq, MINT_TO_BAGS);
        id = ++minted;
        mintedAt[id] = block.timestamp;
        _snapshot(id);
        _mint(msg.sender, id);
        emit Minted(id, msg.sender);
    }

    /// @dev a new Bag starts at the current per-Bag amount of every day token and of KNTQ
    function _snapshot(uint256 id) internal {
        _mintBase[id][kntq] = perBag[kntq];
        for (uint256 i; i < _everListed.length; i++) _mintBase[id][_everListed[i]] = perBag[_everListed[i]];
    }

    function _add(address token, uint256 total) internal returns (uint256 each) {
        uint256 n = minted;
        each = total / n;
        perBag[token] += each;
        inVaults[token] += each * n;
    }

    // ------------------------------------------------------------------ drops

    /// @notice The hourly drop: 5% of the pot's KNTQ, spent on today's token, split equally into every Bag's vault.
    ///         A KNTQ day needs no swap and anyone can run it; other days need a keeper and a minimum out.
    function drop(uint256 minOut) external returns (uint256 out) {
        if (block.timestamp < lastDrop + DROP_EVERY) revert TooSoon();
        if (minted == 0) revert TooSoon();
        address t = today();
        if (t != kntq && !keeper[msg.sender]) revert NotKeeper();
        lastDrop = block.timestamp;
        uint256 spend = (pot() * DROP_BPS) / 10_000;
        if (spend == 0) return 0;
        if (t == kntq) {
            out = spend;
        } else {
            IERC20B(kntq).approve(address(swapper), spend);
            out = swapper.swap(kntq, t, spend, minOut, address(this));
        }
        uint256 each = _add(t, out);
        emit Dropped(t, spend, out, each);
    }

    /// @notice Turns fee income that arrived in another currency (WHYPE) into pot KNTQ. Keepers only.
    function convert(address token, uint256 minOut) external returns (uint256 out) {
        if (!keeper[msg.sender]) revert NotKeeper();
        if (token == kntq) revert BadList();
        uint256 amt = IERC20B(token).balanceOf(address(this)) - inVaults[token];
        if (amt == 0) return 0;
        IERC20B(token).approve(address(swapper), amt);
        out = swapper.swap(token, kntq, amt, minOut, address(this));
        emit Converted(token, amt, out);
    }

    /// @notice A Bag's holder takes its vault in the listed tokens
    function withdraw(uint256 id, address[] calldata tokens) external {
        if (_ownerOf[id] != msg.sender) revert NotHolder();
        for (uint256 i; i < tokens.length; i++) {
            address t = tokens[i];
            uint256 a = perBag[t] - _baseOf(id, t);
            _base[id][t] = perBag[t];
            _seen[id][t] = true;
            if (a == 0) continue;
            inVaults[t] -= a;
            _send(t, msg.sender, a);
            emit Withdrawn(id, t, msg.sender, a);
        }
    }

    // ------------------------------------------------------------------ ERC-721

    function ownerOf(uint256 id) public view returns (address o) {
        o = _ownerOf[id];
        if (o == address(0)) revert NonexistentToken();
    }

    function totalSupply() external view returns (uint256) {
        return minted;
    }

    function tokenURI(uint256 id) external view returns (string memory) {
        ownerOf(id);
        return string(abi.encodePacked(baseURI, _str(id)));
    }

    function supportsInterface(bytes4 i) external pure returns (bool) {
        return i == 0x01ffc9a7 || i == 0x80ac58cd || i == 0x5b5e139f || i == 0x2a55205a;
    }

    /// @notice ERC-2981: 5% of a resale to KinetiqPump
    function royaltyInfo(uint256, uint256 price) external view returns (address, uint256) {
        return (treasury, (price * ROYALTY_BPS) / 10_000);
    }

    function approve(address spender, uint256 id) external {
        address o = ownerOf(id);
        if (msg.sender != o && !isApprovedForAll[o][msg.sender]) revert NotApproved();
        getApproved[id] = spender;
        emit Approval(o, spender, id);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 id) public {
        if (from != ownerOf(id)) revert NotHolder();
        if (to == address(0)) revert ZeroAddress();
        if (msg.sender != from && !isApprovedForAll[from][msg.sender] && msg.sender != getApproved[id]) revert NotApproved();
        unchecked {
            balanceOf[from]--;
            balanceOf[to]++;
        }
        _ownerOf[id] = to;
        delete getApproved[id];
        emit Transfer(from, to, id);
    }

    function safeTransferFrom(address from, address to, uint256 id) external {
        safeTransferFrom(from, to, id, "");
    }

    function safeTransferFrom(address from, address to, uint256 id, bytes memory data) public {
        transferFrom(from, to, id);
        if (to.code.length != 0 && IERC721Receiver(to).onERC721Received(msg.sender, from, id, data) != IERC721Receiver.onERC721Received.selector) {
            revert UnsafeRecipient();
        }
    }

    function _mint(address to, uint256 id) internal {
        _ownerOf[id] = to;
        unchecked {
            balanceOf[to]++;
        }
        emit Transfer(address(0), to, id);
    }

    // ------------------------------------------------------------------ internal

    function _pull(address token, address from, address to, uint256 a) internal {
        (bool ok, bytes memory r) = token.call(abi.encodeCall(IERC20B.transferFrom, (from, to, a)));
        require(ok && (r.length == 0 || abi.decode(r, (bool))), "pull");
    }

    function _send(address token, address to, uint256 a) internal {
        if (a == 0) return;
        (bool ok, bytes memory r) = token.call(abi.encodeCall(IERC20B.transfer, (to, a)));
        require(ok && (r.length == 0 || abi.decode(r, (bool))), "send");
    }

    function _str(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        bytes memory b;
        while (v != 0) {
            b = abi.encodePacked(bytes1(uint8(48 + (v % 10))), b);
            v /= 10;
        }
        return string(b);
    }
}
