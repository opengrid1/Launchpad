import { encode as msgpackEncode } from '@msgpack/msgpack'
import { keccak256, parseSignature, type Hex, type WalletClient, type Account } from 'viem'

const HL_EXCHANGE = 'https://api.hyperliquid.xyz/exchange'

/**
 * HyperCore L1 action signing (the "phantom agent" scheme used by the official SDKs):
 * keccak(msgpack(action) ++ nonce_be8 ++ 0x00) signed as EIP-712
 * Agent{source:"a", connectionId} under the Exchange/1/1337 domain.
 *
 * Used for `evmUserModify` — flipping the connected wallet between small blocks
 * (~1s, 2M gas) and big blocks (~1min, 30M gas). Launching needs big blocks.
 */
type EvmUserModifyAction = { type: 'evmUserModify'; usingBigBlocks: boolean }

export function l1ActionHash(action: EvmUserModifyAction, nonce: number): Hex {
  const packed = msgpackEncode(action, { sortKeys: false })
  const data = new Uint8Array(packed.length + 9)
  data.set(packed, 0)
  const view = new DataView(data.buffer)
  view.setBigUint64(packed.length, BigInt(nonce), false) // 8-byte big-endian nonce
  data[packed.length + 8] = 0 // no vault address
  return keccak256(data)
}

export async function signL1Action(
  wallet: WalletClient,
  account: Account | { address: Hex },
  action: EvmUserModifyAction,
  nonce: number,
): Promise<{ r: Hex; s: Hex; v: number }> {
  // L1 actions must be signed under the HyperCore domain (chainId 1337), which differs
  // from the connected EVM chain (999). viem's signTypedData guards against that
  // mismatch, so we call eth_signTypedData_v4 on the provider directly — the wallet
  // just signs the typed data; the domain chainId is part of the payload, not the
  // network it's broadcast to.
  const typedData = {
    domain: {
      name: 'Exchange',
      version: '1',
      chainId: 1337,
      verifyingContract: '0x0000000000000000000000000000000000000000',
    },
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      Agent: [
        { name: 'source', type: 'string' },
        { name: 'connectionId', type: 'bytes32' },
      ],
    },
    primaryType: 'Agent',
    message: { source: 'a', connectionId: l1ActionHash(action, nonce) },
  }

  const request = wallet.request as (args: { method: string; params: unknown[] }) => Promise<Hex>
  const signature = await request({
    method: 'eth_signTypedData_v4',
    params: [account.address, JSON.stringify(typedData)],
  })

  const { r, s, v, yParity } = parseSignature(signature)
  return { r, s, v: v !== undefined ? Number(v) : 27 + (yParity ?? 0) }
}

/** Flip the connected wallet's block mode on HyperCore. Throws with the API error text on failure. */
export async function setBigBlocks(
  wallet: WalletClient,
  account: Account | { address: Hex },
  usingBigBlocks: boolean,
): Promise<void> {
  const action: EvmUserModifyAction = { type: 'evmUserModify', usingBigBlocks }
  const nonce = Date.now()
  const signature = await signL1Action(wallet, account, action, nonce)

  const res = await fetch(HL_EXCHANGE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, nonce, signature, vaultAddress: null }),
  })
  const body = (await res.json().catch(() => null)) as { status?: string; response?: unknown } | null
  if (!res.ok || body?.status !== 'ok') {
    const detail = body ? JSON.stringify(body.response ?? body) : `HTTP ${res.status}`
    throw new Error(`Block-mode switch failed: ${detail}`)
  }
}
