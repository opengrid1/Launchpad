/**
 * Integration verification against HyperEVM mainnet.
 * Exercises the same lib/ code paths the UI uses — reads, metadata, quotes, fee
 * simulation — and cross-checks the HyperCore L1 action signature against the
 * official Python SDK (run separately, see verify-signing.py).
 *
 *   npx tsx scripts/verify.ts
 */
import assert from 'node:assert/strict'
import { createWalletClient, http, formatEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { hyperevm, publicClient } from '../src/lib/chain'
import { fetchLaunches, fetchTokenDetail, fetchPendingFees, quoteBuy, withSlippage } from '../src/lib/launchpad'
import { parseTokenURI, buildTokenURI } from '../src/lib/metadata'
import { l1ActionHash, signL1Action } from '../src/lib/bigblocks'
import { LAUNCHPAD, launchpadAbi } from '../src/lib/contracts'

let passed = 0
function ok(label: string, cond: boolean, extra = '') {
  assert.ok(cond, `FAIL: ${label} ${extra}`)
  passed++
  console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ''}`)
}

console.log('1. board reads (same code as the Board page)')
const rows = await fetchLaunches()
ok('launches load', rows.length >= 1, `${rows.length} token(s)`)
const ltest = rows.find((r) => r.symbol === 'LTEST')
assert.ok(ltest, 'LTEST launch missing')
ok('LTEST present', true, ltest.token)
ok('market cap ~$4k', ltest.marketCapUsd6 > 3_000_000_000n && ltest.marketCapUsd6 < 5_000_000_000n, `$${Number(ltest.marketCapUsd6) / 1e6}`)
ok('createdAt sane', ltest.createdAt > 1_700_000_000 && ltest.createdAt <= Date.now() / 1000)

console.log('2. token detail (same code as the Token page)')
const detail = await fetchTokenDetail(ltest.token)
ok('price > 0', detail.priceWei > 0n, `${formatEther(detail.priceWei)} HYPE/token`)
ok('hype oracle live', detail.hypeUsd6 > 1_000_000n, `$${Number(detail.hypeUsd6) / 1e6}/HYPE`)
ok('supply = 1B', detail.totalSupply === 10n ** 27n)
ok('creator recorded', detail.creator.toLowerCase() === '0x9a04f5edf3e9574c59e368c39926cc25605151f3')

console.log('3. metadata (data-URI round trip)')
const meta = await parseTokenURI(detail.tokenURI)
ok('name parsed', meta.name === 'Launchpad Test', meta.name)
const rebuilt = await parseTokenURI(buildTokenURI({ name: 'X', twitter: 'x.com/x', description: 'héllo ünïcode' }))
ok('builder round-trips unicode', rebuilt.description === 'héllo ünïcode' && rebuilt.twitter === 'x.com/x')

console.log('4. trading quotes (router simulation, balance override)')
const oneHype = 10n ** 18n
const out = await quoteBuy(ltest.token, oneHype)
ok('buy quote works disconnected', out > 0n, `1 HYPE -> ${Number(formatEther(out)).toFixed(0)} LTEST`)
// $4k cap, ~1B supply: 1 HYPE (~$60) should buy very roughly 1.5% of supply.
const outTokens = Number(formatEther(out))
ok('buy quote magnitude sane', outTokens > 1e6 && outTokens < 5e7, `${(outTokens / 1e9 * 100).toFixed(2)}% of supply`)
ok('slippage math', withSlippage(1000n, 100) === 990n && withSlippage(1000n, 50) === 995n)

console.log('5. fee pipeline')
const pending = await fetchPendingFees(ltest.token)
ok('pending fee simulation works', pending.hype >= 0n && pending.token >= 0n, `${formatEther(pending.hype)} HYPE pending`)
const [creatorFees, lifetime] = await Promise.all([
  publicClient.readContract({ address: LAUNCHPAD, abi: launchpadAbi, functionName: 'creatorFeesHype', args: [ltest.token] }),
  publicClient.readContract({ address: LAUNCHPAD, abi: launchpadAbi, functionName: 'lifetimeFeesHype', args: [ltest.token] }),
])
ok('fee accounting readable', creatorFees >= 0n && lifetime >= 0n)

console.log('6. HyperCore L1 action signing (fixed vectors for python cross-check)')
const TEST_KEY = '0x0123456789012345678901234567890123456789012345678901234567890123' as const
const TEST_NONCE = 1_700_000_000_000
const account = privateKeyToAccount(TEST_KEY)
const wallet = createWalletClient({ account, chain: hyperevm, transport: http() })
const hash = l1ActionHash({ type: 'evmUserModify', usingBigBlocks: true }, TEST_NONCE)
const sig = await signL1Action(wallet, account, { type: 'evmUserModify', usingBigBlocks: true }, TEST_NONCE)
console.log(`  action hash: ${hash}`)
console.log(`  signature  : r=${sig.r} s=${sig.s} v=${sig.v}`)
ok('signature produced', /^0x[0-9a-f]{64}$/.test(sig.r) && (sig.v === 27 || sig.v === 28))

console.log(`\nall ${passed} checks passed ✓`)
console.log('SIGCHECK', JSON.stringify({ hash, ...sig }))
