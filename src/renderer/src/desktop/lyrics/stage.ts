// The lyrics sung in one of the iJWA styles, in a box of the page: the fisheye or a style on LyricScene, made anew
// when the style changes. Used by WRLD's lyrics and by the desktop player.
import './lyrics.css'
import { WordBlock } from './wordblock'
import { SCENES } from './styles'
import { lyricLookOf } from './looks'
import type { LyricRenderer, StageLook, StageSong } from './scene'

export type { StageSong, StageLook, StageClock, LyricTune } from './scene'

export class LyricStage {
  host: HTMLElement
  look = ''
  renderer: LyricRenderer | null = null

  constructor(host: HTMLElement) {
    this.host = host
    host.classList.add('lyric-stage')
  }

  /** The style to sing in; another than the one shown takes its place. */
  use(look: string): void {
    const id = lyricLookOf(look).id
    if (id === this.look && this.renderer) return
    this.renderer?.destroy()
    this.look = id
    const Scene = SCENES[id]
    this.renderer = Scene ? new Scene(this.host) : new WordBlock(this.host)
  }

  show(song: StageSong, look: StageLook): void {
    this.renderer?.show(song, look)
  }

  stop(): void {
    this.renderer?.stop()
  }

  /** The wheel over the lyrics, for a style that scrolls. */
  scrollBy(dy: number): void {
    this.renderer?.scrollBy?.(dy)
  }

  destroy(): void {
    this.renderer?.destroy()
    this.renderer = null
    this.host.classList.remove('lyric-stage')
  }
}
