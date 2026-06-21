// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface ICoreWriter {
    function sendRawAction(bytes calldata data) external;
}

/// @title HyperCore — drive the HyperCore L1 from a HyperEVM contract.
/// @notice Validated on mainnet (from a CONTRACT sender; EOA-originated actions do NOT execute):
///   - bridge an ERC20 EVM->Core by transferring it to the token's system address
///   - bridge a spot token Core->EVM via a spot-send to the token's system address
///   - place IOC limit orders (market-style) on the spot order book
///   - read spot balances via the precompile
/// @dev Action bytes = 0x01 (version) + 3-byte action id + abi.encode(params). Orders use
///      px/sz scaled by 1e8. CoreWriter actions are ASYNC: they emit on EVM and settle on Core
///      a block or two later, and can silently fail (e.g. market closed). Always re-read state.
library HyperCore {
    address internal constant CORE_WRITER = 0x3333333333333333333333333333333333333333;
    address internal constant SPOT_BALANCE = 0x0000000000000000000000000000000000000801;
    address internal constant HYPE_SYSTEM = 0x2222222222222222222222222222222222222222;

    uint24 internal constant ACT_LIMIT_ORDER = 1;
    uint24 internal constant ACT_SPOT_SEND = 6;
    uint8 internal constant TIF_IOC = 3;

    /// @notice System address that bridges core token `index` <-> its EVM ERC20.
    ///         0x20 in the top byte, token index big-endian in the low bytes.
    function systemAddress(uint64 index) internal pure returns (address) {
        return address(uint160(uint160(0x20) << 152 | uint160(index)));
    }

    function _send(uint24 actionId, bytes memory params) private {
        ICoreWriter(CORE_WRITER).sendRawAction(abi.encodePacked(bytes1(0x01), bytes3(uint24(actionId)), params));
    }

    /// @notice IOC limit order on spot pair `asset` (= 10000 + spotPairIndex). px/sz are 1e8-scaled.
    function limitOrder(uint32 asset, bool isBuy, uint64 px1e8, uint64 sz1e8) internal {
        _send(ACT_LIMIT_ORDER, abi.encode(asset, isBuy, px1e8, sz1e8, false, TIF_IOC, uint128(0)));
    }

    /// @notice Send `amount` (core 8-dec wei) of core `token` to `dest`. To bridge Core->EVM,
    ///         pass dest = systemAddress(token).
    function spotSend(address dest, uint64 token, uint64 amount) internal {
        _send(ACT_SPOT_SEND, abi.encode(dest, token, amount));
    }

    /// @notice Read `user`'s total spot balance for core `token` (8-dec core wei).
    function spotBalance(address user, uint64 token) internal view returns (uint64 total) {
        (bool ok, bytes memory ret) = SPOT_BALANCE.staticcall(abi.encode(user, token));
        require(ok && ret.length >= 96, "spot-bal");
        (total,,) = abi.decode(ret, (uint64, uint64, uint64));
    }
}
