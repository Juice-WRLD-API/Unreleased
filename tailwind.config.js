/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}', './src/renderer/index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: 'var(--surface)',
          raised: 'var(--surface-raised)',
          overlay: 'var(--surface-overlay)',
          highest: 'var(--surface-highest)',
        },
        sidebar: 'var(--sidebar)',
        titlebar: 'var(--titlebar)',
        accent: {
          DEFAULT: 'rgb(var(--accent-rgb) / <alpha-value>)',
          hover: 'rgb(var(--accent-hover-rgb) / <alpha-value>)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)'
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif']
      },
      // iOS text styles for the mobile layouts (SF Pro's own tracking per
      // size). In rem so the App text size setting scales them, which the
      // arbitrary text-[Npx] sizes they replace never did. A font-* class
      // still overrides the weight: Tailwind emits font weights after sizes.
      fontSize: {
        'large-title': ['2.125rem', { lineHeight: '2.5625rem', letterSpacing: '0.012em', fontWeight: '700' }],
        title1: ['1.75rem', { lineHeight: '2.125rem', letterSpacing: '0.013em', fontWeight: '700' }],
        title2: ['1.375rem', { lineHeight: '1.75rem', letterSpacing: '-0.012em', fontWeight: '700' }],
        title3: ['1.25rem', { lineHeight: '1.5625rem', letterSpacing: '-0.022em', fontWeight: '600' }],
        headline: ['1.0625rem', { lineHeight: '1.375rem', letterSpacing: '-0.025em', fontWeight: '600' }],
        body: ['1.0625rem', { lineHeight: '1.375rem', letterSpacing: '-0.025em' }],
        callout: ['1rem', { lineHeight: '1.3125rem', letterSpacing: '-0.02em' }],
        subhead: ['0.9375rem', { lineHeight: '1.25rem', letterSpacing: '-0.015em' }],
        footnote: ['0.8125rem', { lineHeight: '1.125rem', letterSpacing: '-0.006em' }],
        caption1: ['0.75rem', { lineHeight: '1rem', letterSpacing: '0' }],
        caption2: ['0.6875rem', { lineHeight: '0.8125rem', letterSpacing: '0.006em' }],
      }
    }
  },
  plugins: []
}
