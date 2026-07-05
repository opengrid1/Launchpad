import { useEffect, useState } from 'react'
import { ethers, type Signer } from 'ethers'
import { useAppKit, useAppKitAccount, useAppKitProvider } from '@reown/appkit/react'
import type { Provider } from '@reown/appkit/react'
import './appkit' // ensure AppKit is initialised once

/** Wallet connection state, backed by Reown AppKit (WalletConnect). */
export function useWallet() {
  const { open } = useAppKit()
  const { address, isConnected } = useAppKitAccount()
  const { walletProvider } = useAppKitProvider<Provider>('eip155')
  const [signer, setSigner] = useState<Signer | null>(null)

  useEffect(() => {
    let alive = true
    if (isConnected && walletProvider) {
      new ethers.BrowserProvider(walletProvider as ethers.Eip1193Provider)
        .getSigner()
        .then((s) => { if (alive) setSigner(s) })
        .catch(() => { if (alive) setSigner(null) })
    } else {
      setSigner(null)
    }
    return () => { alive = false }
  }, [isConnected, walletProvider])

  return {
    account: isConnected ? (address ?? null) : null,
    signer,
    connecting: false,
    error: null as string | null,
    connect: () => open(),
  }
}

export type Wallet = ReturnType<typeof useWallet>
