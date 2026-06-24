import { useAccount, useConnect, useDisconnect } from "wagmi";
import { CHAIN } from "../lib/config";

function short(addr: string) {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    const wrongChain = chainId !== CHAIN.id;
    return (
      <button className="btn connected pill" onClick={() => disconnect()} title="Disconnect">
        {wrongChain ? "wrong network" : short(address)}
      </button>
    );
  }

  const injected = connectors[0];
  return (
    <button
      className="btn primary pill"
      disabled={isPending || !injected}
      onClick={() => injected && connect({ connector: injected })}
    >
      {isPending ? "connecting" : "Connect wallet"}
    </button>
  );
}
