// Read LayerZero's on-chain defaults for every pathway between the Equo v2 chains: send/receive libraries,
// confirmations, executor, and whether the pathway is supported. Writes lz-defaults.json next to this file.
const { ethers } = require("ethers");
const { writeFileSync } = require("fs");
const { CHAINS } = require("./chains");

const EP = [
  "function isSupportedEid(uint32) view returns (bool)",
  "function defaultSendLibrary(uint32) view returns (address)",
  "function defaultReceiveLibrary(uint32) view returns (address)",
  "function getConfig(address,address,uint32,uint32) view returns (bytes)",
];
const coder = ethers.AbiCoder.defaultAbiCoder();
const ULN = "tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs)";
const PROBE = "0x000000000000000000000000000000000000dEaD";

(async () => {
  const out = {};
  for (const a of CHAINS) {
    const p = new ethers.JsonRpcProvider(a.rpc, a.chainId, { staticNetwork: true });
    const ep = new ethers.Contract(a.endpoint, EP, p);
    out[a.name] = {};
    for (const b of CHAINS) {
      if (a === b) continue;
      const r = { supported: await ep.isSupportedEid(b.eid) };
      if (r.supported) {
        r.sendLib = await ep.defaultSendLibrary(b.eid);
        r.receiveLib = await ep.defaultReceiveLibrary(b.eid);
        const s = coder.decode([ULN], await ep.getConfig(PROBE, r.sendLib, b.eid, 2))[0];
        const v = coder.decode([ULN], await ep.getConfig(PROBE, r.receiveLib, b.eid, 2))[0];
        const ex = coder.decode(["tuple(uint32 maxMessageSize,address executor)"], await ep.getConfig(PROBE, r.sendLib, b.eid, 1))[0];
        r.sendConfirmations = Number(s.confirmations);
        r.receiveConfirmations = Number(v.confirmations);
        r.executor = ex.executor;
        r.maxMessageSize = Number(ex.maxMessageSize);
        r.defaultSendDVNs = [...s.requiredDVNs];
        r.defaultReceiveDVNs = [...v.requiredDVNs];
      }
      out[a.name][b.name] = r;
      console.log(a.name, "->", b.name, JSON.stringify(r));
    }
  }
  writeFileSync(__dirname + "/lz-defaults.json", JSON.stringify(out, null, 2) + "\n");
})().catch((e) => { console.error(e); process.exit(1); });
