// Cover art for the unreleased eras in Files: one folder per era under
// "Compilation/4. Cover Art/2. Unreleased Discography", numbered in era order
// ("8. WRLD ON DRUGS (Sessions)/WRLD ON DRUGS (Sessions).png"). The folder
// names don't match era names, so the number is the key; the file inside is
// looked up from the folder listing so a renamed image still resolves.
// (eraCovers.ts is a different thing: the user's own per-era override.)
import { listSubtree, listFilesRecursive } from './juicewrldApi'

const COVER_ROOT = 'Compilation/4. Cover Art/2. Unreleased Discography'
const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif)$/i

/** Era name (as the API spells it) to its folder number under COVER_ROOT. */
const ERA_FOLDER: Record<string, number> = {
  'jute': 1,
  'afflictions': 2,
  'HIH 999': 3,
  'jw 999': 4,
  'bdm': 5,
  'ND': 6,
  'GB&GR': 7,
  'WOD': 8,
  'DRFL': 9,
  'OUT': 10,
  'POST': 11,
}

/** True when the era has a cover folder. Synchronous, for enabling a button. */
export function hasEraCoverFile(eraName: string | null | undefined): boolean {
  return !!eraName && eraName in ERA_FOLDER
}

let coverFiles: Promise<string[]> | null = null

function loadCoverFiles(): Promise<string[]> {
  if (!coverFiles) {
    coverFiles = (async () => {
      const entries = (await listSubtree(COVER_ROOT)) ?? await listFilesRecursive(COVER_ROOT)
      return entries.filter(e => e.type === 'file' && IMAGE_RE.test(e.path)).map(e => e.path)
    })()
    coverFiles.catch(() => { coverFiles = null })
  }
  return coverFiles
}

/** Storage path of an unreleased era's cover ("Compilation/4. Cover Art/…png"),
 *  the same shape the editor's file picker stores in `image_url`. Null when the
 *  era has no cover folder or the folder holds no image. */
export async function findEraCoverFile(eraName: string | null | undefined): Promise<string | null> {
  if (!eraName || !hasEraCoverFile(eraName)) return null
  const prefix = `${COVER_ROOT}/${ERA_FOLDER[eraName]}. `
  const files = await loadCoverFiles()
  return files.find(p => p.startsWith(prefix)) ?? null
}
