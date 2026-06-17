import { useState } from 'react'
import { Masthead } from './components/Masthead'
import { Board } from './pages/Board'
import { Offering } from './pages/Offering'
import { Issue } from './pages/Issue'
import { OFFERINGS } from './data/offerings'

export type Route = { page: 'board' } | { page: 'issue' } | { page: 'offering'; id: number }

export default function App() {
  const [route, setRoute] = useState<Route>({ page: 'board' })

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 pb-28 sm:px-6">
      <Masthead route={route} onNavigate={setRoute} />

      {route.page === 'board' && (
        <Board onOpen={(id) => setRoute({ page: 'offering', id })} onIssue={() => setRoute({ page: 'issue' })} />
      )}
      {route.page === 'issue' && <Issue onBack={() => setRoute({ page: 'board' })} />}
      {route.page === 'offering' && (
        <Offering
          offering={OFFERINGS.find((o) => o.id === route.id) ?? OFFERINGS[0]}
          onBack={() => setRoute({ page: 'board' })}
        />
      )}
    </div>
  )
}
