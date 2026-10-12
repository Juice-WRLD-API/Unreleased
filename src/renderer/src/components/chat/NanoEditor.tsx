import { useEffect, useRef, useState } from 'react'

type Prompt =
  | { kind: 'write'; value: string; thenExit: boolean }
  | { kind: 'search'; value: string }
  | { kind: 'exit' }
  | null

const SHORTCUTS: { key: string; label: string; ctrl: string }[] = [
  { key: '^G', label: 'Help', ctrl: 'g' },
  { key: '^O', label: 'Write Out', ctrl: 'o' },
  { key: '^W', label: 'Where Is', ctrl: 'w' },
  { key: '^K', label: 'Cut', ctrl: 'k' },
  { key: '^U', label: 'Paste', ctrl: 'u' },
  { key: '^X', label: 'Exit', ctrl: 'x' },
]

const HELP = [
  'Main nano help',
  '',
  '^G  Display this help text',
  '^O  Write the buffer out - saves a copy to your computer',
  '^W  Search for text; Enter on an empty prompt repeats the last search',
  '^K  Cut the current line into the cutbuffer',
  '^U  Paste the cutbuffer at the cursor',
  '^X  Close the buffer, exiting nano',
  '',
  'Files in the tree are read-only here, so ^O never changes the server.',
  'Press any key to return to the editor.',
].join('\n')

// The caret's line and column (both 1-based) in `text`.
function position(text: string, caret: number): { line: number; col: number } {
  const head = text.slice(0, caret)
  const nl = head.lastIndexOf('\n')
  return { line: head.split('\n').length, col: caret - nl }
}

// The start/end offsets of the line holding `caret`, including its newline.
function lineRange(text: string, caret: number): { start: number; end: number } {
  const start = text.lastIndexOf('\n', caret - 1) + 1
  const nl = text.indexOf('\n', caret)
  return { start, end: nl === -1 ? text.length : nl + 1 }
}

function saveCopy(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// A small nano for the admin terminal. It edits one buffer; "write out"
// downloads it, since the file tree it came from is read-only. Keys follow nano
// (^O ^X ^W ^K ^U ^G) and the shortcut bar is clickable for touch screens.
export default function NanoEditor({ name, initial, existed, onClose }: {
  name: string
  initial: string
  existed: boolean
  onClose: (message: string) => void
}): JSX.Element {
  const [text, setText] = useState(initial)
  const [fileName, setFileName] = useState(name)
  const [modified, setModified] = useState(false)
  const [prompt, setPrompt] = useState<Prompt>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [status, setStatus] = useState(existed ? '' : 'New File')
  const [caret, setCaret] = useState(0)
  const area = useRef<HTMLTextAreaElement>(null)
  const promptField = useRef<HTMLInputElement>(null)
  const cutBuffer = useRef('')
  const lastSearch = useRef('')

  useEffect(() => { area.current?.focus() }, [])
  useEffect(() => { if (prompt?.kind === 'write' || prompt?.kind === 'search') promptField.current?.focus() }, [prompt?.kind])

  const refocus = (): void => { requestAnimationFrame(() => area.current?.focus()) }
  const syncCaret = (): void => setCaret(area.current?.selectionStart ?? 0)
  const edit = (next: string, at: number): void => {
    setText(next)
    setModified(true)
    requestAnimationFrame(() => { area.current?.setSelectionRange(at, at); setCaret(at) })
  }

  const finish = (message: string): void => onClose(message)

  const writeOut = (target: string, thenExit: boolean): void => {
    const clean = target.trim()
    if (!clean) { setStatus('Cancelled'); setPrompt(null); refocus(); return }
    saveCopy(clean, text)
    setFileName(clean)
    setModified(false)
    const lines = text === '' ? 0 : text.split('\n').length
    if (thenExit) { finish(`wrote ${lines} line${lines === 1 ? '' : 's'} to ${clean} (downloaded)`); return }
    setStatus(`Wrote ${lines} line${lines === 1 ? '' : 's'} (downloaded as ${clean})`)
    setPrompt(null)
    refocus()
  }

  const search = (query: string): void => {
    const q = query || lastSearch.current
    setPrompt(null)
    refocus()
    if (!q) { setStatus('Cancelled'); return }
    lastSearch.current = q
    const from = area.current?.selectionEnd ?? 0
    const lower = text.toLowerCase()
    let at = lower.indexOf(q.toLowerCase(), from)
    let wrapped = false
    if (at === -1) { at = lower.indexOf(q.toLowerCase()); wrapped = at !== -1 }
    if (at === -1) { setStatus(`"${q}" not found`); return }
    setStatus(wrapped ? 'Search Wrapped' : '')
    requestAnimationFrame(() => {
      const el = area.current
      if (!el) return
      el.focus()
      el.setSelectionRange(at, at + q.length)
      setCaret(at)
    })
  }

  const exit = (): void => {
    if (modified) { setPrompt({ kind: 'exit' }); return }
    finish('')
  }

  const cutLine = (): void => {
    const el = area.current
    if (!el || text === '') return
    const { start, end } = lineRange(text, el.selectionStart)
    cutBuffer.current = text.slice(start, end)
    edit(text.slice(0, start) + text.slice(end), start)
  }

  const paste = (): void => {
    const el = area.current
    if (!el) return
    if (!cutBuffer.current) { setStatus('Cutbuffer is empty'); return }
    const at = el.selectionStart
    // A cut line goes back in above the line the caret is on, like nano.
    const insertAt = cutBuffer.current.endsWith('\n') ? lineRange(text, at).start : at
    edit(text.slice(0, insertAt) + cutBuffer.current + text.slice(insertAt), insertAt + cutBuffer.current.length)
  }

  const runShortcut = (ctrl: string): void => {
    setStatus('')
    switch (ctrl) {
      case 'g': setShowHelp(true); break
      case 'o': setPrompt({ kind: 'write', value: fileName, thenExit: false }); break
      case 'w': setPrompt({ kind: 'search', value: '' }); break
      case 'k': cutLine(); break
      case 'u': paste(); break
      case 'x': exit(); break
    }
  }

  const onAreaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.ctrlKey && !e.altKey && !e.metaKey) {
      const k = e.key.toLowerCase()
      if (SHORTCUTS.some((s) => s.ctrl === k)) { e.preventDefault(); runShortcut(k); return }
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.currentTarget
      edit(text.slice(0, el.selectionStart) + '\t' + text.slice(el.selectionEnd), el.selectionStart + 1)
    }
  }

  const onPromptKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (prompt?.kind === 'write' || prompt?.kind === 'search') {
      if (e.key === 'Enter') { e.preventDefault(); if (prompt.kind === 'write') writeOut(prompt.value, prompt.thenExit); else search(prompt.value); return }
      if (e.key === 'Escape' || (e.ctrlKey && e.key.toLowerCase() === 'c')) { e.preventDefault(); setPrompt(null); setStatus('Cancelled'); refocus() }
    }
  }

  // The "save modified buffer?" question takes a single key, like nano.
  const onExitKey = (e: React.KeyboardEvent): void => {
    const k = e.key.toLowerCase()
    if (k === 'y') { e.preventDefault(); setPrompt({ kind: 'write', value: fileName, thenExit: true }) }
    else if (k === 'n') { e.preventDefault(); finish('') }
    else if (k === 'escape' || (e.ctrlKey && k === 'c')) { e.preventDefault(); setPrompt(null); refocus() }
  }

  const { line, col } = position(text, caret)
  const lineCount = text === '' ? 1 : text.split('\n').length

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--t-bg)] text-[color:var(--t-fg)]">
      <div className="shrink-0 flex items-center px-3 h-6 bg-[var(--t-fg)] text-[color:var(--t-bg)] text-[12px] font-bold">
        <span className="w-1/3 truncate">GNU nano</span>
        <span className="w-1/3 text-center truncate">{fileName || 'New Buffer'}</span>
        <span className="w-1/3 text-right">{modified ? 'Modified' : ''}</span>
      </div>

      {showHelp ? (
        <pre
          tabIndex={0}
          ref={(el) => el?.focus()}
          onKeyDown={(e) => { e.preventDefault(); setShowHelp(false); refocus() }}
          onClick={() => { setShowHelp(false); refocus() }}
          className="chat-scroll flex-1 min-h-0 overflow-auto px-4 py-3 text-[13px] leading-[1.45] outline-none whitespace-pre-wrap"
        >{HELP}</pre>
      ) : (
        <textarea
          ref={area}
          value={text}
          onChange={(e) => { setText(e.target.value); setModified(true); setCaret(e.target.selectionStart); setStatus('') }}
          onKeyDown={onAreaKeyDown}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onSelect={syncCaret}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          wrap="off"
          aria-label={`Editing ${fileName}`}
          className="chat-scroll flex-1 min-h-0 w-full resize-none bg-[var(--t-bg)] text-[color:var(--t-fg)] px-4 py-2 text-[13px] leading-[1.45] outline-none border-0 caret-[color:var(--t-fg)]"
          style={{ fontFamily: 'inherit', tabSize: 8 }}
        />
      )}

      <div className="shrink-0 h-5 px-3 text-[12px] flex items-center justify-between text-[color:var(--t-fg)]">
        <span className="truncate">{status && `[ ${status} ]`}</span>
        <span className="shrink-0 text-[color:var(--t-dim)]">line {line}/{lineCount}, col {col}</span>
      </div>

      {prompt?.kind === 'exit' ? (
        <div
          tabIndex={0}
          ref={(el) => el?.focus()}
          onKeyDown={onExitKey}
          className="shrink-0 px-3 py-1 text-[12px] outline-none bg-[var(--t-fg)] text-[color:var(--t-bg)] flex flex-wrap gap-x-4"
        >
          <span className="font-bold">Save modified buffer?</span>
          <button type="button" onClick={() => setPrompt({ kind: 'write', value: fileName, thenExit: true })}><b>Y</b> Yes</button>
          <button type="button" onClick={() => finish('')}><b>N</b> No</button>
          <button type="button" onClick={() => { setPrompt(null); refocus() }}><b>^C</b> Cancel</button>
        </div>
      ) : prompt ? (
        <div className="shrink-0 px-3 py-1 text-[12px] bg-[var(--t-fg)] text-[color:var(--t-bg)] flex items-center gap-2">
          <span className="font-bold shrink-0">{prompt.kind === 'write' ? 'File Name to Write:' : 'Search:'}</span>
          <input
            ref={promptField}
            value={prompt.value}
            onChange={(e) => setPrompt({ ...prompt, value: e.target.value })}
            onKeyDown={onPromptKeyDown}
            spellCheck={false}
            autoComplete="off"
            aria-label={prompt.kind === 'write' ? 'File name to write' : 'Search'}
            className="flex-1 min-w-0 bg-transparent outline-none border-0 text-[color:var(--t-bg)]"
            style={{ fontFamily: 'inherit' }}
          />
          <span className="shrink-0 opacity-70">Enter to confirm · Esc cancels</span>
        </div>
      ) : (
        <div className="shrink-0 px-3 py-1 text-[12px] flex flex-wrap gap-x-4 gap-y-0.5">
          {SHORTCUTS.map((s) => (
            <button key={s.key} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => runShortcut(s.ctrl)} className="whitespace-nowrap">
              <span className="bg-[var(--t-fg)] text-[color:var(--t-bg)] font-bold px-1">{s.key}</span> {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
