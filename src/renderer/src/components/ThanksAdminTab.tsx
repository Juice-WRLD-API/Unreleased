import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Loader2, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import {
  getThanksAdmin, resetThanksPage, saveThanksPage, THANKS_DEFAULT, THANKS_ICONS,
  type ThanksAdminPayload, type ThanksIcon, type ThanksPageContent,
} from '../lib/thanksApi'
import { errorMessage } from '../lib/format'
import { showAppToast } from '../lib/appToast'
import { relativeTime } from './adminShared'
import ThemedSelect from './ThemedSelect'

// Admin tab for the Thank you page. Saving replaces the whole page on the
// server; every player picks it up the next time the page opens. Reset deletes
// the server copy, so players fall back to the page they ship with. Names are
// one per line.

const field = 'w-full h-8 rounded-lg bg-surface-raised border border-[var(--border)] px-3 text-xs text-text-primary outline-none focus:border-accent'
const area = 'w-full rounded-lg bg-surface-raised border border-[var(--border)] px-3 py-2 text-xs text-text-primary outline-none focus:border-accent resize-y'
const button = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50'

const ICON_OPTIONS = THANKS_ICONS.map((icon) => ({ value: icon, label: icon ? icon[0].toUpperCase() + icon.slice(1) : 'No icon' }))

interface DraftSection { title: string; icon: ThanksIcon; names: string }
interface Draft { title: string; intro: string; footnote: string; sections: DraftSection[] }

function toDraft(content: ThanksPageContent): Draft {
  return { ...content, sections: content.sections.map((s) => ({ title: s.title, icon: s.icon, names: s.names.join('\n') })) }
}

function fromDraft(draft: Draft): ThanksPageContent {
  return {
    title: draft.title.trim(),
    intro: draft.intro.trim(),
    footnote: draft.footnote.trim(),
    sections: draft.sections.map((s) => ({
      title: s.title.trim(), icon: s.icon, names: s.names.split('\n').map((n) => n.trim()).filter(Boolean),
    })),
  }
}

export default function ThanksAdminTab(): JSX.Element {
  const [meta, setMeta] = useState<ThanksAdminPayload | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null)

  const load = (payload: ThanksAdminPayload): void => {
    setMeta(payload)
    // Nothing saved yet: start from the built-in page, so the first save copies it over.
    setDraft(toDraft(payload.configured ? payload : THANKS_DEFAULT))
  }

  useEffect(() => {
    const ctrl = new AbortController()
    getThanksAdmin(ctrl.signal).then(load).catch((e) => { if (!ctrl.signal.aborted) setError(errorMessage(e, 'Could not load the Thank you page.')) })
    return () => ctrl.abort()
  }, [])

  const patch = (next: Partial<Draft>): void => setDraft((d) => (d ? { ...d, ...next } : d))
  const patchSection = (i: number, next: Partial<DraftSection>): void =>
    setDraft((d) => (d ? { ...d, sections: d.sections.map((s, j) => (j === i ? { ...s, ...next } : s)) } : d))
  const moveSection = (i: number, by: number): void => setDraft((d) => {
    if (!d) return d
    const j = i + by
    if (j < 0 || j >= d.sections.length) return d
    const sections = [...d.sections]
    ;[sections[i], sections[j]] = [sections[j], sections[i]]
    return { ...d, sections }
  })

  const save = async (): Promise<void> => {
    if (!draft) return
    setBusy('save')
    try {
      load(await saveThanksPage(fromDraft(draft)))
      showAppToast('Thank you page saved')
    } catch (e) {
      showAppToast(`Couldn't save: ${errorMessage(e, 'request failed')}`, { tone: 'error' })
    } finally { setBusy(null) }
  }

  const reset = async (): Promise<void> => {
    if (!window.confirm('Remove the saved page? Players go back to the built-in Thank you page.')) return
    setBusy('reset')
    try {
      load(await resetThanksPage())
      showAppToast('Thank you page reset to built-in')
    } catch (e) {
      showAppToast(`Couldn't reset: ${errorMessage(e, 'request failed')}`, { tone: 'error' })
    } finally { setBusy(null) }
  }

  if (error) return <div className="p-6 text-xs text-red-400">{error}</div>
  if (!draft || !meta) return <div className="p-6 flex justify-center"><Loader2 size={16} className="animate-spin text-text-muted" /></div>

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-xs text-text-muted flex-1 min-w-0">
            {meta.configured
              ? <>Live on every player{meta.updated_by ? <> · last saved by {meta.updated_by}</> : null}{meta.updated_at ? <> {relativeTime(meta.updated_at)}</> : null}</>
              : 'Not saved yet: players show the built-in page below. Save to take it over.'}
          </p>
          {meta.configured && (
            <button onClick={reset} disabled={!!busy} className={`${button} text-text-secondary hover:text-text-primary hover:bg-surface-overlay`}>
              {busy === 'reset' ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Reset to built-in
            </button>
          )}
          <button onClick={save} disabled={!!busy} className={`${button} bg-accent text-white hover:opacity-90`}>
            {busy === 'save' ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save
          </button>
        </div>

        <label className="block">
          <span className="block text-[11px] font-semibold text-text-muted mb-1">Heading</span>
          <input value={draft.title} onChange={(e) => patch({ title: e.target.value })} maxLength={80} placeholder={THANKS_DEFAULT.title} className={field} />
        </label>
        <label className="block">
          <span className="block text-[11px] font-semibold text-text-muted mb-1">Intro</span>
          <textarea value={draft.intro} onChange={(e) => patch({ intro: e.target.value })} maxLength={2000} rows={3} placeholder={THANKS_DEFAULT.intro} className={area} />
        </label>
        <label className="block">
          <span className="block text-[11px] font-semibold text-text-muted mb-1">Note under the first list</span>
          <input value={draft.footnote} onChange={(e) => patch({ footnote: e.target.value })} maxLength={500} placeholder={THANKS_DEFAULT.footnote} className={field} />
        </label>

        {draft.sections.map((section, i) => (
          <div key={i} className="rounded-xl border border-[var(--border)] p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input value={section.title} onChange={(e) => patchSection(i, { title: e.target.value })} maxLength={80} placeholder="Section title" className={`${field} flex-1`} />
              <ThemedSelect value={section.icon} onChange={(v) => patchSection(i, { icon: v as ThanksIcon })} options={ICON_OPTIONS}
                className="h-8 w-28 rounded-lg bg-surface-raised border border-[var(--border)] px-2 text-xs" />
              <button onClick={() => moveSection(i, -1)} disabled={i === 0} title="Move up" className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay disabled:opacity-30"><ArrowUp size={13} /></button>
              <button onClick={() => moveSection(i, 1)} disabled={i === draft.sections.length - 1} title="Move down" className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay disabled:opacity-30"><ArrowDown size={13} /></button>
              <button onClick={() => patch({ sections: draft.sections.filter((_, j) => j !== i) })} title="Remove section" className="p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-surface-overlay"><Trash2 size={13} /></button>
            </div>
            <textarea value={section.names} onChange={(e) => patchSection(i, { names: e.target.value })} rows={Math.min(10, Math.max(3, section.names.split('\n').length + 1))}
              placeholder="One name per line" className={`${area} font-mono`} />
          </div>
        ))}

        <button onClick={() => patch({ sections: [...draft.sections, { title: '', icon: '', names: '' }] })} disabled={draft.sections.length >= 20}
          className={`${button} text-text-secondary hover:text-text-primary hover:bg-surface-overlay border border-dashed border-[var(--border)]`}>
          <Plus size={12} /> Add section
        </button>
      </div>
    </div>
  )
}
