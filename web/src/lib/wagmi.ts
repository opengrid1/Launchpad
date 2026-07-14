import { createConfig, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";

import { chain, env } from "./env";

const connectors = [
  injected(),
  ...(env.walletConnectProjectId
    ? [walletConnect({ projectId: env.walletConnectProjectId })]
    : []),
];

export const wagmiConfig = createConfig({
  chains: [chain],
  connectors,
  transports: { [chain.id]: http(env.rpcUrl) },
});
