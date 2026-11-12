// Class names for view toolbars that sit straight on the ambient backdrop:
// a glass search field and round glass icon buttons (index.css "Glass
// chrome": .glass-field). The segmented control is GlassSegmented.tsx.
// Not for dialogs or controls inside a .glass-pane: the veil is see-through
// and only reads over the backdrop.

/** The search <input>. Pad for the icon and clear button yourself
 *  (`pl-9 pr-9` by default); its wrapper should be `relative rounded-full
 *  glass-specular`, since an input has no ::after for the lit edge. */
export const GLASS_SEARCH = 'glass-field w-full h-10 md:h-9 rounded-full text-sm text-text-primary placeholder:text-text-muted'

/** Wrapper for GLASS_SEARCH: positions the icon and carries the edge. */
export const GLASS_SEARCH_WRAP = 'relative rounded-full glass-specular'

/** Round icon button; `on` tints it with the accent. Fits
 *  SearchHelpButton's `className={(open) => …}` as is. */
export function glassToolButton(on: boolean): string {
  return `glass-field glass-specular relative shrink-0 flex items-center justify-center w-10 h-10 md:w-9 md:h-9 rounded-full focus-visible:outline-none disabled:opacity-40 disabled:pointer-events-none ${
    on ? 'is-on' : 'text-text-secondary hover:text-text-primary'
  }`
}

/** Pill button with an icon and a label, same height as the others. */
export function glassPillButton(on: boolean): string {
  return `glass-field glass-specular relative shrink-0 flex items-center gap-1.5 h-10 md:h-9 px-3.5 rounded-full text-xs font-medium focus-visible:outline-none disabled:opacity-40 disabled:pointer-events-none ${
    on ? 'is-on' : 'text-text-secondary hover:text-text-primary'
  }`
}
