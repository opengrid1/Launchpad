# Notice

`contracts/src/v2` is the Pons v2 launchpad (Robinhood Chain), reproduced from the Sourcify-verified
sources of its deployed contracts (`PonsV2LaunchFactory` 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e and the
contracts around it). Every file carries `SPDX-License-Identifier: MIT`; the MIT terms apply and this notice
is kept with the code. `contracts/lib` holds the exact dependency versions those sources were verified with
(OpenZeppelin, Uniswap v4-core libraries and interfaces, v4-periphery, v4-hooks-public), each under its own
license header.

`build/position-manager.sourcify.json` is the Uniswap v4 `PositionManager` (v4-periphery, MIT) as verified
on Base, used to deploy the same build on chains that have none.

Recompiling with `build/compile.cjs` (solc 0.8.35, optimizer 200, viaIR, cancun; the locker with 0.8.26)
reproduces the on-chain Robinhood bytecode byte for byte, so what runs here is exactly what runs there.
