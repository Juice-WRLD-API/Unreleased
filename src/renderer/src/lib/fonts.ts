// Selectable font stacks for the app UI and for lyrics.
//
// Every stack is built from fonts that ship with Windows/macOS/Linux (plus the
// already-imported Josefin Sans), so switching fonts never waits on a network
// fetch - this app runs offline and a webfont download would leave text
// swapping mid-session. useThemeEffects writes the chosen stacks onto <html>
// as --font-app / --font-lyrics; Tailwind's `font-sans` resolves to the former
// (see tailwind.config.js), so a change reaches every screen at once.

export interface FontChoice {
  id: string
  name: string
  stack: string
}

// 'system' must stay first - it's the fallback for unknown persisted ids.
export const FONTS: FontChoice[] = [
  {
    id: 'system',
    name: 'System',
    stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  {
    id: 'grotesk',
    name: 'Grotesk',
    stack: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  },
  {
    id: 'humanist',
    name: 'Humanist',
    stack: "'Trebuchet MS', 'Segoe UI', Tahoma, sans-serif",
  },
  {
    id: 'wide',
    name: 'Wide',
    stack: "Verdana, Geneva, 'DejaVu Sans', sans-serif",
  },
  {
    id: 'serif',
    name: 'Serif',
    stack: "Georgia, 'Times New Roman', 'Liberation Serif', serif",
  },
  {
    id: 'mono',
    name: 'Mono',
    stack: "Consolas, Menlo, 'DejaVu Sans Mono', monospace",
  },
  {
    id: 'display',
    name: 'Display',
    stack: "'Josefin Sans', 'Century Gothic', 'Segoe UI', sans-serif",
  },
]

export function getFont(id: string | null | undefined): FontChoice {
  return FONTS.find((f) => f.id === id) ?? FONTS[0]
}
