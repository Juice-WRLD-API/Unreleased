import { formatBytes } from '../format'
import { IS_ELECTRON } from '../platform'
import {
  useCatalogSync, remainingBytes, catalogSyncSummary, formatSyncEta, CATALOG_SYNC_CATEGORIES, type CatalogSyncCategory,
} from '../../store/catalogSyncStore'
import {
  catalogSyncFootprint, moveOfflineFolder, pauseCatalogSync, previewCatalogSync, removeCatalogSyncFiles, resumeCatalogSync,
  retryCatalogSyncFailures, setCatalogSyncCategories, setCatalogSyncEnabled, syncCatalogNow,
} from '../catalogSync'
import { confirmAction, fail, parseArgs, table, type TermCommand } from './types'

// Home → Tools → Sync from the terminal: the same switch, pause, check, "what
// to keep" and folder as the dialog. Downloads run in the background either
// way, so the commands that start them return straight away.

const st = (): ReturnType<typeof useCatalogSync.getState> => useCatalogSync.getState()
const SUBCOMMANDS = ['status', 'on', 'off', 'pause', 'resume', 'now', 'retry', 'failed', 'keep', 'remove', 'folder', 'open']
const KEEP = ['released', 'unreleased', 'both']

function needsDesktop(): void {
  if (!IS_ELECTRON) fail('Sync is in the desktop app')
}

function status(): string {
  const s = st()
  const left = remainingBytes(s)
  const lines = [
    `sync      ${catalogSyncSummary(s)}`,
    `keeps     ${s.settings.categories.join(' and ')}`,
  ]
  if (s.target) lines.push(`here      ${s.have.toLocaleString()} of ${s.target.toLocaleString()} songs · ${formatBytes(s.bytes)}${left ? ` · about ${formatBytes(left)} to go` : ''}`)
  if (s.phase === 'syncing' && s.speedBps) {
    const eta = formatSyncEta(left / s.speedBps)
    lines.push(`speed     ${formatBytes(s.speedBps)}/s${eta ? ` · ${eta} left` : ''}`)
  }
  if (s.active.length) lines.push(`now       ${s.active.map((a) => a.title).join(', ')}`)
  if (s.failures.length) lines.push(`failed    ${s.failures.length} (offline failed lists them)`)
  if (s.phase === 'error' && s.error) lines.push(`error     ${s.error}`)
  if (s.folder) lines.push(`folder    ${s.folder}${s.diskFree != null ? ` · ${formatBytes(s.diskFree)} free` : ''}`)
  const kept = !s.settings.enabled ? catalogSyncFootprint() : null
  if (kept?.songs) lines.push(`kept      ${kept.songs.toLocaleString()} songs from Sync (${formatBytes(kept.bytes)}) · offline remove deletes them`)
  return lines.join('\n')
}

export const OFFLINE_SYNC_COMMANDS: TermCommand[] = [
  {
    name: 'offline', aliases: ['catalog-sync'], group: 'Library',
    usage: 'offline [status|on|off [--remove] [-y]|pause|resume|now|retry|failed|keep released|unreleased|both|remove [-y]|folder [path]|open]',
    description: 'Sync: keep every released and unreleased song on this computer (same as Home > Tools > Sync). on starts it, off stops it (--remove also deletes the songs only Sync kept), now checks for new songs, keep picks the categories',
    covers: [
      'catalogSync.previewCatalogSync', 'catalogSync.setCatalogSyncEnabled', 'catalogSync.resumeCatalogSync', 'catalogSync.syncCatalogNow',
      'catalogSync.retryCatalogSyncFailures', 'catalogSync.setCatalogSyncCategories', 'catalogSync.removeCatalogSyncFiles', 'catalogSync.moveOfflineFolder',
      'juicewrldApi.fetchCatalogWithLyrics', 'juicewrldApi.fetchSongUncached',
    ],
    complete: (before, partial) => {
      const p = partial.toLowerCase()
      if (before.length === 0) return SUBCOMMANDS.filter((v) => v.startsWith(p))
      if (before.length === 1 && before[0].toLowerCase() === 'keep') return KEEP.filter((v) => v.startsWith(p))
      return []
    },
    run: async (args, ctx) => {
      needsDesktop()
      const { rest, bool } = parseArgs(args)
      const sub = (rest[0] ?? 'status').toLowerCase()
      const s = st()
      switch (sub) {
        case 'status': {
          await previewCatalogSync()
          ctx.print(status())
          return
        }
        case 'on': {
          if (s.settings.enabled && !s.settings.paused) { ctx.print('Sync is already on', 'dim'); return }
          void setCatalogSyncEnabled(true)
          ctx.print('Sync is on: downloads run in the background (offline shows how far along it is)', 'ok')
          return
        }
        case 'off': {
          if (!s.settings.enabled) { ctx.print('Sync is already off', 'dim'); return }
          const removeFiles = bool.has('remove')
          await previewCatalogSync()
          const kept = catalogSyncFootprint()
          if (removeFiles && kept.songs && !confirmAction(ctx, `Turn Sync off and delete ${kept.songs.toLocaleString()} songs (${formatBytes(kept.bytes)}) that only Sync kept?`, bool.has('y'))) return
          await setCatalogSyncEnabled(false, { removeFiles })
          if (removeFiles) ctx.print(`Sync is off; removed ${kept.songs.toLocaleString()} songs (${formatBytes(kept.bytes)})`, 'ok')
          else ctx.print(`Sync is off; ${kept.songs.toLocaleString()} songs stay on this computer (offline remove deletes them)`, 'ok')
          return
        }
        case 'pause': {
          if (!s.settings.enabled) fail('Sync is off')
          pauseCatalogSync()
          ctx.print('paused', 'ok')
          return
        }
        case 'resume': {
          if (!s.settings.enabled) fail('Sync is off (offline on starts it)')
          void resumeCatalogSync()
          ctx.print('resumed', 'ok')
          return
        }
        case 'now': {
          if (!s.settings.enabled) fail('Sync is off (offline on starts it)')
          void syncCatalogNow()
          ctx.print('checking for new and changed songs', 'ok')
          return
        }
        case 'retry': {
          if (!s.settings.enabled) fail('Sync is off (offline on starts it)')
          const count = s.failures.length
          void retryCatalogSyncFailures()
          ctx.print(count ? `retrying ${count} song${count === 1 ? '' : 's'}` : 'nothing failed; checking again anyway', 'ok')
          return
        }
        case 'failed': {
          if (!s.failures.length) { ctx.print('nothing failed', 'dim'); return }
          ctx.print(table(s.failures.map((f) => [f.title, f.error])))
          return
        }
        case 'keep': {
          const which = (rest[1] ?? '').toLowerCase()
          if (!KEEP.includes(which)) fail(`usage: offline keep ${KEEP.join('|')}`)
          const categories: CatalogSyncCategory[] = which === 'both' ? [...CATALOG_SYNC_CATEGORIES] : [which as CatalogSyncCategory]
          void setCatalogSyncCategories(categories)
          ctx.print(`Sync keeps ${categories.join(' and ')} songs${categories.length < CATALOG_SYNC_CATEGORIES.length ? ' (the others go, unless an offline playlist has them)' : ''}`, 'ok')
          return
        }
        case 'remove': {
          if (s.settings.enabled) fail('turn Sync off first (offline off --remove does both)')
          await previewCatalogSync()
          const kept = catalogSyncFootprint()
          if (!kept.songs) { ctx.print('no songs from Sync on this computer', 'dim'); return }
          if (!confirmAction(ctx, `Delete ${kept.songs.toLocaleString()} songs (${formatBytes(kept.bytes)}) that only Sync kept?`, bool.has('y'))) return
          await removeCatalogSyncFiles()
          ctx.print(`removed ${kept.songs.toLocaleString()} songs (${formatBytes(kept.bytes)})`, 'ok')
          return
        }
        case 'folder': {
          const target = rest.slice(1).join(' ').trim()
          if (!target) { ctx.print(s.folder ?? 'the app’s data folder'); return }
          ctx.print('moving every offline song…', 'dim')
          const result = await moveOfflineFolder(target)
          if (result.error) fail(result.error)
          ctx.print(`offline songs now in ${st().folder ?? target}${result.failedCount ? ` (${result.failedCount} couldn’t be moved and will download again)` : ''}`, 'ok')
          return
        }
        case 'open': {
          s.setOpen(true)
          ctx.print('opened Sync', 'ok')
          return
        }
        default:
          fail(`offline ${SUBCOMMANDS.join('|')}`)
      }
    },
  },
]
