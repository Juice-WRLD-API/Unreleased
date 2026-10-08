// Forwarding posts a normal new message in the target room (there's no
// server-side "forwarded message" relation), so the link back to the
// original travels inside the message body itself: the first line is a
// small JSON envelope the UI parses back out and renders as a Discord-style
// forwarded-message card (see ForwardBar in MessageItem.tsx), instead of the
// forwarder's own words indistinguishable from something they typed.
export interface ForwardRef {
  id: number
  authorId: number
  name: string
  snippet: string
  hasAttachment: boolean
  sourceLabel: string
}

const MARK = ':::forward:::'

export function encodeForwardRef(ref: ForwardRef): string {
  return `${MARK}${JSON.stringify(ref)}\n`
}

export function splitForwardRef(content: string): { ref: ForwardRef | null; body: string } {
  if (!content.startsWith(MARK)) return { ref: null, body: content }
  const rest = content.slice(MARK.length)
  const nl = rest.indexOf('\n')
  const line = nl === -1 ? rest : rest.slice(0, nl)
  const body = nl === -1 ? '' : rest.slice(nl + 1)
  try {
    const parsed = JSON.parse(line) as Partial<ForwardRef>
    if (typeof parsed.id === 'number' && typeof parsed.authorId === 'number' && typeof parsed.name === 'string') {
      return {
        ref: {
          id: parsed.id,
          authorId: parsed.authorId,
          name: parsed.name,
          snippet: typeof parsed.snippet === 'string' ? parsed.snippet : '',
          hasAttachment: !!parsed.hasAttachment,
          sourceLabel: typeof parsed.sourceLabel === 'string' ? parsed.sourceLabel : '',
        },
        body,
      }
    }
  } catch {
    // Not a forward envelope - fall through and render the content as-is.
  }
  return { ref: null, body: content }
}
