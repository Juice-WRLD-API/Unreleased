// Told the wallpaper and to close or open: closing, the curtain comes in; opening, it goes - and says so, for its
// window to go too.
import './base.css'
import './curtain.css'
import { page } from './page'

const curtain = document.createElement('div')
curtain.id = 'curtain'
const picture = document.createElement('img')
picture.alt = ''
curtain.appendChild(picture)
document.body.appendChild(curtain)

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))
let turn = 0

page.on('desktop:curtain-close', async ({ picture: url }) => {
  const mine = ++turn
  if (url) { picture.src = url; await picture.decode().catch(() => {}) }
  if (mine !== turn) return
  curtain.classList.add('shown')
})

page.on('desktop:curtain-open', async () => {
  const mine = ++turn
  curtain.classList.remove('shown')
  await wait(700)
  if (mine !== turn) return
  page.curtainOpened()
})
