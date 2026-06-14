import { parseAbi } from 'viem'

/** Launchpad deployment on HyperEVM mainnet (chain id 999). V2 — fee recipient separable from creator. */
export const LAUNCHPAD = '0x94dE40B87aB2998B2924d61cCD17b19056E1868A' as const

/** HyperSwap V3 periphery, verified on-chain. */
export const SWAP_ROUTER = '0x4E2960a8cd19B467b82d26D83fAcb0fAE26b094D' as const
export const WHYPE = '0x5555555555555555555555555555555555555555' as const

/** Pool fee tier every launch uses (1%). */
export const POOL_FEE = 10_000

export const launchpadAbi = parseAbi([
  'function allTokensLength() view returns (uint256)',
  'function allTokens(uint256) view returns (address)',
  'function tokensByCreator(address) view returns (address[])',
  'function launches(address) view returns (address creator, uint64 createdAt, bool tokenIsToken0, bool positionWithdrawn, bool feeRecipientLocked, address feeRecipient, address pool, uint256 positionId)',
  'function getPrice(address) view returns (uint256)',
  'function getMarketCap(address) view returns (uint256)',
  'function getMarketCapUsd(address) view returns (uint256)',
  'function hypeUsdPrice() view returns (uint256)',
  'function startingMarketCapUsd6() view returns (uint256)',
  'function lifetimeFeesHype(address) view returns (uint256)',
  'function lifetimeFeesToken(address) view returns (uint256)',
  'function creatorFeesHype(address) view returns (uint256)',
  'function creatorFeesToken(address) view returns (uint256)',
  'function collectFees(address token) returns (uint256 hypeAmount, uint256 tokenAmount)',
  'function claimCreatorFees(address token)',
  'function setFeeRecipient(address token, address newRecipient)',
  'function transferCreator(address token, address newCreator)',
  'function createToken(string name, string symbol, string tokenURI, uint256 totalSupply, address creator, address feeRecipient, uint256 devBuyWhype, uint256 minDevBuyTokens) payable returns (address token)',
  'event TokenLaunched(address indexed token, address indexed creator, address pool, uint256 positionId, string name, string symbol, string tokenURI, uint256 totalSupply, uint256 priceWeiPerToken, uint256 devBuyHype, uint256 devBuyTokens)',
  'event FeesCollected(address indexed token, uint256 hypeAmount, uint256 tokenAmount)',
  'event FeeRecipientSet(address indexed token, address indexed recipient)',
])

export const launchTokenAbi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function tokenURI() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
])

export const swapRouterAbi = parseAbi([
  'struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }',
  'function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)',
  'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
  'function multicall(bytes[] data) payable returns (bytes[] results)',
])
