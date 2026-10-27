import { RECOGNITION_SECONDS, RECOGNITION_MAX_BYTES } from './recognitionContract'

/** 'microphone' listens to the room; 'system' records what this device is playing. */
export type RecognitionSource = 'microphone' | 'system'

const MESSAGES = {
  microphone: {
    unsupported: 'Microphone recording is not supported here. Choose an audio file instead.',
    slow: 'Microphone access took too long. Check your microphone permissions and try again.',
    missing: 'No microphone audio was found. Choose an audio file instead.',
    failed: 'Recording failed. Check your microphone and try again.',
    silent: 'No audio was recorded. Check your microphone and try again.',
    ended: 'The microphone disconnected. Try again or choose an audio file.',
    stalled: 'The microphone did not finish recording. Try again or choose an audio file.',
    denied: 'Microphone access was denied. Allow microphone access in your device settings, or choose an audio file.',
    notFound: 'No microphone was found. Connect one or choose an audio file.',
    busy: 'Your microphone is busy or unavailable. Close other recording apps and try again.',
    other: 'Could not start the microphone. Check your device settings or choose an audio file.',
  },
  system: {
    unsupported: 'Recording device audio is not supported here. Use the microphone or choose an audio file.',
    slow: 'Sharing device audio took too long. Try again.',
    missing: 'No device audio was shared. Turn on audio sharing when asked, or use the microphone.',
    failed: 'Recording device audio failed. Try again or use the microphone.',
    silent: 'No device audio was recorded. Make sure something is playing and try again.',
    ended: 'Audio sharing stopped. Try again or use the microphone.',
    stalled: 'Device audio did not finish recording. Try again or use the microphone.',
    denied: 'Device audio was not shared. Try again and allow it, or use the microphone.',
    notFound: 'No audio output was found to record. Use the microphone instead.',
    busy: 'Device audio is unavailable right now. Try again or use the microphone.',
    other: 'Could not record device audio. Try again or use the microphone.',
  },
} as const

/** Whether this runtime can record device audio without a microphone. Electron
 * only supports loopback capture on Windows; browsers offer their own picker. */
export function canCaptureSystemAudio(): boolean {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') return false
  const electron = (window as unknown as { electron?: { platform?: string } }).electron
  if (electron) return electron.platform === 'win32'
  return !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

function acquire(source: RecognitionSource): Promise<MediaStream> {
  const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  if (source === 'microphone') return navigator.mediaDevices.getUserMedia({ audio })
  // getDisplayMedia always needs video; the track is dropped as soon as it arrives.
  return navigator.mediaDevices.getDisplayMedia({
    audio, video: { width: 1, height: 1, frameRate: 1 }, systemAudio: 'include',
  } as DisplayMediaStreamOptions)
}

/** Owns every capture resource, including streams granted after cancellation. */
export function recordRecognitionClip(signal: AbortSignal, onProgress: (seconds: number, level: number) => void, source: RecognitionSource = 'microphone'): Promise<Blob> {
  const text = MESSAGES[source]
  return new Promise((resolve, reject) => {
    let finished = false
    let stream: MediaStream | undefined
    let recorder: MediaRecorder | undefined
    let context: AudioContext | undefined
    let interval: ReturnType<typeof setInterval> | undefined
    let stopTimer: ReturnType<typeof setTimeout> | undefined
    let permissionTimer: ReturnType<typeof setTimeout> | undefined
    let finishTimer: ReturnType<typeof setTimeout> | undefined
    const chunks: Blob[] = []
    let bytes = 0
    const cleanup = () => {
      clearInterval(interval)
      clearTimeout(stopTimer)
      clearTimeout(permissionTimer)
      clearTimeout(finishTimer)
      signal.removeEventListener('abort', abort)
      if (recorder) {
        recorder.ondataavailable = recorder.onstop = recorder.onerror = null
        if (recorder.state !== 'inactive') { try { recorder.stop() } catch {} }
      }
      stream?.getTracks().forEach(track => { track.onended = null; track.stop() })
      if (context) void context.close().catch(() => {})
    }
    const fail = (error: unknown) => {
      if (finished) return
      finished = true
      cleanup()
      reject(error)
    }
    const abort = () => fail(new DOMException('Cancelled', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { abort(); return }
    if (!(source === 'microphone' ? navigator.mediaDevices?.getUserMedia : navigator.mediaDevices?.getDisplayMedia) || typeof MediaRecorder === 'undefined') {
      fail(new Error(text.unsupported))
      return
    }
    // A share picker can take longer to answer than a microphone prompt.
    permissionTimer = setTimeout(() => fail(new Error(text.slow)), source === 'system' ? 60_000 : 30_000)
    void acquire(source).then((captured) => {
      if (finished) { captured.getTracks().forEach(track => track.stop()); return }
      stream = captured
      clearTimeout(permissionTimer)
      try {
        const videoTracks = stream.getVideoTracks?.() ?? []
        videoTracks.forEach(track => track.stop())
        if (!stream.getAudioTracks().length) throw new Error(text.missing)
        // MediaRecorder rejects a stream whose video track has ended, so record audio alone.
        const audioStream = videoTracks.length ? new MediaStream(stream.getAudioTracks()) : stream
        const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']
          .find(type => MediaRecorder.isTypeSupported(type))
        recorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined)
        let analyser: AnalyserNode | undefined
        let samples: Uint8Array<ArrayBuffer> | undefined
        // A missing level meter must not prevent supported MediaRecorder capture.
        try {
          context = new AudioContext()
          analyser = context.createAnalyser()
          analyser.fftSize = 256
          context.createMediaStreamSource(audioStream).connect(analyser)
          samples = new Uint8Array(analyser.fftSize)
          void context.resume().catch(() => {})
        } catch { analyser = undefined }
        recorder.ondataavailable = (event) => {
          if (finished) return
          bytes += event.data.size
          if (bytes > RECOGNITION_MAX_BYTES) { fail(new Error('The recording is too large. Try a shorter audio file.')); return }
          if (event.data.size) chunks.push(event.data)
        }
        recorder.onerror = () => fail(new Error(text.failed))
        recorder.onstop = () => {
          if (finished) return
          const blob = new Blob(chunks, { type: recorder?.mimeType || chunks[0]?.type || 'application/octet-stream' })
          finished = true
          cleanup()
          if (blob.size) resolve(blob)
          else reject(new Error(text.silent))
        }
        stream.getAudioTracks().forEach(track => { track.onended = () => fail(new Error(text.ended)) })
        recorder.start(250)
        const start = performance.now()
        onProgress(0, 0)
        interval = setInterval(() => {
          let level = 0
          if (analyser && samples) {
            analyser.getByteTimeDomainData(samples)
            level = Math.min(1, Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length) * 4)
          }
          onProgress(Math.min(RECOGNITION_SECONDS, (performance.now() - start) / 1000), level)
        }, 100)
        stopTimer = setTimeout(() => { if (recorder?.state === 'recording') recorder.stop() }, RECOGNITION_SECONDS * 1000)
        finishTimer = setTimeout(() => fail(new Error(text.stalled)), (RECOGNITION_SECONDS + 5) * 1000)
      } catch (error) { fail(error) }
    }).catch((error: unknown) => {
      const name = error instanceof DOMException ? error.name : ''
      console.error('[recognition] capture failed', source, error)
      fail(new Error(name === 'NotAllowedError' || name === 'SecurityError' || (source === 'system' && name === 'AbortError') ? text.denied
        : name === 'NotFoundError' ? text.notFound
        : name === 'NotReadableError' ? text.busy
        : text.other))
    })
  })
}
