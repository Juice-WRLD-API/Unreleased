import type { CommandCardPayload, LocalNoticePayload } from './chatShare'
import { CHAT_COMMANDS } from './chatCommands'
import { allSkins } from './skins'

// What `-s` posts to the room when the server can't build the card itself (the
// changelog, themes, plain results, and anything in an encrypted DM): the same
// answer as the command's card, as plain markdown text. The card is never
// carried in a message - the server stores chat text verbatim and posts as
// whoever sent it, so a card that rendered from message text could be forged by
// anyone. Text is just text: it can say anything, but it looks like what it is,
// an ordinary message.
const MAX_TEXT = 4000

const when = (iso: string): string => {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'unknown time'
}

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

const BUILT_TEXT = { live: 'Built and live', building: 'Not built yet', unknown: 'Build status unknown' } as const

// A heading line, then the rest one per line. The heading always survives;
// trailing lines are dropped until the whole thing fits a message.
function fit(heading: string, lines: string[]): string {
  const out = [...lines]
  while (out.length > 0 && [heading, ...out].join('\n').length > MAX_TEXT) out.pop()
  return [heading, ...out].join('\n')
}

export function commandCardText(payload: LocalNoticePayload): string | null {
  if (payload.kind === 'feedbackSent') return null
  const card: CommandCardPayload = payload
  switch (card.kind) {
    case 'help':
      return fit('**Commands**', CHAT_COMMANDS.filter((c) => c.name !== 'help').map((c) => `- \`${c.usage}\` - ${c.description}`))
    case 'themeList':
      return fit('**Themes**', [allSkins().map((s) => s.name).join(', ')])
    case 'result':
      return fit(`**${oneLine(card.title)}**`, [card.text])
    case 'npNow':
      return `**${oneLine(card.user)} is listening to**\n${oneLine(card.name)} (${when(card.updated_at)})`
    case 'npHistory': {
      const lines = card.items.map((p, i) => `${i + 1}. ${oneLine(p.name)} - ${when(p.played_at)}`)
      if (lines.length === 0) lines.push('No listening history yet.')
      if (card.total > card.items.length) lines.push(`${card.items.length} of ${card.total} plays logged.`)
      return fit(card.user ? `**${oneLine(card.user)}'s recent plays**` : '**Recently played**', lines)
    }
    case 'broadcastHistory': {
      const lines = card.items.map((b) => `- [${b.level}] ${b.title ? `${oneLine(b.title)}: ` : ''}${oneLine(b.message)} - ${oneLine(b.sender)}, ${when(b.sent_at)}`)
      if (lines.length === 0) lines.push('No broadcasts have been sent yet.')
      if (card.total > card.items.length) lines.push(`Showing the latest ${card.items.length} of ${card.total}.`)
      return fit('**Past broadcasts**', lines)
    }
    case 'changelog': {
      const { tip, history, built, branch, running } = card.status
      // Marks the commit this build was made from, when it's one of those listed.
      const here = (c: typeof tip): string => (running && running !== 'dev' && running !== 'unknown' && c.sha.startsWith(running) ? ' ◀ this build' : '')
      const line = (c: typeof tip): string => `[\`${c.sha.slice(0, 7)}\`](${c.url}) ${oneLine(c.message.split('\n')[0] || 'No message')}`
      const lines = [
        `${line(tip)} - ${oneLine(tip.author)}, ${when(tip.date)}${here(tip)}`,
        BUILT_TEXT[built],
        ...(history ?? []).map((c) => `- ${line(c)} - ${when(c.date)}${here(c)}`),
      ]
      return fit(`**Latest commit** on ${oneLine(branch)}`, lines)
    }
    default:
      return null
  }
}
