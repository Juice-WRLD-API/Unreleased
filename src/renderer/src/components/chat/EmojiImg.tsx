import { EMOJI_IMG, emojiGlyph } from './emoji'

// Renders a reaction/picker entry as its iOS-style PNG, falling back to the
// plain glyph for anything outside our shortcode table.
export default function EmojiImg({ name, className }: { name: string; className?: string }): JSX.Element {
  const src = EMOJI_IMG[name]
  if (!src) return <span className={className}>{emojiGlyph(name)}</span>
  // Lazy because the picker lays out the whole table at once - roughly 1900
  // of these - and they're real asset requests now rather than data: URLs
  // baked into the bundle. Only the rows actually scrolled to get fetched.
  return <img src={src} alt={`:${name}:`} loading="lazy" decoding="async" draggable={false} className={`inline-block object-contain ${className ?? ''}`} />
}
