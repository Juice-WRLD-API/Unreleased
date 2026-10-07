import { useCallback, useEffect, useState } from 'react'
import { X, Loader2, Globe, CheckCircle, Wifi, WifiOff } from 'lucide-react'
import { ModalOverlay } from './Modal'
import { fetchProposalPropagation } from '../lib/cdnAdminApi'
import type { ProposalPropagation, PropagationNode, PropagationState } from '../lib/cdnAdminApi'

const POLL_INTERVAL = 10_000

const STATE_COLORS: Record<PropagationState, string> = {
  propagated: '#22c55e',
  propagating: '#3b82f6',
  offline: '#6b7280',
}

function countryFlag(code: string): string {
  if (!code || code.length !== 2) return ''
  const cp1 = 0x1f1e6 + code.charCodeAt(0) - 65
  const cp2 = 0x1f1e6 + code.charCodeAt(1) - 65
  return String.fromCodePoint(cp1, cp2)
}

function projectX(lon: number, width: number): number {
  return ((lon + 180) / 360) * width
}

function projectY(lat: number, height: number): number {
  return ((90 - lat) / 180) * height
}

const MAP_W = 480
const MAP_H = 260

const LAND_RANGES: [number, [number, number][]][] = [
  [70, [[-170,-55],[20,175]]],
  [66, [[-170,-60],[-52,-36],[10,175]]],
  [62, [[-168,-58],[-52,-22],[5,170]]],
  [58, [[-140,-52],[-8,15],[28,168]]],
  [54, [[-136,-55],[-10,30],[36,148]]],
  [50, [[-132,-92],[-80,-52],[-8,42],[48,142]]],
  [46, [[-126,-66],[-8,48],[52,145]]],
  [42, [[-124,-70],[-10,45],[50,145]]],
  [38, [[-124,-75],[-10,42],[44,78],[82,142]]],
  [34, [[-120,-76],[-8,36],[38,80],[84,122],[128,142]]],
  [30, [[-104,-80],[-12,34],[36,80],[84,122]]],
  [26, [[-112,-82],[-16,34],[36,92],[98,118]]],
  [22, [[-108,-96],[-84,-76],[-16,50],[68,92],[96,110],[120,122]]],
  [18, [[-106,-96],[-92,-84],[-16,48],[72,86],[96,108]]],
  [14, [[-92,-84],[-18,48],[74,80],[96,108],[120,126]]],
  [10, [[-84,-76],[-16,50],[76,80],[96,116],[120,126]]],
  [6, [[-78,-56],[-12,46],[78,82],[98,128]]],
  [2, [[-80,-72],[-68,-35],[-8,42],[96,136]]],
  [-2, [[-72,-34],[10,42],[96,140]]],
  [-6, [[-76,-34],[12,40],[100,140]]],
  [-10, [[-76,-34],[14,40],[115,132]]],
  [-14, [[-76,-38],[20,42],[124,142]]],
  [-18, [[-68,-40],[22,38],[44,50],[118,148]]],
  [-22, [[-65,-40],[24,36],[114,152]]],
  [-26, [[-66,-46],[26,34],[112,154]]],
  [-30, [[-70,-48],[18,32],[114,154]]],
  [-34, [[-72,-56],[18,28],[116,152]]],
  [-38, [[-72,-62],[140,150],[170,178]]],
  [-42, [[-74,-64],[144,148],[168,178]]],
  [-46, [[-76,-68],[166,174]]],
  [-50, [[-76,-68]]],
]

const LAND_DOTS = LAND_RANGES.flatMap(([lat, ranges]) =>
  ranges.flatMap(([lo, hi]) => {
    const dots: [number, number][] = []
    for (let lon = lo; lon <= hi; lon += 5) dots.push([lon, lat])
    return dots
  })
)

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
            opacity={0.2}
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
              <circle cx={cx} cy={cy} r={5} fill={color} opacity={n.state === 'offline' ? 0.5 : 0.9} />
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
  const flag = countryFlag(node.country_code)
  const location = [node.city, node.country_code].filter(Boolean).join(', ')
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] last:border-b-0">
      <span className="text-lg shrink-0">{flag || '🌐'}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary truncate">{node.name || location || 'Unknown'}</p>
        <p className="text-xs text-text-muted truncate">{node.continent || node.region || ''}</p>
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
  const totalCount = data?.nodes.length ?? 0
  // Nothing left to wait for once every node has the change.
  const settled = totalCount > 0 && propagatedCount === totalCount

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
