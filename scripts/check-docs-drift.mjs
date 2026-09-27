#!/usr/bin/env node
// Flags drift between docs/api-docs/*.md (the plain-markdown docs) and the
// in-app docs renderer (src/renderer/src/components/docs/content.tsx) - the
// two are hand-maintained in parallel with no derivation step between them,
// so nothing stops them disagreeing. Also cross-checks a few JSON examples
// (home_section_visibility, nav_visibility, ...) against the real id lists
// they're supposed to mirror, since two docs can agree with each other while
// both being wrong relative to the actual code (see 08-accounts.md's old
// "recentlyPlayed" vs. the real "recent" home-section id).
//
// Run with `npm run docs:check-drift`. Exits 1 with a report on any mismatch.

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relPath) => readFileSync(join(root, relPath), 'utf-8')

const CONTENT_PATH = 'src/renderer/src/components/docs/content.tsx'
const content = read(CONTENT_PATH)

// Split content.tsx into { TabName: sourceText } chunks at each top-level
// `function XTab() {` - nested/indented functions don't match `^function`,
// so this only sees the sibling tab-component declarations.
function splitTabs(src) {
  const re = /^function (\w+)\(\)/gm
  const marks = []
  let m
  while ((m = re.exec(src))) marks.push({ name: m[1], index: m.index })
  const chunks = {}
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].index : src.length
    chunks[marks[i].name] = src.slice(marks[i].index, end)
  }
  return chunks
}
const tabs = splitTabs(content)

// JSX escapes a literal `{` in a template literal as `{'{'}`, which breaks a
// plain substring match against the markdown's `{job_id}` - unescape before
// comparing so that's not reported as drift.
function unescapeJsxBraces(src) {
  return src.replace(/\{'\{/g, '{').replace(/\}'\}/g, '}')
}
for (const name of Object.keys(tabs)) tabs[name] = unescapeJsxBraces(tabs[name])

// Which hand-written tab each purely-textual doc file is derived from. The
// interactive tabs (Radio, Heardle, Chat, FetchPattern, Overview, FeedsMedia)
// mix in live demos/hooks that markdown can't drive, so they're intentionally
// left out of this mapping.
const MAPPING = {
  'docs/api-docs/02-songs-and-search.md': 'SongsTab',
  'docs/api-docs/03-versions.md': 'VersionsTab',
  'docs/api-docs/04-files-and-stream.md': 'FilesTab',
  'docs/api-docs/05-playlists.md': 'PlaylistsTab',
  'docs/api-docs/08-accounts.md': 'AccountsTab',
  'docs/api-docs/10-editor-workflow.md': 'EditorWorkflowTab',
  'docs/api-docs/11-admin.md': 'AdminTab',
  'docs/api-docs/12-feedback-and-reports.md': 'FeedbackTab',
  'docs/api-docs/13-news.md': 'NewsTab',
}

function extractPaths(md) {
  const paths = new Set()
  for (const m of md.matchAll(/`(\/[^\s`]+)`/g)) paths.add(m[1])
  for (const m of md.matchAll(/^(?:GET|POST|PUT|PATCH|DELETE)\s+(\/\S+)/gm)) paths.add(m[1])
  return [...paths]
}

function extractJsonKeys(md) {
  const keys = new Set()
  for (const block of md.matchAll(/```(?:json)?\n([\s\S]*?)```/g)) {
    for (const m of block[1].matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"\s*:/g)) keys.add(m[1])
  }
  return [...keys]
}

const failures = []

for (const [mdPath, tabName] of Object.entries(MAPPING)) {
  const md = read(mdPath)
  const chunk = tabs[tabName]
  if (!chunk) {
    failures.push(`${CONTENT_PATH}: no "function ${tabName}()" found (mapped from ${mdPath} - update MAPPING if it was renamed)`)
    continue
  }
  for (const path of extractPaths(md)) {
    if (!chunk.includes(path)) failures.push(`${mdPath}: path "${path}" not found in ${tabName}`)
  }
  for (const key of extractJsonKeys(md)) {
    if (!chunk.includes(`"${key}"`)) failures.push(`${mdPath}: JSON key "${key}" not found in ${tabName}`)
  }
}

// ── Enum cross-check ────────────────────────────────────────────────────────
// Example objects for these settings fields must only use real ids, checked
// against the arrays that actually define them - not just against each other.
function realIds(path, re) {
  const ids = new Set()
  for (const m of read(path).matchAll(re)) ids.add(m[1])
  return ids
}
const REAL_IDS = {
  home_section_visibility: realIds('src/renderer/src/lib/homeSections.tsx', /id:\s*'([a-zA-Z0-9_-]+)'/g),
  nav_visibility: realIds('src/renderer/src/lib/navItems.tsx', /view:\s*'([a-zA-Z0-9_-]+)'/g),
  nav_order: realIds('src/renderer/src/lib/navItems.tsx', /view:\s*'([a-zA-Z0-9_-]+)'/g),
  nav_control_visibility: realIds('src/renderer/src/lib/navItems.tsx', /id:\s*'([a-zA-Z0-9_-]+)'/g),
  nav_control_order: realIds('src/renderer/src/lib/navItems.tsx', /id:\s*'([a-zA-Z0-9_-]+)'/g),
}

function checkEnumExamples(sourceLabel, text) {
  for (const [field, ids] of Object.entries(REAL_IDS)) {
    const re = new RegExp(`"${field}":\\s*(\\{[^}]*\\}|\\[[^\\]]*\\])`, 'g')
    for (const m of text.matchAll(re)) {
      for (const idMatch of m[1].matchAll(/"([a-zA-Z0-9_-]+)"/g)) {
        const id = idMatch[1]
        if (id === '...') continue // placeholder ellipsis, not a real value
        if (!ids.has(id)) {
          failures.push(`${sourceLabel}: "${field}" example uses unknown id "${id}" (real ids: ${[...ids].join(', ')})`)
        }
      }
    }
  }
}
checkEnumExamples('docs/api-docs/08-accounts.md', read('docs/api-docs/08-accounts.md'))
checkEnumExamples(CONTENT_PATH, tabs.AccountsTab ?? content)

if (failures.length) {
  console.error(`Docs drift check failed (${failures.length} issue${failures.length === 1 ? '' : 's'}):\n`)
  for (const f of failures) console.error(' - ' + f)
  process.exit(1)
}
console.log('Docs drift check passed.')
