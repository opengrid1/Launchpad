import { useEffect, useState } from 'react'
import { Header, type Page } from './components/Header'
import { BottomNav } from './components/BottomNav'
import { Board } from './pages/Board'
import { LaunchPage } from './pages/LaunchPage'
import { TokenPage } from './pages/Token'
import { Docs } from './pages/Docs'

type Route = { page: 'board' } | { page: 'launch' } | { page: 'docs' } | { page: 'token'; address: string }

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '')
  if (hash === 'launch') return { page: 'launch' }
  if (hash === 'docs') return { page: 'docs' }
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
    <div className="min-h-screen">
      <Header page={page} />
      <BottomNav page={page} />
      <div className="mx-auto max-w-6xl px-4 pb-32 sm:px-6 sm:pb-24">
        {route.page === 'board' && <Board />}
        {route.page === 'launch' && <LaunchPage />}
        {route.page === 'docs' && <Docs />}
        {route.page === 'token' && <TokenPage key={route.address} token={route.address} />}
        <footer className="mt-24 flex flex-wrap items-center justify-between gap-3 border-t border-hair pt-6 font-mono text-[11px] text-ghost">
          <span>Flatline</span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <a
              href="https://hyperevmscan.io/address/0xc985b4dda3ae887152ba79558ed7939fbe3a7549"
              target="_blank"
              rel="noreferrer"
              className="text-ghost no-underline transition-colors hover:text-acc"
            >
              contract ↗
            </a>
            <a href="#/docs" className="text-ghost no-underline transition-colors hover:text-acc">
              docs
            </a>
            <span className="flex items-center gap-1.5">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-acc" />
              HyperEVM
            </span>
          </span>
        </footer>
      </div>
    </div>
  )
}
