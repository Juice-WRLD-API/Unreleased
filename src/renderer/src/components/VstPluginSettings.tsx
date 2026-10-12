// Settings → Plug-ins: the VST3 effects the Session Maker can put on lanes - where the
// app looks for them, which ones are hidden from its lists, and which wouldn't load.

import { useState } from 'react'
import { AlertTriangle, Eye, EyeOff, FolderOpen, FolderPlus, Loader2, RefreshCw, Search, X } from 'lucide-react'
import { useVstPlugins, vstPluginKey, vstPlugins } from '../lib/vstPlugins'

const btn = 'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[var(--surface-overlay)] border border-[var(--border)] text-text-secondary hover:text-text-primary hover:bg-[var(--surface-raised)] disabled:opacity-40 transition-colors'
const row = 'flex items-center gap-2 bg-[var(--surface-overlay)] rounded-lg px-3 py-2 border border-[var(--border)]'
const iconBtn = 'p-1 rounded text-text-muted hover:text-text-primary hover:bg-[var(--surface-raised)] transition-colors shrink-0'
const heading = 'text-text-primary text-sm font-semibold mb-2'

export default function VstPluginSettings(): JSX.Element {
  const { list, scanning } = useVstPlugins(true)
  const [query, setQuery] = useState('')
  const [onlyHidden, setOnlyHidden] = useState(false)
  const plugins = list?.plugins ?? []
  const hidden = plugins.filter((p) => p.hidden)
  const q = query.trim().toLowerCase()
  const shown = plugins.filter((p) => (!onlyHidden || p.hidden) && (!q || `${p.name} ${p.vendor} ${p.sub}`.toLowerCase().includes(q)))

  return (
    <div>
      <h3 className="text-text-primary text-lg font-bold mb-1">Plug-ins</h3>
      <p className="text-text-muted text-xs mb-4">
        VST3 effects for the Session Maker's lanes. Install or uninstall them with their own installers, then rescan. Hidden plug-ins stay working on lanes that already have them.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-1">
        <button className={btn} disabled={scanning} onClick={() => void vstPlugins.rescan()}>
          {scanning ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {scanning ? 'Scanning…' : 'Rescan'}
        </button>
        <button className={btn} onClick={() => void vstPlugins.addFolder()}>
          <FolderPlus size={13} /> Add folder
        </button>
      </div>
      <p className="text-text-muted text-[10px] mb-5">
        {list?.scannedAt ? `Last scanned ${new Date(list.scannedAt).toLocaleString()} · ` : ''}
        {plugins.length} plug-in{plugins.length === 1 ? '' : 's'}{hidden.length ? ` · ${hidden.length} hidden` : ''}
      </p>

      <div className={heading}>Folders</div>
      <div className="space-y-1.5 mb-5">
        {(list?.standardFolders ?? []).map((f) => (
          <div key={f} className={row}>
            <FolderOpen size={13} className="text-text-muted shrink-0" />
            <span className="flex-1 min-w-0 text-text-primary text-xs truncate" title={f}>{f}</span>
            <span className="text-[10px] text-text-muted shrink-0">Standard</span>
            <button className={iconBtn} title="Open in Explorer" onClick={() => vstPlugins.openFolder(f)}><FolderOpen size={13} /></button>
          </div>
        ))}
        {(list?.folders ?? []).map((f) => (
          <div key={f} className={row}>
            <FolderOpen size={13} className="text-text-muted shrink-0" />
            <span className="flex-1 min-w-0 text-text-primary text-xs truncate" title={f}>{f}</span>
            <button className={iconBtn} title="Open in Explorer" onClick={() => vstPlugins.openFolder(f)}><FolderOpen size={13} /></button>
            <button className={`${iconBtn} hover:!text-red-400`} title="Stop looking in this folder" onClick={() => void vstPlugins.removeFolder(f)}><X size={13} /></button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 mb-2">
        <div className={heading.replace('mb-2', '')}>Installed</div>
        {!!hidden.length && (
          <div className="flex items-center gap-2">
            <button className="text-[11px] text-text-muted hover:text-text-primary" onClick={() => setOnlyHidden((v) => !v)}>
              {onlyHidden ? 'Show all' : `Only hidden (${hidden.length})`}
            </button>
            <button className="text-[11px] text-accent hover:underline" onClick={() => void vstPlugins.setHidden(hidden.map(vstPluginKey), false)}>
              Unhide all
            </button>
          </div>
        )}
      </div>
      {plugins.length > 6 && (
        <div className="relative mb-2">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, maker or type"
            className="w-full h-8 pl-8 pr-3 rounded-lg bg-[var(--surface-overlay)] border border-[var(--border)] text-xs text-text-primary outline-none focus:border-accent/60"
          />
        </div>
      )}
      <div className="space-y-1.5 mb-5">
        {!list && <p className="text-text-muted text-xs flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Looking for plug-ins…</p>}
        {list && !plugins.length && <p className="text-text-muted text-xs">No VST3 effects found. Install some, or add the folder they're in.</p>}
        {list && !!plugins.length && !shown.length && <p className="text-text-muted text-xs">No match.</p>}
        {shown.map((p) => (
          <div key={vstPluginKey(p)} className={`${row} ${p.hidden ? 'opacity-55' : ''}`}>
            <div className="flex-1 min-w-0">
              <div className="text-text-primary text-xs font-medium truncate">{p.name}</div>
              <div className="text-text-muted text-[10px] truncate" title={p.path}>
                {[p.vendor, p.version, p.sub.split('|').filter((x) => x && x !== 'Fx').join(', ')].filter(Boolean).join(' · ')}
              </div>
            </div>
            <button className={iconBtn} title="Show the file in Explorer" onClick={() => vstPlugins.showModule(p.path)}><FolderOpen size={13} /></button>
            <button
              className={`${iconBtn} ${p.hidden ? '' : '!text-accent'}`}
              title={p.hidden ? 'Hidden from the Session Maker - click to show it again' : 'Shown in the Session Maker - click to hide it'}
              onClick={() => void vstPlugins.setHidden([vstPluginKey(p)], !p.hidden)}
            >
              {p.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        ))}
      </div>

      {!!list?.failed.length && (
        <>
          <div className={heading}>Couldn't be loaded</div>
          <p className="text-text-muted text-[11px] mb-2">Often a 32-bit plug-in, a missing licence or a broken install. Rescan after fixing it.</p>
          <div className="space-y-1.5">
            {list.failed.map((f) => (
              <div key={f.path} className={row}>
                <AlertTriangle size={13} className="text-amber-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-text-primary text-xs truncate" title={f.path}>{f.path.split(/[\\/]/).pop()}</div>
                  <div className="text-text-muted text-[10px] truncate" title={f.error}>{f.error}</div>
                </div>
                <button className={iconBtn} title="Show the file in Explorer" onClick={() => vstPlugins.showModule(f.path)}><FolderOpen size={13} /></button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
