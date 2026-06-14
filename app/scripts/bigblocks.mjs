// Flip a wallet between HyperEVM small/big blocks via the HyperCore evmUserModify L1 action.
// Usage: PRIVATE_KEY=0x... node scripts/bigblocks.mjs <true|false>
import { encode as msgpackEncode } from '@msgpack/msgpack'
import { keccak256, parseSignature } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const HL_EXCHANGE = 'https://api.hyperliquid.xyz/exchange'

function l1ActionHash(action, nonce) {
  const packed = msgpackEncode(action, { sortKeys: false })
  const data = new Uint8Array(packed.length + 9)
  data.set(packed, 0)
  new DataView(data.buffer).setBigUint64(packed.length, BigInt(nonce), false)
  data[packed.length + 8] = 0
  return keccak256(data)
}

const usingBigBlocks = process.argv[2] !== 'false'
const pk = process.env.PRIVATE_KEY
if (!pk) throw new Error('PRIVATE_KEY env required')
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`)

const action = { type: 'evmUserModify', usingBigBlocks }
const nonce = Date.now()

const signature = parseSignature(
  await account.signTypedData({
    domain: { name: 'Exchange', version: '1', chainId: 1337, verifyingContract: '0x0000000000000000000000000000000000000000' },
    types: {
      Agent: [
        { name: 'source', type: 'string' },
        { name: 'connectionId', type: 'bytes32' },
      ],
    },
    primaryType: 'Agent',
    message: { source: 'a', connectionId: l1ActionHash(action, nonce) },
  }),
)
const sig = { r: signature.r, s: signature.s, v: signature.v !== undefined ? Number(signature.v) : 27 + (signature.yParity ?? 0) }

const res = await fetch(HL_EXCHANGE, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action, nonce, signature: sig, vaultAddress: null }),
})
const body = await res.json().catch(() => null)
console.log(account.address, '-> bigBlocks', usingBigBlocks, '|', JSON.stringify(body))
if (!res.ok || body?.status !== 'ok') process.exit(1)
