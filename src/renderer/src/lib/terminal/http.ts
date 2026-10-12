import { authHeaders } from '../apiClient'
import { routeUrl } from '../apiServers'
import { getToken } from '../userApi'
import { confirmAction, fail, type TermCommand } from './types'

// The raw escape hatch: any request the UI can make, sent as typed. It goes to
// the same API base (and the same route rules) as the app, signed with your
// token, so it can do exactly what your account can - no more. The named
// commands are the friendly way; this covers whatever has no command yet.
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']
const USAGE = 'http <GET|POST|PUT|PATCH|DELETE> </path[?query]> [json body] [--noauth] [-y]'
const MAX_OUT = 20000

export const HTTP_COMMANDS: TermCommand[] = [
  {
    name: 'http', aliases: ['curl'], group: 'App', usage: USAGE,
    description: 'Send any API request by hand, e.g. http GET /library/favorites/ or http PATCH /accounts/account/me/ {"bio":"hi"}',
    covers: ['*'],
    complete: (before, partial) => (before.length === 0 ? METHODS.filter((m) => m.startsWith(partial.toUpperCase())) : []),
    run: async (args, ctx) => {
      // The body is everything after the path, kept raw so its quotes survive;
      // flags are only read ahead of it.
      let rest = args.trim()
      const flags = new Set<string>()
      for (let m = /^(--noauth|-y|--yes)(?:\s+|$)/.exec(rest); m; m = /^(--noauth|-y|--yes)(?:\s+|$)/.exec(rest)) {
        flags.add(m[1]); rest = rest.slice(m[0].length)
      }
      const [methodWord = '', pathWord = ''] = rest.split(/\s+/)
      const method = methodWord.toUpperCase()
      if (!METHODS.includes(method) || !pathWord) fail(`usage: ${USAGE}`)
      if (!pathWord.startsWith('/')) fail('the path must start with / (it is sent to the app’s API, never to another site)')
      let body = rest.slice(rest.indexOf(pathWord) + pathWord.length).trim()
      // Trailing flags after the body.
      for (let m = /\s+(--noauth|-y|--yes)\s*$/.exec(body); m; m = /\s+(--noauth|-y|--yes)\s*$/.exec(body)) {
        flags.add(m[1]); body = body.slice(0, m.index)
      }
      if (body && (method === 'GET' || method === 'HEAD')) fail(`${method} takes no body - put parameters in the path (?a=1&b=2)`)
      if (body) { try { JSON.parse(body) } catch { fail('the body has to be JSON, e.g. {"name":"x"}') } }

      const yes = flags.has('-y') || flags.has('--yes')
      if (method === 'DELETE' && !confirmAction(ctx, `Send DELETE ${pathWord}?`, yes)) return

      const headers: Record<string, string> = { ...(flags.has('--noauth') ? {} : authHeaders(getToken())) }
      if (body) headers['Content-Type'] = 'application/json'
      const res = await fetch(routeUrl(pathWord), { method, headers, body: body || undefined, signal: ctx.signal })

      const type = res.headers.get('content-type') ?? ''
      const status = `${res.status} ${res.statusText}`.trim()
      let text = ''
      if (method !== 'HEAD' && res.status !== 204) {
        if (/json|text|xml|javascript/i.test(type) || type === '') {
          text = await res.text()
          if (/json/i.test(type)) { try { text = JSON.stringify(JSON.parse(text), null, 2) } catch { /* show it as sent */ } }
        } else {
          const bytes = (await res.blob()).size
          text = `(${type}, ${bytes} bytes - not shown)`
        }
      }
      const shown = text.length > MAX_OUT ? `${text.slice(0, MAX_OUT)}\n… ${text.length - MAX_OUT} more characters` : text
      if (!res.ok) { if (shown) ctx.print(shown, 'error'); fail(`HTTP ${status}`) }
      ctx.print(`HTTP ${status}`, 'ok')
      if (shown) ctx.print(shown)
    },
  },
]
