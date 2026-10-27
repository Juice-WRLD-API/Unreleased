export const RECOGNITION_SECONDS = 10
export const RECOGNITION_MAX_BYTES = 5 * 1024 * 1024

export interface RecognitionMatch {
  song_id: number
  recording_id: string
  title: string
  artist: string
  version: string | null
  image_url: string | null
  offset_seconds: number
}

export interface RecognitionResult {
  contract_version: 1
  status: 'match' | 'ambiguous' | 'no_match'
  matches: RecognitionMatch[]
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function parseRecognitionStatus(value: unknown): boolean {
  if (!object(value) || value.contract_version !== 1 || typeof value.available !== 'boolean') {
    throw new Error('Song recognition returned an unsupported response. Try again later.')
  }
  return value.available
}

export function parseRecognitionResult(value: unknown): RecognitionResult {
  const invalid = () => new Error('Song recognition returned an incomplete result. Please try again.')
  if (!object(value) || value.contract_version !== 1 || !Array.isArray(value.matches)) throw invalid()
  const count = value.matches.length
  if (!(value.status === 'match' && count === 1)
    && !(value.status === 'ambiguous' && count >= 2 && count <= 5)
    && !(value.status === 'no_match' && count === 0)) throw invalid()
  const ids = new Set<string>()
  for (const match of value.matches) {
    if (!object(match) || !Number.isSafeInteger(match.song_id) || (match.song_id as number) <= 0
      || !nonempty(match.recording_id) || !nonempty(match.title) || !nonempty(match.artist)
      || !(match.version === null || typeof match.version === 'string')
      || !(match.image_url === null || typeof match.image_url === 'string')
      || typeof match.offset_seconds !== 'number' || !Number.isFinite(match.offset_seconds)
      || match.offset_seconds < 0 || ids.has(match.recording_id)) throw invalid()
    ids.add(match.recording_id)
  }
  return value as unknown as RecognitionResult
}

export function validateRecognitionClip(clip: Blob): void {
  if (!clip.size) throw new Error('The clip is empty. Record or choose another clip.')
  if (clip.size > RECOGNITION_MAX_BYTES) throw new Error('Choose a clip smaller than 5 MB and between 3 and 20 seconds long.')
}
