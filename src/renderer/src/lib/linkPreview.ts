// Link previews for chat messages. The metadata comes from the social-preview
// service's /unfurl endpoint (server/social-preview.mjs), not from the linked
// site directly: a browser can't read another origin's og: tags, and asking
// from here would also tell that site who is looking at the message.

export interface LinkPreview {
  url: string
  title: string
  description?: string
  image?: string
  siteName: string
}

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi
// Direct media links have no page to unfurl.
const MEDIA_EXT_RE = /\.(gif|png|jpe?g|webp|avif|svg|mp4|webm|mov|mp3|wav|ogg|flac|m4a)$/i

// Trailing punctuation belongs to the sentence, not the URL; a closing bracket
// stays only when the URL opened one ("...wiki/Foo_(bar)").
function trimUrl(raw: string): string {
  let url = raw
  for (;;) {
    const last = url[url.length - 1]
    if (/[.,;:!?'*_~]/.test(last)) url = url.slice(0, -1)
    else if (last === ')' && (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0)) url = url.slice(0, -1)
    else if ((last === ']' || last === '}') && !url.includes(last === ']' ? '[' : '{')) url = url.slice(0, -1)
    else return url
  }
}

/** The first link in a message worth previewing, or null. Code is skipped, as
 *  are links back to this site (those already have their own cards) and
 *  direct media files. */
export function firstPreviewUrl(text: string, ownOrigin: string = window.location.origin): string | null {
  const prose = text.replace(/```[\s\S]*?```|`[^`\n]*`/g, ' ')
  for (const match of prose.matchAll(URL_RE)) {
    const candidate = trimUrl(match[0])
    let parsed: URL
    try {
      parsed = new URL(candidate)
    } catch {
      continue
    }
    if (parsed.origin === ownOrigin || MEDIA_EXT_RE.test(parsed.pathname)) continue
    return candidate
  }
  return null
}

const CACHE_MAX = 200
// A promise per URL, so a message shown in several places (thread, pins) or
// re-rendered costs one request. Misses are kept too - the endpoint says 404
// for "nothing to show" and that answer doesn't change in a session. Network
// failures and rate limits are dropped so they're retried.
const cache = new Map<string, Promise<LinkPreview | null>>()

function parsePreview(raw: unknown): LinkPreview | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  if (typeof p.url !== 'string' || typeof p.title !== 'string' || !p.title) return null
  return {
    url: p.url,
    title: p.title,
    description: typeof p.description === 'string' ? p.description : undefined,
    // The page's CSP only lets https images through anyway.
    image: typeof p.image === 'string' && p.image.startsWith('https://') ? p.image : undefined,
    siteName: typeof p.siteName === 'string' && p.siteName ? p.siteName : new URL(p.url).hostname,
  }
}

export function loadLinkPreview(url: string): Promise<LinkPreview | null> {
  const hit = cache.get(url)
  if (hit) return hit
  const job = fetch(`/unfurl?url=${encodeURIComponent(url)}`, { credentials: 'omit' })
    .then(async (res) => {
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`unfurl ${res.status}`)
      return parsePreview(await res.json())
    })
    .catch(() => {
      cache.delete(url)
      return null
    })
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
  cache.set(url, job)
  return job
}
