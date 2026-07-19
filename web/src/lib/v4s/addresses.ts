import type { Address } from "viem";

/** v4s stock-paired launchpad deployment (renounced). */
export const V4S = {
  factory: "0x9b205b212b08D02Dd255a4C98404C61548414663" as Address,
  hook: "0xf91f6e6C05CA0aBb519763770E2B417Bb788C044" as Address,
  router: "0xb8aEcB596E56586c00dc73D6B00B6a16f72D4663" as Address,
  usdg: "0x5fc5360d0400a0fd4f2af552add042d716f1d168" as Address,
  startBlock: 14043218n,
} as const;
