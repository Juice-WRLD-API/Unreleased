import { useEffect, useRef, useState, type ReactNode } from 'react'
import { RotateCcw, ChevronDown, Check, X } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { EQ_BANDS, EQ_GAIN_LIMIT, EQ_BOOST_MAX, EQ_PRESETS, EFFECTS_SUPPORTED } from '../lib/audioEffects'
import { formatDuration } from '../lib/format'

// Short axis labels for the band sliders (32 … 16K).
function bandLabel(freq: number): string {
  return freq >= 1000 ? `${freq / 1000}K` : String(freq)
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`relative w-11 h-6 rounded-full shrink-0 transition-colors appearance-none border-0 p-0 leading-none ${on ? 'bg-accent' : 'bg-[var(--surface-overlay)]'}`}
    >
      <span className={`absolute inset-y-0.5 w-5 h-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
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
        className="flex items-center gap-1 pl-3 pr-2 py-1.5 rounded-lg bg-[var(--surface-overlay)] border border-[var(--border)] text-xs text-text-primary disabled:opacity-40 max-w-[160px]"
      >
        <span className="truncate">{selected?.label ?? '—'}</span>
        <ChevronDown size={12} className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 min-w-[160px] max-h-52 overflow-y-auto rounded-lg border border-[var(--border)] bg-surface-raised shadow-2xl py-1">
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
      className={`relative w-8 h-28 rounded-full bg-[var(--surface-overlay)] touch-none select-none ${disabled ? 'opacity-50' : ''}`}
    >
      {/* 0 dB center tick */}
      <div className="absolute left-1.5 right-1.5 top-1/2 h-px -translate-y-1/2 bg-[var(--border)]" />
      {/* fill from center out to the current gain */}
      <div
        className="absolute left-1.5 right-1.5 rounded-full bg-accent/60 pointer-events-none"
        style={{ bottom: `${Math.min(pct, 50)}%`, top: `${100 - Math.max(pct, 50)}%` }}
      />
      {/* thumb */}
      <div
        className="absolute left-1/2 w-6 h-6 rounded-full bg-white shadow-md border border-[var(--border)] pointer-events-none"
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
      <span className="text-xs text-text-secondary w-16 shrink-0">{label}</span>
      {children}
      <span className="text-xs text-text-muted tabular-nums w-12 text-right">{formatted ?? value}</span>
      <button
        onClick={onReset}
        disabled={!dirty}
        className={`shrink-0 w-6 h-6 flex items-center justify-center rounded-full transition-colors ${dirty ? 'text-text-muted active:text-text-primary active:bg-surface-overlay' : 'opacity-0 pointer-events-none'}`}
      >
        <RotateCcw size={12} />
      </button>
    </div>
  )
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
    radioFmActive,
  } = useStorePick('eqEnabled', 'setEqEnabled', 'eqGains', 'setEqBand', 'eqPreset', 'setEqPreset', 'eqBalance', 'setEqBalance', 'eqMono', 'setEqMono', 'eqBoost', 'setEqBoost', 'skipSilence', 'setSkipSilence', 'playbackSpeed', 'setPlaybackSpeed', 'pitchShift', 'setPitchShift', 'reverbEnabled', 'setReverbEnabled', 'reverbMix', 'setReverbMix', 'reverbDecay', 'setReverbDecay', 'communityEdits', 'playCommunityEdit', 'abLoopStart', 'abLoopEnd', 'setAbLoopPoint', 'clearAbLoop', 'preferOgVersion', 'setPreferOgVersion', 'sleepTimerEnd', 'setSleepTimer', 'audioOutput', 'setAudioOutput', 'radioFmActive')

  const balancePct = Math.round(eqBalance * 100)
  const balanceLabel = balancePct === 0 ? 'C' : balancePct < 0 ? `L ${-balancePct}` : `R ${balancePct}`

  // Sleep timer - duration picked before starting (mirrors Settings), plus a
  // periodic re-render while running so the countdown stays fresh.
  const [sleepMinutes, setSleepMinutes] = useState(30)
  const [, sleepTick] = useState(0)
  useEffect(() => {
    if (!sleepTimerEnd) return
    const id = setInterval(() => sleepTick((t) => t + 1), 30000)
    return () => clearInterval(id)
  }, [sleepTimerEnd])

  // Output devices - same enumeration the player bar's picker uses.
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    // Absent in some iOS Safari contexts - see Player.tsx's equivalent effect.
    if (!navigator.mediaDevices) return
    const enumerate = async (): Promise<void> => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        setOutputDevices(devices.filter((d) => d.kind === 'audiooutput'))
      } catch { /* ignore */ }
    }
    enumerate()
    navigator.mediaDevices.addEventListener('devicechange', enumerate)
    return () => navigator.mediaDevices.removeEventListener('devicechange', enumerate)
  }, [])

  return (
    <div className="select-none pb-1">
      {/* Header: enable toggle + reset-everything */}
      <div className="flex items-center justify-between px-5 pb-2">
        <span className="text-xs text-text-secondary">Enabled</span>
        <div className="flex items-center gap-3">
          {EFFECTS_SUPPORTED && (eqBalance !== 0 || eqMono || skipSilence || reverbEnabled || playbackSpeed !== 1 || eqGains.some(g => g !== 0)) && (
            <button
              onClick={() => {
                setEqPreset('flat')
                setEqBalance(0); setEqMono(false); setSkipSilence(false)
                setReverbEnabled(false); setReverbMix(0.4); setReverbDecay(3)
                setPlaybackSpeed(1); setPitchShift(false)
              }}
              className="flex items-center gap-1 text-[11px] font-semibold text-text-muted active:text-accent transition-colors"
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
        <p className="mx-5 mb-2 text-[11px] text-text-muted bg-[var(--surface-overlay)] border border-[var(--border)] rounded-lg px-3 py-2">
          Equalizer & sound effects are off on iOS so music keeps playing when you leave the app.
        </p>
      )}

      {/* Preset picker */}
      <div className="flex items-center justify-between gap-3 px-5 pb-3">
        <span className="text-xs text-text-secondary shrink-0">Preset</span>
        <InlineSelect
          value={eqPreset}
          onChange={setEqPreset}
          disabled={!eqEnabled}
          options={[
            ...(eqPreset === 'custom' ? [{ value: 'custom', label: 'Custom' }] : []),
            ...EQ_PRESETS.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
      </div>

      {/* Community edits - community-made audio FILES (sped-up, remixes, …),
          not effect presets: tapping one plays that file through the normal
          queue. The API endpoints for them don't exist yet, so the store list
          stays empty and only the empty state renders for now. */}
      <div className="px-5 pb-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted pb-1.5">Community edits</p>
        {communityEdits.length === 0 ? (
          <p className="text-[11px] text-text-muted bg-[var(--surface-overlay)] border border-[var(--border)] rounded-lg px-3 py-2">
            Nothing here yet - community-made edits will appear once they go live.
          </p>
        ) : (
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {communityEdits.map((edit) => (
              <button
                key={edit.id}
                onClick={() => playCommunityEdit(edit)}
                title="Play this edit"
                className="w-full flex items-baseline gap-2 px-3 py-2 rounded-lg text-left bg-[var(--surface-overlay)] border border-[var(--border)] active:border-accent transition-colors"
              >
                <span className="text-xs text-text-primary truncate">{edit.name}</span>
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
      </div>

      <div className="border-t border-[var(--border)] mx-5" />

      {/* Balance */}
      <SliderRow label="Balance" formatted={balanceLabel} dirty={eqBalance !== 0} onReset={() => setEqBalance(0)}>
        <input
          type="range" min={-1} max={1} step={0.05}
          value={eqBalance}
          onChange={(e) => setEqBalance(parseFloat(e.target.value))}
          className="flex-1 accent-[var(--accent)]"
        />
      </SliderRow>

      {/* Mono */}
      <div className="flex items-center justify-between px-5 py-2.5">
        <div>
          <p className="text-xs text-text-secondary">Mono audio</p>
          <p className="text-[10px] text-text-muted">Play both channels as one</p>
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

      {/* Skip silence */}
      <div className="flex items-center justify-between px-5 py-2.5">
        <div>
          <p className="text-xs text-text-secondary">Skip silence</p>
          <p className="text-[10px] text-text-muted">Jump over silent parts</p>
        </div>
        <Toggle on={skipSilence} onClick={() => setSkipSilence(!skipSilence)} />
      </div>

      {/* Reverb */}
      <div className="border-t border-[var(--border)] mx-5" />
      <div className="flex items-center justify-between px-5 pt-2.5 pb-1">
        <div>
          <p className="text-xs text-text-secondary">Reverb</p>
          <p className="text-[10px] text-text-muted">Add space and echo</p>
        </div>
        <Toggle on={reverbEnabled} onClick={() => setReverbEnabled(!reverbEnabled)} />
      </div>
      <div className={`pb-1 transition-opacity ${reverbEnabled ? '' : 'opacity-40 pointer-events-none'}`}>
        <SliderRow label="Amount" formatted={`${Math.round(reverbMix * 100)}%`} dirty={reverbMix !== 0.4} onReset={() => setReverbMix(0.4)}>
          <input
            type="range" min={0} max={1} step={0.05}
            value={reverbMix}
            onChange={(e) => setReverbMix(parseFloat(e.target.value))}
            disabled={!reverbEnabled}
            className="flex-1 accent-[var(--accent)]"
          />
        </SliderRow>
        <SliderRow label="Decay" formatted={`${reverbDecay.toFixed(1)}s`} dirty={reverbDecay !== 3} onReset={() => setReverbDecay(3)}>
          <input
            type="range" min={1} max={8} step={0.5}
            value={reverbDecay}
            onChange={(e) => setReverbDecay(parseFloat(e.target.value))}
            disabled={!reverbEnabled}
            className="flex-1 accent-[var(--accent)]"
          />
        </SliderRow>
      </div>

      </div>{/* end graph-dependent effects block */}

      {/* Speed - one control for slowed AND sped-up; with pitch shift on,
          below 1x is the slowed feel, above 1x goes nightcore. Hidden during
          FM: a live stream has no meaningful playback rate. */}
      {!radioFmActive && (
        <>
          <div className="border-t border-[var(--border)] mx-5" />
          {/* No on/off toggle here: 1x already *is* off. */}
          <div className="px-5 pt-2.5 pb-1">
            <p className="text-xs text-text-secondary">Speed</p>
            <p className="text-[10px] text-text-muted">Slow down or speed up playback</p>
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
                <p className="text-xs text-text-secondary">Pitch shift</p>
                <p className="text-[10px] text-text-muted">Pitch follows speed - slowed below 1x, nightcore above</p>
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
          <div className="border-t border-[var(--border)] mx-5" />
          <div className="flex items-center justify-between gap-3 px-5 py-2.5">
            <div className="min-w-0">
              <p className="text-xs text-text-secondary">A-B loop</p>
              <p className="text-[10px] text-text-muted truncate">
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
                className={`h-9 px-3.5 rounded-full text-xs font-medium transition-colors ${
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
      <div className="border-t border-[var(--border)] mx-5" />
      <div className="flex items-center justify-between gap-3 px-5 py-2.5">
        <div className="min-w-0">
          <p className="text-xs text-text-secondary">Prefer OG file</p>
          <p className="text-[10px] text-text-muted">Play a song's OG version when it has one</p>
        </div>
        <Toggle on={preferOgVersion} onClick={() => setPreferOgVersion(!preferOgVersion)} />
      </div>

      {/* Sleep timer */}
      <div className="flex items-center justify-between gap-3 px-5 py-2.5">
        <div className="min-w-0">
          <p className="text-xs text-text-secondary">Sleep timer</p>
          {sleepTimerEnd ? (
            <p className="text-[10px] text-accent font-medium">
              {Math.max(0, Math.ceil((sleepTimerEnd - Date.now()) / 60000))} min left
            </p>
          ) : (
            <p className="text-[10px] text-text-muted">Pause playback after a delay</p>
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
