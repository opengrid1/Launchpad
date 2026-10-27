// LayerZero's on-chain defaults from each Equo EVM chain toward Solana (eid 30168): libraries, confirmations,
// executor and DVNs (named from lz-dvn-names.json, LayerZero's metadata). Writes lz-solana-defaults.json.
const { ethers } = require("ethers");
const { CHAINS } = require("./chains");
const EP = ["function isSupportedEid(uint32) view returns (bool)", "function defaultSendLibrary(uint32) view returns (address)", "function defaultReceiveLibrary(uint32) view returns (address)", "function getConfig(address,address,uint32,uint32) view returns (bytes)"];
const coder = ethers.AbiCoder.defaultAbiCoder();
const ULN = "tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs)";
const PROBE = "0x000000000000000000000000000000000000dEaD", SOL = 30168;
const RPC = { mainnet: "https://eth.drpc.org", hyperevm: "https://rpc.hypurrscan.io", unichain: "https://unichain-rpc.publicnode.com" };
const names = require("./lz-dvn-names.json");
const nameOf = (chain, a) => { for (const [n, l] of Object.entries(names[chain] || {})) if (l.includes(a.toLowerCase())) return n; return "?"; };
(async () => {
  const out = {};
  for (const a of CHAINS) {
    const p = new ethers.JsonRpcProvider(RPC[a.name] || a.rpc, a.chainId, { staticNetwork: true });
    const ep = new ethers.Contract(a.endpoint, EP, p);
    const r = { supported: await ep.isSupportedEid(SOL) };
    if (r.supported) {
      r.sendLib = await ep.defaultSendLibrary(SOL); r.receiveLib = await ep.defaultReceiveLibrary(SOL);
      const s = coder.decode([ULN], await ep.getConfig(PROBE, r.sendLib, SOL, 2))[0];
      const v = coder.decode([ULN], await ep.getConfig(PROBE, r.receiveLib, SOL, 2))[0];
      const ex = coder.decode(["tuple(uint32 maxMessageSize,address executor)"], await ep.getConfig(PROBE, r.sendLib, SOL, 1))[0];
      Object.assign(r, { sendConfirmations: Number(s.confirmations), receiveConfirmations: Number(v.confirmations), executor: ex.executor, maxMessageSize: Number(ex.maxMessageSize),
        defaultSendDVNs: [...s.requiredDVNs], defaultReceiveDVNs: [...v.requiredDVNs], optSend: [...s.optionalDVNs], optThreshold: Number(s.optionalDVNThreshold) });
      console.log(a.name, 'send conf', r.sendConfirmations, 'recv conf', r.receiveConfirmations, '| send DVNs', r.defaultSendDVNs.map((x) => nameOf(a.name, x) + ':' + x.slice(0, 8)).join(' '), '| recv DVNs', r.defaultReceiveDVNs.map((x) => nameOf(a.name, x)).join(' '), '| opt', r.optSend.length, r.optThreshold);
    } else console.log(a.name, 'NOT SUPPORTED');
    out[a.name] = r;
  }
  require("fs").writeFileSync(__dirname + "/lz-solana-defaults.json", JSON.stringify(out, null, 2) + "\n");
})().catch((e) => { console.error(e); process.exit(1); });
