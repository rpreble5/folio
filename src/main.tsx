import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { registerOfflineWorker } from './ui/screen'

// Before the app mounts, but the registration itself waits for load — an
// instrument is often somewhere with poor signal, and a music stand that needs
// a network round trip to open is one that fails at the worst moment.
registerOfflineWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
