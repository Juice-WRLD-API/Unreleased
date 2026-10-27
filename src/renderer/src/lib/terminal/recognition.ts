import { useStore } from '../../store/useStore'
import { getSongsByIds, parseDuration } from '../juicewrldApi'
import { checkRecognition, identifyClip } from '../recognitionApi'
import { canCaptureSystemAudio, recordRecognitionClip, type RecognitionSource } from '../recognitionCapture'
import { RECOGNITION_SECONDS, validateRecognitionClip } from '../recognitionContract'
import { decodeRecognitionFile, sliceRecognitionClip } from '../recognitionFile'
import { pickLocalFile } from './pick'
import { rememberFind } from './player'
import { asJson, clock, fail, parseArgs, type TermCommand } from './types'

// Song recognition (the Identify song dialog): the same sources, the same
// status check before anything is recorded or uploaded, and the same upload -
// a recording, or the chosen part of a file decoded on this device.
const st = (): ReturnType<typeof useStore.getState> => useStore.getState()

const SUBCOMMANDS = ['mic', 'device', 'file', 'status', 'open']

/** `--at 1:20` or `--at 80`: where the part of a file to send starts. */
function parseAt(arg: string): number {
  if (/^\d+(?:\.\d+)?$/.test(arg)) return Number(arg)
  const seconds = parseDuration(arg)
  return seconds > 0 || /^0+:0+$/.test(arg) ? seconds : fail('--at takes a time like 1:20 or 80')
}

async function ensureAvailable(signal: AbortSignal): Promise<void> {
  if (!await checkRecognition(signal)) fail('song recognition is unavailable right now - try again later')
}

export const RECOGNITION_COMMANDS: TermCommand[] = [
  {
    name: 'identify', aliases: ['recognize'], group: 'Player',
    usage: 'identify [mic | device | file [--at 1:20]] [--json] · identify status · identify open',
    description: `Name a song from ${RECOGNITION_SECONDS} seconds of audio, as Identify song does. mic (the default) listens to the room and pauses playback; device records what this computer is playing (Windows desktop and desktop browsers); file opens a picker, reads the file here and sends only its loudest ${RECOGNITION_SECONDS} seconds (--at 1:20 for another part). Matches are numbered (then play N / queue add N). status checks the service; open shows the dialog`,
    covers: ['recognitionApi.checkRecognition', 'recognitionApi.identifyClip'],
    complete: (before, partial) => (before.length === 0 ? SUBCOMMANDS.filter((v) => v.startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => {
      const { rest, bool, value } = parseArgs(args, ['at'])
      const sub = (rest.shift() ?? 'mic').toLowerCase()
      if (sub === 'open') { st().setShowRecognition(true); ctx.print('identify song opened', 'ok'); return }
      if (sub === 'status') {
        const available = await checkRecognition(ctx.signal)
        if (asJson(ctx, bool.has('json'), { available })) return
        ctx.print(available ? 'song recognition is available' : 'song recognition is unavailable right now', available ? 'ok' : 'dim')
        return
      }

      let clip: Blob
      let quiet = false
      if (sub === 'file') {
        // The picker needs the keypress that ran this, so it opens before any request.
        const file = await pickLocalFile('audio/*,video/*,.webm,.ogg,.opus,.m4a,.mp3,.wav,.flac,.aac,.mp4,.mov')
        await ensureAvailable(ctx.signal)
        ctx.print(`reading ${file.name}…`, 'dim')
        const decoded = await decodeRecognitionFile(file, ctx.signal)
        if (decoded) {
          const segment = Math.min(RECOGNITION_SECONDS, decoded.duration)
          const at = value.has('at') ? parseAt(value.get('at')!) : decoded.suggestedStart
          const start = Math.min(Math.max(0, at), decoded.duration - segment)
          clip = sliceRecognitionClip(decoded, start, segment)
          ctx.print(`sending ${clock(start)}–${clock(start + segment)} of ${clock(decoded.duration)}${value.has('at') ? '' : ' (the loudest part)'}…`, 'dim')
        } else {
          // This runtime can't decode it, but the server can try a short clip as-is.
          validateRecognitionClip(file)
          clip = file
          ctx.print('this device can’t read that file, so it is sent as it is…', 'dim')
        }
      } else if (sub === 'mic' || sub === 'microphone' || sub === 'device' || sub === 'system') {
        const source: RecognitionSource = sub === 'device' || sub === 'system' ? 'system' : 'microphone'
        if (source === 'system' && !canCaptureSystemAudio()) fail('recording device audio is not supported here - try identify mic or identify file')
        await ensureAvailable(ctx.signal)
        // The microphone would hear this app too; device audio is often meant to.
        if (source === 'microphone') {
          const s = st()
          s.setIsPlaying(false)
          if (s.radioFmActive) s.setRadioFmActive(false)
        }
        ctx.print(`${source === 'system' ? 'recording this device' : 'listening'} for ${RECOGNITION_SECONDS} seconds… (Ctrl+C to stop)`, 'dim')
        let peak = 0
        clip = await recordRecognitionClip(ctx.signal, (_seconds, level) => { peak = Math.max(peak, level) }, source)
        quiet = peak < 0.01
      } else return fail('usage: identify [mic | device | file [--at 1:20]] · identify status · identify open')

      ctx.print('identifying…', 'dim')
      const result = await identifyClip(clip, ctx.signal)
      if (asJson(ctx, bool.has('json'), result)) return
      if (result.status === 'no_match') {
        ctx.print(`no match this time - try a clearer part with vocals; the recording may not be in the catalogue yet${quiet ? ' (very little sound was heard)' : ''}`, 'dim')
        return
      }
      // Numbered like find, so play N / queue add N pick a match. The song rows
      // are what Play and Queue in the dialog load too.
      const songs = await getSongsByIds(result.matches.map((m) => m.song_id), ctx.signal).catch(() => [])
      const byId = new Map(songs.map((song) => [song.id, song]))
      const resolved = result.matches.map((m) => byId.get(m.song_id))
      const numbered = resolved.every((song) => song?.path)
      if (numbered) rememberFind(resolved.map((song) => song!))
      const lines = result.matches.map((m, i) => `${numbered ? `${String(i + 1).padStart(3)}  ` : '  '}${m.title} · ${m.artist}${m.version ? ` (${m.version})` : ''}  heard at ${clock(m.offset_seconds)}  song #${m.song_id}`)
      ctx.print(result.status === 'match' ? 'found it' : 'a few possible recordings:', 'ok')
      ctx.print(`${lines.join('\n')}${numbered ? '\nplay N · queue add N · queue next N' : ''}`, 'plain')
    },
  },
]
