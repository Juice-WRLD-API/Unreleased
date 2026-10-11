// Reads individual entries out of a zip on the API without downloading it.
//
// Studio sessions are 100-800 MB zips, but /files/download/ honours HTTP
// Range (and CORS exposes Content-Range), so the central directory at the end
// of the file can be fetched on its own and each entry pulled out by byte
// range. Entries are almost always deflated - inflated in the browser with
// DecompressionStream('deflate-raw'). Zip64 archives are handled; encrypted
// entries and compression methods other than stored/deflate are not.
//
// Every request costs ~2 s before the first byte no matter its size, so the
// request count is what matters: the directory usually arrives with the
// first (suffix) request, the server answers multi-range requests, so all the
// takes' headers come back in a request or two, and a whole entry is one.

export interface ZipEntry {
  name: string
  /** 0 = stored, 8 = deflate. */
  method: number
  compressedSize: number
  size: number
  localHeaderOffset: number
  isDir: boolean
}

export interface RemoteZip {
  url: string
  size: number
  entries: ZipEntry[]
}

interface Part { start: number; bytes: Uint8Array }

function parseContentRange(v: string | null): { start: number; end: number; total: number } | null {
  const m = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(v ?? '')
  return m ? { start: Number(m[1]), end: Number(m[2]), total: Number(m[3]) } : null
}

/** One request for `ranges` ("a-b" or "-n" strings); the parts that came back. */
async function fetchRanges(url: string, ranges: string[], signal?: AbortSignal): Promise<{ parts: Part[]; total: number }> {
  const res = await fetch(url, { headers: { Range: `bytes=${ranges.join(',')}` }, signal })
  if (res.status !== 206) throw new Error(res.ok ? 'Server ignored the byte range' : `HTTP ${res.status}`)
  const body = new Uint8Array(await res.arrayBuffer())
  const type = res.headers.get('content-type') ?? ''
  const boundary = /boundary=("?)([^";]+)\1/i.exec(type)?.[2]
  if (!/multipart\/byteranges/i.test(type) || !boundary) {
    const cr = parseContentRange(res.headers.get('content-range'))
    if (!cr) throw new Error('Missing Content-Range')
    return { parts: [{ start: cr.start, bytes: body }], total: cr.total }
  }
  // multipart/byteranges: each part's own Content-Range gives its offset and length.
  const latin1 = new TextDecoder('latin1')
  const parts: Part[] = []
  let total = NaN
  let p = 0
  for (;;) {
    const hdrStart = indexOf(body, CRLF_CRLF, p)
    if (hdrStart < 0) break
    const headerText = latin1.decode(body.subarray(Math.max(p, hdrStart - 512), hdrStart))
    const cr = parseContentRange(/content-range:\s*([^\r\n]+)/i.exec(headerText.slice(headerText.lastIndexOf('--' + boundary)))?.[1] ?? null)
    if (!cr) break
    const dataStart = hdrStart + 4
    const len = cr.end - cr.start + 1
    parts.push({ start: cr.start, bytes: body.subarray(dataStart, dataStart + len) })
    total = cr.total
    p = dataStart + len
  }
  if (!parts.length) throw new Error('Could not read the server response')
  return { parts, total }
}

const CRLF_CRLF = new Uint8Array([13, 10, 13, 10])
function indexOf(hay: Uint8Array, needle: Uint8Array, from: number): number {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

/** Bytes [start, start+len) from whichever part covers them. */
function slice(parts: Part[], start: number, len: number): Uint8Array | null {
  for (const part of parts) {
    if (start >= part.start && start < part.start + part.bytes.length) {
      const o = start - part.start
      return part.bytes.subarray(o, Math.min(part.bytes.length, o + len))
    }
  }
  return null
}

const u16 = (v: DataView, o: number): number => v.getUint16(o, true)
const u32 = (v: DataView, o: number): number => v.getUint32(o, true)
const u64 = (v: DataView, o: number): number => Number(v.getBigUint64(o, true))
const view = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength)

export async function openRemoteZip(url: string, signal?: AbortSignal): Promise<RemoteZip> {
  // End of central directory: 22 bytes + up to 64 KB comment, plus the 20-byte
  // zip64 locator before it. Asking for more means the directory itself
  // usually rides along for sessions of a few hundred files.
  const { parts: [tailPart], total } = await fetchRanges(url, ['-262144'], signal)
  const tail = tailPart.bytes
  const tailStart = tailPart.start
  const tv = view(tail)
  let eocd = -1
  for (let i = tail.length - 22; i >= 0 && i >= tail.length - 22 - 0xffff; i--) if (u32(tv, i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('Not a zip file')

  let count = u16(tv, eocd + 10)
  let cdSize = u32(tv, eocd + 12)
  let cdOffset = u32(tv, eocd + 16)
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20
    if (loc < 0 || u32(tv, loc) !== 0x07064b50) throw new Error('Broken zip64 archive')
    const z64 = u64(tv, loc + 8)
    const zb = z64 >= tailStart ? tail.subarray(z64 - tailStart, z64 - tailStart + 56) : (await fetchRanges(url, [`${z64}-${z64 + 55}`], signal)).parts[0].bytes
    const zv = view(zb)
    count = u64(zv, 32)
    cdSize = u64(zv, 40)
    cdOffset = u64(zv, 48)
  }

  const cd = cdOffset >= tailStart
    ? tail.subarray(cdOffset - tailStart, cdOffset - tailStart + cdSize)
    : (await fetchRanges(url, [`${cdOffset}-${cdOffset + cdSize - 1}`], signal)).parts[0].bytes
  const cv = view(cd)
  const utf8 = new TextDecoder('utf-8')
  const entries: ZipEntry[] = []
  let p = 0
  for (let k = 0; k < count && p + 46 <= cd.length; k++) {
    if (u32(cv, p) !== 0x02014b50) break
    const method = u16(cv, p + 10)
    let compressedSize = u32(cv, p + 20)
    let size = u32(cv, p + 24)
    const nameLen = u16(cv, p + 28)
    const extraLen = u16(cv, p + 30)
    const commentLen = u16(cv, p + 32)
    let localHeaderOffset = u32(cv, p + 42)
    const name = utf8.decode(cd.subarray(p + 46, p + 46 + nameLen))

    // Zip64 extended info: only the fields that overflowed are present, in this order.
    let e = p + 46 + nameLen
    const extraEnd = e + extraLen
    while (e + 4 <= extraEnd) {
      const id = u16(cv, e), len = u16(cv, e + 2)
      if (id === 0x0001) {
        let q = e + 4
        if (size === 0xffffffff) { size = u64(cv, q); q += 8 }
        if (compressedSize === 0xffffffff) { compressedSize = u64(cv, q); q += 8 }
        if (localHeaderOffset === 0xffffffff) { localHeaderOffset = u64(cv, q) }
      }
      e += 4 + len
    }

    entries.push({ name, method, compressedSize, size, localHeaderOffset, isDir: name.endsWith('/') })
    p += 46 + nameLen + extraLen + commentLen
  }
  return { url, size: total, entries }
}

/** Offset of an entry's data within `local`, which starts at its local header.
 *  The local header's extra field can differ from the central directory's. */
function dataOffset(local: Uint8Array): number {
  const hv = view(local)
  if (local.length < 30 || u32(hv, 0) !== 0x04034b50) throw new Error('Bad local header')
  return 30 + u16(hv, 26) + u16(hv, 28)
}

function assertSupported(entry: ZipEntry): void {
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`Unsupported zip compression (${entry.method})`)
}

// Room for the local header's name + extra field, which ride along in the same range.
const LOCAL_SLACK = 30 + 1024

/** The first `want` uncompressed bytes of each entry (fewer if it's shorter) -
 *  enough to read WAV headers without pulling whole takes. Batched into
 *  multi-range requests; an entry that can't be read is simply missing. */
export async function readEntryHeads(zip: RemoteZip, entries: ZipEntry[], want: number, signal?: AbortSignal, onProgress?: (done: number) => void): Promise<Map<ZipEntry, Uint8Array>> {
  const out = new Map<ZipEntry, Uint8Array>()
  const todo = entries.filter((e) => e.method === 0 || e.method === 8).sort((a, b) => a.localHeaderOffset - b.localHeaderOffset)
  // Deflated PCM rarely compresses better than 2:1 in the header region, so
  // want + 4 KB compressed comfortably covers `want` uncompressed bytes.
  const compWant = (e: ZipEntry): number => Math.min(e.compressedSize, e.method === 0 ? want : want + 4096)
  const BATCH = 60
  const batches: ZipEntry[][] = []
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH))
  let done = 0
  await Promise.all(batches.map(async (batch) => {
    // Ranges must not overlap, or the server may merge them.
    const ranges = batch.map((e, i) => {
      const start = e.localHeaderOffset
      let end = Math.min(zip.size - 1, start + LOCAL_SLACK + compWant(e) - 1)
      const next = batch[i + 1]
      if (next) end = Math.min(end, next.localHeaderOffset - 1)
      return { e, start, end }
    })
    const { parts } = await fetchRanges(zip.url, ranges.map((r) => `${r.start}-${r.end}`), signal)
    await Promise.all(ranges.map(async ({ e, start, end }) => {
      const local = slice(parts, start, end - start + 1)
      if (!local) return
      try {
        const off = dataOffset(local)
        const comp = local.subarray(off, off + compWant(e))
        out.set(e, e.method === 0 ? comp.subarray(0, want) : await inflatePartial(comp, want))
      } catch {}
    }))
    done += batch.length
    onProgress?.(done)
  }))
  return out
}

async function inflatePartial(comp: Uint8Array, want: number): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw')
  const writer = ds.writable.getWriter()
  // Not awaited: the stream is deliberately truncated, so close() rejects.
  writer.write(comp as Uint8Array<ArrayBuffer>).catch(() => {})
  writer.close().catch(() => {})
  const reader = ds.readable.getReader()
  const chunks: Uint8Array[] = []
  let got = 0
  try {
    while (got < want) {
      const { value, done } = await reader.read()
      if (done || !value) break
      chunks.push(value)
      got += value.length
    }
  } catch {
    // Truncated input ends in an error once everything decodable was emitted.
  }
  reader.cancel().catch(() => {})
  const out = new Uint8Array(Math.min(got, want))
  let o = 0
  for (const c of chunks) {
    const n = Math.min(c.length, out.length - o)
    out.set(c.subarray(0, n), o)
    o += n
    if (o >= out.length) break
  }
  return out
}

/** The whole uncompressed entry, in one request. `onProgress` gets compressed bytes received. */
export async function readEntry(zip: RemoteZip, entry: ZipEntry, signal?: AbortSignal, onProgress?: (received: number, total: number) => void): Promise<ArrayBuffer> {
  assertSupported(entry)
  const start = entry.localHeaderOffset
  const end = Math.min(zip.size - 1, start + LOCAL_SLACK + entry.compressedSize - 1)
  const res = await fetch(zip.url, { headers: { Range: `bytes=${start}-${end}` }, signal })
  if (res.status !== 206 || !res.body) throw new Error(`HTTP ${res.status}`)
  const expected = end - start + 1
  const buf = new Uint8Array(expected)
  let received = 0
  const reader = res.body.getReader()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf.set(value.subarray(0, Math.max(0, expected - received)), received)
    received += value.length
    onProgress?.(Math.min(received, entry.compressedSize), entry.compressedSize)
  }
  const local = buf.subarray(0, received)
  const off = dataOffset(local)
  const comp = local.subarray(off, off + entry.compressedSize)
  if (entry.method === 0) return comp.slice().buffer
  const inflate = new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>
  return new Response(new Blob([comp as Uint8Array<ArrayBuffer>]).stream().pipeThrough(inflate)).arrayBuffer()
}
