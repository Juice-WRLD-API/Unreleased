// Plays ALAC on desktop. Chromium plays AAC and refuses ALAC, including ALAC
// stored in .m4a, so those files are transcoded to FLAC with the on-demand
// ffmpeg and that FLAC is what the audio element receives. The transcode is
// cached; while it is still being written the handler tails the file so
// playback starts before the whole song is encoded.

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { Readable } = require('stream')
const { codecFromSource, isAlacContainerExt } = require('./alac')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const CACHE_MAX_BYTES = 1024 * 1024 * 1024

function cacheName(tag) {
  return crypto.createHash('sha256').update(String(tag)).digest('hex').slice(0, 32) + '.flac'
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * @param {string} filePath
 * @returns {Promise<'alac' | 'aac' | 'other' | null>}
 */
async function sniffFile(filePath) {
  const fh = await fs.promises.open(filePath, 'r')
  try {
    const stat = await fh.stat()
    const read = async (offset, length) => {
      if (length <= 0 || offset >= stat.size) return Buffer.alloc(0)
      const n = Math.min(length, stat.size - offset)
      const buf = Buffer.alloc(n)
      const { bytesRead } = await fh.read(buf, 0, n, offset)
      return buf.subarray(0, bytesRead)
    }
    // Awaited so the handle stays open until the last seek finishes. A bare
    // return would run finally, close the file, and the reads would fail.
    return await codecFromSource(read, stat.size)
  } finally {
    await fh.close()
  }
}

/**
 * @param {string} url
 * @param {typeof fetch} [fetchImpl]
 */
async function sniffUrl(url, fetchImpl = fetch) {
  const res = await fetchImpl(url, { headers: { Range: 'bytes=0-15', 'User-Agent': UA } })
  if (!(res.ok || res.status === 206)) return null
  const first = Buffer.from(await res.arrayBuffer())
  const cr = res.headers.get('content-range')
  const total = cr && /\/(\d+)\s*$/.exec(cr)
  const size = total ? Number(total[1]) : Number(res.headers.get('content-length') || first.length)
  if (!size) return null
  const whole = first.length >= size
  const read = async (offset, length) => {
    const end = offset + length
    if (whole || end <= first.length) return first.subarray(offset, Math.min(end, first.length))
    const r = await fetchImpl(url, { headers: { Range: `bytes=${offset}-${end - 1}`, 'User-Agent': UA } })
    if (!(r.ok || r.status === 206)) return Buffer.alloc(0)
    return Buffer.from(await r.arrayBuffer())
  }
  return codecFromSource(read, size)
}

/**
 * @param {{ cacheDir: () => string, ffmpegPath: () => string | null, downloadFfmpeg?: () => Promise<string | null> }} opts
 */
function createAlacPlayback(opts) {
  /** @type {Map<string, Promise<void>>} dest path → encode */
  const jobs = new Map()
  /** @type {Map<string, 'alac' | 'aac' | 'other' | null>} */
  const sniffed = new Map()

  function dir() {
    const d = opts.cacheDir()
    fs.mkdirSync(d, { recursive: true })
    return d
  }

  function inCache(filePath) {
    const root = path.resolve(dir())
    const resolved = path.resolve(filePath)
    return resolved.startsWith(root + path.sep)
  }

  async function prune() {
    const root = dir()
    let names
    try { names = await fs.promises.readdir(root) } catch { return }
    const files = []
    for (const name of names) {
      if (!name.endsWith('.flac')) continue
      const p = path.join(root, name)
      if (jobs.has(p)) continue
      const st = await fs.promises.stat(p).catch(() => null)
      if (!st) continue
      files.push({ p, size: st.size, mtime: st.mtimeMs })
    }
    let total = files.reduce((sum, f) => sum + f.size, 0)
    files.sort((a, b) => a.mtime - b.mtime)
    for (const f of files) {
      if (total <= CACHE_MAX_BYTES) break
      await fs.promises.unlink(f.p).catch(() => {})
      await fs.promises.unlink(f.p + '.ok').catch(() => {})
      total -= f.size
    }
  }

  function encode(ffmpeg, input, dest) {
    const existing = jobs.get(dest)
    if (existing) return existing
    /** @type {Promise<void>} */
    const job = new Promise((resolve, reject) => {
      const args = ['-hide_banner', '-nostdin', '-y']
      if (/^https?:/i.test(input)) args.push('-user_agent', UA)
      args.push('-i', input, '-map', '0:a:0', '-vn', '-c:a', 'flac', '-compression_level', '0', '-f', 'flac', 'pipe:1')
      const ff = spawn(ffmpeg, args, { windowsHide: true })
      const out = fs.createWriteStream(dest)
      let stderr = ''
      let settled = false
      let code = null
      let ended = false
      const fail = (err) => {
        if (settled) return
        settled = true
        try { ff.kill() } catch { /* already gone */ }
        out.destroy()
        fs.unlink(dest, () => {})
        fs.unlink(dest + '.ok', () => {})
        reject(err instanceof Error ? err : new Error(String(err)))
      }
      const maybeDone = () => {
        if (settled || code === null || !ended) return
        if (code !== 0) {
          const tail = stderr.trim().split('\n').filter(Boolean).slice(-2).join(' ')
          fail(new Error(tail || `ffmpeg exited with code ${code}`))
          return
        }
        fs.writeFile(dest + '.ok', '', (e) => {
          if (settled) return
          settled = true
          if (e) reject(e)
          else resolve()
        })
      }
      ff.on('error', fail)
      out.on('error', fail)
      ff.stderr.on('data', (d) => {
        stderr += d.toString()
        if (stderr.length > 4000) stderr = stderr.slice(-4000)
      })
      ff.stdout.pipe(out)
      out.on('finish', () => { ended = true; maybeDone() })
      ff.on('close', (c) => {
        code = c
        if (c !== 0) {
          const tail = stderr.trim().split('\n').filter(Boolean).slice(-2).join(' ')
          fail(new Error(tail || `ffmpeg exited with code ${c}`))
          return
        }
        maybeDone()
      })
    })
    jobs.set(dest, job)
    // A failed encode must be retryable. A successful one stays so a second
    // caller awaits the same result instead of starting ffmpeg again.
    job.catch(() => { if (jobs.get(dest) === job) jobs.delete(dest) })
    return job
  }

  async function fileCodec(filePath, stat) {
    const key = `${filePath}\0${stat.size}\0${stat.mtimeMs}`
    if (sniffed.has(key)) return sniffed.get(key)
    const codec = await sniffFile(filePath)
    sniffed.set(key, codec)
    return codec
  }

  /**
   * Start (or reuse) a transcode of a local ALAC file.
   * @returns {Promise<null | { ready: true, path: string } | { live: string, job: Promise<void> }>}
   *   null when the file is not ALAC, or ffmpeg is not installed yet.
   */
  async function startLocal(filePath) {
    const ext = path.extname(filePath).toLowerCase()
    if (!isAlacContainerExt(ext) || inCache(filePath)) return null
    let stat
    try { stat = await fs.promises.stat(filePath) } catch { return null }
    const codec = await fileCodec(filePath, stat)
    if (codec !== 'alac') return null
    const ffmpeg = opts.ffmpegPath()
    if (!ffmpeg) return null
    const dest = path.join(dir(), cacheName(`file\0${filePath}\0${stat.size}\0${stat.mtimeMs}`))
    if (fs.existsSync(dest + '.ok')) return { ready: true, path: dest }
    if (!jobs.has(dest)) {
      try { fs.unlinkSync(dest) } catch { /* no partial */ }
      void prune()
      encode(ffmpeg, filePath, dest)
    }
    return { live: dest, job: jobs.get(dest) }
  }

  /**
   * A remote URL, or a local file the protocol could not transcode because
   * ffmpeg was not installed yet. Resolves `{ path, ready }` of a FLAC
   * (`ready` once the encode has finished), `{}` when the source is not
   * ALAC, or `{ error }`.
   * @param {string} url
   */
  async function prepare(url) {
    let input = null
    let tag = null
    let codec = null
    if (url.startsWith('local-media:')) {
      input = new URL(url).searchParams.get('p')
      if (!input) return { error: 'Missing file' }
      const ext = path.extname(input).toLowerCase()
      if (!isAlacContainerExt(ext)) return {}
      let stat
      try { stat = await fs.promises.stat(input) } catch { return {} }
      codec = await fileCodec(input, stat)
      tag = `file\0${input}\0${stat.size}\0${stat.mtimeMs}`
    } else if (/^https?:\/\//i.test(url)) {
      let name = ''
      try { name = new URL(url).pathname } catch { return {} }
      if (!isAlacContainerExt(path.extname(name))) return {}
      codec = await sniffUrl(url)
      input = url
      tag = `url\0${url}`
    } else {
      return {}
    }
    if (codec !== 'alac') return {}
    let ffmpeg = opts.ffmpegPath()
    if (!ffmpeg && opts.downloadFfmpeg) ffmpeg = await opts.downloadFfmpeg()
    if (!ffmpeg) return { error: 'The audio converter is not installed' }
    const dest = path.join(dir(), cacheName(tag))
    // `ready` is only true once the encode has finished. The path is returned
    // either way so playback can tail the file, but a failed encode deletes
    // it — callers must not remember a path that isn't ready.
    const ready = fs.existsSync(dest + '.ok')
    if (!ready && !jobs.has(dest)) {
      try { fs.unlinkSync(dest) } catch { /* no partial */ }
      void prune()
      const job = encode(ffmpeg, input, dest)
      // Surface a failure to the caller that is still waiting, without
      // turning a later playback of the cached file into a rejection.
      job.catch(() => {})
    }
    return { path: dest, ready }
  }

  return { startLocal, prepare, inCache, jobs, sniffFile }
}

/**
 * Bytes of an in-progress FLAC. An open-ended request from the start is a
 * chunked body so playback can begin immediately; any other range waits until
 * those bytes have been encoded and answers 206.
 * @param {string} file
 * @param {Promise<void>} job
 * @param {string | null} rangeHeader
 * @returns {Promise<{ status: number, headers: Record<string, string>, stream: Readable }>}
 */
async function liveBody(file, job, rangeHeader) {
  const match = rangeHeader && /bytes=(\d*)-(\d*)/.exec(rangeHeader)
  const start = match && match[1] ? parseInt(match[1], 10) : 0
  const end = match && match[2] ? parseInt(match[2], 10) : null
  const openFromStart = !match || (start === 0 && end == null)
  if (openFromStart) {
    return {
      status: 200,
      headers: { 'Content-Type': 'audio/flac' },
      stream: tailFile(file, job),
    }
  }
  const need = end == null ? null : end + 1
  const size = await waitForSize(file, job, need)
  if (start >= size || start < 0) {
    const empty = new Readable({ read() { this.push(null) } })
    return {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}` },
      stream: empty,
    }
  }
  const last = end == null ? size - 1 : Math.min(end, size - 1)
  return {
    status: 206,
    headers: {
      'Content-Type': 'audio/flac',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(last - start + 1),
      'Content-Range': `bytes ${start}-${last}/${size}`,
    },
    stream: fs.createReadStream(file, { start, end: last }),
  }
}

async function waitForSize(file, job, need) {
  let failed = null
  job.catch((e) => { failed = e })
  for (;;) {
    if (failed) throw failed
    let size = 0
    try { size = (await fs.promises.stat(file)).size } catch { /* not created yet */ }
    let done = false
    try {
      await Promise.race([
        job.then(() => { done = true }),
        sleep(30),
      ])
    } catch (e) {
      failed = e
    }
    if (failed) throw failed
    if (need == null) {
      if (done) {
        try { size = (await fs.promises.stat(file)).size } catch { /* gone */ }
        return size
      }
      continue
    }
    if (size >= need || done) {
      try { size = (await fs.promises.stat(file)).size } catch { /* gone */ }
      return size
    }
  }
}

function tailFile(file, job) {
  let offset = 0
  let closed = false
  let failed = null
  job.catch((e) => { failed = e })
  return new Readable({
    async read() {
      while (!closed) {
        if (failed && offset === 0) { this.destroy(failed); return }
        let size = 0
        try { size = (await fs.promises.stat(file)).size } catch { /* not created yet */ }
        if (size > offset) {
          const fh = await fs.promises.open(file, 'r')
          try {
            const len = Math.min(size - offset, 256 * 1024)
            const buf = Buffer.alloc(len)
            const { bytesRead } = await fh.read(buf, 0, len, offset)
            if (bytesRead > 0) {
              offset += bytesRead
              if (!closed) this.push(buf.subarray(0, bytesRead))
              return
            }
          } finally {
            await fh.close()
          }
        }
        let done = false
        try {
          await Promise.race([
            job.then(() => { done = true }),
            sleep(30),
          ])
        } catch (e) {
          failed = e
        }
        if (closed) return
        if (failed) {
          let finalSize = 0
          try { finalSize = (await fs.promises.stat(file)).size } catch { /* unlinked */ }
          if (finalSize > offset) continue
          this.destroy(failed)
          return
        }
        if (done) {
          let finalSize = 0
          try { finalSize = (await fs.promises.stat(file)).size } catch { /* unlinked */ }
          if (finalSize > offset) continue
          this.push(null)
          return
        }
      }
    },
    destroy(err, cb) {
      closed = true
      cb(err)
    },
  })
}

module.exports = {
  createAlacPlayback,
  liveBody,
  sniffFile,
  sniffUrl,
  cacheName,
  UA,
}
