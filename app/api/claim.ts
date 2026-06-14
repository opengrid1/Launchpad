// Claim X-handle-escrowed fees. Verifies (via Privy) that `wallet` owns the X `handle`,
// then for each token escrowed under that handle the relayer collects pool fees and submits
// `claimHandleFees` with an owner-signed attestation, releasing the escrow to `wallet`.
import {
  createWalletClient,
  createPublicClient,
  http,
  defineChain,
  parseAbi,
  isAddress,
  keccak256,
  toBytes,
  encodeAbiParameters,
  getAddress,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { PrivyClient } from '@privy-io/server-auth'

const hyperevm = defineChain({
  id: 999,
  name: 'HyperEVM',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.hyperliquid.xyz/evm'] } },
})

const LAUNCHPAD = '0x5c5b34727f6ce57AB4a16432d4dFfBD49C5C9C13' as const
const abi = parseAbi([
  'function allTokensLength() view returns (uint256)',
  'function allTokens(uint256) view returns (address)',
  'function launches(address) view returns (address creator, uint64 createdAt, bool tokenIsToken0, bool positionWithdrawn, bool feeRecipientLocked, address feeRecipient, address pool, uint256 positionId, bytes32 feeHandle)',
  'function collectFees(address token) returns (uint256 hypeAmount, uint256 tokenAmount)',
  'function claimHandleFees(address token, address to, uint256 deadline, bytes signature)',
])

let cached: PrivyClient | null = null
function privy(): PrivyClient {
  if (!cached) {
    const id = process.env.PRIVY_APP_ID
    const secret = process.env.PRIVY_APP_SECRET
    if (!id || !secret) throw new Error('Privy not configured')
    cached = new PrivyClient(id, secret)
  }
  return cached
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    const handle = String(body.handle || '').replace(/^@/, '').trim()
    const wallet = String(body.wallet || '')
    if (!handle || !isAddress(wallet)) return res.status(400).json({ error: 'Missing handle/wallet' })

    // Ownership check: the X handle must resolve (via Privy) to this exact wallet.
    let user = null
    try {
      user = await privy().getUserByTwitterUsername(handle)
    } catch {
      user = null
    }
    const owned = user?.wallet?.address
    if (!owned || getAddress(owned) !== getAddress(wallet)) {
      return res.status(401).json({ error: 'That wallet does not own this X handle' })
    }

    const pk = process.env.RELAYER_PRIVATE_KEY
    if (!pk) return res.status(500).json({ error: 'Relayer not configured' })
    const account = privateKeyToAccount((pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`)
    const walletClient = createWalletClient({ account, chain: hyperevm, transport: http() })
    const pub = createPublicClient({ chain: hyperevm, transport: http() })

    const feeHandle = keccak256(toBytes(handle.toLowerCase()))

    // Find tokens escrowed under this handle.
    const len = Number(await pub.readContract({ address: LAUNCHPAD, abi, functionName: 'allTokensLength' }))
    const tokens: `0x${string}`[] = []
    for (let i = 0; i < len && tokens.length < 25; i++) {
      const token = (await pub.readContract({ address: LAUNCHPAD, abi, functionName: 'allTokens', args: [BigInt(i)] })) as `0x${string}`
      const launch = await pub.readContract({ address: LAUNCHPAD, abi, functionName: 'launches', args: [token] })
      if ((launch[8] as string).toLowerCase() === feeHandle.toLowerCase()) tokens.push(token)
    }
    if (tokens.length === 0) return res.status(200).json({ claimed: [], message: 'No escrowed fees for this handle' })

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
    let nonce = await pub.getTransactionCount({ address: account.address, blockTag: 'pending' })
    const claimed: { token: string; hash: string }[] = []

    for (const token of tokens) {
      // Realise any pending pool fees into the escrow (nonce n), then claim (nonce n+1).
      await walletClient.writeContract({ address: LAUNCHPAD, abi, functionName: 'collectFees', args: [token], gas: 3_000_000n, nonce })
      nonce++

      const inner = keccak256(
        encodeAbiParameters(
          [{ type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }],
          [feeHandle, getAddress(wallet), deadline, token, LAUNCHPAD, 999n],
        ),
      )
      const signature = await account.signMessage({ message: { raw: inner } })
      const hash = await walletClient.writeContract({
        address: LAUNCHPAD,
        abi,
        functionName: 'claimHandleFees',
        args: [token, getAddress(wallet), deadline, signature],
        gas: 1_500_000n,
        nonce,
      })
      nonce++
      claimed.push({ token, hash })
    }

    return res.status(200).json({ claimed })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
}
