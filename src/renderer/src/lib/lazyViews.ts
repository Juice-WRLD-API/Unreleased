import type { ViewType } from '../types'

// The web build code-splits every view and warms a view's chunk when the nav is
// hovered. The desktop app ships its views in the main bundle off local disk, so
// there is nothing to warm - kept as a no-op so shared call sites (Sidebar, the
// tracker's search shortcut) stay identical across branches.
export function preloadView(_view: ViewType): void {}
