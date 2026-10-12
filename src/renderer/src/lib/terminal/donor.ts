import { relativeTime } from '../../components/adminShared'
import { formatBytes } from '../format'
import { deleteDonorFile, fetchDonorFileBlob, listDonorFiles, updateDonorFile, uploadDonorFile, validateDonorUpload, type DonorFile } from '../donorFilesApi'
import { useStore } from '../../store/useStore'
import { pickLocalFile, saveBlob } from './pick'
import { asJson, confirmAction, fail, parseArgs, table, type TermCommand } from './types'

// The donor file locker (Settings > Donor): your own uploads, with a share
// link per file. The account has to be a donor; the API refuses otherwise.
const st = (): ReturnType<typeof useStore.getState> => useStore.getState()

// A file is named by its number in `donor ls`, or the start of its id or name.
async function fileFrom(arg: string): Promise<DonorFile> {
  const { files } = await listDonorFiles()
  const q = arg.trim().toLowerCase()
  if (!q) fail('say which file (donor ls)')
  const n = /^#?(\d+)$/.exec(q)
  if (n) return files[Number(n[1]) - 1] ?? fail(`pick a file from 1 to ${files.length}`)
  const hits = files.filter((f) => f.file_id.toLowerCase().startsWith(q) || f.filename.toLowerCase().includes(q))
  return hits.length === 1 ? hits[0] : fail(hits.length ? `${hits.length} files match "${arg.trim()}" - be more specific` : `no file matches "${arg.trim()}" (donor ls)`)
}

export const DONOR_COMMANDS: TermCommand[] = [
  {
    name: 'donor', group: 'Account', usage: 'donor [ls] · up · get <file> · rename <file> -- <name> · share|unshare <file> · rm <file>',
    description: 'Your donor file locker: list, upload (opens a picker), download, rename, share by link and delete. <file> is its number in ls, or part of its name',
    covers: ['donorFilesApi.listDonorFiles', 'donorFilesApi.uploadDonorFile', 'donorFilesApi.updateDonorFile', 'donorFilesApi.deleteDonorFile', 'donorFilesApi.fetchDonorFileBlob'],
    complete: (before, partial) => (before.length === 0 ? ['ls', 'up', 'get', 'rename', 'share', 'unshare', 'rm'].filter((v) => v.startsWith(partial.toLowerCase())) : []),
    run: async (args, ctx) => {
      if (!st().account) fail('sign in first (login)')
      const dash = args.split(/\s+--\s+/)
      const { rest, bool } = parseArgs(dash[0])
      const sub = (rest.shift() ?? 'ls').toLowerCase()
      const target = rest.join(' ')
      if (sub === 'ls' || sub === 'list') {
        const { files, quota } = await listDonorFiles()
        if (asJson(ctx, bool.has('json'), { files, quota })) return
        ctx.print(`${files.length ? table(files.map((f, i) => [String(i + 1), f.filename, formatBytes(f.size), f.is_shared ? 'shared' : '', relativeTime(f.created_at)])) : 'no files yet (donor up)'}\n${formatBytes(quota.used)} of ${formatBytes(quota.quota)} used`)
      } else if (sub === 'up' || sub === 'upload') {
        const file = await pickLocalFile('audio/*,image/*')
        const { quota } = await listDonorFiles()
        const problem = validateDonorUpload(file, quota)
        if (problem) fail(problem)
        ctx.print(`uploading ${file.name} (${formatBytes(file.size)})…`, 'dim')
        let shown = 0
        const res = await uploadDonorFile(file, (f) => { const pct = Math.floor(f * 4) * 25; if (pct > shown && pct < 100) { shown = pct; ctx.print(`${file.name} ${pct}%`, 'dim') } })
        ctx.print(`uploaded ${res.file.filename} · ${formatBytes(res.quota.remaining)} left`, 'ok')
      } else if (sub === 'get') {
        const f = await fileFrom(target)
        const blob = await fetchDonorFileBlob(f.file_id)
        saveBlob(blob, f.filename)
        ctx.print(`saved ${f.filename} (${formatBytes(blob.size)}) to your downloads`, 'ok')
      } else if (sub === 'rename') {
        const name = dash.slice(1).join(' -- ').trim()
        if (!name) fail('usage: donor rename <file> -- <new name>')
        const f = await fileFrom(target)
        const up = await updateDonorFile(f.file_id, { filename: name })
        ctx.print(`renamed to ${up.filename}`, 'ok')
      } else if (sub === 'share' || sub === 'unshare') {
        const f = await fileFrom(target)
        const up = await updateDonorFile(f.file_id, { is_shared: sub === 'share' })
        ctx.print(sub === 'share' ? `shared: ${up.share_url}` : `${up.filename} is private again`, 'ok')
      } else if (sub === 'rm' || sub === 'delete') {
        const f = await fileFrom(target)
        if (!confirmAction(ctx, `Delete ${f.filename}? This can't be undone.`, bool.has('y'))) return
        const res = await deleteDonorFile(f.file_id)
        ctx.print(`deleted ${f.filename} · ${formatBytes(res.quota.remaining)} left`, 'ok')
      } else fail('usage: donor [ls | up | get | rename | share | unshare | rm]')
    },
  },
]
