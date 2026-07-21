// Tokens hidden from the public Explore feed. They stay fully functional by
// direct address and in the admin console; they are only omitted from public
// discovery. New launches are NOT in this list, so they appear on Explore
// automatically. Keyed by lowercased address.
export const HIDDEN_TOKENS: ReadonlySet<string> = new Set([
  // Early tests / demo markets.
  "0x16ae26dfd4fe18e8f3f0756dca165493b5523a53", // SAFEHOOD (initial test launch)
  "0x55dfcf83135fa4f5d0c3f19311e3d5c103f892c5", // TEST
  "0x2a2b39e3b645adee02af780be42ffc5741404663", // CHIP
  "0xb44549a596819fd688c5855fede16bee96a24663", // APE
  "0xc031a2e1925c4d6ccfbfc9248ea98d7c798f4663", // MOON
  "0x809b86baa7f7323a9d4cdfa2b1d197cfe42b4663", // GREEN
  "0xa4690fcd485d9c00b6f49592454eaa5d32ed4663", // DIAM
  // All currently-launched tokens on both factories.
  "0xf898dfbb47b0938f94d3f57120d8fb85e72d4663", // QVR (v4)
  "0x600478629dd470fbf2a4145a24899458aab34663", // PRINTR (v4)
  "0x2f765eb0e751618b9823a3fa24016008e8ad4663", // CASHCAT (v4)
  "0xcf0f3a06890d8a8b3d8065ebb00d1a5fcd5d4663", // TEST (v4s)
  "0xb12febfa62c70e34a6371b71ef60754f6be44663", // MTK (v4s)
  "0x6608fe97cc3c2d8b755fa5c5cf75d6b6e5fa4663", // JACKET (v4s)
  "0xa300ff70535de29dd28e1e0e5cbe996c1be94663", // ELON (v4s)
]);

export function isHidden(address: string): boolean {
  return HIDDEN_TOKENS.has(address.toLowerCase());
}
