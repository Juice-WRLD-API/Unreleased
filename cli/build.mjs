import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Bundles the CLI into one file with no runtime dependencies. Some of the site's
// own modules are compiled in as they are (the file tools behind cat, grep,
// tree, du, locate, head, tail, wc; the listening-stats maths; the terminal's
// name matching; the Wordle and Heardle game logic), so both terminals behave
// the same. They are pulled in through `site:<name>` imports; anything those
// modules import that only works in the browser is swapped for a Node version
// here (their localStorage is src/shims/localStorage.ts).
const here = dirname(fileURLToPath(import.meta.url))
const siteLib = resolve(here, '../src/renderer/src/lib')
const pkg = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8'))

const SITE_MODULES = {
  'site:fileTools': resolve(siteLib, 'terminalFileTools.ts'),
  'site:format': resolve(siteLib, 'format.ts'),
  'site:fileTypes': resolve(siteLib, 'fileTypes.ts'),
  'site:listeningStats': resolve(siteLib, 'listeningStats.ts'),
  'site:termTypes': resolve(siteLib, 'terminal/types.ts'),
  'site:wordle': resolve(siteLib, 'wordle.ts'),
  'site:heardle': resolve(siteLib, 'heardle.ts'),
}

// Imports made from inside the site's modules, keyed by importing file, that
// resolve to the CLI's Node version instead.
const REPLACED = {
  [resolve(siteLib, 'terminalFileTools.ts')]: { './terminalFiles': resolve(here, 'src/files.ts') },
  [resolve(siteLib, 'fileTypes.ts')]: { '../store/useStore': resolve(here, 'src/shims/useStore.ts') },
  [resolve(siteLib, 'listeningStats.ts')]: { './juicewrldApi': resolve(here, 'src/shims/juicewrldApi.ts') },
  [resolve(siteLib, 'heardle.ts')]: {
    './apiClient': resolve(here, 'src/shims/apiClient.ts'),
    './juicewrldApi': resolve(here, 'src/shims/juicewrldApi.ts'),
  },
  [resolve(siteLib, 'versionsApi.ts')]: {
    './apiClient': resolve(here, 'src/shims/apiClient.ts'),
    './juicewrldApi': resolve(here, 'src/shims/juicewrldApi.ts'),
    './userApi': resolve(here, 'src/shims/userApi.ts'),
  },
}

const sitePlugin = {
  name: 'site',
  setup(b) {
    b.onResolve({ filter: /^site:/ }, (args) => {
      const path = SITE_MODULES[args.path]
      return path ? { path } : { errors: [{ text: `unknown site module ${args.path}` }] }
    })
    b.onResolve({ filter: /^\./ }, (args) => {
      const path = REPLACED[resolve(args.importer)]?.[args.path]
      return path ? { path } : undefined
    })
  },
}

await build({
  entryPoints: [resolve(here, 'src/main.ts')],
  outfile: resolve(here, 'dist/unreleased.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  define: { __VERSION__: JSON.stringify(pkg.version) },
  plugins: [sitePlugin],
  logLevel: 'info',
})
