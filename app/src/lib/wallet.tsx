/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createWalletClient, custom, type Address, type EIP1193Provider, type WalletClient } from 'viem'
import { hyperevm } from './chain'

declare global {
  interface Window {
    ethereum?: EIP1193Provider
  }
}

type WalletState = {
  address: Address | null
  chainId: number | null
  connecting: boolean
  hasProvider: boolean
  connect: () => Promise<void>
  disconnect: () => void
  /** Wallet client bound to the connected account; null until connected. */
  walletClient: WalletClient | null
  /** Prompts a switch (or add+switch) to HyperEVM. Resolves when on chain 999. */
  ensureChain: () => Promise<void>
  onCorrectChain: boolean
}

const WalletContext = createContext<WalletState | null>(null)

const STORAGE_KEY = 'flatline.connected'

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)
  const [connecting, setConnecting] = useState(false)
  const hasProvider = typeof window !== 'undefined' && !!window.ethereum

  const applyAccounts = useCallback((accounts: string[]) => {
    setAddress(accounts.length > 0 ? (accounts[0] as Address) : null)
    if (accounts.length === 0) localStorage.removeItem(STORAGE_KEY)
  }, [])

  useEffect(() => {
    const provider = window.ethereum
    if (!provider) return

    // Silent reconnect for returning users.
    if (localStorage.getItem(STORAGE_KEY)) {
      provider.request({ method: 'eth_accounts' }).then((a) => applyAccounts(a as string[])).catch(() => {})
    }
    provider.request({ method: 'eth_chainId' }).then((id) => setChainId(Number(id))).catch(() => {})

    const onAccounts = (accounts: unknown) => applyAccounts(accounts as string[])
    const onChain = (id: unknown) => setChainId(Number(id))
    provider.on('accountsChanged', onAccounts)
    provider.on('chainChanged', onChain)
    return () => {
      provider.removeListener('accountsChanged', onAccounts)
      provider.removeListener('chainChanged', onChain)
    }
  }, [applyAccounts])

  const connect = useCallback(async () => {
    const provider = window.ethereum
    if (!provider) {
      window.open('https://metamask.io/download/', '_blank', 'noopener')
      return
    }
    setConnecting(true)
    try {
      const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[]
      applyAccounts(accounts)
      const id = (await provider.request({ method: 'eth_chainId' })) as string
      setChainId(Number(id))
      localStorage.setItem(STORAGE_KEY, '1')
    } finally {
      setConnecting(false)
    }
  }, [applyAccounts])

  const disconnect = useCallback(() => {
    setAddress(null)
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  const ensureChain = useCallback(async () => {
    const provider = window.ethereum
    if (!provider) throw new Error('No wallet found')
    const current = (await provider.request({ method: 'eth_chainId' })) as string
    if (Number(current) === hyperevm.id) return
    const hexId = `0x${hyperevm.id.toString(16)}`
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] })
    } catch (err) {
      // 4902: chain not added to the wallet yet
      if ((err as { code?: number }).code === 4902) {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: hexId,
              chainName: hyperevm.name,
              nativeCurrency: hyperevm.nativeCurrency,
              rpcUrls: [hyperevm.rpcUrls.default.http[0]],
              blockExplorerUrls: [hyperevm.blockExplorers.default.url],
            },
          ],
        })
      } else {
        throw err
      }
    }
    setChainId(hyperevm.id)
  }, [])

  const walletClient = useMemo(() => {
    if (!address || !window.ethereum) return null
    return createWalletClient({ account: address, chain: hyperevm, transport: custom(window.ethereum) })
  }, [address])

  const value = useMemo<WalletState>(
    () => ({
      address,
      chainId,
      connecting,
      hasProvider,
      connect,
      disconnect,
      walletClient,
      ensureChain,
      onCorrectChain: chainId === hyperevm.id,
    }),
    [address, chainId, connecting, hasProvider, connect, disconnect, walletClient, ensureChain],
  )

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet outside WalletProvider')
  return ctx
}
