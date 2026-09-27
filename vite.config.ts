import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))

// The shipped CSP (index.html) pins style-src to 'self' with no unsafe-inline,
// which is correct for the built app (CSS ships as a linked file) but blocks
// the <style> tag Vite's dev server injects for HMR — every class silently
// no-ops with zero console error. script-src needs the same relaxation for
// the react-refresh preamble, and connect-src needs the HMR websocket origin.
const devCspPlugin = {
  name: 'relax-csp-for-dev-server',
  apply: 'serve' as const,
  transformIndexHtml(html: string) {
    return html.replace(
      /<meta http-equiv="Content-Security-Policy"[\s\S]*?\/>/,
      `<meta http-equiv="Content-Security-Policy" content="
      default-src 'self';
      script-src 'self' 'unsafe-inline' 'unsafe-eval';
      style-src 'self' 'unsafe-inline';
      img-src 'self' data: blob: local-media: https:;
      media-src 'self' blob: local-media: https:;
      font-src 'self';
      connect-src 'self' ws://localhost:3018 https://juicewrldapi.com wss://juicewrldapi.com https://ws.audioscrobbler.com https://api.allorigins.win https://corsproxy.io https://api.github.com https://images.weserv.nl https://tenor.googleapis.com https://*.tenor.com https://api.giphy.com https://*.giphy.com local-media:;
      worker-src 'self' blob:;
      object-src 'none';
      base-uri 'self';
      form-action 'self';
    " />`
    )
  }
}

export default defineConfig({
  plugins: [react(), devCspPlugin],
  root: resolve(__dirname, 'src/renderer'),
  envDir: resolve(__dirname, '.'),
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 3018,
    strictPort: true,
    host: true,
    allowedHosts: ['.juicewrldapi.com', 'player.juicewrldapi.com', 'localhost', '127.0.0.1'],
  },
  preview: {
    port: 3018,
    strictPort: true,
    host: true,
    allowedHosts: ['.juicewrldapi.com', 'player.juicewrldapi.com', 'localhost', '127.0.0.1'],
  },
})
