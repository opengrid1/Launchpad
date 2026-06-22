// HYPEX keeper bot — runs the reward pipeline:
//   harvest() -> sellHypeForUsdc() -> buySpcxd() -> deliverToToken()
// Prices the Core order-book legs off the live Hyperliquid book and crosses the spread (IOC).
// Honest constraints: SPCXD is a tokenized dStock — it only fills during market hours and may
// have a higher min order size/notional than regular spot. The bot skips legs that are below
// min size or whose book is empty, and retries next cycle.
//
// Usage: PRIVATE_KEY=0x... MANAGER=0x... node scripts/keeper.mjs [--once] [--interval=300]
import { createWalletClient, createPublicClient, http, defineChain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const RPC = 'https://rpc.hyperliquid.xyz/evm'
const HL_INFO = 'https://api.hyperliquid.xyz/info'
const HYPE_USDC_COIN = '@107'
const SPCXD_USDC_COIN = '@465'

// min order sizes (szDecimals=2 -> 0.01 lot). dStock min notional may be higher; tune here.
const MIN_HYPE_SELL = 0.01 // HYPE
const MIN_USDC_BUY = 1.70 // USDC needed to buy >= 0.01 SPCXD at ~$166
const SPCXD_LOT = 0.01 // SPCXD lot
const SLIPPAGE = 0.02 // cross the book by 2%

const hyperevm = defineChain({
  id: 999, name: 'HyperEVM',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
})

const MGR_ABI = [
  { type: 'function', name: 'harvest', stateMutability: 'nonpayable', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'sellHypeForUsdc', stateMutability: 'nonpayable', inputs: [{ type: 'uint64' }, { type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'buySpcxd', stateMutability: 'nonpayable', inputs: [{ type: 'uint64' }, { type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'deliverToToken', stateMutability: 'nonpayable', inputs: [], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'coreHype', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'coreUsdc', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'coreSpcxd', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
]

const args = process.argv.slice(2)
const ONCE = args.includes('--once')
const INTERVAL = Number((args.find(a => a.startsWith('--interval=')) || '').split('=')[1] || 300) * 1000

const pk = process.env.PRIVATE_KEY
const MANAGER = process.env.MANAGER
if (!pk || !MANAGER) throw new Error('PRIVATE_KEY and MANAGER env required')
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`)
const wallet = createWalletClient({ account, chain: hyperevm, transport: http() })
const pub = createPublicClient({ chain: hyperevm, transport: http() })

const info = async (b) => (await fetch(HL_INFO, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json()
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString(), ...a)

async function bestBidAsk(coin) {
  const book = await info({ type: 'l2Book', coin })
  const bid = book.levels?.[0]?.[0] ? Number(book.levels[0][0].px) : null
  const ask = book.levels?.[1]?.[0] ? Number(book.levels[1][0].px) : null
  return { bid, ask }
}

function read(name) {
  return pub.readContract({ address: MANAGER, abi: MGR_ABI, functionName: name })
}
async function send(name, params = []) {
  const hash = await wallet.writeContract({ address: MANAGER, abi: MGR_ABI, functionName: name, args: params, gas: 600000n })
  const r = await pub.waitForTransactionReceipt({ hash })
  log(`  ${name} -> ${r.status} ${hash}`)
  return r
}
// wait until a view crosses 0 (async Core settlement)
async function waitNonZero(name, tries = 12) {
  for (let i = 0; i < tries; i++) {
    const v = await read(name)
    if (v > 0n) return v
    await sleep(5000)
  }
  return 0n
}

async function cycle() {
  log('--- cycle start ---')
  // 1. harvest fees -> HYPE on Core
  await send('harvest')
  let coreHype = await waitNonZero('coreHype')
  log('coreHype (8dec):', coreHype.toString())

  // 2. sell HYPE -> USDC
  const hype = Number(coreHype) / 1e8
  if (hype >= MIN_HYPE_SELL) {
    const { bid } = await bestBidAsk(HYPE_USDC_COIN)
    if (bid) {
      const sz = Math.floor(hype * 100) / 100 // floor to 0.01 lot
      const px = (bid * (1 - SLIPPAGE)).toFixed(4) // aggressive sell limit (fills at bid)
      log(`sell ${sz} HYPE @limit ${px} (bid ${bid})`)
      await send('sellHypeForUsdc', [BigInt(Math.round(Number(px) * 1e8)), BigInt(Math.round(sz * 1e8))])
      await waitNonZero('coreUsdc')
    } else log('HYPE/USDC book empty, skip sell')
  } else log(`coreHype ${hype} < min ${MIN_HYPE_SELL}, skip sell`)

  // 3. buy SPCXD with USDC
  const usdc = Number(await read('coreUsdc')) / 1e8
  log('coreUsdc:', usdc)
  if (usdc >= MIN_USDC_BUY) {
    const { ask } = await bestBidAsk(SPCXD_USDC_COIN)
    if (ask) {
      const pxLimit = ask * (1 + SLIPPAGE)
      const maxSz = Math.floor((usdc / pxLimit) * 100) / 100 // floor to 0.01 lot, fits USDC
      if (maxSz >= SPCXD_LOT) {
        log(`buy ${maxSz} SPCXD @limit ${pxLimit.toFixed(2)} (ask ${ask})`)
        await send('buySpcxd', [BigInt(Math.round(pxLimit * 1e8)), BigInt(Math.round(maxSz * 1e8))])
        await waitNonZero('coreSpcxd')
      } else log(`USDC ${usdc} buys < 1 lot, skip buy`)
    } else log('SPCXD/USDC book empty (market closed?), skip buy — USDC queues for next cycle')
  } else log(`coreUsdc ${usdc} < min ${MIN_USDC_BUY}, queue for next cycle`)

  // 4. deliver SPCXD -> token -> book to holders
  const spcxd = await read('coreSpcxd')
  if (spcxd > 0n) {
    log('deliver', spcxd.toString(), 'SPCXD (8dec) to holders')
    await send('deliverToToken')
  } else log('no SPCXD to deliver this cycle')
  log('--- cycle end ---')
}

async function main() {
  log(`keeper started for manager ${MANAGER} as ${account.address} (${ONCE ? 'once' : `every ${INTERVAL / 1000}s`})`)
  do {
    try { await cycle() } catch (e) { log('cycle error:', e.shortMessage || e.message) }
    if (!ONCE) await sleep(INTERVAL)
  } while (!ONCE)
}
main()
