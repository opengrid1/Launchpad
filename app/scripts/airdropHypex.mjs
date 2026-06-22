// 1:1 HYPEX airdrop to HYLD holders. Reads /tmp/hypex_airdrop.json.
// Usage: PRIVATE_KEY=0x... TOKEN=0x... node scripts/airdropHypex.mjs
import { readFileSync } from 'node:fs'
import { createWalletClient, createPublicClient, http, defineChain, getContract } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const hyperevm = defineChain({
  id: 999,
  name: 'HyperEVM',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.hyperliquid.xyz/evm'] } },
})

const ERC20 = [
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
]

const pk = process.env.PRIVATE_KEY
const TOKEN = process.env.TOKEN
if (!pk || !TOKEN) throw new Error('PRIVATE_KEY and TOKEN env required')
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`)

const wallet = createWalletClient({ account, chain: hyperevm, transport: http() })
const pub = createPublicClient({ chain: hyperevm, transport: http() })

const data = JSON.parse(readFileSync('/tmp/hypex_airdrop.json', 'utf8'))
const recipients = data.recipients
console.log(`airdropping to ${recipients.length} recipients from ${account.address}, token ${TOKEN}`)

let nonce = await pub.getTransactionCount({ address: account.address })
let done = 0, failed = []
for (const r of recipients) {
  const to = r.address
  const amt = BigInt(r.hypex_wei)
  // skip if already funded (idempotent re-runs)
  const bal = await pub.readContract({ address: TOKEN, abi: ERC20, functionName: 'balanceOf', args: [to] })
  if (bal >= amt) { console.log(`skip ${to} (already has ${bal})`); done++; continue }
  try {
    const hash = await wallet.writeContract({ address: TOKEN, abi: ERC20, functionName: 'transfer', args: [to, amt], nonce })
    const rcpt = await pub.waitForTransactionReceipt({ hash })
    console.log(`${rcpt.status === 'success' ? 'OK ' : 'REVERT '} ${to} ${amt} ${hash}`)
    if (rcpt.status === 'success') done++; else failed.push(to)
    nonce++
  } catch (e) {
    console.log(`ERR ${to}: ${e.shortMessage || e.message}`)
    failed.push(to)
    nonce = await pub.getTransactionCount({ address: account.address })
  }
}
console.log(`\nDONE: ${done}/${recipients.length} funded. failed: ${JSON.stringify(failed)}`)
if (failed.length) process.exit(1)
