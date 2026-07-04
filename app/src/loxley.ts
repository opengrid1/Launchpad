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
