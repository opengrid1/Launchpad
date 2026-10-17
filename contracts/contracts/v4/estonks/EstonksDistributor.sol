// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev The launchpad router turns a pair asset into native ETH along a route.
interface IPairConverter {
    function pairToEth(address pair, uint256 amount, address to, uint256 minOut, bytes calldata route) external returns (uint256 ethOut);
}

/// @dev The main coin: rewards pushed in here reach every holder on the spot.
interface IFundableCoin {
    function fund(uint256 amount) external;
    function pairAsset() external view returns (address);
}

/// @title EstonksDistributor
/// @notice Hold the platform's main coin, earn the platform's share of every
///         trade fee on the launchpad. No staking.
///
///         The factory's `feeRecipient` points here, so each coin's platform
///         share lands in this contract as its pair asset: WETH from ETH-pair
///         coins, a tokenized stock from stock-pair coins. Anyone may call
///         {harvest} to turn a stock balance into ETH through the launchpad
///         router, and {sync} to push the WETH into the main coin's holder
///         rewards, where every holder is credited at once and claims through
///         the coin as usual (in WETH, or as ETH).
///
///         No owner, no keeper, nothing to configure: the main coin and the
///         router are fixed at deploy, and no path exists to move funds
///         anywhere but into holders' rewards.
contract EstonksDistributor is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IFundableCoin public immutable mainCoin;
    address public immutable weth;
    IPairConverter public immutable router;

    uint256 public lifetimeDistributed;

    event Harvested(address indexed pair, uint256 pairAmount, uint256 ethOut);
    event Distributed(uint256 amount);

    error NothingToHarvest();
    error WrongPair();

    constructor(IFundableCoin mainCoin_, address weth_, IPairConverter router_) {
        if (mainCoin_.pairAsset() != weth_) revert WrongPair();
        mainCoin = mainCoin_;
        weth = weth_;
        router = router_;
    }

    receive() external payable {}

    /// @notice Push all WETH held here into the main coin's holder rewards. Anyone.
    function sync() public nonReentrant returns (uint256 amount) {
        amount = IERC20(weth).balanceOf(address(this));
        if (amount == 0) return 0;
        IERC20(weth).forceApprove(address(mainCoin), amount);
        mainCoin.fund(amount);
        lifetimeDistributed += amount;
        emit Distributed(amount);
    }

    /// @notice Turn a stock-token balance into ETH through the launchpad
    ///         router and push it to holders. Anyone; `minOut` guards the
    ///         swap and `route` is the frontend's ETH route for that stock.
    function harvest(address pair, uint256 minOut, bytes calldata route) external nonReentrant returns (uint256 ethOut) {
        if (pair == weth) revert WrongPair();
        uint256 amount = IERC20(pair).balanceOf(address(this));
        if (amount == 0) revert NothingToHarvest();
        IERC20(pair).forceApprove(address(router), amount);
        ethOut = router.pairToEth(pair, amount, address(this), minOut, route);
        // The router pays native ETH; wrap it so the coin can take it as its pair.
        (bool ok,) = weth.call{value: ethOut}("");
        require(ok, "wrap");
        emit Harvested(pair, amount, ethOut);
        _distribute();
    }

    function _distribute() private {
        uint256 amount = IERC20(weth).balanceOf(address(this));
        if (amount == 0) return;
        IERC20(weth).forceApprove(address(mainCoin), amount);
        mainCoin.fund(amount);
        lifetimeDistributed += amount;
        emit Distributed(amount);
    }

    /// @notice What is waiting here for a pair asset.
    function pending(address pair) external view returns (uint256) {
        return IERC20(pair).balanceOf(address(this));
    }
}
