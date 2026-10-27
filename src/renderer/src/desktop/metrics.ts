// How big the player, the playlist and the clock stand, and where they first stand: the same sums the desktop's windows
// are made by (electron/desktop/widgets.js and fit.js, which can't import this), for the widgets in the WRLD tab.

/** How big the widgets may be in an area designed for a 1440 × 900 screen: smaller with a smaller one, never larger. */
export function fitOf(width: number, height: number): number {
  return Math.min(1, Math.max(0.55, Math.min(width / 1440, height / 900)))
}

export interface WidgetMetrics { s: number; width: number; height: number; edge: number }

/** The player's measurements at the user's size, as its page lays it out (desktop/pages/player.ts). */
export function playerMetrics(size: number, fit = 1): WidgetMetrics {
  const s = (0.8 + 0.45 * size) * fit
  const cardWidth = 232 * s, cardInset = 9 * s, coverSide = cardWidth - 2 * cardInset, captionHeight = 66 * s
  const cardHeight = cardInset + coverSide + captionHeight
  const carouselHeight = cardHeight + 44 * s
  const edge = 40 * s
  const height = edge + carouselHeight + 10 * s + 42 * s + 8 * s + 64 * s + edge
  return { s, width: Math.round(900 * s), height: Math.round(height), edge }
}

/** The playlist's measurements: its list, its header, and a clear margin round them for the turned list to swing in. */
export function playlistMetrics(style: { size: number; rows: number }, fit = 1): WidgetMetrics {
  const s = (0.8 + 0.5 * style.size) * fit
  const width = 300 * s, headerHeight = 66 * s, gap = 8 * s, rowHeight = 50 * s
  const listHeight = style.rows * rowHeight
  const margin = 24
  return { s, edge: margin, width: Math.ceil(width + 2 * margin), height: Math.ceil(headerHeight + gap + listHeight + 2 * margin) }
}

/** Where each first stands: its center, as fractions of the area. */
export const DEFAULT_PLACES = {
  player: (): [number, number] => [0.5, 0.64],
  playlist: (style: { side: 'left' | 'right' }): [number, number] => [style.side === 'right' ? 0.86 : 0.14, 0.5],
  clock: (): [number, number] => [0.5, 0.26],
}
