// How big the desktop's things may be on a display. They are designed for a 1440 × 900 screen; on a smaller one - a
// 1366 × 768 laptop, a 125% or 150% scaled one - everything shrinks with it, so the player, the playlist, the clock and
// the light's rim keep their share of the screen. Never larger.
const { screen } = require('electron')

/** @param {{ workArea: { width: number, height: number } }} display */
function fitOf(display) {
  const area = display.workArea
  return Math.min(1, Math.max(0.55, Math.min(area.width / 1440, area.height / 900)))
}

/** The fit of the display a rectangle mostly lies on, or the main display's. */
function fitAt(bounds) {
  return fitOf(bounds ? screen.getDisplayMatching(bounds) : screen.getPrimaryDisplay())
}

module.exports = { fitOf, fitAt }
