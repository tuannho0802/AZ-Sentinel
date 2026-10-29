import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { wireAuth } from './features/auth/api'
import { dropStayParam } from './lib/failover'
import { markScript } from './lib/perf'
import { listenForInstallPrompt, registerServiceWorker } from './lib/pwa'
import { queryClient } from './lib/query-client'
import { initTheme } from './lib/theme'

const root = document.getElementById('root')
if (!root) throw new Error('Thiếu phần tử #root')

markScript()
initTheme()
dropStayParam()
wireAuth(queryClient)
listenForInstallPrompt()
void registerServiceWorker()

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
