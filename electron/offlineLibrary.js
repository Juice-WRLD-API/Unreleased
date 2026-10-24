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
  let library
  try {
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
    library = { tracks: data.tracks || {}, playlists: data.playlists || {} }
  } catch {
    library = { tracks: {}, playlists: {} }
  }
  if (stamp) cache.set(dataPath, { stamp, library })
  else cache.delete(dataPath)
  return library
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
    fs.writeFileSync(dataPath, JSON.stringify(library))
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
