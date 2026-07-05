import { useEffect, useState } from 'react'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { Explore } from './pages/Explore'
import { LaunchDetail } from './pages/LaunchDetail'
import { Create } from './pages/Create'
import { Toasts } from './components/Toasts'
import { realtime } from './realtime/store'
import { useCoins } from './realtime/hooks'
import { loadChain } from './web3/loadChain'
import { useWallet } from './web3/useWallet'

export type Route = { page: 'explore' } | { page: 'create' } | { page: 'launch'; address: string }

function routeToPath(r: Route): string {
  if (r.page === 'create') return '/create'
  if (r.page === 'launch') return `/coin/${r.address}`
  return '/'
}

function pathToRoute(path: string): Route {
  if (path.startsWith('/create')) return { page: 'create' }
  const m = path.match(/^\/coin\/([^/?#]+)/)
  if (m) return { page: 'launch', address: decodeURIComponent(m[1]) }
  return { page: 'explore' }
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => pathToRoute(window.location.pathname))
  const [query, setQuery] = useState('')
  const coins = useCoins()
  const wallet = useWallet()

  // start the market stream + load the live on-chain launches
  useEffect(() => {
    realtime.connect()
    loadChain().catch((e) => console.error('loadChain failed', e))
    const onFocus = () => loadChain().catch(() => {})
    window.addEventListener('focus', onFocus)
    // live board: re-read launches/prices so cards update without a refresh
    const id = setInterval(() => { if (!document.hidden) loadChain().catch(() => {}) }, 20000)
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(id)
    }
  }, [])

  // real client-side routing via the History API — no full-page reloads
  const navigate = (r: Route) => {
    window.history.pushState(r, '', routeToPath(r))
    setRoute(r)
    window.scrollTo(0, 0)
  }
  useEffect(() => {
    const onPop = () => setRoute(pathToRoute(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // old/numeric links (e.g. /coin/1682536824) self-correct to the real address
  useEffect(() => {
    if (route.page === 'launch' && coins.length) {
      const c = coins.find((l) => l.tokenAddress.toLowerCase() === route.address.toLowerCase())
      if (!c && coins[0]) window.history.replaceState({}, '', `/coin/${coins[0].tokenAddress}`)
    }
  }, [route, coins])

  // typing in search jumps to the board so results are visible
  const onQuery = (v: string) => {
    setQuery(v)
    if (v && route.page !== 'explore') navigate({ page: 'explore' })
  }

  const openBySymbol = (symbol: string) => {
    const c = coins.find((l) => l.symbol === symbol)
    if (c) navigate({ page: 'launch', address: c.tokenAddress })
  }

  return (
    <div className="min-h-screen overflow-x-hidden">
      <div className="sticky top-0 z-50 border-b border-line bg-paper/80 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <Header route={route} onNavigate={navigate} wallet={wallet} query={query} onQuery={onQuery} />
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        {route.page === 'explore' && <Explore coins={coins} query={query} onOpen={(address) => navigate({ page: 'launch', address })} />}
        {route.page === 'create' && (
          <Create
            wallet={wallet}
            onBack={() => navigate({ page: 'explore' })}
            onLaunched={async () => {
              await loadChain().catch(() => {})
              navigate({ page: 'explore' })
            }}
          />
        )}
        {route.page === 'launch' && coins.length > 0 && (
          <LaunchDetail
            launch={coins.find((l) => l.tokenAddress.toLowerCase() === route.address.toLowerCase()) ?? coins[0]}
            wallet={wallet}
            onBack={() => navigate({ page: 'explore' })}
          />
        )}
      </div>

      <Footer />

      <Toasts onOpen={openBySymbol} />
    </div>
  )
}
