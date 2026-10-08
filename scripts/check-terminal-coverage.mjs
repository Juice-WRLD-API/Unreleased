#!/usr/bin/env node
// Proves every request the UI can make is reachable from the terminal.
//
// 1. Finds the exported functions in src/renderer/src/lib/*.ts that send a
//    request - directly (fetch, apiRequest, ...) or by calling another
//    function that does, followed to a fixpoint.
// 2. Reads which of them the terminal commands claim: each TermCommand lists
//    the functions it calls in `covers: ['module.function', ...]`
//    (src/renderer/src/lib/terminal/*.ts).
// 3. Anything neither covered nor listed in NOT_APPLICABLE below is reported.
//    The same goes for a bare fetch() in a component/hook/store, which the
//    terminal can't see until it is moved into a lib API function.
//
// Run with `npm run terminal:check-coverage`. Exits 1 on any gap.
// Flags: --list   print the covered functions too.

import { readdirSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, relative } from 'path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(root, 'src/renderer/src')
const LIB = join(SRC, 'lib')

// "module.function": why the terminal has no command for it. Keep this list
// short and honest - a reason should say what is reachable instead.
const NOT_APPLICABLE = {
  // Live sockets: the terminal can't hold a streaming screen open as a command.
  'heardleMatchApi.connectMatchSocket': 'live websocket; the REST queue calls are covered',
  // Same request as another function that is covered.
  'userApi.setPlaylistCoverBase64': 'same PATCH as uploadPlaylistCover (drag-drop path)',
  // Whole modules (`module.*`).
  'lastfm.*': 'Last.fm is a third-party service, not the site API',
  'gifApi.*': 'Tenor/Giphy are third-party services, not the site API',
  'coverImage.*': 'client-side image helpers over public cover URLs and third-party proxies',
  'cdnTunnel.*': 'peer/tunnel download transport used by file downloads (get)',
  'cdnWebrtc.*': 'peer download transport used by file downloads (get)',
  'donorUploads.*': 'upload queue wrapper around donorFilesApi.uploadDonorFile (donor up)',
  'compUploads.*': 'upload queue wrapper around the comp proposal upload (comp new)',
  'donorPlayback.*': 'caches donorFilesApi.fetchDonorFileBlob for the player (donor get)',
  'donorImageCache.*': 'caches donorFilesApi.fetchDonorFileBlob (donor get)',
  'donorCoverArt.*': 'caches donorFilesApi.fetchDonorFileBlob (donor get)',
  'heardleMatchApi.*': 'live versus match runs over a websocket; the REST queue calls are covered by daily versus',
  'notificationSocket.*': 'live notification websocket, not a request/response call',
  // Loaders and wrappers over endpoints that have their own command.
  'juicewrldApi.listFilesRecursive': 'wrapper over /files/browse (ls, tree, find)',
  'juicewrldApi.listSubtree': 'wrapper over /files/browse (ls, tree, find)',
  'juicewrldApi.searchFiles': 'wrapper over /files/browse (ls, tree, find)',
  'juicewrldApi.findSessionZips': 'wrapper over /files/browse (ls, tree, find)',
  'juicewrldApi.loadAllSongs': 'bulk /songs/ load behind song, find and lookup',
  'juicewrldApi.matchLocalSongCover': 'client-side cover matching',
  'appVersion.useCommitStatus': 'React hook over the /changelog data',
  'clientZip.*': 'client-side zipping behind get',
  'compactGroups.*': 'tracker compact-view loaders over /songs and /versions (versions all, find)',
  'newsNotifications.checkForNewPosts': 'background poll; the request is fetchNews (news)',
  'newsNotifications.mergeSubscriptionsFromProfile': 'applies the profile’s subscriptions locally (me, news subscribe)',
  'apiFilesShared.findSongByFilename': 'Files-tab lookup over /songs (find)',
  'compStagedChanges.proposeStagedChanges': 'batch wrapper over createCompProposal (comp new)',
  'compStagedSongChanges.proposeStagedSongChanges': 'batch wrapper over createProposal (proposal new)',
  'coverSuggestions.advanceRotatedCover': 'cover search over third-party catalogs, client-side rotation',
  'eras.loadEraFullNames': 'era name loader (era ls)',
  'fieldSuggestions.suggestFieldValues': 'autocomplete data derived from /songs (find)',
  'statsCatalog.*': 'catalog loaders behind stats',
  'heardle.*': 'pool loaders behind the practice game (heardle)',
  'tierlistSync.fullSync': 'syncs the tier list page’s local copy through a React hook; the same endpoints are reached by the tierlist command',
  'tierlistSync.pushChanges': 'as fullSync',
}

// Bare fetch() calls outside lib/ that are not calls to the app's API.
// "file substring": reason.
const STRAY_OK = {
  'components/DownloadAppView.tsx': 'GitHub releases, not the app API',
  'components/chat/AttachmentView.tsx': 'fetches an already-resolved media URL',
  'components/MediaLightbox.tsx': 'fetches an already-resolved media URL',
  'components/ShareLyricsModal.tsx': 'comment only',
  'components/ApiFilesView.desktop.tsx': 'file download; terminal `get` covers it',
  'components/PlaylistsView.desktop.tsx': 'cover/image blob fetch, not an endpoint of its own',
  'components/PlaylistsView.mobile.tsx': 'cover/image blob fetch, not an endpoint of its own',
  'hooks/useEditorPageState.ts': 'cover proxy fetch for the editor',
  'components/chat/ForwardMessageModal.tsx': 'attachment bytes; chat attachment commands cover them',
  'components/chat/MessageItem.tsx': 'attachment bytes; chat attachment commands cover them',
}

// Modules that are the plumbing or are the terminal itself, not UI requests:
// the HTTP primitives, the chat key store (IndexedDB) and the terminal's own file tools.
const IGNORE_MODULES = new Set(['apiClient', 'chatKeyStore', 'terminalFiles', 'terminalFileTools'])

const PRIMITIVES = /\b(fetch|apiRequest|authedRequest|apiFetch|multipartRequest|sendXhr|writeVersions)\s*[(<]|new XMLHttpRequest|\bnew WebSocket\b|\brequest\s*[(<]/

const read = (p) => readFileSync(p, 'utf-8')
const libFiles = readdirSync(LIB).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !IGNORE_MODULES.has(f.replace(/\.ts$/, '')))

// ── 1. Request-making functions ─────────────────────────────────────────────
// Splits a file into { name, exported, body } for each top-level function or
// `const name = ...`. A declaration starts at column 0 and runs until the next
// one, which is robust to default params ({}), generics and return types that
// a brace-matching parser trips over.
function functionsOf(src) {
  const starts = []
  const decl = /^(export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?\s+([A-Za-z0-9_]+)|(?:const|let)\s+([A-Za-z0-9_]+)\b)|^(?:export\s+)?(?:interface|type|class|enum|declare|import)\b/gm
  for (let m = decl.exec(src); m; m = decl.exec(src)) starts.push({ index: m.index, exported: !!m[1], name: m[2] ?? m[3] ?? null })
  const out = []
  starts.forEach((d, i) => {
    if (d.name) out.push({ name: d.name, exported: d.exported, body: src.slice(d.index, starts[i + 1]?.index ?? src.length) })
  })
  return out
}

const fns = new Map() // "file.name" -> { file, name, exported, body }
for (const f of libFiles) {
  const mod = f.replace(/\.ts$/, '')
  for (const fn of functionsOf(read(join(LIB, f)))) fns.set(`${mod}.${fn.name}`, { mod, ...fn })
}

const requests = new Set()
for (const [key, fn] of fns) if (PRIMITIVES.test(fn.body.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))) requests.add(key)
// Follow calls to functions already known to request, within the same file or
// by name across files, until nothing new turns up.
for (let grew = true; grew;) {
  grew = false
  for (const [key, fn] of fns) {
    if (requests.has(key)) continue
    const calls = [...requests].some((r) => {
      const [, name] = r.split('.')
      return name !== fn.name && new RegExp(`\\b${name}\\s*[(<]`).test(fn.body)
    })
    if (calls) { requests.add(key); grew = true }
  }
}
const exportedRequests = [...requests].filter((k) => fns.get(k).exported).sort()

// ── 2. What the terminal claims ─────────────────────────────────────────────
const termDir = join(LIB, 'terminal')
const covered = new Set()
const mods = new Set(libFiles.map((f) => f.replace(/\.ts$/, '')))
for (const f of readdirSync(termDir).filter((x) => x.endsWith('.ts'))) {
  for (const m of read(join(termDir, f)).matchAll(/'([A-Za-z0-9]+)\.([A-Za-z0-9_]+)'/g)) if (mods.has(m[1])) covered.add(`${m[1]}.${m[2]}`)
}

// ── 3. Report ────────────────────────────────────────────────────────────────
const gaps = exportedRequests.filter((k) => !covered.has(k) && !(k in NOT_APPLICABLE || `${k.split('.')[0]}.*` in NOT_APPLICABLE))
const stale = [...covered].filter((k) => !fns.has(k))

const strays = []
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (p !== LIB) walk(p); continue }
    if (!/\.(ts|tsx)$/.test(e.name) || p.startsWith(LIB + '\\') || p.startsWith(LIB + '/')) continue
    const rel = relative(SRC, p).replace(/\\/g, '/')
    if (rel.startsWith('components/docs/')) continue
    read(p).split('\n').forEach((line, n) => {
      if (/^\s*\/\//.test(line)) return
      if (/\bfetch\(|\bapiRequest\(|\bauthedRequest\(/.test(line) && !Object.keys(STRAY_OK).some((k) => rel.includes(k))) strays.push(`${rel}:${n + 1}  ${line.trim().slice(0, 100)}`)
    })
  }
}
walk(SRC)

const byMod = new Map()
for (const k of gaps) { const [m, n] = k.split('.'); byMod.set(m, [...(byMod.get(m) ?? []), n]) }

if (process.argv.includes('--list')) console.log(`covered:\n${[...covered].sort().map((k) => `  ${k}`).join('\n')}\n`)
console.log(`${exportedRequests.length - gaps.length} of ${exportedRequests.length} request functions are reachable from the terminal (${Object.keys(NOT_APPLICABLE).length} marked not applicable).`)
if (byMod.size) {
  console.log('\nNot yet reachable:')
  for (const [m, names] of [...byMod].sort((a, b) => b[1].length - a[1].length)) console.log(`  ${m} (${names.length}): ${names.join(', ')}`)
}
if (stale.length) console.log(`\ncovers: names that match no function (typo or renamed):\n${stale.map((k) => `  ${k}`).join('\n')}`)
if (strays.length) console.log(`\nRequests made outside lib/ (move them into a lib API function, or list them in STRAY_OK):\n${strays.map((s) => `  ${s}`).join('\n')}`)
process.exit(gaps.length || stale.length || strays.length ? 1 : 0)
