# Agent guide: Juice WRLD API and Unreleased

**Version 1.18** · updated 2026-10-24. Bump the version and date whenever you
change this file (minor for fixes and additions, major for rewrites).

**Keep this file current.** If you find something in the docs or this file that
doesn't match the real behaviour, or you make a mistake a future agent could
make too, add it here as you go: fix the wrong line, or add a short entry to
section 10 (what went wrong, what to do instead). Then bump the version.

Read this before working on the Juice WRLD API (juicewrldapi.com), the Unreleased
player on any platform, or one of the tools around them. It covers how the
projects fit together, the rules for working in them, and API gotchas.

Paths below are relative to the shared `Unreleased/` folder that holds every
checkout as a sibling.

---

## 1. The projects

| Folder | What it is | Branch / repo |
|---|---|---|
| `backend/` | Django backend that serves juicewrldapi.com. Its `docs/*.md` is the API reference. On the main machine the checkout is named `Chicken-Dinner/` (the user calls it that too) | separate repo |
| `unreleased-app/` | Unreleased desktop app (Electron + React). Holds the real `.git` for the player repo; the other player folders are worktrees of it | `app` on `Juice-WRLD-API/Unreleased` |
| `music-player-web/` | Same player as a website, player.juicewrldapi.com. Has the mobile layouts and the social-preview server | `web` |
| `music-player-android/` | Android build (Capacitor around the web bundle) | `android` |
| `music-player-android-dev/` | Rebase of android onto web's renderer, in progress | `android-dev` |
| `music-player-ios/` | iOS build (Capacitor, needs macOS + Xcode to build) | `ios` |
| `music-player-beta/` | Beta-only features held back from stable (Session Maker) | `beta` line; check `git branch --show-current` |
| `unreleased-cli/` | The site terminal as a command-line shell (npm + Ubuntu PPA) | `Juice-WRLD-API/unreleased-cli` |
| `jwa-mcp/` | MCP server exposing the API as ~29 tools (stdio + HTTP) | `Juice-WRLD-API/jwa-mcp` |
| `jwa-cdn-node/` | Desktop node for the distributed P2P CDN (Python, WebRTC). Has its own `AGENTS.md`, read it | `Juice-WRLD-API/jwa-cdn-node` |
| `jwa-whisper/` | "WRLD Sync": generates synced lyrics with local Whisper | `Juice-WRLD-API/juicewrldapi-whisper` |
| `iJWA/` | Retired. Its features now live in the app as **Desktop** (see section 6) | `Juice-WRLD-API/iJWA` |

Branches in the player repo **do not sync automatically**. Each one has its own
version number (desktop 2.5.x, web 2.3.x, android/ios 2.0.x, beta 3.0.x-beta as of
2026-10-21) and its own history. Work moves between them by hand ("porting" or
"relaying"), see section 2.

---

## 2. Rules for working here

### Git

- **Never commit unless the user asks.** Leave changes in the working tree and
  say what is ready.
- "Commit" means **commit and push** the branch to `origin`.
- Author every commit as the user. **No
  `Co-Authored-By` lines, no "Generated with" footers**, in commits or PRs.
- **Never commit in `backend/`.**
- Never commit `HANDOFF*.md` files. Exclude them when staging.
- Don't create worktrees or switch branches on your own. Work in the checkout
  you were started in.
- If a worktree reports `fatal: not a git repository`, repair it from
  `unreleased-app` with `git worktree move` / `git worktree add`, never by re-cloning.

### Porting between platforms

- Before porting, read both sides. Files that share a name often differ.
- Electron-only work (windows, tray, installer, clipboard bridge, offline
  library, `electron/`) has no web counterpart. Say so instead of porting it.
- Record every port in `unreleased-app/md/RELAY_LOG.md` (lives only on `app`).
  The file has the recipe for the version columns.
- The shorthand **port-c**: on `web`, port the change to `app`; on `app`, port it
  to `web`. Then commit and push both.

### Finishing the job

- Finish the obvious related work in the same pass instead of listing it as a
  gap: other code paths that should carry a new field, the edit flow for a new
  create flow, and above all the **terminal command** for a UI change (see
  section 5).
- Run the non-interactive checks before calling something done (section 7).
- Don't launch a dev server or browser preview to check your work unless the
  user asked for it in that turn.
- Long builds (`electron:build`, release scripts) go in a new visible terminal
  window. Start it, say it is running, and stop. Don't poll it.

---

## 3. Juice WRLD API

**Base URL:** `https://juicewrldapi.com/juicewrld`
**Reference:** `backend/docs/` (01 to 19, one file per area). Use these, not
juicewrldapi.com/api-docs or the in-app docs page
(`src/renderer/src/components/docs/content.tsx`), which are not accurate. If the
docs and the server disagree, the backend code in `backend/` wins.

### Facts checked against the live API (2026-10-21)

- **Send a browser-like User-Agent.** The default Python `urllib` UA gets
  `403 Forbidden` on plain reads such as `/songs/{id}/`. curl and browsers are fine.
- **`next`/`previous` links come back as `http://`**, not https. Rebuild them
  from your own base, or follow only the `page` number.
- **`/eras/` is paginated** (`{count, next, previous, results}`, 34 eras, 20 per
  page).
- **`/songs/?ids=` filters by `public_id`** and returns the normal JSON page. It
  is not CSV, takes no internal ids and has no 250 cap. There is no way to
  batch-fetch songs by internal `id`.
- **`/songs/?all=true` returns a flat array** of every match (around 10 MB with
  lyrics). It composes with filters: `?category=recording_session&all=true`
  filters server-side. The app passes `omit=lyrics,synced_lyrics,groupbuy_info`
  for bulk loads.
- **`/versions/?all=true`** returns every version row as a flat array.
  `/versions/` ignores filter params; filter on the client. `/versions/{song_id}/`
  is paginated and empty (`count: 0`) for songs with no version group.
- **`/albums/` and `/albums/{id}/` return `songs: []` and `cover_url: ""`** for
  every album. Don't build album track lists on them.
- **`/files/download/?path=` supports Range** (206 with `Content-Range`, CORS
  exposes the range headers). An `<audio>` element handles seeking by itself.
- **`/files/image-thumbnail/` 404s for real images** (nginx's HTML 404 page,
  every personal cover tried on 2026-10-21; a missing path still gets Django's
  JSON 404). `/files/download/?…&small=1` works for the same files. Never let a
  sized cover be the only URL tried: keep `small=1` as the fallback, as
  `ProgressiveCover` and the Desktop bridge's `coverAt` do.
- **`/files/channels/`** lists the comp channels: `comp` (primary,
  "Compilation"), `redemptionz`, `legacy`. Non-primary files need
  `&channel=<slug>` on file URLs.
- **`/health/`** returns `{"status":"ok"}`, useful as a liveness check.
- **Song date fields are free text with labels**, not dates: `record_dates`,
  `preview_date`, `date_leaked`, `release_date` and `dates` hold lines like
  `"Recorded\nAugust 1-2, 2016."`, `"Juice's Vocals\nMay 5, 2018."` or
  `"Surfaced January 25th 2026"`, sometimes several per field, and `[?]` for an
  unknown day. The label decides the event (a `File Exported` line in
  `record_dates` is not a recording). `songDates` in `lib/onThisDay.ts` reads
  them; reuse it. 2,690 of 2,751 songs had an exact date on 2026-10-24.

### Ids

Every song has two ids. `id` is internal (e.g. 94316): use it for
`/songs/{id}/`, `/versions/{song_id}/`, favorites, playlists, plays and edit
proposals. `public_id` (e.g. 2354) is the public number: use it for `?ids=` and
public track links. Mixing them up fails silently.

### Auth and roles

- Header: `Authorization: Token <token>`. Discord OAuth is the main login
  (`/accounts/auth/discord/url/` then `/accounts/auth/discord/exchange/`); there
  are also username/password, access-code, admin login, 2FA (OTP), login
  approval from another device and passkeys (`/accounts/auth/passkey/…`). Passkeys
  are tied to the `juicewrldapi.com` origins: the website runs the browser prompt
  in the page, the Windows desktop app uses a helper window, and the mobile builds
  and the CLI can only list, rename and remove them. See `lib/passkeyApi.ts` and
  `docs/08-accounts.md`.
- Two "who am I" endpoints: `/accounts/account/me/` (any user; also holds
  preferences, settings, playlist folders) and `/accounts/me/` (editor/admin
  dashboards).
- Roles are **independent flags**, not a ladder: `is_editor` (song data
  proposals), `is_contributor` (comp-file proposals), `is_manager` (review queues
  only), `is_administrator` (always also editor), `is_news` (news posting). They
  can also be granted **per comp channel** through `account.memberships`, so a
  missing global flag means "check memberships for this channel", not "denied".
  Read all of them defensively; older payloads omit some.
- The server enforces roles with 403.
- Beta builds use their own `X-Beta-Code` header, outside the token system.

### Files, streams and images

- Stream: `/files/download/?path=<encodeURIComponent(song.path)>[&channel=]`.
  Some songs have no `path` (metadata only); check before showing play.
- Lower bitrate: `/files/download-compressed/`. Cover art from an audio file:
  `/files/cover-art/` (audio only; image paths 404 there). Image files:
  `/files/image-thumbnail/` or the stream URL.
- `song.image_url` is site-relative (`/assets/jute.png`). Prepend
  `https://juicewrldapi.com`.
- A personal cover can be stored as a bare storage path
  (`Compilation/4. Cover Art/…png`); load it through the stream URL. Treat the
  literal string `"null"` as no cover. In the app, `resolvePrefCoverUrl` and
  `buildImageUrl` in `lib/juicewrldApi.ts` already do this. Reuse them.

### Realtime

Websockets live under `wss://juicewrldapi.com/juicewrld/ws/…`: notifications,
staff chat, 999 FM radio and Heardle versus. Auth and events are in
`docs/19-websockets.md`; radio in `docs/06-999-fm.md`.

### Staff chat encryption

Every client must use this wire format: libsodium `crypto_aead_xchacha20poly1305_ietf` with no additional
data, a 24-byte random nonce, standard padded base64; room keys wrapped with
`crypto_box_seal` to the device X25519 key; `encrypted_name` is the filename alone,
with its own nonce, packed as base64(nonce || ciphertext); encrypted uploads go
up as `attachment.bin` / `application/octet-stream` with the plaintext `size`;
reactions are shortcode names (`fire`), not emoji glyphs. Code:
`lib/chatCrypto.ts`, `lib/chatE2E.ts`, `lib/chatV2Crypto.ts`. If you change the
format, change every client.

---

## 4. Unreleased app layout (`app` branch; web is close)

```
electron/                 main process: main.js, preload.js (window.electron),
                          offlineLibrary.js, discordRpc.js, platform.js,
                          desktop/ + desktopPreload.js (window.desktopPage)
src/renderer/src/
  App.tsx, FloatApp.tsx   main window; pop-out and mini-player windows
  components/             views, modals, panels (docs/ = in-app API docs)
  desktop/                Desktop feature pages (widgets, edge light, lyric scenes)
  lib/                    API clients and helpers, one module per area
  lib/terminal/           in-app terminal commands, one module per area
  store/                  Zustand stores (useStore, queueSlice, chatStore, desktopSlice…)
  hooks/
scripts/                  release.bat, beta.bat, run.bat, check-terminal-coverage.mjs, python/
.github/workflows/        build-windows/mac/linux on release; test-desktop smoke test
```

### API access in the renderer

- Don't call `fetch` from components. Go through `lib/`:
  - `lib/apiClient.ts`: `apiRequest` / `authedRequest` / `authHeaders`. It shares
    one round-trip between identical in-flight GETs, falls back to the offline
    cache on network errors when a `cacheKey` is given (4xx/5xx always throw),
    and parses error bodies.
  - `lib/juicewrldApi.ts`: catalogue, files, streams, covers, channels.
    `buildStreamUrl`, `buildCoverArtUrl`, `buildImageUrl`, `getSongById`,
    `loadAllSongs` (5-minute TTL).
  - `lib/userApi.ts` plus one `lib/<area>Api.ts` per area (chat, news, cdn,
    heardle, tierlist, versions, albums…).
- **Never hard-code the base URL.** Build it with `routeUrl` / `baseFor` from
  `lib/apiServers.ts`. Users can point the whole app, or a path prefix such as
  `/chat` or `/cdn`, at another server from Settings → Developer → API servers
  (desktop; the Developer tab appears once "Developer options" is on). Bases are
  read at import time, so changes need a reload.
- Platform checks come from `lib/platform.ts` (`IS_ELECTRON`, `IS_IOS`,
  `IS_ANDROID`, `IS_MOBILE`). Share links go through `shareOrigin()`, which is
  player.juicewrldapi.com on desktop.

### Local config

`.env.local` (copy `.env.local.example`): `VITE_AUTH_TOKEN` skips Discord login in
dev, `VITE_JWAPI_WS` points the sockets elsewhere, plus Last.fm and release
tokens. Never print or commit these values.

---

## 5. The in-app terminal must keep up with the UI

Goal: every API request the UI can make can also be made from the terminal.

- Commands live in `lib/terminal/*.ts` and declare `covers: ['module.fn']` for
  the `lib/` functions they reach. Older ones are listed in
  `lib/terminal/coversExisting.ts`.
- `npm run terminal:check-coverage` lists any request function no command
  reaches. When you add an API function to `lib/`, add a command, or add an
  explicit not-applicable entry with a reason in
  `scripts/check-terminal-coverage.mjs`.
- New commands must not reuse a chat slash command name (`role`, `feedback`, `broadcast`, `np`…).
- `unreleased-cli/` compiles in some site modules through `npm run sync` (copied
  from `../music-player-web`, recorded in `site/SYNCED_FROM.json`). New site
  terminal commands are separate ports into the CLI's `src/`.

---

## 6. Platform notes

**Desktop (`app`)**: Electron. Renderer talks to main only through
`window.electron` (`electron/preload.js`). The **Desktop** feature (the former
iJWA) is on `app` only and off by default, with settings in Settings → Desktop.
Edge light, widgets, clear desk and the display picker are Windows-only; lyric
styles and Edge-light visualizers run on every desktop OS. Desktop pages run
under the app CSP: no inline `style` attributes or `<style>` tags. Don't bring
back WRLD's Cover Flow layout or iJWA's live wallpaper, artwork tray icon or
energy rules.

**Sync** (Home → Tools, `app` only, off by default) keeps every released and
unreleased song with audio offline. It is one more entry in the offline
library (`catalog-sync`), registered with the whole chosen catalogue before
anything downloads, so playlist syncs' prune can't delete synced songs and
re-registering drops what left the catalogue. Engine: `lib/catalogSync.ts`;
state: `store/catalogSyncStore.ts`; terminal: `offline`. Main dedupes
concurrent downloads of one track and aborts them on pause
(`offline-cancel-downloads`).

**Web (`web`)**: same renderer plus mobile layouts (`IS_MOBILE`), PWA install,
and `server/social-preview.mjs` for link previews (nginx setup in
`docs/17-nginx-social-preview.md`). Dev server on port 5173.

**Android / iOS**: Capacitor wrappers around the web build, sideloaded.
Android: `npm run android:sync`, `npm run android:apk`, `npm run android:deploy`;
native plugins in `android/app/src/main/java/com/juicewrldapi/player` (SAF
library, offline storage, Downloads, APK self-update). iOS: build in Xcode
(`ios/App/App.xcodeproj`). Releases use `android-v*` / `ios-v*` tags, always
marked pre-release.

**CDN node**: read `jwa-cdn-node/AGENTS.md`. Server side is
`backend/cdn/` and `docs/16-distributed-cdn-api.md`.

**MCP server**: write and admin tools are off by default (`JWA_ENABLE_WRITES`,
`JWA_ENABLE_ADMIN`). Keep that default and suggest a low-privilege token.

**Backend**: `./run.sh` starts Redis, Daphne (websockets, 8001), Waitress media
(8002) and Waitress API (8000). See `docs/01-overview.md`.

---

## 7. Commands and checks

| Task | Command (in `unreleased-app/`) |
|---|---|
| Dev (Vite 3018 + Electron) | `npm run electron:dev` (Linux: `electron:dev:wayland` / `:x11`) |
| Renderer only | `npm run dev` |
| Typecheck + build renderer | `npm run build` |
| Typecheck main process | `npm run typecheck:electron` |
| Main-process tests | `npm run test:electron` |
| Smoke test | `npm run electron:smoke` |
| Terminal coverage | `npm run terminal:check-coverage` |
| Virtual list regression tests | `node --test scripts/renderer-virtual-window.test.cjs` |
| Package installer | `npm run electron:build` (long, use a visible window) |
| Release | `scripts\release.bat` (stable: bump, push, GitHub release, CI builds; beta: local build to the gated beta channel) |

Before saying a change is done: `npm run build`, plus `typecheck:electron` and
`test:electron` if you touched `electron/`, plus `terminal:check-coverage` if you
touched `lib/`. Report failures with their output.

Node 22.

---

## 8. UX conventions

- **Optimistic updates** for quick, low-risk actions (like, follow, toggles, add
  to playlist, reorder): update the UI at once, send the request in the
  background, roll back with a short error if it fails. See
  `lib/optimisticPlaylist.ts`. Not for destructive actions.
- **Submenus need a safe triangle**: moving diagonally toward an open submenu
  must not close it or switch to a sibling's.
- **Animation**: gentle-start curves (e.g. `cubic-bezier(0.4,0,0.2,1)`, about
  0.45–0.65 s), transform and opacity only, no animating width/height/left on
  heavy elements, no scaling text, no child entrance stacked inside a parent's,
  respect `prefers-reduced-motion`. No expo-out curves.
- **Palette changes**: never transition the skin variables on `<html>`
  (`--surface`, `--accent`…). Every element restyles on every frame and skin
  switches lag. Write them through `paintPalette` in `lib/themeEffects.ts`,
  which cross-fades with a view transition.
- Write copy plainly. Match the surrounding code's comment density and naming.

---

## 9. Vocabulary

- **comp / channel**: one of the Files-tab sources (`comp`, `redemptionz`,
  `legacy`), not a separate computer. Unrelated to news channels.
- **Tracker**: the song catalogue view (`/songs/`). **Files**: the file archive
  (`/files/`).
- **Era**: a period of Juice WRLD's work (`/eras/`), e.g. "jute", "LND".
- **Proposal**: an edit waiting for review, either song data (editor) or comp
  file (contributor).
- **999 FM**: the live radio. **WRLD**: the full-screen now-playing view.
- **Relay / port**: copying work from one platform branch to another.

---

## 10. Mistakes and doc mismatches

Newest first. One entry each: date, what went wrong, what to do instead. Delete
entries that stop being true.

- 2026-10-24: Library artist details silently stopped at 60 songs, and Play
  ignored the visible album/artist search results. Use the shared virtual song
  list for details and build collection playback from the active view's filtered,
  ordered results. Scale virtual card geometry with `appTextScale`, like song rows.

- 2026-10-23: Deployed lyrics job endpoints can reject JSON with HTTP 415 even
  though the local backend accepts it. Send server audio references as FormData
  through `apiRequest` with auth headers; let fetch set the multipart boundary.
  Keep the song/path reference so existing audio is not uploaded again.

- 2026-10-23: WRLD and terminal unmount cleanup must hand fullscreen to each
  other instead of exiting the native window. WRLD reads the current native
  fullscreen state on mount; terminal uses Electron's bridge, not just the
  browser Fullscreen API. Other destinations still exit fullscreen.
- 2026-10-23: Publishing raw scroll pixels rerendered virtual lists even when
  their rows stayed the same, and Tracker cards scanned every row on scroll.
  Use the shared range hooks in `useVirtualWindow`, including the binary-search
  variant for expanded cards. Keep ranges clamped when filtering shrinks a
  list. Playlist quick views use natural height, card transforms and one fade;
  don't restore per-frame height animation or nested row entrances.
- 2026-10-23: Remember queue is device-local and restores paused. Only the main
  renderer may save it; pop-outs hold incomplete queue mirrors. Keep embedded
  art/lyrics out of snapshots and save position separately. Audio loading emits
  zero-time events before metadata: preserve the restored position until the
  active slot can seek, including donor/session-edit files that resolve later.
- 2026-10-23: Tracker card row offsets include only the open detail sections.
  Keeping a closed section mounted for an exit would overflow the computed
  row height. Fade detail changes with `useContentMotion`; use
  `MotionDisclosure` for ordinary flow layouts. A sliding nav highlight must
  observe the natural-height content, not only its fixed-height scroller, to
  follow disclosures that finish closing after the parent render.
- 2026-10-22: internal tab changes need their own motion, but a mount animation
  on the tab body also plays inside the dialog/view's entrance. Use
  `useContentMotion` for changes after the first render; it fades without
  remounting content or shifting nested fixed menus. Keep notification/list
  containers mounted while empty so `useListMotion` can animate the first
  arrival and the last dismissal.
- 2026-10-21: `npm run electron:dev` quits at once while the installed app is
  running: both use the same userData folder and single-instance lock. To run or
  profile dev beside it, launch `electron . --user-data-dir=<scratch folder>
  --remote-debugging-port=9223` with a copy of `%APPDATA%\unreleased\Local Storage`
  in that folder (the dev seed then brings settings and sign-in over), and drive
  it over CDP. Delete the copy afterwards: it holds the auth token.
- 2026-10-21: WRLD's widgets are same-origin iframes, so they share the app
  window's main thread and compositor, and WRLD's own layout stays mounted under
  them with `display: none`. A per-frame paint in a widget (an opacity or
  gradient change without its own layer) re-rastered the card and its cover on
  every frame, and the hidden layout's lyric stages kept drawing. Keep per-frame
  changes on layers of their own, and stop work in boxes with no size.

- 2026-10-21: on the Linux VM, `unreleased-app/node_modules` is the Windows
  install, so `vite build` fails on missing `@rollup/rollup-linux-x64-gnu` and
  esbuild's Linux binary. Don't reinstall the shared folder: install both
  (matching versions) into a scratch folder and run the build with
  `NODE_PATH=<scratch>/node_modules ESBUILD_BINARY_PATH=<scratch>/node_modules/@esbuild/linux-x64/bin/esbuild`.
  Linux-side git also reports every CRLF file as changed; use
  `git -c core.autocrlf=true diff` to see real changes.
- 2026-10-21: WebAuthn can't run in the app's own window (file:// origin), and
  passkeys belong to `juicewrldapi.com`. `electron/passkey.js` runs the prompt in
  a separate window whose session serves `https://player.juicewrldapi.com/desktop-passkey/`
  locally. Electron 42 only does this safely on Windows (webauthn.dll); on
  macOS/Linux a PIN-protected security key crashes the main process
  (electron#54317, fixed from 43.x), so ceremonies are Windows-only there.
- 2026-10-21: the backend's "Mixed-source playlists" commit changed the playlist
  API without touching `docs/05-playlists.md`. When the backend docs and code
  disagree, read `library/views.py`, `serializers.py` and its tests, then
  update the doc. Playlist entries can now be songs, comp files, donor files or
  local files (`song` is null for files); go through `lib/playlistItems.ts`
  rather than reading `item.song` directly.
- 2026-10-21: a new backend module `accounts/comp_replace_views.py` was silently
  left out of `git status`: the backend `.gitignore` rule `comp_*` (meant for comp
  data folders) matches any file whose name starts with `comp_`. Name new backend
  source files so they don't start with `comp_`, or check `git check-ignore -v`.
- 2026-10-21: a Python script got `403` from `/songs/{id}/` because of the
  default `urllib` User-Agent. Send a browser-like User-Agent.
