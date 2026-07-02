import { useEffect, useState } from 'react'
import { Header } from './components/Header'
import { Explore } from './pages/Explore'
import { LaunchDetail } from './pages/LaunchDetail'
import { Create } from './pages/Create'
import { Toasts } from './components/Toasts'
import { realtime } from './realtime/store'
import { useCoins } from './realtime/hooks'

export type Route = { page: 'explore' } | { page: 'create' } | { page: 'launch'; id: number }

function routeToPath(r: Route): string {
  if (r.page === 'create') return '/create'
  if (r.page === 'launch') return `/coin/${r.id}`
  return '/'
}

function pathToRoute(path: string): Route {
  if (path.startsWith('/create')) return { page: 'create' }
  const m = path.match(/^\/coin\/(\d+)/)
  if (m) return { page: 'launch', id: Number(m[1]) }
  return { page: 'explore' }
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => pathToRoute(window.location.pathname))
  const coins = useCoins()

  // start the realtime stream (WebSocket seam) once
  useEffect(() => {
    realtime.connect()
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

  const openBySymbol = (symbol: string) => {
    const c = coins.find((l) => l.symbol === symbol)
    if (c) navigate({ page: 'launch', id: c.id })
  }

  return (
    <div className="min-h-screen">
      <div className="sticky top-0 z-50 border-b border-line bg-paper/80 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <Header route={route} onNavigate={navigate} />
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        {route.page === 'explore' && <Explore coins={coins} onOpen={(id) => navigate({ page: 'launch', id })} />}
        {route.page === 'create' && (
          <Create
            onBack={() => navigate({ page: 'explore' })}
            onLaunch={(coin) => {
              realtime.createCoin(coin)
              navigate({ page: 'launch', id: coin.id })
            }}
          />
        )}
        {route.page === 'launch' && (
          <LaunchDetail launch={coins.find((l) => l.id === route.id) ?? coins[0]} onBack={() => navigate({ page: 'explore' })} />
        )}
      </div>

      <Toasts onOpen={openBySymbol} />
    </div>
  )
}
