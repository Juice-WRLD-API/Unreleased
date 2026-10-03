import { createInterface, type Interface } from 'node:readline'
import { getToken, HISTORY_MAX, loadConfig, readRc } from './config'
import { historySearchActive, installHistorySearch } from './historySearch'
import { color, writeTone, type Tone } from './out'
import { Player } from './player'
import { screenActive } from './screen'
import { Shell, type Prompter } from './shell'
import { VERSION } from './api'

// readline exposes these, but its typings mark them read-only or leave them out.
type RawInterface = Interface & { line: string; cursor: number; history: string[]; _writeToOutput: (s: string) => void }

/** Asks through the REPL's own readline. Hidden answers aren't echoed and are
 *  taken back out of the ↑ history readline adds every answer to. */
function replPrompter(rl: RawInterface): Prompter {
  let muted = false
  const write = rl._writeToOutput.bind(rl)
  rl._writeToOutput = (s: string) => { if (!muted) write(s) }
  return {
    ask: (question, hidden = false) => new Promise((resolve) => {
      rl.question(question, (answer) => {
        if (muted) { muted = false; process.stdout.write('\n') }
        if (rl.history[0] === answer) rl.history.shift()
        resolve(answer)
      })
      muted = hidden
    }),
  }
}

export async function startRepl(): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    historySize: HISTORY_MAX,
    removeHistoryDuplicates: true,
    completer: (line: string, done: (err: Error | null, result: [string[], string]) => void) => {
      shell.complete(line).then((r) => done(null, r), () => done(null, [[], line]))
    },
  }) as RawInterface
  const shell: Shell = new Shell(replPrompter(rl), true)
  rl.history.push(...[...shell.history].reverse())

  process.stdout.write(`${color.bold('Unreleased terminal')} ${color.dim(`v${VERSION}`)} · type ${color.cyan('help')} · Ctrl+D to leave\n`)
  process.stdout.write(color.dim(getToken() ? `signed in as ${loadConfig().user?.name ?? 'user'}\n` : 'browsing as a guest - login to sign in\n'))

  await shell.goHome()
  // ~/.unreleased/rc: the user's own startup lines (aliases, a starting cd).
  for (const line of readRc()) await shell.execLine(line)

  // Lines typed or pasted while a command runs wait their turn.
  const queue: string[] = []
  let running = false
  let interrupted = false

  const showPrompt = (): void => { rl.setPrompt(shell.prompt()); rl.prompt() }

  // The player reports what happens on its own (next song, a file that won't
  // play). At the prompt that goes above it, keeping whatever is half-typed;
  // over a full screen or a Ctrl+R search it waits until that's closed.
  const held: { text: string; tone: Tone }[] = []
  const flushHeld = (): void => { for (const n of held.splice(0)) writeTone(n.text, n.tone) }
  shell.player = new Player((text, tone = 'dim') => {
    if (screenActive() || historySearchActive()) { held.push({ text, tone }); return }
    if (running) { writeTone(text, tone); return }
    process.stdout.write('\r\x1b[2K')
    writeTone(text, tone)
    rl.prompt(true)
  })
  installHistorySearch(rl, () => shell.history, () => !running, flushHeld)
  const stopMusic = (): void => shell.player?.shutdown()
  process.on('exit', stopMusic)
  process.on('SIGHUP', () => { stopMusic(); process.exit(129) })
  process.on('SIGTERM', () => { stopMusic(); process.exit(143) })

  const drain = async (): Promise<void> => {
    if (running) return
    running = true
    while (queue.length > 0 && !shell.exiting) { await shell.run(queue.shift()!); flushHeld() }
    running = false
    if (shell.exiting) rl.close()
    else showPrompt()
  }

  rl.on('line', (line) => {
    interrupted = false
    queue.push(line)
    void drain()
  })

  // Ctrl+C cancels a running command; at the prompt it drops the line, and a
  // second one on an empty line leaves (as in node's own REPL).
  rl.on('SIGINT', () => {
    if (running) { queue.length = 0; shell.abort(); return }
    if (!rl.line && interrupted) { rl.close(); return }
    process.stdout.write(rl.line ? '^C\n' : `^C\n${color.dim('(press Ctrl+C again or type exit to leave)')}\n`)
    interrupted = !rl.line
    rl.line = ''
    rl.cursor = 0
    showPrompt()
  })

  showPrompt()
  await new Promise<void>((resolve) => rl.on('close', resolve))
  shell.abort()
  if (shell.player?.current) process.stdout.write(color.dim('music stopped\n'))
  stopMusic()
}
