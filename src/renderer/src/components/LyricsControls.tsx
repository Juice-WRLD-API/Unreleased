import { useState } from 'react'
import { AlignLeft, AlignCenter, LayoutGrid } from 'lucide-react'
import ThemedColorPicker from './ThemedColorPicker'
import { useStore, useStorePick } from '../store/useStore'
import { LYRIC_LOOKS } from '../desktop/lyrics/looks'
import { lazyOverlay } from '../lib/lazyView'

const DesktopPicker = lazyOverlay(() => import('./DesktopPicker'))

// Lyric display controls (size, alignment, blur, colors). Shared by the WRLD
// tab's Customize lyrics modal and the visualizer toolbar's settings popup.

const LYRIC_TEXT_SIZES: { label: string; value: number }[] = [
  { label: 'S', value: 0.85 },
  { label: 'M', value: 1 },
  { label: 'L', value: 1.2 },
  { label: 'XL', value: 1.4 },
]
// The iJWA lyric styles (Settings > Desktop) are desktop-app only, like the rest of Desktop.
const IS_ELECTRON = typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')

/** Classic (the scrolling list these controls style) or one of the iJWA styles, sung word by word. */
function LyricStyleRow(): JSX.Element {
  const look = useStore((s) => s.desktop.lyrics.look)
  const setDesktop = useStore((s) => s.setDesktop)
  const [browsing, setBrowsing] = useState(false)
  const chip = (id: string, title: string): JSX.Element => (
    <button
      key={id}
      onClick={() => setDesktop({ lyrics: { look: id } })}
      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
        look === id
          ? 'bg-accent/15 text-accent border-[var(--accent)]'
          : 'text-text-muted border-[var(--border)] hover:text-text-primary hover:bg-[var(--surface-overlay)]'
      }`}
    >
      {title}
    </button>
  )
  return (
    <div>
      <p className="text-text-secondary text-xs mb-2">Style</p>
      <div className="flex items-center gap-1.5 flex-wrap">
        {chip('classic', 'Classic')}
        {LYRIC_LOOKS.map((l) => chip(l.id, l.title))}
        <button
          onClick={() => setBrowsing(true)}
          title="See every style playing"
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border border-[var(--border)] text-text-muted hover:text-text-primary hover:bg-[var(--surface-overlay)] transition-colors"
        >
          <LayoutGrid size={11} /> Browse
        </button>
      </div>
      {look !== 'classic' && (
        <p className="text-text-muted text-[11px] mt-2">Fonts for each style are in Settings › Desktop. Size, alignment, blur and colors below style Classic.</p>
      )}
      {browsing && <DesktopPicker kind="lyrics" onClose={() => setBrowsing(false)} />}
    </div>
  )
}

const LYRIC_ACTIVE_PRESETS = ['#ffffff', '#1db954', '#a78bfa', '#60a5fa', '#f472b6', '#facc15']
const LYRIC_INACTIVE_PRESETS = ['#9ca3af', '#6b7280', '#94a3b8', '#c4b5fd', '#7dd3fc', '#fda4af']

function LyricColorRow({ label, presets, value, fallback, onChange }: {
  label: string
  presets: string[]
  value: string | null
  fallback: string
  onChange: (color: string | null) => void
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-text-muted text-[11px] w-[86px] shrink-0">{label}</span>
      <button
        onClick={() => onChange(null)}
        className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
          value === null
            ? 'bg-accent/15 text-accent border-[var(--accent)]'
            : 'text-text-muted border-[var(--border)] hover:text-text-primary hover:bg-[var(--surface-overlay)]'
        }`}
      >
        Auto
      </button>
      {presets.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className="w-6 h-6 rounded-full border border-[var(--border)] transition-transform hover:scale-110"
          style={{ backgroundColor: c, outline: value?.toLowerCase() === c ? `2px solid ${c}` : 'none', outlineOffset: '2px' }}
          title={c}
        />
      ))}
      <ThemedColorPicker
        value={value ?? fallback}
        onChange={onChange}
        className="w-6 h-6 rounded-full"
        title="Custom color"
      />
    </div>
  )
}

export default function LyricsControls(): JSX.Element {
  const {
    lyricsScale, setLyricsScale,
    lyricsAlign, setLyricsAlign,
    lyricsBlur, setLyricsBlur,
    lyricsBlurAmount, setLyricsBlurAmount,
    lyricsColorActive, setLyricsColorActive,
    lyricsColorInactive, setLyricsColorInactive,
  } = useStorePick(
    'lyricsScale', 'setLyricsScale', 'lyricsAlign', 'setLyricsAlign',
    'lyricsBlur', 'setLyricsBlur', 'lyricsBlurAmount', 'setLyricsBlurAmount',
    'lyricsColorActive', 'setLyricsColorActive', 'lyricsColorInactive', 'setLyricsColorInactive',
  )

  return (
    <div className="flex flex-col gap-5">
        {IS_ELECTRON && <LyricStyleRow />}
        <div>
          <p className="text-text-secondary text-xs mb-2">Text size</p>
          <div className="flex items-center gap-2 flex-wrap">
            {LYRIC_TEXT_SIZES.map(({ label, value }) => {
              const active = lyricsScale === value
              return (
                <button
                  key={value}
                  onClick={() => setLyricsScale(value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    active
                      ? 'bg-accent/15 text-accent border-[var(--accent)]'
                      : 'text-text-muted border-[var(--border)] hover:text-text-primary hover:bg-[var(--surface-overlay)]'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <p className="text-text-secondary text-xs mb-2">Alignment</p>
          <div className="flex items-center gap-2 flex-wrap">
            {([
              { value: 'left' as const, label: 'Left', icon: AlignLeft },
              { value: 'center' as const, label: 'Center', icon: AlignCenter },
            ]).map(({ value, label, icon: Icon }) => {
              const active = lyricsAlign === value
              return (
                <button
                  key={value}
                  onClick={() => setLyricsAlign(value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    active
                      ? 'bg-accent/15 text-accent border-[var(--accent)]'
                      : 'text-text-muted border-[var(--border)] hover:text-text-primary hover:bg-[var(--surface-overlay)]'
                  }`}
                >
                  <Icon size={14} /> {label}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-text-primary text-sm">Blur inactive lines</p>
            <button
              onClick={() => setLyricsBlur(!lyricsBlur)}
              className={`relative w-10 h-5 rounded-full shrink-0 transition-colors appearance-none border-0 p-0 leading-none ${lyricsBlur ? 'bg-accent' : 'bg-[var(--surface-overlay)]'}`}
            >
              <span className={`absolute inset-y-0 my-auto w-4 h-4 rounded-full bg-white transition-all ${lyricsBlur ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>
          {lyricsBlur && (
            <div className="flex items-center gap-2 mt-2">
              <input
                type="range" min={0.25} max={4} step={0.25}
                value={lyricsBlurAmount}
                onChange={(e) => setLyricsBlurAmount(parseFloat(e.target.value))}
                className="flex-1 accent-[var(--accent)]"
              />
              <span className="text-text-muted text-xs tabular-nums w-8 text-right">{lyricsBlurAmount}×</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-text-secondary text-xs -mb-1">Colors</p>
          <LyricColorRow
            label="Current line"
            presets={LYRIC_ACTIVE_PRESETS}
            value={lyricsColorActive}
            fallback="#ffffff"
            onChange={setLyricsColorActive}
          />
          <LyricColorRow
            label="Other lines"
            presets={LYRIC_INACTIVE_PRESETS}
            value={lyricsColorInactive}
            fallback="#9ca3af"
            onChange={setLyricsColorInactive}
          />
        </div>
    </div>
  )
}
