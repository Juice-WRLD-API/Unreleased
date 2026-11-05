// Chromium decodes AAC in an MP4/M4A container and does not decode ALAC, which
// uses the same container and the same audio/mp4 type. The fourcc in the
// sample description is what tells them apart: 'alac' or 'mp4a'. CAF (Apple's
// other container) puts the same id in its desc chunk.

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'moof', 'traf'])
const NOT_AUDIO = new Set(['jpeg', 'png ', 'mp4v'])

/**
 * @param {(offset: number, length: number) => Promise<Buffer>} read
 * @param {number} size
 * @returns {Promise<'alac' | 'aac' | 'other' | null>}
 */
async function codecFromSource(read, size) {
  if (!size) return null
  const head = await read(0, 12)
  if (head.length >= 4 && head.toString('latin1', 0, 4) === 'caff') return cafCodec(read, size)
  return mp4Codec(read, size)
}

/**
 * @param {string[]} formats sample-entry fourccs
 * @returns {'alac' | 'aac' | 'other' | null}
 */
function classify(formats) {
  const audio = formats.filter((f) => !NOT_AUDIO.has(f))
  if (audio.some((f) => f === 'alac')) return 'alac'
  if (audio.some((f) => f === 'mp4a')) return 'aac'
  return audio.length ? 'other' : null
}

/**
 * @param {Buffer} buf
 * @param {number} start
 * @param {number} end
 * @param {number} depth
 * @param {string[]} found
 */
function walk(buf, start, end, depth, found) {
  if (depth > 8) return
  let off = start
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off)
    const type = buf.toString('latin1', off + 4, off + 8)
    let header = 8
    if (size === 1) {
      if (off + 16 > end) return
      const big = buf.readBigUInt64BE(off + 8)
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) return
      size = Number(big)
      header = 16
    } else if (size === 0) {
      size = end - off
    }
    if (size < header || off + size > end) return
    const body = off + header
    if (type === 'stsd') readStsd(buf, body, off + size, found)
    else if (CONTAINERS.has(type)) walk(buf, body, off + size, depth + 1, found)
    off += size
  }
}

function readStsd(buf, start, end, found) {
  // FullBox (4) + entry_count (4), then size+type sample entries.
  if (start + 8 > end) return
  const count = buf.readUInt32BE(start + 4)
  let off = start + 8
  for (let i = 0; i < count && off + 8 <= end; i++) {
    const size = buf.readUInt32BE(off)
    found.push(buf.toString('latin1', off + 4, off + 8))
    if (size < 8 || off + size > end) return
    off += size
  }
}

async function mp4Codec(read, size) {
  let offset = 0
  while (offset + 8 <= size) {
    const head = await read(offset, 16)
    if (head.length < 8) return null
    let boxSize = head.readUInt32BE(0)
    const type = head.toString('latin1', 4, 8)
    let header = 8
    if (boxSize === 1) {
      if (head.length < 16) return null
      const big = head.readBigUInt64BE(8)
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null
      boxSize = Number(big)
      header = 16
    } else if (boxSize === 0) {
      boxSize = size - offset
    }
    if (!Number.isFinite(boxSize) || boxSize < header || offset + boxSize > size) return null
    if (type === 'moov') {
      if (boxSize > 32 * 1024 * 1024) return null
      const moov = await read(offset, boxSize)
      const formats = []
      walk(moov, 0, moov.length, 0, formats)
      return classify(formats)
    }
    offset += boxSize
  }
  return null
}

async function cafCodec(read, size) {
  let offset = 8 // past 'caff' + version + flags
  while (offset + 12 <= size) {
    const head = await read(offset, 12)
    if (head.length < 12) return null
    const type = head.toString('latin1', 0, 4)
    const chunkSize = Number(head.readBigInt64BE(4))
    if (!Number.isFinite(chunkSize) || chunkSize < 0 || offset + 12 + chunkSize > size) return null
    if (type === 'desc') {
      const desc = await read(offset + 12, 12)
      if (desc.length < 12) return null
      const format = desc.toString('latin1', 8, 12)
      if (format === 'alac') return 'alac'
      if (format === 'aac ' || format === 'aach') return 'aac'
      return 'other'
    }
    offset += 12 + chunkSize
  }
  return null
}

/** Extensions that might hold ALAC. `.m4a` is usually AAC; the codec decides. */
const ALAC_CONTAINER_EXTS = new Set(['.m4a', '.mp4', '.caf', '.alac'])

function isAlacContainerExt(ext) {
  return ALAC_CONTAINER_EXTS.has(String(ext || '').toLowerCase())
}

module.exports = {
  codecFromSource,
  classify,
  isAlacContainerExt,
  ALAC_CONTAINER_EXTS,
}
