import { useEffect } from 'react'
import { ModalOverlay, LockToggle } from './Modal'
import { X, Download, Copy, Trash2, Moon, Sun, Check, RotateCcw } from 'lucide-react'
import { useStorePick } from '../store/useStore'
import {
  SKIN_VAR_META, SKIN_OPTIONAL_VAR_META, createCustomSkin, skinToFileText, skinFileName,
  type Skin, type SkinVars,
} from '../lib/skins'

// Downloads `text` as a file named `name` (renderer-side blob download - the
// user's own generated skin, no server round-trip).
function downloadText(text: string, name: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick so the click's navigation has grabbed the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

// Reflects a possibly-rgba/keyword value back to a hex the native color input
// can show. Falls back to a neutral gray for values it can't parse (rgba/hsl),
// where the paired text field stays the source of truth.
function toColorInputValue(value: string): string {
  const v = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v
  if (/^#[0-9a-fA-F]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
  return '#808080'
}

/**
 * The custom-skin editor. Edits happen against the live store skin (looked up
 * by id) and every change saves through `saveCustomSkin` - because the caller
 * makes this skin the active theme before opening, that gives a true live
 * preview of the whole app behind the modal.
 */
export default function SkinEditorModal({
  skinId,
  onClose,
  onEditSkin,
}: {
  skinId: string
  onClose: () => void
  // Retarget the editor at another skin (used by Duplicate) - owned by the
  // caller so the open/edit state stays local to its window.
  onEditSkin: (id: string) => void
}): JSX.Element | null {
  const { customSkins, saveCustomSkin, deleteCustomSkin, setTheme } = useStorePick(
    'customSkins', 'saveCustomSkin', 'deleteCustomSkin', 'setTheme',
  )
  const skin = customSkins.find((s) => s.id === skinId) ?? null

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // The skin vanished from under us (deleted in another window) - bail out.
  if (!skin) return null

  const patch = (updates: Partial<Skin>): void => saveCustomSkin({ ...skin, ...updates })
  const setVar = (key: keyof SkinVars, value: string): void =>
    patch({ vars: { ...skin.vars, [key]: value } })
  // Optional vars: an empty value removes the key so it inherits again.
  const setOptionalVar = (key: keyof SkinVars, value: string): void => {
    const vars = { ...skin.vars }
    if (value) vars[key] = value
    else delete vars[key]
    patch({ vars })
  }

  const handleDelete = (): void => {
    deleteCustomSkin(skin.id)
    onClose()
  }
  const handleDuplicate = (): void => {
    const copy = createCustomSkin(skin, `${skin.name} copy`)
    saveCustomSkin(copy)
    setTheme(copy.id)
    // Keep editing - retarget the editor at the fresh copy (now the active skin).
    onEditSkin(copy.id)
  }

  return (
    <ModalOverlay
      onClose={onClose}
      zIndexClassName="z-[60]"
      panelClassName="rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl w-full max-w-lg max-h-[85vh]"
      minWidth={420} minHeight={420}
    >
      {({ onHandleMouseDown, locked, toggleLock, canLock }) => (
      <div className="w-full h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)] bg-[var(--surface-raised)] cursor-grab active:cursor-grabbing"
          onMouseDown={onHandleMouseDown}
        >
          <input
            value={skin.name}
            onChange={(e) => patch({ name: e.target.value.slice(0, 40) })}
            placeholder="Skin name"
            className="flex-1 min-w-0 bg-transparent text-text-primary text-base font-semibold outline-none placeholder:text-text-muted"
          />
          {canLock && (
            <LockToggle
              locked={locked}
              onClick={toggleLock}
              className={`w-6 h-6 flex items-center justify-center rounded-lg transition-colors ${
                locked ? 'text-accent' : 'text-text-muted hover:text-text-primary hover:bg-[var(--surface-overlay)]'
              }`}
            />
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-[var(--surface-overlay)] transition-colors"
            title="Done"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
          {/* Base mode */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-text-secondary text-xs mr-1">Base mode</span>
            <button
              onClick={() => patch({ dark: false })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                !skin.dark ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary hover:bg-[var(--surface-overlay)]'
              }`}
            >
              <Sun size={13} /> Light
            </button>
            <button
              onClick={() => patch({ dark: true })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                skin.dark ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary hover:bg-[var(--surface-overlay)]'
              }`}
            >
              <Moon size={13} /> Dark
            </button>
            <span className="text-text-muted text-[11px] ml-1">Drives native controls &amp; scrollbars</span>
          </div>

          {/* Accent */}
          <div className="flex items-center gap-3 py-2 border-b border-[var(--border)] mb-2">
            <div className="flex-1 min-w-0">
              <p className="text-text-primary text-sm">Accent color</p>
              <p className="text-text-muted text-[11px]">Buttons, highlights, the active state</p>
            </div>
            <input
              type="color"
              value={toColorInputValue(skin.accent ?? '#1db954')}
              onChange={(e) => patch({ accent: e.target.value })}
              className="w-8 h-8 rounded-md cursor-pointer border-0 p-0 bg-transparent shrink-0"
              title="Accent color"
            />
            <input
              value={skin.accent ?? ''}
              onChange={(e) => patch({ accent: e.target.value || undefined })}
              placeholder="inherit"
              className="w-28 bg-[var(--surface-overlay)] rounded-md px-2 py-1.5 text-text-primary text-xs font-mono outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          {/* Palette variables */}
          {SKIN_VAR_META.map(({ key, label, hint }) => (
            <div key={key} className="flex items-center gap-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-text-primary text-sm truncate">{label}</p>
                <p className="text-text-muted text-[11px] truncate">{hint}</p>
              </div>
              <input
                type="color"
                value={toColorInputValue(skin.vars[key] ?? '')}
                onChange={(e) => setVar(key, e.target.value)}
                className="w-8 h-8 rounded-md cursor-pointer border-0 p-0 bg-transparent shrink-0"
                title={`Pick ${label}`}
              />
              <input
                value={skin.vars[key] ?? ''}
                onChange={(e) => setVar(key, e.target.value)}
                className="w-28 bg-[var(--surface-overlay)] rounded-md px-2 py-1.5 text-text-primary text-xs font-mono outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          ))}

          {/* Advanced - optional overrides that inherit when left blank. */}
          <div className="mt-3 pt-3 border-t border-[var(--border)]">
            <p className="text-text-secondary text-[11px] font-semibold uppercase tracking-wide mb-1">Advanced</p>
            {SKIN_OPTIONAL_VAR_META.map(({ key, label, hint }) => {
              const value = skin.vars[key]
              return (
                <div key={key} className="flex items-center gap-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-text-primary text-sm truncate">{label}</p>
                    <p className="text-text-muted text-[11px] truncate">{hint}</p>
                  </div>
                  {value && (
                    <button
                      onClick={() => setOptionalVar(key, '')}
                      className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-[var(--surface-overlay)] transition-colors shrink-0"
                      title="Reset to inherit"
                    >
                      <RotateCcw size={13} />
                    </button>
                  )}
                  <input
                    type="color"
                    value={toColorInputValue(value ?? '#808080')}
                    onChange={(e) => setOptionalVar(key, e.target.value)}
                    className="w-8 h-8 rounded-md cursor-pointer border-0 p-0 bg-transparent shrink-0"
                    title={`Pick ${label}`}
                  />
                  <input
                    value={value ?? ''}
                    onChange={(e) => setOptionalVar(key, e.target.value)}
                    placeholder="inherits"
                    className="w-28 bg-[var(--surface-overlay)] rounded-md px-2 py-1.5 text-text-primary text-xs font-mono outline-none focus:ring-1 focus:ring-accent placeholder:text-text-muted"
                  />
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-[var(--border)] bg-[var(--surface-raised)]">
          <button
            onClick={() => downloadText(skinToFileText(skin), skinFileName(skin))}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-[var(--surface-overlay)] transition-colors"
          >
            <Download size={14} /> Export
          </button>
          <button
            onClick={handleDuplicate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-[var(--surface-overlay)] transition-colors"
          >
            <Copy size={14} /> Duplicate
          </button>
          <button
            onClick={handleDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 size={14} /> Delete
          </button>
          <button
            onClick={onClose}
            className="ml-auto flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            <Check size={14} /> Done
          </button>
        </div>
      </div>
      )}
    </ModalOverlay>
  )
}
