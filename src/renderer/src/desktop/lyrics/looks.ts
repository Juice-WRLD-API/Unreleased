// The lyric styles to choose from, as the lights are, each with the face it's set in until another is picked for
// it: every style keeps its own. "classic" is the app's own scrolling list, outside the iJWA styles.

export interface LyricLook { id: string; title: string; face: string }

export const LYRIC_LOOKS: LyricLook[] = [
  { id: 'fisheye', title: 'Fisheye', face: 'Georgia' },
  { id: 'spread', title: 'Spread', face: 'Georgia' },
  { id: 'karaoke', title: 'Karaoke', face: 'Segoe' },
  { id: 'typewriter', title: 'Typewriter', face: 'Courier' },
  { id: 'neon', title: 'Neon', face: 'BahnschriftWide' },
  { id: 'echo', title: 'Echo', face: 'Franklin' },
  { id: 'glitch', title: 'Glitch', face: 'ArialBlack' },
  { id: 'cinema', title: 'Cinema', face: 'PalatinoItalic' },
]

export const lyricLookOf = (id: string | undefined): LyricLook => LYRIC_LOOKS.find((l) => l.id === id) || LYRIC_LOOKS[0]

/** The face of `look`: the one picked for it, else its own. */
export function lyricFontFor(fonts: Record<string, string> | undefined, look: string): string {
  return fonts?.[look] || lyricLookOf(look).face
}

/** The faces the lyrics can be set in, from the fonts every Windows PC comes with. Elsewhere each falls back to the
 *  nearest generic family. */
export const FACES = [
  { key: 'Georgia', name: 'Georgia', css: '900 {size}px Georgia, serif' },
  { key: 'Sitka', name: 'Sitka', css: '700 {size}px "Sitka Banner", "Sitka Heading", Georgia, serif' },
  { key: 'Cambria', name: 'Cambria', css: '700 {size}px Cambria, Georgia, serif' },
  { key: 'Palatino', name: 'Palatino', css: '700 {size}px "Palatino Linotype", Palatino, Georgia, serif' },
  { key: 'PalatinoItalic', name: 'Palatino Italic', css: 'italic 400 {size}px "Palatino Linotype", Palatino, Georgia, serif' },
  { key: 'Constantia', name: 'Constantia', css: '700 {size}px Constantia, Georgia, serif' },
  { key: 'Segoe', name: 'Segoe UI', css: '700 {size}px "Segoe UI", sans-serif' },
  { key: 'BahnschriftWide', name: 'Bahnschrift', css: '600 {size}px Bahnschrift, "Segoe UI", sans-serif' },
  { key: 'Impact', name: 'Impact', css: '400 {size}px Impact, "Arial Black", sans-serif' },
  { key: 'ArialBlack', name: 'Arial Black', css: '900 {size}px "Arial Black", Arial, sans-serif' },
  { key: 'Bahnschrift', name: 'Bahnschrift Condensed', css: '700 condensed {size}px Bahnschrift, "Arial Narrow", sans-serif' },
  { key: 'SegoeBlack', name: 'Segoe Black', css: '900 {size}px "Segoe UI Black", "Segoe UI", sans-serif' },
  { key: 'Franklin', name: 'Franklin Gothic', css: '400 {size}px "Franklin Gothic Medium", "Arial Narrow", sans-serif' },
  { key: 'Courier', name: 'Courier', css: '700 {size}px "Courier New", monospace' },
  { key: 'Consolas', name: 'Consolas', css: '700 {size}px Consolas, monospace' },
  { key: 'InkFree', name: 'Ink Free', css: '400 {size}px "Ink Free", "Segoe Print", cursive' },
  { key: 'SegoePrint', name: 'Segoe Print', css: '700 {size}px "Segoe Print", cursive' },
  { key: 'SegoeScript', name: 'Segoe Script', css: '700 {size}px "Segoe Script", cursive' },
  { key: 'Gabriola', name: 'Gabriola', css: '400 {size}px Gabriola, serif' },
]
export const STANDARD_FACE = 'Georgia'

export const faceCSS = (key: string, size: number): string =>
  (FACES.find((f) => f.key === key) || FACES[0]).css.replace('{size}', size.toFixed(2))
