# Unreleased

A desktop music player for Juice WRLD's unreleased catalogue, built on the
[Juice WRLD API](https://juicewrldapi.com). It streams the API's song tracker
and file archive, plays your own local files, and also includes the API's
community and staff tools (editing, review, chat and admin).

The same codebase also runs in the browser at
[player.juicewrldapi.com](https://player.juicewrldapi.com). This branch (`app`)
is the Electron desktop build.

**[Download the latest release →](https://github.com/Juice-WRLD-API/Unreleased/releases/latest)**

| Platform | Package |
|---|---|
| Windows (x64) | NSIS installer, plus a small web installer that downloads the rest |
| macOS (Apple Silicon and Intel) | `.dmg` |
| Linux (x64) | AppImage |

Installed builds update themselves in the background.

The macOS app is not signed yet. If Gatekeeper says it is damaged, the copy
was signed on the build machine and that signature does not count on yours.
Clear the quarantine flag and re-sign it locally (use `~/Applications/...` if
that is where you dragged it), then right-click the app and choose Open:

```bash
xattr -cr /Applications/Unreleased.app
codesign --force --deep --sign - /Applications/Unreleased.app
```

---

## What's in it

**Listening**
- **Home**: a dashboard of sections you can show or hide: recently played
  (synced across devices), playlists, an albums shelf, 999 FM, news, games and
  your listening stats.
- **Albums**: official albums, EPs and mixtapes as a cover grid and an album
  page (Play, Shuffle, a numbered tracklist). Home's shelf opens the same page.
  Editing an album is a separate staff screen.
- **Tracker**: search and filter the whole API song catalogue by era, category
  and metadata. You choose which fields show in the list and in the detail
  panel, and drag to reorder them. Songs with several versions let you switch
  between them or hide ones you don't want. A Files tab in Tracker browses the
  archive without leaving the catalogue.
- **Files**: browse the API's file archive directly, with previews, a text and
  `.lrc` viewer, multi-select, bulk ZIP downloads, and tag edits on audio files
  (proposed for review, not written immediately).
- **Library** (desktop only): scan local folders, edit ID3 tags and embedded
  art, and convert between audio formats with ffmpeg.
- **Playlists**: folders, custom covers and descriptions, drag to reorder,
  JSON/M3U import and export, share links, and following someone else's
  playlist live.
- **Player**: a queue with history, search and reshuffle, radio/shuffle mode,
  automatic recovery when a stream stalls, synced lyrics (Shift+L, including
  per-word timing), an equalizer with volume boost, era covers, and personal
  covers per song. On desktop, an ALAC file plays as a FLAC transcode, and
  playback can pause when headphones disconnect and start again when they
  reconnect.
- **WRLD**: a full-screen now-playing view with blurred cover art, scrolling
  synced lyrics, a visualizer, and 999 FM controls. For a released song it
  can play that song's official video from Files in place of the visualizer.
- **999 FM**: the API's live radio, where listeners vote to skip and suggest
  songs, plus a live chat. Chat is plain English: emoji and punctuation pass,
  other alphabets and styled fonts do not.
- **Offline**: download tracks and whole playlists for offline playback. You
  can also embed lyrics and your cover art into downloaded MP3s. **Sync**
  (desktop, off by default, Home → Tools) keeps every released and unreleased
  song that has audio on this computer, in that same offline library.
- **URL import**: pull audio in from a link (yt-dlp, downloaded on first use).

**Sharing**
- Public track pages with real URLs, shareable playlists, and lyrics or
  now-playing image cards.
- Share songs, playlists and news straight into chat.

**Extras**
- **Games**: Heardle (daily puzzle and online versus), Wordle, and tier lists.
- **Wrapped**: your own listening stats. **Statistics**: catalogue-wide
  numbers, including a most-played chart for the last 7 days, 30 days, or
  all time.
- **Thank you**: donors and contributors. Administrators can replace the
  page from the server; otherwise the built-in page shows.
- **News** feed with channels and notifications.
- **Integrations**: Discord Rich Presence and Last.fm scrobbling.
- **Desktop niceties**: mini player, pop-out windows, tray controls, media
  keys, global and in-app hotkeys you can rebind separately, and (on Windows)
  taskbar thumbnail buttons for like, previous, play/pause and next.
- **Customisation**: skins and themes, and a sidebar or pill nav (drag it to
  any window edge) where you choose and reorder the tabs. The glass look is
  the default. On Chromium, **Settings → Appearance → Glass refraction** bends
  the backdrop along the player bar and the pill nav.

**Accounts and community** (Discord sign-in opens in the default browser; a
busy local port, or "Use a window in the app", falls back to an in-app window.
Settings → Account → Sign-in can also set a username and password.)
- Public profiles, liked songs, and synced preferences.
- Song edit proposals with Genius lyrics paste, a synced-lyrics timing tool,
  and bulk editing. File ("comp") uploads, reports and feedback.
- **Remixes and edits**: anyone signed in can send one from Home → Tools.
  Approval files it in the community channel under
  `Remixes & Edits/Community-Made/`. The server refuses a file that is too
  similar to one it already has.
- Roles: contributor, editor, manager and admin, each with its own profile
  page and review queue.
- An admin console for proposals, users, eras, albums, channels, broadcasts,
  CDN nodes and beta builds.
- End-to-end encrypted staff chat with group rooms, GIFs, link previews,
  device linking and message search.
- Donor file storage and playback, plus a distributed peer-to-peer CDN where
  you can run your own node.
- API key management and a Diagnostics panel.
- **Terminal**: a command line inside the app that can do almost everything
  the UI does: playback, files, settings, review queues, chat and admin.
- In-app API docs.

---

## Running from source

You need **Node.js 22** (the version CI builds with) and npm.

```bash
npm install
npm run electron:dev
```

This starts Vite on port `3018` and opens Electron against it with hot reload.
On Windows, `scripts\run.bat` does the same thing. On Linux, use
`electron:dev:wayland` or `electron:dev:x11` to pick a display backend.

Only one instance runs per user-data folder. If the installed app is already
open, `npm run electron:dev` quits immediately, because both use that folder.
Launch Electron with `--user-data-dir=<scratch folder>` to run a second copy.

To work on the renderer alone in a browser:

```bash
npm run dev
```

### Local config

Copy `.env.local.example` to `.env.local`. Every value is optional:

| Variable | Used for |
|---|---|
| `VITE_AUTH_TOKEN` | An API token, so local dev skips Discord login |
| `VITE_LASTFM_API_KEY` / `VITE_LASTFM_API_SECRET` | Last.fm scrobbling (baked in at build time) |
| `VITE_JWAPI_WS` | Points the realtime sockets (chat, notifications, Heardle versus) at a different server |
| `GH_TOKEN` | Publishing GitHub releases from `release.py` |
| `BETA_ADMIN_TOKEN` | Uploading beta builds from `release.py` |

The API defaults to `https://juicewrldapi.com/juicewrld`. You can change it at
runtime under **Settings → Developer → API servers**, which also supports
per-route rules.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run electron:dev` | Vite and Electron in dev mode |
| `npm run build` | Typecheck and build the renderer into `dist/` |
| `npm run electron:build` | Build and package an installer into `release/` |
| `npm run typecheck:electron` | Typecheck the main process |
| `npm run test:electron` | Main-process unit tests (`node --test`) |
| `npm run electron:smoke` | Launch the app once and exit, as a smoke test (used by CI) |
| `npm run terminal:check-coverage` | List UI API calls the in-app terminal can't reach yet |

---

## Project layout

```
electron/            main process: windows, tray, updater, IPC, offline library,
                     Discord RPC, ffmpeg/yt-dlp tooling
src/renderer/src/
  App.tsx            main window shell
  FloatApp.tsx       pop-out and mini-player windows
  components/        views, modals and panels
  lib/               API clients, chat crypto, CDN, player helpers
  lib/terminal/      in-app terminal commands, one module per area
  hooks/  store/     React hooks and Zustand stores
build/               NSIS installer script and helper scripts
scripts/             release, beta and dev helpers (.bat wrappers + python/)
.github/workflows/   per-platform release builds and desktop smoke tests
```

---

## Releasing

A push to `app` publishes a stable desktop release. Installers are built in
CI (`build-windows.yml`, `build-mac.yml`, `build-linux.yml`) and attached to
the GitHub release. `test-desktop.yml` builds the app and smoke-tests it on
Windows and Linux for every push and pull request; it does not publish.

**Pushing to `app`.** `.github/workflows/auto-release.yml` runs on
every push. When the commit subject does not start with `vX.Y.Z`, it bumps
the patch version in `package.json`, commits that as `vX.Y.Z`, tags it,
creates the GitHub release, and starts the three platform builds with
`workflow_dispatch`. A release created with the workflow's `GITHUB_TOKEN`
does not fire `release: published`, which is why the builds are dispatched
directly. A subject that already starts with `vX.Y.Z` is left alone, so a
manual release is not bumped twice.

**`scripts\release.bat`** wraps `scripts/python/release.py` for a chosen
version. It asks a few questions, then:

- Fast-forwards `app` onto `origin/app` (`--ff-only`) before the version
  bump. Auto-release commits and other pushes move `origin/app`; a diverged
  branch stops the script.
- Commits only the `package.json` version, with the message `vX.Y.Z`, and
  pushes `app`. Auto-release sees that subject and skips.
- Publishes the GitHub release with no assets, using `GH_TOKEN` from
  `.env.local`. That publish starts the platform builds. The `web` branch is
  not updated from here. Platform branches are ported by hand
  (`md/RELAY_LOG.md`).

**Beta**: answer yes to the beta question, or run `scripts\beta.bat`. That
path skips git and GitHub. It picks the next beta version, builds the Windows
installer locally, and uploads it to the gated beta channel on
juicewrldapi.com. It needs `BETA_ADMIN_TOKEN` in `.env.local` (an
administrator's API token, with 2FA enabled). Users join the beta with an
access code.

### Other branches

The repo carries one branch per platform: `app` (desktop), `web`, `android`,
`ios` and `beta`. They don't sync automatically; changes are ported between
them by hand. `md/RELAY_LOG.md` records each port with the versions on both
sides.

---

## License

[MIT](LICENSE). Bundled third-party licences are listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
