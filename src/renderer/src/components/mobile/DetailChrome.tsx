import React from 'react'
import { Play, Shuffle } from 'lucide-react'
import { smallCoverUrl } from '../../lib/juicewrldApi'

// Shared pieces of the mobile "playlist detail" screen chrome, pulled out of
// PlaylistsView.mobile.tsx so other playlist-like detail screens (e.g.
// DonorPlaylists) can match the same look instead of drifting into their own.

/** Full-bleed blurred cover behind a detail header, fading into the page.
 *  Only rendered when there IS art - the header switches to a light-on-dark
 *  (or light-on-light, on a light skin) palette to match it, which would be
 *  unreadable over a bare theme surface otherwise. `isDarkSkin` mirrors the
 *  darkening toward white on a light skin instead of always going black -
 *  a black banner slapped over an otherwise light page read as a straight-up
 *  bug rather than a design choice. Callers must flip their own text colors
 *  to match (see the `heroLight` pattern in PlaylistsView.mobile.tsx). */
export function HeroBackdrop({ src, isDarkSkin }: { src: string; isDarkSkin: boolean }): JSX.Element {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <img
        // Blurred past recognition, so the degraded copy is indistinguishable
        // from the original and shows up far sooner.
        src={smallCoverUrl(src)}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          filter: `blur(50px) saturate(1.7) brightness(${isDarkSkin ? 0.5 : 0.85})`,
          transform: 'scale(1.3)',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: isDarkSkin
            ? 'linear-gradient(to bottom, rgb(0 0 0 / 0.30), rgb(0 0 0 / 0.20), var(--surface))'
            : 'linear-gradient(to bottom, rgb(255 255 255 / 0.45), rgb(255 255 255 / 0.25), var(--surface))',
        }}
      />
    </div>
  )
}

/** Apple Music's pair under a detail header: two equal gray capsules with the
 *  label and glyph in the accent, rather than one loud filled button. */
export function PlayShuffleRow({ onPlay, onShuffle, disabled }: {
  onPlay: () => void; onShuffle: () => void; disabled?: boolean
}): JSX.Element {
  const cls = 'flex-1 h-12 flex items-center justify-center gap-2 rounded-full bg-[var(--fill)] text-accent text-headline disabled:opacity-40 active:bg-[var(--fill-strong)] transition-colors'
  return (
    <div className="flex items-center gap-3">
      <button onClick={onPlay} disabled={disabled} className={cls}>
        <Play size={18} fill="currentColor" strokeWidth={0} /> Play
      </button>
      <button onClick={onShuffle} disabled={disabled} className={cls}>
        <Shuffle size={18} strokeWidth={2.5} /> Shuffle
      </button>
    </div>
  )
}

/** One app-bar button: a round glass toolbar button, iOS 26-style (see
 *  BarButton in NavBar). `light` puts the glyph in white over a hero backdrop
 *  (see HeroBackdrop) - only ever set on dark skins, where the glass behind it
 *  is dark too. */
export function appBarButton(
  label: string,
  icon: React.ReactNode,
  onClick: () => void,
  active = false,
  light = false,
): JSX.Element {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`glass-button w-11 h-11 shrink-0 flex items-center justify-center rounded-full transition-opacity active:opacity-60 ${
        active ? 'text-accent' : light ? 'text-white' : 'text-text-primary'
      }`}
    >{icon}</button>
  )
}
