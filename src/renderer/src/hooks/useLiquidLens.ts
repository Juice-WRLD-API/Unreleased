import { useEffect, type RefObject } from 'react'
import { useStore } from '../store/useStore'
import { LENS_SUPPORTED, removeLens, setLens, type LensOptions } from '../lib/liquidLens'

/** Puts a liquid glass lens on a `.glass-backdrop` pane (lib/liquidLens).
 *  Watches only this element's size and rebuilds the map once it settles, so
 *  nothing runs while the pane holds still. Off when the setting is off, on
 *  browsers that can't draw it, and while the pane has no size. */
export function useLiquidLens(ref: RefObject<HTMLElement | null>, id: string, opts: LensOptions, active = true): void {
  // `active` is for a pane that comes and goes while its owner stays mounted
  // (the nav is only a pill in one nav style), so the effect finds the node.
  const enabled = useStore((s) => s.glassRefraction) && LENS_SUPPORTED && active
  const { bezel, strength, coreBlur, rimBlur } = opts
  useEffect(() => {
    const node = ref.current
    if (!enabled || !node) return
    let key = ''
    let timer = 0
    const build = () => {
      timer = 0
      const w = node.offsetWidth
      const h = node.offsetHeight
      if (!w || !h) {
        node.removeAttribute('data-lens')
        key = ''
        return
      }
      const radius = Math.min(parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0, w / 2, h / 2)
      // Small size changes only stretch the map a little; rebuild past 4px.
      const next = [Math.round(w / 4), Math.round(h / 4), Math.round(radius)].join(':')
      if (next === key) return
      key = next
      setLens(id, { width: w, height: h, radius }, { bezel, strength, coreBlur, rimBlur })
      node.style.setProperty('--lens-filter', `url("#${id}")`)
      node.setAttribute('data-lens', '')
    }
    const ro = new ResizeObserver(() => {
      // The first size lands at once; a drag-resize waits for the pane to settle.
      if (!key) build()
      else { clearTimeout(timer); timer = window.setTimeout(build, 140) }
    })
    ro.observe(node)
    return () => {
      ro.disconnect()
      clearTimeout(timer)
      node.removeAttribute('data-lens')
      node.style.removeProperty('--lens-filter')
      removeLens(id)
    }
  }, [ref, id, enabled, bezel, strength, coreBlur, rimBlur])
}
