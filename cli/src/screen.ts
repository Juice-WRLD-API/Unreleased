import { emitKeypressEvents } from 'node:readline'

// A full-terminal mode for the commands that take over the screen (watch,
// matrix, wordle, heardle) - the CLI's version of the site terminal's
// TerminalScreens. It switches to the alternate screen, takes the keyboard
// from the shell's line editor for as long as it's open, and gives both back
// as they were, so the scrollback is untouched afterwards.

export interface Key { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; sequence?: string }

export interface Screen {
  readonly cols: number
  readonly rows: number
  /** Replaces what's on screen with these lines (ANSI colours allowed; each
   *  is cut to the terminal's width, and anything past its height is dropped). */
  draw(lines: string[]): void
  /** Closes the screen; `message` is printed in the normal scrollback after. */
  exit(message?: string): void
  readonly closed: boolean
}

export interface ScreenBody {
  start(screen: Screen): void | Promise<void>
  key(str: string | undefined, key: Key, screen: Screen): void
  resize?(screen: Screen): void
  /** Clean up (timers, players). Runs once, when the screen closes. */
  stop?(): void
}

let active = false
export const screenActive = (): boolean => active
export const canOpenScreen = (): boolean => !!process.stdin.isTTY && !!process.stdout.isTTY

/** Cuts a line to `width` visible characters, leaving ANSI escapes whole. */
export function clip(line: string, width: number): string {
  let out = ''
  let seen = 0
  let styled = false
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\x1b') {
      const m = /^\x1b\[[0-9;?]*[A-Za-z]/.exec(line.slice(i))
      if (m) { out += m[0]; i += m[0].length - 1; styled = true; continue }
    }
    if (seen >= width) break
    out += line[i]
    seen++
  }
  return styled ? `${out}\x1b[0m` : out
}

/** Visible width of a line (ANSI escapes don't count). */
export const visibleLength = (line: string): number => line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').length

/** Breaks plain text into lines no wider than `width`. */
export function wrapText(text: string, width: number): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    if (line.length <= width) { out.push(line); continue }
    for (let i = 0; i < line.length; i += width) out.push(line.slice(i, i + width))
  }
  return out
}

export function openScreen(body: ScreenBody): Promise<string | undefined> {
  if (!canOpenScreen()) return Promise.reject(new Error('that needs an interactive terminal'))
  if (active) return Promise.reject(new Error('a full-screen command is already open'))
  const stdin = process.stdin
  const stdout = process.stdout
  // Whoever is reading keys now (the shell's line editor, Ctrl+R) steps aside.
  const borrowed = stdin.listeners('keypress') as ((...args: unknown[]) => void)[]
  for (const l of borrowed) stdin.removeListener('keypress', l)
  emitKeypressEvents(stdin)
  const wasRaw = stdin.isRaw
  stdin.setRawMode(true)
  stdin.resume()
  stdout.write('\x1b[?1049h\x1b[?25l\x1b[H\x1b[2J')
  active = true

  return new Promise((resolve) => {
    let closed = false
    const restoreTerminal = (): void => { stdout.write('\x1b[0m\x1b[?25h\x1b[?1049l') }

    const screen: Screen = {
      get cols() { return stdout.columns || 80 },
      get rows() { return stdout.rows || 24 },
      get closed() { return closed },
      draw(lines) {
        if (closed) return
        const rows = this.rows
        const cols = this.cols
        const shown = lines.slice(0, rows)
        // The last row stops a column short: writing into the bottom-right
        // cell makes some terminals scroll.
        const body = shown.map((l, i) => `${clip(l, i === rows - 1 ? cols - 1 : cols)}\x1b[K`).join('\r\n')
        stdout.write(`\x1b[H${body}\x1b[J`)
      },
      exit(message) {
        if (closed) return
        closed = true
        try { body.stop?.() } catch { /* closing anyway */ }
        stdin.removeListener('keypress', onKey)
        stdout.removeListener('resize', onResize)
        process.removeListener('exit', restoreTerminal)
        restoreTerminal()
        stdin.setRawMode(wasRaw)
        for (const l of borrowed) stdin.on('keypress', l)
        if (borrowed.length === 0) stdin.pause()
        active = false
        resolve(message)
      },
    }

    const onKey = (str: string | undefined, key: Key | undefined): void => {
      try { body.key(str, key ?? {}, screen) } catch (err) { screen.exit((err as Error).message) }
    }
    const onResize = (): void => { try { body.resize?.(screen) } catch { /* next draw fixes it */ } }
    stdin.on('keypress', onKey)
    stdout.on('resize', onResize)
    // A crash or exit while the screen is up must not leave the terminal in
    // the alternate buffer with no cursor.
    process.on('exit', restoreTerminal)
    Promise.resolve()
      .then(() => body.start(screen))
      .catch((err) => screen.exit(`${(err as Error).message}`))
  })
}
