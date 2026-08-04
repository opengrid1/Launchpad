/** Platform-official token addresses (lowercase). The launched COPAIR token
 *  ships as the default; VITE_RH_OFFICIAL (comma-separated) overrides. */
const DEFAULT_OFFICIAL = "0x4869cC2094b2205a7d0e17d7F90B044d6d2b4663";

export const OFFICIAL_TOKENS: ReadonlySet<string> = new Set(
  String(import.meta.env.VITE_RH_OFFICIAL ?? DEFAULT_OFFICIAL)
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

export const isOfficial = (address: string): boolean => OFFICIAL_TOKENS.has(address.toLowerCase());
