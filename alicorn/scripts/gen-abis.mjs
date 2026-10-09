// Regenerates src/lib/abis.ts from the size-optimised Alicorn artifacts.
//   node scripts/gen-abis.mjs   (run after `HARDHAT_CONFIG=hardhat.config.size.ts npx hardhat compile` in ../contracts)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const art = path.join(here, "..", "..", "contracts", "artifacts-size", "contracts", "v4", "alicorn");
const read = (name) => JSON.parse(fs.readFileSync(path.join(art, `${name}.sol`, `${name}.json`), "utf8")).abi;
const out = ["// Generated from the compiled Alicorn contracts (artifacts-size). Do not edit by hand.", ""];
for (const [exp, name] of [["factoryAbi", "AlicornFactory"], ["pairsAbi", "AlicornPairs"], ["tokenAbi", "AlicornToken"], ["routerAbi", "AlicornRouter"], ["hookAbi", "AlicornHook"]]) {
  out.push(`export const ${exp} = ${JSON.stringify(read(name), null, 1)} as const;`, "");
}
fs.writeFileSync(path.join(here, "..", "src", "lib", "abis.ts"), out.join("\n"));
console.log("wrote src/lib/abis.ts");
