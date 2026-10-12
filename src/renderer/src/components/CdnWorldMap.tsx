// World map of CDN nodes: a dotted landmass (lib/worldDots, generated from
// Natural Earth) with a marker per located node, coloured by the same bucket
// as the roster chips. Nearby nodes merge into a counted cluster that splits
// as you zoom. Shared by the desktop and mobile admin tabs.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, Minus, Plus, X } from 'lucide-react'
import type { CdnOwnedNode } from '../lib/cdnAccountApi'
import { DOT_COLS, DOT_LAT_BOTTOM, DOT_LAT_TOP, DOT_ROWS, DOT_STEP } from '../lib/worldDots'
import { cdnNodeBucket, CDN_BUCKET_STYLE, type CdnNodeFilter } from '../hooks/useCdnNodesAdmin'
import { countryFlag, nodeLocation } from './cdnNodesShared'

type Bucket = Exclude<CdnNodeFilter, 'all'>

const W = 720
const H = ((DOT_LAT_TOP - DOT_LAT_BOTTOM) * W) / 360
const MAX_K = 40
const CLUSTER_PX = 22

// Marker fills are literal colours (SVG), matching CDN_BUCKET_STYLE's tailwind tones.
const BUCKET_FILL: Record<Bucket, string> = {
  online: '#34d399',
  pending: '#fbbf24',
  offline: '#71717a',
  disabled: '#f87171',
}
// Which colour a cluster takes when its members disagree.
const BUCKET_RANK: Bucket[] = ['online', 'pending', 'offline', 'disabled']

// One round-capped zero-length segment per land cell = a dot, in a single path.
const LAND_PATH = (() => {
  let d = ''
  const cell = W / DOT_COLS
  DOT_ROWS.forEach((row, r) => {
    const y = (r + 0.5) * DOT_STEP * (W / 360)
    for (let i = 0; i < row.length; i++) {
      const nib = parseInt(row[i], 16)
      for (let j = 0; j < 4; j++) {
        if (nib & (8 >> j)) d += `M${((i * 4 + j + 0.5) * cell).toFixed(1)} ${y.toFixed(1)}h0`
      }
    }
  })
  return d
})()

function project(lat: number, lon: number): [number, number] {
  const la = Math.max(DOT_LAT_BOTTOM, Math.min(DOT_LAT_TOP, lat))
  return [((lon + 180) / 360) * W, ((DOT_LAT_TOP - la) / (DOT_LAT_TOP - DOT_LAT_BOTTOM)) * H]
}

interface View { k: number; x: number; y: number }
const HOME: View = { k: 1, x: 0, y: 0 }

function clampView(v: View): View {
  const k = Math.max(1, Math.min(MAX_K, v.k))
  return { k, x: Math.max(0, Math.min(W - W / k, v.x)), y: Math.max(0, Math.min(H - H / k, v.y)) }
}

interface Placed { node: CdnOwnedNode; bucket: Bucket; x: number; y: number }
interface Cluster { key: string; x: number; y: number; items: Placed[]; bucket: Bucket; dimmed: boolean; selected: boolean }

const reducedMotion = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export default function CdnWorldMap({ nodes, dimmedIds, selectedId, onSelect, wheelZoom = false }: {
  nodes: CdnOwnedNode[]
  /** Nodes outside the current roster filter/search - drawn faded. */
  dimmedIds?: ReadonlySet<string>
  selectedId: string | null
  onSelect: (id: string) => void
  /** Zoom on plain wheel. Off for touch layouts, where it would trap page scroll. */
  wheelZoom?: boolean
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [cw, setCw] = useState(0)
  const [view, setView] = useState<View>(HOME)
  const [hover, setHover] = useState<string | null>(null)
  const [listFor, setListFor] = useState<Cluster | null>(null)
  const drag = useRef<{ px: number; py: number; v: View; active: boolean; id: number } | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    setCw(el.clientWidth)
    const ro = new ResizeObserver(() => setCw(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const placed = useMemo<Placed[]>(() => {
    const out: Placed[] = []
    for (const node of nodes) {
      const { latitude: lat, longitude: lon } = node
      if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
      const [x, y] = project(lat, lon)
      out.push({ node, bucket: cdnNodeBucket(node), x, y })
    }
    return out
  }, [nodes])

  const vw = W / view.k
  const vh = H / view.k
  const ch = (cw * H) / W
  // Map units per CSS pixel at the current zoom - keeps markers a constant on-screen size.
  const u = cw > 0 ? vw / cw : vw / 700

  const clusters = useMemo<Cluster[]>(() => {
    const cell = CLUSTER_PX * u
    const groups = new Map<string, Placed[]>()
    for (const p of placed) {
      const key = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`
      const g = groups.get(key)
      if (g) g.push(p); else groups.set(key, [p])
    }
    const list: Cluster[] = []
    for (const [key, items] of groups) {
      const x = items.reduce((s, p) => s + p.x, 0) / items.length
      const y = items.reduce((s, p) => s + p.y, 0) / items.length
      const bucket = BUCKET_RANK.find((b) => items.some((p) => p.bucket === b)) ?? 'offline'
      list.push({
        key: items.length === 1 ? items[0].node.node_id : `c${key}`,
        x, y, items, bucket,
        dimmed: !!dimmedIds && items.every((p) => dimmedIds.has(p.node.node_id)),
        selected: items.some((p) => p.node.node_id === selectedId),
      })
    }
    // Faded first, selected last, so the live ones sit on top.
    return list.sort((a, b) => Number(a.selected) - Number(b.selected) || Number(b.dimmed) - Number(a.dimmed))
  }, [placed, u, dimmedIds, selectedId])

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { online: 0, pending: 0, offline: 0, disabled: 0 }
    for (const p of placed) c[p.bucket]++
    return c
  }, [placed])

  const zoomAt = useCallback((factor: number, fx = 0.5, fy = 0.5) => {
    setView((v) => {
      const k = Math.max(1, Math.min(MAX_K, v.k * factor))
      const mx = v.x + fx * (W / v.k)
      const my = v.y + fy * (H / v.k)
      return clampView({ k, x: mx - fx * (W / k), y: my - fy * (H / k) })
    })
  }, [])

  // Non-passive so a wheel over the map zooms it instead of scrolling the pane.
  useEffect(() => {
    const el = box.current
    if (!el || !wheelZoom) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(Math.exp(-e.deltaY * 0.0015), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [wheelZoom, zoomAt])

  // Selecting from the roster while zoomed in: bring the node into view.
  useEffect(() => {
    if (!selectedId) return
    const p = placed.find((q) => q.node.node_id === selectedId)
    const v = viewRef.current
    if (!p || v.k === 1) return
    const mx = vw * 0.1, my = vh * 0.1
    if (p.x > v.x + mx && p.x < v.x + vw - mx && p.y > v.y + my && p.y < v.y + vh - my) return
    setView(clampView({ k: v.k, x: p.x - vw / 2, y: p.y - vh / 2 }))
    // Only when the selection changes - not on every pan/zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0 || viewRef.current.k === 1) return
    drag.current = { px: e.clientX, py: e.clientY, v: viewRef.current, active: false, id: e.pointerId }
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d || !cw) return
    const dx = e.clientX - d.px, dy = e.clientY - d.py
    if (!d.active) {
      if (Math.hypot(dx, dy) < 4) return
      d.active = true
      // Captured only once it's a real drag, so plain clicks still reach markers.
      e.currentTarget.setPointerCapture(d.id)
      setHover(null)
    }
    const s = W / d.v.k / cw
    setView(clampView({ k: d.v.k, x: d.v.x - dx * s, y: d.v.y - dy * s }))
  }
  const endDrag = (): void => { drag.current = null }

  const activate = (c: Cluster): void => {
    setListFor(null)
    if (c.items.length === 1) { onSelect(c.items[0].node.node_id); return }
    const xs = c.items.map((p) => p.x), ys = c.items.map((p) => p.y)
    const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys)
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2
    // Zooming in will never separate nodes sharing a spot - list them instead.
    if (bw < 0.05 && bh < 0.05) { setListFor(c); return }
    const fit = Math.min(W / Math.max(bw * 3, 1), H / Math.max(bh * 3, 1))
    const k = Math.max(view.k * 1.8, Math.min(MAX_K, fit))
    setView(clampView({ k, x: cx - W / k / 2, y: cy - H / k / 2 }))
  }

  const hovered = hover ? clusters.find((c) => c.key === hover) : null
  const unlocated = nodes.length - placed.length
  const still = reducedMotion()

  return (
    <div className="rounded-xl border border-[var(--border)] bg-surface-overlay overflow-hidden">
      <div
        ref={box}
        className="relative select-none"
        style={{ touchAction: view.k > 1 ? 'none' : 'pan-y', cursor: view.k > 1 ? (drag.current?.active ? 'grabbing' : 'grab') : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          zoomAt(2, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
        }}
      >
        <svg viewBox={`${view.x} ${view.y} ${vw} ${vh}`} className="block w-full h-auto" role="group" aria-label="Map of CDN node locations">
          <path d={LAND_PATH} stroke="var(--text-muted)" strokeOpacity={0.4} strokeWidth={2.3} strokeLinecap="round" fill="none" />
          {clusters.map((c) => {
            const fill = BUCKET_FILL[c.bucket]
            const multi = c.items.length > 1
            const label = multi ? `${c.items.length} nodes near ${nodeLocation(c.items[0].node)}` : `${c.items[0].node.name}, ${c.bucket}`
            return (
              <g
                key={c.key}
                transform={`translate(${c.x} ${c.y})`}
                opacity={c.dimmed ? 0.22 : 1}
                style={{ cursor: 'pointer' }}
                role="button"
                tabIndex={0}
                aria-label={label}
                onClick={() => activate(c)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(c) } }}
                onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHover(c.key) }}
                onPointerLeave={() => setHover((h) => (h === c.key ? null : h))}
                onFocus={() => setHover(c.key)}
                onBlur={() => setHover((h) => (h === c.key ? null : h))}
              >
                {/* Generous invisible hit area for fingers. */}
                <circle r={14 * u} fill="transparent" />
                {!multi && c.bucket === 'online' && !c.dimmed && !still && (
                  <circle r={5 * u} fill={fill} opacity={0.5}>
                    <animate attributeName="r" values={`${5 * u};${15 * u}`} dur="2.6s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.5;0" dur="2.6s" repeatCount="indefinite" />
                  </circle>
                )}
                <circle r={(multi ? 13 : 9) * u} fill={fill} opacity={0.2} />
                <circle r={(multi ? 9.5 : 4.5) * u} fill={fill} stroke="var(--surface)" strokeWidth={1.2 * u} />
                {multi && (
                  <text textAnchor="middle" dy="0.35em" fontSize={10.5 * u} fontWeight={700} fill="#0b0b0b" style={{ pointerEvents: 'none' }}>
                    {c.items.length}
                  </text>
                )}
                {c.selected && <circle r={(multi ? 15 : 10.5) * u} fill="none" stroke="var(--text-primary)" strokeWidth={1.6 * u} />}
                {c.selected && !multi && (
                  <text y={-15 * u} textAnchor="middle" fontSize={11 * u} fontWeight={700} fill="var(--text-primary)"
                    stroke="var(--surface)" strokeWidth={3 * u} paintOrder="stroke" style={{ pointerEvents: 'none' }}>
                    {c.items[0].node.name}
                  </text>
                )}
              </g>
            )
          })}
        </svg>

        {hovered && cw > 0 && !hovered.selected && (
          <div
            className="absolute z-10 pointer-events-none px-2.5 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] shadow-lg text-[11px] leading-snug whitespace-nowrap"
            style={{
              left: Math.max(70, Math.min(cw - 70, ((hovered.x - view.x) / vw) * cw)),
              top: ((hovered.y - view.y) / vh) * ch,
              transform: 'translate(-50%, calc(-100% - 14px))',
            }}
          >
            {hovered.items.length === 1 ? (
              <>
                <p className="font-semibold text-text-primary">{hovered.items[0].node.name}</p>
                <p className="text-text-muted">
                  {countryFlag(hovered.items[0].node.country_code ?? '')} {nodeLocation(hovered.items[0].node)} · <span className={CDN_BUCKET_STYLE[hovered.bucket].text}>{hovered.bucket}</span>
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold text-text-primary">{hovered.items.length} nodes</p>
                {hovered.items.slice(0, 4).map((p) => <p key={p.node.node_id} className="text-text-muted">{p.node.name}</p>)}
                {hovered.items.length > 4 && <p className="text-text-muted">+{hovered.items.length - 4} more</p>}
              </>
            )}
          </div>
        )}

        {listFor && (
          <div className="absolute z-20 top-2 left-2 w-52 max-w-[70%] rounded-xl bg-[var(--surface)] border border-[var(--border)] shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border)]">
              <p className="text-[11px] font-semibold text-text-primary truncate">{nodeLocation(listFor.items[0].node)}</p>
              <button onClick={() => setListFor(null)} aria-label="Close" className="text-text-muted hover:text-text-primary"><X size={12} /></button>
            </div>
            <div className="max-h-40 overflow-y-auto">
              {listFor.items.map((p) => (
                <button key={p.node.node_id} onClick={() => { onSelect(p.node.node_id); setListFor(null) }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-text-primary hover:bg-surface-overlay active:bg-surface-overlay">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: BUCKET_FILL[p.bucket] }} />
                  <span className="truncate">{p.node.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="absolute top-2 right-2 flex flex-col rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur-sm">
          <button onClick={() => zoomAt(1.8)} disabled={view.k >= MAX_K} aria-label="Zoom in" title="Zoom in"
            className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-overlay disabled:opacity-30">
            <Plus size={13} />
          </button>
          <button onClick={() => zoomAt(1 / 1.8)} disabled={view.k <= 1} aria-label="Zoom out" title="Zoom out"
            className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-overlay disabled:opacity-30 border-t border-[var(--border)]">
            <Minus size={13} />
          </button>
          <button onClick={() => { setView(HOME); setListFor(null) }} disabled={view.k === 1} aria-label="Reset view" title="Reset view"
            className="w-7 h-7 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-overlay disabled:opacity-30 border-t border-[var(--border)]">
            <Maximize2 size={11} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 border-t border-[var(--border)] text-[11px] text-text-muted">
        {BUCKET_RANK.filter((b) => counts[b] > 0).map((b) => (
          <span key={b} className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: BUCKET_FILL[b] }} />
            {counts[b]} {CDN_BUCKET_STYLE[b].label}
          </span>
        ))}
        {placed.length === 0 && <span>No nodes have reported a location yet</span>}
        {unlocated > 0 && placed.length > 0 && (
          <span className="ml-auto" title="These nodes haven't reported coordinates, so they can't be placed on the map.">{unlocated} not on map</span>
        )}
      </div>
    </div>
  )
}
