// For each Ondo tokenized stock on HyperEVM, probe the HyperSwap V3 factory for
// a pool against a set of candidate base/quote tokens across every fee tier,
// then read the pool's live token balances to see which are actually funded.
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const RPC = "https://rpc.hyperliquid.xyz/evm";
const V3_FACTORY = "0xb1c0fa0b789320044a6f623cfe5ebda9562602e3";
const TIERS = [100, 500, 3000, 10000];

// Candidate quote/base tokens on HyperEVM.
const BASES = {
  WHYPE:  "0x5555555555555555555555555555555555555555",
  USDT0:  "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb",
  USDe:   "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
  USDHL:  "0xb50A96253aBDF803D85efcDce07Ad8becBc52BD5",
  feUSD:  "0x02c6a2fA58cC01A18B8D9E00eA48d65E4dF26c70",
  UBTC:   "0x9FDBdA0A5e284c32744D2f17Ee5c74B284993463",
  UETH:   "0xBe6727B535545C67d5cAa73dEa54865B92CF7907",
};

const FACTORY_ABI = ["function getPool(address,address,uint24) view returns (address)"];
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"];

async function main() {
  const p = new ethers.JsonRpcProvider(RPC, 999);
  const factory = new ethers.Contract(V3_FACTORY, FACTORY_ABI, p);

  // Resolve base decimals once.
  const baseDec = {};
  for (const [sym, addr] of Object.entries(BASES)) {
    try { baseDec[sym] = Number(await new ethers.Contract(addr, ERC20_ABI, p).decimals()); }
    catch { baseDec[sym] = 18; }
  }

  const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments/hyperevm-ondo-stocks.json"), "utf8"));
  const funded = [];

  for (const t of data.tokens) {
    const stock = new ethers.Contract(t.address, ERC20_ABI, p);
    let best = null;
    for (const [sym, addr] of Object.entries(BASES)) {
      const baseC = new ethers.Contract(addr, ERC20_ABI, p);
      for (const tier of TIERS) {
        let pool;
        try { pool = await factory.getPool(t.address, addr, tier); } catch { continue; }
        if (!pool || pool === ethers.ZeroAddress) continue;
        let baseBal = 0n, stockBal = 0n;
        try { baseBal = await baseC.balanceOf(pool); stockBal = await stock.balanceOf(pool); } catch { continue; }
        const baseF = Number(ethers.formatUnits(baseBal, baseDec[sym]));
        const stockF = Number(ethers.formatUnits(stockBal, t.decimals));
        const entry = { base: sym, baseAddr: addr, tier, pool, baseAmt: baseF, stock: stockF };
        if (!best || baseF > best.baseAmt) best = entry;
      }
    }
    if (best && best.baseAmt > 0.0001) {
      funded.push({ ...t, ...best });
      console.log(`FUNDED  ${t.symbol.padEnd(8)} ${best.base.padEnd(6)} tier ${String(best.tier).padStart(5)}  base ${best.baseAmt.toFixed(2).padStart(12)}  stock ${best.stock.toFixed(4)}  ${best.pool}`);
    } else if (best) {
      console.log(`empty   ${t.symbol.padEnd(8)} pool exists (${best.base}) but 0 balance  ${best.pool}`);
    } else {
      console.log(`no pool ${t.symbol.padEnd(8)}`);
    }
  }

  console.log(`\n${funded.length} of ${data.tokens.length} Ondo stocks have a funded pool:`);
  for (const f of funded) console.log(`  ${f.symbol.padEnd(8)} vs ${f.base.padEnd(6)} ${f.address}  tier ${f.tier}  base ${f.baseAmt.toFixed(2)}`);
  fs.writeFileSync(path.join(__dirname, "..", "deployments/hyperevm-ondo-liquidity.json"),
    JSON.stringify({ checkedAt: new Date().toISOString(), factory: V3_FACTORY, bases: BASES, funded }, null, 2));
}
main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
