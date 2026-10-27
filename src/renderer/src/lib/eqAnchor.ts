// Button the Equalizer popover should anchor to. Set by whichever on-screen
// button is about to open it (Player bar, WRLD tab, a widget in the WRLD tab);
// consumed once by Player when the panel opens, so hotkey opens don't reuse a
// stale element.

/** An element, or a place standing in for one (a widget's button, inside its frame). */
export type EqAnchor = Pick<HTMLElement, 'getBoundingClientRect' | 'isConnected'>

let anchor: EqAnchor | null = null

export function setEqAnchor(el: EqAnchor | null): void {
  anchor = el
}

export function takeEqAnchor(): EqAnchor | null {
  const el = anchor
  anchor = null
  return el
}
