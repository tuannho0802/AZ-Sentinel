import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { queryClient } from './lib/query-client'
import { HealthPage } from './pages/HealthPage'

const root = document.getElementById('root')
if (!root) throw new Error('Thiếu phần tử #root')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HealthPage />
    </QueryClientProvider>
  </StrictMode>,
)
