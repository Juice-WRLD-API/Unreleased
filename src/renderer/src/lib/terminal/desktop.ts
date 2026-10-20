import { useStore } from '../../store/useStore'
import { wrldEdgeLook } from '../../store/vizStore'
import type { DesktopPatch } from '../../store/desktopSlice'
import { LOOKS, PLACES, lookOf } from '../../desktop/light/looks'
import { FACES, LYRIC_LOOKS, lyricLookOf, lyricFontFor } from '../../desktop/lyrics/looks'
import { desktopApi, desktopWindowsSupported } from '../../desktop/api'
import * as actions from '../../desktop/actions'
import { fail, parseBool, type TermCommand } from './types'

// Settings > Desktop from the terminal: the light round the screens, the widgets on the desktop, the desk cleared, and
// the lyric styles - each subcommand sets what the tab's control does.

const st = (): ReturnType<typeof useStore.getState> => useStore.getState()
const SUBCOMMANDS = ['status', 'light', 'look', 'place', 'motion', 'tune', 'colors', 'widgets', 'player', 'playlist', 'clock', 'clear', 'lyrics', 'font', 'displays']
const MOTIONS = ['flow', 'music', 'still'] as const
const TUNING = ['sensitivity', 'reaction', 'smoothness', 'thickness', 'glow', 'particles', 'tail'] as const
const WIDGET_KEYS: Record<string, Record<string, 'number' | 'boolean' | 'string' | string[]>> = {
  player: { size: 'number', tilt: 'number', glass: 'number', frost: 'number', cards: ['1', '2', '3'], mini: 'boolean', fold: 'boolean', lock: 'boolean' },
  playlist: { size: 'number', tilt: 'number', rows: ['4', '6', '8', '10', '12'], side: ['left', 'right'], lock: 'boolean', source: 'string' },
  clock: { size: 'number', height: 'number', weight: 'number', tint: 'number', artwork: 'boolean', date: 'boolean', lock: 'boolean' },
}

const percent = (v: number): string => `${Math.round(v * 100)}%`
const onOff = (v: boolean): string => (v ? 'on' : 'off')

/** A 0...1 setting from "0.4", "40" or "40%". */
function fraction(word: string): number {
  const n = Number(word.replace('%', ''))
  if (!Number.isFinite(n)) fail(`not a number: ${word}`)
  const v = word.includes('%') || n > 1 ? n / 100 : n
  return Math.min(Math.max(v, 0), 1)
}

function toggle(word: string | undefined, current: boolean): boolean {
  if (!word) return !current
  const b = parseBool(word)
  if (b === null) fail(`on or off, not "${word}"`)
  return b as boolean
}

function needsWindows(): void {
  if (!desktopWindowsSupported()) fail('the light round the screens and the desktop widgets are on Windows only')
}

function status(): string {
  const d = st().desktop
  const look = lookOf(d.light.look)
  const lyric = d.lyrics.look === 'classic' ? 'Classic' : lyricLookOf(d.lyrics.look).title
  const lines = [
    `light     ${onOff(d.light.isOn)} · ${look.title} · ${d.light.place} · ${d.light.motion}${d.light.onlyOnDesktop ? ' · only on the desktop' : ''}`,
    `tuning    sensitivity ${percent(d.light.sensitivity)} · reaction ${percent(d.light.reaction)} · smoothness ${percent(d.light.smoothness)} · thickness ${percent(d.light.thickness)} · glow ${percent(d.light.glow)} · particles ${percent(d.light.particles)} · tail ${percent(d.light.tailLength)}`,
    `colors    ${d.light.useArtworkColors ? 'artwork' : 'own'} · ${d.light.twoColors ? 'two' : 'one'}`,
    `player    ${onOff(d.player.isOn)} · size ${percent(d.player.size)} · tilt ${percent(d.player.tilt)} · ${d.player.sideCards} cards each side${d.player.mini ? ' · mini' : ''}${d.player.locked ? ' · locked' : ''}`,
    `playlist  ${onOff(d.playlist.isOn)} · ${d.playlist.source} · ${d.playlist.rows} rows · ${d.playlist.side}${d.playlist.locked ? ' · locked' : ''}`,
    `clock     ${onOff(d.clock.isOn)} · size ${percent(d.clock.size)}${d.clock.showDate ? ' · date' : ''}${d.clock.locked ? ' · locked' : ''}`,
    `lyrics    ${lyric}${d.lyrics.look !== 'classic' ? ` · ${lyricFontFor(d.lyrics.fonts, d.lyrics.look)}` : ''}`,
  ]
  if (d.hiddenDisplays.length) lines.push(`displays  off: ${d.hiddenDisplays.join(', ')}`)
  if (!desktopWindowsSupported()) {
    const edge = wrldEdgeLook()
    lines.push(`(the light round the screens and the widgets show on Windows; WRLD's Edge light here: ${edge ? lookOf(edge).title : 'none'})`)
  }
  return lines.join('\n')
}

function widget(which: 'player' | 'playlist' | 'clock', words: string[]): string {
  needsWindows()
  const [key, value] = words
  const d = st().desktop
  if (!key || parseBool(key) !== null || key === 'toggle') return actions.setWidget(which, key && key !== 'toggle' ? (parseBool(key) as boolean) : undefined)
  if (key === 'reset') { st().resetDesktopPlace(which); return `${which} back where it first stood` }
  const kinds = WIDGET_KEYS[which]
  const kind = kinds[key] ?? fail(`${which} settings: ${Object.keys(kinds).join(', ')}, reset, on, off`)
  if (value === undefined) fail(`usage: desktop ${which} ${key} <${Array.isArray(kind) ? kind.join('|') : kind === 'boolean' ? 'on|off' : kind === 'number' ? '0-100%' : 'value'}>`)
  const names: Record<string, string> = { glass: 'glassBrightness', cards: 'sideCards', fold: 'hidesLyricsCard', lock: 'locked', height: 'stretch', artwork: 'useArtworkColor', date: 'showDate' }
  const field = names[key] ?? key
  let parsed: unknown
  if (kind === 'number') parsed = fraction(value)
  else if (kind === 'boolean') parsed = toggle(value, Boolean((d[which] as unknown as Record<string, unknown>)[field]))
  else if (Array.isArray(kind)) {
    if (!kind.includes(value)) fail(`${key}: ${kind.join(', ')}`)
    parsed = /^\d+$/.test(value) ? Number(value) : value
  } else {
    // The playlist's list: queue, liked, or a playlist by name.
    const v = value.toLowerCase()
    if (v === 'queue' || v === 'liked') parsed = v
    else {
      const p = st().playlists.find((x) => x.name.toLowerCase() === v) ?? st().playlists.find((x) => x.name.toLowerCase().includes(v)) ?? fail(`no playlist "${value}"`)
      parsed = `playlist:${p.id}`
    }
  }
  st().setDesktop({ [which]: { [field]: parsed } } as DesktopPatch)
  return `${which} ${key}: ${typeof parsed === 'number' && kind === 'number' ? percent(parsed) : typeof parsed === 'boolean' ? onOff(parsed) : String(parsed)}`
}

export const DESKTOP_COMMANDS: TermCommand[] = [
  {
    name: 'desktop', aliases: ['ijwa'], group: 'App',
    usage: 'desktop [status] · desktop light [on|off|<look>|next] · desktop look <look> · desktop place <all|bottom|top|corners> · desktop motion <flow|music|still> · desktop tune <setting> <0-100%> · desktop colors <artwork|own|one|two> · desktop widgets [on|off] · desktop player|playlist|clock [on|off|<setting> <value>|reset] · desktop clear [on|off] · desktop lyrics [<style>|next] · desktop font <face> · desktop displays [<name> on|off]',
    description: 'Settings > Desktop: the light round the screens, the desktop widgets, the desk cleared, and the lyric styles for WRLD and the desktop player',
    complete: (before, partial) => {
      const p = partial.toLowerCase()
      const sub = before[0]?.toLowerCase()
      if (before.length === 0) return SUBCOMMANDS.filter((s) => s.startsWith(p))
      if (before.length === 1) {
        if (sub === 'light' || sub === 'look') return ['on', 'off', 'next', ...LOOKS.map((l) => l.id)].filter((s) => s.startsWith(p))
        if (sub === 'place') return PLACES.map((x) => x.id).filter((s) => s.startsWith(p))
        if (sub === 'motion') return MOTIONS.filter((s) => s.startsWith(p))
        if (sub === 'tune') return TUNING.filter((s) => s.startsWith(p))
        if (sub === 'colors') return ['artwork', 'own', 'one', 'two'].filter((s) => s.startsWith(p))
        if (sub === 'lyrics') return ['classic', 'next', ...LYRIC_LOOKS.map((l) => l.id)].filter((s) => s.startsWith(p))
        if (sub === 'font') return FACES.map((f) => f.key).filter((s) => s.toLowerCase().startsWith(p))
        if (sub === 'player' || sub === 'playlist' || sub === 'clock') return ['on', 'off', 'reset', ...Object.keys(WIDGET_KEYS[sub])].filter((s) => s.startsWith(p))
        if (sub === 'widgets' || sub === 'clear') return ['on', 'off'].filter((s) => s.startsWith(p))
      }
      return []
    },
    run: async (args, ctx) => {
      const words = args.trim().split(/\s+/).filter(Boolean)
      const sub = (words[0] ?? 'status').toLowerCase()
      const rest = words.slice(1)
      const s = st()
      const d = s.desktop
      const say = (text: string): void => ctx.print(text, 'ok')
      switch (sub) {
        case 'status': ctx.print(status(), 'plain'); return
        case 'light': {
          const word = rest[0]?.toLowerCase()
          if (!word || parseBool(word) !== null) { needsWindows(); say(actions.setLight(word ? (parseBool(word) as boolean) : undefined)); return }
          if (word === 'next' || word === 'previous') { say(actions.stepLight(word === 'next' ? 1 : -1)); return }
          // A look by name: picked, as in Settings (off Windows, that's WRLD's Edge light).
          const look = LOOKS.find((l) => l.id === word || l.title.toLowerCase() === rest.join(' ').toLowerCase()) ?? fail(`lights: ${LOOKS.map((l) => l.id).join(', ')}`)
          say(actions.pickLight(look.id))
          return
        }
        case 'look': {
          const name = rest.join(' ').toLowerCase()
          const look = LOOKS.find((l) => l.id === name || l.title.toLowerCase() === name) ?? fail(`lights: ${LOOKS.map((l) => l.id).join(', ')}`)
          say(actions.pickLight(look.id))
          return
        }
        case 'place': {
          const place = PLACES.find((x) => x.id === rest[0]?.toLowerCase()) ?? fail(`places: ${PLACES.map((x) => x.id).join(', ')}`)
          s.setDesktop({ light: { place: place.id } })
          say(`Light: ${place.title}`)
          return
        }
        case 'motion': {
          const motion = MOTIONS.find((x) => x === rest[0]?.toLowerCase()) ?? fail('motion: flow, music, still')
          s.setDesktop({ light: { motion } })
          say(`Light motion: ${motion}`)
          return
        }
        case 'tune': {
          const [key = '', value] = rest
          const k = TUNING.find((t) => t === key.toLowerCase()) ?? fail(`tune: ${TUNING.join(', ')}`)
          if (value === undefined) fail(`usage: desktop tune ${k} <0-100%>`)
          const v = fraction(value)
          s.setDesktop({ light: { [k === 'tail' ? 'tailLength' : k]: v } })
          say(`Light ${k}: ${percent(v)}`)
          return
        }
        case 'colors': {
          const word = rest[0]?.toLowerCase()
          if (word === 'artwork' || word === 'own') s.setDesktop({ light: { useArtworkColors: word === 'artwork' } })
          else if (word === 'one' || word === 'two') s.setDesktop({ light: { twoColors: word === 'two' } })
          else fail('colors: artwork, own, one, two')
          say(`Light colors: ${word}`)
          return
        }
        case 'widgets': needsWindows(); say(actions.setWidgets(rest[0] ? toggle(rest[0], false) : undefined)); return
        case 'player': case 'playlist': case 'clock': say(widget(sub, rest)); return
        case 'clear': needsWindows(); say(actions.clearDesk(rest[0] ? toggle(rest[0], false) : undefined)); return
        case 'lyrics': {
          const word = rest[0]?.toLowerCase()
          if (!word) { ctx.print(`Lyric style: ${d.lyrics.look === 'classic' ? 'Classic' : lyricLookOf(d.lyrics.look).title}`, 'plain'); return }
          if (word === 'next' || word === 'previous') { say(actions.stepLyricStyle(word === 'next' ? 1 : -1)); return }
          const look = word === 'classic' ? 'classic' : (LYRIC_LOOKS.find((l) => l.id === word)?.id ?? fail(`styles: classic, ${LYRIC_LOOKS.map((l) => l.id).join(', ')}`))
          s.setDesktop({ lyrics: { look } })
          say(`Lyric style: ${look === 'classic' ? 'Classic' : lyricLookOf(look).title}`)
          return
        }
        case 'font': {
          if (d.lyrics.look === 'classic') fail('Classic uses the app\'s lyrics font (Settings > Appearance); pick a style first: desktop lyrics <style>')
          const name = rest.join(' ').toLowerCase()
          const face = FACES.find((f) => f.key.toLowerCase() === name || f.name.toLowerCase() === name) ?? fail(`fonts: ${FACES.map((f) => f.key).join(', ')}`)
          s.setDesktop({ lyrics: { fonts: { ...d.lyrics.fonts, [d.lyrics.look]: face.key } } })
          say(`${lyricLookOf(d.lyrics.look).title} in ${face.name}`)
          return
        }
        case 'displays': {
          needsWindows()
          const displays = (await desktopApi()?.displays().catch(() => [])) ?? []
          if (!rest.length) {
            ctx.print(displays.map((x) => `${d.hiddenDisplays.includes(x.label) ? 'off' : 'on '}  ${x.label}${x.primary ? ' (main)' : ''}`).join('\n') || 'no displays', 'plain')
            return
          }
          const last = rest[rest.length - 1].toLowerCase()
          const on = parseBool(last)
          const name = (on === null ? rest : rest.slice(0, -1)).join(' ').toLowerCase()
          const display = displays.find((x) => x.label.toLowerCase() === name) ?? displays.find((x) => x.label.toLowerCase().includes(name)) ?? fail(`no display "${name}"`)
          const shown = on ?? d.hiddenDisplays.includes(display.label)
          s.setDesktop({ hiddenDisplays: shown ? d.hiddenDisplays.filter((h) => h !== display.label) : [...d.hiddenDisplays, display.label] })
          say(`${display.label}: ${onOff(shown)}`)
          return
        }
        default: fail(`desktop: ${SUBCOMMANDS.join(', ')}`)
      }
    },
  },
]
