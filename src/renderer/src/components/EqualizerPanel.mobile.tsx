import { useEffect, useRef, useState, type ReactNode } from 'react'
import { RotateCcw, ChevronDown, Check, X, Save, Trash2 } from 'lucide-react'
import {
  EQ_BANDS, EQ_GAIN_LIMIT, EQ_BOOST_MAX, EQ_PRESETS, EFFECTS_SUPPORTED,
  DEFAULT_FX, FX_RANGES, USER_PRESET_PREFIX, USER_PRESET_NAME_MAX, type AudioFx,
} from '../lib/audioEffects'
import { formatDuration } from '../lib/format'
import { bandLabel, useEqualizerPanelData } from '../hooks/useEqualizerPanelData'

/** iOS switch, same as Settings' - the knob slides on transform. */
function Toggle({ on, onClick }: { on: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`relative w-[51px] h-[31px] rounded-full shrink-0 transition-colors duration-200 appearance-none border-0 p-0 leading-none ${on ? 'bg-accent' : 'bg-[var(--fill-strong)]'}`}
    >
      <span
        className="absolute top-0.5 left-0.5 w-[27px] h-[27px] rounded-full bg-white shadow-[0_3px_8px_rgb(0_0_0/0.15),0_3px_1px_rgb(0_0_0/0.06)] control-motion"
        style={{ transform: on ? 'translateX(20px)' : 'none' }}
      />
    </button>
  )
}

/* ── A small themed replacement for <select>, matching the editor's BasicSelect
   but sized for an inline row rather than a full-width field. ─────────────── */
function InlineSelect({ value, onChange, options, disabled }: {
  value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]; disabled?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const selected = options.find(o => o.value === value)

  return (
    <div ref={ref} className={`relative shrink-0 ${open ? 'z-20' : ''}`}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(v => !v)}
        disabled={disabled}
        className="flex items-center gap-1 pl-3 pr-2 py-1.5 rounded-full bg-[var(--fill)] border border-transparent text-footnote text-text-primary disabled:opacity-40 max-w-[160px]"
      >
        <span className="truncate">{selected?.label ?? '—'}</span>
        <ChevronDown size={12} className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 min-w-[160px] max-h-52 overflow-y-auto rounded-xl glass-thick py-1">
          {options.map(o => {
            const active = o.value === value
            return (
              <button
                key={o.value}
                onClick={() => { onChange(o.value); setOpen(false) }}
                className={`w-full flex items-center gap-1.5 text-left px-3 py-2 text-xs transition-colors ${
                  active ? 'text-accent font-semibold bg-accent/10' : 'text-text-secondary active:bg-surface-overlay'
                }`}
              >
                <span className="flex-1 min-w-0 truncate">{o.label}</span>
                {active && <Check size={12} className="shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Vertical EQ band fader - a touch drag-tracker, not a rotated <input
   type=range> (rotated range inputs hit-test touch input against their
   pre-rotation box, so the finger and the thumb visibly disagree). Tap the
   frequency label under a band to reset just that one. ─────────────────── */
function BandFader({ value, onChange, disabled }: {
  value: number; onChange: (v: number) => void; disabled?: boolean
}): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const valueFromClientY = (clientY: number): number => {
    const el = trackRef.current
    if (!el) return value
    const rect = el.getBoundingClientRect()
    const pct = 1 - Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
    return Math.round(-EQ_GAIN_LIMIT + pct * (EQ_GAIN_LIMIT * 2))
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (disabled) return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    draggingRef.current = true
    onChange(valueFromClientY(e.clientY))
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    if (!draggingRef.current) return
    onChange(valueFromClientY(e.clientY))
  }
  const endDrag = (): void => { draggingRef.current = false }

  const pct = ((value + EQ_GAIN_LIMIT) / (EQ_GAIN_LIMIT * 2)) * 100

  return (
    <div
      ref={trackRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={`relative w-8 h-28 rounded-full bg-[var(--fill)] touch-none select-none ${disabled ? 'opacity-50' : ''}`}
    >
      {/* 0 dB center tick */}
      <div className="absolute left-1.5 right-1.5 top-1/2 h-px -translate-y-1/2 bg-[var(--separator)]" />
      {/* fill from center out to the current gain */}
      <div
        className="absolute left-1.5 right-1.5 rounded-full bg-accent/60 pointer-events-none"
        style={{ bottom: `${Math.min(pct, 50)}%`, top: `${100 - Math.max(pct, 50)}%` }}
      />
      {/* thumb */}
      <div
        className="absolute left-1/2 w-6 h-6 rounded-full bg-white shadow-md border border-[var(--separator)] pointer-events-none"
        style={{ bottom: `${pct}%`, transform: 'translate(-50%, 50%)' }}
      />
    </div>
  )
}

/* ── A labeled row wrapper for the horizontal sliders below (balance, reverb,
   speed) - value on the right, a reset button that only shows when dirty. ── */
function SliderRow({ label, value, formatted, onReset, dirty, children }: {
  label: string; value?: string; formatted?: string; onReset?: () => void; dirty?: boolean; children: ReactNode
}): JSX.Element {
  return (
    <div className="flex items-center gap-3 px-5 py-1.5">
      <span className="text-footnote text-text-primary w-16 shrink-0">{label}</span>
      {children}
      <span className="text-xs text-text-muted tabular-nums w-12 text-right">{formatted ?? value}</span>
      <button
        onClick={onReset}
        title="Reset"
        disabled={!dirty}
        className={`shrink-0 w-6 h-6 flex items-center justify-center rounded-full transition-colors ${dirty ? 'text-text-muted active:text-text-primary active:bg-surface-overlay' : 'opacity-0 pointer-events-none'}`}
      >
        <RotateCcw size={12} />
      </button>
    </div>
  )
}

const ms = (s: number): string => `${Math.round(s * 1000)} ms`
const percent = (v: number): string => `${Math.round(v * 100)}%`
const hz = (v: number): string => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} kHz` : `${Math.round(v)} Hz`)
const db = (v: number): string => `${v > 0 ? '+' : ''}${v} dB`

// One labelled horizontal slider. `log` maps the track logarithmically - for
// frequencies, where a linear 1k–20k track would spend most of its length
// on the top octave.
function FxSliderRow({ label, value, min, max, step, onChange, reset, format, title, log = false }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  reset: number
  format: (v: number) => string
  title: string
  log?: boolean
}): JSX.Element {
  const LOG_STEPS = 1000
  const toPos = (v: number): number => (log ? Math.round((Math.log(v / min) / Math.log(max / min)) * LOG_STEPS) : v)
  const fromPos = (p: number): number => {
    if (!log) return p
    const v = min * Math.pow(max / min, p / LOG_STEPS)
    return Math.max(min, Math.min(max, Math.round(v / step) * step))
  }
  return (
    <div className="flex items-center gap-3 px-4 py-1.5">
      <span className="text-footnote text-text-primary w-24 shrink-0">{label}</span>
      <input
        type="range"
        min={log ? 0 : min} max={log ? LOG_STEPS : max} step={log ? 1 : step}
        value={toPos(value)}
        onChange={(e) => onChange(fromPos(parseFloat(e.target.value)))}
        onDoubleClick={() => onChange(reset)}
        className="flex-1 min-w-0 accent-[var(--accent)]"
        title={`${title} - double-click to reset`}
      />
      <span className="text-xs text-text-muted tabular-nums w-14 text-right shrink-0">{format(value)}</span>
    </div>
  )
}

// A switchable effect: title row with its toggle, and its knobs below only
// while it's on - with this many effects, greyed-out knobs for every one
// that's off would make the panel several screens tall.
function FxSection({ title, sub, on, onToggle, children }: {
  title: string
  sub: string
  on: boolean
  onToggle: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <>
      <div className="border-t border-[var(--separator)] mx-4" />
      <div className="flex items-center justify-between px-4 pt-2.5 pb-2.5">
        <div>
          <p className="text-subhead text-text-primary">{title}</p>
          <p className="text-caption1 text-text-muted">{sub}</p>
        </div>
        <Toggle on={on} onClick={onToggle} />
      </div>
      {on && <div className="-mt-1 pb-1.5">{children}</div>}
    </>
  )
}

// Click once to arm, again within 3s to run - for the actions that throw
// work away (resetting every knob, deleting a saved preset).
function useConfirmClick(): [boolean, (run: () => void) => void, () => void] {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const id = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(id)
  }, [armed])
  return [armed, (run) => { if (armed) { setArmed(false); run() } else setArmed(true) }, () => setArmed(false)]
}

// The equalizer sheet's contents. Opening/closing (Sheet + backdrop) is owned
// by the caller (Player), matching how other rich-content sheets work.
export default function EqualizerPanel(): JSX.Element {
  const {
    eqEnabled, setEqEnabled,
    eqGains, setEqBand,
    eqPreset, setEqPreset,
    eqBalance, setEqBalance,
    eqMono, setEqMono,
    eqBoost, setEqBoost,
    audioFx, setAudioFx,
    eqUserPresets, saveEqUserPreset, deleteEqUserPreset, resetSoundEffects,
    skipSilence, setSkipSilence,
    playbackSpeed, setPlaybackSpeed,
    pitchShift, setPitchShift,
    reverbEnabled, setReverbEnabled,
    reverbMix, setReverbMix,
    reverbDecay, setReverbDecay,
    communityEdits, playCommunityEdit,
    abLoopStart, abLoopEnd, setAbLoopPoint, clearAbLoop,
    preferOgVersion, setPreferOgVersion,
    sleepTimerEnd, setSleepTimer,
    audioOutput, setAudioOutput,
    radioFmActive, currentTrack,
    balanceLabel, sleepMinutes, setSleepMinutes, outputDevices,
    instrumentalsSong, instrumentals, playInstrumental,
  } = useEqualizerPanelData()

  // Shorthand for the AudioFx knobs: range + reset value straight from the
  // shared tables, so the panel can't drift from what the terminal accepts.
  const fxSlider = (key: keyof typeof FX_RANGES, label: string, format: (v: number) => string, title: string, log = false): JSX.Element => (
    <FxSliderRow
      label={label} title={title} format={format} log={log}
      value={audioFx[key]} reset={DEFAULT_FX[key]}
      min={FX_RANGES[key].min} max={FX_RANGES[key].max} step={FX_RANGES[key].step}
      onChange={(v) => setAudioFx({ [key]: v } as Partial<AudioFx>)}
    />
  )

  const userPreset = eqUserPresets.find((p) => p.id === eqPreset)
  // Non-null while the save-preset name field is open.
  const [presetName, setPresetName] = useState<string | null>(null)
  const savePreset = (): void => {
    if (!presetName?.trim()) return
    saveEqUserPreset(presetName)
    setPresetName(null)
  }
  const [deleteArmed, confirmDelete, disarmDelete] = useConfirmClick()
  const [resetArmed, confirmReset] = useConfirmClick()
  // A different preset selected = a different delete target; don't carry
  // the armed state over to it.
  useEffect(() => { disarmDelete() }, [eqPreset]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="select-none pb-1">
      {/* Header: enable toggle + reset-everything */}
      <div className="flex items-center justify-between px-5 pb-2">
        <span className="text-subhead text-text-primary">Enabled</span>
        <div className="flex items-center gap-3">
          {(playbackSpeed !== 1 || pitchShift || (EFFECTS_SUPPORTED && (eqBalance !== 0 || eqMono || skipSilence || reverbEnabled || eqGains.some(g => g !== 0)))) && (
            <button
              onClick={() => {
                // iOS: only speed/pitch actually apply here. Leave the synced
                // EQ/effects settings alone so this doesn't flatten them on
                // the user's other devices too.
                if (EFFECTS_SUPPORTED) {
                  setEqPreset('flat')
                  setEqBalance(0); setEqMono(false); setSkipSilence(false)
                  setReverbEnabled(false); setReverbMix(0.4); setReverbDecay(3)
                }
                setPlaybackSpeed(1); setPitchShift(false)
              }}
              className="flex items-center gap-1 text-footnote font-semibold text-accent active:opacity-60 transition-colors"
            >
              <RotateCcw size={11} /> Reset all
            </button>
          )}
          <Toggle on={eqEnabled && EFFECTS_SUPPORTED} onClick={() => { if (EFFECTS_SUPPORTED) setEqEnabled(!eqEnabled) }} />
        </div>
      </div>

      {/* iOS: the EQ/balance/mono/reverb chain is disabled so audio keeps
          playing in the background (routing through Web Audio forfeits that on
          iOS - see platform IS_IOS). Speed, sleep timer, and community
          edits below don't use the chain and still work. */}
      {!EFFECTS_SUPPORTED && (
        <p className="mx-5 mb-2 text-footnote text-text-muted bg-[var(--fill)] rounded-xl px-3 py-2">
          Equalizer & sound effects are off on iOS so music keeps playing when you leave the app.
        </p>
      )}

        {/* Preset picker, plus saving the current bands as a named preset of
            your own (listed under the built-ins) and deleting one. */}
        <div className="flex items-center justify-between gap-3 px-5 pb-3">
          <span className="text-subhead text-text-primary shrink-0">Preset</span>
          {presetName != null ? (
            <form onSubmit={(e) => { e.preventDefault(); savePreset() }} className="flex items-center gap-2 flex-1 min-w-0 justify-end">
              <input
                autoFocus
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                maxLength={USER_PRESET_NAME_MAX}
                placeholder="Preset name"
                className="flex-1 min-w-0 bg-[var(--fill)] text-text-primary text-subhead rounded-full px-3 py-1.5 border border-transparent outline-none focus:border-[var(--accent)]"
              />
              <button
                type="submit"
                disabled={!presetName.trim()}
                title="Save these bands as a preset"
                className="px-3.5 py-1.5 rounded-full text-footnote font-semibold bg-accent/15 text-accent active:bg-accent/25 disabled:opacity-40 transition-colors"
              >
                Save
              </button>
              <button type="button" onClick={() => setPresetName(null)} title="Cancel" className="text-text-muted active:text-text-primary transition-colors">
                <X size={14} />
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2.5 min-w-0">
              <InlineSelect
                value={eqPreset}
                onChange={setEqPreset}
                disabled={!eqEnabled}
                options={[
                  ...(eqPreset === 'custom' ? [{ value: 'custom', label: 'Custom' }] : []),
                  ...EQ_PRESETS.map((p) => ({ value: p.id, label: p.name })),
                  ...eqUserPresets.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
              <button
                onClick={() => setPresetName(userPreset?.name ?? '')}
                disabled={!eqEnabled}
                title="Save these bands as a preset"
                className="text-text-muted active:text-text-primary disabled:opacity-40 transition-colors"
              >
                <Save size={14} />
              </button>
              {userPreset && (
                <button
                  onClick={() => confirmDelete(() => deleteEqUserPreset(userPreset.id))}
                  disabled={!eqEnabled}
                  title={deleteArmed ? `Tap again to delete "${userPreset.name}"` : `Delete "${userPreset.name}"`}
                  className={`flex items-center gap-1 text-[10px] font-medium disabled:opacity-40 transition-colors ${deleteArmed ? 'text-red-400' : 'text-text-muted active:text-text-primary'}`}
                >
                  <Trash2 size={14} />
                  {deleteArmed && 'Delete?'}
                </button>
              )}
            </div>
          )}
      </div>

      {/* Community edits - community-made audio FILES (instrumentals,
          sped-up, remixes, …), not effect presets: tapping one plays that
          file in place of the current song, keeping the queue. Instrumentals
          come from the file tree's Instrumentals folder for the playing song;
          the API endpoints for the rest don't exist yet, so the store list
          stays empty for now. */}
      <div className="px-5 pb-3">
        <p className="text-footnote font-semibold text-text-secondary pb-1.5">Community edits</p>
        {instrumentalsSong && instrumentals == null ? (
          <p className="text-footnote text-text-muted px-1 py-2">Looking for instrumentals…</p>
        ) : !instrumentals?.length && communityEdits.length === 0 ? (
          <p className="text-footnote text-text-muted bg-[var(--fill)] rounded-xl px-3 py-2">
            {instrumentalsSong ? 'No instrumentals or edits for this song yet.' : 'Play a song to see its instrumentals and edits.'}
          </p>
        ) : (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {instrumentals?.map((inst) => {
              const playing = currentTrack?.path === inst.path
              return (
                <button
                  key={inst.path}
                  onClick={() => playInstrumental(inst)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left bg-[var(--fill)] border transition-colors ${playing ? 'border-accent' : 'border-transparent active:border-accent'}`}
                >
                  <span className="flex-1 min-w-0">
                    <span className={`block text-subhead truncate ${playing ? 'text-accent font-semibold' : 'text-text-primary'}`}>{inst.name}</span>
                    <span className="block text-caption1 text-text-muted truncate">Instrumental · {inst.folder} · {inst.era}</span>
                  </span>
                  {inst.duration > 0 && <span className="text-[10px] text-text-muted tabular-nums shrink-0">{formatDuration(inst.duration)}</span>}
                </button>
              )
            })}
            {communityEdits.map((edit) => (
              <button
                key={edit.id}
                onClick={() => playCommunityEdit(edit)}
                title="Play this edit"
                className="w-full flex items-baseline gap-2 px-3 py-2 rounded-xl text-left bg-[var(--fill)] border border-[var(--separator)] active:border-accent transition-colors"
              >
                <span className="text-subhead text-text-primary truncate">{edit.name}</span>
                {edit.author && <span className="text-[10px] text-text-muted truncate shrink-0">by {edit.author}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Graph-dependent effects (EQ bands, balance, mono, skip-silence,
          reverb) - all routed through the Web Audio chain, so all unavailable
          on iOS where the chain is off for background playback. */}
      <div className={!EFFECTS_SUPPORTED ? 'opacity-40 pointer-events-none' : ''}>

      {/* Band faders */}
      <div className={`px-5 pb-2 transition-opacity ${eqEnabled ? '' : 'opacity-40 pointer-events-none'}`}>
        <div className="flex justify-between">
          {EQ_BANDS.map((freq, i) => {
            const gain = eqGains[i] ?? 0
            return (
              <div key={freq} className="flex flex-col items-center gap-1.5">
                {/* Always shown (including "0") - a band's setting should be
                    readable without a drag in progress. */}
                <span className={`text-[9px] tabular-nums h-3 ${gain !== 0 ? 'text-accent font-semibold' : 'text-text-muted'}`}>
                  {gain > 0 ? `+${gain}` : gain}
                </span>
                <BandFader value={gain} onChange={(v) => setEqBand(i, v)} disabled={!eqEnabled} />
                <button
                  onClick={() => setEqBand(i, 0)}
                  title={`${bandLabel(freq)} Hz - tap to reset`}
                  className="text-[9px] text-text-muted px-1 py-0.5 active:text-accent transition-colors"
                >
                  {bandLabel(freq)}
                </button>
              </div>
            )
          })}
        </div>
        {/* Preamp: level into the bands - pull it down when a curve boosts a
            lot (so the limiter isn't working all the time), or up when it
            mostly cuts. */}
        <div className="-mx-4 pt-1">
          {fxSlider('preamp', 'Preamp', db, 'Level going into the bands')}
        </div>
      </div>

      <div className="border-t border-[var(--separator)] mx-5" />

      {/* Balance */}
      <SliderRow label="Balance" formatted={balanceLabel} dirty={eqBalance !== 0} onReset={() => setEqBalance(0)}>
        <input
          type="range" min={-1} max={1} step={0.05}
          value={eqBalance}
          onChange={(e) => setEqBalance(parseFloat(e.target.value))}
          className="flex-1 accent-[var(--accent)]"
        />
      </SliderRow>

      {/* Stereo width - 0% folds to mono, 100% is the mix as released, above
          that pushes what's panned out further to the sides. */}
      <div className={`-mt-1 transition-opacity ${eqMono ? 'opacity-40 pointer-events-none' : ''}`}>
        {fxSlider('width', 'Stereo width', percent, eqMono ? 'No effect while mono audio is on' : 'Narrow toward mono or widen past the original mix')}
      </div>

      {/* Mono */}
      <div className="flex items-center justify-between px-5 py-2.5">
        <div>
          <p className="text-subhead text-text-primary">Mono audio</p>
          <p className="text-caption1 text-text-muted">Play both channels as one</p>
        </div>
        <Toggle on={eqMono} onClick={() => setEqMono(!eqMono)} />
      </div>

      {/* Volume boost - makeup gain above the element's own 0..100% range,
          for tracks that are just quiet. Runs through the same limiter as
          everything else in the chain so it clamps loud peaks instead of
          clipping them. */}
      <SliderRow label="Volume boost" formatted={`${Math.round(eqBoost * 100)}%`} dirty={eqBoost !== 1} onReset={() => setEqBoost(1)}>
        <input
          type="range" min={1} max={EQ_BOOST_MAX} step={0.05}
          value={eqBoost}
          onChange={(e) => setEqBoost(parseFloat(e.target.value))}
          className="flex-1 accent-[var(--accent)]"
        />
      </SliderRow>
        {/* Saturation - soft clipping for warmth/grit; 0% is off. */}
        {fxSlider('drive', 'Saturation', percent, 'Warm, gritty drive - rounds off peaks and thickens the sound')}

      {/* Skip silence */}
      <div className="flex items-center justify-between px-5 py-2.5">
        <div>
          <p className="text-subhead text-text-primary">Skip silence</p>
          <p className="text-caption1 text-text-muted">Jump over silent parts</p>
        </div>
        <Toggle on={skipSilence} onClick={() => setSkipSilence(!skipSilence)} />
      </div>

      <FxSection title="Reverb" sub="Add space around the sound" on={reverbEnabled} onToggle={() => setReverbEnabled(!reverbEnabled)}>
        <FxSliderRow
          label="Amount" title="Reverb amount (dry/wet mix)" format={percent}
          value={reverbMix} reset={0.4} min={0} max={1} step={0.05}
          onChange={setReverbMix}
        />
        <FxSliderRow
          label="Decay" title="Reverb tail length" format={(v) => `${v.toFixed(1)} s`}
          value={reverbDecay} reset={3} min={1} max={8} step={0.5}
          onChange={setReverbDecay}
        />
      </FxSection>

      <FxSection title="Echo" sub="Repeats that trail off behind the music" on={audioFx.echo} onToggle={() => setAudioFx({ echo: !audioFx.echo })}>
        {fxSlider('echoTime', 'Time', (v) => (v >= 1 ? `${v.toFixed(2)} s` : ms(v)), 'Gap between repeats')}
        {fxSlider('echoFeedback', 'Feedback', percent, 'How many repeats - higher trails on longer')}
        {fxSlider('echoMix', 'Level', percent, 'How loud the repeats are')}
      </FxSection>

      <FxSection title="8D audio" sub="Sound circles around your head" on={audioFx.autoPan} onToggle={() => setAudioFx({ autoPan: !audioFx.autoPan })}>
        {fxSlider('autoPanPeriod', 'Rotation', (v) => `${v.toFixed(1)} s`, 'Seconds per full sweep - lower is faster')}
        {fxSlider('autoPanDepth', 'Depth', percent, 'How far to each side it swings')}
      </FxSection>

      <FxSection title="Compressor" sub="Even out loud and quiet parts" on={audioFx.compressor} onToggle={() => setAudioFx({ compressor: !audioFx.compressor })}>
        {fxSlider('compThreshold', 'Threshold', db, 'Level above which compression starts - lower squeezes more')}
        {fxSlider('compRatio', 'Ratio', (v) => `${v}:1`, 'How hard levels above the threshold are pulled down')}
        {fxSlider('compAttack', 'Attack', ms, 'How fast it reacts to a loud hit')}
        {fxSlider('compRelease', 'Release', ms, 'How fast it lets go afterwards')}
      </FxSection>

      <FxSection title="Filter" sub="Cut lows and highs - lo-fi, muffled, radio" on={audioFx.filter} onToggle={() => setAudioFx({ filter: !audioFx.filter })}>
        {fxSlider('lowCut', 'Low cut', hz, 'Removes everything below this frequency', true)}
        {fxSlider('highCut', 'High cut', hz, 'Removes everything above this frequency', true)}
        {fxSlider('filterResonance', 'Resonance', (v) => `${v} dB`, 'Emphasis right at the cut points')}
      </FxSection>

      </div>{/* end graph-dependent effects block */}

      {/* Speed - one control for slowed AND sped-up; with pitch shift on,
          below 1x is the slowed feel, above 1x goes nightcore. Hidden during
          FM: a live stream has no meaningful playback rate. */}
      {!radioFmActive && (
        <>
          <div className="border-t border-[var(--separator)] mx-5" />
          {/* No on/off toggle here: 1x already *is* off. */}
          <div className="px-5 pt-2.5 pb-1">
            <p className="text-subhead text-text-primary">Speed</p>
            <p className="text-caption1 text-text-muted">Slow down or speed up playback</p>
          </div>
          <div className="pb-1">
            <SliderRow label="Rate" formatted={`${playbackSpeed.toFixed(2)}x`} dirty={playbackSpeed !== 1} onReset={() => setPlaybackSpeed(1)}>
              <input
                type="range" min={0.5} max={2} step={0.05}
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                className="flex-1 accent-[var(--accent)]"
              />
            </SliderRow>
            <div className="flex items-center justify-between px-5 py-1.5">
              <div>
                <p className="text-subhead text-text-primary">Pitch shift</p>
                <p className="text-caption1 text-text-muted">Pitch follows speed - slowed below 1x, nightcore above</p>
              </div>
              <Toggle on={pitchShift} onClick={() => setPitchShift(!pitchShift)} />
            </div>
          </div>
        </>
      )}

      {/* A-B loop - repeats a marked portion of the current track. Pure
          audio.currentTime manipulation (no Web Audio graph involved), so it
          works even where EFFECTS_SUPPORTED is false (iOS) - lives outside
          that gated block. Hidden during FM: a live stream has no positions
          to mark. One button cycles Set A → Set B → Looping → clear, mirroring
          the classic single-button A-B repeat control. */}
      {!radioFmActive && (
        <>
          <div className="border-t border-[var(--separator)] mx-5" />
          <div className="flex items-center justify-between gap-3 px-5 py-2.5">
            <div className="min-w-0">
              <p className="text-subhead text-text-primary">A-B loop</p>
              <p className="text-caption1 text-text-muted truncate">
                {abLoopStart == null
                  ? 'Repeat a portion of this song'
                  : abLoopEnd == null
                    ? `Point A at ${formatDuration(abLoopStart)} - pick point B`
                    : `Looping ${formatDuration(abLoopStart)}–${formatDuration(abLoopEnd)}`}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={setAbLoopPoint}
                className={`h-9 px-3.5 rounded-full text-footnote font-semibold transition-colors ${
                  abLoopEnd != null
                    ? 'bg-accent/15 text-accent active:bg-accent/25'
                    : 'bg-[var(--surface-overlay)] text-text-secondary active:text-text-primary'
                }`}
              >
                {abLoopStart == null ? 'Set A' : abLoopEnd == null ? 'Set B' : 'Looping'}
              </button>
              {abLoopStart != null && (
                <button
                  onClick={clearAbLoop}
                  aria-label="Clear loop"
                  className="w-9 h-9 flex items-center justify-center rounded-full text-text-muted active:text-text-primary active:bg-[var(--surface-overlay)] transition-colors"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Prefer OG version - a playback preference rather than an effect, so
          it sits with the sleep timer / output group at the bottom. */}
      <div className="border-t border-[var(--separator)] mx-5" />
      <div className="flex items-center justify-between gap-3 px-5 py-2.5">
        <div className="min-w-0">
          <p className="text-subhead text-text-primary">Prefer OG file</p>
          <p className="text-caption1 text-text-muted">Play a song's OG version when it has one</p>
        </div>
        <Toggle on={preferOgVersion} onClick={() => setPreferOgVersion(!preferOgVersion)} />
      </div>

      {/* Sleep timer */}
      <div className="flex items-center justify-between gap-3 px-5 py-2.5">
        <div className="min-w-0">
          <p className="text-subhead text-text-primary">Sleep timer</p>
          {sleepTimerEnd ? (
            <p className="text-[10px] text-accent font-medium">
              {Math.max(0, Math.ceil((sleepTimerEnd - Date.now()) / 60000))} min left
            </p>
          ) : (
            <p className="text-caption1 text-text-muted">Pause playback after a delay</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!sleepTimerEnd && (
            <InlineSelect
              value={String(sleepMinutes)}
              onChange={(v) => setSleepMinutes(parseInt(v, 10))}
              options={[15, 30, 45, 60, 90].map((m) => ({ value: String(m), label: `${m} min` }))}
            />
          )}
          <button
            onClick={() => setSleepTimer(sleepTimerEnd ? null : Date.now() + sleepMinutes * 60 * 1000)}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-colors ${
              sleepTimerEnd ? 'bg-red-500/15 text-red-400 active:bg-red-500/25' : 'bg-accent/15 text-accent active:bg-accent/25'
            }`}
          >
            {sleepTimerEnd ? 'Cancel' : 'Start'}
          </button>
        </div>
      </div>

      {/* Output device */}
      {outputDevices.length > 0 && (
        <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-0.5">
          <p className="text-xs text-text-secondary shrink-0">Output</p>
          <InlineSelect
            value={audioOutput}
            onChange={setAudioOutput}
            options={[
              { value: '', label: 'Default' },
              ...outputDevices.map((d) => ({ value: d.deviceId, label: d.label || `Output ${d.deviceId.slice(0, 8)}` })),
            ]}
          />
        </div>
      )}
    </div>
  )
}
