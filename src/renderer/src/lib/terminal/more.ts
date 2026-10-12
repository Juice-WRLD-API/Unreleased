import { fail, type TermCommand } from './types'

// A long list shows its first page and keeps the rest for `more`, so nothing a
// command cuts off is out of reach. The remainder is whatever the last cut-off
// list left; the next list that is cut off (or any that fits) replaces it.
interface Pending { from: number; count: number; row: (i: number) => string; size: number }
let pending: Pending | null = null

const footer = (left: number): string => `  … ${left} more - type more (more all for everything)`

/** `count` rows, `row(i)` rendering the i-th (only called for rows that are shown).
 *  Returns the first `size` of them, with a note about the rest when there are any. */
export function pageRows(count: number, row: (i: number) => string, size: number): string {
  const shown = Math.min(count, size)
  const lines = Array.from({ length: shown }, (_, i) => row(i))
  pending = count > shown ? { from: shown, count, row, size } : null
  return count > shown ? [...lines, footer(count - shown)].join('\n') : lines.join('\n')
}

/** The same for rows already built. */
export const pageLines = (lines: string[], size: number): string => pageRows(lines.length, (i) => lines[i], size)

export const MORE_COMMANDS: TermCommand[] = [
  {
    name: 'more', group: 'App', usage: 'more [all]',
    description: 'The rest of the last list that was cut short (queue, find, lyricfind, playlist show, liked, admin lists…): the next page, or everything with `all`',
    complete: (before, partial) => (before.length === 0 ? ['all'].filter((w) => w.startsWith(partial.toLowerCase())) : []),
    run: (args, ctx) => {
      const mode = args.trim().toLowerCase()
      if (mode && mode !== 'all') fail('usage: more [all]')
      if (!pending) { ctx.print('nothing more to show', 'dim'); return }
      const { from, count, row, size } = pending
      const end = mode ? count : Math.min(count, from + size)
      const lines = Array.from({ length: end - from }, (_, i) => row(from + i))
      pending = end < count ? { from: end, count, row, size } : null
      ctx.print(end < count ? [...lines, footer(count - end)].join('\n') : lines.join('\n'))
    },
  },
]
