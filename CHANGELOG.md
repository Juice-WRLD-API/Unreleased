# Changelog

All notable changes to this project are documented here.

> Live at [player.juicewrldapi.com](https://player.juicewrldapi.com) · Source on [GitHub](https://github.com/Juice-WRLD-API/Unreleased)

---

## [2.5.0] — 2026-10-20

- **New** **Desktop**, in Settings → Desktop: iJWA's light and widgets built into the app, following what Unreleased plays. Everything starts off
  - **Screen-edge light** (Windows): a glow round your screens in 22 looks (Snake, Lava, Fireflies, Lyrics Ticker, Fire, Snow…), all round or at the bottom, top or corners, moving with the music or flowing on its own, in your colors or the cover's. It can show only while the desktop is in front, and you choose which displays get it
  - **Desktop player, playlist and clock** (Windows): your queue as glass cards on the desktop with a glass control bar, lyrics beside the playing card, and catalog search with era pages; a tilted see-through list of your queue, liked songs or a playlist; tall glass digits tinted by the cover. Drag them anywhere, lock them, or make the player small
  - **Widgets in WRLD** (everywhere, the web too): the same player, playlist and clock inside the WRLD tab, over the visualizer, from the toolbar's Widgets button or Layout → Widgets in the visualizer settings. Drag them about the tab; each can be left out in Settings → Desktop
  - **Clear desk** (Windows): lays the wallpaper over every other window and the taskbar, leaving only the light and the widgets; any other app coming forward brings it all back
  - **Lyric styles** for the WRLD tab and the desktop player: Fisheye, Spread, Karaoke, Typewriter, Neon, Echo, Glitch and Cinema, sung word by word, each in a font of your choice, with a note through instrumental breaks
  - An **Edge light** for the WRLD tab: any of the 22 lights round its edges, over the visualizer or on its own with the visualizer off. It's the screen light's look, sized and colored the same way, so a look picked in either place is both
  - Browse every light and every lyric style playing live before picking one; hotkeys, a `desktop` terminal command and a Desktop menu in the tray reach all of it
- **New** Browse every WRLD visualizer, classic and shader, playing live before picking one, from the visualizer settings
- **New** An Edge light can play round the edges on top of any classic or shader WRLD visualizer: Edge on top in the visualizer settings, or `set viz-edge` in the terminal
- **Change** The lyrics pipe for the standalone iJWA app is gone: Desktop replaces it
- **Change** WRLD's Cover Flow layout is gone: its queue cards, clock and controls are the Desktop player and clock now, on the desktop or in WRLD's Widgets layout. A saved Cover Flow opens as Aurora

---

## [2.4.1] — 2026-10-12

- **Fix** After an update, the installer starts the new version itself once its files are in place. Before, the app could relaunch mid-install and run the same update again

---

## [2.4.0] — 2026-10-12

- **New** **Chat message search** across DMs and servers (encrypted DMs are searched on your device), with filters like `from:`, `in:`, `has:`, `before:`/`after:`, negation and exact phrases. Ctrl+F opens it from any room, and the terminal can `grep` chat history

---

## [2.3.10] — 2026-10-12

- Build pipeline changes only

---

## [2.3.9] — 2026-10-12

- **Improve** The API server settings moved into Settings → Developer
- **Improve** Your beta access code now survives a reinstall, and leaving the beta switches you back to the stable update channel

---

## [2.3.8] — 2026-10-12

- **Fix** Copy buttons across the app (links, tokens, lyrics, chat messages, playlist shares and more) now go through the system clipboard and work reliably

---

## [2.3.7] — 2026-10-12

- **New** **Beta admin tab**: admins can manage beta access codes and publish, toggle or delete beta builds (also via the terminal's `beta` command)
- **New** With a beta code, the app checks for newer beta builds on startup and installs them directly
- **Fix** The modal lock toggle is hidden when pop-ups are undocked, where it had no effect

---

## [2.3.6] — 2026-10-11

- **Fix** Running a browser page translator over the app no longer crashes views

---

## [2.3.5] — 2026-10-11

- **Fix** The app reopens properly after a silent background update

---

## [2.3.4] — 2026-10-11

- **New** Chat attachments upload with a progress bar and can be cancelled from the Transfers panel
- **New** The admin Feedback tab can hide duplicate crash reports
- **Improve** Song lists skip fields they don't show (like lyrics), so they load faster
- **Improve** Larger cover art on track pages

---

## [2.3.3] — 2026-10-11

- **Improve** Tracker fields are reordered by dragging instead of up/down buttons
- **Improve** Profiles show their cached copy straight away while fresh data loads in the background

---

## [2.3.2] — 2026-10-11

- **Fix** Opening a proposal with a very long change (lyrics, synced lyrics) no longer freezes the computer; large diffs are capped and the copy buttons still copy the full text

---

## [2.3.1] — 2026-10-11

- **Improve** Every view's code is preloaded in the background once the app is idle, so switching tabs is instant
- **Fix** The terminal's close button no longer sits under the window controls

---

## [2.3.0] — 2026-10-11

- **New** **Customisable Tracker**: choose which fields appear in the song list and the detail panel, and in what order
- **New** **API keys**: create and revoke personal API keys in Settings or from the terminal
- **New** **Feedback tab** in the admin console
- **Improve** Settings and Chat preload in the background so they open without a wait

---

## [2.2.13] — 2026-10-11

- **New** Comp proposals can be marked as a **new leak**, with a badge in review queues and a toggle on pending proposals (also in the terminal's comp commands)
- **Fix** The terminal no longer hangs on "starting" because the chat client wasn't running yet

---

## [2.2.12] — 2026-10-11

- **Improve** Credits were removed from Settings → About; they now live on the Thank you page
- **Fix** Copying your token from the sidebar profile's right-click menu works again

---

## [2.2.11] — 2026-10-11

- **New** Admins can approve or deny proposals directly from the proposal cards on a user's profile

---

## [2.2.10] — 2026-10-10

- **New** **Embed lyrics and cover in downloads**: a setting that writes the song's lyrics (plain and synced) and your personal cover into downloaded MP3s
- **New** Admin CDN nodes tab: a world map of nodes, country chips and node locations
- **Improve** Previous now works in radio/shuffle mode, stepping back through what the radio played
- **Improve** Fewer duplicate requests on the profile page and when switching channels
- **Fix** Opening a submenu in the app menu no longer blanks the screen

---

## [2.2.9] — 2026-10-09

- **New** Admins can upload CDN node binaries (by platform and version, with a progress bar) from the CDN nodes tab

---

## [2.2.8] — 2026-10-09

- **New** Group chats show stacked member avatars in the chat rail
- **New** A Copy link button on news articles
- **Fix** Copy link on news posts works again
- **Change** The Pill nav style now keeps auto-hide turned off

---

## [2.2.7] — 2026-10-09

- **New** Drag the pill nav to any edge of the window
- **Improve** The Home page uses the full window width

---

## [2.2.6] — 2026-10-09

- Maintenance release, no user-facing changes

---

## [2.2.5] — 2026-10-09

- **Improve** Every right-click and overflow menu now uses one shared menu, so they look and behave the same everywhere

---

## [2.2.4] — 2026-10-09

- **New** The Pill nav style shows the app menu button
- **Fix** Chat room header buttons and the WRLD visualizer toolbar no longer sit under the window controls
- **Fix** The app reopens after a silent update on Windows

---

## [2.2.3] — 2026-10-09

- **Fix** "Profile not found" when opening some profiles
- **Fix** The chat room header overlapping the window buttons

---

## [2.2.1] — 2026-10-09

- **Fix** The Library tab is back in the nav

---

## [2.2.0] — 2026-10-09

The biggest update since 2.0. It brings most of what the web player gained over the past six weeks to the desktop app.

- **New** **Staff chat**: end-to-end encrypted rooms and DMs, device linking, encrypted backups, trust checks, slash commands, command cards, link previews and notifications
- **New** **Terminal**: a command line inside the app for playback, files, settings, review queues, chat and admin
- **New** **Home dashboard**, with recently played synced across your devices
- **New** **WRLD visualizer**, lyrics styling options and a **synced-lyrics timing tool** for editors
- **New** **Public track pages** with shareable links, a lyrics image card, a now-playing card, and sharing songs, playlists and news into chat
- **New** **Public user profiles**, and a redesigned staff/contributor profile
- **New** **Statistics** page with catalogue-wide numbers
- **New** **Donor file storage**, donor playlists, and a peer-to-peer CDN for downloads (off by default, toggle in Settings)
- **New** **Tier lists**: several lists per account, synced
- **New** Sign in with a password, with two-factor authentication and login approval from another device
- **New** Admin: Eras tab, albums management, broadcasts, and the admin terminal
- **New** Song editor: BPM and Key fields, a date picker, and linking songs to session edits
- **New** Hide specific versions of a song, double-click to play, and numeric sorting in Files
- **New** Drag files into the Files tab to stage file changes; pending comp proposals show as placeholders until approved
- **New** Playlist export to JSON and M3U, a playlist hero header, and ZIP downloads built in the app
- **New** Preferences tab in Settings and an auto-hiding nav
- **Improve** Lower idle CPU and memory use: the cover cache is capped and the player no longer re-renders on every tick
- **Improve** Queue panels stay mounted so covers don't reload each time you open them
- **Fix** Pause/play race when toggling quickly
- **Fix** Mini player stealing focus, Song Info scrolling, and header alignment in Tracker, Library and News
- **Fix** The equalizer pop-out setting is hidden when pop-out windows are off

---

## [2.1.8] — 2026-08-27

- **Improve** Playback recovery is more reliable: retries keep what you meant to play (including from WRLD), survive track info updates, and all transport buttons go through one path

---

## [2.1.7] — 2026-08-26

- **New** Offline-downloads filter in the Tracker, and an "in the API" filter in the Library
- **Improve** Turning shuffle off goes back to the playlist's own order, so Next and Previous follow the playlist again
- **Improve** The catalogue retries automatically if the API fails to load
- **Fix** Select-all in compact view could select hidden songs
- **Fix** Songs column alignment

---

## [2.1.6] — 2026-08-25

- **New** A Settings → Window option to turn off docking modals into the top pill
- **Fix** Offline library changes made at the same time no longer overwrite each other
- **Fix** The sign-in window can be reopened after it was collapsed

---

## [2.1.5] — 2026-08-24

- **Fix** The app reopens after installing an update silently
- **Fix** Modal docking, Wordle and playlist card glitches

---

## [2.1.4] — 2026-08-24

- **New** **Queue reshuffle** button
- **New** Option to show full era names instead of abbreviations, also in the playlist track menu
- **New** The lyrics panel collapses when a song has no lyrics; Shift+L toggles it
- **New** Cancel all pending comp uploads at once
- **New** Play Next in the playlist track menu
- **Improve** Wayland, X11 and Windows compatibility
- **Fix** Shuffle starting on the wrong track or position, and reshuffle stopping playback
- **Fix** The lyrics panel flashing on track change
- **Fix** Copy path / Copy link silently failing
- **Fix** Docked modals now open centred and can't be dragged by the pill

---

## [2.1.3] — 2026-08-20

- **New** **Docked modals**: dialogs dock into a pill at the top of the window, where they can stack, lock and resize, and reopen without losing what you typed
- **Improve** Updates can install on the next startup, plus a manual "install update" option

---

## [2.1.2] — 2026-08-20

- Developer-only change: dev builds use their own Windows app ID

---

## [2.1.1] — 2026-08-20

- **New** Add files from your computer straight into a Local Files folder
- **New** The Tracker's filters moved into a popover next to the search box
- **New** Playlist folders sync to your account
- **Improve** Multi-select (with Ctrl+A) works the same way in Files and the Tracker
- **Improve** Menus always fit on screen, including their submenus
- **Improve** News shows the last loaded posts instantly when you switch channels
- **Improve** Song preferences, listening history and folders sync in one request instead of three

---

## [2.1.0] — 2026-08-20

- **New** "Show Discord Status" setting: choose whether Discord shows the app's name, the artist, or the song title
- **Improve** Admin approve/reject actions update the list immediately
- **Improve** Ctrl+A in the Tracker selects every matching song, not just the ones loaded so far
- **Fix** Opening a file from search results in Files shows the right gallery

---

## [2.0.10] — 2026-08-19

- **New** Search box in Settings that jumps to the matching option
- **New** Channel switcher on the staff profile
- **Improve** Redesigned changes feed, grouped by day
- **Fix** Admin and review lists no longer show another channel's data after an access error

---

## [2.0.9] — 2026-08-19

- **New** A separate News role, so non-admins can post and edit their own news
- **Fix** Switching channels or folders quickly in Files no longer shows the wrong listing

---

## [2.0.8] — 2026-08-19

- **New** **Channels**: the Files tab can switch between file channels, with per-channel editor, contributor and manager roles, and a Channels admin tab
- **New** Search in the queue and play history

---

## [2.0.7] — 2026-08-19

- **New** **Era covers**: replace the API's shared placeholder cover for an entire era with one of your own
- **New** **Volume boost** up to 200% in the equalizer, behind the same limiter so it doesn't clip

---

## [2.0.5] — 2026-08-18

- **New** A "Listen on API" button on your Discord Rich Presence

---

## [2.0.2] — 2026-08-18

- **New** Previews of the proposed file (image, audio, video) on comp proposals

---

## [2.0.1] — 2026-08-17

- **Fix** Playlist grid quick view, equalizer and tier list fixes

---

## [2.0.0] — 2026-08-17

- **New** **Tier List**: rank songs into tiers by dragging them into rows
- **New** **A-B loop**: set two points in a track and loop between them
- **New** Link several songs into one version group in one click from bulk edit
- **New** The Windows installer becomes a maintenance page once installed: update, reinstall, uninstall, switch to any released version, or enter a beta code
- **New** A small Windows web installer that downloads the rest during setup
- **Improve** Security hardening: external links and file opening are restricted, navigation away from the app is blocked, permissions are denied by default, and the ffmpeg and yt-dlp downloads are checksum-verified

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
- **Improve** A pinned mini player stays on top of fullscreen games

---

## [1.20.11] — 2026-08-12

- **New** Era and Category columns in playlists

---

## [1.20.10] — 2026-08-12

- **Change** Global shortcuts are opt-in per action and no longer fire twice while the app is focused
- **Improve** Shuffling a compact playlist picks by song, so songs with several versions aren't over-represented

---

## [1.20.9] — 2026-08-11

- **New** The staff profile can open in its own window
- **Improve** Retitling a song that shares a version group splits it into its own group instead of renaming every linked song
- **Improve** Ad-libs in lyrics are shown dimmer
- **Fix** The previous song's cover staying on screen after a track change
- **Fix** A stale tab on the web player reloads instead of erroring after a redeploy

---

## [1.20.8] — 2026-08-11

- **New** **Follow a shared playlist** — a live pointer to the owner's playlist that always shows their current tracks, no account needed, alongside the existing one-time "save a copy" import
- **New** **Rotate suggested covers** — songs without a custom cover cycle through different covers found in the API's files each time they play
- **New** Text file viewer — view `.txt`/`.lrc` and other plain-text files right in the Files tab
- **New** Custom colors for the active/inactive synced-lyrics lines, an adjustable "blur inactive lyrics" amount, and smaller rendering for ad-libs
- **Improve** Playback that stalls or fails to load now automatically retries (with a cap) instead of silently getting stuck; an API outage stops the queue instead of racing through every track
- **Fix** Background playback with audio effects enabled could get killed by the OS on mobile (Android doze/screen-off) — effects now only attach once actually turned on

---

## [1.20.7] — 2026-08-10

- **New** Copy or save a song's cover image directly from Song Info
- **Fix** Heardle's daily puzzle now uses the server's date instead of your device's, so players in some timezones were no longer wrongly rejected

---

## [1.20.6] — 2026-08-09

- **New** In-app and global keyboard shortcuts can now be rebound independently — a shortcut can be in-app-only, global (OS-wide), or both
- **New** *(Desktop)* "Media key overlay" toggle — show or hide the Windows volume/media flyout when pressing media keys
- **New** Right-click your profile in the sidebar to copy your auth token
- **Improve** *(Desktop)* The app now checks for updates periodically while running, not just at startup
- **Fix** *(Desktop)* Shared/absolute links (e.g. a shared playlist) now resolve correctly instead of building a broken `file://` URL

---

## [1.20.5] — 2026-08-09

- **New** *(Desktop)* Local file management in the Files tab — rename, create new files/folders, and delete to the OS trash
- **New** Global shortcuts can now be toggled per-action instead of all-or-nothing
- **New** *(Desktop)* "Remember window sizes" option
- **Improve** Web pages now carry per-page titles and descriptions for search engines and link previews
- **Fix** Admin's proposal search box no longer lags on large proposal lists

---

## [1.20.4] — 2026-08-09

- **New** Contributors can now withdraw their own pending comp-file proposals
- **New** Contributor proposals gained a "New folder" option alongside upload/replace/move/delete
- **Improve** Admin's proposal review queues (song edits and comp files) gained a search box and a sort-by-user option

---

## [1.20.0] — 2026-08-08

- **New** **Manager** role — a step below Admin, with review powers over proposals and staff, short of full admin access
- **New** News page's "Feed" tab shows a live stream of recent Tracker edits and comp-file changes as they happen
- **Fix** Discord login (and shared-playlist links) could land on a blank white page due to a broken asset path on nested URLs
- **Fix** 999 FM voting and song suggestions now show an accurate error when they don't actually register, instead of silently looking successful
- **Fix** Song suggestions for 999 FM now search the DJ's actual playable library, so a proposal always matches a real track instead of silently failing
- **Fix** 999 FM listener identity is now stable across reloads and multiple tabs, so vote thresholds aren't skewed by phantom duplicate listeners

---

## [1.19.3] — 2026-08-07

- **New** Heardle gained a real-time **1v1 mode** — match live against another player
- **New** Heardle **leaderboards** (Today / Streaks / 1v1) are now live
- **New** *(Desktop)* **Import Titles** — import a plain-text list of song titles as a synced playlist; each line is matched to a catalog song
- **New** *(Desktop)* `.m3u`/`.m3u8` files and title-list files can now be dropped straight onto the app window to import
- **Improve** Contributor file uploads (upload/replace/move) now run in the background via the Download manager instead of blocking the page you submitted them from

---

## [1.19.2] — 2026-08-04

- **New** Contributors (and admins) can propose a file replacement or deletion right from the Files browser's context menu, not just the dedicated Contributor page
- **Improve** Cover art now loads progressively — a fast low-res thumbnail paints first, then the full image swaps in

---

## [1.19.1] — 2026-08-03

- **Improve** The Contributor file/folder picker now shows the current path and clarifies "use this folder" when browsing to a move/upload destination

---

## [1.19.0] — 2026-08-03

- **New** **Contributor role** — apply to contribute, then propose file changes (upload, replace, move, delete) to the compilation for admin review, tracked from a new Contributor Profile page
- **New** Wrapped gained **All time / 30 days / 7 days** period filters and a recent-plays timeline

---

## [1.18.8] — 2026-08-02

- **New** **Gradient surfaces** — an opt-in accent-tinted gradient background for the app, sidebar, and player (Settings → Appearance)
- **Improve** *(Desktop)* ffmpeg and yt-dlp (used by Convert format and Import from URL) now download on first use instead of bundling with every install, shrinking the installer

---

## [1.18.7] — 2026-08-02

- **New** *(Web)* In-app "Download the app" page — live version and file-size info pulled straight from GitHub Releases, with automatic fallback to the newest release that actually has a macOS build if the latest one hasn't been built for Mac yet
- **Improve** Song info modal redesigned with a cleaner icon-chip layout for its metadata rows

---

## [1.18.4] — 2026-08-01

- **New** Song editor's File URL field gained a Browse button to pick a file straight from the API's file storage
- **Improve** Albums and Editor/Admin tabs can now be hidden from the mobile bottom nav and desktop side menu, like any other nav item
- **Improve** The Wrapped page loads dramatically faster — resolves your play history from one cached bulk fetch instead of a request per song
- **Fix** The collapsed player bar's thin progress line is now click/drag seekable
- **Fix** WRLD view's seek bar now responds to touch drags on mobile — previously only mouse dragging worked

---

## [1.18.3] — 2026-08-01

- **Improve** Heardle's daily clip now skips near-silent intros and song outros when picking where to start, for a fairer guess window

---

## [1.18.2] — 2026-08-01

- **New** Heardle gained **Personal** and **Unlimited** modes alongside Daily — adjustable difficulty (guess count, reveal ladder, start point), and Unlimited can filter by era/category
- **New** Heardle results can be copied to the clipboard to share, Wordle-style

---

## [1.18.1] — 2026-08-01

- **New** Heardle — a daily "name the song from its opening seconds" game, with a shared daily puzzle and a six-guess reveal ladder
- **New** "Wrapped" — an all-time listening stats page built from your play counts: top songs, totals, and more
- **New** API Docs page gained full-text search across every tab
- **Improve** Song editor's synced-lyrics field is now a line-by-line table (timestamp + text) instead of a raw LRC text box
- **Fix** A version-read error could whiteout Settings → About with a blank error screen

---

## [1.18.0] — 2026-07-29

- **Fix** Tracker grid/list rows no longer clip song text when Settings → App text size is scaled up

---

## [1.17.10] — 2026-07-28

- **New** Tracker gained a **Grid view** — a virtualized card layout mirroring juicewrldapi.com's own song cards
- **New** Song editor gained a "Basic" layout — a flat, quick-edit form as an alternative to the full card layout
- **Fix** WRLD view fullscreen no longer swallows the Escape key or blocks other overlays (Settings, equalizer, pickers) from opening on top of it

---

## [1.17.6] — 2026-07-28

- **New** Bulk edit — multi-select songs in the Tracker or tracks in the Library and edit shared fields (era, category, credits, and more) across all of them at once, with per-field replace/add/remove/append/fill/clear
- **New** The Library tab gained the same ctrl/shift multi-select the Tracker already had

---

## [1.17.5] — 2026-07-27

- **Improve** *(Desktop)* Application menu's Playback section reorganized into Seek / Volume & Speed / Crossfade submenus instead of one long list

---

## [1.17.4] — 2026-07-26

- **Improve** *(Desktop)* "Import from YouTube" generalized into **Import from URL** — paste a link from YouTube, SoundCloud, Bandcamp, a direct audio file, or any of ~1800 other sites to add it to your library
- **Fix** Album art now scales with the app text-size setting instead of staying pinned at a fixed size

---

## [1.17.3] — 2026-07-25

- **Improve** *(Desktop)* Discord Rich Presence now shows real cover art for local library files that match a catalog song, instead of the fallback logo

---

## [1.17.2] — 2026-07-25

- **New** *(Desktop)* Import from YouTube — download a video's audio straight into your local library (superseded by Import from URL in 1.17.4)

---

## [1.17.1] — 2026-07-24

- **New** Terms of Service and Privacy Policy pages, linked from Settings → About, plus a one-time notice explaining the app's local storage use

---

## [1.17.0] — 2026-07-22

- **New** *(Desktop)* macOS builds — signed DMGs for Intel and Apple Silicon are now built and published alongside the Windows and Linux releases
- **New** *(Desktop)* Import and export local playlists as M3U — importing matches each path to your scanned library and reports which tracks weren't found
- **Improve** *(Desktop)* The title-bar application menu now sits in its own reserved row, so it can never overlap page content

---

## [1.16.11] — 2026-07-22

- **Fix** *(Desktop)* WRLD view's top controls no longer overlap the title-bar application-menu button

---

## [1.16.10] — 2026-07-22

- **New** News feed — a dedicated News page with channels and article pages (starts empty until the backend feed goes live)
- **New** Skin editor gained an "Advanced" section for overriding the title-bar icon colors, so window controls stay legible on custom title bars
- **New** *(Web)* Mobile install prompt — a one-time nudge showing how to add the app to your home screen (one-tap install on Android, Share → "Add to Home Screen" steps on iOS)

---

## [1.16.9] — 2026-07-22

- **New** Custom skins — build your own theme from any preset, tweak its colors in a live editor, set a signature accent, and import/export skins as files to share
- **New** App-wide 999 FM vote popup — skip/queue votes now float over every view so you don't miss them while browsing another page
- **New** The top-of-sidebar controls (account, settings, info…) can now be reordered and individually hidden, like the nav items
- **New** *(Web)* The web app is now an installable PWA — add it to your home screen or desktop and it keeps working offline via a service worker

---

## [1.16.8] — 2026-07-22

- **New** Nav items can be shown or hidden individually in Settings → Appearance, and Liked Songs, API Docs, and Categories joined the reorderable nav list
- **Change** The standalone Categories page was folded into the nav instead of being a fixed top-level view
- **Improve** Opening Settings from a menu can now jump straight to a specific tab (e.g. Keyboard shortcuts, About)
- **New** *(Desktop)* The application menu can be placed in the title bar, in the side menu, or hidden, and gained a "Convert current song" entry

---

## [1.16.7] — 2026-07-22

- **New** *(Desktop)* A full application menu (File / Edit / View / Playback / Help) in the title bar — every entry mirrors a real action and shows its current keyboard shortcut
- **Improve** *(Desktop)* Settings "Clear cache" now also frees cached cover images and reports how much space it recovered
- **Improve** *(Desktop)* Playlist tiles show a live badge while downloading for offline, and a checkmark once complete

---

## [1.16.6] — 2026-07-21

- **Improve** "Change version" now opens as a side flyout from the song menu (matching "Add to playlist" and "File actions") instead of expanding inline, and its versions load only when you open it
- **New** "Prefer OG file" toggle added directly to the effects panel
- **Improve** Equalizer band tooltips now show the exact gain in dB
- **New** *(Desktop)* Optional "Show current song in the window title" — the taskbar / alt-tab label follows what's playing instead of just saying Unreleased

---

## [1.16.5] — 2026-07-21

- **New** Selectable app font in Settings → Appearance — System, Grotesk, Humanist, Wide, Serif, Mono, and Display, each previewing in its own typeface
- **New** Separate lyrics font, so lyric panels can use a different typeface from the rest of the app
- **Improve** Local-file context menu's file actions (convert, copy, move, delete) tidied into their own submenu
- **Improve** *(Desktop)* The player bar's equalizer button now routes to the pop-out window when the equalizer is already open there, instead of opening a second copy in-app

---

## [1.16.4] — 2026-07-21

- **New** App text size and lyrics text size are now adjustable separately in Settings → Appearance
- **New** Lyrics alignment option, plus a "blur upcoming lyrics" toggle
- **New** Equalizer panel gained a sleep timer and an audio-output picker, so playback settings live in one place
- **New** "Community edits" section in the equalizer panel — community-made edits (sped-up versions, remixes, mashups) will be playable from here once they go live
- **Improve** Admin tools now render as a tab inside the Editor Profile page instead of a separate top-level page
- **New** *(Desktop)* Local-file "File actions" menu — copy the file itself to the clipboard, copy its path, copy it to another folder, move it, or delete it (to the OS trash, with a confirmation)
- **New** *(Desktop)* The equalizer and the Convert-format dialog can each be popped out into their own window
- **Improve** *(Desktop)* Clicking the Settings icon while its pop-out window is open now closes that window instead of just refocusing it

---

## [1.16.3] — 2026-07-20

- **New** Last.fm scrobbling — connect your account in Settings → Playback and everything you listen to gets scrobbled to your profile

---

## [1.16.2] — 2026-07-20

- **Improve** Effects panel reworked — Reverb and Speed are now independent toggles instead of one combined "slowed + reverb" switch
- **New** "Pitch shift" option makes pitch follow playback speed — slowed below 1×, nightcore above
- **New** Shift+E toggles the equalizer panel (rebindable), and the WRLD view got its own equalizer button
- **Improve** "Skip silence" now jumps over silent stretches near-instantly instead of fast-forwarding through them, without clipping the start of the next sound
- **Fix** *(Desktop)* A download interrupted mid-release could poison the updater's cache and make every later update check fail — the bad cache is now detected and cleared

---

## [1.16.1] — 2026-07-20

- **New** Equalizer — 10-band EQ with 14 presets (Bass Boost, Vocal, Rock, Hip-Hop, Small Speakers and more), left/right balance, mono, and skip-silence, opened from a new button in the player bar
- **New** Slowed + reverb effect, with adjustable slowdown, reverb mix, and decay
- **Fix** "Change version" no longer lists linked versions that have no playable file
- **Change** *(Desktop)* New app icon
- **New** *(Desktop)* Local metadata editor gained many more tag fields — BPM, publisher, copyright, grouping, subtitle, key, ISRC, mood, comment, conductor, remix/original artist, and encoded-by
- **New** *(Desktop)* The local metadata editor can be popped out into its own window, and a metadata edit made in one window now updates the Library in every other window
- **New** *(Desktop)* "Remove metadata" option when converting a file's format — strips tags and cover art from the new file
- **Fix** *(Desktop)* "Edit metadata" now returns you to wherever you opened it from instead of always dropping you in the Library
- **Remove** *(Desktop)* The "notification tray" minimize mode (an always-pin-the-tray-icon experiment Windows wouldn't reliably honor) is gone — it falls back to plain "tray", and the icon can be pinned from Windows' own Taskbar settings

---

## [1.16.0] — 2026-07-19

- **New** The Files tab is now available on the web, not just in the desktop app
- **Fix** Tracker searches on mobile could randomly come back empty while typing
- **Fix** Playlist, folder, and song context menus now always stay fully on-screen and scroll when too tall, instead of getting clipped on short screens
- **Fix** iOS no longer zooms in when you tap a text field

---

## [1.15.14] — 2026-07-19

- **New** Pop-out windows (Settings, Song info, Song editor) can now be docked back into the main window
- **New** Back buttons on the Song editor, API Docs, and shared-playlist pages
- **Improve** Clicking Settings while it's already open now closes it
- **Fix** Song info now opens while 999 FM is playing, instead of doing nothing
- **Fix** Compact (version-group) views in the Tracker and Playlists now refresh immediately after a version edit made elsewhere in the app
- **Fix** Cover-picker search results are now filtered to actual matches for the search term
- **Remove** *(Desktop)* The "Pin now" tray button in Settings

---

## [1.15.12] — 2026-07-18

- **Improve** A playlist's track search collapsed into an icon that expands when clicked, freeing up the toolbar
- **Improve** The Tracker's compact-view toggle is now remembered between sessions
- **New** *(Desktop)* Settings, Song info, and the Song editor can each be popped out into their own window from an icon in their header, even when automatic pop-outs are turned off

---

## [1.15.11] — 2026-07-18

- **New** Files tab gained a media-type filter (All/Audio/Images/Videos)
- **New** Custom-cover picker now shows likely matching covers inline as soon as you open it, without needing the full "Browse API files" modal
- **Improve** Theme changes — including the dynamic "Now Playing" theme reacting to a new song — now smoothly cross-fade instead of snapping instantly
- **New** *(Desktop)* Settings → App has an "Online installer" tool bundled with the app for repair/reinstall even if the app itself won't launch
- **Fix** *(Desktop)* Pinning the tray icon no longer requires restarting Windows Explorer, and no longer briefly freezes the app while running

---

## [1.15.10] — 2026-07-18

- **New** A "Now Playing" theme option that dynamically colors the app to match the currently playing song's cover art
- **Rename** Editor-only accounts no longer see the Admin page — their tools moved into a new Editor Profile page, which gained a Reports tab
- **New** Song Info now shows a song's alternate titles ("Also Known As"), and the custom-cover search now checks those alt titles too
- **Fix** A song's custom cover now applies across all of its linked versions, so Now Playing shows the right art even when a sibling version is playing
- **Improve** *(Desktop)* "Force reinstall latest release" is now hidden behind Developer mode

---

## [1.15.9] — 2026-07-18

- **Fix** Browsing API files to pick a custom song cover now correctly selects image files
- **Fix** A song's "default version" star now correctly reflects and clears the version actually in use
- **New** *(Desktop)* DevTools can now be opened (via Diagnostics or F12 in developer mode) on any window, not just the main one

---

## [1.15.8] — 2026-07-18

- **Improve** Admin/Reports page no longer wipes filters and selection on refresh — shows a translucent overlay instead of a full-page spinner
- **New** Cover picker now seeds its search with the song's title so relevant covers show up immediately
- **Improve** Feedback/report submissions now show whether they actually reached the server or are just queued locally offline
- **Improve** *(Desktop)* Local library loads instantly on repeat visits to Library/Playlists instead of re-reading from disk every time
- **Improve** *(Desktop)* Mini player "solo" mode now fully closes other pop-out windows and hides the main window from the taskbar

---

## [1.15.7] — 2026-07-18

- **New** Custom song covers can now be picked by browsing the API's file storage, not just by pasting a URL/path
- **Fix** Changing a song's custom cover now updates the currently playing track's artwork immediately
- **Improve** Playlists view's search bar is now sticky while scrolling a playlist's track list
- **New** *(Desktop)* "Pop out mini player" button added to the WRLD view; the mini player gained a "Hide all other windows" button
- **New** *(Desktop)* Settings has a "Pin tray icon" button (Windows), which can offer to restart Windows Explorer to apply immediately

---

## [1.15.6] — 2026-07-17

- **New** Per-song personalization — set a custom name, cover art, and preferred default version for any song via a new "Personalize" section; tracks your own play count too
- **New** "Report issue" on any song, plus a "Feedback" tab in Settings for general feedback/bug reports
- **New** Admins and editors get a "Reports" tab to review and resolve user-submitted song issue reports
- **New** Playlist folders — organize playlists into folders, including nested folders
- **New** Star a linked song version from the "Change version" menu to make it the one that always plays for that song
- **New** *(Desktop)* "Convert format" on local files — transcode to MP3, M4A, Opus, OGG, FLAC, or WAV using the bundled ffmpeg
- **New** *(Desktop)* Option to keep the tray icon pinned/visible instead of Windows auto-hiding it into the overflow area

---

## [1.15.4] — 2026-07-15

- **New** Desktop player bar can now be collapsed to a slim strip showing just play/pause and track info
- **New** Library sidebar can be collapsed to icons-only, matching the main sidebar
- **New** Side menu order is now customizable — drag to reorder tabs in Settings → Appearance
- **Fix** Right-clicking the player bar now opens the context menu at the cursor instead of always anchoring to the "more options" button
- **Improve** WRLD view's queue panel got a visual refresh — larger panel with a glass sheen effect
- **New** *(Desktop)* Mini player "solo" option to hide every other app window while it's open
- **New** *(Desktop)* "Confirm before quitting while a song is playing" setting (skippable)
- **New** *(Desktop)* Individual pop-out windows (Settings, Song info, Song editor, Mini player) can now be toggled on/off in Settings
- **Fix** *(Desktop)* Pop-out windows now open on whichever monitor the app is actually on, instead of always jumping to the primary display
- **Improve** *(Desktop)* Library tab's cover art no longer resets and re-reads on every visit — only changed files re-read their art after a rescan

---

## [1.15.3] — 2026-07-15

- **New** Keyboard shortcuts are now fully rebindable — a new Settings → Shortcuts tab covers playback, volume, navigation, and app actions, with an adjustable skip-forward/back duration
- **New** *(Desktop)* Optional global (OS-wide) shortcuts so modifier/media-key shortcuts work even when the app isn't focused

---

## [1.15.2] — 2026-07-15

- **New** *(Desktop)* Restart-app shortcut, and a shortcut to close all pop-out windows at once
- **New** *(Desktop)* Backend support for customizable global (system-wide) keyboard shortcuts

---

## [1.15.1] — 2026-07-15

- **New** 8 selectable color themes in Settings → Appearance — Light, Dark, Midnight, Ocean, Ember, Mocha, Forest, and Blossom
- **New** Sidebar position is now configurable — left, right, top, or bottom
- **New** Tracker category/era filters are now multi-select, with individually removable filter chips
- **New** "Smooth fade when pausing" setting ramps volume down/up on pause/resume instead of cutting audio off instantly
- **Improve** *(Desktop)* Beta access codes are now validated against the server instead of a fixed list baked into the app
- **New** *(Desktop)* Mini player — a small always-available floating player window with playback controls, pinnable on top of other windows

---

## [1.15.0] — 2026-07-14

- **New** *(Desktop)* Opt-in beta (pre-release) update channel, unlockable with an access code in Settings
- **New** *(Desktop)* Settings can now be popped out into its own floating window
- **New** *(Desktop)* "Minimize to tray" and "minimize to notification area" options, in addition to the taskbar
- **Improve** *(Desktop)* Installing an update now happens silently in the background instead of popping up the installer wizard

---

## [1.14.8] — 2026-07-13

- **Fix** Files tab now remembers the last folder you were browsing when you switch tabs and come back
- **Improve** Diagnostics values are now clickable to view the full text in a popup
- **New** Editor page gained Length, Bitrate, and Date Leaked fields
- **Fix** Editors could get a 405 error when linking or updating song versions — now targets the correct API path
- **Improve** *(Desktop)* Local library scanning is now parallelized, noticeably speeding up scans of large libraries
- **New** *(Desktop)* Album art thumbnails are now cached to disk, loading instantly after the first time
- **Improve** *(Desktop)* Library tab's album art loads faster, avoiding redundant re-reads on scroll
- **Fix** *(Desktop)* Library tab's toolbar no longer made the window undraggable

---

## [1.14.7] — 2026-07-12

- **Remove** Tracker's grid view removed in favor of the newer detailed row view
- **Improve** Tracker's Producers tab now shows Engineers as a separate list alongside Producers
- **Fix** Bulk ZIP download from the Tracker now warns when some/all selected songs have no downloadable file
- **Fix** "Play" buttons now start from a random track when Shuffle is on, instead of always the first track
- **Fix** *(Desktop)* Discord Rich Presence cover art wasn't actually showing (wrong field) — now displays correctly
- **Fix** *(Desktop)* Discord Rich Presence now shows full era names (e.g. "WRLD On Drugs") instead of raw abbreviations

---

## [1.14.5] — 2026-07-12

- **New** Tracker gained a "Detailed" view mode — rows expand to show producers, engineers, locations, dates, leak type, bitrate, and more
- **Improve** WRLD view's version-switch notch redesigned as a slim tab/grabber
- **Improve** Editor page's Credits card now shows Producers and Engineers side by side
- **New** *(Desktop)* System tray now shows now-playing info with play/pause/next/previous/like controls

---

## [1.14.4] — 2026-07-12

- **Improve** App-wide performance overhaul — components only re-render on relevant state changes, reducing lag during playback
- **Improve** Rarely-visited pages (Editor, Admin, Docs, WRLD view, etc.) now load on demand instead of at startup
- **Improve** Editor and local-file metadata editor pages redesigned with a cleaner two-column layout
- **Improve** Large playlists now virtualize their track list, fixing slowdowns
- **Improve** Tracker's Producers tab now also includes engineer credits, without double-counting
- **New** *(Desktop)* Track info now reports bit depth, channel count, and file size for local files

---

## [1.14.3] — 2026-07-12

- **New** Editors can now propose a song's deletion from the Editor page, for admin review
- **New** *(Desktop)* Linux support — AppImage builds, in-app auto-update on Linux, Music-folder fallback

---

## [1.14.2] — 2026-07-12

- **New** Tracker gained a "Producers" tab to browse songs by producer credit (Calendar renamed to "Overview")
- **Improve** Diagnostics now shows much more detail — now-playing file info, playback settings, account/playlist stats, update status

---

## [1.14.1] — 2026-07-12

- **New** Diagnostics view (app/playback/storage/cache stats) via a new Developer Options toggle in Settings
- **Improve** Local playlists now show their custom cover image instead of always falling back to a track-art mosaic
- **Improve** WRLD view's "other versions" side tabs replaced with a compact dropdown
- **Improve** 999 FM toggle and fullscreen button grouped together
- **Fix** Lyrics panel no longer flashes to the top before snapping back when entering/exiting fullscreen
- **Improve** *(Desktop)* Updated the app icon

---

## [1.14.0] — 2026-07-11

- **Fix** "Find in Tracker" only appears when the file has a matching Tracker entry
- **Fix** Crossfade with Shuffle on could crossfade into an already-played track
- **Fix** Playback could stop dead after a crossfaded advance once the initially loaded queue page ran out
- **Fix** Seek bar could freeze at the wrong position when seeking with arrow keys
- **Fix** Playlist cover art now updates immediately after upload/removal
- **Remove** Quick "remove track" (X) button removed from playlist rows (still in the ⋯ menu)
- **Fix** Clicking a track in the queue's history/upcoming list could wipe your play history and break infinite-scroll loading
- **Improve** WRLD view's album version switcher is now a dropdown instead of tabs
- **Improve** Settings FAQ's documentation link now opens the in-app Docs view
- **Fix** Rapidly restarting Radio no longer leaves duplicate background track-fetch loops running
- **Fix** *(Desktop)* Discord Rich Presence progress no longer spams updates at 1.5×/2× playback speed
- **Fix** *(Desktop)* Offline playlist downloads no longer race each other — fixes duplicate downloads, spurious "syncing" popups, and files getting deleted/re-downloaded
- **Fix** *(Desktop)* A dropped connection during a download (update or offline track) could leave a corrupted file treated as complete — downloads now verify fully before replacing the real file
- **Fix** *(Desktop)* Checking for updates could crash with a cryptic error when GitHub's API rate-limited the request

---

## [1.13.7] — 2026-07-11

- **New** Files in the API file browser can now be liked — liked files show up in Liked Songs
- **New** Tracker's Calendar tab can now also browse songs by recording studio/location
- **Improve** File browser row quick actions moved into the right-click context menu
- **Improve** Clicking the album art in the player bar now always opens the WRLD view
- **New** Multi-selected playlists can now be merged into another playlist
- **Fix** Playlist card context menu could render partly off-screen — now clamped to the viewport
- **New** *(Desktop)* Settings shows total offline-download count and size, with a refresh button
- **Fix** *(Desktop)* Offline library storage size shown in Settings could be inaccurate — now reads actual file sizes off disk

---

## [1.13.6] — 2026-07-11

- **Fix** Clicking a song row outside select mode no longer accidentally toggles selection
- **Improve** *(Desktop)* Adding songs to an offline-downloaded playlist now downloads the new songs right away instead of waiting for the next sync

---

## [1.13.5] — 2026-07-11

- **New** Playlists can now be multi-selected in the library grid, with a bulk "Delete" action bar
- **New** API Files browser supports ctrl/cmd-click to multi-select files/folders
- **Fix** Tracker's Calendar tab no longer shows implausible recording dates parsed from free text
- **Improve** Tracker's Calendar tab now remembers the last month you were viewing
- **New** *(Desktop)* Launching the app while it's already running now just focuses the existing window

---

## [1.13.4] — 2026-07-11

- **Fix** Tracker's song list/grid and compact view could hang/freeze with the full catalog loaded — now virtualized
- **Fix** Compact (grouped-versions) view could show the same song listed twice within a group
- **New** WRLD queue panel now has a collapsible "History" section
- **New** Settings has a "Clear cache" button to remove cached API responses used for offline browsing
- **Fix** Caching the full song catalog for offline use could silently fail and wipe the existing offline cache

---

## [1.13.3] — 2026-07-10

- **New** Tracker has a new "Calendar" tab that groups songs by recording date, color-coded by era
- **Improve** Lyric search results now show a highlighted snippet of the matching lyric
- **New** Searching in the Tracker now updates the URL, so back/forward and shared links restore a specific search
- **New** "Prefer OG version" setting — automatically switches to a track's linked OG-quality version when one exists
- **Improve** Seek bar dragging is smoother (only seeks on release, larger drag area)
- **Improve** The 999 FM "···" menu now offers a full context menu (song info, add to playlist)
- **Improve** Tracker's compact (grouped-versions) view loads much faster with a large catalog
- **Improve** *(Desktop)* Discord Rich Presence now falls back to a track's own file cover art when no curated image is set

---

## [1.13.2] — 2026-07-10

- **New** Tracker has a new "Lyric Search" tab — search songs by lyric content
- **Improve** Sorted views in the Tracker load faster (pages fetch in parallel)

---

## [1.13.1] — 2026-07-08

- **New** Tracker, API Files, and Playlists now load instantly from cache and stay browsable offline
- **Fix** Clicking "Edit" on a song could briefly flash the "My Proposals" screen before the editor loaded
- **New** *(Desktop)* Settings has a "Diagnostic logs" button to open the folder containing crash/run logs
- **New** *(Desktop)* The app now keeps a rolling run log (plus the previous run's log) to help diagnose crashes
- **Fix** *(Desktop)* Closing the app window always quit it even with "minimize to tray" enabled — now correctly minimizes

---

## [1.13.0] — 2026-07-08

- **New** The app now stays browsable offline — songs, playlists, favorites, and profile data fall back to the last cached response when the network is unavailable

---

## [1.12.13] — 2026-07-08

- **Fix** Bulk "Add to queue"/"Add to playlist" now require every selected song to be eligible
- **Fix** Seek bar dragging/seeking could break for streams with an unknown duration
- **Fix** Sidebar navigation now scrolls instead of overflowing when there are more items than fit the window
- **Fix** *(Desktop)* Seeking in local audio/video files now properly returns partial-content (byte-range) responses, fully fixing seeking

---

## [1.12.11] — 2026-07-07

- **Fix** Admin-only accounts clicking "Edit" were sent to the "apply to be an editor" screen — admins can now edit directly
- **Improve** Sidebar collapse/expand now animates smoothly instead of popping instantly
- **Fix** *(Desktop)* Seeking in locally-played audio/video re-fetched the whole file from byte 0 instead of jumping to the requested position (fully fixed in 1.12.13)

---

## [1.12.10] — 2026-07-07

- **Fix** Editor's song loader now shows a "Couldn't load song" message with a retry button instead of silently bouncing you to My Proposals
- **Fix** Playback progress bar could get stuck at 0% for streams where the duration isn't known yet
- **Improve** *(Desktop)* Library view's "frosted glass" redesign was reverted back to the app's standard look
- **Fix** *(Desktop)* Offline playlist download progress now only counts tracks actually missing

---

## [1.12.9] — 2026-07-07

- **Improve** Reopening a playlist now shows its cached tracks instantly while quietly refreshing in the background

---

## [1.12.8] — 2026-07-07

- **Improve** Editors landing on the editor page with no song selected are now sent to "My Proposals" instead of a blank placeholder
- **New** *(Desktop)* Desktop Library completely redesigned with a frosted "glass" look — browse by Recently Added, Artists, Albums, or Songs
- **New** *(Desktop)* Local files can now be edited via a full-page metadata editor, with tag writing for MP3s
- **New** *(Desktop)* Individual songs can be downloaded for offline playback from the context menu; Download Manager shows live speed and byte progress
- **New** *(Desktop)* Library can auto-refresh changed files in the background
- **Improve** *(Desktop)* Local library scans now skip files unchanged since the last scan

---

## [1.12.7] — 2026-07-07

- **Fix** *(Desktop)* Local audio/video files failed to load in dev builds ("Not allowed to load local resource") — now served through a custom protocol that also works in packaged builds

---

## [1.12.6] — 2026-07-07

- **New** Editors can now resubmit a stuck proposal from My Proposals
- **Improve** Songs now display a dedicated album field (when the API provides one) instead of always falling back to the era name
- **New** *(Desktop)* Offline-downloaded tracks show a badge in playlist views; Settings lets you change the offline songs storage folder (switching moves files instead of re-downloading)
- **Improve** *(Desktop)* Offline playlist downloads now show live progress in the Download Manager

---

## [1.12.5] — 2026-07-05

- **Fix** Native dropdown menus had unreadable option text in dark mode — now consistently dark text on white
- **Fix** API requests now bypass the browser cache, preventing stale data from showing after edits
- **New** *(Desktop)* Playlists can now be downloaded for full offline playback — stays synced automatically on focus and every 15 minutes

---

## [1.12.4] — 2026-07-05

- **New** WRLD view now shows a song's other linked versions as peeking "bookmark" tabs on the album art
- **New** Right-click synced lyrics to download them as a .lrc file
- **Improve** Bottom nav and sidebar now list "WRLD" before "Tracker"
- **Fix** *(Desktop)* Downloads trigger and Albums Admin header no longer overlap the window title-bar controls

---

## [1.12.3] — 2026-07-04

- **Fix** Bulk "Add to queue" is now disabled with an explanatory tooltip when the whole selection is unplayable
- **Improve** Lyrics sync offset now adjusts in finer 0.1s steps
- **Fix** *(Desktop)* WRLD fullscreen toggle button repositioned now that the window title bar is hidden during fullscreen

---

## [1.12.2] — 2026-07-04

- **New** Lyrics sync offset setting in Settings — nudge synced lyrics earlier or later
- **New** Sidebar shows a "Download app" link for web users, pointing to the desktop app's latest release

---

## [1.12.1] — 2026-07-04

- **New** WRLD view now has its own audio output device picker
- **New** Tracker's compact view now shows a category badge for each grouped song
- **Fix** Right-click menus now clamp to their actual rendered size instead of a rough guess
- **Fix** *(Desktop)* Native window title-bar controls are now hidden while WRLD fullscreen is active

---

## [1.12.0] — 2026-07-04

- **Fix** Bulk "Add to queue" now skips unplayable songs
- **Improve** Playlist covers now load instantly from cache when reopening a playlist
- **Improve** Queue panel's "+N more" is now a button — click to reveal more upcoming tracks
- **Fix** Play / Play next / Add to queue are hidden in the context menu for unplayable tracks
- **Improve** WRLD view's fullscreen and 999 FM toggle buttons restyled
- **Improve** WRLD view's queue now takes over the full right column instead of floating as a small overlay
- **New** *(Desktop)* Local library tracks with no matching API song can now be added to on-device playlists

---

## [1.11.11] — 2026-07-03

- **New** Editor profile: proposal list now has a search box
- **Improve** Tracker compact view: sorting moved from a dropdown to clickable column headers
- **Fix** Tracker compact view could freeze when selecting many songs across expanded groups
- **Fix** Playlist header's "⋯" menu could get clipped or overflow the screen
- **Fix** Song context menus could spill off-screen near a window edge

---

## [1.11.10] — 2026-07-03

- **New** Tracker compact view: sort version groups, and right-click a group to bulk-act on all its versions
- **New** Playlists: right-click a playlist for a full context menu — play all, queue all, download ZIP, share, rename, delete
- **New** Multi-select tracks within an open playlist to bulk add to queue/playlist or remove
- **Improve** Playlist header's action buttons are now grouped into a single "⋯" menu
- **Improve** Navigating away from an open playlist and back no longer resets you to the playlist list
- **Improve** WRLD view: mute now restores your previous volume instead of resetting to 50%
- **Fix** Playback could silently get stuck at the end of a track on mobile with the screen locked
- **Fix** Song info modal could render clipped when opened from certain panels
- **Fix** WRLD view: the song "..." menu could fail to close when clicking its own toggle button

---

## [1.11.9] — 2026-07-03

- **Fix** Tracker/Playlists compact view: version groups no longer silently go missing for large catalogs
- **Fix** Tracker compact view search now matches producers, engineers, era, notes, and more; ignores apostrophes
- **Fix** *(Desktop)* WRLD view fullscreen button repositioned so it no longer overlaps the window control buttons

---

## [1.11.8] — 2026-07-02

- **Fix** Tracker/Playlists compact view now respects the search box
- **Fix** WRLD view lyrics: the enlarged active line no longer gets clipped near the panel's edge
- **Improve** Volume percentage tooltip is now larger and easier to read
- **New** Playlists compact view: individual tracks can now be removed from the playlist directly

---

## [1.11.7] — 2026-07-02

- **New** Files view: recursive search across the whole file tree
- **New** Playlists: "Compact" view collapses tracks that share a version group into one row
- **Improve** Tracker: bulk "Add to playlist" now excludes session/unsurfaced songs and marks playlists that already contain the whole selection
- **Fix** WRLD view queue no longer pushes the player controls off-screen on short windows
- **Fix** Native dropdowns now follow the app's light/dark theme instead of the OS's

---

## [1.11.6] — 2026-07-02

- **New** Song context menus everywhere now include "Change version" — jump straight to a linked version
- **Improve** Right-click/options menus for songs are now consistent across every view
- **Improve** Song info modal text can now be selected and copied

---

## [1.11.5] — 2026-07-02

- **Improve** Tracker compact view group rows now show the group's cover art
- **New** Linking songs as versions now prompts you to name the group if it doesn't already have a title
- **Fix** Tracker compact view no longer silently kept loading the entire song library in the background

---

## [1.11.4] — 2026-07-01

- **New** Tracker: "Compact" view collapses songs into their version groups
- **Improve** Multi-select no longer needs a separate "Select" button — click any song row to start selecting
- **New** Editor page: version title field now autocompletes existing titles

---

## [1.11.3] — 2026-07-01

- **Improve** Editor page: song version fields now save via an explicit button instead of auto-saving on blur
- **Remove** Song info modal no longer lets you search and link new versions inline — do this from the editor instead
- **Fix** Light mode: muted/secondary text is now darker for better readability

---

## [1.11.2] — 2026-07-01

- **Improve** Editor page: song version label is now free text instead of a number; version title now applies to every linked version at once

---

## [1.11.1] — 2026-07-01

- **Fix** Editor/Song info: linking or unlinking a song version now shows an error message on failure

---

## [1.11.0] — 2026-07-01

- **New** Tracker bulk-selected songs can now be right-clicked for the same actions, plus a "Link versions" bulk action for editors
- **New** Editor page: link/unlink song versions and set a version number/title without leaving the edit form
- **Improve** Song info modal: linked versions now show their version number/title

---

## [1.10.16] — 2026-07-01

- **New** Tracker: multi-select mode — select multiple songs to add to queue, add to a playlist, or download as a ZIP in bulk

---

## [1.10.14] — 2026-07-01

- **New** Song info modal: link songs together as "Other Versions" (e.g. v1/v2/TV Mix) and jump between them

---

## [1.10.12] — 2026-07-01

- **New** Song info modal now has an Edit button for editors, wired up across every view
- **New** Recording-session songs (Tracker) can now be downloaded as a ZIP from the context menu
- **New** Song info modal now shows a song's alternate names
- **New** WRLD view lyrics: manual scroll to browse the full lyric sheet, with a "Resume" button
- **Fix** Liked Songs: "Play next" now actually plays the track next instead of appending to the end
- **Fix** *(Desktop)* Discord Rich Presence now clears entirely while paused instead of showing a frozen progress bar, and now shows the track's era, with an era tooltip on the cover art

---

## [1.10.11] — 2026-07-01

- **Improve** Settings redesigned again with a sidebar tab list (Appearance/Playback/Library/App/About)

---

## [1.10.10] — 2026-07-01

- **Improve** Settings redesigned with grouped, iOS-style sections and toggle switches
- **Improve** Library page: playlists are now split into "Playlists" and "On This Device" sections
- **Improve** WRLD view "Playing Next" queue now pops up inline under the player instead of a separate side panel

---

## [1.10.9] — 2026-07-01

- **New** Playlists: full-bleed blurred cover art now sits behind the playlist header (Apple Music style)
- **New** Playlists: circular Play/Shuffle buttons on playlist headers, and a hover play button on playlist grid tiles
- **New** Sidebar: playlists list expands under the "Playlists" nav item for one-click access
- **New** WRLD view: fullscreen now uses real OS/browser fullscreen instead of just an in-app overlay
- **New** WRLD view: "Playing Next" queue panel — view and drag-to-reorder the upcoming queue
- **Improve** Media lightbox: image/video controls now float above the media
- **Fix** WRLD view lyrics: active line no longer appears to snap bold partway through the highlight transition
- **New** *(Desktop)* F11 toggles fullscreen, and the UI stays in sync with fullscreen entered/exited by any means

---

## [1.10.8] — 2026-07-01

- **New** WRLD view: fullscreen toggle button (Escape to exit)
- **Remove** WRLD view song menu: removed the "Play Next" option
- **Fix** WRLD view: active lyric line no longer causes a late "pop" when growing — now animates via a smooth scale transition
- **New** *(Desktop)* Discord Rich Presence now shows the track's cover art
- **Fix** *(Desktop)* Discord Rich Presence now catches up immediately after a seek instead of leaving the countdown anchored to the pre-seek position
- **New** *(Desktop)* Liked Songs now includes liked local library tracks, with a working context menu for them

---

## [1.8.8] - 2026-06-26

- **New** Context menus: Add to Library option — downloads song for offline/local playback to ~/Music/JuiceWRLD Library/
- **New** Add to Playlist menu: shows a check icon next to playlists that already contain the song
- **New** Player bar: right-click opens the context menu
- **New** Player bar: Edit metadata option for local tracks
- **Fix** Tracker: songs now always display their primary name (song.name) instead of alternative/variant titles
- **Fix** WrldView: synced lyrics now animate in when the active line changes
- **Fix** Local playlists: context menus were invisible due to overflow clipping — fixed with portal rendering

---

## [1.10.6] — 2026-07-01

- **New** WRLD view: "···" context menu on the current track (Apple Music-style)
- **New** WRLD view: synced lyrics scroll with a smooth GPU-composited animation instead of choppy native smooth-scroll
- **Fix** Discord Rich Presence showed a bogus ticking timer while paused — now switches activity type correctly
- **Fix** Lyrics could leak from one song to another when the API's `?song=` filter was ignored
- **Fix** Shuffle could play a different track than the one shown as "up next" during crossfade
- **Fix** Editor song edits / proposal approvals could be momentarily clobbered by a race with the currently-playing track prefill
- **Improve** Lyrics are now cached per session — fewer redundant API calls on replay

---

## [1.8.9 – 1.10.5] — 2026-06-26 to 2026-06-30

- **New** Discord Rich Presence — shows your currently playing track (or 999 FM stream) on your Discord profile, with a live progress bar; toggle in Settings
- **New** Albums Admin view — add, edit, and reorder albums, versions, and tracklists
- **New** "Propose new song" flow for editors — submit full song details for admin review
- **New** Virtualized scrolling for large song/album lists — fixes slowdowns with thousands of tracks
- **New** 999 FM: mobile background watchdog keeps playback alive when the tab/app is backgrounded
- **New** Shuffle now reshuffles the upcoming queue each time a track starts
- **New** Synced lyrics animate smoothly instead of jumping in chunks
- **Fix** Crossfade/pause race conditions that could leave audio playing after pause
- **Fix** Stale track info "bleeding into" the next song on fast skips
- **Fix** 999 FM vote popup sometimes failed to reopen or reset your vote unexpectedly
- **Fix** Editor proposal "Additional info" field overwrote the wrong data on submit

---
## [1.7.3] — 2026-06-22

- **Fix** Mobile lock screen now shows track title, artist, and cover art via Media Session API
- **Fix** Lock screen / notification shade play, pause, and skip controls now work
- **Fix** Lock screen seek bar syncs with playback position
- **Fix** 999 FM mode: lock screen metadata updates to currently playing FM track
- **Bump** Version to 1.7.3

---

## [1.7.2] — 2026-06-22

- **Fix** Media Session API wired up in Player — metadata and action handlers added

---

## [1.7.1] — 2026-06-22

- **Remove** RadioFmView (old dedicated 999 FM page) and radioLibrary.ts — FM controls now live in the WRLD view
- **Remove** 999 FM entry from bottom nav
- **Remove** `/999-fm` URL route and `radio-fm` ViewType

---

## [1.7.0] — 2026-06-22

- **New** WRLD view: 999 FM live radio integration — toggle streams live audio with real-time metadata (cover art, title, artist, elapsed/duration)
- **New** WRLD view: FM seek bar ticks in real time using a local 500 ms timer synced to `elapsed_ms` from the WebSocket
- **New** WRLD view: FM mode Radio/Lyrics tab panel — vote to skip, suggest next song, view up-next and queue preview
- **New** WRLD view: FM song lookup — matches now-playing title to API song for cover art and lyrics display
- **Fix** WRLD view: seek bar no longer goes gray in FM mode (removed `disabled` attribute that triggered browser-native styling)
- **Improve** WRLD view: fully responsive — stacked layout on mobile (compact art + title header, scrollable content below), side-by-side on desktop unchanged

---

## [1.5.9] — 2026-06-20

- **Fix** Playlists: description edit trigger was invisible (opacity-0 button); now shows at 40% opacity and brightens on hover
- **Improve** Playlists: pencil icon appears on cover hover to indicate the image is editable (replaced Camera icon)
- **Fix** Shared playlists: rewrote track parser with `isApiSongLite` type guard — handles plain path arrays, full `ApiSongLite` arrays, `items[].song` pattern, and path-keyed objects; shared pages no longer show empty

---

## [1.5.8] — 2026-06-20

- **New** Playlists: upload a custom cover image — click the cover art to open a file picker; uploaded via multipart/form-data PATCH
- **New** Playlists: add and edit a description — click the area below the title to add one, click again to edit, Enter saves, Escape cancels
- **New** Playlists: remove cover image (resets to auto-generated mosaic)

---

## [1.5.7] — 2026-06-20

- **New** Queue: radio mode view — when radio is active, the upcoming section shows only the pre-fetched next track with a pulsing "Finding next song…" indicator instead of a reorderable list
- **New** Player: 3-dot context menu now includes "Play Next" (queues song immediately after current) and "Song info" (fetches and shows full song detail modal)
- **Improve** Player: heart ♥ and 3-dot ··· buttons are now inline with the song title — they follow the natural text width instead of sitting at a fixed position
- **Improve** Queue: toggling shuffle on while a tracker song (`jw-*`) is already playing now starts radio mode instead of shuffling the queue
- **Fix** Player: repeat-one restarts the current audio element directly — no longer calls `nextTrack()`, so song info stays correct
- **Fix** Tracker: category badge shown on row hover; clicking an era in the sidebar sets the era filter correctly
- **Rename** Settings: "Categories" filter label renamed to "Search Settings"

---

## [1.5.4] — 2026-06-20

- **New** Playlists: right-click any track for a context menu — Play, Add to Queue, Song Info, Add to Playlist, Remove, Download
- **New** Playlists: drag tracks to reorder (replaces up/down arrow buttons)
- **New** Playlists: zip and download all API tracks in a playlist at once
- **New** Playlists: share a playlist via a public link (copy link button in hero)
- **New** Playlists: right-click a playlist card in the library to add all its songs to another playlist
- **New** Playlists: add all songs from the open playlist to another playlist (folder icon in hero)
- **New** Shared playlist view — opening a share link shows a read-only playlist anyone can play

---

## [1.5.3] — 2026-06-19

- **New** Playlist page: full Spotify-style hero — large 2×2 cover mosaic, gradient background, bold name, song count + total duration, Play and Shuffle buttons
- **New** Player: next song preloads into the inactive audio slot while the current track plays — no gap on track change (linear/repeat modes)
- **Improve** Playlist library grid: refined card design with hover effects and better placeholder art

---

## [1.5.2] — 2026-06-19

- **Fix** Tracker: songs show on initial load (debounce was clearing songs 400 ms after mount)
- **Fix** Tracker: infinite scroll accumulates songs correctly as you scroll
- **Fix** Tracker: category sidebar is scrollable so all eras are reachable
- **Fix** Tracker: sorting loads the full library client-side — first click asc, second desc, third clears sort
- **Fix** Queue: shuffle/random mode excludes unsurfaced tracks by default
- **Fix** Tracker: duration column right-aligned with tabular-nums; `--:--` for unknown durations
- **Fix** Tracker: "Add to queue" removed from song row (context menu only)
- **New** Queue: playing with no filters shows a "Random mode" label in the queue panel
- **New** Queue: playing with filters lazy-loads the queue — starts with 50 songs, auto-fetches more as tracks end
- **New** Lyrics: editor-only hint hidden for regular users

---

## [1.5.0] — 2026-06-19

- **New** Tracker: infinite/endless scroll — songs load automatically as you scroll; no page buttons
- **New** Context menu — right-click any song (or tap ···) to: Song info, Add to queue, Add to playlist, Show in Files, Download, Edit (editors/admins only)
- **New** Sidebar: collapsible to icon-only strip — click the chevron at the bottom to collapse/expand; state persists
- **Fix** Search now finds producer names — uses `searchall` API param
- **Fix** Sorting works correctly — column header clicks sort the full dataset via the API
- **Remove** GitHub and Discord links removed from sidebar (still in Settings)

---

## [1.4.0] — 2026-06-18

- **Remove** Radio tab and toggle button removed (re-implemented as radio mode in v1.5.7)
- **Fix** Repeat-one: track info, title, artist, and cover art no longer disappear when a song replays
- **Fix** Files / Compilation: artist and cover art show reliably; broken cover falls back to music note icon
- **Fix** Tracker: track names no longer disappear when the Now Playing panel opens

---

## [1.3.9] — 2026-06-18

- **New** Radio mode: 📻 toggle button in the player bar — when on, a fresh random queue loads when the current queue ends
- **New** Tracker: click any column header to sort (Title, Artist, Era, Category, Time); click again to reverse
- **Fix** Tracker: removed era dropdown and "By album" toggle — era filter lives in the category sidebar
- **Fix** Player bar and Now Playing: track info and cover art show correctly for Files and Compilation tracks
- **Fix** Now Playing: title and artist always visible when artwork is collapsed, even for tracks without cover art
- **Fix** Queue panel: unknown-duration songs show `--:--` instead of `0:00`
- **Fix** Favicon: resized and auto-cropped — no longer tiny in browser tabs
- **Improve** App name wordmark: slightly heavier font weight
- **Improve** Audio output picker: re-enumerates devices with permission prompt on playback start

---

## [1.3.8] — 2026-06-18

- **New** Site favicon — browser tabs now show the unreleased logo
- **New** Tracker: collapsible category sidebar (desktop) with song counts and era list
- **New** All song lists have consistent action buttons — Info, Add to Queue, Download across Tracker, Compilation, Radio, and Files
- **Fix** Radio: builds a full ~14-song random queue upfront; no longer stops after 2 songs
- **Fix** Now Playing: cover art and info show correctly when playing from Compilation or Files
- **Fix** Settings: "Become an Editor" hidden for users who are already editors/admins
- **Improve** Nav: removed Categories (now inside Tracker) and Contribute (pencil icon in Now Playing)

---

## [1.3.7] — 2026-06-17

- **Fix** Contribute: date fields strip API-prepended words like "Recorded"
- **Improve** Contribute: Category is now a dropdown
- **New** Contribute: Additional information pre-filled from API into Context/Story field
- **New** Contribute: Lyrics and Synced Lyrics fields added

---

## [1.2.9] — 2026-06-17

- **Fix** Compilation: album covers now load correctly (lazy per-folder fetch)
- **Fix** Compilation: Singles tab falls back to Tracker API released songs when no folder found
- **Fix** Compilation: Unreleased tab falls back to Tracker API when no folder found
- **New** Compilation: Studio Albums & Mixtapes split into separate labeled sections
- **New** Supabase database — supplemental song data layer for editors

---

## [1.2.8] — 2026-06-17

- **New** Compilation tab — browse Studio Albums & Mixtapes, Unreleased, and Singles with album grid and track file list views
- **Fix** Song info modal: duration no longer duplicated, empty fields hidden, unsurfaced songs without files have no play button
- **Improve** Song info modal UI overhaul — blurred hero backdrop, clean label/value rows, grouped sections

---

## [1.2.7] — 2026-06-17

- **Improve** Song info modal now shows all available API data — engineers, recording locations, recording dates, file names, instrumentals, additional info, important dates, session info, notes, and bitrate — each in a collapsible section

---

## [1.2.6] — 2026-06-17

- **New** Song info modal — click ℹ on any song in the Tracker (or double-click the row) to see all details: titles, alt names, artists, producers, era, category, duration, leak type, date, and lyrics
- **New** Files info button now opens the song info modal instead of jumping to the Tracker
- **New** Become an Editor page — accessible from Settings (placeholder for now)
- **Improve** "unreleased" wordmark redesigned — thin Josefin Sans, wide letter-spacing

---

## [1.2.5] — 2026-06-17

- **Improve** Tracker: clicking a category badge now filters by that category in place instead of navigating to the Categories view
- **Improve** Code cleanup and dead code removal in preparation for next release

---

## [1.2.4] — 2026-06-17

- **Fix** Mobile bottom nav labels now visible — inactive tab text was inheriting no color (appeared black on dark sidebar)
- **Improve** Mobile nav icons slightly larger (24px); sidebar logo bigger (h-32)

---

## [1.2.3] — 2026-06-17

- **Fix** Mobile bottom nav labels no longer hidden on small screens — text truncates cleanly instead of overflowing
- **Improve** Changelog removed from Settings — cleaner About section

---

## [1.2.2] — 2026-06-17

- **Fix** Mobile bottom nav no longer hidden by the browser address bar — uses dynamic viewport height and safe-area insets
- **Improve** Logo is larger in the sidebar

---

## [1.2.1] — 2026-06-17

- **Improve** Files: play audio by clicking the cover art or double-clicking the row — standalone play button removed
- **New** Files: info button on audio files — searches the Tracker for that song and jumps straight to it

---

## [1.2.0] — 2026-06-17

- **New** Deep URL routing for Files — navigating into a folder updates the URL to /files/FolderName/SubFolder; paste or refresh any folder URL to land directly in it
- **New** Copy link button on every file and folder — chain icon copies the direct stream URL (files) or shareable app URL (folders)
- **New** URL-based view routing — the address bar now shows /categories, /tracker, /radio, or /files as you navigate
- **New** GitHub link added to the sidebar (desktop) and Settings About section (mobile)

---

## [1.1.7] — 2026-06-17

- **Fix** View mode (list/grid), sort order, column visibility, and scan filters now persist across restarts
- **New** Eras section in the Categories view — browse all eras as cards, click any to open the Tracker filtered by that era
- **New** Category badges in the Tracker are now clickable — click to jump to the Categories view
- **New** "By album" toggle in Tracker and Categories — groups songs by era/album with section headers; default off, persists across sessions

---

## [1.1.6] — 2026-06-17

- **Fix** API track cover art, album, and era info now show up correctly in the player bar and Now Playing panel
- **Fix** App now opens directly on the Tracker when API mode was last active — no more landing on the local library
- **New** Lyrics fetched from the API when streaming a song that has no embedded lyrics
- **New** Categories view in API mode — browse Released, Unreleased, Unsurfaced, and Sessions with song counts, click to open the Tracker pre-filtered
- **New** Download button on every file in the API Files browser — saves to the Downloads folder (or a custom folder set in Settings)
- **New** Sort by name, type, or size in the API Files browser — sort settings persist across sessions

---

## [1.1.5] — 2026-06-17

- **New** Image viewer — click any image in the file browser to open a fullscreen lightbox with arrow-key navigation and a filmstrip
- **New** Video player — click any video file to play it inline in the app, with a fallback download link for unsupported formats
- **New** Grid view for both file browsers (local and API) — toggle between list and card grid with thumbnails
- **Improve** Local file browser now shows images and videos alongside audio files (not just audio)

---

## [1.1.4] — 2026-06-17

- **New** API Files — browse the Juice WRLD API filesystem directly from the sidebar in API mode
- **New** Play any audio file from the API browser with cover art and a full directory queue

---

## [1.1.3] — 2026-06-17

- **New** File browser — navigate your local filesystem and play audio files directly
- **New** Tracker grid view — toggle between list and card grid layout with the view switcher
- **New** Jump-to-page in Tracker — click the page number and type any page to jump instantly
- **Improve** Error boundary now shows full crash details, stack trace, copy button, and saves a crash log to disk
- **Improve** Local playlists hidden in API mode for a cleaner sidebar
- **Fix** Edit song button hidden in API mode (editing API tracks is not supported)
- **Fix** Windows taskbar icon now correct size (multi-resolution .ico)
- **Fix** Volume slider now vertically centered in the player bar

---

## [1.1.2] — 2026-06-17

- **New** Local / API mode toggle in sidebar — switch between your local library and the Juice WRLD API
- **New** Tracker — browse and search thousands of songs from the API with category and era filters
- **New** Radio — plays a random song from the API; skip to get another

---

## [1.1.1] — 2026-06-17

- **New** Playlists page is now sortable — sort by Name, Date added, or Custom order
- **New** Provider status dots now ping the URL and turn green (online) or red (offline)

---

## [1.1.0] — 2026-06-17

- **New** Providers section in Settings — add URLs for external services, with a status indicator light per provider (live status checks coming soon)

---

## [1.0.9] — 2026-06-16

- **New** Playlists page — click Playlists in the sidebar to see all playlists as a cover art grid
- **New** Synced lyrics tab in Lyrics view (editor coming soon)
- **Improve** Lyrics view: song list now shows cover art thumbnails and tighter layout
- **Improve** App name "unreleased" now has letter spacing for a cleaner look
- **Fix** Pen icon in Now Playing panel now correctly opens the metadata editor

---

## [1.0.8] — 2026-06-16

- **New** Lyrics browser — browse all songs' lyrics and full-text search across your library
- **New** Albums list view — toggle between grid and list, with customizable columns
- **New** Playlist large list view — see cover art thumbnails next to playlist names in the sidebar
- **Fix** Clicking artist name in the player bar now navigates to their artist page
- **Fix** Version saved in About now persists across app restarts
- **Improve** Scan Filters section in Settings is now collapsible

---

## [1.0.7] — 2026-06-16

- **New** Liked Songs — heart button in player bar, Liked Songs page in sidebar, persists across restarts
- **New** Metadata editor shows bitrate, sample rate, bit depth, channels, and file size
- **New** Clicking genre text in song rows navigates to that genre's page
- **New** Sort by Genre column now works
- **Fix** Editing another song's metadata no longer changes the currently playing song's album cover
- **Fix** Artist and album clickable area no longer spans the full column width
- **Fix** Creating folders inside folders now works inline — no more broken prompt dialog
- **Improve** Genre card colors are now vivid and correct in both light and dark mode

---

## [1.0.6] — 2026-06-16

- **New** Nested playlist folders — folders within folders (inception mode)
- **New** Playback speed control (0.5×–2×) in player bar, persists across restarts
- **New** Genre right-click context menu — Play, Add to queue, Add to playlist
- **Fix** Seek bar no longer makes noise while scrubbing — audio only seeks on mouse release
- **Fix** Left-click now selects songs; right-click is purely for the context menu
- **Fix** Metadata editor opens correctly again
- **Improve** Folder rows are now larger and bolder than playlist rows in the sidebar
- **Improve** Genre card colors are now readable in light mode

---

## [1.0.5] — 2026-06-16

- **New** Playlist folders — group playlists into collapsible folders
- **New** Pin playlists to the top of the sidebar
- **New** Sort playlists by name, date added, or custom order
- **New** Add entire playlist to queue from sidebar context menu
- **New** Lyrics view in sidebar (coming soon)
- **Improve** Multi-select now only activates via Ctrl+click or Select button
- **Improve** Multi-select works in album/artist/genre drill-down views
- **Improve** Cover art loading optimized — faster queue scrolling, no shimmer in queue

---

## [1.0.4] — 2026-06-16

- **Fix** Accent color now applies everywhere (Tailwind opacity variants fixed)
- **Fix** Panel resize is now smooth and glitch-free
- **Fix** Settings About/changelog section layout corrected
- **New** Metadata editor: refresh button re-reads file tags from disk

---

## [1.0.3] — 2026-06-16

- **New** Accent color picker with presets + custom color in Settings
- **New** Dev-only version editor in Settings About section
- **New** Changelog panel in Settings About section
- **Improve** Metadata editor completely redesigned with two-panel layout
- **Improve** Removed duplicate dark/light theme buttons from Settings
- **Fix** Progress bar now respects accent color

---

## [1.0.2] — 2026-06-16

- **New** Audio output device selector in player bar and settings
- **New** Multi-select songs with Ctrl/Shift+click, batch actions
- **New** True overlapping crossfade with dual-audio ping-pong engine
- **Fix** Crossfade toggle animation now works correctly
- **Fix** Crossfade settings now persist across launches
- **Fix** Editing metadata no longer skips to that song
- **Improve** Album song list column spacing improved
- **Improve** Sidebar logo enlarged, window control icons smaller

---

## [1.0.1] — 2026-06-10

- **New** Queue panel with drag-to-reorder
- **New** Now Playing panel with lyrics and metadata
- **New** Crossfade and sleep timer
- **New** Scan filters (file extensions, min duration, excluded folders)
- **New** Album art export from metadata editor
- **Fix** Repeat/loop mode fixed
- **Fix** Shuffle no longer repeats the same track
- **Improve** Improved fuzzy search with word-level scoring
- **Improve** Resizable Now Playing and Queue panels

---

## [1.0.0] — 2026-06-01

- **New** Initial release
- **New** Library management with folder scanning
- **New** Albums, Artists, Genres browser
- **New** Playlists with drag-and-drop
- **New** Metadata editor with lyrics and cover art
- **New** Dark / light theme
- **New** Frameless window with custom titlebar
