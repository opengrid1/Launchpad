import { useCallback, useEffect, useState } from 'react'
import type { Signer } from 'ethers'
import { connectWallet } from '../loxley'

type Eip1193 = {
  request: (a: { method: string; params?: unknown[] }) => Promise<unknown>
  on?: (event: string, cb: (...a: unknown[]) => void) => void
  removeListener?: (event: string, cb: (...a: unknown[]) => void) => void
}
const eth = (): Eip1193 | undefined => (window as unknown as { ethereum?: Eip1193 }).ethereum

/** Wallet connection state for the connected user. */
export function useWallet() {
  const [account, setAccount] = useState<string | null>(null)
  const [signer, setSigner] = useState<Signer | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const connect = useCallback(async () => {
    setConnecting(true)
    setError(null)
    try {
      const { account, signer } = await connectWallet()
      setAccount(account)
      setSigner(signer)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect')
    } finally {
      setConnecting(false)
    }
  }, [])

  // reflect account changes from the wallet
  useEffect(() => {
    const provider = eth()
    if (!provider?.on) return
    const onAccounts = (...a: unknown[]) => {
      const accts = a[0] as string[]
      setAccount(accts?.[0] ?? null)
      if (!accts?.length) setSigner(null)
    }
    provider.on('accountsChanged', onAccounts)
    return () => provider.removeListener?.('accountsChanged', onAccounts)
  }, [])

  return { account, signer, connecting, error, connect }
}

export type Wallet = ReturnType<typeof useWallet>
