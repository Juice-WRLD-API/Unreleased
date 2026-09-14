# unreleased - web

A music player for Juice WRLD - stream the full catalog of released and unreleased songs, right in your browser. Powered by the [Juice WRLD API](https://juicewrldapi.com).

> This is the deployed web build - see the [`app` branch](https://github.com/leanwrldd/unreleased/tree/app) for the full project (web + desktop), Stack, Development, and Branches docs. This README only covers what's actually usable at [player.juicewrldapi.com](https://player.juicewrldapi.com).

![Version](https://img.shields.io/github/package-json/v/leanwrldd/unreleased/web?label=version&color=blue)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/jwa)

**▶ Play now:** [player.juicewrldapi.com](https://player.juicewrldapi.com) - installable as a PWA for an app-like, offline-capable experience

---

## Features

### Browse & discover

- **Tracker** - search the entire catalog (titles, artists, producers), filter by category and era, sort by any column; List, Detailed, and virtualized Grid view modes; collapsible category sidebar with era counts; infinite scroll that stays smooth through thousands of tracks
- **999 FM** - live radio in the WRLD view: real-time metadata over WebSocket, vote to skip, suggest the next song, and preview the upcoming queue - the vote prompt surfaces anywhere in the app, not just on the WRLD page
- **Files** - navigate the API filesystem directly, stream audio, and download files
- **Song info** - full metadata for every track: titles, artists, producers, engineers, era, recording details, dates, and lyrics
- **Bulk edit** - multi-select songs in the Tracker and edit shared fields (era, category, credits, and more) across all of them at once, with per-field replace/add/remove/append/fill/clear
- **Changes feed** - a live stream of recent Tracker edits and comp-file changes, in the optional News tab (enable it in Settings → Appearance → Menu items)
- **Context menus everywhere** - right-click any song, playlist, or the player bar for play, queue, playlist, download, and edit actions

### Playback

- **Gapless playback** - the next track preloads into a second audio slot while the current one plays
- **Radio mode** - 📻 toggle in the player bar plays endless random tracks, pre-fetching the next song and respecting your active category/era filters
- **Queue** - drag to reorder, history and upcoming split, lazy loading for filtered queues
- **Synced lyrics** - karaoke-style highlighting with smooth scrolling, cached per session
- **Fine control** - crossfade (1–12 s), playback speed (0.5×–2× with an optional pitch-shift toggle for nightcore/slowed), sleep timer, and audio output device picker
- **10-band equalizer & effects** - 14 genre presets, L/R balance, mono downmix, skip silence, reverb, and a safety limiter, in a panel you can pop out into its own always-on-top window (`Shift+E`)
- **Last.fm scrobbling** - connect your account in Settings to scrobble what you play
- **Lock screen support** - Media Session integration shows track info and playback controls on mobile lock screens and notification shades

### Playlists & library

- **Playlists** - Spotify-style hero with 2×2 cover mosaic, custom cover upload, descriptions, drag-to-reorder, and zip-download of all tracks
- **Playlist folders** - organize playlists into folders, including folders within folders
- **Sharing** - share any playlist via public link; anyone can play it without an account, or **Follow** it to always see the owner's current tracks
- **Guest playlists** - not signed in? Build playlists anyway - they're saved to your browser instead of your account
- **Liked songs** - heart in the player bar, synced to your account

### Games & stats

- **Heardle** - name the song from its opening seconds. Daily mode shares one puzzle a day with everyone; Personal replays the same rules on demand; Unlimited is fully configurable (guess count, reveal speed, start point, era/category filters); **1v1** matches you live against another player. Live leaderboards for Today, Streaks, and 1v1. Share your result to the clipboard, Wordle-style
- **Wordle** - guess the song title letter by letter. Type it out on the keyboard (physical or on-screen) or find it by name in the search box; either way the guess has to be a real track whose title is exactly as long as the answer's, so the board narrows the catalog as you go. The keyboard colors in as you rule letters out. Daily shares one title a day with everyone, Unlimited draws them at random (guess count, era/category filters). Streaks, distribution and a spoiler-free share grid
- **Tier List** - rank songs into S/A/B/C/D (or tiers you build and recolor yourself) by dragging them into rows, or tap-to-select then tap-a-row on touch. A personal ranking with no daily puzzle or score, saved locally
- **Wrapped** - a listening summary built from your play counts, filterable by All time / 30 days / 7 days, with a recent-plays timeline

### Personalization

- **Skins** - 9 built-in looks (including a dynamic "Now Playing" skin that recolors the app to match the current cover art), or build your own in a live color editor and import/export skins as files to share
- **Gradient surfaces** - an optional accent-tinted gradient background behind the app, sidebar, and player
- **Fonts** - 7 selectable typefaces for the app, with a separate one for lyrics; independently adjustable text size for each
- **Configurable layout** - sidebar position, a reorderable and hideable side menu (and account-control row), and fully rebindable keyboard shortcuts
- **Song personalization** - set a custom name, cover art, and preferred version for any song, and track your own play count for it
- **Report & feedback** - flag an issue with any song, or send general feedback, right from the app

### Accounts & community

- **Discord sign-in** - liked songs and playlists sync to the API across devices
- **Editor tools** - submit song edits (a full form or a streamlined Basic layout) and propose new songs for admin review, link song versions, track proposal status, climb the leaderboard, earn badges
- **Contributor role** - apply to contribute file changes (upload, replace, move, delete, new folders) to the compilation; propose right from the Files browser or a dedicated Contributor page, track status from your Contributor Profile, and withdraw a pending proposal any time
- **Admin & Manager tools** - review song-edit and comp-file proposals (searchable, sortable), reports, and applications; manage albums, versions, and tracklists. Managers share the same review powers as Admins, short of full account/security access

---

## Want more?

The **desktop app** (Windows, macOS, Linux) adds a local file library, offline downloads, format conversion, importing from YouTube/SoundCloud/etc., Discord Rich Presence, a system tray, and more - all built from this same codebase. Grab it from the [releases page](https://github.com/leanwrldd/unreleased/releases/latest), or see the [`app` branch](https://github.com/leanwrldd/unreleased/tree/app) for the full feature list and source.

There are also sideloaded native builds for **Android** (`Unreleased-android-v*.apk`, [releases](https://github.com/leanwrldd/unreleased/releases?q=android-v&expanded=true)) and **iOS** (`Unreleased-ios-v*.ipa`, [releases](https://github.com/leanwrldd/unreleased/releases?q=ios-v&expanded=true), installed via [AltStore](https://altstore.io) or [Sideloadly](https://sideloadly.io) since it's unsigned) - neither is on an app store, since both ship `unreleased`-catalog content.

---

## Changelog

See [CHANGELOG.md](https://github.com/leanwrldd/unreleased/blob/app/CHANGELOG.md) on the `app` branch for the full, current version history.

---

## Credits

- **[juicewrldapi.com](https://juicewrldapi.com)** - the API powering everything: song metadata, streaming, lyrics, eras, categories, accounts, and the file browser
- **juicewrldapi** on Discord - for the help and support building the integration
- Built by **freakylatif** - find me on Discord
- Join the **[Discord](https://discord.gg/jwa)** server

---

## License

MIT
