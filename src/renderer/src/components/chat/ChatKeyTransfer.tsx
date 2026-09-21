import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Download, Loader2, QrCode, Upload } from 'lucide-react'
import { exportKeys, importKeys } from '../../lib/chatKeyTransfer'
import { useChatStore } from '../../store/chatStore'

// Chrome/Edge/Android ship a barcode reader; elsewhere (Safari, Firefox) the
// QR is still scannable with the phone's own camera app, which hands back the
// text to paste, so scanning here is an extra rather than the only route.
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> }
const barcodeDetector = (): BarcodeDetectorCtor | null =>
  (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector ?? null

function QrPanel({ text }: { text: string }): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const QR = (await import('qrcode')).default
        if (cancelled || !canvas.current) return
        await QR.toCanvas(canvas.current, text, { width: 260, margin: 1, errorCorrectionLevel: 'L' })
        setError(null)
      } catch {
        if (!cancelled) setError('Too many keys to fit in one QR code — use the text or file instead.')
      }
    })()
    return () => { cancelled = true }
  }, [text])

  return (
    <div className="flex flex-col items-center gap-2 py-3">
      <div className="rounded-xl bg-white p-2"><canvas ref={canvas} /></div>
      {error
        ? <p className="text-amber-400 text-[11px] text-center">{error}</p>
        : <p className="text-text-muted text-[11px] text-center">Scan this on the other device, then type the same passphrase there.</p>}
    </div>
  )
}

const field = 'w-full px-3 py-2 rounded-xl bg-[var(--surface-raised)] border border-[var(--border)] text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-accent/50'
const primaryBtn = 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent/15 px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/25 disabled:opacity-50'
const plainBtn = 'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-[var(--surface-overlay)] hover:text-text-primary'

function ExportPanel({ userId }: { userId: number }): JSX.Element {
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ blob: string; count: number } | null>(null)
  const [showQr, setShowQr] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setResult(await exportKeys(userId, passphrase))
    } catch (err) {
      setError((err as Error).message || 'Could not export keys')
    } finally {
      setBusy(false)
    }
  }

  const download = (): void => {
    if (!result) return
    const url = URL.createObjectURL(new Blob([result.blob], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'unreleased-chat-keys.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-2 pt-2">
      <p className="text-text-muted text-[11px]">
        Wraps every key this device holds with a passphrase. You need the same passphrase to import it.
      </p>
      <input
        type="password"
        value={passphrase}
        onChange={(e) => { setPassphrase(e.target.value); setResult(null) }}
        placeholder="Passphrase"
        autoComplete="new-password"
        className={field}
      />
      <button onClick={() => void run()} disabled={busy || !passphrase} className={primaryBtn}>
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}Export keys
      </button>
      {error && <p className="text-red-400 text-[11px]">{error}</p>}
      {result && (
        <>
          <p className="text-text-muted text-[11px]">{result.count} key{result.count === 1 ? '' : 's'} exported.</p>
          <textarea
            readOnly
            value={result.blob}
            rows={3}
            onFocus={(e) => e.currentTarget.select()}
            className={`${field} font-mono text-[10px] resize-none`}
          />
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => { void navigator.clipboard.writeText(result.blob); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
              className={plainBtn}
            >
              {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy'}
            </button>
            <button onClick={download} className={plainBtn}><Download size={12} />Save file</button>
            <button onClick={() => setShowQr((v) => !v)} className={plainBtn}><QrCode size={12} />{showQr ? 'Hide QR' : 'Show QR'}</button>
          </div>
          {showQr && <QrPanel text={result.blob} />}
        </>
      )}
    </div>
  )
}

function ImportPanel({ userId }: { userId: number }): JSX.Element {
  const adoptKeys = useChatStore((s) => s.adoptKeys)
  const [blob, setBlob] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const stopScan = useRef<(() => void) | null>(null)

  useEffect(() => () => stopScan.current?.(), [])

  const scan = async (): Promise<void> => {
    const Detector = barcodeDetector()
    if (!Detector) {
      setError('This browser can’t scan QR codes. Scan it with your phone’s camera app and paste the text instead.')
      return
    }
    setError(null)
    setScanning(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      const detector = new Detector({ formats: ['qr_code'] })
      let raf = 0
      const stop = (): void => {
        cancelAnimationFrame(raf)
        stream.getTracks().forEach((t) => t.stop())
        stopScan.current = null
        setScanning(false)
      }
      stopScan.current = stop
      if (video.current) {
        video.current.srcObject = stream
        await video.current.play()
      }
      const tick = async (): Promise<void> => {
        if (!video.current || !stopScan.current) return
        try {
          const [hit] = await detector.detect(video.current)
          if (hit?.rawValue) {
            setBlob(hit.rawValue)
            stop()
            return
          }
        } catch {
          // A frame that can't be decoded is normal; keep looking.
        }
        raf = requestAnimationFrame(() => void tick())
      }
      void tick()
    } catch {
      setError('Could not open the camera')
      setScanning(false)
    }
  }

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await importKeys(userId, blob, passphrase)
      if (res.fromOtherAccount) {
        setError('That export came from a different account')
        return
      }
      await adoptKeys(res.conversations)
      setDone(`Imported ${res.imported} key${res.imported === 1 ? '' : 's'} across ${res.conversations.length} conversation${res.conversations.length === 1 ? '' : 's'}.${res.skipped ? ` ${res.skipped} skipped.` : ''}`)
      setBlob('')
      setPassphrase('')
    } catch (err) {
      setError((err as Error).message || 'Could not import keys')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 pt-2">
      <p className="text-text-muted text-[11px]">Paste an export from your other device, or scan its QR code.</p>
      <textarea
        value={blob}
        onChange={(e) => { setBlob(e.target.value); setDone(null) }}
        placeholder="unrlsd-keys:v1:…"
        rows={3}
        className={`${field} font-mono text-[10px] resize-none`}
      />
      <input
        type="password"
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        placeholder="Passphrase"
        autoComplete="off"
        className={field}
      />
      <div className="flex items-center gap-1 flex-wrap">
        <button onClick={() => void run()} disabled={busy || !blob || !passphrase} className={primaryBtn}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}Import keys
        </button>
        {scanning
          ? <button onClick={() => stopScan.current?.()} className={plainBtn}>Stop scanning</button>
          : <button onClick={() => void scan()} className={plainBtn}><QrCode size={12} />Scan QR</button>}
      </div>
      <video ref={video} playsInline muted className={scanning ? 'w-full max-w-[260px] rounded-xl' : 'hidden'} />
      {error && <p className="text-red-400 text-[11px]">{error}</p>}
      {done && <p className="text-emerald-400 text-[11px]">{done}</p>}
    </div>
  )
}

// Only one device per person is keyed automatically, so this is how your other
// browsers get in: export on the device that has the keys, import here.
export default function ChatKeyTransfer({ userId }: { userId: number }): JSX.Element {
  const [tab, setTab] = useState<'export' | 'import' | null>(null)
  return (
    <div className="pt-1">
      <div className="flex items-center gap-1">
        <button
          onClick={() => setTab(tab === 'export' ? null : 'export')}
          className={tab === 'export' ? `${plainBtn} bg-[var(--surface-overlay)] text-text-primary` : plainBtn}
        >
          <Upload size={12} />Export keys
        </button>
        <button
          onClick={() => setTab(tab === 'import' ? null : 'import')}
          className={tab === 'import' ? `${plainBtn} bg-[var(--surface-overlay)] text-text-primary` : plainBtn}
        >
          <Download size={12} />Import keys
        </button>
      </div>
      {tab === 'export' && <ExportPanel userId={userId} />}
      {tab === 'import' && <ImportPanel userId={userId} />}
    </div>
  )
}
