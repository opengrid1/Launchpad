// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {BasketOwnable} from "./BasketOwnable.sol";

interface IBasketPotMint {
    function onMint(uint256 tokenId) external;
}

interface IWETHDeposit {
    function deposit() external payable;
}

/// @title BasketNFT
/// @notice The Basket collection: at most 1,000 NFTs, each with its own vault
///         in the BasketPot that only its holder can withdraw from.
///
///         Two ways to mint:
///           - pay `mintPrice` in ETH: 90% goes into the pot (as WETH) for all
///             Baskets, 10% to the treasury;
///           - burn `burnPrice` of the platform token, once the admin has set
///             one.
///         Resales carry a 5% ERC-2981 royalty.
contract BasketNFT is ERC721, ERC2981, BasketOwnable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_SUPPLY = 1_000;
    uint256 private constant BPS = 10_000;
    /// @notice Share of each ETH mint that goes into the pot: 90%.
    uint256 public constant POT_SHARE_BPS = 9_000;
    uint96 public constant MAX_ROYALTY_BPS = 1_000;
    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;

    address public immutable weth;
    /// @notice The BasketPot. Set once by the owner; minting is closed until then.
    address public pot;
    address public treasury;
    uint256 public mintPrice;
    /// @notice Platform token burned for the burn-mint. Zero disables it.
    address public burnToken;
    uint256 public burnPrice;
    uint256 public totalSupply;
    string private _base;

    error AlreadySet();
    error PotNotSet();
    error SoldOut();
    error WrongPayment(uint256 sent, uint256 price);
    error BurnMintDisabled();
    error InvalidConfig();
    error TransferFailed();

    event PotSet(address pot);
    event TreasuryUpdated(address treasury);
    event MintPriceUpdated(uint256 mintPrice);
    event BurnMintUpdated(address token, uint256 price);
    event BaseURIUpdated(string baseURI);
    event Minted(uint256 indexed tokenId, address indexed to, bool burned, uint256 toPot, uint256 toTreasury);

    constructor(address owner_, address weth_, address treasury_, uint256 mintPrice_, address royaltyReceiver_)
        ERC721("Basket", "BASKETNFT")
        BasketOwnable(owner_)
    {
        if (weth_ == address(0) || treasury_ == address(0) || royaltyReceiver_ == address(0)) revert ZeroAddress();
        weth = weth_;
        treasury = treasury_;
        mintPrice = mintPrice_;
        _setDefaultRoyalty(royaltyReceiver_, 500);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setPot(address pot_) external onlyOwner {
        if (pot != address(0)) revert AlreadySet();
        if (pot_ == address(0)) revert ZeroAddress();
        pot = pot_;
        emit PotSet(pot_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function setMintPrice(uint256 mintPrice_) external onlyOwner {
        mintPrice = mintPrice_;
        emit MintPriceUpdated(mintPrice_);
    }

    /// @notice Set (or, with the zero address, disable) the burn-mint.
    function setBurnMint(address token, uint256 price) external onlyOwner {
        if (token != address(0) && price == 0) revert InvalidConfig();
        burnToken = token;
        burnPrice = price;
        emit BurnMintUpdated(token, price);
    }

    function setRoyalty(address receiver, uint96 bps) external onlyOwner {
        if (bps > MAX_ROYALTY_BPS) revert InvalidConfig();
        _setDefaultRoyalty(receiver, bps);
    }

    function setBaseURI(string calldata baseURI_) external onlyOwner {
        _base = baseURI_;
        emit BaseURIUpdated(baseURI_);
    }

    // ---------------------------------------------------------------------
    // Mint
    // ---------------------------------------------------------------------

    /// @notice Mint a Basket for `mintPrice` ETH.
    function mint() external payable nonReentrant returns (uint256 tokenId) {
        if (msg.value != mintPrice) revert WrongPayment(msg.value, mintPrice);
        tokenId = _mintBasket(msg.sender);

        uint256 toPot = (msg.value * POT_SHARE_BPS) / BPS;
        uint256 toTreasury = msg.value - toPot;
        if (toPot > 0) {
            IWETHDeposit(weth).deposit{value: toPot}();
            IERC20(weth).safeTransfer(pot, toPot);
        }
        if (toTreasury > 0) {
            (bool ok,) = treasury.call{value: toTreasury}("");
            if (!ok) revert TransferFailed();
        }
        emit Minted(tokenId, msg.sender, false, toPot, toTreasury);
    }

    /// @notice Mint a Basket by burning `burnPrice` of the platform token.
    function mintWithBurn() external nonReentrant returns (uint256 tokenId) {
        address token = burnToken;
        if (token == address(0)) revert BurnMintDisabled();
        IERC20(token).safeTransferFrom(msg.sender, DEAD, burnPrice);
        tokenId = _mintBasket(msg.sender);
        emit Minted(tokenId, msg.sender, true, 0, 0);
    }

    function _mintBasket(address to) private returns (uint256 tokenId) {
        address pot_ = pot;
        if (pot_ == address(0)) revert PotNotSet();
        if (totalSupply >= MAX_SUPPLY) revert SoldOut();
        tokenId = ++totalSupply;
        // Start the new Basket at the pot's current level before it exists,
        // so it earns only from distributions made after this mint.
        IBasketPotMint(pot_).onMint(tokenId);
        _mint(to, tokenId);
    }

    // ---------------------------------------------------------------------
    // Metadata
    // ---------------------------------------------------------------------

    function _baseURI() internal view override returns (string memory) {
        return _base;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
