import { useCallback, useEffect, useState } from 'react'
import { Laptop, Loader2, Smartphone } from 'lucide-react'
import * as api from '../../lib/chatApi'
import type { ChatDevice } from '../../lib/chatApi'

const e2e = () => import('../../lib/chatE2E')

const isMobileLabel = (label: string): boolean => /iOS|Android/.test(label)

// Every browser/app that has opened staff chat registers its own encryption
// device, and keys keep getting sealed for each one. Old ones pile up (cleared
// storage, other browsers), so this lets you drop the ones you no longer use.
export default function ChatDevices({ userId }: { userId: number }): JSX.Element {
  const [devices, setDevices] = useState<ChatDevice[] | null>(null)
  const [keyedId, setKeyedId] = useState<number | null>(null)
  const [thisDevice, setThisDevice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<number | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [list, m] = await Promise.all([api.listMyDevices(), e2e()])
      setDevices(list.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')))
      setKeyedId(m.primaryDevices(list)[0]?.id ?? null)
      setThisDevice(await m.localDeviceId(userId))
      setError(null)
    } catch (err) {
      setError((err as Error).message || 'Could not load devices')
    }
  }, [userId])

  useEffect(() => { void load() }, [load])

  const revoke = async (device: ChatDevice): Promise<void> => {
    setBusy(device.id)
    try {
      await api.revokeDevice(device.device_id)
      setConfirming(null)
      await load()
    } catch (err) {
      setError((err as Error).message || 'Could not revoke device')
    } finally {
      setBusy(null)
    }
  }

  if (!devices) {
    return error
      ? <p className="text-red-400 text-[11px] py-2">{error}</p>
      : <div className="flex items-center gap-2 py-3 text-text-muted text-xs"><Loader2 size={13} className="animate-spin" />Loading devices…</div>
  }

  return (
    <div>
      {devices.length === 0 && <p className="text-text-muted text-xs py-3">No devices registered yet.</p>}
      {devices.map((d) => {
        const current = d.device_id === thisDevice
        const Icon = isMobileLabel(d.label) ? Smartphone : Laptop
        return (
          <div key={d.id} className="flex items-center justify-between gap-3 py-3 border-b border-[var(--border)] last:border-b-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-[#475569]">
                <Icon size={13} className="text-white" strokeWidth={2.25} />
              </div>
              <div className="min-w-0">
                <p className="text-text-primary text-sm truncate">
                  {d.label || 'Unknown device'}
                  {current && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-accent">This device</span>}
                </p>
                <p className="text-text-muted text-[11px] truncate">
                  {d.id === keyedId ? 'Receives new keys · ' : ''}
                  {d.created_at ? `Added ${new Date(d.created_at).toLocaleString()}` : `Device #${d.id}`}
                </p>
              </div>
            </div>
            {!current && (
              confirming === d.id ? (
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => setConfirming(null)} className="text-xs text-text-muted hover:text-text-primary">Cancel</button>
                  <button
                    onClick={() => void revoke(d)}
                    disabled={busy === d.id}
                    className="inline-flex items-center gap-1 rounded-lg bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-400 hover:bg-red-500/25 disabled:opacity-60"
                  >
                    {busy === d.id && <Loader2 size={11} className="animate-spin" />}Revoke
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirming(d.id)}
                  className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-[var(--surface-overlay)] hover:text-red-400"
                >
                  Revoke
                </button>
              )
            )}
          </div>
        )
      })}
      <p className="text-text-muted text-[11px] pt-2">
        New conversation keys go to your oldest device only. Any other browser needs them exported from that device and imported,
        below. Revoking the keyed device moves that role to the next oldest.
      </p>
      {error && <p className="text-red-400 text-[11px] pt-1">{error}</p>}
    </div>
  )
}
