// Bridge HYPE from HyperCore spot -> HyperEVM (native) via a spotSend to the HYPE system address.
// Usage: PRIVATE_KEY=0x... node scripts/bridgeCoreToEvm.mjs <amountHype>
import { privateKeyToAccount } from 'viem/accounts'

const HL_EXCHANGE = 'https://api.hyperliquid.xyz/exchange'
const HYPE_SYSTEM = '0x2222222222222222222222222222222222222222'
const HYPE_TOKEN = 'HYPE:0x0d01dc56dcaaca66ad901c959b4011ec'
const SIG_CHAIN_ID = '0xa4b1' // signatureChainId for mainnet user-signed actions

const amount = process.argv[2]
if (!amount) throw new Error('amount (HYPE) arg required')
const pk = process.env.PRIVATE_KEY
if (!pk) throw new Error('PRIVATE_KEY env required')
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`)

const time = Date.now()
const action = {
  type: 'spotSend',
  hyperliquidChain: 'Mainnet',
  signatureChainId: SIG_CHAIN_ID,
  destination: HYPE_SYSTEM,
  token: HYPE_TOKEN,
  amount: String(amount),
  time,
}

const signature = await account.signTypedData({
  domain: {
    name: 'HyperliquidSignTransaction',
    version: '1',
    chainId: Number(SIG_CHAIN_ID),
    verifyingContract: '0x0000000000000000000000000000000000000000',
  },
  types: {
    'HyperliquidTransaction:SpotSend': [
      { name: 'hyperliquidChain', type: 'string' },
      { name: 'destination', type: 'string' },
      { name: 'token', type: 'string' },
      { name: 'amount', type: 'string' },
      { name: 'time', type: 'uint64' },
    ],
  },
  primaryType: 'HyperliquidTransaction:SpotSend',
  message: {
    hyperliquidChain: 'Mainnet',
    destination: HYPE_SYSTEM,
    token: HYPE_TOKEN,
    amount: String(amount),
    time,
  },
})

// split signature into r,s,v
const r = signature.slice(0, 66)
const s = '0x' + signature.slice(66, 130)
const v = parseInt(signature.slice(130, 132), 16)

const res = await fetch(HL_EXCHANGE, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action, nonce: time, signature: { r, s, v }, vaultAddress: null }),
})
const body = await res.json().catch(() => null)
console.log(account.address, '-> bridge', amount, 'HYPE Core->EVM |', JSON.stringify(body))
if (!res.ok || body?.status !== 'ok') process.exit(1)
