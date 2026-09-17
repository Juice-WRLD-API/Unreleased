// Reactions travel as shortcode names ("fire"), so every client renders the
// same glyph for them. Anything not in this table is shown as sent.
export const EMOJI: Record<string, string> = {
  fire: '🔥', heart: '❤️', purple_heart: '💜', broken_heart: '💔', joy: '😂', rofl: '🤣', skull: '💀',
  sob: '😭', eyes: '👀', thumbsup: '👍', thumbsdown: '👎', pray: '🙏', clap: '👏', raised_hands: '🙌',
  muscle: '💪', ok_hand: '👌', wave: '👋', '100': '💯', tada: '🎉', sparkles: '✨', star: '⭐',
  rocket: '🚀', goat: '🐐', crown: '👑', gem: '💎', zap: '⚡', headphones: '🎧', musical_note: '🎵',
  microphone: '🎤', cd: '💿', thinking: '🤔', smile: '😄', grin: '😁', wink: '😉', heart_eyes: '😍',
  sunglasses: '😎', flushed: '😳', cry: '😢', rage: '😡', sweat_smile: '😅', shushing: '🤫', salute: '🫡',
  white_check_mark: '✅', x: '❌', warning: '⚠️', bangbang: '‼️', question: '❓', pushpin: '📌', lock: '🔒',
}

export const QUICK_REACTIONS = ['fire', 'heart', 'joy', 'eyes', 'thumbsup', '100']

export const PICKER_GROUPS: { label: string; names: string[] }[] = [
  { label: 'Hype', names: ['fire', '100', 'goat', 'crown', 'gem', 'zap', 'rocket', 'tada', 'sparkles', 'star', 'clap', 'raised_hands', 'muscle', 'salute'] },
  { label: 'Faces', names: ['joy', 'rofl', 'skull', 'sob', 'smile', 'grin', 'wink', 'heart_eyes', 'sunglasses', 'thinking', 'flushed', 'cry', 'rage', 'sweat_smile', 'shushing', 'eyes'] },
  { label: 'Hearts & hands', names: ['heart', 'purple_heart', 'broken_heart', 'thumbsup', 'thumbsdown', 'pray', 'ok_hand', 'wave'] },
  { label: 'Music', names: ['headphones', 'musical_note', 'microphone', 'cd'] },
  { label: 'Signals', names: ['white_check_mark', 'x', 'warning', 'bangbang', 'question', 'pushpin', 'lock'] },
]

export function emojiGlyph(name: string): string {
  return EMOJI[name] ?? name
}

// iOS-style PNGs for every glyph above, keyed by the same shortcode name.
const iosImages = import.meta.glob('../../assets/emoji/apple/*.png', { eager: true, import: 'default' }) as Record<string, string>
export const EMOJI_IMG: Record<string, string> = {}
for (const [path, url] of Object.entries(iosImages)) {
  const name = path.slice(path.lastIndexOf('/') + 1, -'.png'.length)
  EMOJI_IMG[name] = url
}

// Reverse lookup so raw glyphs typed or pasted into message text can be
// swapped for their iOS image too, longest glyph first to prefer full
// sequences (e.g. the heart's variation selector) over bare prefixes.
export const NAME_BY_GLYPH: Record<string, string> = Object.fromEntries(
  Object.entries(EMOJI).map(([name, glyph]) => [glyph, name]),
)
export const GLYPHS_BY_LENGTH_DESC = Object.values(EMOJI).sort((a, b) => b.length - a.length)

const RECENT_KEY = 'unreleased:chat:recentEmoji'

export function recentEmoji(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]
    return Array.isArray(list) ? list.slice(0, 8) : []
  } catch {
    return []
  }
}

export function rememberEmoji(name: string): void {
  try {
    const next = [name, ...recentEmoji().filter((n) => n !== name)].slice(0, 8)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {}
}

// Most-recently-used reactions first, padded out with the defaults so the
// quick-react row always has `count` options even before a user reacts.
export function quickReactions(count = 3): string[] {
  const recent = recentEmoji()
  const merged = [...recent, ...QUICK_REACTIONS.filter((n) => !recent.includes(n))]
  return merged.slice(0, count)
}
