import { useEffect, useMemo, useRef, useState } from 'react'
import { toBlob, toPng } from 'html-to-image'
import { X, Download, Share2, Loader2, Music2 } from 'lucide-react'
import { ModalOverlay } from './Modal'
import { parseLrc, isLrcFormat, getCurrentLineIndex } from '../lib/lyrics'
import { fetchImageDataUrl } from '../lib/coverImage'
import { getAudioCurrentTime } from './Player'
import { useStore } from '../store/useStore'
import logo from '../assets/logo.png'

interface Props {
  title: string
  artist: string
  /** Cover art URL (may be cross-origin - fetched and inlined as a data URL
   *  before export, since the exported canvas can't read a tainted image). */
  imageUrl: string | null | undefined
  /** Plain or LRC-format lyrics text - callers already have this computed
   *  (from the current track, or a 999 FM matched song) as a single blob. */
  rawLyrics: string | null
  onClose: () => void
}

const MAX_LINES = 8

type Format = 'story' | 'square' | 'post' | 'portrait' | 'landscape' | 'widescreen'
type BgStyle = 'blur' | 'solid' | 'gradient'
type TextSize = 'S' | 'M' | 'L'
type TextPos = 'top' | 'center' | 'bottom'
type TextColor = 'white' | 'accent' | 'gold'

const FORMATS: { key: Format; label: string; w: number; h: number }[] = [
  { key: 'story', label: 'Story · 9:16', w: 270, h: 480 },
  { key: 'portrait', label: 'Portrait · 2:3', w: 280, h: 420 },
  { key: 'post', label: 'Post · 4:5', w: 300, h: 375 },
  { key: 'square', label: 'Square · 1:1', w: 340, h: 340 },
  { key: 'landscape', label: 'Landscape · 16:9', w: 400, h: 225 },
  { key: 'widescreen', label: 'Widescreen · 21:9', w: 420, h: 180 },
]

const TEXT_SIZE_MULT: Record<TextSize, number> = { S: 0.8, M: 1, L: 1.25 }
const TEXT_COLOR_VALUE: Record<TextColor, string> = { white: '#fff', accent: 'rgb(var(--accent-rgb))', gold: '#f5c451' }
const JUSTIFY_FOR_POS: Record<TextPos, string> = { top: 'flex-start', center: 'center', bottom: 'flex-end' }

function shareableLines(rawLyrics: string | null): string[] {
  if (!rawLyrics) return []
  if (isLrcFormat(rawLyrics)) return parseLrc(rawLyrics).map(l => l.text).filter(Boolean)
  return rawLyrics.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
}

function baseFontSize(lineCount: number): number {
  if (lineCount <= 2) return 24
  if (lineCount <= 4) return 20
  if (lineCount <= 6) return 17
  return 14
}

/** Small pill-style segmented control, matching the app's own lyrics-display
 *  settings sheet (WrldView.mobile's LyricsSettingsSheet). */
function SegmentedControl<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: { key: T; label: string }[]
  onChange: (v: T) => void
}): JSX.Element {
  return (
    <div>
      <p className="text-text-muted text-[11px] mb-1.5">{label}</p>
      <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--surface-highest)]">
        {options.map(opt => {
          const active = value === opt.key
          return (
            <button
              key={opt.key}
              onClick={() => onChange(opt.key)}
              aria-pressed={active}
              className={`flex-1 min-w-0 h-7 rounded-md text-[11px] font-medium transition-colors ${
                active ? 'bg-accent text-white' : 'text-text-secondary hover:bg-surface-overlay'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function ShareLyricsModal({ title, artist, imageUrl, rawLyrics, onClose }: Props): JSX.Element {
  const lines = useMemo(() => shareableLines(rawLyrics), [rawLyrics])

  const [selStart, setSelStart] = useState(0)
  const [selEnd, setSelEnd] = useState(Math.min(2, Math.max(0, lines.length - 1)))
  const [anchor, setAnchor] = useState<number | null>(null)

  const [format, setFormat] = useState<Format>('story')
  const [bgStyle, setBgStyle] = useState<BgStyle>('blur')
  const [textSize, setTextSize] = useState<TextSize>('M')
  const [textPos, setTextPos] = useState<TextPos>('center')
  const [textColor, setTextColor] = useState<TextColor>('white')

  const { w: cardW, h: cardH } = FORMATS.find(f => f.key === format) ?? FORMATS[0]

  // Default the selection to whatever line is currently playing (± context),
  // for synced lyrics, so sharing mid-song starts from the relevant line.
  useEffect(() => {
    if (!rawLyrics || !isLrcFormat(rawLyrics)) return
    const synced = parseLrc(rawLyrics)
    const idx = getCurrentLineIndex(synced, getAudioCurrentTime() - useStore.getState().lyricsOffset)
    if (idx < 0) return
    const text = synced[idx]?.text
    const flatIdx = text ? lines.indexOf(text) : -1
    if (flatIdx < 0) return
    setSelStart(Math.max(0, flatIdx - 1))
    setSelEnd(Math.min(lines.length - 1, flatIdx + 1))
    // Only want this once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [artDataUrl, setArtDataUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!imageUrl) { setArtDataUrl(null); return }
    fetchImageDataUrl(imageUrl).then(url => { if (!cancelled) setArtDataUrl(url) }).catch(() => { if (!cancelled) setArtDataUrl(null) })
    return () => { cancelled = true }
  }, [imageUrl])

  const cardRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState<'download' | 'share' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleLineClick = (i: number): void => {
    if (anchor === null) {
      setAnchor(i)
      setSelStart(i)
      setSelEnd(i)
      return
    }
    if (anchor === i && selStart === i && selEnd === i) {
      // Clicking the sole selected line again clears the selection.
      setAnchor(null)
      return
    }
    let start = Math.min(anchor, i)
    let end = Math.max(anchor, i)
    if (end - start + 1 > MAX_LINES) {
      // Keep the anchor fixed and clamp the far edge, so the range grows only
      // toward where the user is clicking.
      if (i > anchor) end = start + MAX_LINES - 1
      else start = end - MAX_LINES + 1
    }
    setSelStart(start)
    setSelEnd(end)
  }

  const selectedLines = lines.slice(selStart, selEnd + 1)
  const fontSize = baseFontSize(selectedLines.length) * TEXT_SIZE_MULT[textSize]
  const fileName = `${title} - ${artist}`.replace(/[/\\?%*:|"<>]/g, '').trim() || 'lyrics'
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const renderOpts = { pixelRatio: 4, cacheBust: true, backgroundColor: '#111114' }

  const handleDownload = async (): Promise<void> => {
    if (!cardRef.current) return
    setError(null)
    setBusy('download')
    try {
      const dataUrl = await toPng(cardRef.current, renderOpts)
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `${fileName}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      setError('Could not generate the image.')
    } finally {
      setBusy(null)
    }
  }

  const handleShare = async (): Promise<void> => {
    if (!cardRef.current) return
    setError(null)
    setBusy('share')
    try {
      const blob = await toBlob(cardRef.current, renderOpts)
      if (!blob) throw new Error('empty blob')
      const file = new File([blob], `${fileName}.png`, { type: 'image/png' })
      if (navigator.canShare && !navigator.canShare({ files: [file] })) throw new Error('unsupported')
      await navigator.share({ files: [file], title, text: `${title} - ${artist}` })
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError('Could not share the image.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <ModalOverlay
      onClose={onClose}
      standalone
      zIndexClassName="z-50"
      panelClassName="bg-surface border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-4xl h-[680px] max-h-[88vh]"
      minWidth={520} minHeight={480}
    >
      {() => (
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
            <h2 className="text-text-primary text-sm font-semibold">Share lyrics</h2>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
            <div className="flex-1 min-w-0 min-h-0 flex flex-col border-b md:border-b-0 md:border-r border-[var(--border)]">
              <p className="text-xs text-text-muted px-4 pt-3 pb-2 shrink-0">
                Tap a line, then another, to pick up to {MAX_LINES} lines to share.
              </p>
              <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3">
                {lines.map((line, i) => {
                  const selected = i >= selStart && i <= selEnd && anchor !== null
                  return (
                    <button
                      key={i}
                      onClick={() => handleLineClick(i)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
                        selected ? 'bg-accent/20 text-text-primary' : 'text-text-secondary hover:bg-surface-overlay'
                      }`}
                    >
                      {line}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="w-full md:w-[190px] shrink-0 min-h-0 overflow-y-auto border-b md:border-b-0 md:border-r border-[var(--border)] p-4 flex flex-col gap-4">
              <div>
                <p className="text-text-muted text-[11px] mb-1.5">Format</p>
                <div className="flex flex-col gap-1">
                  {FORMATS.map(f => {
                    const active = format === f.key
                    // Tiny aspect-ratio swatch so the shape reads at a glance,
                    // capped so a 21:9 sliver and a 9:16 tower both stay legible.
                    const ratio = f.w / f.h
                    const boxH = 16
                    const boxW = Math.max(9, Math.min(28, Math.round(boxH * ratio)))
                    return (
                      <button
                        key={f.key}
                        onClick={() => setFormat(f.key)}
                        aria-pressed={active}
                        className={`flex items-center gap-2 px-2 h-8 rounded-md text-[11px] font-medium transition-colors ${
                          active ? 'bg-accent text-white' : 'text-text-secondary hover:bg-surface-overlay'
                        }`}
                      >
                        <span
                          className={`shrink-0 rounded-[2px] border ${active ? 'border-white/70' : 'border-current opacity-60'}`}
                          style={{ width: boxW, height: boxH }}
                        />
                        <span className="truncate">{f.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <SegmentedControl label="Background" value={bgStyle} onChange={setBgStyle}
                options={[{ key: 'blur', label: 'Blur' }, { key: 'solid', label: 'Solid' }, { key: 'gradient', label: 'Gradient' }]} />
              <SegmentedControl label="Text size" value={textSize} onChange={setTextSize}
                options={[{ key: 'S', label: 'S' }, { key: 'M', label: 'M' }, { key: 'L', label: 'L' }]} />
              <SegmentedControl label="Position" value={textPos} onChange={setTextPos}
                options={[{ key: 'top', label: 'Top' }, { key: 'center', label: 'Mid' }, { key: 'bottom', label: 'Bottom' }]} />
              <div>
                <p className="text-text-muted text-[11px] mb-1.5">Color</p>
                <div className="flex items-center gap-2 px-0.5">
                  {(Object.keys(TEXT_COLOR_VALUE) as TextColor[]).map(c => (
                    <button
                      key={c}
                      onClick={() => setTextColor(c)}
                      aria-pressed={textColor === c}
                      title={c}
                      className={`w-6 h-6 rounded-full border-2 transition-transform ${
                        textColor === c ? 'scale-110 border-text-primary' : 'border-transparent hover:scale-105'
                      }`}
                      style={{ background: TEXT_COLOR_VALUE[c], boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)' }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex-1 min-w-0 shrink-0 min-h-0 flex flex-col items-center gap-4 p-5 overflow-y-auto">
              <div
                className="shrink-0 rounded-2xl overflow-hidden shadow-2xl border border-[var(--border)]"
                style={{ width: cardW, height: cardH }}
              >
                <div ref={cardRef} style={{ width: cardW, height: cardH, position: 'relative', background: '#111114' }}>
                  {bgStyle === 'blur' && artDataUrl && (
                    <img
                      src={artDataUrl}
                      alt=""
                      style={{
                        position: 'absolute', inset: -20, width: `calc(100% + 40px)`, height: `calc(100% + 40px)`,
                        objectFit: 'cover', filter: 'blur(28px) brightness(0.55) saturate(1.15)',
                      }}
                    />
                  )}
                  {bgStyle === 'gradient' && (
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(160deg, rgb(var(--accent-rgb) / 0.85), #0b0b0d 72%)' }} />
                  )}
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.12), rgba(0,0,0,0.55))' }} />
                  <div style={{
                    position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                    justifyContent: JUSTIFY_FOR_POS[textPos], padding: '30px 26px 90px', gap: 6,
                  }}>
                    {selectedLines.length === 0 ? (
                      <p style={{ color: 'rgba(255,255,255,0.55)', fontFamily: 'var(--font-lyrics)', fontSize: 13, textAlign: 'center' }}>
                        Select lines to preview
                      </p>
                    ) : selectedLines.map((line, i) => (
                      <p
                        key={i}
                        style={{
                          color: TEXT_COLOR_VALUE[textColor], fontFamily: 'var(--font-lyrics)', fontWeight: 700,
                          fontSize, lineHeight: 1.35, margin: 0,
                          textShadow: '0 2px 14px rgba(0,0,0,0.55)',
                        }}
                      >
                        {line}
                      </p>
                    ))}
                  </div>
                  <div style={{
                    position: 'absolute', left: 0, right: 0, bottom: 0, padding: '14px 18px',
                    display: 'flex', alignItems: 'center', gap: 10,
                    background: 'linear-gradient(0deg, rgba(0,0,0,0.6), transparent)',
                  }}>
                    {artDataUrl ? (
                      <img src={artDataUrl} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Music2 size={16} color="rgba(255,255,255,0.6)" />
                      </div>
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ color: '#fff', fontSize: 12, fontWeight: 700, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</p>
                      <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 10.5, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{artist}</p>
                    </div>
                    <img src={logo} alt="" style={{ height: 13, width: 'auto', opacity: 0.9, flexShrink: 0 }} />
                  </div>
                </div>
              </div>

              <div className="shrink-0 flex gap-2 w-full" style={{ maxWidth: cardW }}>
                <button
                  onClick={handleDownload}
                  disabled={busy !== null || selectedLines.length === 0}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                >
                  {busy === 'download' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Save image
                </button>
                {canNativeShare && (
                  <button
                    onClick={handleShare}
                    disabled={busy !== null || selectedLines.length === 0}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-surface-overlay hover:bg-surface-highest disabled:opacity-50 text-text-primary text-sm font-semibold transition-colors"
                  >
                    {busy === 'share' ? <Loader2 size={15} className="animate-spin" /> : <Share2 size={15} />} Share
                  </button>
                )}
              </div>
              {error && <p className="text-red-400 text-xs -mt-2">{error}</p>}
            </div>
          </div>
        </div>
      )}
    </ModalOverlay>
  )
}
