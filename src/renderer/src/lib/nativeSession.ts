// Control/asset bridge only. The native host owns its audio clock and renders to
// WASAPI; no audio blocks pass through Electron IPC while playing.
interface NativeApi {
  platform: string
  sessionNativeOpen(id: string): Promise<{ error?: string }>
  sessionNativeCommand(id: string, command: object, channels?: Float32Array[]): Promise<{ error?: string }>
  sessionNativeClose(id: string): Promise<void>
  sessionNativeRender(req: object): Promise<{ channels?: Float32Array<ArrayBuffer>[]; error?: string }>
  onSessionNativeEvent(cb: (e: { id: string; type: string; position?: number; error?: string }) => void): () => void
}

function api(): NativeApi | null {
  const e = typeof window !== 'undefined' ? (window as unknown as { electron?: Partial<NativeApi> }).electron : undefined
  return e?.platform === 'win32' && e.sessionNativeOpen ? e as NativeApi : null
}

export const hasNativeSession = (): boolean => !!api()
export interface NativeAsset { id: string; buffer: AudioBuffer }

export async function renderNativeSession(project: object, assets: NativeAsset[], duration: number, sampleRate: number): Promise<AudioBuffer> {
  const result = await api()!.sessionNativeRender({ project, duration, sampleRate,
    assets: assets.map(({ id, buffer }) => ({ id, sampleRate: buffer.sampleRate,
      channels: Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c)) })) })
  if (result.error || !result.channels?.length) throw new Error(result.error ?? 'Native export returned no audio')
  const buffer = new AudioBuffer({ numberOfChannels: result.channels.length, length: result.channels[0].length, sampleRate })
  result.channels.forEach((c, i) => buffer.copyToChannel(c, i))
  return buffer
}

export class NativeSessionTransport {
  private bridge = api()!
  private id = crypto.randomUUID()
  private ready: Promise<void> | null = null
  private off: (() => void) | null = null
  private uploaded = new Set<string>()
  private queue: Promise<void> = Promise.resolve()
  private generation = 0
  private disposed = false
  private pos = 0
  private stamp = 0
  private advancing = false
  private latestMix: object | null = null
  private mixQueued = false
  private failed = false

  constructor(private onError: (error: string) => void) {}

  private fail(error: unknown): void {
    if (this.disposed || this.failed) return
    this.failed = true
    this.advancing = false
    this.onError(error instanceof Error ? error.message : String(error))
  }

  private open(): Promise<void> {
    if (!this.ready) {
      this.off = this.bridge.onSessionNativeEvent((e) => {
        if (e.id !== this.id || this.disposed) return
        if (e.type === 'error') this.fail(e.error ?? 'Native playback failed')
        if (e.type === 'position' && this.advancing) { this.pos = e.position ?? this.pos; this.stamp = performance.now() }
      })
      this.ready = this.bridge.sessionNativeOpen(this.id).then((r) => { if (r.error) throw new Error(r.error) })
    }
    return this.ready
  }

  private async command(command: object, channels?: Float32Array[]): Promise<void> {
    await this.open()
    if (this.disposed || this.failed) return
    const r = await this.bridge.sessionNativeCommand(this.id, command, channels)
    if (r.error) throw new Error(r.error)
  }

  position(): number { return this.pos + (this.advancing && this.stamp ? Math.min(.1, (performance.now() - this.stamp) / 1000) : 0) }

  play(project: object, assets: NativeAsset[], from: number, ab: string): void {
    const generation = ++this.generation
    this.pos = from; this.stamp = 0; this.advancing = false
    const ready = this.open()
    this.queue = this.queue.then(async () => {
      await ready
      for (const { id, buffer } of assets) {
        if (generation !== this.generation || this.disposed) return
        if (this.uploaded.has(id)) continue
        await this.command({ op: 'asset', id, sampleRate: buffer.sampleRate }, Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c)))
        this.uploaded.add(id)
      }
      if (generation !== this.generation || this.disposed) return
      await this.command({ op: 'play', project, from, ab })
      this.uploaded = new Set(assets.map((a) => a.id))
      if (generation === this.generation && !this.disposed && !this.failed) this.advancing = true
    }).catch((error) => this.fail(error))
  }

  mix(project: object): void {
    this.latestMix = project
    if (!this.ready || this.mixQueued) return
    this.mixQueued = true
    this.queue = this.queue.then(async () => {
      this.mixQueued = false
      const latest = this.latestMix
      if (latest) await this.command({ op: 'mix', project: latest })
    }).catch((error) => this.fail(error))
  }

  setAB(value: string): void { if (this.ready) void this.command({ op: 'ab', value }).catch((e) => this.fail(e)) }

  pause(): void {
    this.pos = this.position(); this.advancing = false; ++this.generation
    if (this.ready) void this.command({ op: 'pause' }).catch((e) => this.fail(e))
  }

  dispose(): void {
    this.disposed = true; ++this.generation; this.off?.(); this.off = null
    if (this.ready) void this.bridge.sessionNativeClose(this.id)
  }
}
