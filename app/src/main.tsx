import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { WalletProvider } from './lib/wallet'
import { ToastProvider } from './lib/toast'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WalletProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </WalletProvider>
  </StrictMode>,
)
