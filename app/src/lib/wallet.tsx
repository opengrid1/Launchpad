/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { PrivyProvider, usePrivy, useWallets } from '@privy-io/react-auth'
import { createWalletClient, custom, type Address, type WalletClient } from 'viem'
import { hyperevm } from './chain'

const PRIVY_APP_ID = 'cmqcelb8c003p0cjo0zn4d4l7'

type WalletState = {
  address: Address | null
  chainId: number | null
  connecting: boolean
  hasProvider: boolean
  connect: () => void
  disconnect: () => void
  walletClient: WalletClient | null
  ensureChain: () => Promise<void>
  onCorrectChain: boolean
}

const WalletContext = createContext<WalletState | null>(null)

/** Wraps the app in Privy, then exposes the same useWallet() API the app already uses. */
export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#3fe0cf',
          walletChainType: 'ethereum-only',
        },
        loginMethods: ['wallet', 'email', 'google', 'twitter'],
        defaultChain: hyperevm,
        supportedChains: [hyperevm],
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
      }}
    >
      <WalletBridge>{children}</WalletBridge>
    </PrivyProvider>
  )
}

function WalletBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout, user } = usePrivy()
  const { wallets } = useWallets()
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null)

  // Active wallet: prefer the one Privy marks as primary, else the first connected.
  const wallet = useMemo(() => {
    if (wallets.length === 0) return null
    return wallets.find((w) => w.address === user?.wallet?.address) ?? wallets[0]
  }, [wallets, user?.wallet?.address])

  const address = (wallet?.address as Address | undefined) ?? null
  const chainId = wallet ? Number(String(wallet.chainId).split(':').pop()) || null : null

  useEffect(() => {
    let alive = true
    void (async () => {
      if (!wallet || !address) {
        if (alive) setWalletClient(null)
        return
      }
      const provider = await wallet.getEthereumProvider()
      if (alive) setWalletClient(createWalletClient({ account: address, chain: hyperevm, transport: custom(provider) }))
    })()
    return () => {
      alive = false
    }
  }, [wallet, address])

  const connect = useCallback(() => {
    if (!authenticated) login()
  }, [authenticated, login])

  const disconnect = useCallback(() => {
    void logout()
  }, [logout])

  const ensureChain = useCallback(async () => {
    if (!wallet) return
    if (Number(String(wallet.chainId).split(':').pop()) === hyperevm.id) return
    await wallet.switchChain(hyperevm.id)
  }, [wallet])

  const value = useMemo<WalletState>(
    () => ({
      address,
      chainId,
      connecting: !ready,
      hasProvider: true,
      connect,
      disconnect,
      walletClient,
      ensureChain,
      onCorrectChain: chainId === hyperevm.id,
    }),
    [address, chainId, ready, connect, disconnect, walletClient, ensureChain],
  )

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet outside WalletProvider')
  return ctx
}
