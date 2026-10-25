# Changelog

All notable changes to the web player are documented here.

> Live at [player.juicewrldapi.com](https://player.juicewrldapi.com) · Source on [GitHub](https://github.com/Juice-WRLD-API/Unreleased/tree/web)

Releases before 1.20.9 were built from the same code as the desktop app. Their notes are in the [`app` branch's changelog](https://github.com/Juice-WRLD-API/Unreleased/blob/app/CHANGELOG.md).

---

## [Unreleased]

- **New** **Desktop**, in Settings → Desktop: the lyric styles, an Edge light and the widgets for the WRLD tab, following what you play. Everything starts off
  - **Widgets in WRLD**: the player, playlist and clock inside the WRLD tab, over the visualizer, from the toolbar's Widgets button or Layout → Widgets in the visualizer settings. Drag them about the tab; each can be left out in Settings → Desktop
  - **Lyric styles** for the WRLD tab: Fisheye, Spread, Karaoke, Typewriter, Neon, Echo, Glitch and Cinema, sung word by word, each in a font of your choice, with a note through instrumental breaks
  - An **Edge light** for the WRLD tab: any of the 22 lights round its edges, over the visualizer or on its own with the visualizer off, in your colors or the cover's
  - Browse every light and every lyric style playing live before picking one; hotkeys and a `desktop` terminal command reach all of it
- **New** Browse every WRLD visualizer, classic and shader, playing live before picking one, from the visualizer settings
- **New** An Edge light can play round the edges on top of any classic or shader WRLD visualizer: Edge on top in the visualizer settings, or `set viz-edge` in the terminal
- **Change** WRLD's Cover Flow layout is gone: its queue cards, clock and controls are the player and clock widgets now, in WRLD's Widgets layout. A saved Cover Flow opens as Aurora
- **New** **Chat message search** across DMs and servers (encrypted DMs are searched on your device), with filters like `from:`, `mentions:`, `in:`, `has:`, `before:`/`after:`, negation and exact phrases. Ctrl+F opens it from any room, and the terminal can `grep` chat history
- **New** **Beta admin tab**: admins can manage beta access codes and publish, toggle or delete beta builds (also via the terminal's `beta` command)
- **New** Chat attachments upload with a progress bar and can be cancelled from the Transfers panel
- **New** The admin Feedback tab can hide duplicate crash reports
- **New** **Notifications**: a notification area that keeps the chat messages, news posts, announcements, device alerts and app notices that popped up, grouped by day, with a badge for new ones. Click one to go to its chat room or post. Opens from the Notifications button in the side menu (it can be moved or hidden like the others), the bell on mobile Home, or the terminal's `notifications` command. Kept on this device for 30 days; signing out clears the chat ones
- **Improve** Tracker fields are reordered by dragging instead of up/down buttons
- **Improve** Profiles show their cached copy straight away while fresh data loads in the background
- **Improve** Song lists skip fields they don't show (like lyrics), so they load faster
- **Improve** Larger cover art on track pages
- **Fix** Running a browser page translator over the site no longer crashes views
- **Fix** Playback no longer stops by itself after a dead spot in the connection, a stalled radio pick, or the browser resuming audio after a call; songs that keep failing are skipped instead of stopping the queue, and pressing play after a "Couldn't play" retries properly

---

## [2.3.2] — 2026-10-11

- **New** **Customisable Tracker**: choose which fields appear in the song list and the detail panel, and in what order
- **New** **API keys**: create and revoke personal API keys in Settings or from the terminal
- **New** **Embed lyrics and cover in downloads**: a setting that writes the song's lyrics (plain and synced) and your personal cover into downloaded MP3s
- **New** Comp proposals can be marked as a **new leak**, with a badge in review queues and a toggle on pending proposals
- **New** **Feedback tab** in the admin console
- **New** Admins can approve or deny proposals directly from the proposal cards on a user's profile
- **New** Admin CDN nodes tab: upload node binaries with a progress bar, plus a world map of nodes, country chips and node locations
- **New** The Download page lists CDN node binaries
- **New** Drag the pill nav to any edge of the window
- **New** Group chats show stacked member avatars in the chat rail
- **New** A Copy link button on news articles
- **New** Transfers in the mobile More sheet, so staged proposals are reachable on phones
- **New** ZIP downloads show a progress bar on mobile, including a byte-based one for folders in Files
- **Improve** Previous now works in radio/shuffle mode, stepping back through what the radio played
- **Improve** Playback recovers more reliably when a stream stalls, and every menu now uses one shared design
- **Improve** API server settings moved to their own Developer section
- **Improve** Auto-report and feedback settings moved, and nav settings sync across devices
- **Improve** The Home page uses the full window width
- **Improve** The Games switcher sits below the top pill, and the pill nav is hidden on phones
- **Improve** Settings and staff-only tabs preload in the background
- **Change** Credits moved from Settings → About to the Thank you page
- **Change** The Pill nav style keeps auto-hide turned off
- **Fix** Downloads on mobile Chrome are no longer blocked as pop-ups
- **Fix** Opening a submenu no longer blanks the screen
- **Fix** Copy link on news posts
- **Fix** Broken CDN node binary download links
- **Fix** Fewer duplicate requests on the profile page and when switching channels
- **Fix** Display names missing from the terminal's user search

---

## [2.1.0] — 2026-10-08

The biggest update yet: everything built on the `web-dev` branch over six weeks.

**Chat**
- End-to-end encrypted servers, channels and DMs, with roles, permissions, public servers you can browse and join, and moderation (timeouts, bans, site-wide restrictions)
- Reorder servers, DMs and channels by dragging; pin, mute and delete chats
- Discord-style replies, right-click message options, and Up arrow to edit your last message
- GIF picker with favourites synced across devices, link preview cards in channels (never in DMs), `@` mentions and `@everyone`
- Desktop notifications, an in-app banner and a choice of sounds
- Opt-in "now playing" on your profile and in chat, with switches to hide your presence and read receipts
- Mute a person in shared channels
- Share songs, playlists, news, lyric cards and themes into chat, and forward messages
- Slash commands with autocomplete and hints, including `/song`, `/search`, `/np`, `/seen`, `/changelog`, `/broadcast`, `/theme`, `/sharetheme`, `/feedback`, `/info`, `/kick`, `/mute`, and `/promote` / `/demote` / `/role` / `/allow` / `/disallow`. Command results show as cards, and `-s` posts them to the room
- Chat keys shared across your own devices, with passphrase-protected export and import

**Terminal**
- A Linux-style terminal page (Ctrl+`, or the `>_` button in a chat header) that runs every chat command and drives the rest of the app: playback and the queue, playlists, any setting, opening pages, and the admin review queues
- `cd`/`ls` through channels, DMs and the Files tree, with `cat`, `head`, `tail`, `grep`, `tree`, `du`, `get` (downloads a file, or a folder as a ZIP), and a `nano` editor
- Pipes, history search (Ctrl+R), aliases, `!!`, tab completion, "did you mean", `watch`, `source`, themes, and toys like `neofetch`, `cowsay`, `matrix` and `karaoke`
- A standalone command-line version, available on npm and apt

**Accounts and profiles**
- Create an account with a username and password, with two-factor auth as its own step and sign-in approval from another device
- All app settings sync across devices
- Public profiles with a bio, privacy settings, donor status and custom avatars
- Tier lists saved to your account: several lists, album and era pools, and public sharing on your profile
- Donor cloud storage: My files, donor playlists, in-app playback, and managing your own CDN nodes

**Player, lyrics and WRLD**
- Audio-reactive visualizers in WRLD (corona, ripples, lightning), smoother dragging, a theme-background toggle, and changing the cover by right-clicking the art
- Shareable lyrics image cards: pick lines, font, colour and your own background, then copy it
- Lyrics size, alignment, blur and colour options on desktop, and lyric phrase highlighting
- Exclude versions of a song from shuffle, search the queue, and double-click to play in the Tracker
- Queue reshuffle, full era names, and a lyrics panel that collapses when there are none (Shift+L toggles it)

**Home, library and sharing**
- Desktop Home is a landing page with recent tracks, a news rail, your playlists, albums, catalogue totals and 999 FM quick-tune. Phones get their own Home tab and a More menu, and you choose which sections show
- Track pages with social preview cards (including playable video embeds), plus previews for profiles, playlists and news
- Shareable playlist and news links, and playlist export to JSON or M3U
- Drag playlists onto each other to make a folder, and press-and-hold to select several songs
- Statistics page with catalogue breakdowns, site-wide play stats and an era timeline, linking into the Tracker

**Files**
- Drag and drop to reorganise (staged as one batch), drag files or folders in from your computer to upload, and right-click empty space to refresh, upload or make a folder
- Your pending proposals show as placeholder entries
- Large comp uploads are sent in chunks
- Multi-file, folder, playlist and Tracker downloads arrive as one ZIP built in the browser
- Optional distributed CDN downloads (off by default)

**Staff tools**
- Song editor: BPM and Key fields, a date picker, and a lyrics sync tool
- Session-edit links on recording-session Tracker entries, with a manual override
- Albums and Eras admin tabs
- Cancel all pending comp uploads, video previews on comp proposals, and review actions that update the list immediately

**Interface**
- Settings is a full page with a separate Preferences tab
- Auto-hiding nav; hidden tabs stay reachable from a More menu, and Games is hidden by default
- Playlist hero backdrop toggle, with a version for light skins
- Song modals on phones are full-height bottom sheets you can swipe away
- Thank You page for donors and a dismissible donation notice
- Terms and Privacy updated for settings sync and the GIF picker

---

## [2.0.9] — 2026-08-21

- **New** **Docked modals**: dialogs dock into a pill at the top of the window, where they can stack, lock and resize, and reopen without losing what you typed
- **New** Playlist folders sync to your account
- **Improve** Multi-select (with Ctrl+A) works the same way in Files and the Tracker
- **Improve** Menus always fit on screen, including their submenus
- **Improve** News shows the last loaded posts instantly when you switch channels
- **Improve** Song preferences, listening history and folders sync in one request instead of three

---

## [2.0.8] — 2026-08-20

- Documentation only

---

## [2.0.7] — 2026-08-20

- Release tooling only

---

## [2.0.6] — 2026-08-20

- **New** **Channels**: Files can switch between file channels, with per-channel editor, contributor and manager roles, and a Channels admin tab
- **New** **Era covers**: replace the API's shared placeholder cover for an entire era with one of your own
- **New** **Volume boost** up to 200% in the equalizer
- **New** Search in the queue and play history
- **New** A separate News role, so non-admins can post and edit their own news
- **New** A search box in Settings that jumps to the matching option, and a channel switcher on the staff profile
- **Improve** Redesigned changes feed, grouped by day
- **Fix** Settings on phones opens as a full page

---

## [2.0.5] — 2026-08-19

- **Improve** Playlist quick view: opening one closes any open folder, and its tracks have the full right-click menu

---

## [2.0.3] — 2026-08-18

- Release tooling only

---

## [2.0.2] — 2026-08-18

- **New** Previews of the proposed file on comp proposals

---

## [2.0.1] — 2026-08-17

- **Fix** Playlist grid quick view, equalizer and tier list fixes

---

## [2.0.0] — 2026-08-17

- **New** **Tier List**: rank songs into tiers by dragging them into rows
- **New** **A-B loop**: set two points in a track and loop between them
- **New** Link several songs into one version group in one click from bulk edit

---

## [1.21.4] — 2026-08-17

- **New** Clicking a playlist in the grid opens a quick view underneath it instead of a new page

---

## [1.21.3] — 2026-08-16

- **Improve** Last.fm no longer scrobbles folder names as album titles for file-browser tracks
- **Fix** A menu loop that could freeze the Playlists page

---

## [1.21.2] — 2026-08-15

- **Improve** WRLD follows your skin's colours on the theme background, including light skins
- **Fix** Server-graded Heardle rounds could pick an answer you couldn't type in
- **Fix** Editing songs from a playlist loads their full details first

---

## [1.21.1] — 2026-08-14

- **Fix** The editor and Song Info now use a song's real title instead of sometimes showing an alias
- **Fix** A proposal can't be submitted twice by accident

---

## [1.21.0] — 2026-08-14

- **New** Set a version title for several songs at once in bulk edit
- **Change** Opening a playlist folder expands it in place instead of navigating away

---

## [1.20.17] — 2026-08-14

- **New** Field search in the Tracker, such as `artists:"Juice WRLD"`, with a syntax help popover
- **New** Autocomplete for album, credits, recording location and leak type in the song editor
- **New** Ctrl+A selects every visible song in the Tracker

---

## [1.20.16] — 2026-08-13

- **New** Drag a playlist onto a folder to move it in; folders show a mosaic of their playlists
- **Change** Released songs keep their official artwork instead of rotating suggested covers

---

## [1.20.15] — 2026-08-13

- **New** The Download page offers the Android app
- **Fix** Heardle reveal cards show the song's cover again
- **Fix** Compact playlist view numbering and sorting

---

## [1.20.14] — 2026-08-12

- **New** Play button on grouped rows in compact view
- **Improve** A playlist's sort is remembered when you switch tabs

---

## [1.20.13] — 2026-08-12

- **New** On-screen keyboard for Wordle that tracks which letters are ruled out
- **Improve** Daily and practice rounds of Heardle and Wordle are saved separately, and the Games tab reopens on the last game you played

---

## [1.20.12] — 2026-08-12

- **New** **Wordle**, alongside Heardle in a new **Games** tab

---

## [1.20.11] — 2026-08-12

- **New** Era and Category columns in playlists

---

## [1.20.10] — 2026-08-12

- **Improve** Shuffling a compact playlist picks by song, so songs with several versions aren't over-represented

---

## [1.20.9] — 2026-08-11

- **Improve** Retitling a song that shares a version group splits it into its own group instead of renaming every linked song
- **Improve** Ad-libs in lyrics are shown dimmer
- **Fix** The previous song's cover staying on screen after a track change
- **Fix** A tab left open across a site update reloads instead of erroring
