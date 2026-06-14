// Relayer launch endpoint. The platform relayer wallet (RELAYER_PRIVATE_KEY, kept in
// HyperEVM big-block mode) submits `createToken` on a user's behalf, so launchers need
// no big blocks and no gas. The user proves intent with a gasless signature over the
// launch params; we verify it, then broadcast and return the tx hash (the client waits
// for the receipt — big blocks can take ~1 min, longer than a serverless timeout).
import { createWalletClient, http, defineChain, verifyMessage, parseAbi, isAddress, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const hyperevm = defineChain({
  id: 999,
  name: 'HyperEVM',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.hyperliquid.xyz/evm'] } },
})

const LAUNCHPAD = '0x5c5b34727f6ce57AB4a16432d4dFfBD49C5C9C13'
const SUPPLY = parseEther('1000000000')
const ZERO = '0x0000000000000000000000000000000000000000'
const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000'
const abi = parseAbi([
  'function createToken(string name, string symbol, string tokenURI, uint256 totalSupply, address creator, address feeRecipient, bytes32 feeHandle, uint256 devBuyWhype, uint256 minDevBuyTokens) payable returns (address token)',
])

/** Message the creator signs to authorize a relayed launch (must match the client). */
function launchMessage(p: { name: string; symbol: string; creator: string; feeRecipient: string; feeHandle: string; nonce: number }) {
  return `Hyprpad launch\nname: ${p.name}\nsymbol: ${p.symbol}\ncreator: ${p.creator}\nfeeRecipient: ${p.feeRecipient}\nfeeHandle: ${p.feeHandle}\nnonce: ${p.nonce}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    const { name, symbol, tokenURI, creator, feeRecipient, feeHandle, nonce, signature } = body

    if (!name || !symbol || !tokenURI || !signature || typeof nonce !== 'number') {
      return res.status(400).json({ error: 'Missing fields' })
    }
    if (!isAddress(creator)) return res.status(400).json({ error: 'Invalid creator' })
    const fr: string = feeRecipient && isAddress(feeRecipient) ? feeRecipient : ZERO
    const fh: string = typeof feeHandle === 'string' && /^0x[0-9a-fA-F]{64}$/.test(feeHandle) ? feeHandle : ZERO_HASH

    // Replay guard: signature must be fresh (±10 min).
    if (Math.abs(Date.now() - nonce) > 10 * 60 * 1000) return res.status(400).json({ error: 'Stale request — try again' })

    // The creator must have signed these exact params (gasless proof of intent).
    const valid = await verifyMessage({
      address: creator,
      message: launchMessage({ name, symbol, creator, feeRecipient: fr, feeHandle: fh, nonce }),
      signature,
    })
    if (!valid) return res.status(401).json({ error: 'Bad signature' })

    const pk = process.env.RELAYER_PRIVATE_KEY
    if (!pk) return res.status(500).json({ error: 'Relayer not configured' })
    const account = privateKeyToAccount((pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`)
    const wallet = createWalletClient({ account, chain: hyperevm, transport: http() })

    const hash = await wallet.writeContract({
      address: LAUNCHPAD,
      abi,
      functionName: 'createToken',
      args: [String(name).slice(0, 48), String(symbol).slice(0, 12).toUpperCase(), String(tokenURI), SUPPLY, creator, fr, fh as `0x${string}`, 0n, 0n],
      gas: 24_000_000n,
    })

    return res.status(200).json({ hash })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
}
