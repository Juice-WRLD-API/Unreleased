import { useStore } from '../../store/useStore'
import { HOTKEY_ACTIONS, effectiveBinding, getAction } from '../hotkeys'
import { fail, type TermCommand } from './types'

// Settings > Shortcuts, as a command: list the keyboard shortcuts or change one.
// Same ids and combo format ("Shift+ArrowRight", "Alt+P") as the unreleased CLI's
// `bind`, which keeps its own copy of these on the command line.

const NAMED: Record<string, string> = {
  left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', space: 'Space',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', insert: 'Insert', delete: 'Delete',
  enter: 'Enter', tab: 'Tab', backspace: 'Backspace',
}
const ALIASES: Record<string, string> = {
  arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown',
  '←': 'ArrowLeft', '→': 'ArrowRight', '↑': 'ArrowUp', '↓': 'ArrowDown',
  pgup: 'PageUp', pgdn: 'PageDown', del: 'Delete', ins: 'Insert',
  comma: ',', period: '.', dot: '.', slash: '/', minus: '-', equals: '=', plus: '=',
}
const PUNCTUATION = ',./;\'-=`\\['
const MODIFIERS: Record<string, string> = { ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', option: 'Alt', shift: 'Shift', meta: 'Meta', win: 'Meta', cmd: 'Meta' }

function mainKey(token: string): string | null {
  const t = token.toLowerCase()
  const word = NAMED[t] ?? ALIASES[t]
  if (word) return word
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(t)) return t.toUpperCase()
  if (/^[a-z0-9]$/.test(t)) return t.toUpperCase()
  if (token.length === 1 && (PUNCTUATION.includes(token) || token === ']')) return token
  return null
}

/** What a typed combo ("alt+p", "shift+left") is in canonical form, or why not. */
function parseCombo(input: string): string {
  const parts = input.trim().split('+')
  // "Alt++" and "Alt+plus": the key is the + itself.
  if (input.trim().endsWith('++')) parts.splice(-2, 2, '=')
  const keyToken = parts.pop() ?? ''
  const mods = new Set<string>()
  for (const m of parts) {
    const name = MODIFIERS[m.toLowerCase()]
    if (!name) return fail(`"${m}" isn't a modifier (use ctrl, alt, shift or meta)`)
    mods.add(name)
  }
  const key = mainKey(keyToken) ?? fail(`"${keyToken}" isn't a key I can bind (letters, digits, arrows, Space, Home, End, PageUp, PageDown, F1-F24 and punctuation)`)
  return ['Ctrl', 'Alt', 'Shift', 'Meta'].filter((m) => mods.has(m)).concat(key).join('+')
}

const state = () => useStore.getState()

function listing(): string {
  const o = state().hotkeyBindings
  const idWidth = Math.max(...HOTKEY_ACTIONS.map((a) => a.id.length)) + 2
  const labelWidth = Math.max(...HOTKEY_ACTIONS.map((a) => a.label.length)) + 2
  const out: string[] = []
  for (const category of ['Playback', 'Volume', 'Navigation']) {
    out.push(category)
    for (const a of HOTKEY_ACTIONS.filter((x) => x.category === category)) {
      const combo = effectiveBinding(a.id, o)
      // The unbound seek-N rows are left out until they have a key.
      if (!combo && /^seek-\d+$/.test(a.id)) continue
      out.push(`  ${a.id.padEnd(idWidth)}${a.label.padEnd(labelWidth)}${combo || '—'}${Object.prototype.hasOwnProperty.call(o, a.id) ? '  (changed)' : ''}`)
    }
  }
  out.push('', `skip jumps ${state().hotkeySeekSeconds}s (set hotkey-seek) · bind <action> <combo> · bind <action> none · bind reset`)
  return out.join('\n')
}

export const BIND_COMMANDS: TermCommand[] = [
  {
    name: 'bind', aliases: ['shortcuts', 'hotkeys'], group: 'Settings',
    usage: 'bind  ·  bind <action> <combo | none>  ·  bind reset [action]',
    description: 'List the keyboard shortcuts, or change one (bind seek-forward shift+right, bind mute alt+m). Same as Settings > Shortcuts',
    complete: (before, partial) => (before.length === 0 ? ['reset', ...HOTKEY_ACTIONS.map((a) => a.id)].filter((w) => w.startsWith(partial.toLowerCase())) : []),
    run: (args, ctx) => {
      const words = args.trim().split(/\s+/).filter(Boolean)
      if (words.length === 0) { ctx.print(listing()); return }
      const s = state()
      if (words[0].toLowerCase() === 'reset') {
        if (words.length === 1) { s.resetHotkeyBindings(); ctx.print('shortcuts back to their defaults', 'ok'); return }
        const id = words[1].toLowerCase()
        const action = getAction(id) ?? fail(`no action "${words[1]}" (try: bind)`)
        s.setHotkeyBinding(id, action.defaultBinding)
        ctx.print(`${id}: ${effectiveBinding(id, state().hotkeyBindings) || '—'}`, 'ok'); return
      }
      const id = words[0].toLowerCase()
      if (!getAction(id)) {
        // `bind alt+p` says what that key does.
        const hit = (() => { try { return parseCombo(args) } catch { return null } })()
        const owner = hit ? HOTKEY_ACTIONS.find((a) => effectiveBinding(a.id, s.hotkeyBindings) === hit) : undefined
        if (owner) { ctx.print(`${hit}: ${owner.label} (${owner.id})`); return }
        fail(`no action "${words[0]}" (try: bind)`)
      }
      const rest = words.slice(1).join('')
      if (!rest) { ctx.print(`${id}: ${effectiveBinding(id, s.hotkeyBindings) || '—'}`); return }
      if (/^(none|clear|off|unbind)$/i.test(rest)) { s.setHotkeyBinding(id, ''); ctx.print(`${id}: no shortcut`, 'ok'); return }
      const combo = parseCombo(rest)
      const taken = HOTKEY_ACTIONS.find((a) => a.id !== id && effectiveBinding(a.id, s.hotkeyBindings) === combo)
      s.setHotkeyBinding(id, combo)
      ctx.print(`${id}: ${combo}${taken ? `  (took it from ${taken.id})` : ''}`, 'ok')
    },
  },
]
