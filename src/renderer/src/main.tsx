import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import FloatApp from './FloatApp'
import './index.css'
import { installGlobalErrorLogging } from './lib/runLog'
import { initWindowSync } from './lib/windowSync'

installGlobalErrorLogging()

// Pop-out windows boot this same bundle with ?float=<view> (see main.js
// createFloatWindow) and mount a single view instead of the full app. Every
// Electron window — main and pop-outs — joins the store-sync channel.
const floatView = new URLSearchParams(window.location.search).get('float')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if ((window as any).electron) initWindowSync(!!floatView)
declare global {
  interface Window {
    api: {
      openFolder: () => Promise<string | null>
      openFiles: () => Promise<string[]>
      openImage: () => Promise<string | null>
      scanLibrary: (folderPaths: string | string[], filters?: unknown) => Promise<import('./types').Track[]>
      addFiles: (filePaths: string[]) => Promise<import('./types').Track[]>
      getMetadata: (filePath: string) => Promise<import('./types').FullTrack>
      getAlbumArt: (filePath: string) => Promise<string | null>
      writeMetadata: (filePath: string, tags: Record<string, unknown>) => Promise<{ success?: boolean; error?: string }>
      exportCoverArt: (pngDataUri: string, trackTitle: string) => Promise<string | null>
      getFileUrl: (filePath: string) => Promise<string>
      storeGet: <T>(key: string) => Promise<T | null>
      storeSet: (key: string, value: unknown) => Promise<boolean>
      getVersion: () => Promise<string>
      isDev: () => Promise<boolean>
      setVersion: (version: string) => Promise<{ ok?: boolean; error?: string }>
      searchLyrics: (query: string, paths: string[]) => Promise<string[]>
      pingProvider: (url: string) => Promise<{ online: boolean; statusCode?: number }>
      logCrash: (message: string, stack: string) => Promise<{ ok: boolean; path?: string }>
      readDir: (dirPath: string) => Promise<{ ok: boolean; entries: { name: string; path: string; isDir: boolean }[]; error?: string }>
      homeDir: () => Promise<string>
      minimize: () => Promise<void>
      maximize: () => Promise<void>
      close: () => Promise<void>
    }
  }
}
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
    {floatView ? <FloatApp view={floatView} /> : <App />}
  </React.StrictMode>
)

// Register the PWA service worker, only over http(s). Registered after load so
// it never competes with first paint.
if (
  !floatView &&
  !(window as unknown as { electron?: unknown }).electron &&
  'serviceWorker' in navigator &&
  (location.protocol === 'https:' || location.protocol === 'http:')
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err)
    })
  })
}
