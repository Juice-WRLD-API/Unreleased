// Per-route metadata for the web build.
//
// The site is a client-rendered SPA, so every route ships the same index.html:
// without this every page in Google looks identical, and the site-wide title
// and description in index.html are the only thing a crawler ever records.
// applySeo() rewrites title / description / canonical / robots / og+twitter
// after each navigation — Googlebot renders JS and reads the post-render head,
// so per-route titles do land.
//
// Deliberately not indexable: per-user views (liked, stats, library,
// playlists), authoring surfaces (editor, contributor, admin), share links,
// the OAuth callback, and anything still dark (news). Those also get a
// Disallow in public/robots.txt.

import { ViewType } from '../types'

const ORIGIN = 'https://player.juicewrldapi.com'
const SITE = 'unreleased'

const DEFAULT_DESCRIPTION =
  "Stream Juice WRLD's full catalog — every released and unreleased song — free in your browser. Search by era, producer or engineer, build playlists, listen to 999 FM radio, and read synced lyrics."

type SeoEntry = {
  /** Canonical path for the view. Omitted for views with no stable URL. */
  path?: string
  /** Rendered as "<title> · unreleased" unless it already names the site. */
  title: string
  description: string
  noindex?: boolean
}

const ROUTES: Record<ViewType, SeoEntry> = {
  'api-tracker': {
    // Canonical on the root, not /tracker: the two render the same view and
    // the root is what people link to. /tracker consolidates into it.
    path: '/',
    title: 'unreleased — Juice WRLD music player',
    description: DEFAULT_DESCRIPTION,
  },
  'api-files': {
    path: '/files',
    title: 'Files',
    description:
      'Browse the Juice WRLD API filesystem folder by folder — stream any track in place or download the original file.',
  },
  wrld: {
    path: '/wrld',
    title: '999 FM — live Juice WRLD radio',
    description:
      'A 24/7 Juice WRLD radio station. See what everyone is listening to in real time, vote to skip, suggest the next song, and preview the upcoming queue.',
  },
  heardle: {
    path: '/heardle',
    title: 'Heardle — the daily Juice WRLD song game',
    description:
      'Guess the Juice WRLD song from its opening second. A new track every day, drawn from the released and unreleased catalog.',
  },
  wordle: {
    path: '/wordle',
    title: 'Wordle — the daily Juice WRLD song title game',
    description:
      'Guess the Juice WRLD song title letter by letter. A new title every day, and every guess is a real track from the released and unreleased catalog.',
  },
  tierlist: {
    path: '/tierlist',
    title: 'Tier List — rank Juice WRLD songs',
    description:
      'Build a tier list of Juice WRLD songs, released and unreleased. Drag tracks into S through D tiers and save your ranking.',
  },
  docs: {
    path: '/docs',
    title: 'Docs',
    description:
      'How to use the unreleased player: search and filters, playlists, the equalizer, offline downloads, Last.fm scrobbling, and keyboard shortcuts.',
  },
  statistics: {
    path: '/statistics',
    title: 'Catalog statistics',
    description:
      'How big the Juice WRLD catalog is: total songs, the split across released, unreleased, unsurfaced and recording sessions, and a per-era breakdown.',
  },
  download: {
    path: '/download',
    title: 'Download the desktop app',
    description:
      'Get unreleased for Windows, macOS and Linux — local file playback, offline downloads, Discord Rich Presence, global hotkeys, and pop-out windows.',
  },

  // Personal or unstable surfaces: crawlable in principle, worthless in an
  // index, and in several cases they render empty for a signed-out crawler.
  home: { path: '/home', title: 'Home', description: 'Your playlists, games and listening stats.', noindex: true },
  liked: { path: '/liked', title: 'Liked songs', description: 'Your liked Juice WRLD songs.', noindex: true },
  playlists: { path: '/playlists', title: 'Playlists', description: 'Your playlists and folders.', noindex: true },
  stats: { path: '/stats', title: 'Listening stats', description: 'Your all-time listening stats.', noindex: true },
  settings: { path: '/settings', title: 'Settings', description: 'App settings and preferences.', noindex: true },
  editor: { path: '/editor', title: 'Editor', description: 'Catalog editing tools.', noindex: true },
  contributor: { path: '/contributor', title: 'Contributor', description: 'Contributor tools.', noindex: true },
  admin: { path: '/admin', title: 'Admin', description: 'Administration.', noindex: true },
  'albums-admin': { title: 'Albums', description: 'Album administration.', noindex: true },
  'editor-profile': { title: 'Editor profile', description: 'Your editor profile.', noindex: true },
  'contributor-profile': { title: 'Contributor profile', description: 'Your contributor profile.', noindex: true },
  // Flip noindex off with NEWS_ENABLED when the /news backend ships.
  news: { path: '/news', title: 'News', description: 'Juice WRLD news and announcements.', noindex: true },
  'shared-playlist': { title: 'Shared playlist', description: 'A playlist shared from unreleased.', noindex: true },
  'not-found': { title: 'Page not found', description: 'This page does not exist.', noindex: true },
}

function setMeta(selector: string, attr: 'name' | 'property', key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(selector)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function setLink(rel: string, href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.rel = rel
    document.head.appendChild(el)
  }
  el.href = href
}

/**
 * Rewrite the document head for `view`. Safe to call on every navigation —
 * it only ever mutates tags it owns.
 */
export function applySeo(view: ViewType): void {
  if (typeof document === 'undefined') return

  // `/` renders Home for desktop and installed apps (see getViewFromPath in
  // App.tsx), but it stays the catalog's canonical, indexable URL — a
  // dashboard's noindex must never land on the site root.
  const atRoot = typeof window !== 'undefined' && window.location.pathname === '/'
  const entry = (atRoot ? ROUTES['api-tracker'] : ROUTES[view]) ?? ROUTES['not-found']
  const title = entry.title.includes(SITE) ? entry.title : `${entry.title} · ${SITE}`
  // Views without a canonical path (share links) keep their own URL, minus any
  // query string — ?q= searches and OAuth params must never become canonicals.
  const canonical = ORIGIN + (entry.path ?? window.location.pathname)

  document.title = title
  setMeta('meta[name="description"]', 'name', 'description', entry.description)
  setMeta(
    'meta[name="robots"]',
    'name',
    'robots',
    entry.noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large, max-snippet:-1'
  )
  setLink('canonical', canonical)

  setMeta('meta[property="og:title"]', 'property', 'og:title', title)
  setMeta('meta[property="og:description"]', 'property', 'og:description', entry.description)
  setMeta('meta[property="og:url"]', 'property', 'og:url', canonical)
  setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', title)
  setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', entry.description)
}
