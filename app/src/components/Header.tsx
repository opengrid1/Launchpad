import { useState } from 'react'
import { useWallet } from '../lib/wallet'
import { shortAddress } from '../lib/format'
import { Logo } from './Logo'

export function Header() {
  const { address, connecting, connect, disconnect, onCorrectChain, ensureChain, chainId } = useWallet()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="sticky top-0 z-40 border-b border-hair bg-base/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
        <Logo />

        <div className="flex items-center gap-2">
          {address && !onCorrectChain && chainId !== null && (
            <button
              onClick={() => void ensureChain()}
              className="cursor-pointer rounded-lg bg-downsoft px-3 py-2 text-xs font-bold text-down transition hover:brightness-110"
            >
              Wrong network
            </button>
          )}
          {!address ? (
            <button
              onClick={() => connect()}
              disabled={connecting}
              className="btn-primary cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60"
            >
              {connecting ? '…' : 'Connect'}
            </button>
          ) : (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="cursor-pointer rounded-lg px-3.5 py-2 font-mono text-sm text-fg ring-1 ring-hair2 transition hover:bg-panel2"
              >
                {shortAddress(address)}
              </button>
              {menuOpen && (
                <div className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-xl bg-panel shadow-xl ring-1 ring-hair2">
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(address)
                      setMenuOpen(false)
                    }}
                    className="block w-full cursor-pointer px-4 py-2.5 text-left text-sm text-dim hover:bg-panel2 hover:text-fg"
                  >
                    Copy address
                  </button>
                  <button
                    onClick={() => {
                      disconnect()
                      setMenuOpen(false)
                    }}
                    className="block w-full cursor-pointer px-4 py-2.5 text-left text-sm text-down hover:bg-panel2"
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
