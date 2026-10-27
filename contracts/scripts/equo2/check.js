// Check every Equo v2 deployment on chain against deployments/equo2-<chain>.json: the hook's owner and factory,
// the coin deployer's endpoint, creator, factory, closed setup and a route to every other chain, and the factory's
// admin, signer, launcher, collector and launch-fee recipient.
//   node scripts/equo2/check.js [chain ...]
const { ethers } = require("ethers");
const { existsSync, readFileSync } = require("fs");
const { join } = require("path");
const { CHAINS } = require("./chains");

const art = (dir, name) => JSON.parse(readFileSync(join(__dirname, `../../artifacts/contracts/v4/equo2/${dir}/${name}.json`), "utf8")).abi;
const HOOK = art("EquoFeeHook.sol", "EquoFeeHook");
const DEP = art("EquoCoinDeployer.sol", "EquoCoinDeployer");
const FAC = art("EquoLaunchFactory.sol", "EquoLaunchFactory");
const ROUTER = art("EquoSwapRouter.sol", "EquoSwapRouter");

(async () => {
  const only = process.argv.slice(2);
  let bad = 0;
  for (const c of CHAINS) {
    if (only.length && !only.includes(c.name)) continue;
    const file = join(__dirname, `../../deployments/equo2-${c.name}.json`);
    if (!existsSync(file)) { console.log(`${c.name}: not deployed`); bad++; continue; }
    const d = JSON.parse(readFileSync(file, "utf8"));
    const C = d.contracts;
    const p = new ethers.JsonRpcProvider(process.env[`${c.name.toUpperCase()}_RPC`] ?? c.rpc, c.chainId, { staticNetwork: true });
    const hook = new ethers.Contract(C.hook, HOOK, p);
    const dep = new ethers.Contract(C.coinDeployer, DEP, p);
    const fac = new ethers.Contract(C.factory, FAC, p);
    const router = new ethers.Contract(C.router, ROUTER, p);
    const fails = [];
    const eq = (what, got, want) => { if (String(got).toLowerCase() !== String(want).toLowerCase()) fails.push(`${what}: ${got} != ${want}`); };
    try {
      eq("hook.deployer", await hook.deployer(), d.deployer);
      eq("hook.factory", await hook.factory(), C.factory);
      eq("hook.weth", await hook.weth(), c.weth);
      eq("dep.endpoint", await dep.endpoint(), c.endpoint);
      eq("dep.factory", await dep.factory(), C.factory);
      eq("dep.creator", await dep.creatorContract(), C.coinCreator);
      eq("dep.admin", await dep.admin(), d.admin);
      eq("dep.setupBy", await dep.setupBy(), ethers.ZeroAddress);
      for (const r of CHAINS) {
        if (r === c) continue;
        const route = await dep.route(r.eid);
        if (route.sendLib === ethers.ZeroAddress) fails.push(`no route to ${r.name}`);
      }
      eq("fac.admin", await fac.admin(), d.admin);
      eq("fac.hook", await fac.hook(), C.hook);
      eq("fac.coinDeployer", await fac.coinDeployer(), C.coinDeployer);
      eq("fac.eid", await fac.eid(), c.eid);
      eq("fac.signer", await fac.signer(), d.signer);
      eq("fac.feeRecipient", await fac.feeRecipient(), d.feeRecipient);
      eq("fac.launchFeeTo", await fac.launchFeeTo(), d.launcher);
      eq("fac.launcher", await fac.launchers(d.launcher), true);
      eq("fac.collector", await fac.collectors(d.launcher), true);
      eq("router.factory", await router.factory(), C.factory);
    } catch (e) {
      fails.push(`read failed: ${e.shortMessage ?? e.message}`);
    }
    if (fails.length) bad++;
    console.log(`${c.name}: ${fails.length ? "PROBLEMS\n  " + fails.join("\n  ") : "ok"}  factory ${C.factory}`);
  }
  process.exit(bad ? 1 : 0);
})();
