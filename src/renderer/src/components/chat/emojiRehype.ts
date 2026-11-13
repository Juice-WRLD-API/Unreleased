import type { Element, ElementContent, Root, Text } from 'hast'
import { EMOJI_IMG, splitChatEmoji } from './emoji'

function splitText(node: Text): ElementContent[] {
  const parts = splitChatEmoji(node.value)
  if (parts.length === 1 && !parts[0].name) return [node]
  return parts.map(({ text, name }) => {
    if (!name) return { type: 'text', value: text }
    const img: Element = {
      type: 'element',
      tagName: 'img',
      properties: { src: EMOJI_IMG[name], alt: `:${name}:`, title: `:${name}:`, 'data-emoji': name },
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
