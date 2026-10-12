import { useState, type ReactNode } from 'react'
import { VISUALIZERS, type Boost, type Quality } from '../lib/viz'
import { useVizStore, type CaptionPos, type VizCycle } from '../store/vizStore'

export function Pills<T extends string>({ value, options, onChange }: {
  value: T
  options: { value: T; label: string; disabled?: boolean; title?: string }[]
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          disabled={o.disabled}
          title={o.title}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors disabled:opacity-35 disabled:pointer-events-none ${
            value === o.value
              ? 'bg-accent/15 text-accent border-[var(--accent)]'
              : 'text-text-muted border-[var(--border)] hover:text-text-primary hover:bg-[var(--surface-overlay)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// Probed once and released straight away - a live context per Settings render
// would count against the browser's cap on WebGL contexts.
let webglProbe: boolean | null = null
export function webglAvailable(): boolean {
  if (webglProbe === null) {
    const gl = document.createElement('canvas').getContext('webgl')
    webglProbe = !!gl
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  }
  return webglProbe
}

export function Toggle({ on, onClick, locked }: { on: boolean; onClick: () => void; locked?: boolean }): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={locked}
      title={locked ? 'Locked off while the Pill navigation style is selected' : undefined}
      className={`relative w-10 h-5 rounded-full shrink-0 transition-colors appearance-none border-0 p-0 leading-none ${on ? 'bg-accent' : 'bg-[var(--surface-overlay)]'} ${locked ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {/* Vertically centered with inset-y-0 + my-auto (an auto-margin flex/
          block centering trick) instead of a manual top offset - a fixed
          `top-0.5` still relied on the button having zero padding/border to
          land exactly right, and browsers don't zero those out on <button>
          by default. auto-margin centering can't drift regardless of the
          button's own box model. No shadow on the knob either - its default
          downward offset (0 1px 3px) reads as visual weight sitting low,
          making it look off-center even when it's geometrically centered. */}
      <span className={`absolute inset-y-0 my-auto w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  )
}

/** Every visualizer control, shared by Settings and the WRLD toolbar's popup. */
export default function VizControls(): JSX.Element {
  const s = useVizStore()
  const gl = webglAvailable()
  const line = (label: string, control: ReactNode): JSX.Element => (
    <div className="flex items-start gap-2">
      <span className="text-text-muted text-[11px] w-[86px] shrink-0 pt-1">{label}</span>
      <div className="min-w-0 flex-1">{control}</div>
    </div>
  )
  return (
    <div className="flex flex-col gap-2.5">
      {line('Visualizer', (
        <Pills
          // A saved shader mode plays as Aurora without WebGL; highlight that.
          value={!gl && VISUALIZERS.find((v) => v.id === s.vizMode)?.engine === 'gl' ? 'aurora' : s.vizMode}
          onChange={(id) => s.selectMode(id, true)}
          options={VISUALIZERS.map((v) => ({
            value: v.id,
            label: v.name,
            disabled: v.engine === 'gl' && !gl,
            title: v.engine === 'gl' && !gl ? 'Needs WebGL, which this browser has turned off' : undefined,
          }))}
        />
      ))}
      {line('Quality', (
        <Pills<Quality>
          value={s.vizQuality}
          onChange={s.setVizQuality}
          options={[
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'ultra', label: 'Ultra' },
          ]}
        />
      ))}
      {line('Input boost', (
        <Pills<Boost>
          value={s.vizBoost}
          onChange={s.setVizBoost}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'auto', label: 'Auto', title: 'Lifts quiet tracks, and low volume, so the visuals still move' },
            { value: '2', label: '2×' },
            { value: '4', label: '4×' },
            { value: '8', label: '8×' },
          ]}
        />
      ))}
      {line('Auto-switch', (
        <Pills<VizCycle>
          value={s.vizCycle}
          onChange={s.setVizCycle}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'track', label: 'Each track' },
            { value: 'album', label: 'Each album' },
          ]}
        />
      ))}
      {line('Layout', (
        <Pills<'player' | 'minimal'>
          value={s.immMinimal ? 'minimal' : 'player'}
          onChange={(v) => s.setImmMinimal(v === 'minimal')}
          options={[
            { value: 'player', label: 'Player & lyrics' },
            { value: 'minimal', label: 'Visualizer only' },
          ]}
        />
      ))}
      {s.immMinimal && line('Caption', (
        <Pills<CaptionPos>
          value={s.immCaptionPos}
          onChange={s.setImmCaptionPos}
          options={[
            { value: 'tl', label: 'Top left' },
            { value: 'tr', label: 'Top right' },
            { value: 'bl', label: 'Bottom left' },
            { value: 'br', label: 'Bottom right' },
          ]}
        />
      ))}
      <div className="flex items-center gap-2">
        <span className="text-text-muted text-[11px] w-[86px] shrink-0">Artwork colors</span>
        <Toggle on={s.vizUseArtwork} onClick={() => s.setVizUseArtwork(!s.vizUseArtwork)} />
      </div>
    </div>
  )
}
