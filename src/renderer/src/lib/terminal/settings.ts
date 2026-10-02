import { useStore } from '../../store/useStore'
import { FONTS } from '../fonts'
import { allSkins } from '../skins'
import { fail, parseBool, pickByName, type TermCommand } from './types'

const st = (): ReturnType<typeof useStore.getState> => useStore.getState()

interface Setting {
  key: string
  desc: string
  kind: 'bool' | 'number' | 'enum' | 'color'
  /** Number range, in the unit the user types. */
  min?: number
  max?: number
  unit?: string
  options?: () => { value: string; label: string }[]
  get: () => string | number | boolean | null
  set: (value: string | number | boolean | null) => void
}

const bool = (key: string, desc: string, get: () => boolean, set: (v: boolean) => void): Setting =>
  ({ key, desc, kind: 'bool', get, set: (v) => set(v as boolean) })

const num = (key: string, desc: string, min: number, max: number, get: () => number, set: (v: number) => void, unit = ''): Setting =>
  ({ key, desc, kind: 'number', min, max, unit, get, set: (v) => set(v as number) })

const choice = (key: string, desc: string, options: Setting['options'], get: () => string, set: (v: string) => void): Setting =>
  ({ key, desc, kind: 'enum', options, get, set: (v) => set(v as string) })

const color = (key: string, desc: string, get: () => string | null, set: (v: string | null) => void): Setting =>
  ({ key, desc, kind: 'color', get, set: (v) => set(v as string | null) })

// Everything in Settings that is a plain on/off, number, choice or colour. The
// values go through the same store setters the Settings screen uses, so they
// persist and sync to the account exactly the same way.
const SETTINGS: Setting[] = [
  choice('theme', 'Colour theme', () => allSkins().map((s) => ({ value: s.id, label: s.name })), () => st().theme, (v) => st().setTheme(v)),
  color('accent', 'Accent colour (#rrggbb)', () => st().accentColor, (v) => { if (v) st().setAccentColor(v) }),
  choice('sidebar', 'Where the navigation sits', () => ['left', 'right', 'top', 'bottom'].map((v) => ({ value: v, label: v })), () => st().sidebarPosition, (v) => st().setSidebarPosition(v as 'left' | 'right' | 'top' | 'bottom')),
  num('text-scale', 'App-wide text size', 0.75, 1.5, () => st().appTextScale, (v) => st().setAppTextScale(v), 'x'),
  choice('font', 'App font', () => FONTS.map((f) => ({ value: f.id, label: f.id })), () => st().appFont, (v) => st().setAppFont(v)),
  choice('lyrics-font', 'Lyrics font', () => FONTS.map((f) => ({ value: f.id, label: f.id })), () => st().lyricsFont, (v) => st().setLyricsFont(v)),
  num('lyrics-scale', 'Lyrics text size', 0.5, 2, () => st().lyricsScale, (v) => st().setLyricsScale(v), 'x'),
  choice('lyrics-align', 'Lyrics alignment', () => [{ value: 'left', label: 'left' }, { value: 'center', label: 'center' }], () => st().lyricsAlign, (v) => st().setLyricsAlign(v as 'left' | 'center')),
  bool('lyrics-blur', 'Blur the lines that are not playing', () => st().lyricsBlur, (v) => st().setLyricsBlur(v)),
  num('lyrics-blur-amount', 'How strong that blur is', 0, 3, () => st().lyricsBlurAmount, (v) => st().setLyricsBlurAmount(v), 'x'),
  num('lyrics-offset', 'Shift synced lyrics later (+) or earlier (-)', -10, 10, () => st().lyricsOffset, (v) => st().setLyricsOffset(v), 's'),
  color('lyrics-color-active', 'Colour of the line being sung (or auto)', () => st().lyricsColorActive, (v) => st().setLyricsColorActive(v)),
  color('lyrics-color-inactive', 'Colour of the other lines (or auto)', () => st().lyricsColorInactive, (v) => st().setLyricsColorInactive(v)),
  bool('gradients', 'Accent gradients on the shell', () => st().gradientsEnabled, (v) => st().setGradientsEnabled(v)),
  bool('surface-gradients', 'Gradients on small surfaces too', () => st().surfaceGradientsEnabled, (v) => st().setSurfaceGradientsEnabled(v)),
  bool('wrld-theme-bg', 'WRLD tab uses the theme instead of the cover', () => st().wrldThemeBackground, (v) => st().setWrldThemeBackground(v)),
  bool('full-era-names', 'Show full era names', () => st().fullEraNames, (v) => st().setFullEraNames(v)),
  bool('prefer-og', 'Play the OG version when one is linked', () => st().preferOgVersion, (v) => st().setPreferOgVersion(v)),
  bool('rotate-covers', 'Rotate suggested covers on each play', () => st().rotateSuggestedCovers, (v) => st().setRotateSuggestedCovers(v)),
  num('volume', 'Volume', 0, 100, () => Math.round(st().volume * 100), (v) => st().setVolume(v / 100), '%'),
  num('speed', 'Playback speed', 0.5, 2, () => st().playbackSpeed, (v) => st().setPlaybackSpeed(v), 'x'),
  bool('crossfade', 'Crossfade between tracks', () => st().crossfadeEnabled, (v) => st().setCrossfade(v, st().crossfadeDuration)),
  num('crossfade-seconds', 'Crossfade length', 1, 12, () => st().crossfadeDuration, (v) => st().setCrossfade(st().crossfadeEnabled, v), 's'),
  bool('pause-fade', 'Fade out on pause', () => st().pauseFadeEnabled, (v) => st().setPauseFade(v)),
  bool('skip-silence', 'Skip silence', () => st().skipSilence, (v) => st().setSkipSilence(v)),
  bool('eq', 'Equalizer on', () => st().eqEnabled, (v) => st().setEqEnabled(v)),
  bool('mono', 'Mono output', () => st().eqMono, (v) => st().setEqMono(v)),
  num('balance', 'Left/right balance', -100, 100, () => Math.round(st().eqBalance * 100), (v) => st().setEqBalance(v / 100)),
  num('boost', 'Volume boost', 100, 200, () => Math.round(st().eqBoost * 100), (v) => st().setEqBoost(v / 100), '%'),
  bool('reverb', 'Reverb on', () => st().reverbEnabled, (v) => st().setReverbEnabled(v)),
  num('reverb-mix', 'Reverb amount', 0, 100, () => Math.round(st().reverbMix * 100), (v) => st().setReverbMix(v / 100), '%'),
  num('reverb-decay', 'Reverb tail length', 1, 8, () => st().reverbDecay, (v) => st().setReverbDecay(v), 's'),
  bool('pitch-shift', 'Let pitch follow the speed', () => st().pitchShift, (v) => st().setPitchShift(v)),
  num('hotkey-seek', 'Seconds the skip shortcuts jump', 1, 120, () => st().hotkeySeekSeconds, (v) => st().setHotkeySeekSeconds(v), 's'),
  bool('global-hotkeys', 'OS-wide keyboard shortcuts (desktop app)', () => st().globalHotkeysEnabled, (v) => st().setGlobalHotkeysEnabled(v)),
  bool('media-overlay', 'Windows media overlay (desktop app)', () => st().mediaOverlayEnabled, (v) => st().setMediaOverlayEnabled(v)),
  bool('auto-report-errors', 'Send crash reports automatically', () => st().autoReportErrors, (v) => st().setAutoReportErrors(v)),
  bool('developer-mode', 'Developer tab in Settings', () => st().developerMode, (v) => st().setDeveloperMode(v)),
]

const show = (s: Setting): string => {
  const v = s.get()
  if (v === null || v === '') return 'auto'
  if (s.kind === 'bool') return v ? 'on' : 'off'
  if (s.kind === 'enum') {
    const label = s.options?.().find((o) => o.value === v)?.label
    return label && label !== v ? `${String(v)} (${label})` : String(v)
  }
  return `${v}${s.unit ?? ''}`
}

function describeRange(s: Setting): string {
  if (s.kind === 'bool') return 'on | off'
  if (s.kind === 'number') return `${s.min}-${s.max}${s.unit ?? ''}`
  if (s.kind === 'color') return '#rrggbb | auto'
  return (s.options?.() ?? []).map((o) => o.value).join(' | ')
}

function findSetting(key: string): Setting {
  const k = key.trim().toLowerCase().replace(/_/g, '-')
  return SETTINGS.find((s) => s.key === k) ?? pickByName(SETTINGS, (s) => s.key, k) ?? fail(`no setting "${key}" (try: settings)`)
}

function applySetting(s: Setting, raw: string): void {
  const value = raw.trim()
  if (s.kind === 'bool') {
    const b = value.toLowerCase() === 'toggle' ? !s.get() : parseBool(value)
    if (b === null) fail(`${s.key}: use on or off`)
    s.set(b)
  } else if (s.kind === 'number') {
    const n = Number(value.replace(/[x%s]$/i, ''))
    if (!Number.isFinite(n)) fail(`${s.key}: expected a number (${describeRange(s)})`)
    if (n < (s.min ?? -Infinity) || n > (s.max ?? Infinity)) fail(`${s.key}: out of range (${describeRange(s)})`)
    s.set(n)
  } else if (s.kind === 'color') {
    if (/^(auto|default|none)$/i.test(value)) {
      if (s.key === 'accent') fail('accent: give a colour like #7c5cff')
      s.set(null)
    } else if (/^#[0-9a-f]{6}$/i.test(value)) s.set(value.toLowerCase())
    else fail(`${s.key}: use a hex colour like #7c5cff${s.key === 'accent' ? '' : ' or auto'}`)
  } else {
    const options = s.options?.() ?? []
    const match = options.find((o) => o.value.toLowerCase() === value.toLowerCase())
      ?? pickByName(options, (o) => o.value, value) ?? pickByName(options, (o) => o.label, value)
    if (!match) fail(`${s.key}: choose one of ${describeRange(s)}`)
    s.set(match!.value)
  }
}

export const SETTINGS_COMMANDS: TermCommand[] = [
  {
    name: 'settings', group: 'Settings', usage: 'settings [filter]', description: 'List every setting you can change here with its current value',
    run: (args, ctx) => {
      const q = args.trim().toLowerCase()
      const rows = SETTINGS.filter((s) => !q || s.key.includes(q) || s.desc.toLowerCase().includes(q))
      if (rows.length === 0) { ctx.print(`no settings match "${args.trim()}"`, 'dim'); return }
      ctx.print(rows.map((s) => `${s.key.padEnd(23)}${show(s).padEnd(16)}${s.desc}`).join('\n'))
    },
  },
  {
    name: 'set', aliases: ['config'], group: 'Settings', usage: 'set <setting> [value]',
    description: 'Show or change a setting (same as the Settings screen). "set <setting>" shows its value and choices; "settings" lists them all',
    complete: (before, partial) => {
      if (before.length === 0) return SETTINGS.map((s) => s.key).filter((k) => k.startsWith(partial.toLowerCase()))
      if (before.length === 1) {
        const s = SETTINGS.find((x) => x.key === before[0].toLowerCase())
        if (!s) return []
        const options = s.kind === 'bool' ? ['on', 'off', 'toggle'] : s.kind === 'enum' ? (s.options?.() ?? []).map((o) => o.value) : s.kind === 'color' && s.key !== 'accent' ? ['auto'] : []
        return options.filter((o) => o.toLowerCase().startsWith(partial.toLowerCase()))
      }
      return []
    },
    run: (args, ctx) => {
      const [key, ...rest] = args.trim().split(/\s+/)
      if (!key) fail('usage: set <setting> [value]  (settings lists them)')
      const setting = findSetting(key)
      if (rest.length === 0) { ctx.print(`${setting.key} = ${show(setting)}\n  ${setting.desc} · ${describeRange(setting)}`); return }
      applySetting(setting, rest.join(' '))
      ctx.print(`${setting.key} = ${show(setting)}`, 'ok')
    },
  },
]
