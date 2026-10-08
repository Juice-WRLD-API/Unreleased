// Button the Equalizer popover should anchor to. Set by whichever on-screen
// button is about to open it (Player bar, WRLD tab); consumed once by Player
// when the panel opens, so hotkey opens don't reuse a stale element.
let anchor: HTMLElement | null = null

export function setEqAnchor(el: HTMLElement | null): void {
  anchor = el
}

export function takeEqAnchor(): HTMLElement | null {
  const el = anchor
  anchor = null
  return el
}
