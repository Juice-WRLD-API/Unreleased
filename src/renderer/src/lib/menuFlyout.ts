/**
 * Places a context-menu submenu beside its parent menu, level with the row that
 * opened it, flipping to the menu's left when it would run off the right edge
 * and clamping to the viewport (a submenu can be far taller than its row).
 *
 * Shared by every flyout in SongContextMenu - "Add to playlist", "File actions"
 * and "Change version" - so they all sit and flip identically.
 */
export function placeFlyout(item: HTMLElement, menu: HTMLElement, sub: HTMLElement): { top: number; left: number } {
  const ir = item.getBoundingClientRect()
  const mr = menu.getBoundingClientRect()
  const sr = sub.getBoundingClientRect()
  let left = mr.right + 4
  if (left + sr.width > window.innerWidth - 8) left = mr.left - sr.width - 4
  return {
    left: Math.max(8, left),
    top: Math.max(8, Math.min(ir.top - 4, window.innerHeight - sr.height - 8)),
  }
}
