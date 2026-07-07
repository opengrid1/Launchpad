import solc from 'solc'
import Ganache from 'ganache'
import { ethers } from 'ethers'
import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(__dir, '..')

// ---- compile ----
const files = {
  'src/v2/RewardsDistributorV2.sol': readFileSync(resolve(SRC, 'src/v2/RewardsDistributorV2.sol'), 'utf8'),
  'test/mocks/Mocks.sol': readFileSync(resolve(SRC, 'test/mocks/Mocks.sol'), 'utf8'),
}
const input = {
  language: 'Solidity',
  sources: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { content: v }])),
  settings: { optimizer: { enabled: true, runs: 800 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
}
const out = JSON.parse(solc.compile(JSON.stringify(input)))
const errs = (out.errors || []).filter((e) => e.severity === 'error')
if (errs.length) {
  console.error('COMPILE ERRORS:\n' + errs.map((e) => e.formattedMessage).join('\n'))
  process.exit(1)
}
const warns = (out.errors || []).filter((e) => e.severity === 'warning')
console.log(`compiled ok (${warns.length} warnings)`)
const C = (file, name) => ({
  abi: out.contracts[file][name].abi,
  bytecode: '0x' + out.contracts[file][name].evm.bytecode.object,
})
const Dist = C('src/v2/RewardsDistributorV2.sol', 'RewardsDistributorV2')
const Coin = C('test/mocks/Mocks.sol', 'MockCoin')
const Stock = C('test/mocks/Mocks.sol', 'MockStock')
const Exec = C('test/mocks/Mocks.sol', 'MockExecutor')

// ---- boot local EVM ----
const provider = new ethers.BrowserProvider(
  Ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai' }, wallet: { totalAccounts: 6, defaultBalance: 1000 } }),
)
const [deployer, hook, creator, alice, bob, keeper] = await Promise.all(
  (await provider.send('eth_accounts', [])).map((a) => provider.getSigner(a)),
)
const addr = async (s) => await s.getAddress()

async function deploy(art, signer, args = []) {
  const f = new ethers.ContractFactory(art.abi, art.bytecode, signer)
  const c = await f.deploy(...args)
  await c.waitForDeployment()
  return c
}

// ---- assertions ----
let pass = 0, fail = 0
function eq(name, got, want) {
  const g = got.toString(), w = want.toString()
  if (g === w) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`) }
}
async function reverts(name, p) {
  try {
    const tx = await p
    if (tx && typeof tx.wait === 'function') {
      const r = await tx.wait()
      if (r && r.status === 0) throw new Error('status 0')
    }
    fail++; console.log(`  ✗ ${name} (did not revert)`)
  } catch { pass++; console.log(`  ✓ ${name} (reverted)`) }
}
const E = (n) => ethers.parseEther(String(n))
// ganache + µWS-fallback makes provider.getBalance() cache stale values; read raw.
const bal = async (a) => BigInt(await provider.send('eth_getBalance', [a, 'latest']))

const POOL_MANAGER = '0x00000000000000000000000000000000000000A1' // dummy excluded addr

// ============ TEST 1: ETH-quote, 50/50 split, pro-rata, single-step claim ============
console.log('\nTEST 1 — ETH quote: 50/50 split + pro-rata holders + one-step claim')
{
  const exec0 = await deploy(Exec, deployer, [2n])
  const dist = await deploy(Dist, deployer, [await addr(deployer), await addr(hook), POOL_MANAGER, await exec0.getAddress()])
  // coin minted to deployer (acts as the "pool"/seed holder)
  const coin = await deploy(Coin, deployer, [E(1000), await dist.getAddress()])
  await dist.register(await coin.getAddress(), await addr(creator), ethers.ZeroAddress, false)

  // distribute holdings: alice 300, bob 100, deployer keeps 600 (stands in as pool-ish)
  await (await coin.connect(deployer).transfer(await addr(alice), E(300))).wait()
  await (await coin.connect(deployer).transfer(await addr(bob), E(100))).wait()
  // eligible supply now = 1000 (deployer 600 + alice 300 + bob 100); none excluded here

  // hook pushes 1 ETH of tax
  await (await dist.connect(hook).depositETH(await coin.getAddress(), { value: E(1) })).wait()
  // holders get 0.5 ETH split across 1000 tokens => 0.0005 ETH per token
  eq('creator owed = 0.5', await dist.creatorOwed(await coin.getAddress()), E(0.5))
  eq('alice claimable = 0.15 (300*0.0005)', await dist.claimable(await coin.getAddress(), await addr(alice)), E(0.15))
  eq('bob claimable = 0.05 (100*0.0005)', await dist.claimable(await coin.getAddress(), await addr(bob)), E(0.05))
  eq('deployer claimable = 0.30 (600*0.0005)', await dist.claimable(await coin.getAddress(), await addr(deployer)), E(0.30))

  // single-step claim (no collect): measure the distributor's outflow (gas-free)
  const dAddr = await coin.getAddress() // token addr, used for lookups
  const distAddr = await dist.getAddress()
  const distEthBefore = await bal(distAddr)
  await (await dist.connect(alice).claim(dAddr)).wait()
  const distEthAfterAlice = await bal(distAddr)
  eq('distributor paid out 0.15 ETH to alice (one tx, no collect)', distEthBefore - distEthAfterAlice, E(0.15))
  eq('alice claimable now 0', await dist.claimable(dAddr, await addr(alice)), 0n)

  // creator single-step claim
  await (await dist.connect(creator).claimCreator(dAddr)).wait()
  eq('distributor paid out 0.5 ETH to creator', distEthAfterAlice - (await bal(distAddr)), E(0.5))

  await reverts('double-claim reverts', dist.connect(alice).claim(await coin.getAddress()))
}

// ============ TEST 2: creator buyback (burn) toggle ============
console.log('\nTEST 2 — creator buyback: 50% funds buyback, executor buys, coins burned')
{
  const exec0 = await deploy(Exec, deployer, [2n])
  const dist = await deploy(Dist, deployer, [await addr(deployer), await addr(hook), POOL_MANAGER, await exec0.getAddress()])
  const coin = await deploy(Coin, deployer, [E(1000), await dist.getAddress()])
  await dist.register(await coin.getAddress(), await addr(creator), ethers.ZeroAddress, false)
  await (await coin.connect(deployer).transfer(await addr(alice), E(500))).wait()

  // creator turns buyback ON
  await (await dist.connect(creator).setBuyback(await coin.getAddress(), true)).wait()
  const i = await dist.info(await coin.getAddress())
  eq('buyback flag on', i.buybackOn, true)

  // hook pushes 1 ETH tax → creator half (0.5) goes to buyback fund, not owed
  await (await dist.connect(hook).depositETH(await coin.getAddress(), { value: E(1) })).wait()
  eq('creator owed stays 0 (buyback on)', await dist.creatorOwed(await coin.getAddress()), 0n)
  eq('buyback fund = 0.5', await dist.buybackFund(await coin.getAddress()), E(0.5))

  // stash coins into the trusted executor the distributor was built with, rate 2
  await (await coin.connect(deployer).transfer(await exec0.getAddress(), E(400))).wait()

  const supplyBefore = await coin.totalSupply()
  // anyone (keeper) can trigger buyback; fund 0.5 ETH * rate 2 = 1.0 coin burned
  await (await dist.connect(keeper).executeBuyback(await coin.getAddress())).wait()
  eq('buyback fund drained to 0', await dist.buybackFund(await coin.getAddress()), 0n)
  eq('supply reduced by 1.0 coin (burned)', supplyBefore - (await coin.totalSupply()), E(1))
  eq('distributor holds 0 coins after burn', await coin.balanceOf(await dist.getAddress()), 0n)
}

// ============ TEST 3: stock-quote rewards (ERC20) ============
console.log('\nTEST 3 — stock quote: rewards paid in a stock ERC20')
{
  const exec0 = await deploy(Exec, deployer, [2n])
  const dist = await deploy(Dist, deployer, [await addr(deployer), await addr(hook), POOL_MANAGER, await exec0.getAddress()])
  const coin = await deploy(Coin, deployer, [E(1000), await dist.getAddress()])
  const stock = await deploy(Stock, deployer, [E(1_000_000)])
  await dist.register(await coin.getAddress(), await addr(creator), await stock.getAddress(), false)
  await (await coin.connect(deployer).transfer(await addr(alice), E(250))).wait() // 25% of supply

  // hook pushes 8 stock tokens of tax: transfer to distributor, then notify
  await (await stock.connect(deployer).transfer(await dist.getAddress(), E(8))).wait()
  await (await dist.connect(hook).depositERC20(await coin.getAddress(), E(8))).wait()
  // holders get 4 stock over 1000 tokens; alice has 250 => 1.0 stock
  eq('creator owed 4 stock', await dist.creatorOwed(await coin.getAddress()), E(4))
  eq('alice claimable 1.0 stock (250/1000 * 4)', await dist.claimable(await coin.getAddress(), await addr(alice)), E(1))

  const before = await stock.balanceOf(await addr(alice))
  await (await dist.connect(alice).claim(await coin.getAddress())).wait()
  eq('alice received 1.0 stock (one tx)', (await stock.balanceOf(await addr(alice))) - before, E(1))
}

// ============ TEST 4: access control ============
console.log('\nTEST 4 — access control')
{
  const exec0 = await deploy(Exec, deployer, [2n])
  const dist = await deploy(Dist, deployer, [await addr(deployer), await addr(hook), POOL_MANAGER, await exec0.getAddress()])
  const coin = await deploy(Coin, deployer, [E(1000), await dist.getAddress()])
  await dist.register(await coin.getAddress(), await addr(creator), ethers.ZeroAddress, false)
  await reverts('non-hook depositETH reverts', dist.connect(alice).depositETH(await coin.getAddress(), { value: E(1) }))
  await reverts('non-creator setBuyback reverts', dist.connect(alice).setBuyback(await coin.getAddress(), true))
  await reverts('non-creator claimCreator reverts', dist.connect(alice).claimCreator(await coin.getAddress()))
  await reverts('non-factory register reverts', dist.connect(alice).register(await coin.getAddress(), await addr(alice), ethers.ZeroAddress, false))
}

// ============ TEST 5: C-1 regression — no caller-supplied executor ============
console.log('\nTEST 5 — C-1: buyback fund can only go to the trusted, immutable executor')
{
  const fn = Dist.abi.find((e) => e.type === 'function' && e.name === 'executeBuyback')
  eq('executeBuyback takes only (token) — no attacker executor param', fn.inputs.length, 1)
  eq('buybackExecutor is a constructor-set immutable getter', Dist.abi.some((e) => e.name === 'buybackExecutor' && e.stateMutability === 'view'), true)
}

console.log(`\n──────────\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
