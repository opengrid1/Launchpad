// Curated logo overrides for official tokens, keyed by lowercased address.
// On-chain metadata is immutable at launch, so this registry can force a
// brand mark for a known address. Empty by default: tokens use the logo
// their creator set at launch.
export const OFFICIAL_LOGOS: Record<string, string> = {
  // $STEADY (Robinhood Chain): launched with a 96px on-chain thumbnail before
  // the 256px pipeline landed; serve the hi-res frog instead.
  "0xa3c4358484a1f90cd9b43b1b445264390d66ceaa": "/steady-frog.png",
  // $UHOOD official: the Emerald Hood mark, served from this origin.
  "0x5cc5d708116e9b63bbca1aa670536fd210fa76ef": "/uhood-pfp.png",
};
