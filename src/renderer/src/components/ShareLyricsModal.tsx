import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { toBlob, toPng } from 'html-to-image'
import { X, Download, Share2, Copy, Loader2, Music2, ImagePlus, ChevronDown, Check } from 'lucide-react'
import { ModalOverlay } from './Modal'
import { parseLrc, isLrcFormat, getCurrentLineIndex } from '../lib/lyrics'
import { fetchImageDataUrl } from '../lib/coverImage'
import { getAudioCurrentTime } from './Player'
import { useStore } from '../store/useStore'
import { FONTS, getFont } from '../lib/fonts'
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
type BgStyle = 'blur' | 'solid' | 'gradient' | 'custom'
type TextSize = 'S' | 'M' | 'L'
type TextPos = 'top' | 'center' | 'bottom'
type TextColor = 'white' | 'accent' | 'gold' | 'custom'

const FORMATS: { key: Format; label: string; w: number; h: number }[] = [
  { key: 'story', label: 'Story · 9:16', w: 270, h: 480 },
  { key: 'portrait', label: 'Portrait · 2:3', w: 280, h: 420 },
  { key: 'post', label: 'Post · 4:5', w: 300, h: 375 },
  { key: 'square', label: 'Square · 1:1', w: 340, h: 340 },
  // Capped at the same 340px max width as Square, not their "true" 400/420px
  // width - a wider card than every other format pushed the preview column
  // past the modal's edge on anything but a very wide window. The exported
  // image shrinks by the same ratio (still 4x pixelRatio on top of this), a
  // fair tradeoff for a preview that actually stays on screen.
  { key: 'landscape', label: 'Landscape · 16:9', w: 340, h: 191 },
  { key: 'widescreen', label: 'Widescreen · 21:9', w: 340, h: 146 },
]

const TEXT_SIZE_MULT: Record<TextSize, number> = { S: 0.8, M: 1, L: 1.25 }
const TEXT_COLOR_PRESETS: { key: Exclude<TextColor, 'custom'>; value: string }[] = [
  { key: 'white', value: '#fff' },
  { key: 'accent', value: 'rgb(var(--accent-rgb))' },
  { key: 'gold', value: '#f5c451' },
]
const TEXT_COLOR_VALUE: Record<TextColor, string> = {
  white: '#fff', accent: 'rgb(var(--accent-rgb))', gold: '#f5c451', custom: '#fff',
}
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

const TEXT_LINE_HEIGHT = 1.35
const TEXT_LINE_GAP = 6

/** Padding above/below the lyric text block. The bottom bar (cover +
 *  title/artist, ~64px regardless of card size) needs the same reserve on
 *  every format, but a fixed 90px reserve ate more than a third of the short
 *  landscape/widescreen cards - scale it down on those instead. With the bar
 *  hidden entirely there's nothing to reserve for, so bottom matches top. */
function textPadding(cardH: number, showInfoBar: boolean): { top: number; bottom: number } {
  const top = Math.max(16, Math.min(30, cardH * 0.12))
  return { top, bottom: showInfoBar ? Math.max(70, Math.min(90, cardH * 0.3)) : top }
}

// Rough average character width as a fraction of font size, for a bold sans
// lyric font - not exact (no canvas measurement here), just enough to guess
// how many characters fit per line before the browser itself wraps it.
const AVG_CHAR_WIDTH_RATIO = 0.58

function estimateVisualLines(text: string, fontSize: number, areaW: number): number {
  const charsPerLine = Math.max(1, Math.floor(areaW / (fontSize * AVG_CHAR_WIDTH_RATIO)))
  return Math.max(1, Math.ceil(text.length / charsPerLine))
}

function estimateBlockHeight(lines: string[], fontSize: number, areaW: number): number {
  return lines.reduce((total, line, i) => {
    const height = total + estimateVisualLines(line, fontSize, areaW) * fontSize * TEXT_LINE_HEIGHT
    return i < lines.length - 1 ? height + TEXT_LINE_GAP : height
  }, 0)
}

/** The largest font size, at or below `maxFont`, whose lines - including
 *  ones that will visually wrap inside `areaW` - fit within `areaH`. A plain
 *  per-line-count estimate undercounts wrapped lines (a long lyric line can
 *  become 2-3 visual lines on a narrow/short card), which is what let text
 *  run down into the bottom info bar instead of shrinking to make room. */
function fitFontSizeToArea(lines: string[], maxFont: number, areaW: number, areaH: number): number {
  if (lines.length === 0) return maxFont
  let size = maxFont
  while (size > 10 && estimateBlockHeight(lines, size, areaW) > areaH) size -= 0.5
  return Math.max(10, size)
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

  // Sorted line indices - a plain toggle set rather than a [start, end] range,
  // so a selection can skip lines in the middle (e.g. a verse's 1st, 2nd and
  // 4th lines) instead of only ever picking one contiguous block.
  const [selected, setSelected] = useState<number[]>(() => lines.slice(0, 3).map((_, i) => i))
  const selectedSet = useMemo(() => new Set(selected), [selected])

  const [format, setFormat] = useState<Format>('story')
  const [bgStyle, setBgStyle] = useState<BgStyle>('blur')
  const [textSize, setTextSize] = useState<TextSize>('M')
  const [textPos, setTextPos] = useState<TextPos>('center')
  const [textColor, setTextColor] = useState<TextColor>('white')
  const [customTextColor, setCustomTextColor] = useState('#ffffff')
  const resolvedTextColor = textColor === 'custom' ? customTextColor : TEXT_COLOR_VALUE[textColor]
  const [showInfoBar, setShowInfoBar] = useState(true)
  // Defaults to whatever the user already has lyrics displayed in, so the
  // card matches unless they explicitly change it here.
  const [fontId, setFontId] = useState(() => useStore.getState().lyricsFont)
  const [customFont, setCustomFont] = useState('')
  const [fontMenuOpen, setFontMenuOpen] = useState(false)
  const fontFamily = fontId === 'custom' && customFont.trim()
    ? `'${customFont.trim().replace(/'/g, "\\'")}', ${getFont(undefined).stack}`
    : getFont(fontId).stack

  // A user-picked photo, read locally via FileReader rather than uploaded
  // anywhere - it's already a data: URL, so unlike the album cover it never
  // risks a tainted export canvas.
  const [customBgUrl, setCustomBgUrl] = useState<string | null>(null)
  const bgFileInputRef = useRef<HTMLInputElement>(null)
  const handleCustomBgPick = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setCustomBgUrl(reader.result as string)
    reader.readAsDataURL(file)
  }

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
    const start = Math.max(0, flatIdx - 1)
    const end = Math.min(lines.length - 1, flatIdx + 1)
    setSelected(Array.from({ length: end - start + 1 }, (_, k) => start + k))
    // Only want this once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetched separately from the cover shown on screen: html-to-image needs a
  // same-origin (data:) URL to embed the cover into the exported PNG without
  // tainting the canvas, but that fetch can fail for reasons that have
  // nothing to do with whether the cover itself is loadable (a CORS gap on
  // some asset host, a slow/failed request) - and blocking the PREVIEW on it
  // meant a song whose cover displays fine everywhere else in the app (a
  // plain <img> needs no CORS) showed no cover here at all. The plain
  // `imageUrl` is used for display below and only swapped for this once it
  // resolves, so export quality degrades gracefully instead of the whole
  // preview going blank.
  const [artDataUrl, setArtDataUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setArtDataUrl(null)
    if (!imageUrl) return
    fetchImageDataUrl(imageUrl).then(url => { if (!cancelled) setArtDataUrl(url) }).catch(() => {})
    return () => { cancelled = true }
  }, [imageUrl])
  const previewArtSrc = artDataUrl ?? imageUrl ?? undefined
  // While actually rasterizing the card (Save/Copy/Share), the cover must
  // never be the raw cross-origin `imageUrl` - a plain <img> can paint a
  // non-CORS image fine on screen, but html-to-image reading that same pixel
  // data back out for the PNG throws instead of just skipping it. Export
  // falls back to no cover at all rather than the unsafe URL if the fetch
  // hasn't resolved (or failed) by the time the user clicks a button.
  const [exporting, setExporting] = useState(false)
  const safeArtSrc = exporting ? (artDataUrl ?? undefined) : previewArtSrc

  const cardRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState<'download' | 'copy' | 'share' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Plain toggle: click an unselected line to add it (up to MAX_LINES), click
  // a selected one to drop it - so a selection can skip lines in between
  // instead of always being one contiguous block.
  const handleLineClick = (i: number): void => {
    setSelected(prev => {
      if (prev.includes(i)) return prev.filter(x => x !== i)
      if (prev.length >= MAX_LINES) return prev
      return [...prev, i].sort((a, b) => a - b)
    })
  }

  const selectedLines = selected.map(i => lines[i])
  const { top: textPadTop, bottom: textPadBottom } = textPadding(cardH, showInfoBar)
  const textAreaH = cardH - textPadTop - textPadBottom
  const textAreaW = cardW - 52 // 26px horizontal padding each side, see the card's own padding below
  const fontSize = fitFontSizeToArea(
    selectedLines,
    baseFontSize(selectedLines.length) * TEXT_SIZE_MULT[textSize],
    textAreaW,
    textAreaH,
  )
  const fileName = `${title} - ${artist}`.replace(/[/\\?%*:|"<>]/g, '').trim() || 'lyrics'
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const canCopyImage = typeof navigator !== 'undefined' && !!navigator.clipboard?.write && typeof window.ClipboardItem === 'function'

  const renderOpts = { pixelRatio: 4, cacheBust: true, backgroundColor: '#111114' }

  // Forces the card into its export-safe state (see `safeArtSrc`) and back
  // out again around the actual rasterization. `flushSync` matters here -
  // without it the DOM wouldn't reflect `exporting` yet by the time
  // toPng/toBlob reads it, since React would otherwise defer that render to
  // the next microtask/paint.
  const withExportMode = async <T,>(capture: () => Promise<T>): Promise<T> => {
    flushSync(() => setExporting(true))
    try {
      return await capture()
    } finally {
      setExporting(false)
    }
  }

  const handleDownload = async (): Promise<void> => {
    if (!cardRef.current) return
    setError(null)
    setBusy('download')
    try {
      const dataUrl = await withExportMode(() => toPng(cardRef.current!, renderOpts))
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

  const handleCopy = async (): Promise<void> => {
    if (!cardRef.current) return
    setError(null)
    setBusy('copy')
    try {
      const blob = await withExportMode(() => toBlob(cardRef.current!, renderOpts))
      if (!blob) throw new Error('empty blob')
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    } catch {
      setError('Could not copy the image.')
    } finally {
      setBusy(null)
    }
  }

  const handleShare = async (): Promise<void> => {
    if (!cardRef.current) return
    setError(null)
    setBusy('share')
    try {
      const blob = await withExportMode(() => toBlob(cardRef.current!, renderOpts))
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
      zIndexClassName="z-[170]"
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
            {/* On mobile this whole column stack scrolls as one unit (the
                outer overflow-y-auto above), so this section can't rely on
                flex-1 to size itself - with the format/preview sections below
                it also competing for the modal's capped height, flex-1 would
                shrink this to near-0 and hide every line button. A fixed
                max-height keeps it usably tall and independently scrollable
                on mobile; md: restores the desktop side-by-side fill. */}
            <div className="md:flex-1 min-w-0 md:min-h-0 flex flex-col border-b md:border-b-0 md:border-r border-[var(--border)]">
              <p className="text-xs text-text-muted px-4 pt-3 pb-2 shrink-0">
                Tap up to {MAX_LINES} lines to share - skip any you don't want, they don't have to be next to each other.
              </p>
              <div className="max-h-56 md:max-h-none md:flex-1 md:min-h-0 overflow-y-auto px-2 pb-3">
                {lines.map((line, i) => {
                  const isSelected = selectedSet.has(i)
                  // A run of consecutive selected lines reads as one merged
                  // block (like a message group) instead of separately-rounded
                  // pills: only the outer top/bottom corners round, the seam
                  // between adjacent selected lines stays flat. A selected line
                  // next to a *skipped* one still gets its own full rounding.
                  const prevSelected = selectedSet.has(i - 1)
                  const nextSelected = selectedSet.has(i + 1)
                  const rounding = !isSelected
                    ? 'rounded-lg'
                    : prevSelected && nextSelected
                    ? 'rounded-none'
                    : prevSelected
                    ? 'rounded-b-lg rounded-t-none'
                    : nextSelected
                    ? 'rounded-t-lg rounded-b-none'
                    : 'rounded-lg'
                  return (
                    <button
                      key={i}
                      onClick={() => handleLineClick(i)}
                      className={`w-full text-left px-2.5 py-1.5 text-sm transition-colors ${rounding} ${
                        isSelected ? 'bg-accent/20 text-text-primary' : 'text-text-secondary hover:bg-surface-overlay'
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
              <div>
                <p className="text-text-muted text-[11px] mb-1.5">Background</p>
                <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[var(--surface-highest)]">
                  {([
                    { key: 'blur', label: 'Blur' }, { key: 'solid', label: 'Solid' },
                    { key: 'gradient', label: 'Gradient' }, { key: 'custom', label: 'Custom' },
                  ] as const).map(opt => {
                    const active = bgStyle === opt.key
                    return (
                      <button
                        key={opt.key}
                        onClick={() => setBgStyle(opt.key)}
                        aria-pressed={active}
                        className={`h-7 rounded-md text-[11px] font-medium transition-colors ${
                          active ? 'bg-accent text-white' : 'text-text-secondary hover:bg-surface-overlay'
                        }`}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
                {bgStyle === 'custom' && (
                  <>
                    <input ref={bgFileInputRef} type="file" accept="image/*" onChange={handleCustomBgPick} className="hidden" />
                    <button
                      onClick={() => bgFileInputRef.current?.click()}
                      className="mt-1.5 w-full h-7 rounded-md bg-[var(--surface-highest)] text-text-secondary text-[11px] font-medium flex items-center justify-center gap-1.5 hover:bg-surface-overlay transition-colors"
                    >
                      <ImagePlus size={12} /> {customBgUrl ? 'Change picture' : 'Choose picture'}
                    </button>
                  </>
                )}
              </div>
              <div>
                <p className="text-text-muted text-[11px] mb-1.5">Font</p>
                <button
                  onClick={() => setFontMenuOpen(o => !o)}
                  aria-expanded={fontMenuOpen}
                  className="w-full h-7 rounded-md bg-[var(--surface-highest)] hover:bg-surface-overlay transition-colors text-text-primary text-[11px] px-2 flex items-center justify-between gap-1"
                >
                  <span className="truncate" style={{ fontFamily }}>
                    {fontId === 'custom' ? (customFont.trim() || 'Custom…') : getFont(fontId).name}
                  </span>
                  <ChevronDown size={12} className={`shrink-0 text-text-muted transition-transform ${fontMenuOpen ? 'rotate-180' : ''}`} />
                </button>
                {fontMenuOpen && (
                  <div className="mt-1 rounded-lg bg-[var(--surface-highest)] p-1 flex flex-col gap-0.5">
                    {FONTS.map(f => (
                      <button
                        key={f.id}
                        onClick={() => { setFontId(f.id); setFontMenuOpen(false) }}
                        className={`flex items-center justify-between gap-2 px-2 h-8 rounded-md text-[13px] transition-colors ${
                          fontId === f.id ? 'bg-accent/20 text-text-primary' : 'text-text-secondary hover:bg-surface-overlay'
                        }`}
                        style={{ fontFamily: f.stack }}
                      >
                        <span className="truncate">{f.name}</span>
                        {fontId === f.id && <Check size={12} className="shrink-0" />}
                      </button>
                    ))}
                    <button
                      onClick={() => setFontId('custom')}
                      className={`flex items-center justify-between gap-2 px-2 h-8 rounded-md text-[11px] font-medium transition-colors ${
                        fontId === 'custom' ? 'bg-accent/20 text-text-primary' : 'text-text-secondary hover:bg-surface-overlay'
                      }`}
                    >
                      Custom…
                      {fontId === 'custom' && <Check size={12} className="shrink-0" />}
                    </button>
                  </div>
                )}
                {fontId === 'custom' && (
                  <input
                    type="text"
                    value={customFont}
                    onChange={(e) => setCustomFont(e.target.value)}
                    placeholder="Font family name"
                    style={{ fontFamily }}
                    className="mt-1.5 w-full h-7 rounded-md bg-[var(--surface-highest)] text-text-primary text-[11px] px-2 outline-none placeholder:text-text-muted"
                  />
                )}
              </div>
              <SegmentedControl label="Text size" value={textSize} onChange={setTextSize}
                options={[{ key: 'S', label: 'S' }, { key: 'M', label: 'M' }, { key: 'L', label: 'L' }]} />
              <SegmentedControl label="Position" value={textPos} onChange={setTextPos}
                options={[{ key: 'top', label: 'Top' }, { key: 'center', label: 'Mid' }, { key: 'bottom', label: 'Bottom' }]} />
              <div>
                <p className="text-text-muted text-[11px] mb-1.5">Color</p>
                <div className="flex items-center gap-2 px-0.5">
                  {TEXT_COLOR_PRESETS.map(({ key: c, value }) => (
                    <button
                      key={c}
                      onClick={() => setTextColor(c)}
                      aria-pressed={textColor === c}
                      title={c}
                      className={`w-6 h-6 rounded-full border-2 transition-transform ${
                        textColor === c ? 'scale-110 border-text-primary' : 'border-transparent hover:scale-105'
                      }`}
                      style={{ background: value, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)' }}
                    />
                  ))}
                  {/* Custom color - the swatch doubles as the picker's own
                      trigger, so there's no separate "choose color" button. */}
                  <label
                    title="Custom color"
                    className={`relative w-6 h-6 rounded-full border-2 transition-transform cursor-pointer overflow-hidden ${
                      textColor === 'custom' ? 'scale-110 border-text-primary' : 'border-transparent hover:scale-105'
                    }`}
                    style={{ background: customTextColor, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)' }}
                  >
                    <input
                      type="color"
                      value={customTextColor}
                      onChange={(e) => { setCustomTextColor(e.target.value); setTextColor('custom') }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </label>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-text-primary text-xs">Show song info</p>
                <button
                  onClick={() => setShowInfoBar(v => !v)}
                  aria-pressed={showInfoBar}
                  className={`flex items-center shrink-0 w-9 h-5 p-0.5 rounded-full transition-colors ${
                    showInfoBar ? 'bg-accent justify-end' : 'bg-[var(--surface-highest)] justify-start'
                  }`}
                >
                  <span className="w-4 h-4 rounded-full bg-white" />
                </button>
              </div>
            </div>

            <div className="min-w-0 min-h-0 flex flex-col items-center gap-4 p-5 overflow-auto">
              <div
                className="shrink-0 rounded-2xl overflow-hidden shadow-2xl border border-[var(--border)]"
                style={{ width: cardW, height: cardH }}
              >
                <div ref={cardRef} style={{ width: cardW, height: cardH, position: 'relative', background: '#111114' }}>
                  {bgStyle === 'blur' && safeArtSrc && (
                    <img
                      src={safeArtSrc}
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
                  {bgStyle === 'custom' && customBgUrl && (
                    <img
                      src={customBgUrl}
                      alt=""
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  )}
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.12), rgba(0,0,0,0.55))' }} />
                  <div style={{
                    position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                    justifyContent: JUSTIFY_FOR_POS[textPos],
                    padding: `${textPadTop}px 26px ${textPadBottom}px`, gap: TEXT_LINE_GAP,
                  }}>
                    {selectedLines.length === 0 ? (
                      <p style={{ color: 'rgba(255,255,255,0.55)', fontFamily, fontSize: 13, textAlign: 'center' }}>
                        Select lines to preview
                      </p>
                    ) : selectedLines.map((line, i) => (
                      <p
                        key={i}
                        style={{
                          color: resolvedTextColor, fontFamily, fontWeight: 700,
                          fontSize, lineHeight: TEXT_LINE_HEIGHT, margin: 0,
                          textShadow: '0 2px 14px rgba(0,0,0,0.55)',
                        }}
                      >
                        {line}
                      </p>
                    ))}
                  </div>
                  {showInfoBar && (
                    <div style={{
                      position: 'absolute', left: 0, right: 0, bottom: 0, padding: '14px 18px',
                      display: 'flex', alignItems: 'center', gap: 10,
                      background: 'linear-gradient(0deg, rgba(0,0,0,0.6), transparent)',
                    }}>
                      {safeArtSrc ? (
                        <img src={safeArtSrc} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Music2 size={16} color="rgba(255,255,255,0.6)" />
                        </div>
                      )}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <p style={{ color: '#fff', fontSize: 12, fontWeight: 700, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</p>
                        <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 10.5, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{artist}</p>
                      </div>
                      <img src={logo} alt="" style={{ height: 32, width: 'auto', opacity: 0.9, flexShrink: 0 }} />
                    </div>
                  )}
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
                {canCopyImage && (
                  <button
                    onClick={handleCopy}
                    disabled={busy !== null || selectedLines.length === 0}
                    title="Copy image"
                    aria-label="Copy image"
                    className="flex items-center justify-center px-3 py-2.5 rounded-xl bg-surface-overlay hover:bg-surface-highest disabled:opacity-50 text-text-primary transition-colors"
                  >
                    {busy === 'copy' ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />}
                  </button>
                )}
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
