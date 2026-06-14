import { useEffect, useState } from 'react'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { Board } from './pages/Board'
import { LaunchPage } from './pages/LaunchPage'
import { TokenPage } from './pages/Token'
import { Docs } from './pages/Docs'
import { Terms, Privacy, Whitepaper } from './pages/Content'

type Route =
  | { page: 'board' }
  | { page: 'launch' }
  | { page: 'docs' }
  | { page: 'terms' }
  | { page: 'privacy' }
  | { page: 'whitepaper' }
  | { page: 'token'; address: string }

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '')
  if (hash === 'launch') return { page: 'launch' }
  if (hash === 'docs') return { page: 'docs' }
  if (hash === 'terms') return { page: 'terms' }
  if (hash === 'privacy') return { page: 'privacy' }
  if (hash === 'whitepaper') return { page: 'whitepaper' }
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

  return (
    <div className="min-h-screen">
      <Header />
      <div className="mx-auto max-w-6xl px-4 pb-10 sm:px-6">
        {route.page === 'board' && <Board />}
        {route.page === 'launch' && <LaunchPage />}
        {route.page === 'docs' && <Docs />}
        {route.page === 'terms' && <Terms />}
        {route.page === 'privacy' && <Privacy />}
        {route.page === 'whitepaper' && <Whitepaper />}
        {route.page === 'token' && <TokenPage key={route.address} token={route.address} />}
        <Footer />
      </div>
    </div>
  )
}
