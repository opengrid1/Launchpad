import solc from 'solc'
import Ganache from 'ganache'
import { ethers } from 'ethers'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const SRC = resolve('.', '..')
// tiny mock stock ERC20 that exposes decimals()
const STOCK = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
contract MockStock { uint8 public decimals; constructor(uint8 d){decimals=d;} }
`
const files = {
  'src/v2/StockRegistry.sol': readFileSync(resolve(SRC, 'src/v2/StockRegistry.sol'), 'utf8'),
  'MockStock.sol': STOCK,
}
const input = {
  language: 'Solidity',
  sources: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { content: v }])),
  settings: { optimizer: { enabled: true, runs: 800 }, evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
}
const out = JSON.parse(solc.compile(JSON.stringify(input)))
const errs = (out.errors || []).filter((e) => e.severity === 'error')
if (errs.length) { console.error(errs.map((e) => e.formattedMessage).join('\n')); process.exit(1) }
console.log('compiled ok')
const C = (f, n) => ({ abi: out.contracts[f][n].abi, bytecode: '0x' + out.contracts[f][n].evm.bytecode.object })
const Reg = C('src/v2/StockRegistry.sol', 'StockRegistry')
const Stk = C('MockStock.sol', 'MockStock')

const provider = new ethers.BrowserProvider(Ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai' }, wallet: { totalAccounts: 3, defaultBalance: 100 } }))
const [owner, other] = await Promise.all((await provider.send('eth_accounts', [])).map((a) => provider.getSigner(a)))
const A = (s) => s.getAddress()
async function dpl(art, s, args = []) { const f = new ethers.ContractFactory(art.abi, art.bytecode, s); const c = await f.deploy(...args); await c.waitForDeployment(); return c }
let pass = 0, fail = 0
function eq(n, g, w) { if (g.toString() === w.toString()) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log(`  ✗ ${n}\n      got ${g}\n      want ${w}`) } }
async function reverts(n, p) { try { const t = await p; if (t?.wait) { const r = await t.wait(); if (r.status === 0) throw 0 } fail++; console.log('  ✗ ' + n + ' (no revert)') } catch { pass++; console.log('  ✓ ' + n) } }

const reg = await dpl(Reg, owner, [await A(owner)])
const aapl = await dpl(Stk, owner, [18]) // tokenized stock, 18 decimals
const aaplAddr = await aapl.getAddress()

console.log('StockRegistry (oracle-free / option b)')
eq('ETH (address(0)) always allowed', await reg.isAllowedQuote(ethers.ZeroAddress), true)
eq('ETH decimals = 18', await reg.quoteDecimals(ethers.ZeroAddress), 18n)
eq('unlisted stock not allowed', await reg.isAllowedQuote(aaplAddr), false)
await reverts('non-owner listStock reverts', reg.connect(other).listStock(aaplAddr, 'AAPL'))
await (await reg.connect(owner).listStock(aaplAddr, 'AAPL')).wait()
eq('listed stock now allowed', await reg.isAllowedQuote(aaplAddr), true)
eq('decimals cached from token (18)', await reg.quoteDecimals(aaplAddr), 18n)
eq('listedCount = 1', await reg.listedCount(), 1n)
await reverts('double-list reverts', reg.connect(owner).listStock(aaplAddr, 'AAPL'))
await reverts('quoteDecimals on unlisted reverts', reg.quoteDecimals(await A(other)))

// freeze
await (await reg.connect(owner).freezeListing()).wait()
eq('listingFrozen true', await reg.listingFrozen(), true)
const tsla = await dpl(Stk, owner, [8])
await reverts('listStock after freeze reverts', reg.connect(owner).listStock(await tsla.getAddress(), 'TSLA'))
eq('already-listed stock still allowed after freeze', await reg.isAllowedQuote(aaplAddr), true)

// ownership renounce
await (await reg.connect(owner).transferOwnership(ethers.ZeroAddress)).wait()
eq('owner renounced to zero', await reg.owner(), ethers.ZeroAddress)
await reverts('old owner can no longer act', reg.connect(owner).freezeListing())

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
