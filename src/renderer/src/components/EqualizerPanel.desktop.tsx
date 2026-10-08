import { RotateCcw, X } from 'lucide-react'
import { EQ_BANDS, EQ_GAIN_LIMIT, EQ_BOOST_MAX, EQ_PRESETS, EFFECTS_SUPPORTED } from '../lib/audioEffects'
import { formatDuration } from '../lib/format'
import { bandLabel, useEqualizerPanelData } from '../hooks/useEqualizerPanelData'

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`relative w-10 h-5 rounded-full shrink-0 transition-colors appearance-none border-0 p-0 leading-none ${on ? 'bg-accent' : 'bg-[var(--surface-overlay)]'}`}
    >
      <span className={`absolute inset-y-0 my-auto w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  )
}

// The equalizer popover's contents. Positioning (portal + backdrop) is owned
// by the caller (Player), matching how the output-device picker works.
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
    balanceLabel, sleepMinutes, setSleepMinutes, outputDevices,
  } = useEqualizerPanelData()

  return (
    <div className="w-[340px] select-none">
      {/* Header: title + enable toggle */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">Equalizer</p>
        <div className="flex items-center gap-2.5">
          <Toggle on={eqEnabled && EFFECTS_SUPPORTED} onClick={() => { if (EFFECTS_SUPPORTED) setEqEnabled(!eqEnabled) }} />
        </div>
      </div>

      {/* iOS: the EQ/balance/mono/reverb chain is disabled so audio keeps
          playing in the background (routing through Web Audio forfeits that on
          iOS - see platform IS_IOS). Speed, sleep timer, and community
          edits below don't use the chain and still work. */}
      {!EFFECTS_SUPPORTED && (
        <p className="mx-4 mb-2 text-[11px] text-text-muted bg-[var(--surface-overlay)] border border-[var(--border)] rounded-lg px-3 py-2">
          Equalizer & sound effects are off on iOS so music keeps playing when you leave the app.
        </p>
      )}

      {/* Preset picker */}
      <div className="px-4 pb-3">
        <select
          value={eqPreset}
          onChange={(e) => setEqPreset(e.target.value)}
          disabled={!eqEnabled}
          className="w-full bg-[var(--surface-overlay)] text-text-primary text-xs rounded-lg px-2 py-1.5 border border-[var(--border)] disabled:opacity-50"
        >
          {eqPreset === 'custom' && <option value="custom">Custom</option>}
          {EQ_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Community edits - community-made audio FILES (sped-up, remixes, …),
          not effect presets: clicking one plays that file through the normal
          queue. The API endpoints for them don't exist yet, so the store list
          stays empty and only the empty state renders for now. */}
      <div className="px-4 pb-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted pb-1.5">Community edits</p>
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
                className="w-full flex items-baseline gap-2 px-3 py-1.5 rounded-lg text-left bg-[var(--surface-overlay)] border border-[var(--border)] hover:border-[var(--accent)] transition-colors"
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

      {/* Band sliders */}
      <div className={`px-4 pb-2 transition-opacity ${eqEnabled ? '' : 'opacity-40 pointer-events-none'}`}>
        <div className="flex justify-between">
          {EQ_BANDS.map((freq, i) => {
            const gain = eqGains[i] ?? 0
            // Track fill runs from the 0 dB center out to the current gain.
            // The input is rotated -90°, so its own 0–100% axis reads
            // bottom-to-top on screen.
            const pct = ((gain + EQ_GAIN_LIMIT) / (EQ_GAIN_LIMIT * 2)) * 100
            return (
              <div key={freq} className="flex flex-col items-center gap-1">
                {/* Always shown (including "0") - a band's setting should be
                    readable without hovering it. */}
                <span className={`text-[9px] tabular-nums h-3 ${gain !== 0 ? 'text-accent font-semibold' : 'text-text-muted'}`}>
                  {gain > 0 ? `+${gain}` : gain}
                </span>
                {/* Vertical slider: a rotated horizontal range input */}
                <div className="eq-band relative h-24 w-6 flex items-center justify-center">
                  <input
                    type="range"
                    min={-EQ_GAIN_LIMIT} max={EQ_GAIN_LIMIT} step={1}
                    value={gain}
                    onChange={(e) => setEqBand(i, parseInt(e.target.value, 10))}
                    onDoubleClick={() => setEqBand(i, 0)}
                    disabled={!eqEnabled}
                    className="absolute w-24 accent-[var(--accent)]"
                    style={{
                      transform: 'rotate(-90deg)',
                      '--lo': `${Math.min(pct, 50)}%`,
                      '--hi': `${Math.max(pct, 50)}%`,
                    } as React.CSSProperties}
                    title={`${bandLabel(freq)} Hz: ${gain > 0 ? '+' : ''}${gain} dB - double-click to reset`}
                  />
                </div>
                <span className="text-[9px] text-text-muted">{bandLabel(freq)}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="border-t border-[var(--border)] mx-4" />

      {/* Balance */}
      <div className="flex items-center gap-3 px-4 py-2.5">
        <span className="text-xs text-text-secondary w-24 shrink-0">Balance</span>
        <span className="text-[10px] text-text-muted">L</span>
        <input
          type="range" min={-1} max={1} step={0.05}
          value={eqBalance}
          onChange={(e) => setEqBalance(parseFloat(e.target.value))}
          onDoubleClick={() => setEqBalance(0)}
          className="flex-1 accent-[var(--accent)]"
          title="Left/right balance - double-click to center"
        />
        <span className="text-[10px] text-text-muted">R</span>
        <span className="text-xs text-text-muted tabular-nums w-8 text-right">{balanceLabel}</span>
      </div>

      {/* Mono */}
      <div className="flex items-center justify-between px-4 py-2.5">
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
      <div className="flex items-center gap-3 px-4 py-2.5">
        <span className="text-xs text-text-secondary w-24 shrink-0">Volume boost</span>
        <input
          type="range" min={1} max={EQ_BOOST_MAX} step={0.05}
          value={eqBoost}
          onChange={(e) => setEqBoost(parseFloat(e.target.value))}
          onDoubleClick={() => setEqBoost(1)}
          className="flex-1 accent-[var(--accent)]"
          title="Boost volume up to 200% - double-click to reset"
        />
        <span className="text-xs text-text-muted tabular-nums w-10 text-right">{Math.round(eqBoost * 100)}%</span>
      </div>

      {/* Skip silence */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <div>
          <p className="text-xs text-text-secondary">Skip silence</p>
          <p className="text-[10px] text-text-muted">Jump over silent parts</p>
        </div>
        <Toggle on={skipSilence} onClick={() => setSkipSilence(!skipSilence)} />
      </div>

      {/* Reverb */}
      <div className="border-t border-[var(--border)] mx-4" />
      <div className="flex items-center justify-between px-4 pt-2.5 pb-1">
        <div>
          <p className="text-xs text-text-secondary">Reverb</p>
          <p className="text-[10px] text-text-muted">Add space and echo</p>
        </div>
        <Toggle on={reverbEnabled} onClick={() => setReverbEnabled(!reverbEnabled)} />
      </div>
      <div className={`pb-1 transition-opacity ${reverbEnabled ? '' : 'opacity-40 pointer-events-none'}`}>
        <div className="flex items-center gap-3 px-4 py-1.5">
          <span className="text-xs text-text-secondary w-24 shrink-0">Amount</span>
          <input
            type="range" min={0} max={1} step={0.05}
            value={reverbMix}
            onChange={(e) => setReverbMix(parseFloat(e.target.value))}
            onDoubleClick={() => setReverbMix(0.4)}
            disabled={!reverbEnabled}
            className="flex-1 accent-[var(--accent)]"
            title="Reverb amount (dry/wet mix) - double-click to reset"
          />
          <span className="text-xs text-text-muted tabular-nums w-12 text-right">{Math.round(reverbMix * 100)}%</span>
        </div>
        <div className="flex items-center gap-3 px-4 py-1.5">
          <span className="text-xs text-text-secondary w-24 shrink-0">Decay</span>
          <input
            type="range" min={1} max={8} step={0.5}
            value={reverbDecay}
            onChange={(e) => setReverbDecay(parseFloat(e.target.value))}
            onDoubleClick={() => setReverbDecay(3)}
            disabled={!reverbEnabled}
            className="flex-1 accent-[var(--accent)]"
            title="Reverb tail length - double-click to reset"
          />
          <span className="text-xs text-text-muted tabular-nums w-12 text-right">{reverbDecay.toFixed(1)}s</span>
        </div>
      </div>

      </div>{/* end graph-dependent effects block */}

      {/* Speed - one control for slowed AND sped-up; with pitch shift on,
          below 1x is the slowed feel, above 1x goes nightcore. Hidden during
          FM: a live stream has no meaningful playback rate. */}
      {!radioFmActive && (
        <>
          <div className="border-t border-[var(--border)] mx-4" />
          {/* No on/off toggle here: 1x already *is* off. */}
          <div className="px-4 pt-2.5 pb-1">
            <p className="text-xs text-text-secondary">Speed</p>
            <p className="text-[10px] text-text-muted">Slow down or speed up playback</p>
          </div>
          <div className="pb-1">
            <div className="flex items-center gap-3 px-4 py-1.5">
              <span className="text-xs text-text-secondary w-24 shrink-0">Rate</span>
              <input
                type="range" min={0.5} max={2} step={0.05}
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                onDoubleClick={() => setPlaybackSpeed(1)}
                className="flex-1 accent-[var(--accent)]"
                title="Playback speed - double-click to reset"
              />
              <span className="text-xs text-text-muted tabular-nums w-12 text-right">{playbackSpeed.toFixed(2)}x</span>
              {playbackSpeed !== 1 && (
                <button
                  onClick={() => setPlaybackSpeed(1)}
                  title="Reset speed"
                  className="text-text-muted hover:text-text-primary transition-colors"
                >
                  <RotateCcw size={12} />
                </button>
              )}
            </div>
            <div className="flex items-center justify-between px-4 py-1.5">
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
          <div className="border-t border-[var(--border)] mx-4" />
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
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
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={setAbLoopPoint}
                title={abLoopStart == null ? 'Mark the start of the loop' : abLoopEnd == null ? 'Mark the end of the loop' : 'Click again to clear'}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  abLoopEnd != null
                    ? 'bg-accent/15 text-accent hover:bg-accent/25'
                    : 'bg-[var(--surface-overlay)] text-text-secondary hover:text-text-primary'
                }`}
              >
                {abLoopStart == null ? 'Set A' : abLoopEnd == null ? 'Set B' : 'Looping'}
              </button>
              {abLoopStart != null && (
                <button onClick={clearAbLoop} title="Clear loop" className="text-text-muted hover:text-text-primary transition-colors">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Prefer OG version - a playback preference rather than an effect, so
          it sits with the sleep timer / output group at the bottom. */}
      <div className="border-t border-[var(--border)] mx-4" />
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div className="min-w-0">
          <p className="text-xs text-text-secondary">Prefer OG file</p>
          <p className="text-[10px] text-text-muted">Play a song's OG version when it has one</p>
        </div>
        <Toggle on={preferOgVersion} onClick={() => setPreferOgVersion(!preferOgVersion)} />
      </div>

      {/* Sleep timer */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
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
            <select
              value={sleepMinutes}
              onChange={(e) => setSleepMinutes(parseInt(e.target.value, 10))}
              className="bg-[var(--surface-overlay)] text-text-primary text-xs rounded-lg px-2 py-1.5 border border-[var(--border)]"
            >
              {[15, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
          )}
          <button
            onClick={() => setSleepTimer(sleepTimerEnd ? null : Date.now() + sleepMinutes * 60 * 1000)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              sleepTimerEnd ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25' : 'bg-accent/15 text-accent hover:bg-accent/25'
            }`}
          >
            {sleepTimerEnd ? 'Cancel' : 'Start'}
          </button>
        </div>
      </div>

      {/* Output device */}
      {outputDevices.length > 0 && (
        <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-0.5">
          <p className="text-xs text-text-secondary shrink-0">Output</p>
          <select
            value={audioOutput}
            onChange={(e) => setAudioOutput(e.target.value)}
            className="bg-[var(--surface-overlay)] text-text-primary text-xs rounded-lg px-2 py-1.5 border border-[var(--border)] max-w-[200px] truncate"
          >
            <option value="">Default</option>
            {outputDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || `Output ${d.deviceId.slice(0, 8)}`}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}
