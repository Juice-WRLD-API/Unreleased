import type { Element, ElementContent, Root, Text } from 'hast'
import { EMOJI_IMG, GLYPHS_BY_LENGTH_DESC, NAME_BY_GLYPH } from './emoji'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const EMOJI_RE = new RegExp(`(${GLYPHS_BY_LENGTH_DESC.map(escapeRegExp).join('|')})`, 'g')

function splitText(node: Text): ElementContent[] {
  const parts = node.value.split(EMOJI_RE)
  if (parts.length === 1) return [node]
  return parts.filter((part) => part !== '').map((part) => {
    const name = NAME_BY_GLYPH[part]
    const src = name ? EMOJI_IMG[name] : undefined
    if (!src) return { type: 'text', value: part }
    const img: Element = {
      type: 'element',
      tagName: 'img',
      properties: { src, alt: `:${name}:`, title: `:${name}:`, 'data-emoji': name },
      children: [],
    }
    return img
  })
}

// Skip code/pre so literal emoji typed inside a code block stay as text.
function walk(node: Root | Element): void {
  const children: ElementContent[] = []
  for (const child of node.children) {
    if (child.type === 'doctype') continue
    if (child.type === 'text') {
      children.push(...splitText(child))
    } else {
      if (child.type === 'element' && child.tagName !== 'code' && child.tagName !== 'pre') walk(child)
      children.push(child)
    }
  }
  node.children = children as Root['children'] & Element['children']
}

export default function rehypeChatEmoji() {
  return (tree: Root): void => walk(tree)
}
