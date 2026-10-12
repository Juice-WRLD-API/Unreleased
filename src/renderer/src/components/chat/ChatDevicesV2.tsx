import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, KeyRound, Laptop, Link2, Loader2, ShieldAlert, ShieldCheck, Smartphone } from 'lucide-react'
import QRCode from 'qrcode'
import * as api from '../../lib/chatApi'
import type { E2EFeatures, ListDeviceEntry } from '../../lib/chatApi'
import type { IdentityStatus } from '../../lib/chatIdentity'
import type { LinkCandidate, PendingLink } from '../../lib/chatLinking'
import { useChatStore } from '../../store/chatStore'
import { subscribeNotifications } from '../../lib/notificationSocket'

const e2e = () => import('../../lib/chatE2E')
const identity = () => import('../../lib/chatIdentity')
const linking = () => import('../../lib/chatLinking')
const backup = () => import('../../lib/chatBackup')
const toDevice = () => import('../../lib/chatToDevice')

const isMobileLabel = (label: string): boolean => /iOS|Android/.test(label)
const errText = (err: unknown): string => (err as Error)?.message || 'Something went wrong'

const btn = 'inline-flex items-center gap-1.5 rounded-lg bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent/25 disabled:opacity-60'
const ghost = 'rounded-lg px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-[var(--surface-overlay)] hover:text-text-primary'
const input = 'w-full rounded-lg border border-[var(--border)] bg-surface px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-accent'

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="border-t border-[var(--border)] pt-3 mt-3 first:border-t-0 first:mt-0 first:pt-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-2">{title}</p>
      {children}
    </div>
  )
}

// E2E v2 device management: your devices are exactly the ones your security
// key signed in. Shown once the identity phase is on for this server.
export default function ChatDevicesV2({ userId, status, features, onChanged }: {
  userId: number
  status: IdentityStatus
  features: E2EFeatures
  onChanged: () => void
}): JSX.Element {
  return (
    <div>
      {status === 'needs-link' ? (
        <>
          <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200 mb-3">
            <ShieldAlert size={14} className="shrink-0 mt-0.5 text-amber-400" />
            This device isn&apos;t verified yet. Link it from a device that already has your security key, or restore with your recovery code.
          </p>
          {features.linking && <Section title="Link this device"><LinkThisDevice userId={userId} onLinked={onChanged} /></Section>}
          {features.backup && <Section title="Restore with recovery code"><RestoreWithCode userId={userId} onDone={onChanged} /></Section>}
        </>
      ) : (
        <>
          <Section title="Your verified devices"><SignedDevices userId={userId} canRevoke={features.linking} onChanged={onChanged} /></Section>
          {features.linking && <Section title="Link a new device"><LinkNewDevice userId={userId} onLinked={onChanged} /></Section>}
          {features.backup && <Section title="Recovery code"><BackupPanel userId={userId} /></Section>}
          <Section title="Reset identity"><ResetIdentity userId={userId} onDone={onChanged} /></Section>
        </>
      )}
    </div>
  )
}

// --- signed device list ---------------------------------------------------------------------

function SignedDevices({ userId, canRevoke, onChanged }: { userId: number; canRevoke: boolean; onChanged: () => void }): JSX.Element {
  const epoch = useChatStore((s) => s.trustEpoch)
  const [listed, setListed] = useState<ListDeviceEntry[] | null>(null)
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [unlisted, setUnlisted] = useState<string[]>([])
  const [thisDevice, setThisDevice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [m, idm, rows] = await Promise.all([e2e(), identity(), api.listMyDevices()])
      idm.invalidateTrust(userId, userId)
      const trust = await idm.loadUserTrust(userId, userId)
      if (trust.state !== 'ok') throw new Error(`Your device list could not be verified (${trust.state === 'invalid' ? trust.reason : trust.state}).`)
      const ids = new Set(trust.devices.map((d) => d.deviceId))
      setListed(trust.devices.map((d) => ({ device_id: d.deviceId, enc_pub: d.encPub, sign_pub: d.signPub })))
      setLabels(Object.fromEntries(rows.map((r) => [r.device_id, r.label])))
      setUnlisted(rows.filter((r) => !ids.has(r.device_id)).map((r) => r.label || 'Unknown device'))
      setThisDevice(await m.localDeviceId(userId))
      setError(null)
    } catch (err) {
      setError(errText(err))
    }
  }, [userId])

  useEffect(() => { void load() }, [load, epoch])

  const revoke = async (deviceId: string): Promise<void> => {
    setBusy(deviceId)
    try {
      await (await linking()).revokeLinkedDevice(userId, deviceId)
      setConfirming(null)
      await load()
      onChanged()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(null)
    }
  }

  if (!listed) return error ? <p className="text-red-400 text-[11px]">{error}</p> : <Loader2 size={13} className="animate-spin text-text-muted" />
  return (
    <div>
      {listed.map((d) => {
        const label = labels[d.device_id] || 'Unknown device'
        const current = d.device_id === thisDevice
        const Icon = isMobileLabel(label) ? Smartphone : Laptop
        return (
          <div key={d.device_id} className="flex items-center justify-between gap-3 py-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-[#475569]"><Icon size={13} className="text-white" /></div>
              <p className="text-text-primary text-sm truncate">
                {label}
                {current && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-accent">This device</span>}
              </p>
            </div>
            {!current && canRevoke && (confirming === d.device_id ? (
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => setConfirming(null)} className="text-xs text-text-muted hover:text-text-primary">Cancel</button>
                <button onClick={() => void revoke(d.device_id)} disabled={busy === d.device_id} className="inline-flex items-center gap-1 rounded-lg bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-400 hover:bg-red-500/25 disabled:opacity-60">
                  {busy === d.device_id && <Loader2 size={11} className="animate-spin" />}Revoke
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirming(d.device_id)} className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-text-secondary hover:text-red-400">Revoke</button>
            ))}
          </div>
        )
      })}
      {unlisted.length > 0 && (
        <p className="text-text-muted text-[11px] pt-1">
          Not verified: {unlisted.join(', ')}. Those devices get no new keys until you link them from here.
        </p>
      )}
      <p className="text-text-muted text-[11px] pt-1">Revoking a device rotates the key of every conversation you share on its next message.</p>
      {error && <p className="text-red-400 text-[11px] pt-1">{error}</p>}
    </div>
  )
}

// --- new device side --------------------------------------------------------------------------

function formatCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}

function LinkThisDevice({ userId, onLinked }: { userId: number; onLinked: () => void }): JSX.Element {
  const [pending, setPending] = useState<(PendingLink & { img: string }) | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [ownSas, setOwnSas] = useState<string | null>(null)

  const start = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const link = await (await linking()).startLink(userId)
      setPending({ ...link, img: await QRCode.toDataURL(link.qr, { margin: 1, width: 200 }) })
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  // Show the code straight away: the session is what lets this device accept
  // keys, and the number is what the other device's approve prompt asks about.
  useEffect(() => {
    void start()
    void linking().then((m) => m.ownDeviceSas(userId)).then(setOwnSas).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // Settings can be open without the chat socket, so poll the inbox too.
  useEffect(() => {
    if (!pending) return
    let stop = (): void => undefined
    void toDevice().then((m) => { stop = m.onToDeviceEvent((ev) => { if (ev.type === 'linked') { setPending(null); onLinked() } }) })
    const drain = (): void => { void toDevice().then((m) => m.processInbox(userId)).catch(() => undefined) }
    // todevice.available is pushed on the notifications socket; the slow poll
    // only covers a missed frame.
    const unsubscribe = subscribeNotifications(
      (frame) => { if (frame.type === 'todevice' && frame.action === 'available') drain() },
      drain,
    )
    const clock = window.setInterval(() => setNow(Date.now()), 1000)
    const timer = window.setInterval(drain, 15_000)
    return () => { stop(); unsubscribe(); window.clearInterval(clock); window.clearInterval(timer) }
  }, [pending, userId, onLinked])

  if (!pending) {
    return (
      <div>
        <button onClick={() => void start()} disabled={busy} className={btn}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}Show link code
        </button>
        {error && <p className="text-red-400 text-[11px] pt-1">{error}</p>}
      </div>
    )
  }
  const left = Math.max(0, Math.round((Date.parse(pending.expiresAt) - now) / 1000))
  return (
    <div className="flex gap-4 items-start">
      <img src={pending.img} alt="Device link QR code" width={200} height={200} className="rounded bg-white p-1 shrink-0" />
      <div className="text-xs text-text-secondary space-y-2">
        {ownSas && (
          <p>
            Your other device will ask you to approve this one. Approve it only if it shows <span className="font-mono text-sm text-text-primary">{ownSas}</span>.
          </p>
        )}
        <p>Or, on a device that already has your security key, open Settings › Chat devices › Link a new device and scan this code.</p>
        <p>No camera? Type <span className="font-mono text-sm text-text-primary">{formatCode(pending.sessionId)}</span> there instead, then check that both screens show <span className="font-mono text-sm text-text-primary">{pending.sas}</span>.</p>
        <p className="text-text-muted">{left > 0 ? `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Expired.'}</p>
        {left === 0 && <button onClick={() => void start()} className={btn}>New code</button>}
      </div>
    </div>
  )
}

// --- existing device side -----------------------------------------------------------------------

interface BarcodeDetectorLike { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> }

function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }): JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let stream: MediaStream | null = null
    let timer: number | null = null
    let done = false
    const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector
    if (!Detector) {
      setError('This browser cannot scan QR codes. Type the code instead.')
      return
    }
    const detector = new Detector({ formats: ['qr_code'] })
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then((s) => {
      stream = s
      if (!video.current) return
      video.current.srcObject = s
      void video.current.play()
      timer = window.setInterval(() => {
        if (!video.current || done) return
        void detector.detect(video.current).then((codes) => {
          const hit = codes.find((c) => c.rawValue.startsWith('unrlsd-link:'))
          if (hit && !done) {
            done = true
            onResult(hit.rawValue)
          }
        }).catch(() => undefined)
      }, 300)
    }).catch(() => setError('Could not open the camera.'))
    return () => {
      done = true
      if (timer !== null) window.clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onResult])
  return (
    <div className="space-y-2">
      {error ? <p className="text-red-400 text-[11px]">{error}</p> : <video ref={video} muted playsInline className="w-full max-w-[280px] rounded-lg bg-black" />}
      <button onClick={onClose} className={ghost}>Close camera</button>
    </div>
  )
}

function LinkNewDevice({ userId, onLinked }: { userId: number; onLinked: () => void }): JSX.Element {
  const [code, setCode] = useState('')
  const [scanning, setScanning] = useState(false)
  const [candidate, setCandidate] = useState<LinkCandidate | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const canScan = typeof window !== 'undefined' && 'BarcodeDetector' in window

  const lookup = useCallback(async (value: { qr?: string; code?: string }) => {
    setBusy(true)
    setError(null)
    setDone(false)
    try {
      setCandidate(await (await linking()).lookupLink(value))
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }, [])

  const onScan = useCallback((text: string) => {
    setScanning(false)
    void lookup({ qr: text })
  }, [lookup])

  const approve = async (): Promise<void> => {
    if (!candidate) return
    setBusy(true)
    setError(null)
    try {
      await (await linking()).approveLink(userId, candidate)
      setCandidate(null)
      setCode('')
      setDone(true)
      onLinked()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  if (candidate) {
    return (
      <div className="space-y-2 text-xs text-text-secondary">
        <p>Link <b className="text-text-primary">{candidate.session.label || 'new device'}</b>?</p>
        {!candidate.viaQr && (
          <p>
            Check that the new device shows <span className="font-mono text-sm text-text-primary">{candidate.sas}</span>. If it doesn&apos;t, cancel: someone may be trying to add their own device.
          </p>
        )}
        <p className="text-text-muted">It will get your security key and every conversation key this device holds.</p>
        <div className="flex gap-2">
          <button onClick={() => setCandidate(null)} className={ghost}>Cancel</button>
          <button onClick={() => void approve()} disabled={busy} className={btn}>
            {busy && <Loader2 size={12} className="animate-spin" />}{candidate.viaQr ? 'Link device' : 'The numbers match, link it'}
          </button>
        </div>
        {error && <p className="text-red-400 text-[11px]">{error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {scanning ? <QrScanner onResult={onScan} onClose={() => setScanning(false)} /> : (
        <div className="flex gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code from the new device, e.g. 7K3M-Q9TD" className={input} />
          <button onClick={() => void lookup(code.startsWith('unrlsd-link:') ? { qr: code } : { code })} disabled={busy || !code.trim()} className={btn}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : 'Next'}
          </button>
          {canScan && <button onClick={() => setScanning(true)} className={btn} title="Scan QR code"><Camera size={12} /></button>}
        </div>
      )}
      {done && <p className="text-accent text-[11px] inline-flex items-center gap-1"><ShieldCheck size={12} />Linked. The new device is receiving its keys.</p>}
      {error && <p className="text-red-400 text-[11px]">{error}</p>}
    </div>
  )
}

// --- backup ---------------------------------------------------------------------------------------

function BackupPanel({ userId }: { userId: number }): JSX.Element {
  const [exists, setExists] = useState<boolean | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [confirmGroup, setConfirmGroup] = useState('')
  const [oldCode, setOldCode] = useState('')
  const [changing, setChanging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void backup().then((m) => m.backupExists(userId)).then(setExists).catch(() => setExists(false))
  }, [userId])

  const run = async (fn: () => Promise<string>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setCode(await fn())
      setConfirmGroup('')
      setChanging(false)
      setOldCode('')
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  if (code) {
    const last = code.split('-').pop() ?? ''
    const confirmed = confirmGroup.trim().toUpperCase() === last
    return (
      <div className="space-y-2 text-xs text-text-secondary">
        <p>Write this recovery code down and keep it somewhere safe. It is shown only once, and it is the only way to read your messages if you lose every device.</p>
        <p className="font-mono text-sm leading-6 tracking-wide text-text-primary select-all break-words">{code}</p>
        <p>Type the last group to confirm you saved it:</p>
        <div className="flex gap-2">
          <input value={confirmGroup} onChange={(e) => setConfirmGroup(e.target.value)} maxLength={4} className={`${input} max-w-[90px] font-mono uppercase`} />
          <button onClick={() => { setCode(null); setExists(true) }} disabled={!confirmed} className={btn}>Done</button>
        </div>
      </div>
    )
  }
  if (exists === null) return <Loader2 size={13} className="animate-spin text-text-muted" />
  return (
    <div className="space-y-2 text-xs text-text-secondary">
      {!exists ? (
        <>
          <p>A recovery code lets a new device read your history even if all your other devices are gone.</p>
          <button onClick={() => void run(async () => (await backup()).setupBackup(userId))} disabled={busy} className={btn}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}Set up recovery code
          </button>
        </>
      ) : changing ? (
        <>
          <p>Enter your current recovery code. Every backed-up key is re-sealed to the new one.</p>
          <input value={oldCode} onChange={(e) => setOldCode(e.target.value)} placeholder="XXXX-XXXX-…" className={`${input} font-mono`} />
          <div className="flex gap-2">
            <button onClick={() => setChanging(false)} className={ghost}>Cancel</button>
            <button onClick={() => void run(async () => (await backup()).changeRecoveryCode(userId, oldCode))} disabled={busy || !oldCode.trim()} className={btn}>
              {busy && <Loader2 size={12} className="animate-spin" />}Make a new code
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="inline-flex items-center gap-1"><ShieldCheck size={12} className="text-accent" />Your keys are backed up. New keys are added automatically.</p>
          <div><button onClick={() => setChanging(true)} className={ghost}>Change recovery code</button></div>
        </>
      )}
      {error && <p className="text-red-400 text-[11px]">{error}</p>}
    </div>
  )
}

function RestoreWithCode({ userId, onDone }: { userId: number; onDone: () => void }): JSX.Element {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<[number, number] | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const restore = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const n = await (await backup()).restoreFromCode(userId, code, (done, total) => setProgress([done, total]))
      setResult(`Restored ${n} conversation key${n === 1 ? '' : 's'}. This device is now verified.`)
      setCode('')
      onDone()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <div className="space-y-2 text-xs">
      <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-…" className={`${input} font-mono`} />
      <button onClick={() => void restore()} disabled={busy || !code.trim()} className={btn}>
        {busy && <Loader2 size={12} className="animate-spin" />}
        {progress ? `Restoring ${progress[0]}/${progress[1]}` : 'Restore'}
      </button>
      {result && <p className="text-accent text-[11px]">{result}</p>}
      {error && <p className="text-red-400 text-[11px]">{error}</p>}
    </div>
  )
}

// --- identity reset ------------------------------------------------------------------------------------

function ResetIdentity({ userId, onDone }: { userId: number; onDone: () => void }): JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const [m, idm] = await Promise.all([e2e(), identity()])
      const device = await m.ensureDevice(userId)
      await idm.resetOwnIdentity(userId, m.ownKeys(device))
      setConfirming(false)
      onDone()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 text-xs text-text-secondary">
      <p>Only if every device and your recovery code are gone. Old history becomes unreadable, other devices are signed out of chat encryption, and everyone you talk to sees that your security key changed.</p>
      {confirming ? (
        <div className="flex gap-2">
          <button onClick={() => setConfirming(false)} className={ghost}>Cancel</button>
          <button onClick={() => void reset()} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-400 hover:bg-red-500/25 disabled:opacity-60">
            {busy && <Loader2 size={11} className="animate-spin" />}Reset my identity
          </button>
        </div>
      ) : (
        <button onClick={() => setConfirming(true)} className="rounded-lg px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-500/10">Reset identity…</button>
      )}
      {error && <p className="text-red-400 text-[11px]">{error}</p>}
    </div>
  )
}
