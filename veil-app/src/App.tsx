import { useState } from 'react'
import { Header } from './components/Header'
import { Deposit } from './pages/Deposit'
import { Withdraw } from './pages/Withdraw'
import { Pool } from './pages/Pool'
import { About } from './pages/About'

export type Page = 'deposit' | 'withdraw' | 'pool' | 'about'

export default function App() {
  const [page, setPage] = useState<Page>('deposit')

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 pb-24 sm:px-6">
      <Header page={page} onNavigate={setPage} />
      {page === 'deposit' && <Deposit />}
      {page === 'withdraw' && <Withdraw />}
      {page === 'pool' && <Pool onNavigate={setPage} />}
      {page === 'about' && <About />}
    </div>
  )
}
