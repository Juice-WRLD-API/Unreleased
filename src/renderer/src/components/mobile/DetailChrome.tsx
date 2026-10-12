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

export function PlayShuffleRow({ onPlay, onShuffle, disabled }: {
  onPlay: () => void; onShuffle: () => void; disabled?: boolean
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onPlay}
        disabled={disabled}
        className="flex-1 h-12 flex items-center justify-center gap-2 rounded-full bg-accent text-white text-[15px] font-semibold disabled:opacity-40 active:opacity-80"
      >
        <Play size={18} fill="currentColor" /> Play
      </button>
      <button
        onClick={onShuffle}
        disabled={disabled}
        className="flex-1 h-12 flex items-center justify-center gap-2 rounded-full bg-surface-overlay text-text-primary text-[15px] font-semibold disabled:opacity-40 active:bg-surface-highest"
      >
        <Shuffle size={17} /> Shuffle
      </button>
    </div>
  )
}

/** One app-bar icon button. `light` matches text-white/90 to a hero backdrop
 *  behind it (see HeroBackdrop) instead of the normal text-muted, which is a
 *  dark tone in a light theme and unreadable over darkened art. */
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
      className={`w-11 h-11 shrink-0 flex items-center justify-center rounded-full active:bg-surface-overlay ${
        active ? 'text-accent' : light ? 'text-white/90' : 'text-text-muted'
      }`}
    >{icon}</button>
  )
}
