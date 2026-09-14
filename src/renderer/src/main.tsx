import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { installGlobalErrorLogging } from './lib/runLog'

installGlobalErrorLogging()

// iOS home-screen apps have shipped several WebKit versions that size the
// viewport as if Safari's bottom toolbar could still appear - chrome that
// cannot exist outside a browser tab. 100dvh and window.innerHeight both
// come back short by exactly that phantom toolbar, leaving a dead strip of
// bare background across the bottom of the screen. 100lvh (the *largest*
// viewport - every retractable bar retracted) is the real fullscreen height
// there. index.css keys --app-height off this class; a genuine browser tab
// keeps dvh, where lvh would instead run content under the visible toolbar.
document.documentElement.classList.toggle(
  'standalone',
  window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true,
)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Register the PWA service worker, only over http(s). Registered after load so
// it never competes with first paint.
if (
  'serviceWorker' in navigator &&
  (location.protocol === 'https:' || location.protocol === 'http:')
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err)
    })
  })
}
