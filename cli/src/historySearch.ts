import type { Interface } from 'node:readline'
import { color } from './out'
import { clip, screenActive, type Key } from './screen'

// Ctrl+R, bash style: Node's line editor has no reverse search, so while one
// is open it takes the keyboard (the editor's own key handler steps aside),
// and hands the result back through the editor's public write() as if typed.
//
//   type          narrows to the newest command containing the text
//   Ctrl+R again  steps to the next older match
//   Enter         runs the match
//   Esc, ← → Tab  puts it on the line to edit
//   Ctrl+C / G    gives up, leaving the line as it was

type Rl = Interface & { line: string; cursor: number }
type Listener = (...args: unknown[]) => void

let searching = false
export const historySearchActive = (): boolean => searching

/** `closed` runs when a search ends, before the prompt is redrawn (anything
 *  held back while it was open can print then). */
export function installHistorySearch(
  rl: Rl, history: () => string[], idle: () => boolean, closed: () => void = () => undefined,
  stdin: NodeJS.ReadStream = process.stdin, out: NodeJS.WriteStream = process.stdout,
): void {
  const onKey = (_str: unknown, key: Key | undefined): void => {
    if (key?.ctrl && key.name === 'r' && !key.meta && idle() && !screenActive() && !searching) start()
  }
  stdin.on('keypress', onKey)

  function start(): void {
    searching = true
    const original = rl.line
    const borrowed = (stdin.listeners('keypress') as Listener[]).filter((l) => l !== onKey)
    for (const l of borrowed) stdin.removeListener('keypress', l)
    stdin.removeListener('keypress', onKey)

    // Newest first, each command once.
    const entries = [...new Set([...history()].reverse())]
    let query = ''
    let skip = 0
    let match = ''
    let failed = false

    const find = (): void => {
      if (!query) { match = ''; failed = false; return }
      const hits = entries.filter((h) => h.includes(query))
      if (hits.length === 0) { failed = true; return }
      if (skip >= hits.length) { skip = hits.length - 1; failed = true } else failed = false
      match = hits[skip]
    }

    const draw = (): void => {
      const label = failed ? '(failed reverse-i-search)' : '(reverse-i-search)'
      const at = match && query ? match.indexOf(query) : -1
      const shown = at === -1 ? match : `${match.slice(0, at)}${color.bold(query)}${match.slice(at + query.length)}`
      out.write(`\r\x1b[2K${clip(`${color.dim(label)}\`${query}': ${shown}`, (out.columns || 80) - 1)}`)
    }

    const finish = (line: string, run: boolean): void => {
      stdin.removeListener('keypress', onSearchKey)
      for (const l of borrowed) stdin.on('keypress', l)
      stdin.on('keypress', onKey)
      searching = false
      out.write('\r\x1b[2K')
      closed()
      rl.line = ''
      rl.cursor = 0
      rl.prompt(true)
      if (line) rl.write(line)
      if (run) rl.write('', { name: 'return' })
    }

    const onSearchKey = (str: string | undefined, key: Key = {}): void => {
      if (key.ctrl && key.name === 'r') { if (query) { skip++; find() } draw(); return }
      if (key.ctrl && (key.name === 'c' || key.name === 'g')) { finish(original, false); return }
      if (key.name === 'return') { finish(match || original, !!match); return }
      if (key.name === 'escape' || ['left', 'right', 'tab', 'home', 'end', 'up', 'down'].includes(key.name ?? '')) {
        finish(match || original, false)
        return
      }
      if (key.name === 'backspace') { query = query.slice(0, -1); skip = 0; find(); draw(); return }
      if (str && !key.ctrl && !key.meta && str.length === 1 && str >= ' ') { query += str; skip = 0; find(); draw() }
    }

    stdin.on('keypress', onSearchKey)
    find()
    draw()
  }
}
