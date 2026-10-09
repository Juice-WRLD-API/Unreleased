# Changelog: web-dev → web

## Terminal
- Standalone Terminal page with nav entry, hotkey and fullscreen mode, plus an admin terminal in chat
- Nano editor, themes, screens, access control and docs
- Commands cover library, player, settings, user, admin and fun, and anything else that could be done from the UI
- A new standalone CLI, available on npm and apt

## Chat
- End-to-end encrypted chat
- Command cards instead of toasts, which can be posted to the room with `-s`
- New chat commands:
  - `/np`
  - `/seen`
  - `/changelog`
  - `/broadcast`
  - `/promote`, `/demote`, `/role`, `/allow`, `/disallow`
- Like Discord servers and features
- Share songs, playlists, news posts and lyric cards to chat, and forward messages
- Opt-in Now Playing sharing on profiles and chat presence, plus presence and read-receipt privacy toggles
- Chat keys shared across your own devices, with passphrase-protected export/import

## Accounts and profiles
- Public profile pages with bio and privacy settings
- Tier lists saved to your account, with multiple lists, album and era pools, and public sharing shown on profiles
- Username/password login with 2FA as its own step, and device-link approval prompts
- Full app settings synced across devices
- Donor cloud storage: My files, donor playlists and in-app playback, with donors able to manage their own CDN nodes


## Player and visualizer
- Audio-reactive visualizers in the WRLD fullscreen, with corona, ripples and lightning
- Shareable lyrics image card with font selection
- Desktop lyrics customization modal and lyric phrase highlighting
- Per-song excluded versions, skipped by shuffle-play

## Sharing and social
- Shareable track pages with social preview cards, including playable MP4 embeds
- Social previews for profiles, playlists, news and Discord embeds
- Shareable playlist URLs and playlist export to JSON or M3U

## Home, library and stats
- Statistics page with site-wide play stats, an era timeline and section tabs
- Home dashboard additions:
  - Albums row
  - Per-section visibility settings
  - Mobile Home tab with recent tracks and a More sheet
  - 999 FM quick-tune
- Files view: drag-and-drop reorganizing staged as a batch, a right-click menu on empty space, and your pending proposals shown as ghost entries
- ZIP downloads built in the browser
- Optional distributed CDN downloads (off by default)
- Thank You donors page and a dismissible donation notice
- Song editor: BPM/Key fields, a date picker, and a lyrics sync tool
- Desktop Home as a bento landing page, with Albums and Eras admin tabs
- Session-edit links on recording session Tracker entries, with a manual override
- Drag playlists onto each other to bundle them into a folder, and press-and-hold multi-select
- Drag files or folders in from the OS to upload to Files

## Interface and settings
- Auto-hide nav option
- Hidden nav items stay reachable from a More menu; Games is hidden by default
- Settings is now a full page, with a separate Preferences tab
- Playlist hero backdrop toggle, with a version for light skins
- WRLD theme-background toggle and in-context lyrics display settings on mobile
- Mobile song modals as full bottom sheets with swipe-to-dismiss
