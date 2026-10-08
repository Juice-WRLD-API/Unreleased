// Non-threaded "Reply" posts a normal message in the room, so the link back
// to the original message travels inside the message body itself: the first
// line is a small JSON envelope the UI parses back out and renders as a
// Discord-style reply bar (see ReplyBar in MessageItem.tsx), instead of a
// generic markdown blockquote mixed into the message text.
export interface ReplyRef {
  id: number
  authorId: number
  name: string
  snippet: string
  hasAttachment: boolean
}

const MARK = ':::reply:::'

export function encodeReplyRef(ref: ReplyRef): string {
  return `${MARK}${JSON.stringify(ref)}\n`
}

export function splitReplyRef(content: string): { ref: ReplyRef | null; body: string } {
  if (!content.startsWith(MARK)) return { ref: null, body: content }
  const rest = content.slice(MARK.length)
  const nl = rest.indexOf('\n')
  const line = nl === -1 ? rest : rest.slice(0, nl)
  const body = nl === -1 ? '' : rest.slice(nl + 1)
  try {
    const parsed = JSON.parse(line) as Partial<ReplyRef>
    if (typeof parsed.id === 'number' && typeof parsed.authorId === 'number' && typeof parsed.name === 'string') {
      return {
        ref: {
          id: parsed.id,
          authorId: parsed.authorId,
          name: parsed.name,
          snippet: typeof parsed.snippet === 'string' ? parsed.snippet : '',
          hasAttachment: !!parsed.hasAttachment,
        },
        body,
      }
    }
  } catch {
    // Not a reply envelope - fall through and render the content as-is.
  }
  return { ref: null, body: content }
}
