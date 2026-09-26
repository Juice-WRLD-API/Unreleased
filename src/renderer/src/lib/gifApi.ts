// GIF search/trending for the chat GIF picker. Supports Tenor and Giphy -
// whichever key is present in the env is used (Tenor preferred if both are
// set). Needs a free API key: Tenor via Google Cloud console
// (https://developers.google.com/tenor/guides/quickstart) or Giphy via
// https://developers.giphy.com/. Set VITE_TENOR_API_KEY or
// VITE_GIPHY_API_KEY in .env.local before building. Without either,
// gifPickerConfigured() is false and the picker button stays hidden.

const TENOR_API_KEY = (import.meta.env.VITE_TENOR_API_KEY as string | undefined) ?? ''
const GIPHY_API_KEY = (import.meta.env.VITE_GIPHY_API_KEY as string | undefined) ?? ''

// Identifies this app to Tenor's API, as their client_key param expects -
// unrelated to the secret API key.
const TENOR_CLIENT_KEY = 'unreleased-chat'

export type GifProvider = 'tenor' | 'giphy'

export function gifProvider(): GifProvider | null {
  if (TENOR_API_KEY) return 'tenor'
  if (GIPHY_API_KEY) return 'giphy'
  return null
}

export function gifPickerConfigured(): boolean {
  return gifProvider() !== null
}

export interface GifResult {
  id: string
  title: string
  previewUrl: string
  url: string
  width: number
  height: number
}

interface TenorMediaFormat { url: string; dims: [number, number] }
interface TenorResult {
  id: string
  content_description?: string
  media_formats: { gif?: TenorMediaFormat; tinygif?: TenorMediaFormat }
}

async function tenorFetch(path: string, params: Record<string, string>): Promise<GifResult[]> {
  const qs = new URLSearchParams({ key: TENOR_API_KEY, client_key: TENOR_CLIENT_KEY, limit: '30', media_filter: 'gif,tinygif', ...params })
  const res = await fetch(`https://tenor.googleapis.com/v2/${path}?${qs.toString()}`)
  if (!res.ok) throw new Error(`Tenor request failed (${res.status})`)
  const data = (await res.json()) as { results?: TenorResult[] }
  return (data.results ?? [])
    .filter((r) => r.media_formats.gif)
    .map((r) => ({
      id: r.id,
      title: r.content_description || 'GIF',
      previewUrl: (r.media_formats.tinygif ?? r.media_formats.gif!).url,
      url: r.media_formats.gif!.url,
      width: r.media_formats.gif!.dims[0],
      height: r.media_formats.gif!.dims[1],
    }))
}

interface GiphyImage { url: string; width: string; height: string }
interface GiphyResult { id: string; title?: string; images: { original: GiphyImage; fixed_width: GiphyImage } }

async function giphyFetch(path: string, params: Record<string, string>): Promise<GifResult[]> {
  const qs = new URLSearchParams({ api_key: GIPHY_API_KEY, limit: '30', rating: 'pg-13', ...params })
  const res = await fetch(`https://api.giphy.com/v1/gifs/${path}?${qs.toString()}`)
  if (!res.ok) throw new Error(`Giphy request failed (${res.status})`)
  const data = (await res.json()) as { data?: GiphyResult[] }
  return (data.data ?? []).map((g) => ({
    id: g.id,
    title: g.title || 'GIF',
    previewUrl: g.images.fixed_width.url,
    url: g.images.original.url,
    width: Number(g.images.original.width) || 0,
    height: Number(g.images.original.height) || 0,
  }))
}

export async function searchGifs(query: string): Promise<GifResult[]> {
  const provider = gifProvider()
  if (!provider) return []
  return provider === 'tenor' ? tenorFetch('search', { q: query }) : giphyFetch('search', { q: query })
}

export async function trendingGifs(): Promise<GifResult[]> {
  const provider = gifProvider()
  if (!provider) return []
  return provider === 'tenor' ? tenorFetch('featured', {}) : giphyFetch('trending', {})
}

export async function fetchGifFile(gif: GifResult): Promise<File> {
  const res = await fetch(gif.url)
  if (!res.ok) throw new Error('Could not load GIF')
  const blob = await res.blob()
  const slug = gif.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return new File([blob], `${slug || 'gif'}-${gif.id}.gif`, { type: blob.type || 'image/gif' })
}
