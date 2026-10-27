// Moving a desktop window by its empty space: the window follows the pointer until the page says the button was let
// go. Should that word never come (the press lost on its way), the drag stops by itself once the pointer has rested a
// moment, so a window can never stay stuck to the pointer and swallow every click.
const { screen } = require('electron')

// When a window last moved with the pointer: it hears no moves then, the pointer standing still on it.
let moving = 0
let movedAt = 0
const isMoving = () => moving > 0 || Date.now() - movedAt < 1500

function follow(window, onEnd) {
  const cursor = screen.getCursorScreenPoint()
  const [x, y] = window.getPosition()
  // Its size, held: at a display scale like 125% Windows rounds every move, and a window moved by its position alone
  // grows a little each time.
  const [width, height] = window.getSize()
  const offset = { dx: cursor.x - x, dy: cursor.y - y }
  let last = cursor, still = 0
  moving += 1
  let ended = false
  const finish = () => { if (!ended) { ended = true; moving -= 1; movedAt = Date.now() } }
  const drag = {
    timer: null,
    end: () => {
      clearInterval(drag.timer)
      finish()
      onEnd()
    },
  }
  drag.timer = setInterval(() => {
    if (window.isDestroyed()) { clearInterval(drag.timer); finish(); return }
    const c = screen.getCursorScreenPoint()
    still = c.x === last.x && c.y === last.y ? still + 1 : 0
    last = c
    if (still === 0) window.setBounds({ x: Math.round(c.x - offset.dx), y: Math.round(c.y - offset.dy), width, height })
    if (still > 250) drag.end() // two seconds without a move: the release was missed
  }, 8)
  return drag
}

module.exports = { follow, isMoving }
