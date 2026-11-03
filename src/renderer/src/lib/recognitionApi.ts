import { apiRequest, authHeaders } from './apiClient'
import { routeUrl } from './apiServers'
import { getToken } from './userApi'
import { parseRecognitionResult, parseRecognitionStatus, validateRecognitionClip } from './recognitionContract'

async function recognitionRequest(path: string, signal: AbortSignal, body?: FormData): Promise<unknown> {
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) controller.abort()
  const timeout = setTimeout(() => { timedOut = true; controller.abort() }, 30_000)
  try {
    return await apiRequest<unknown>(routeUrl(path), {
      method: body ? 'POST' : 'GET', body,
      headers: authHeaders(getToken()), signal: controller.signal,
      parseError: async (response) => {
        if ([404, 501, 503].includes(response.status)) return 'Song recognition is not available yet. Please try again later.'
        if (response.status === 429) return 'Too many recognition attempts. Wait a minute before trying again.'
        if ([401, 403].includes(response.status)) return 'Sign in again to use song recognition.'
        if (response.status === 413) return 'Choose a clip smaller than 5 MB.'
        if ([400, 415, 422].includes(response.status)) return 'Use a clear audio clip between 3 and 20 seconds long (MP3, WAV, M4A, WebM, Ogg or FLAC).'
        if (response.status === 504) return 'Recognition took too long. Please try again.'
        return 'Could not identify this clip. Please try again later.'
      },
    })
  } catch (error) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    if (timedOut) throw new Error('Recognition took too long. Please try again.')
    if (error instanceof SyntaxError) throw new Error('Song recognition returned an unsupported response. Try again later.')
    if (error instanceof TypeError) throw new Error('Could not connect to song recognition. Check your connection and try again.')
    throw error
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
  }
}

export async function checkRecognition(signal: AbortSignal): Promise<boolean> {
  return parseRecognitionStatus(await recognitionRequest('/recognition/status/', signal))
}

export async function identifyClip(clip: Blob, signal: AbortSignal) {
  validateRecognitionClip(clip)
  const form = new FormData()
  // Keep local filenames out of requests/logs. The server sniffs the actual format.
  form.append('audio', clip, 'clip')
  return parseRecognitionResult(await recognitionRequest('/recognition/', signal, form))
}
