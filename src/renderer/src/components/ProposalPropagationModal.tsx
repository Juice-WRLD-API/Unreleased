import { useCallback, useEffect, useState } from 'react'
import { X, Loader2, Globe, CheckCircle, Wifi, WifiOff, MinusCircle } from 'lucide-react'
import { ModalOverlay } from './Modal'
import { FlagIcon } from './cdnNodesShared'
import { fetchProposalPropagation } from '../lib/cdnAdminApi'
import type { ProposalPropagation, PropagationNode, PropagationSkipReason, PropagationState } from '../lib/cdnAdminApi'
import { DOT_COLS, DOT_LAT_TOP, DOT_ROWS, DOT_STEP } from '../lib/worldDots'

const POLL_INTERVAL = 10_000

const STATE_COLORS: Record<PropagationState, string> = {
  propagated: '#22c55e',
  propagating: '#3b82f6',
  offline: '#6b7280',
  skipped: '#f59e0b',
}

const SKIP_REASON_LABELS: Record<Exclude<PropagationSkipReason, ''>, string> = {
  channel: 'Channel not selected on this node',
  folder: 'Folder not selected on this node',
  storage: 'Node storage is full',
}

function projectX(lon: number, width: number): number {
  return ((lon + 180) / 360) * width
}

function projectY(lat: number, height: number): number {
  return ((90 - lat) / 180) * height
}

const MAP_W = 480
const MAP_H = 260

const LAND_DOTS: [number, number][] = (() => {
  const step = 360 / DOT_COLS
  const dots: [number, number][] = []
  DOT_ROWS.forEach((row, r) => {
    const lat = DOT_LAT_TOP - (r + 0.5) * DOT_STEP
    for (let i = 0; i < row.length; i++) {
      const nib = parseInt(row[i], 16)
      for (let j = 0; j < 4; j++) {
        if (nib & (8 >> j)) dots.push([-180 + (i * 4 + j + 0.5) * step, lat])
      }
    }
  })
  return dots
})()

function DottedWorldMap({ nodes }: { nodes: PropagationNode[] }): JSX.Element {
  return (
    <div className="relative w-full overflow-hidden rounded-xl bg-surface-overlay border border-[var(--border)]">
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="w-full h-auto">
        {LAND_DOTS.map(([lon, lat], i) => (
          <circle
            key={i}
            cx={projectX(lon, MAP_W)}
            cy={projectY(lat, MAP_H)}
            r={1}
            fill="var(--text-muted)"
            opacity={0.5}
          />
        ))}
        {nodes.map((n) => {
          if (n.latitude == null || n.longitude == null) return null
          const cx = projectX(n.longitude, MAP_W)
          const cy = projectY(n.latitude, MAP_H)
          const color = STATE_COLORS[n.state]
          return (
            <g key={n.node_id}>
              <circle cx={cx} cy={cy} r={8} fill={color} opacity={0.15} />
              <circle cx={cx} cy={cy} r={5} fill={color} opacity={n.state === 'offline' || n.state === 'skipped' ? 0.5 : 0.9} />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function StateBadge({ state, online }: { state: PropagationState; online: boolean }): JSX.Element {
  if (!online) {
    return (
      <span className="flex items-center gap-1 text-xs font-semibold text-text-muted">
        <WifiOff size={12} /> OFFLINE
      </span>
    )
  }
  if (state === 'skipped') {
    return (
      <span className="flex items-center gap-1 text-xs font-semibold text-amber-400">
        <MinusCircle size={12} /> NOT SYNCED
      </span>
    )
  }
  if (state === 'propagated') {
    return (
      <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400">
        <CheckCircle size={12} /> ONLINE
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-xs font-semibold text-blue-400">
      <Loader2 size={12} className="animate-spin" /> SYNCING
    </span>
  )
}

function NodeRow({ node }: { node: PropagationNode }): JSX.Element {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] last:border-b-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary truncate flex items-center gap-1.5">
          <FlagIcon code={node.country_code} size={16} />
          {node.name || node.city || 'Unknown'}
        </p>
        <p className="text-xs text-text-muted truncate">
          {node.state === 'skipped' && node.skip_reason
            ? SKIP_REASON_LABELS[node.skip_reason]
            : node.continent || node.region || ''}
        </p>
      </div>
      <StateBadge state={node.state} online={node.online} />
    </div>
  )
}

export default function ProposalPropagationModal({ proposalId, onClose }: {
  proposalId: number
  onClose: () => void
}): JSX.Element {
  const [data, setData] = useState<ProposalPropagation | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const result = await fetchProposalPropagation(proposalId)
      setData(result)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load propagation data')
    } finally {
      setLoading(false)
    }
  }, [proposalId])

  const propagatedCount = data?.nodes.filter(n => n.state === 'propagated').length ?? 0
  const totalCount = data?.nodes.filter(n => n.state !== 'skipped').length ?? 0
  const pendingCount = data?.nodes.filter(n => n.state === 'propagating').length ?? 0
  const settled = !!data && pendingCount === 0

  useEffect(() => {
    load()
    if (settled) return
    // No server push exists for propagation progress, so this stays a poll -
    // but not while the tab is hidden or once every node is done.
    const interval = setInterval(() => { if (!document.hidden) void load() }, POLL_INTERVAL)
    const onVisible = (): void => { if (!document.hidden) void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible) }
  }, [load, settled])

  return (
    <ModalOverlay
      onClose={onClose}
      standalone
      zIndexClassName="z-[200]"
      panelClassName="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl max-h-[90vh] flex flex-col"
    >
      {() => (
        <>
          <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
            <h2 className="text-base font-bold text-text-primary">Propagation Details</h2>
            <button onClick={onClose} className="p-1 rounded text-text-muted hover:text-text-primary transition-colors">
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading && !data ? (
              <div className="flex justify-center py-12">
                <Loader2 size={24} className="animate-spin text-text-muted" />
              </div>
            ) : error && !data ? (
              <div className="px-5 py-8 text-center text-sm text-red-400">{error}</div>
            ) : data ? (
              <>
                <div className="px-5 pt-4 pb-3">
                  <div className="flex items-center gap-3 mb-3">
                    <Globe size={18} className="text-accent shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-text-primary">{data.server.host}</p>
                      <p className="text-xs text-text-muted">Origin Server</p>
                    </div>
                    <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400">
                      <Wifi size={12} /> Online
                    </span>
                  </div>

                  <DottedWorldMap nodes={data.nodes} />

                  <div className="flex items-center gap-4 mt-3 text-[11px] text-text-muted">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                      Propagated
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
                      Propagating
                    </span>
                    {data.nodes.some(n => n.state === 'offline') && (
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-gray-500 inline-block" />
                        Offline
                      </span>
                    )}
                    {data.nodes.some(n => n.state === 'skipped') && (
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                        Not synced
                      </span>
                    )}
                    <span className="ml-auto">{propagatedCount}/{totalCount} nodes</span>
                  </div>

                  <p className="mt-3 text-[11px] text-text-muted leading-relaxed">
                    Nodes sync files from the origin server. If a node is still propagating, it will catch up on its next sync cycle.
                  </p>
                </div>

                <div className="mt-1">
                  {data.nodes.map(n => (
                    <NodeRow key={n.node_id} node={n} />
                  ))}
                  {data.nodes.length === 0 && (
                    <p className="px-5 py-6 text-center text-sm text-text-muted">No active nodes</p>
                  )}
                </div>
              </>
            ) : null}
          </div>

          <div className="shrink-0 p-4 border-t border-[var(--border)]">
            <button onClick={onClose}
              className="w-full h-11 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-accent/90 transition-colors">
              Close
            </button>
          </div>
        </>
      )}
    </ModalOverlay>
  )
}
