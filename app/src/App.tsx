import { useState } from 'react'
import { Header } from './components/Header'
import { Explore } from './pages/Explore'
import { LaunchDetail } from './pages/LaunchDetail'
import { Create } from './pages/Create'
import { LAUNCHES, type Launch } from './data/launches'

export type Route = { page: 'explore' } | { page: 'create' } | { page: 'launch'; id: number }

export default function App() {
  const [route, setRoute] = useState<Route>({ page: 'explore' })
  const [coins, setCoins] = useState<Launch[]>(LAUNCHES)

  return (
    <div className="min-h-screen">
      {/* full-width sticky header bar */}
      <div className="sticky top-0 z-50 border-b border-line bg-paper/80 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <Header route={route} onNavigate={setRoute} />
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        {route.page === 'explore' && <Explore coins={coins} onOpen={(id) => setRoute({ page: 'launch', id })} />}
        {route.page === 'create' && (
          <Create
            onBack={() => setRoute({ page: 'explore' })}
            onLaunch={(coin) => {
              setCoins((prev) => [coin, ...prev])
              setRoute({ page: 'launch', id: coin.id })
            }}
          />
        )}
        {route.page === 'launch' && (
          <LaunchDetail
            launch={coins.find((l) => l.id === route.id) ?? coins[0]}
            onBack={() => setRoute({ page: 'explore' })}
          />
        )}
      </div>
    </div>
  )
}
