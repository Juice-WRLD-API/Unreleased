# Song recognition: backend plan and frontend contract

Status: frontend integration contract, version 1. Backend implementation is pending access to the backend repository. No recognition service or catalogue index is deployed by this change.

## Scope and architecture

Recognize short excerpts of recordings present in the public Juice WRLD catalogue. Clients send microphone recordings, device-audio (loopback) recordings, and clips cut from user-selected files. No third-party recognition provider, continuous listening, humming, or offline matching. Do not promise pitch/speed-change robustness before benchmarking.

Flow: catalogue audio -> background indexing worker -> versioned fingerprint index; client clip -> existing API -> bounded decoding -> warm matching worker -> catalogue IDs.

Evaluate audfprint first (https://github.com/dpwe/audfprint), using its landmark matching and time-offset alignment. Treat the engine as an internal implementation detail. No ML training or GPU requirement is assumed. Determine CPU, memory, index capacity and worker concurrency through measurement rather than catalogue-size guesses.

## First milestone: benchmark before deployment

Use approximately 100 representative reference recordings with multiple held-out excerpts per recording, taken from different positions. Include clean files, real microphone recordings, quiet audio, compression, overlapping speech, related versions, and unrelated songs/silence. Measure false accepts, correct song matches, correct recording matches, abstentions, p50/p95 latency, index size and peak memory. Test pitch/speed edits separately. Tune on a development set and report on separate held-out clips. Choose acceptance thresholds before enabling the endpoint; prioritize abstaining over confidently selecting a wrong song.

## Index lifecycle

- Each indexed recording has a stable `recording_id`, exact playable catalogue `song_id`, source content hash, fingerprint configuration/version, duration and indexing state/error.
- Index full available audio, not only an intro. Catalogue entries without accessible audio are ineligible.
- Version labels are display metadata. `song_id` must resolve to the exact catalogue row whose playable audio was fingerprinted; do not return a parent song ID that plays another version. If this mapping is impossible for a recording, exclude it from v1 until the playback API can represent it.
- Deduplicate identical audio internally while retaining catalogue aliases. Shared sections between different recordings can yield an ambiguous result.
- Enqueue idempotent indexing on audio creation/replacement; metadata-only changes do not require fingerprinting. Mark deletions immediately in metadata so stale index entries cannot be returned. Periodic reconciliation repairs missed jobs.
- Build index snapshots away from serving requests, validate counts/configuration, then atomically swap the active snapshot. Keep the previous snapshot for rollback. Each request uses a single index revision. Serialize writers; warm query workers do not mutate the serving index.
- Public catalogue only in v1. Filter candidates through current catalogue visibility before returning them. Never index private/donor audio into a publicly queryable index.

## HTTP contract (implemented by the frontend)

Paths below are relative to the configured API base (normally `/juicewrld`). They use the existing route override mechanism, including a possible `/recognition` rule. Optional existing `Authorization: Token ...` header; signed-out use is supported with stricter quotas. HTTPS outside local development. Support the app's normal web/Electron origins and multipart CORS preflight.

### GET /recognition/status/

200 JSON: `{ "contract_version": 1, "available": true }`.

When warming/disabled/unindexed, return 200 with `available: false`, or 503. The frontend checks readiness on dialog open and on explicit retry, without polling. It does not request microphone access or upload while unavailable. 404/501 indicate not deployed. No counts or internal infrastructure details are required.

### POST /recognition/

`multipart/form-data`: one `audio` file. The client records 10 seconds (microphone or device audio), or decodes a user-selected audio/video file locally and uploads the chosen 10 seconds as 16-bit mono WAV at 22.05 kHz. Files the client cannot decode are uploaded as-is when they fit the size limit. Maximum upload is 5 MiB; accepted decoded duration is 3–20 seconds. Accept WebM/Opus, Ogg/Opus, MP4/M4A/AAC, MP3, WAV and FLAC; validate by decoding, not filename or MIME alone. Clients negotiate MediaRecorder formats. Decode to the engine's mono PCM sample rate with server-side FFmpeg. Do not trust client duration. Do not accept URLs or remote-fetch instructions.

200 JSON, matched example:

```json
{
  "contract_version": 1,
  "status": "match",
  "matches": [{
    "song_id": 123,
    "recording_id": "recording-456",
    "title": "Catalogue title",
    "artist": "Juice WRLD",
    "version": "Original version",
    "image_url": null,
    "offset_seconds": 42.5
  }]
}
```

`status` is `match` (exactly one candidate), `ambiguous` (2–5 candidates), or `no_match` (empty matches). `version` and `image_url` are nullable. Artwork uses the existing song image URL convention. Offset is finite, nonnegative seconds in the indexed recording. IDs/titles must be nonempty and `song_id` a positive integer. Candidates are ordered by evidence. Never represent an internal score as a calibrated probability. A low-evidence clip is `no_match`; `ambiguous` requires plausible candidates, not arbitrary nearest neighbours.

The frontend resolves `/songs/{song_id}/` on a Play/Add to queue action and uses the existing song-to-track conversion. Results do not autoplay or seek. Song details open through the existing song-info flow. Returned recording identity must remain consistent with that playback mapping.

Errors: JSON `{ "code": "machine_code", "detail": "Readable explanation" }`. Use 400 `invalid_audio` (corrupt/undecodable/silence), 401/403 for auth/access, 413 `clip_too_large`, 415 `unsupported_audio`, 422 `invalid_duration`, 429 `rate_limited` with `Retry-After`, 503 `recognition_unavailable`, and 504 `recognition_timeout`. Silence may instead be a successful `no_match`; choose consistently. Never return an HTML success page. The client rejects invalid response shapes and uses a 30-second request timeout, with no automatic upload retries.

## Resource limits and privacy

- Bound bytes at the reverse proxy and API, then bound decoded duration, decoder runtime, output bytes, concurrency and queue length. Initial proposal: 10-second decode limit, 15-second match deadline, total server deadline below the client's 30 seconds; benchmark and tune.
- Run decoding/matching in restricted workers with generated temporary filenames, argument-array subprocess calls and no network access. Reject excess jobs promptly rather than building an unbounded queue.
- Apply per-account/IP quotas and a global concurrency limit. Do not persist raw clips or add them to the catalogue; remove temporary data on success, failure, timeout and worker recovery. Use a stale-temp cleanup job for crashes.
- Log request IDs, timings, status and index revision; exclude audio, tokens and client filenames. Keep operational metrics separate from listening history.

## Implementation sequence once backend access is available

1. Inspect existing models, task queue, deployment and authentication. Adapt this internal design to those conventions without changing the wire contract silently.
2. Build the benchmark and select engine settings/thresholds.
3. Add recording/index state, ingestion jobs, initial public-catalogue backfill and reconciliation.
4. Deploy bounded decoding and a warm matcher with snapshot activation/rollback.
5. Implement status and recognition routes, authorization/visibility checks, quotas, errors and cleanup.
6. Validate against the frontend contract, real recordings, ambiguous versions, unknown audio, malformed uploads and concurrent indexing. Enable readiness only once the index is usable.

Frontend checks cover the contract, cancellation/resource cleanup and desktop microphone permission scope. End-to-end recognition accuracy and live API behavior cannot be verified until this backend exists.

## Frontend handoff

Implemented entry points: the waveform button next to Tracker search and desktop Tools -> Identify song. The lazy-loaded dialog checks readiness and offers three sources: Microphone, This device (system audio; Windows desktop and desktop browsers) and File (any length up to 80 MB, audio or video, drag-and-drop supported). Files are decoded on the device, the loudest 10 seconds are preselected on a waveform, and the user can move and preview the window before uploading only that part. Results show the three recognition outcomes with Play, Queue and Details. Capture and uploads are cancelled on close; backgrounding the document cancels capture and previews. Playback is paused for microphone recording (not for device audio) and is not automatically resumed. No recordings or recognition history are saved by the client; only the last-used source is remembered.

Electron permits audio-only requests from the main app frame, retaining denials for cameras, other origins and subframes. On Windows, getDisplayMedia from the main app frame is granted after a confirmation dialog with loopback system audio plus a 1px screen track the renderer stops immediately; other platforms deny display capture. macOS packaging supplies the microphone usage description and audio-input entitlements. Browser capture and OS permission behavior still require hands-on validation on each target platform; no browser/preview or installer was launched for this frontend implementation.
