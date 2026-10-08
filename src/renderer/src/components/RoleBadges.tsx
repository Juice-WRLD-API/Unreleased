// Admin/Manager/Editor/Contributor badge cluster - previously inlined and
// duplicated (with two different Manager colors) in EditorProfileView's
// desktop and mobile files. Consolidated on one consistent color scheme:
// Admin = accent, Manager = amber (matches adminShared.tsx's STATUS_STYLE
// "pending" amber, keeping the semantic distinct from Editor's neutral chip
// and Contributor's sky chip), Editor = neutral surface, Contributor = sky.
//
// Callers pass raw role booleans (not pre-subtracted) - this component owns
// the "don't show Editor/Manager/Contributor once Admin is already shown"
// precedence, matching both platforms' original conditionals.
export interface RoleBadgesProps {
  isAdmin: boolean
  isManager: boolean
  isEditor: boolean
  isContributor: boolean
}

const BADGE = 'px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide shrink-0'

export default function RoleBadges({ isAdmin, isManager, isEditor, isContributor }: RoleBadgesProps): JSX.Element {
  return (
    <>
      {isAdmin && (
        <span className={`${BADGE} bg-accent/15 text-accent`}>Admin</span>
      )}
      {isManager && !isAdmin && (
        <span className={`${BADGE} bg-amber-500/15 text-amber-400`}>Manager</span>
      )}
      {isEditor && !isAdmin && (
        <span className={`${BADGE} bg-surface-overlay text-text-secondary`}>Editor</span>
      )}
      {isContributor && !isAdmin && (
        <span className={`${BADGE} bg-sky-500/15 text-sky-400`}>Contributor</span>
      )}
    </>
  )
}
