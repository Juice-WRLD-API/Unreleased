import { EMOJI_IMG, emojiGlyph } from './emoji'

// Renders a reaction/picker entry as its iOS-style PNG, falling back to the
// plain glyph for anything outside our shortcode table.
export default function EmojiImg({ name, className }: { name: string; className?: string }): JSX.Element {
  const src = EMOJI_IMG[name]
  if (!src) return <span className={className}>{emojiGlyph(name)}</span>
  return <img src={src} alt={`:${name}:`} draggable={false} className={`inline-block object-contain ${className ?? ''}`} />
}
