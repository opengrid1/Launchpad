/** Platform-official token addresses (lowercase). The launched COPAIR token
 *  ships as the default; VITE_RH_OFFICIAL (comma-separated) overrides. */
const DEFAULT_OFFICIAL = "0x4aBc85933Edd90e6EcAb98E170Fa8958dBf1a932";

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
  "https://dexscreener.com/robinhood/0x87fd7337b9def1d156a4530dd5f906e4ec8f69cadd82d8550fe9fac02f38d030";
