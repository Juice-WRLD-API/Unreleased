import { createInterface } from 'node:readline'
import { VERSION } from './api'
import { startRepl } from './repl'
import { Shell, type Prompter } from './shell'

// `unreleased`                 the interactive shell
// `unreleased <command> ...`   one command, then exit (exit code 1 if it failed)
// `unreleased < script.txt`    every line of stdin, like a shell reading a file

const USAGE = `unreleased - the Unreleased site terminal on the command line

  unreleased                  open the interactive shell
  unreleased <command> ...    run one command and exit, e.g. unreleased ls comp
  unreleased < file           run each line of a file

  -h, --help      this help (inside the shell, type help for the commands)
  -v, --version   the version

Settings live in ~/.unreleased (or $UNRELEASED_HOME). UNRELEASED_TOKEN and
UNRELEASED_API override the saved token and the API base.`

/** One question on the real terminal, or one line of piped stdin. */
function oneShotPrompter(): Prompter {
  return {
    ask: (question, hidden = false) => new Promise((resolve) => {
      const tty = !!process.stdin.isTTY
      const rl = createInterface({ input: process.stdin, output: tty ? process.stdout : undefined, terminal: tty })
      let muted = false
      if (tty) {
        const raw = rl as unknown as { _writeToOutput: (s: string) => void }
        const write = raw._writeToOutput.bind(rl)
        raw._writeToOutput = (s) => { if (!muted) write(s) }
      } else process.stderr.write(question)
      rl.question(tty ? question : '', (answer) => {
        if (muted) process.stdout.write('\n')
        rl.close()
        resolve(answer)
      })
      muted = tty && hidden
    }),
  }
}

// Words that held spaces were one argument in the calling shell; quote them
// again so the command line reads the same way here.
const joinArgs = (args: string[]): string => args.map((a) => (/\s/.test(a) && !/^(["']).*\1$/.test(a) ? `"${a}"` : a)).join(' ')

async function runLines(shell: Shell, lines: string[]): Promise<boolean> {
  let ok = true
  for (const line of lines) {
    if (!(await shell.execLine(line))) ok = false
    if (shell.exiting) break
  }
  return ok
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  if (args[0] === '-h' || args[0] === '--help') { process.stdout.write(USAGE + '\n'); return 0 }
  if (args[0] === '-v' || args[0] === '--version') { process.stdout.write(`unreleased-cli ${VERSION}\n`); return 0 }

  if (args.length === 0 && process.stdin.isTTY) {
    await startRepl()
    return 0
  }

  const shell = new Shell(oneShotPrompter(), false)
  // Ctrl+C cancels the command; a second one gives up on it.
  let interrupts = 0
  process.on('SIGINT', () => {
    if (++interrupts > 1) process.exit(130)
    shell.abort()
  })
  const lines = args.length > 0
    ? [joinArgs(args)]
    : (await readStdin()).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  await shell.goHome()
  const ok = await runLines(shell, lines)
  return interrupts > 0 ? 130 : ok ? 0 : 1
}

main().then(
  (code) => { process.exitCode = code },
  (err) => { process.stderr.write(`unreleased: ${(err as Error)?.stack ?? err}\n`); process.exitCode = 1 },
)
