import { ethers } from "ethers";
import solc from "solc";
import fs from "fs";
import path from "path";

const { PRIVATE_KEY, RPC_URL } = process.env;
const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
const OFA = "0xAA57c1Aebd29cb767e8C4f80F50bD38b61df073E";
const CREATE2 = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const FEE_BPS = 200n;

function compile() {
  function imp(p) { for (const t of [p, path.join("node_modules", p)]) { try { return { contents: fs.readFileSync(t, "utf8") }; } catch (_) {} } return { error: "nf " + p }; }
  const input = { language: "Solidity", sources: { "OFAFeeHook.sol": { content: fs.readFileSync(new URL("../src/OFAFeeHook.sol", import.meta.url), "utf8") } }, settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["evm.bytecode.object"] } } } };
  const out = JSON.parse(solc.compile(JSON.stringify(input), { import: imp }));
  const errs = (out.errors || []).filter(e => e.severity === "error");
  if (errs.length) { errs.forEach(e => console.log(e.formattedMessage)); process.exit(1); }
  return out.contracts["OFAFeeHook.sol"].OFAFeeHook.evm.bytecode.object;
}

const p = new ethers.JsonRpcProvider(RPC_URL);
const w = new ethers.NonceManager(new ethers.Wallet(PRIVATE_KEY, p));
const bytecode = compile();
const args = ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "uint256"], [POOL_MANAGER, OFA, FEE_BPS]);
const initcode = "0x" + bytecode + args.slice(2);
const initHash = ethers.keccak256(initcode);

const FLAGS = 0xCCn, MASK = 0x3FFFn;
let salt, hookAddr;
for (let i = 0; i < 2_000_000; i++) {
  const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
  const a = ethers.getCreate2Address(CREATE2, s, initHash);
  if ((BigInt(a) & MASK) === FLAGS) { salt = s; hookAddr = a; break; }
}
console.log("hook address:", hookAddr, "(salt", parseInt(salt, 16) + ")");

if ((await p.getCode(hookAddr)) !== "0x") {
  console.log("already deployed at", hookAddr);
} else {
  const tx = await w.sendTransaction({ to: CREATE2, data: salt + initcode.slice(2) });
  console.log("deploy tx:", tx.hash);
  await tx.wait();
  console.log("deployed:", (await p.getCode(hookAddr)) !== "0x" ? "OK" : "FAIL");
}
console.log("\nOFAFeeHook:", hookAddr);
