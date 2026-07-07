import solc from 'solc'
import Ganache from 'ganache'
import { ethers } from 'ethers'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const SRC = resolve('.', '..')
// tiny mock oracle inline
const ORACLE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
contract MockOracle { uint256 public p; constructor(uint256 _p){p=_p;} function usd1e8() external view returns(uint256){return p;} }
`
const files = {
  'src/v2/StockRegistry.sol': readFileSync(resolve(SRC, 'src/v2/StockRegistry.sol'), 'utf8'),
  'MockOracle.sol': ORACLE,
}
const input = {
  language: 'Solidity',
  sources: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { content: v }])),
  settings: { optimizer: { enabled: true, runs: 800 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
}
const out = JSON.parse(solc.compile(JSON.stringify(input)))
const errs = (out.errors || []).filter((e) => e.severity === 'error')
if (errs.length) { console.error(errs.map((e) => e.formattedMessage).join('\n')); process.exit(1) }
console.log('compiled ok')
const C = (f, n) => ({ abi: out.contracts[f][n].abi, bytecode: '0x' + out.contracts[f][n].evm.bytecode.object })
const Reg = C('src/v2/StockRegistry.sol', 'StockRegistry')
const Ora = C('MockOracle.sol', 'MockOracle')

const provider = new ethers.BrowserProvider(Ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 3, defaultBalance: 100 } }))
const [owner, other, stock] = await Promise.all((await provider.send('eth_accounts', [])).map((a) => provider.getSigner(a)))
const A = (s) => s.getAddress()
async function dpl(art, s, args = []) { const f = new ethers.ContractFactory(art.abi, art.bytecode, s); const c = await f.deploy(...args); await c.waitForDeployment(); return c }
let pass = 0, fail = 0
function eq(n, g, w) { if (g.toString() === w.toString()) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log(`  ✗ ${n}\n      got ${g}\n      want ${w}`) } }
async function reverts(n, p) { try { const t = await p; if (t?.wait) { const r = await t.wait(); if (r.status === 0) throw 0 } fail++; console.log('  ✗ ' + n + ' (no revert)') } catch { pass++; console.log('  ✓ ' + n) } }

const reg = await dpl(Reg, owner, [await A(owner)])
const ora = await dpl(Ora, owner, [19000000000n]) // $190.00 (1e8)
const stockAddr = await A(stock)

console.log('StockRegistry')
eq('ETH (address(0)) always allowed', await reg.isAllowedQuote(ethers.ZeroAddress), true)
eq('unlisted stock not allowed', await reg.isAllowedQuote(stockAddr), false)
await reverts('non-owner listStock reverts', reg.connect(other).listStock(stockAddr, await ora.getAddress(), 18, 'AAPLx'))
await (await reg.connect(owner).listStock(stockAddr, await ora.getAddress(), 18, 'AAPLx')).wait()
eq('listed stock now allowed', await reg.isAllowedQuote(stockAddr), true)
eq('quoteUsd1e8 reads oracle', await reg.quoteUsd1e8(stockAddr), 19000000000n)
eq('listedCount = 1', await reg.listedCount(), 1n)
await reverts('double-list reverts', reg.connect(owner).listStock(stockAddr, await ora.getAddress(), 18, 'AAPLx'))
await reverts('quoteUsd1e8 on unlisted reverts', reg.quoteUsd1e8(await A(other)))

// updateOracle
const ora2 = await dpl(Ora, owner, [20000000000n])
await (await reg.connect(owner).updateOracle(stockAddr, await ora2.getAddress())).wait()
eq('oracle swapped → new price', await reg.quoteUsd1e8(stockAddr), 20000000000n)
await reverts('updateOracle on unlisted reverts', reg.connect(owner).updateOracle(await A(other), await ora2.getAddress()))

// freeze
await (await reg.connect(owner).freezeListing()).wait()
eq('listingFrozen true', await reg.listingFrozen(), true)
await reverts('listStock after freeze reverts', reg.connect(owner).listStock(await A(other), await ora.getAddress(), 18, 'X'))
eq('already-listed stock still allowed after freeze', await reg.isAllowedQuote(stockAddr), true)

// ownership renounce
await (await reg.connect(owner).transferOwnership(ethers.ZeroAddress)).wait()
eq('owner renounced to zero', await reg.owner(), ethers.ZeroAddress)
await reverts('old owner can no longer act', reg.connect(owner).updateOracle(stockAddr, await ora.getAddress()))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
