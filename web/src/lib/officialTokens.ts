// Tokens launched by the stockprintr team. Shown with an "Official" badge so
// impersonators can't pass as us; everything else is community-launched.
export const OFFICIAL_TOKENS: ReadonlySet<string> = new Set([
  "0x600478629dd470fbf2a4145a24899458aab34663", // PRINTR (prints SPCX)
]);

export function isOfficial(address: string): boolean {
  return OFFICIAL_TOKENS.has(address.toLowerCase());
}
