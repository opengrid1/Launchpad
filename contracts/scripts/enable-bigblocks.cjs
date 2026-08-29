// Enable HyperEVM "big blocks" for the deployer via Hyperliquid's evmUserModify
// L1 action, signed with the deployer key (read from .env.meow-deployer).
const fs = require("fs");
const path = require("path");
const { encode } = require("@msgpack/msgpack");
const { ethers } = require("ethers");

function loadKey() {
  const env = fs.readFileSync(path.join(__dirname, "..", ".env.meow-deployer"), "utf8");
  const m = env.match(/PRIVATE_KEY=(0x[0-9a-fA-F]{64})/);
  if (!m) throw new Error("PRIVATE_KEY not found");
  return m[1];
}

async function main() {
  const enable = process.argv[2] !== "off";
  const wallet = new ethers.Wallet(loadKey());
  const action = { type: "evmUserModify", usingBigBlocks: enable };
  const nonce = Date.now();

  // L1 action hash: msgpack(action) || nonce(uint64 BE) || 0x00 (no vault)
  const actionBytes = Buffer.from(encode(action));
  const nb = Buffer.alloc(8);
  nb.writeBigUInt64BE(BigInt(nonce));
  const data = Buffer.concat([actionBytes, nb, Buffer.from([0x00])]);
  const connectionId = ethers.keccak256(data);

  const domain = { name: "Exchange", version: "1", chainId: 1337, verifyingContract: "0x0000000000000000000000000000000000000000" };
  const types = { Agent: [ { name: "source", type: "string" }, { name: "connectionId", type: "bytes32" } ] };
  const value = { source: "a", connectionId }; // "a" = mainnet
  const sig = await wallet.signTypedData(domain, types, value);
  const s = ethers.Signature.from(sig);

  const body = { action, nonce, signature: { r: s.r, s: s.s, v: s.v }, vaultAddress: null };
  const res = await fetch("https://api.hyperliquid.xyz/exchange", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const out = await res.json();
  console.log("bigBlocks", enable ? "ON" : "OFF", "for", wallet.address, "->", JSON.stringify(out));
}
main().catch((e) => { console.error(e); process.exit(1); });
