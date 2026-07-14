import { LaunchpadClient } from "@launchpad/sdk";

import { addresses, chain, env } from "./env";

/** App-wide SDK client singleton. The wallet attaches after connection. */
export const client = new LaunchpadClient({
  chain,
  rpcUrl: env.rpcUrl,
  addresses,
  apiUrl: env.apiUrl,
  wsUrl: env.wsUrl,
});
