// Current-song lyrics for iJWA over a local, read-only Windows named pipe.
// Nothing is written to disk; only the main player's selected fields are shared.
const net = require('node:net')
const { createHash } = require('node:crypto')
const { homedir } = require('node:os')

function pipeName(dev = false) {
  const user = createHash('sha256').update(homedir().toLowerCase()).digest('hex').slice(0, 16)
  return `\\\\.\\pipe\\unreleased-ijwa-lyrics-${user}${dev ? '-dev' : ''}`
}

function cleanSnapshot(value) {
  if (!value || typeof value !== 'object' || !value.track) return null
  const track = value.track
  if (typeof track.id !== 'string' || typeof track.title !== 'string' || typeof track.artist !== 'string') return null
  const text = (v, limit) => typeof v === 'string' ? v.slice(0, limit) : ''
  return {
    track: { id: text(track.id, 4096), title: text(track.title, 4096), artist: text(track.artist, 4096),
      duration: Number.isFinite(track.duration) && track.duration > 0 ? track.duration : 0 },
    plainLyrics: text(value.plainLyrics, 256 * 1024),
    syncedLyrics: text(value.syncedLyrics, 256 * 1024),
    offset: Number.isFinite(value.offset) ? Math.max(-60, Math.min(60, value.offset)) : 0,
    pending: Boolean(value.pending),
  }
}

function createLyricsBridge({ endpoint = pipeName(), onError = (error) => console.warn('[iJWA lyrics]', error.message) } = {}) {
  let snapshot = null
  let encoded = JSON.stringify({ version: 1, snapshot }) + '\n'
  const sockets = new Set()
  const send = (socket) => {
    if (socket.writableLength > 2 * 1024 * 1024) socket.destroy()
    else socket.write(encoded)
  }
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => socket.destroy())
    socket.on('close', () => sockets.delete(socket))
    // The connection only reads snapshots, and expires even if its reader disappears.
    socket.on('data', () => socket.destroy())
    socket.setTimeout(15000, () => socket.destroy())
    send(socket)
  })
  server.maxConnections = 8
  server.on('error', onError)
  server.listen(endpoint)
  server.unref()
  return {
    server,
    publish(value) {
      snapshot = cleanSnapshot(value)
      const next = JSON.stringify({ version: 1, snapshot }) + '\n'
      if (next === encoded) return
      encoded = next
      for (const socket of sockets) send(socket)
    },
    close() {
      for (const socket of sockets) socket.destroy()
      server.close()
    },
  }
}

module.exports = { pipeName, cleanSnapshot, createLyricsBridge }
