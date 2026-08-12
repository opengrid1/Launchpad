/** Platform-official token addresses (lowercase). The launched COPAIR token
 *  ships as the default; VITE_RH_OFFICIAL (comma-separated) overrides. */
const DEFAULT_OFFICIAL = "0x5CC5D708116e9B63Bbca1aa670536FD210FA76ef";

export const OFFICIAL_TOKENS: ReadonlySet<string> = new Set(
  String(import.meta.env.VITE_RH_OFFICIAL ?? DEFAULT_OFFICIAL)
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

export const isOfficial = (address: string): boolean => OFFICIAL_TOKENS.has(address.toLowerCase());

/** First (primary) official token, for site-wide links to its market. */
export const PRIMARY_OFFICIAL: string | undefined = [...OFFICIAL_TOKENS][0];

/** DexScreener market page for the primary official token's pool. */
export const OFFICIAL_DEXSCREENER =
  "https://dexscreener.com/robinhood/0x8514d66816b49a850d3a48bb4309f30feb5cb26af05f1f214919a33ab23e526d";
