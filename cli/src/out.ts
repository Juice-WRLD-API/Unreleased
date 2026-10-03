// Output: the four tones the site terminal prints in, as ANSI colours when the
// stream is a terminal (and NO_COLOR isn't set), plain text otherwise so piping
// into another program gets clean lines.
export type Tone = 'error' | 'ok' | 'plain' | 'dim'

const colorOn = (stream: NodeJS.WriteStream): boolean => !!stream.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb'

const paint = (code: string, stream: NodeJS.WriteStream = process.stdout) => (s: string): string => (colorOn(stream) ? `\x1b[${code}m${s}\x1b[0m` : s)

export const color = {
  red: paint('31'),
  green: paint('32'),
  yellow: paint('33'),
  blue: paint('34'),
  cyan: paint('36'),
  dim: paint('2'),
  bold: paint('1'),
  errRed: paint('31', process.stderr),
  errDim: paint('2', process.stderr),
}

/** Writes one block of output. Errors go to stderr so a one-shot command's
 *  stdout stays clean for a pipe. */
export function writeTone(text: string, tone: Tone): void {
  if (tone === 'error') { process.stderr.write(color.errRed(text) + '\n'); return }
  const painted = tone === 'ok' ? color.green(text) : tone === 'dim' ? color.dim(text) : text
  process.stdout.write(painted + '\n')
}

/** A single status line on stderr that rewrites itself (downloads). Silent
 *  when stderr isn't a terminal. */
export function progressLine(): { update: (text: string) => void; done: () => void } {
  const tty = !!process.stderr.isTTY
  let last = 0
  let shown = false
  return {
    update(text) {
      if (!tty) return
      const now = Date.now()
      if (now - last < 100) return
      last = now
      const width = Math.max(20, (process.stderr.columns || 80) - 1)
      process.stderr.write(`\r\x1b[2K${text.length > width ? `${text.slice(0, width - 1)}…` : text}`)
      shown = true
    },
    done() {
      if (shown) process.stderr.write('\r\x1b[2K')
    },
  }
}
