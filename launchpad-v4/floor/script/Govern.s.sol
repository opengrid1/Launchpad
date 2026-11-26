// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {ZappyBoundedFeed} from "../src/ZappyBoundedFeed.sol";
import {ZappyBurner} from "../src/ZappyBurner.sol";
import {ZappyFactory} from "../src/ZappyFactory.sol";
import {ZappyLimitOrders} from "../src/ZappyLimitOrders.sol";
import {ZappyFactoryGate} from "../src/ZappyFactoryGate.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {IZappyFactory} from "../src/interfaces/IZappyFactory.sol";
import {IZappyLimitOrders} from "../src/interfaces/IZappyLimitOrders.sol";

/// Deploys the governance contracts (README §8) and the bounded ETH/USD feed (README §15) and prints, in order, the
/// Owner Safe transactions that put ZappyBurner behind a 48 h timelock, ZappyFactory behind ZappyFactoryGate and
/// ZappyLimitOrders' ETH price behind the bounds. It sends none of them: they are the Safe's to sign
/// (script/govern-rehearsal.sh sends them on a fork first).
///   SAFE          the Owner Safe: owner of the factory, the burner and the limit orders today, the gate's owner, the
///                 timelock's only proposer and executor
///   FACTORY       ZappyFactory
///   BURNER        ZappyBurner
///   LIMIT_ORDERS  ZappyLimitOrders: its ETH pay token's feed (payTokens(address(0)): Chainlink's ETH/USD) becomes the
///                 bounded feed's source, its maxPriceAge is kept
/// Deploys: OpenZeppelin's TimelockController (unmodified; proposer = executor = SAFE, no admin: only the timelock
/// itself, through an operation, can change its roles or delay), ZappyFactoryGate owned by SAFE, and ZappyBoundedFeed on
/// the live ETH/USD feed with [ETH_USD_MIN, ETH_USD_MAX] and ETH_USD_MAX_JUMP_BPS. The layout after the transactions:
/// the timelock owns the burner only (every burner owner action public 48 h before it runs); the Safe owns the gate, so
/// pausing launches, rotating the start signer and refusing a quote are immediate, while allowing one still takes the
/// gate's probe and PROBE_BLOCKS; the gate owns the factory; ZappyLimitOrders prices ETH through the bounded feed.
/// Ownable2Step: a new owner must call acceptOwnership() itself, and the timelock only makes a call through
/// schedule(...) then execute(...) with the same arguments. So the timelock is deployed with minDelay 0, accepts the
/// burner at once, then raises its own delay to MIN_DELAY (updateDelay, which only the timelock itself may call, also
/// scheduled and executed): the whole move finishes in one sitting and ends with getMinDelay() == MIN_DELAY. Between
/// transactions 3 and 5 the timelock owns the burner with no delay; it acts for nobody but the Safe, which is sending
/// them.
contract Govern is Script {
    uint256 public constant MIN_DELAY = 48 hours;
    bytes32 internal constant NO_PREDECESSOR = bytes32(0);
    bytes32 internal constant SALT = bytes32(0); // distinct targets: distinct operation ids
    /// The ETH/USD answers passed through, in the feed's 8 decimals: $100 to $100,000, far outside any market but
    /// inside what a pinned or broken aggregator prints; and at most a 50% move between two rounds
    int256 public constant ETH_USD_MIN = 100e8;
    int256 public constant ETH_USD_MAX = 100_000e8;
    uint256 public constant ETH_USD_MAX_JUMP_BPS = 5_000;

    function run() external returns (TimelockController timelock, ZappyFactoryGate gate, ZappyBoundedFeed ethUsdFeed) {
        address safe = vm.envAddress("SAFE");
        ZappyFactory factory = ZappyFactory(vm.envAddress("FACTORY"));
        ZappyBurner burner = ZappyBurner(payable(vm.envAddress("BURNER")));
        ZappyLimitOrders limitOrders = ZappyLimitOrders(payable(vm.envAddress("LIMIT_ORDERS")));
        require(factory.owner() == safe, "SAFE does not own FACTORY");
        require(burner.owner() == safe, "SAFE does not own BURNER");
        require(limitOrders.owner() == safe, "SAFE does not own LIMIT_ORDERS");
        require(factory.burner() == address(burner), "BURNER is not FACTORY's");
        (IZappyLimitOrders.Pricing memory eth, bool ethAllowed) = limitOrders.payTokens(address(0));
        require(ethAllowed && !eth.isStable && address(eth.feed) != address(0), "ETH is not a feed-priced pay token");
        require(eth.feedDecimals == 8, "the ETH/USD feed's decimals are not 8: the bounds are in 8 decimals");

        address[] memory safeOnly = new address[](1);
        safeOnly[0] = safe;
        vm.startBroadcast();
        timelock = new TimelockController(0, safeOnly, safeOnly, address(0));
        gate = new ZappyFactoryGate(IZappyFactory(address(factory)), safe);
        ethUsdFeed = new ZappyBoundedFeed(eth.feed, ETH_USD_MIN, ETH_USD_MAX, ETH_USD_MAX_JUMP_BPS);
        vm.stopBroadcast();
        // the live answer passes the bounds today, else the first fill after the switch would revert
        (, int256 answer,,,) = ethUsdFeed.latestRoundData();
        require(answer > 0, "bounded feed answer");
        require(timelock.getMinDelay() == 0, "timelock delay");
        require(timelock.hasRole(timelock.PROPOSER_ROLE(), safe), "timelock proposer");
        require(timelock.hasRole(timelock.EXECUTOR_ROLE(), safe), "timelock executor");
        require(!timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), safe), "timelock admin");
        require(gate.owner() == safe, "gate owner");
        require(address(gate.factory()) == address(factory), "gate factory");

        console2.log("TimelockController", address(timelock));
        console2.log("ZappyFactoryGate     ", address(gate));
        console2.log("PROBE_BLOCKS      ", gate.PROBE_BLOCKS());
        console2.log("ZappyBoundedFeed   ", address(ethUsdFeed));
        console2.log("  source (ETH/USD)", address(eth.feed));
        console2.log("  maxPriceAge kept", eth.maxPriceAge);
        console2.log("  answer now (8 decimals)", answer);
        console2.log(
            string.concat(
                "GOVERN timelock=",
                vm.toString(address(timelock)),
                " gate=",
                vm.toString(address(gate)),
                " feed=",
                vm.toString(address(ethUsdFeed))
            )
        );

        bytes memory accept = abi.encodeCall(Ownable2Step.acceptOwnership, ());
        bytes memory raise = abi.encodeCall(timelock.updateDelay, (MIN_DELAY));
        console2.log("");
        console2.log("Safe transactions, in this order, all in one sitting:");
        _tx(
            1,
            address(burner),
            abi.encodeCall(Ownable2Step.transferOwnership, (address(timelock))),
            "ZappyBurner.transferOwnership(timelock): the timelock is the burner's pending owner"
        );
        _tx(
            2,
            address(timelock),
            abi.encodeCall(timelock.schedule, (address(burner), 0, accept, NO_PREDECESSOR, SALT, 0)),
            "timelock.schedule(burner.acceptOwnership(), delay 0): the timelock only acts through an operation"
        );
        _tx(
            3,
            address(timelock),
            abi.encodeCall(timelock.execute, (address(burner), 0, accept, NO_PREDECESSOR, SALT)),
            "timelock.execute(burner.acceptOwnership()): ZappyBurner.owner() == timelock"
        );
        _tx(
            4,
            address(timelock),
            abi.encodeCall(timelock.schedule, (address(timelock), 0, raise, NO_PREDECESSOR, SALT, 0)),
            "timelock.schedule(timelock.updateDelay(48 h), delay 0): only the timelock may set its own delay"
        );
        _tx(
            5,
            address(timelock),
            abi.encodeCall(timelock.execute, (address(timelock), 0, raise, NO_PREDECESSOR, SALT)),
            "timelock.execute(timelock.updateDelay(48 h)): getMinDelay() == 172800, every later operation waits 48 h"
        );
        _tx(
            6,
            address(factory),
            abi.encodeCall(Ownable2Step.transferOwnership, (address(gate))),
            "ZappyFactory.transferOwnership(gate): the gate is the factory's pending owner"
        );
        _tx(7, address(gate), abi.encodeCall(gate.acceptFactory, ()), "gate.acceptFactory(): the gate owns the factory, the Safe owns the gate");
        _tx(
            8,
            address(limitOrders),
            abi.encodeCall(
                limitOrders.setPayToken,
                (address(0), IAggregatorV3(address(ethUsdFeed)), eth.maxPriceAge, false, true)
            ),
            "ZappyLimitOrders.setPayToken(ETH, boundedFeed, same maxPriceAge, not stable, allowed): ETH priced through the bounds"
        );
        console2.log("operation id, burner accept");
        console2.logBytes32(timelock.hashOperation(address(burner), 0, accept, NO_PREDECESSOR, SALT));
        console2.log("operation id, delay to 48 h");
        console2.logBytes32(timelock.hashOperation(address(timelock), 0, raise, NO_PREDECESSOR, SALT));
    }

    /// One Safe transaction: what it does, then a `SAFE_TX n to data` line the rehearsal script sends as is
    function _tx(uint256 n, address to, bytes memory data, string memory what) internal pure {
        console2.log(string.concat(vm.toString(n), ") ", what));
        console2.log(string.concat("SAFE_TX ", vm.toString(n), " ", vm.toString(to), " ", vm.toString(data)));
    }
}
