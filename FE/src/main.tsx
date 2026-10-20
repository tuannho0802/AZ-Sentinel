import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { wireAuth } from './features/auth/api'
import { queryClient } from './lib/query-client'

const root = document.getElementById('root')
if (!root) throw new Error('Thiếu phần tử #root')

wireAuth(queryClient)

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
