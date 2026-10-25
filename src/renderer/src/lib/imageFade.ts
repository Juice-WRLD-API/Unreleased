/** Images fade in as they finish loading instead of popping in - cover art in
 *  every list, grid, card and page, plus avatars, news and chat images.
 *
 *  One document-level MutationObserver instead of a wrapper component, so it
 *  reaches every <img> in the app (100+ call sites, pop-out windows included)
 *  without touching them. An image that's already loaded when it's inserted -
 *  the memory cache, so revisiting a page or scrolling back over rows - shows
 *  at once as before; only one still loading is held invisible and then faded
 *  in (index.css: img[data-img-fade]). Opacity only, so layout never changes.
 *  Only insertions count: when an existing <img> changes src the browser keeps
 *  the old picture up until the new one is ready, and hiding it would just
 *  add a blink.
 *
 *  `data-no-fade` on an image or any ancestor opts it out (the player's
 *  crossfading cover does its own fade). Off under prefers-reduced-motion. */

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

function settle(e: Event): void {
  const img = e.currentTarget as HTMLImageElement
  img.removeEventListener('load', settle)
  img.removeEventListener('error', settle)
  if (img.dataset.imgFade !== 'pending') return
  // A failed image goes back to showing however the browser shows it.
  if (e.type === 'error') delete img.dataset.imgFade
  else img.dataset.imgFade = 'in'
}

function track(img: HTMLImageElement): void {
  if (img.complete || img.closest('[data-no-fade]')) return
  img.dataset.imgFade = 'pending'
  img.addEventListener('load', settle)
  img.addEventListener('error', settle)
}

export function installImageFade(): void {
  // The observer's callback runs before the next paint, so a loading image
  // never shows half-decoded before being hidden.
  new MutationObserver((records) => {
    if (reducedMotion.matches) return
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (!(node instanceof Element)) continue
        if (node instanceof HTMLImageElement) track(node)
        else for (const img of node.querySelectorAll('img')) track(img)
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true })

  // Drop the marker once faded in, so the rule's `animation` doesn't sit on
  // the image for good (and override an animation of its own).
  document.addEventListener('animationend', (e) => {
    if (e.animationName === 'img-fade-in' && e.target instanceof HTMLImageElement) delete e.target.dataset.imgFade
  })
}
