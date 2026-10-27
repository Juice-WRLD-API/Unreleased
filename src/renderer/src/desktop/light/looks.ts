// The lights to choose from, in iJWA's order (the shaders' LOOK_ numbers follow it): each one's name, its GLSL
// function (looks-glsl.ts), how far in it reaches at most in thicknesses, and what it needs.

export interface Look {
  id: string
  title: string
  fn: string
  reach: number
  /** Rings out from points on the rim (ripple, lightning, fireworks). */
  drops?: boolean
  /** Carries the lyric being sung (the ticker). */
  words?: boolean
}

export const LOOKS: Look[] = [
  { id: 'snake', title: 'Snake', fn: 'rimFragment', reach: 1.28 },
  { id: 'twin', title: 'Twin', fn: 'rimFragment', reach: 1.28 },
  { id: 'lava', title: 'Lava', fn: 'lavaFragment', reach: 2.0 },
  { id: 'fireflies', title: 'Fireflies', fn: 'firefliesFragment', reach: 1.6 },
  { id: 'ripple', title: 'Ripple', fn: 'rippleFragment', reach: 1.5, drops: true },
  { id: 'breath', title: 'Breath', fn: 'breathFragment', reach: 1.4 },
  { id: 'led', title: 'LED Strip', fn: 'ledFragment', reach: 1.3 },
  { id: 'ticker', title: 'Lyrics Ticker', fn: 'tickerFragment', reach: 1.6, words: true },
  { id: 'leaks', title: 'Light Leaks', fn: 'leaksFragment', reach: 4.5 },
  { id: 'smoke', title: 'Smoke', fn: 'smokeFragment', reach: 4.0 },
  { id: 'hearts', title: 'Hearts', fn: 'heartsFragment', reach: 3.6 },
  { id: 'bubbles', title: 'Bubbles', fn: 'bubblesFragment', reach: 3.6 },
  { id: 'stars', title: 'Stars', fn: 'starsFragment', reach: 3.6 },
  { id: 'confetti', title: 'Confetti', fn: 'confettiFragment', reach: 3.6 },
  { id: 'notes', title: 'Music Notes', fn: 'notesFragment', reach: 3.6 },
  { id: 'petals', title: 'Petals', fn: 'petalsFragment', reach: 3.6 },
  { id: 'butterflies', title: 'Butterflies', fn: 'butterfliesFragment', reach: 3.6 },
  { id: 'snow', title: 'Snow', fn: 'snowFragment', reach: 5.0 },
  { id: 'fire', title: 'Fire', fn: 'fireFragment', reach: 4.0 },
  { id: 'lightning', title: 'Lightning', fn: 'lightningFragment', reach: 2.0, drops: true },
  { id: 'fireworks', title: 'Fireworks', fn: 'fireworksFragment', reach: 4.5, drops: true },
  { id: 'rain', title: 'Rain', fn: 'rainFragment', reach: 2.2 },
]

/** Where round the screen the light shows. */
export const PLACES = [
  { id: 'all', title: 'Everywhere' },
  { id: 'bottom', title: 'Bottom' },
  { id: 'top', title: 'Top' },
  { id: 'corners', title: 'Corners' },
] as const

export type PlaceId = (typeof PLACES)[number]['id']

export function lookOf(id: string): Look & { number: number } {
  const index = Math.max(LOOKS.findIndex((l) => l.id === id), 0)
  return { ...LOOKS[index], number: index }
}

export const placeNumber = (id: string): number => Math.max(PLACES.findIndex((p) => p.id === id), 0)

/** The ticker's strip of words, in points tall, from the thickness slider. */
export const tickerHeight = (thickness: number): number => 20 + thickness * 22
