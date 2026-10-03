import { fetchStream } from '../api'

// Stands in for the site's lib/apiClient.ts inside heardle.ts and versionsApi.ts:
// a GET of a full URL that resolves to its JSON (with the CLI's token, user
// agent and Ctrl+C), and the auth header builder.

export async function apiRequest<T>(url: string): Promise<T> {
  const res = await fetchStream(url)
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Token ${token}` } : {}
}
