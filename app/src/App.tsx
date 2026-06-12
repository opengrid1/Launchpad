import { useEffect, useState } from 'react'
import { Header, type Page } from './components/Header'
import { Board } from './pages/Board'
import { LaunchPage } from './pages/LaunchPage'
import { TokenPage } from './pages/Token'

type Route = { page: 'board' } | { page: 'launch' } | { page: 'token'; address: string }

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '')
  if (hash === 'launch') return { page: 'launch' }
  const tokenMatch = /^t\/(0x[0-9a-fA-F]{40})$/.exec(hash)
  if (tokenMatch) return { page: 'token', address: tokenMatch[1] }
  return { page: 'board' }
}

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(parseHash)
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export default function App() {
  const route = useHashRoute()
  const page: Page = route.page

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 pb-24 sm:px-6">
      <Header page={page} />
      {route.page === 'board' && <Board />}
      {route.page === 'launch' && <LaunchPage />}
      {route.page === 'token' && <TokenPage key={route.address} token={route.address} />}
      <footer className="mt-20 flex flex-wrap items-center justify-between gap-3 border-t border-ink-800 pt-6 font-mono text-[11px] text-fog-500">
        <span>Flatline · flaunch-style launchpad on HyperEVM</span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <a
            href="https://hyperevmscan.io/address/0xc985b4dda3ae887152ba79558ed7939fbe3a7549"
            target="_blank"
            rel="noreferrer"
            className="text-fog-500 no-underline transition-colors hover:text-mint-400"
          >
            contract ↗
          </a>
          <a
            href="https://hyperswap.exchange"
            target="_blank"
            rel="noreferrer"
            className="text-fog-500 no-underline transition-colors hover:text-mint-400"
          >
            HyperSwap V3 ↗
          </a>
          <span className="flex items-center gap-1.5">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-mint-400" />
            chain 999
          </span>
        </span>
      </footer>
    </div>
  )
}
