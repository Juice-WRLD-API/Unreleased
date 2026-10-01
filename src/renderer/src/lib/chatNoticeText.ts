import { relativeTime } from '../components/adminShared'
import { CHAT_COMMANDS } from './chatCommands'
import type { LocalNoticePayload } from './chatShare'
import { allSkins } from './skins'

// Plain-markdown rendering of a local notice, for the `-s` flag: instead of the
// private card, the command posts this as an ordinary message the whole room
// sees. Deliberately text rather than a new card payload - nothing in the
// message is trusted-by-format, so other clients (and DMs) need no new decoder.
export function noticeToText(payload: LocalNoticePayload): string | null {
  switch (payload.kind) {
    case 'help':
      return ['**Commands**', ...CHAT_COMMANDS.filter((c) => c.name !== 'help').map((c) => `- \`${c.usage}\` - ${c.description}`)].join('\n')
    case 'themeList':
      return `**Themes:** ${allSkins().map((s) => s.name).join(', ')}`
    case 'broadcastHistory':
      return payload.items.length === 0
        ? '**Past broadcasts:** none yet'
        : ['**Past broadcasts**', ...payload.items.map((b) => `- **${b.level}**${b.title ? ` ${b.title}:` : ':'} ${b.message} (${b.sender}, ${relativeTime(b.sent_at)})`)].join('\n')
    case 'changelog': {
      const { tip, built, deployed, branch } = payload.status
      const [subject] = tip.message.split('\n')
      const state = built === 'live' ? '✅ Built and live'
        : built === 'building' ? `⏳ Not built yet (site is on ${deployed})`
        : 'Build status unknown'
      return `**Latest commit** \`${tip.sha.slice(0, 7)}\` on \`${branch}\` - ${subject || 'No message'}\n${tip.author} · ${relativeTime(tip.date)}\n${state}`
    }
    case 'npHistory':
      return payload.items.length === 0
        ? '**Recently played:** nothing yet'
        : ['**Recently played**', ...payload.items.map((p, i) => `${i + 1}. ${p.name} - ${relativeTime(p.played_at)}`)].join('\n')
    default:
      return null
  }
}
