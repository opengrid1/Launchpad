#!/usr/bin/env python3
"""Turn HyperEVM big blocks on or off for the deployer.

HyperEVM runs two block streams: small blocks (3M gas, every second) and big blocks (30M gas, once a
minute). An address picks which one its transactions go to with the HyperCore action `evmUserModify`
(`usingBigBlocks`). Contract deployments of the Liqio set need big blocks; launches by users do not.

    python scripts/liqio-big-blocks.py on      # before `deploy-liqio.ts --network hyperevm`
    python scripts/liqio-big-blocks.py off     # after it
    python scripts/liqio-big-blocks.py status

Reads PRIVATE_KEY from contracts/.env.deployer (never printed). Needs the Hyperliquid Python SDK:
    python -m venv .hlvenv && .hlvenv/bin/pip install hyperliquid-python-sdk
    .hlvenv/bin/python scripts/liqio-big-blocks.py on

The action is signed by the deployer and sent to the HyperCore API, not to the EVM, so it costs no gas.
The deployer must exist on HyperCore: a fresh address does after any HYPE reaches it on HyperCore (a
transfer from an exchange account, or sending HYPE from HyperEVM to 0x2222…2222).
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def read_key() -> str:
    key = os.environ.get("PRIVATE_KEY", "")
    for name in (".env.deployer", ".env"):
        if key:
            break
        path = os.path.join(HERE, "..", name)
        if os.path.exists(path):
            for line in open(path):
                line = line.strip()
                if line.startswith("PRIVATE_KEY=") and len(line) > len("PRIVATE_KEY="):
                    key = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
    if not key:
        sys.exit("PRIVATE_KEY not set and not found in contracts/.env.deployer")
    return key if key.startswith("0x") else "0x" + key


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in ("on", "off", "status"):
        sys.exit(__doc__)
    try:
        import eth_account  # noqa: F401
        from hyperliquid.exchange import Exchange
        from hyperliquid.info import Info
        from hyperliquid.utils import constants
    except ImportError:
        sys.exit("hyperliquid-python-sdk is not installed (see the docstring)")
    from eth_account import Account

    wallet = Account.from_key(read_key())
    print("deployer", wallet.address)
    info = Info(constants.MAINNET_API_URL, skip_ws=True)
    if sys.argv[1] == "status":
        state = info.user_state(wallet.address)
        print("exists on HyperCore:", bool(state) and "marginSummary" in state)
        print("Send `on` or `off` to change the block stream; HyperCore does not expose the current flag.")
        return
    exchange = Exchange(wallet, constants.MAINNET_API_URL)
    result = exchange.use_big_blocks(sys.argv[1] == "on")
    print(result)
    if isinstance(result, dict) and result.get("status") == "ok":
        print("big blocks", sys.argv[1])
    else:
        sys.exit("HyperCore rejected the action; the deployer may not exist on HyperCore yet (see the docstring)")


if __name__ == "__main__":
    main()
