// Loxley web3 integration — wired to the LIVE LoxleyLaunchpad on
// Robinhood Chain mainnet (chainId 4663). TypeScript port of the deployment
// module, plus a mapper to the UI's `Launch` shape.
import { ethers } from 'ethers'
import type { Launch } from './data/launches'

// ---- chain + contracts ---------------------------------------------------
export const CHAIN = {
  id: 4663,
  idHex: '0x1237',
  name: 'Robinhood Chain',
  rpc: 'https://rpc.mainnet.chain.robinhood.com',
  explorer: 'https://explorer.mainnet.chain.robinhood.com',
  symbol: 'ETH',
}

export const LAUNCHPAD = '0xeae2b170c9c0a765887c285808e32d4eec3c4687'
export const POOL_MANAGER = '0x8366a39CC670B4001A1121B8F6A443A643e40951'
export const UNIVERSAL_ROUTER = '0x8876789976DEcBFcBBBE364623C63652dB8C0904'

export const LAUNCHPAD_ABI = [
  'function createToken(string name, string symbol, uint256 totalSupply, address creator, uint256 minDevBuyTokens, (string image, string description, string twitter, string telegram, string website) meta) payable returns (address)',
  'function collectFees(address token)',
  'function claimCreatorFees(address token)',
  'function getPrice(address token) view returns (uint256)',
  'function ethUsdPrice() view returns (uint256)',
  'function allTokens(uint256) view returns (address)',
  'function allTokensLength() view returns (uint256)',
  'function creatorFeesOf(address token) view returns (uint256)',
  'function startingMarketCapUsd6() view returns (uint256)',
  'function owner() view returns (address)',
  'event TokenLaunched(address indexed token, address indexed creator, string name, string symbol, uint256 totalSupply, uint256 priceWeiPerToken, uint256 devBuyEth, uint256 devBuyTokens)',
  'event TokenMetadata(address indexed token, string image, string description, string twitter, string telegram, string website)',
]

export const TOKEN_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function tokenURI() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
  'function withdrawableEth(address) view returns (uint256)',
  'function claimEth() returns (uint256)',
  'function approve(address,uint256) returns (bool)',
]

// ---- providers / wallet --------------------------------------------------
type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> }
const eth = (): Eip1193 | undefined => (window as unknown as { ethereum?: Eip1193 }).ethereum

export function readProvider() {
  return new ethers.JsonRpcProvider(CHAIN.rpc, CHAIN.id)
}

export async function connectWallet(): Promise<{ account: string; signer: ethers.Signer }> {
  const provider = eth()
  if (!provider) throw new Error('No wallet found. Install a Robinhood Chain-compatible wallet.')
  const cid = (await provider.request({ method: 'eth_chainId' })) as string
  if (cid !== CHAIN.idHex) {
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN.idHex }] })
    } catch {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: CHAIN.idHex, chainName: CHAIN.name,
          nativeCurrency: { name: CHAIN.symbol, symbol: CHAIN.symbol, decimals: 18 },
          rpcUrls: [CHAIN.rpc], blockExplorerUrls: [CHAIN.explorer],
        }],
      })
    }
  }
  const [account] = (await provider.request({ method: 'eth_requestAccounts' })) as string[]
  const signer = await new ethers.BrowserProvider(provider as ethers.Eip1193Provider).getSigner()
  return { account, signer }
}

export function launchpad(runner: ethers.ContractRunner) {
  return new ethers.Contract(LAUNCHPAD, LAUNCHPAD_ABI, runner)
}
export function token(addr: string, runner: ethers.ContractRunner) {
  return new ethers.Contract(addr, TOKEN_ABI, runner)
}

// ---- reads ---------------------------------------------------------------
export async function ethUsd(): Promise<number> {
  const p = await launchpad(readProvider()).ethUsdPrice()
  return Number(p) / 1e6
}

export async function priceWei(tokenAddr: string): Promise<bigint> {
  return launchpad(readProvider()).getPrice(tokenAddr)
}

export async function claimableEth(tokenAddr: string, account: string): Promise<number> {
  const w = await token(tokenAddr, readProvider()).withdrawableEth(account)
  return Number(w) / 1e18
}

/** ETH fees currently owed to a token's creator. */
export async function creatorFees(tokenAddr: string): Promise<number> {
  const w = await launchpad(readProvider()).creatorFeesOf(tokenAddr)
  return Number(w) / 1e18
}

export interface OnchainLaunch {
  token: string
  creator: string
  name: string
  symbol: string
  totalSupply: bigint
  priceWeiPerToken: bigint
  devBuyEth: bigint
  devBuyTokens: bigint
  block: number
  image?: string
  description?: string
  twitter?: string
  telegram?: string
  website?: string
}

/** All launches joined with their metadata event. Newest first. */
export async function fetchLaunches(fromBlock = 0): Promise<OnchainLaunch[]> {
  const prov = readProvider()
  const pad = launchpad(prov)
  const [launched, meta] = await Promise.all([
    pad.queryFilter(pad.filters.TokenLaunched(), fromBlock),
    pad.queryFilter(pad.filters.TokenMetadata(), fromBlock),
  ])
  const metaByToken: Record<string, Partial<OnchainLaunch>> = {}
  for (const m of meta as ethers.EventLog[]) {
    metaByToken[(m.args.token as string).toLowerCase()] = {
      image: m.args.image, description: m.args.description,
      twitter: m.args.twitter, telegram: m.args.telegram, website: m.args.website,
    }
  }
  return (launched as ethers.EventLog[])
    .map((e) => ({
      token: e.args.token,
      creator: e.args.creator,
      name: e.args.name,
      symbol: e.args.symbol,
      totalSupply: e.args.totalSupply,
      priceWeiPerToken: e.args.priceWeiPerToken,
      devBuyEth: e.args.devBuyEth,
      devBuyTokens: e.args.devBuyTokens,
      block: e.blockNumber,
      ...(metaByToken[(e.args.token as string).toLowerCase()] || {}),
    }))
    .sort((a, b) => b.block - a.block)
}

// ---- real price history (from Uniswap v4 PoolManager events) -------------
const POOL_MANAGER_ABI = [
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)',
  'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)',
]

/** sqrtPriceX96 (token=currency1 per ETH=currency0) → ETH per 1 token. */
function sqrtToEthPerToken(sqrtPriceX96: bigint): number {
  const r = Number(2n ** 96n) / Number(sqrtPriceX96) // = 2^96 / sqrtP
  return r * r // (2^96/sqrtP)^2 = 1 / (tokens per ETH) = ETH per token
}

const poolCache: Record<string, { id: string; initBlock: number; initSqrt: bigint } | null> = {}

async function poolInfo(tokenAddr: string) {
  const key = tokenAddr.toLowerCase()
  if (key in poolCache) return poolCache[key]
  const pm = new ethers.Contract(POOL_MANAGER, POOL_MANAGER_ABI, readProvider())
  const inits = (await pm.queryFilter(pm.filters.Initialize(null, null, tokenAddr), 0)) as ethers.EventLog[]
  const info = inits[0]
    ? { id: inits[0].args.id as string, initBlock: inits[0].blockNumber, initSqrt: inits[0].args.sqrtPriceX96 as bigint }
    : null
  poolCache[key] = info
  return info
}

/** Real USD market-cap series for a token, reconstructed from v4 Swap events
 *  (plus the pool's launch price). Oldest → newest. */
export async function fetchMcapSeries(tokenAddr: string, supplyTokens: number, ethUsdPrice: number): Promise<number[]> {
  const info = await poolInfo(tokenAddr)
  if (!info) return []
  const pm = new ethers.Contract(POOL_MANAGER, POOL_MANAGER_ABI, readProvider())
  const swaps = (await pm.queryFilter(pm.filters.Swap(info.id), info.initBlock)) as ethers.EventLog[]
  const mcap = (sqrt: bigint) => sqrtToEthPerToken(sqrt) * supplyTokens * ethUsdPrice
  const series = [mcap(info.initSqrt)] // launch price as the first point
  for (const s of swaps) series.push(mcap(s.args.sqrtPriceX96 as bigint))
  return series
}

export interface PoolTrade {
  id: number
  side: 'buy' | 'sell'
  who: string
  amount: string
  when: number
}
export interface PoolActivity {
  series: number[] // USD market cap over time (oldest → newest)
  trades: PoolTrade[] // newest first
  volumeEth: number // total ETH traded
  changePct: number // first → last of the series
  holders: number
}

const INFRA = new Set([POOL_MANAGER.toLowerCase(), LAUNCHPAD.toLowerCase(), ethers.ZeroAddress.toLowerCase()])

/** Everything the detail page needs, reconstructed from real on-chain events:
 *  the price series, the trade tape, volume, 24h-style change, and holder count. */
export async function fetchPoolActivity(tokenAddr: string, supplyTokens: number, ethUsdPrice: number): Promise<PoolActivity> {
  const empty: PoolActivity = { series: [], trades: [], volumeEth: 0, changePct: 0, holders: 0 }
  const info = await poolInfo(tokenAddr)
  if (!info) return empty
  const prov = readProvider()
  const pm = new ethers.Contract(POOL_MANAGER, POOL_MANAGER_ABI, prov)
  const tok = new ethers.Contract(tokenAddr, ['event Transfer(address indexed from, address indexed to, uint256 value)'], prov)

  const [swaps, xfers] = await Promise.all([
    pm.queryFilter(pm.filters.Swap(info.id), info.initBlock) as Promise<ethers.EventLog[]>,
    tok.queryFilter(tok.filters.Transfer(), 0) as Promise<ethers.EventLog[]>,
  ])

  // block timestamps (dedup)
  const blocks = [...new Set(swaps.map((s) => s.blockNumber))]
  const tsByBlock: Record<number, number> = {}
  await Promise.all(blocks.map(async (b) => { tsByBlock[b] = (await prov.getBlock(b))?.timestamp ?? 0 }))

  const mcap = (sqrt: bigint) => sqrtToEthPerToken(sqrt) * supplyTokens * ethUsdPrice
  const series = [mcap(info.initSqrt)]
  const trades: PoolTrade[] = []
  let volumeEth = 0
  let id = 0
  for (const s of swaps) {
    const a0 = s.args.amount0 as bigint // trader's ETH delta: negative = ETH spent = buy
    const ethAbs = Number(ethers.formatEther(a0 < 0n ? -a0 : a0))
    volumeEth += ethAbs
    series.push(mcap(s.args.sqrtPriceX96 as bigint))
    trades.push({
      id: ++id,
      side: a0 < 0n ? 'buy' : 'sell',
      who: short(s.args.sender as string),
      amount: `${ethAbs < 0.001 ? ethAbs.toExponential(1) : ethAbs.toFixed(ethAbs < 0.1 ? 4 : 3)} ETH`,
      when: (tsByBlock[s.blockNumber] || 0) * 1000,
    })
  }
  trades.reverse() // newest first

  // holders: net balances from Transfer events, excluding infra addresses
  const bal: Record<string, bigint> = {}
  for (const e of xfers) {
    const from = (e.args.from as string).toLowerCase()
    const to = (e.args.to as string).toLowerCase()
    const v = e.args.value as bigint
    if (from !== ethers.ZeroAddress) bal[from] = (bal[from] || 0n) - v
    bal[to] = (bal[to] || 0n) + v
  }
  const holders = Object.entries(bal).filter(([a, v]) => v > 0n && !INFRA.has(a)).length

  const changePct = series.length >= 2 ? ((series[series.length - 1] - series[0]) / series[0]) * 100 : 0
  return { series, trades, volumeEth, changePct, holders }
}

// ---- writes --------------------------------------------------------------
export async function createToken(
  signer: ethers.Signer,
  args: { name: string; symbol: string; supply: number | string; creator?: string; meta: { image?: string; description?: string; twitter?: string; telegram?: string; website?: string }; devBuyEth?: string; minDevBuyTokens?: bigint },
): Promise<{ hash: string; token: string | null }> {
  const pad = launchpad(signer)
  const totalSupply = ethers.parseUnits(String(args.supply), 18)
  const value = ethers.parseEther(String(args.devBuyEth ?? '0'))
  const m = [args.meta.image || '', args.meta.description || '', args.meta.twitter || '', args.meta.telegram || '', args.meta.website || '']
  const tx = await pad.createToken(args.name, args.symbol, totalSupply, args.creator || ethers.ZeroAddress, args.minDevBuyTokens ?? 0n, m, { value })
  const rcpt = await tx.wait()
  const ev = rcpt.logs
    .map((l: ethers.Log) => { try { return pad.interface.parseLog(l) } catch { return null } })
    .find((x: ethers.LogDescription | null) => x && x.name === 'TokenLaunched')
  return { hash: tx.hash, token: ev ? ev.args.token : null }
}

/** Anyone can poke fee collection (routes 50% holders / 50% creator). */
export async function collectFees(signer: ethers.Signer, tokenAddr: string) {
  return (await launchpad(signer).collectFees(tokenAddr)).wait()
}
/** Creator claims their 50% (native ETH). */
export async function claimCreatorFees(signer: ethers.Signer, tokenAddr: string) {
  return (await launchpad(signer).claimCreatorFees(tokenAddr)).wait()
}
/** Holder claims their ETH dividends. */
export async function claimEthDividends(signer: ethers.Signer, tokenAddr: string) {
  return (await token(tokenAddr, signer).claimEth()).wait()
}

// ---- mapping to the UI's Launch shape ------------------------------------
function idFromAddress(addr: string): number {
  let h = 0
  for (const c of addr.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % 2_000_000_000
}

function ago(blockNow: number, blockThen: number): string {
  // Robinhood Chain ~2s blocks; rough age for display.
  const secs = Math.max(0, (blockNow - blockThen) * 2)
  if (secs < 90) return 'just now'
  const m = Math.round(secs / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

/** Convert an on-chain launch (+ its current price) into a UI Launch. */
export function toLaunch(o: OnchainLaunch, currentPriceWei: bigint, blockNow: number): Launch {
  const supply = Number(ethers.formatUnits(o.totalSupply, 18))
  const priceEth = Number(ethers.formatEther(currentPriceWei || o.priceWeiPerToken))
  const img = o.image && o.image.startsWith('ipfs://') ? o.image.replace('ipfs://', 'https://ipfs.io/ipfs/') : o.image
  return {
    id: idFromAddress(o.token),
    name: o.name,
    symbol: o.symbol,
    glyph: '',
    image: img || undefined,
    tagline: o.description ? o.description.slice(0, 90) : `${o.name} on Loxley.`,
    description: o.description || undefined,
    tokenAddress: o.token,
    devBuy: Number(ethers.formatEther(o.devBuyEth)) || undefined,
    socials: (o.twitter || o.telegram || o.website)
      ? { x: o.twitter || undefined, telegram: o.telegram || undefined, website: o.website || undefined }
      : undefined,
    priceEth,
    tokensForSale: 0,
    tokensForLiquidity: supply,
    liquidityBps: 10_000,
    tradeFeeBps: 100,
    volume: 0,
    rewardsPaid: 0,
    holders: 0,
    createdAgo: ago(blockNow, o.block),
    buyers: 0,
    status: 'live',
    creator: short(o.creator),
    yourTokens: 0,
    yourHolderRewards: 0,
    yourRebate: 0,
  }
}
