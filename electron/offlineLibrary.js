const fs = require('fs')

/** @typedef {{ tracks: Record<string, any>, playlists: Record<string, any> }} OfflineLibrary */

// The parsed index as of its last read or write, keyed by path, with the
// file's mtime and size at that moment. Sync keeps the whole catalogue
// offline, which takes the index (lyrics included) to megabytes, and every
// finished download used to parse all of it again. A change on disk that this
// module didn't make changes the stamp and is read fresh.
/** @type {Map<string, { stamp: string, library: OfflineLibrary }>} */
const cache = new Map()

/** @param {string} dataPath */
function stampOf(dataPath) {
  try {
    const stat = fs.statSync(dataPath)
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return null
  }
}

/**
 * @param {string} dataPath
 * @returns {OfflineLibrary}
 */
function loadOfflineLibraryFile(dataPath) {
  const stamp = stampOf(dataPath)
  const hit = cache.get(dataPath)
  if (stamp && hit?.stamp === stamp) return hit.library
  // No file yet. This is the only empty index that may be saved: a missing
  // file is a new library, a locked or half-written one is not.
  if (!stamp) {
    cache.delete(dataPath)
    return { tracks: {}, playlists: {} }
  }
  let library
  try {
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Offline library index is not an object')
    }
    library = { tracks: data.tracks || {}, playlists: data.playlists || {} }
  } catch (error) {
    // A failed read used to be cached as an empty library under this stamp.
    // The next download or playlist sync then saved that over the real index.
    cache.delete(dataPath)
    throw error
  }
  cache.set(dataPath, { stamp, library })
  return library
}

// Replace the index by rename so a crash mid-write leaves the previous file
// in place. Writing straight to `dataPath` could leave it truncated, and the
// next launch then had nothing it could read.
function writeOfflineLibraryFile(dataPath, library) {
  const tmp = `${dataPath}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(library))
  try {
    fs.renameSync(tmp, dataPath)
  } catch (error) {
    try { fs.unlinkSync(tmp) } catch {}
    throw error
  }
}

/**
 * Reload and mutate the offline index without yielding to the event loop.
 * Async work must finish before calling this function so every writer starts
 * from the latest version on disk instead of saving a stale pre-await copy.
 *
 * @param {string} dataPath
 * @param {(library: OfflineLibrary) => void} mutate
 * @param {(error: unknown) => void} [onSaveError]
 * @returns {OfflineLibrary}
 */
function updateOfflineLibraryFile(dataPath, mutate, onSaveError) {
  const library = loadOfflineLibraryFile(dataPath)
  try {
    mutate(library)
  } catch (error) {
    // The cached copy may be half changed; the next read goes back to disk.
    cache.delete(dataPath)
    throw error
  }
  try {
    writeOfflineLibraryFile(dataPath, library)
    const stamp = stampOf(dataPath)
    if (stamp) cache.set(dataPath, { stamp, library })
    else cache.delete(dataPath)
  } catch (error) {
    cache.delete(dataPath)
    onSaveError?.(error)
  }
  return library
}

module.exports = { loadOfflineLibraryFile, updateOfflineLibraryFile }
