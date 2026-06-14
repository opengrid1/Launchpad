// Resolve an X (Twitter) handle to the wallet of the Hyprpad user who owns it, via Privy.
// Only works if that person has signed into Hyprpad with X (so Privy knows their wallet).
// Used to route launch fees to an X account: the client resolves the handle, then the
// creator signs/launches with the resolved wallet as feeRecipient.
import { PrivyClient } from '@privy-io/server-auth'

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
    if (!handle) return res.status(400).json({ error: 'Missing handle' })

    let user = null
    try {
      user = await privy().getUserByTwitterUsername(handle)
    } catch {
      user = null
    }
    const address = user?.wallet?.address
    if (!address) return res.status(404).json({ error: `@${handle} hasn't signed into Hyprpad with X yet` })

    return res.status(200).json({ address, handle })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
}
