import { decodeFunctionResult, encodeFunctionData, zeroAddress, type Address } from 'viem'
import { publicClient } from './chain'
import { LAUNCHPAD, POOL_FEE, SWAP_ROUTER, WHYPE, launchTokenAbi, launchpadAbi, swapRouterAbi } from './contracts'

export type LaunchRow = {
  token: Address
  creator: Address
  createdAt: number
  pool: Address
  positionWithdrawn: boolean
  name: string
  symbol: string
  totalSupply: bigint
  tokenURI: string
  marketCapUsd6: bigint
  lifetimeFeesHype: bigint
}

export type TokenDetail = LaunchRow & {
  priceWei: bigint
  marketCapHype: bigint
  startMcUsd6: bigint
  liquidityHype: bigint
  lifetimeFeesToken: bigint
  creatorFeesHype: bigint
  creatorFeesToken: bigint
  hypeUsd6: bigint
  pendingFeesHype: bigint
  pendingFeesToken: bigint
}

const launchpad = { address: LAUNCHPAD, abi: launchpadAbi } as const

export async function fetchTokenCount(): Promise<number> {
  return Number(await publicClient.readContract({ ...launchpad, functionName: 'allTokensLength' }))
}

/** Board data, newest first. Multicall-batched: 2 round trips regardless of size. */
export async function fetchLaunches(max = 200): Promise<LaunchRow[]> {
  const count = await fetchTokenCount()
  if (count === 0) return []
  const indexes = Array.from({ length: Math.min(count, max) }, (_, i) => BigInt(count - 1 - i))

  const tokens = (await Promise.all(
    indexes.map((i) => publicClient.readContract({ ...launchpad, functionName: 'allTokens', args: [i] })),
  )) as Address[]

  const rows = await Promise.all(tokens.map((token) => fetchLaunchRow(token)))
  return rows
}

export async function fetchLaunchRow(token: Address): Promise<LaunchRow> {
  const erc20 = { address: token, abi: launchTokenAbi } as const
  const [launch, name, symbol, totalSupply, tokenURI, marketCapUsd6, lifetimeFeesHype] = await Promise.all([
    publicClient.readContract({ ...launchpad, functionName: 'launches', args: [token] }),
    publicClient.readContract({ ...erc20, functionName: 'name' }),
    publicClient.readContract({ ...erc20, functionName: 'symbol' }),
    publicClient.readContract({ ...erc20, functionName: 'totalSupply' }),
    publicClient.readContract({ ...erc20, functionName: 'tokenURI' }),
    publicClient.readContract({ ...launchpad, functionName: 'getMarketCapUsd', args: [token] }),
    publicClient.readContract({ ...launchpad, functionName: 'lifetimeFeesHype', args: [token] }),
  ])
  const [creator, createdAt, , positionWithdrawn, pool] = launch
  return {
    token,
    creator,
    createdAt: Number(createdAt),
    pool,
    positionWithdrawn,
    name,
    symbol,
    totalSupply,
    tokenURI,
    marketCapUsd6,
    lifetimeFeesHype,
  }
}

export async function fetchTokenDetail(token: Address): Promise<TokenDetail> {
  const [row, priceWei, marketCapHype, startMcUsd6, lifetimeFeesToken, creatorFeesHype, creatorFeesToken, hypeUsd6, pending] =
    await Promise.all([
      fetchLaunchRow(token),
      publicClient.readContract({ ...launchpad, functionName: 'getPrice', args: [token] }),
      publicClient.readContract({ ...launchpad, functionName: 'getMarketCap', args: [token] }),
      publicClient.readContract({ ...launchpad, functionName: 'startingMarketCapUsd6' }),
      publicClient.readContract({ ...launchpad, functionName: 'lifetimeFeesToken', args: [token] }),
      publicClient.readContract({ ...launchpad, functionName: 'creatorFeesHype', args: [token] }),
      publicClient.readContract({ ...launchpad, functionName: 'creatorFeesToken', args: [token] }),
      publicClient.readContract({ ...launchpad, functionName: 'hypeUsdPrice' }),
      fetchPendingFees(token),
    ])

  // Real liquidity = the HYPE actually sitting in the pool (money paid in that backs
  // sells). The token side is ~the entire supply for a single-sided launch, so valuing
  // it would just restate the FDV — not a useful "liquidity" number.
  const liquidityHype = await publicClient.readContract({
    address: WHYPE,
    abi: launchTokenAbi,
    functionName: 'balanceOf',
    args: [row.pool],
  })

  return {
    ...row,
    priceWei,
    marketCapHype,
    startMcUsd6,
    liquidityHype,
    lifetimeFeesToken,
    creatorFeesHype,
    creatorFeesToken,
    hypeUsd6,
    pendingFeesHype: pending.hype,
    pendingFeesToken: pending.token,
  }
}

/** Uncollected position fees, read by simulating collectFees (no state change). */
export async function fetchPendingFees(token: Address): Promise<{ hype: bigint; token: bigint }> {
  try {
    const { result } = await publicClient.simulateContract({
      ...launchpad,
      functionName: 'collectFees',
      args: [token],
    })
    return { hype: result[0], token: result[1] }
  } catch {
    return { hype: 0n, token: 0n }
  }
}

const DEADLINE_SLACK = 600n

function deadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000)) + DEADLINE_SLACK
}

/** Quote HYPE -> token by simulating the router (uses a balance override so it works disconnected). */
export async function quoteBuy(token: Address, hypeIn: bigint, from?: Address): Promise<bigint> {
  const account = from ?? zeroAddress
  const { result } = await publicClient.simulateContract({
    address: SWAP_ROUTER,
    abi: swapRouterAbi,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn: WHYPE,
        tokenOut: token,
        fee: POOL_FEE,
        recipient: account,
        deadline: deadline(),
        amountIn: hypeIn,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      },
    ],
    value: hypeIn,
    account,
    stateOverride: [{ address: account, balance: hypeIn * 2n + 10n ** 18n }],
  })
  return result
}

/** Quote token -> HYPE. Requires the seller to have approved the router (simulated from their account). */
export async function quoteSell(token: Address, tokenIn: bigint, from: Address): Promise<bigint> {
  const { result } = await publicClient.simulateContract({
    address: SWAP_ROUTER,
    abi: swapRouterAbi,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn: token,
        tokenOut: WHYPE,
        fee: POOL_FEE,
        recipient: SWAP_ROUTER,
        deadline: deadline(),
        amountIn: tokenIn,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      },
    ],
    account: from,
  })
  return result
}

/** Calldata for a sell: swap to WHYPE held by the router, then unwrap to native HYPE. */
export function sellCalldata(token: Address, tokenIn: bigint, minHypeOut: bigint, recipient: Address): `0x${string}`[] {
  const swap = encodeFunctionData({
    abi: swapRouterAbi,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn: token,
        tokenOut: WHYPE,
        fee: POOL_FEE,
        recipient: SWAP_ROUTER,
        deadline: deadline(),
        amountIn: tokenIn,
        amountOutMinimum: minHypeOut,
        sqrtPriceLimitX96: 0n,
      },
    ],
  })
  const unwrap = encodeFunctionData({
    abi: swapRouterAbi,
    functionName: 'unwrapWETH9',
    args: [minHypeOut, recipient],
  })
  return [swap, unwrap]
}

export function decodeSwapResult(data: `0x${string}`): bigint {
  return decodeFunctionResult({ abi: swapRouterAbi, functionName: 'exactInputSingle', data }) as bigint
}

/** Apply basis-point slippage to a quote. */
export function withSlippage(amount: bigint, slippageBps: number): bigint {
  return (amount * BigInt(10_000 - slippageBps)) / 10_000n
}
