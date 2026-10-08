// One-off: merge /versions/ groups that share a title into a single group_id,
// matching the read-side title unification in src/renderer/src/lib/versionsApi.ts
// (unifyByTitle). Same normalization: case, apostrophe style and whitespace are
// ignored. Rows already sharing a group_id stay together. The lowest group_id
// in each merged set survives.
//
// Dry run by default - prints what would change and touches nothing.
//   node scripts/merge-version-groups-by-title.mjs
// Apply (needs an editor/admin token):
//   $env:JW_TOKEN='...'; node scripts/merge-version-groups-by-title.mjs --apply
// Override the API base with JW_BASE (default https://juicewrldapi.com/juicewrld).

const BASE = (process.env.JW_BASE ?? 'https://juicewrldapi.com/juicewrld').replace(/\/+$/, '')
const TOKEN = process.env.JW_TOKEN
const APPLY = process.argv.includes('--apply')

if (APPLY && !TOKEN) {
  console.error('--apply needs JW_TOKEN (an editor/admin token) in the environment.')
  process.exit(1)
}

const titleKey = t => {
  const k = t?.replace(/['’‘]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  return k || null
}

const res = await fetch(`${BASE}/versions/?all=true`)
if (!res.ok) throw new Error(`GET /versions/ failed: ${res.status}`)
const rows = await res.json()
console.log(`${rows.length} version rows`)

const parent = new Map()
const find = g => {
  let p = parent.get(g) ?? g
  while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p
  parent.set(g, p)
  return p
}
const union = (a, b) => {
  const ra = find(a), rb = find(b)
  if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb))
}
const byTitle = new Map()
for (const r of rows) {
  find(r.group_id)
  const k = titleKey(r.title)
  if (!k) continue
  const seen = byTitle.get(k)
  if (seen === undefined) byTitle.set(k, r.group_id)
  else union(seen, r.group_id)
}

const changes = rows.filter(r => find(r.group_id) !== r.group_id)
const merged = new Map()
for (const r of changes) {
  const to = find(r.group_id)
  if (!merged.has(to)) merged.set(to, new Set())
  merged.get(to).add(r.group_id)
}
for (const [to, from] of merged) {
  const titles = [...new Set(rows.filter(r => find(r.group_id) === to && r.title).map(r => r.title))]
  console.log(`group ${to} <- ${[...from].join(', ')}  ${JSON.stringify(titles)}`)
}
console.log(`${merged.size} groups affected, ${changes.length} rows to repoint`)

if (!APPLY) {
  console.log('Dry run - re-run with --apply to write.')
  process.exit(0)
}

let ok = 0
const failed = []
for (const r of changes) {
  const url = `${BASE}/versions/${r.song_id}/${r.id}/`
  const p = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Token ${TOKEN}` },
    body: JSON.stringify({ group_id: find(r.group_id) }),
  })
  if (p.ok) ok++
  else {
    failed.push(`${r.song_id}/${r.id}: ${p.status}`)
    if (failed.length === 1) {
      console.error(`first failure ${p.status}:`, (await p.text().catch(() => '')).slice(0, 300))
      if (p.status === 401 || p.status === 403) {
        console.error('Auth rejected - stopping instead of retrying every row.')
        break
      }
    }
  }
}
console.log(`patched ${ok}/${changes.length}`)
if (failed.length) {
  console.error('failed:\n' + failed.join('\n'))
  process.exit(1)
}
