# Agent guide: Juice WRLD API and Unreleased

**Version 1.73** · updated 2026-11-13. Bump the version and date whenever you
change this file (minor for fixes and additions, major for rewrites).

**Keep this file current.** If you find something in the docs or this file that
doesn't match the real behaviour, or you make a mistake a future agent could
make too, add it here as you go: fix the wrong line, or add a short entry to
section 10 (what went wrong, what to do instead). Then bump the version.
Don't write down what the code or a quick look already shows; entries are for
things a future agent would get wrong.

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
version number (desktop 2.5.x, web 2.3.x, Android/iOS 3.2.x, beta 3.0.x-beta as of
2026-10-25) and its own history. Work moves between them by hand ("porting" or
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
- The shorthand **port-b**: commit and push the current branch only, with no
  porting, authored as the user and with no AI attribution lines. If the push
  is rejected because `origin` moved ahead, `git pull --rebase` and push again
  (no force, no merge commit); stop and report if the rebase conflicts.

### Finishing the job

- Finish the obvious related work in the same pass instead of listing it as a
  gap: other code paths that should carry a new field, the edit flow for a new
  create flow, and above all the **terminal command** for a UI change (see
  section 5).
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
- **`/albums/` is paginated** (`{count, next, previous, results}`, 20 per
  page). Checked 2026-11-03: `count` is 24 and page 2 is the four edition rows
  (Death Race for Love bonus, both Fighting Demons editions, The Party Never
  Ends 2.0). `next` is `http://`. Each row has `type` (Album, EP, Mixtape),
  `cover_url` (a site asset or a storage path, so go through `buildImageUrl`)
  and an ordered `songs` list of catalogue song `path`s. Reads add a read-only
  `song` summary to each track (`id`, `public_id`, `name`, `category`,
  `length`, `image_url`, or null); writes still take `{order, path}` only.
  Editions are rows of their own that repeat the base album's paths. The
  public list is cached for 15 minutes (`Cache-Control: max-age=900`), so
  admin edits show there late. `fetchAlbums`, `adminFetchAlbums` and
  `fetchArtists` walk every page by number (not the `http://` link) and still
  accept a bare array from an older server.
- **`POST /files/tags/`** reads comp-file tags. Body is `{paths, channel}`,
  at most 500 paths per call (`getCompFileTags` loops). The response is
  `{tags: {path: CompFileTags}}`. Missing files and anything that is not audio
  are left out of `tags`. Every tag value is a string, `""` when the tag is
  absent, plus `has_cover`. There is no GET.
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

- Header: `Authorization: Token <token>`. API keys (`jwapi_…`, with read/write/admin
  scopes) go in `X-API-Key: <key>` or `Authorization: ApiKey <key>` instead;
  admin endpoints need the `admin` scope. Discord OAuth is the main login
  (`/accounts/auth/discord/url/` then `/accounts/auth/discord/exchange/`); there
  are also username/password, access-code, admin login, 2FA (OTP), login
  approval from another device and passkeys (`/accounts/auth/passkey/…`). Passkeys
  are tied to the `juicewrldapi.com` origins: the website runs the browser prompt
  in the page, the Windows desktop app uses a helper window, and the mobile builds
  and the CLI can only list, rename and remove them. See `lib/passkeyApi.ts` and
  `docs/08-accounts.md`.
- `/account/me/` returns `username`, which is the `discord_<id>` placeholder
  until a Discord account picks one (`username_chosen: false`). Never show it
  as a handle in that state. Any account can pick a username and add a
  password (`/account/username/`, `/account/password/`; Settings → Account →
  Sign-in, terminal `username` / `password`). Renames are allowed once every
  14 days (`username_next_change_at`).
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

Room keys go to every active device of each participant, not just their oldest
(that rule left newer devices waiting forever). A device missing a key asks by
re-registering (`askForRoomKeys`, which re-sends `device.added`), and **Reset
key** in a DM starts a new key version for everyone (`resetRoomKey`).

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

### Albums, Tracker Files, and comp tag edits

Names here collide with older screens.

**Albums.** The public page is the `albums` view (`AlbumsView.tsx`). Staff
editing stays on `albums-admin`. `open albums` and `open albums-admin` match
that split. The `album` command is admin CRUD and does not open the page.
Home opens an album with `setAlbumsSelectedId` and then `setActiveView('albums')`.
Keep that order: the setter rewrites `/albums?id=` only while the path is
already `/albums`, and `setActiveView` copies the stored id into the one
history entry it pushes. Setting the view first pushes `/albums` with no id,
and Back from the album stops on the grid. On `file:` the page does not read
`?id=` on mount, only on `popstate`. Playback does not use a track's `song`
summary. `tracksOf` keeps catalogue songs found by path; a path with no match
is dimmed and left out of Play, Shuffle and the queue. "Other Versions" is
every other loaded album whose title matches after stripping a trailing
parenthetical.

**Files inside Tracker.** The Tracker `files` tab embeds `ApiFilesView`.
Folder changes there must not call `history.pushState`; `useApiFilesBrowse`'s
`embedded` flag is what leaves `/tracker` alone. "Show in Files" on a Tracker
song stays in Tracker (`setApiFilesPath` plus `setTrackerTab('files')`). The
song menu and the desktop player call `openInFiles`, which switches to the
standalone `api-files` view. `apiFilesPath` is consumed once, when the browser
mounts, then cleared. Setting it while that browser is already mounted does
not move the folder.

**Comp tag edits.** Files → Edit tags and `comp retag` propose a `retag` batch
through `proposeTagEdits` / `submitCompProposalBatch`. That path is not the
Library's on-disk ID3 write. Send only the keys that change. A missing key
stays, `""` clears one, and `cover: ""` removes the embedded cover. A new
cover is a data URL, staged once and shared by `upload_id`. The bulk editor
only tags `mp3`, `m4a`, `flac`, `opus`, `wav`, `aiff` and `aif`.

**Community edits.** Home → Tools → Submit a remix or edit
(`CommunityEditSubmitModal`, `lib/communityEditsApi.ts`, terminal `remix`,
backend `docs/23-community-edits.md`). Approving files it in the `community` channel
(never primary) at `Remixes & Edits/Community-Made/<uuid>/edit.<ext>`. The dialog sends the
file's SHA-256 to `check/` before uploading, and the server fingerprints the
upload and answers 409 with a `match` (`target` file, song or pending) when
it is too similar. Against other edits and every audio file in Files except
`Compilation/` (`COMP_EDIT_EXCLUDED_FOLDERS` in the backend's
`similarity/sources.py`; the songs live there; widening it needs a `fingerprint`
backfill) "too similar" is 75%; against catalogue songs it is 95%, because a remix is meant
to sound like its song. Don't lower that one. A pending match from someone
else is never named.

**News channels.** Admin tab id `news-channels` is `NewsChannelsEditor`, not
the Files-tab Channels tab (`channels`). `all` is a client-only tab and is
never a channel id. Terminal: `news channels`.

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
- `unreleased-cli/` compiles in some app modules through `npm run sync` (copied
  from `../unreleased-app`, recorded in `site/SYNCED_FROM.json`; pass another
  checkout explicitly to sync from it). New app
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

**Updates at launch** (`app`): a packaged launch shows the updating window
(`electron/updating/`) first and only creates the main window once there is
nothing to install. A newer build is downloaded and installed right there,
with no prompt, and the installer reopens the app. Timeouts that open the app
anyway live in `electron/launchUpdate.js`. Once the app is open, a background
download still asks with "Restart now / Later". Auto-download off skips the
launch check. On Windows every install from the app runs the NSIS installer
silently behind a stand-in (`electron/updating/standin.ps1`, PowerShell + WPF):
a capture of the updating window with a live sweep, kept up until the new
version deletes `update-standin` in userData. If the stand-in can't start, or
the last install didn't take, the installer shows its own progress window.
On macOS electron-updater is not used: it only installs from a `.zip` and
Squirrel.Mac rejects updates for an unsigned app. `checkMacUpdate` in
`main.js` compares the latest GitHub release, downloads the DMG for the
Mac's chip (`-arm64.dmg` or the plain x64 one), and opens it for the user to
drag over the old copy; the launch doesn't wait for it. Linux uses
electron-updater's AppImage updater. Once the app is signed, a `zip` mac
target plus uploading it in `build-mac.yml` would bring Mac back to
electron-updater.

**Discord sign-in** (`app`) opens in the default browser, where Discord is
usually signed in already. `electron/discordLogin.js` listens on
`http://127.0.0.1:47613/auth/discord/callback` for the redirect, and that exact
URI must be listed under Redirects in the Discord developer portal (the
backend already allows any loopback port). A busy port falls back to the
in-app window, and so does "Use a window in the app" in the dialog or
`login discord --window`.

**Sync** (Home → Tools, `app` only, off by default) keeps every released and
unreleased song with audio offline. It is one more entry in the offline
library (`catalog-sync`), registered with the whole chosen catalogue before
anything downloads, so playlist syncs' prune can't delete synced songs and
re-registering drops what left the catalogue. Engine: `lib/catalogSync.ts`;
state: `store/catalogSyncStore.ts`; terminal: `offline`. Main dedupes
concurrent downloads of one track and aborts them on pause
(`offline-cancel-downloads`).

**Synced lyrics** (Tools menu, Home → Tools, a song's or comp file's menu) is
one tool for timing lyrics by the line or the word. Model:
`lib/syncedLyrics.ts` (untouched lines are written back byte for byte); UI:
`components/SyncedLyricsTool.tsx`, edited in one place only: the dialog's
Sync tab (`LyricsGenModal`, on its own `<audio>`, for anyone; it opens big).
The song editor's Sync opens that dialog on the song and the editor's lyrics
(`LyricsGenTarget.sync`), and "Use in the song editor" hands the result back;
don't embed the tool in the editor again. A Whisper job's result shows it
`readOnly` as a play-along preview, and Edit in Sync opens the result in the
Sync tab; don't add timing controls back to the preview. Whisper stays
donor-only, under Generate. Word timing
is written as enhanced LRC (`[0:06.88] <0:06.88>No, <0:07.20>no<0:08.10>`)
into the song's `synced_lyrics`; a player that doesn't read word tags shows
them as text.

**Web (`web`)**: same renderer plus mobile layouts (`IS_MOBILE`), PWA install,
and `server/social-preview.mjs` for link previews (nginx setup in
`docs/17-nginx-social-preview.md`). Dev server on port 5173.

**Android / iOS**: Capacitor wrappers around the web build, sideloaded.
Android: `npm run android:sync`, `npm run android:apk`, `npm run android:deploy`;
native plugins in `android/app/src/main/java/com/juicewrldapi/player` (SAF
library, offline storage, Downloads, APK self-update). iOS: build in Xcode
(`ios/App/App.xcodeproj`). Releases use `android-v*` / `ios-v*` tags, always
marked pre-release.

Bluetooth on Android: `PlaybackService` pauses on `AUDIO_BECOMING_NOISY` and,
when that pause cut off a playing song, plays again once a Bluetooth output
connects (Settings → Playback → Resume when Bluetooth connects, terminal
`set bluetooth-resume`; stored in native SharedPreferences too). It
works only because the foreground service keeps the process alive while
paused. iOS suspends a paused app and browsers can't see Bluetooth, so
neither can do this; there, resuming relies on the car sending Play to the
lock-screen controls (the Web MediaSession `play` handler). Desktop (`app`)
does its own version from `devicechange`: Settings → Playback → Pause when
headphones disconnect (`set pause-on-disconnect`), logic in
`lib/outputDisconnect.ts`. It needs real device ids, which Chromium only
gives a page with microphone permission (Electron's check handler allows the
main window), so it is a no-op on the website.

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
  respect `prefers-reduced-motion`. No expo-out curves. Page changes are
  the exception and stay quick: the tab swipe (`lib/dashboardSwap.ts`) lands
  in about 0.36 s and ViewFade takes 0.2 s, since at 0.63 s tab switching felt
  slow (the user's call, 2026-11-13).
- **Wheel scrolling** glides, iOS-style, in every scroller of every window:
  `lib/smoothWheel.ts` (installed in `main.tsx`) takes mouse-wheel events at
  the window and eases the scroller under the pointer. Trackpads, ctrl+wheel
  and reduced motion stay native. A wheel handler of your own must call
  `preventDefault` to keep the wheel; a scroller that needs native wheel
  steps (snap points, custom wheel logic) takes `data-native-wheel`. Scroll
  snapping and `scroll-behavior: smooth` scrollers are skipped already.
- **Palette changes**: never transition the skin variables on `<html>`
  (`--surface`, `--accent`…). Every element restyles on every frame and skin
  switches lag. Write them through `paintPalette` in `lib/themeEffects.ts`,
  which cross-fades with a view transition.
- **Glass chrome (`app` and `web`, phones included)**: the iOS-style glass look is the default on
  every skin, with no toggle (the user's call, 2026-11-12; phones followed on
  2026-11-13). On `web` the glass tokens, `.glass*` fills, `.app-ambient` and
  the see-through `body` / `#root` / `.app-shell` apply at every width, and
  `AmbientBackdrop` renders on phones too (lighter blur, stronger tint). Phone
  screens use `.glass-card` (inset-grouped lists, tiles, grid cards; add
  `relative` yourself, a positioning class would beat a card a virtualized grid
  places `absolute`) and `.glass-track` (search field, segmented track) in
  place of `bg-[var(--grouped)]` / `bg-[var(--fill)]`; both turn into plain
  fills inside a pane or card. Detail-page hero art fades with a mask, not into
  `var(--surface)`. The rest of this bullet is about the desktop shell. The desktop player
  bar floats over the bottom of `<main>` and publishes `--player-dock`. A view
  on `SCROLL_UNDER` in `App.tsx` runs under it and must pad every scroller it
  can show with `.pb-player` (a `sticky bottom-0` bar also takes
  `.sticky-dock`); any other view is padded for you and ends above the bar.
  Notices pinned to the window's bottom go above it (`.above-player`). Classes
  live in `index.css` under "Glass chrome". Behind everything is
  `AmbientBackdrop` (the playing cover, blurred and tinted), fixed at
  z-index -1, so `body`, `#root` and `.app-shell` stay transparent and a view
  must not paint an opaque full-size background (Chat still does). Sidebar,
  side panels and Home tiles are translucent `.glass-pane`s over it. Glass
  fills mix from `--glass-base` (the surface with a hint of the accent,
  lifted toward white on light skins); mix new ones from it too. Docked
  panes are a veil (`--glass-pane`: frosted white on light, smoked on dark),
  not a fill, and every glass surface takes the light-catching edge
  (`.glass-specular`, built into `.glass-pane`; the element must be
  positioned). View toolbars use the glass controls: `GlassSegmented` for
  tabs and view toggles, and `GLASS_SEARCH` / `glassToolButton` /
  `glassPillButton` from `components/glassControls.ts` for search fields and
  buttons. Inside a `.glass-pane` they turn into plain fills by themselves.
  Dialogs keep their own controls: the veil is see-through.
- **Settings pages** (`app`, and `web` desktop and phone, 2026-11-13) are iOS-style grouped glass cards:
  `SettingsTitle`, `SettingsGroup` and `SettingsLink` in
  `components/SettingsRow.tsx`. Put a new row inside the right group, not
  loose on the page, and give it a `SETTINGS_SEARCH_INDEX` entry with the
  page it is on. Controls inside a group use `--fill` / `--fill-strong`, not
  `--surface-overlay` with a border. Old tab ids still open the right page
  (`tabFromLink`: Preferences became General and Navigation).
- **backdrop-filter pins fixed children**: it makes its element the containing
  block for `position: fixed` descendants, the way `transform` does. Put it
  straight on an element only if nothing inside is a fixed popover without a
  portal (ContextMenu, Modal and the Themed* pickers portal; NavPillGrip,
  ClampedMenu and many view popovers don't). Otherwise use `.glass-backdrop`,
  which blurs from a `::before` layer. That layer shows no blur while an
  ancestor is fading, so a popover that fades in takes the direct classes on
  the element that fades.
- Write copy plainly. Match the surrounding code's comment density and naming.

---

## 9. Vocabulary

- **comp / channel**: one of the Files-tab sources (`comp`, `redemptionz`,
  `legacy`), not a separate computer. Unrelated to news channels.
- **Tracker**: the song catalogue view (`/songs/`). Its Files tab embeds the
  archive and must not take over the address bar. **Files**: the standalone
  file archive (`/files/`, view `api-files`).
- **Albums**: the public album page (`albums`). **Albums admin**
  (`albums-admin`) is the staff editor. The `album` terminal command is the
  admin API, not the page.
- **Era**: a period of Juice WRLD's work (`/eras/`), e.g. "jute", "LND".
- **Proposal**: an edit waiting for review, either song data (editor) or comp
  file (contributor). A comp `retag` proposes tag changes; it does not write
  them until the batch is approved.
- **News channel**: a feed tab (`/news/channels/`). Not a comp channel. The
  admin tab id is `news-channels`.
- **999 FM**: the live radio. **WRLD**: the full-screen now-playing view.
- **Relay / port**: copying work from one platform branch to another.

---

## 10. Mistakes and doc mismatches

Newest first. One entry each: date, what went wrong, what to do instead. Delete
entries that stop being true.

- 2026-11-13: Fuzzy patching (`patch -F3`, `git apply --3way`) put the grouped
  Settings hunks on the wrong rows of `web`, whose `Settings.desktop.tsx` is a
  fork 800 lines shorter than `Settings.tsx`. Merge a forked file with
  `git merge-file <web copy> <app HEAD copy> <app working copy>`, then take the
  app side, drop the Electron-only pages (Library, App, pop-outs, updater) and
  restore what only web has: Sandbox and Developer options live under General →
  Advanced there, Smooth fade is hidden on iOS. `npx tsc --noEmit` on web lists
  every reference the merge left dangling. Web files are CRLF in the working
  tree and LF in git; strip the CRs (`sed -i 's/$//'`) before scripted edits.

- 2026-11-13: Every pinned ffmpeg checksum in `FFMPEG_SHA256` (`main.js`)
  was one or two characters short since v2.0.0, so the on-demand ffmpeg
  download always failed with "Checksum mismatch" and ALAC files could not
  play. Take pinned hashes from the release itself
  (`gh api repos/<owner>/<repo>/releases/tags/<tag> --jq '.assets[] | "\(.name) \(.digest)"'`),
  never retype them; `electron/toolChecksums.test.js` checks the length.

- 2026-11-12: The first glass relay treated the renderer work as Electron-only
  and missed the web desktop shell, Home and staff dashboards, WRLD entrance
  and album cache. Port those through the web desktop components and keep the
  web app shell's mobile safe-area and WRLD curtain behavior. Native window
  controls, pop-outs and catalogue sync stay on app.

- 2026-11-12: Expanding staff Quick actions into descriptive cards also
  stretched the neighboring identity tile into an empty panel. Keep these
  shortcuts compact and the identity tile content-sized; explanations belong
  in tooltips rather than another line in each action.

- 2026-11-12: The playlist hero's blurred cover faded into `var(--surface)`,
  which under glass chrome drew a solid band across the top of the track
  list (the page below is the see-through ambient backdrop). Fade a backdrop
  out with `mask-image` to transparent, never into a surface color.
- 2026-11-12: Home's On this day dropped from three columns to two while
  WRLD slid up over it. The page left under WRLD stays mounted, but App's
  view box took `scroll-under` and its bottom padding from `activeView`
  (already `wrld`), so the page got shorter mid-slide and the tile grew a
  scrollbar. Anything that shapes the view box during the slide must follow
  `wrldUnder ?? activeView`, the way Player holds `--player-dock`. A grid at
  `auto-fill, minmax(…)` sits within a few pixels of losing a column, so
  look for a 6 px or 14 px scrollbar first when one flips.

- 2026-11-12: Tailwind opacity modifiers on the theme colors compile to
  nothing. `surface`, `text-*` and friends are plain `var(--…)` values in
  `tailwind.config`, so `bg-surface/85`, `hover:bg-surface-raised/70` or
  `bg-text-secondary/70` emit no rule at all (many existing
  `bg-surface-overlay/40` cards are transparent for this reason). Use the
  plain class, a glass class (`glass-bar` for a sticky header), or
  `color-mix` in `index.css`.

- 2026-11-08: iOS v3.2.7 and v3.2.8 failed to archive with "cannot find
  'LocalLibraryPlugin' in scope". Its file reference in `project.pbxproj`
  reused the hand-picked ID `A1B2C3D42FF000070072D4E8` of the `Frameworks`
  group, so Xcode resolved the Sources entry to the group and never compiled
  the file (the log also warns that Compile Sources holds `ios/App`). When
  hand-editing a pbxproj, check that every new ID is unused
  (`grep -c <id>` must be 0 before adding it).
- 2026-11-05: Chromium plays AAC inside `.m4a` and does not decode ALAC, so an
  ALAC `.m4a` failed like a broken file (`audio/mp4` still looks playable).
  The desktop app sniffs the codec (`electron/alac.js`) and plays a FLAC
  transcode through the on-demand ffmpeg. The website and the mobile builds
  still can't play ALAC. Don't treat `audio/mp4` as proof the file will play.
  Don't port `Player.tsx`'s ALAC path either: the error handler returns as
  soon as it calls `requestAlac`, and without `preparePlayback` that call
  does nothing, so a file that won't decode never skips.
- 2026-11-03: A failed read of `offline-library.json` (truncated write, or the
  file locked for a moment) was treated as an empty library and cached under
  that file's stamp, so the next download or playlist sync saved the empty
  index over the real one. Only a missing file is an empty library. An
  unreadable index must throw and must not be written. Save it by renaming a
  temp file over the previous one.
- 2026-11-03: Discord Rich Presence counted from when Discord reconnected, and
  a playing update sent before `duration` was known omitted timestamps, so
  Discord showed a frozen `⏸ position · artist` line plus its own elapsed
  timer. A playing activity always sends `startTimestamp` from the live
  playhead. On `ready` (including reconnect) main tells the renderer
  (`discord-rpc-connected`) to send again. The dedupe key includes duration,
  or a late length never replaces the first payload.
- 2026-11-03: macOS release builds were ad-hoc signed on the GitHub runner.
  That signature is only valid on the machine that made it, so other Macs
  report "Unreleased.app is damaged" and `xattr -cr` does not help. Keep
  `mac.identity` null until there is an Apple Developer certificate. A copy
  that is already damaged can be opened with `xattr -cr` on the real path
  (`/Applications` or `~/Applications`) and then
  `codesign --force --deep --sign -` on that same path.
- 2026-11-03: `fetchAlbums` unwrapped page 1 of `/albums/` and dropped the
  edition rows on page 2. `fetchAlbums`, `adminFetchAlbums` and `fetchArtists`
  walk pages by number. Do not follow the `http://` `next` link.
- 2026-11-03: Bulk playlist additions use `addSongsToPlaylist`, bypassing native
  offline sync when it lives only in `addToPlaylist`. Keep sync in the batch
  function and delegate single additions to it, so adding an album or selected
  songs also updates downloaded playlists.

- 2026-10-30: WRLD's Artwork colors toggle only changed the visualizer palette,
  leaving the blurred cover visible when off. Background and text/queue contrast
  must use the theme when artwork colors are off, even if Theme background in
  WRLD is disabled. The theme-background preference still overrides artwork on.

- 2026-10-30: Q_scal's v2.6.14 React #185 stack maps to `CoverFade`'s cached-image
  layout effect (`Hh` in the published Windows bundle). Check cached images on
  source changes, not on the layer state the effect itself writes, and keep
  duplicate load/transition events idempotent. Map minified names using the actual
  release asset: a local rebuild of the same tag can assign different names.

- 2026-10-30: My proposals walked every page of `/accounts/editor/proposals/` (11+ requests at 2,000 proposals) so the tab counts and search could run on the client. The endpoint now takes `status` and `q` and returns `counts` (whole list per status), and `useMyProposals` loads one page and the next on scroll (`getMyProposalsPage`, `LoadMoreSentinel`). `getMyProposals` still walks everything, for the terminal; don't use it for UI lists. The comp list (`/contributor/proposals/`) is still one unpaginated call.

- 2026-10-30: WRLD's visualizer settings and the new "Old WRLD style" toggle
  did nothing until a restart. Settings opens as a pop-out window by default,
  and `store/vizStore.ts` is per window with no sync, so only the pop-out's copy
  changed. vizStore now follows `storage` events. A per-window store whose
  settings live in Settings needs the same, or window-sync.
- 2026-10-30: The mini player showed 0:00 for the length and couldn't seek on
  songs with no listed duration (most sessions): it used `track.duration`. A
  window without the audio element should take the length from the synced
  position (`currentTime / progress`), with the listed one only as a fallback.
  The Desktop player widget had the same bug for files (0:00, no seeking); the
  bridge now sends the audio's length when none is listed (`playingLength` in
  `lib/desktopBridge.ts`).
- 2026-10-30: Testing the app over CDP. `electron . --smoke-test` and plain
  `electron .` exit 0 without a word while the installed app runs (the
  single-instance lock), so always pass `--user-data-dir=<scratch>`; signed out
  is enough for the public views, so nothing needs copying. Settings, Song info
  and the mini player open as `?float=` pages: pick the CDP target by URL.
  Synthetic `KeyboardEvent`s don't reach the hotkeys; use `Input.dispatchKeyEvent`.
- 2026-10-30: `resubmitProposal` withdrew the proposal before creating its
  copy, so a failed create lost it, and it dropped the comp channel. It now
  creates first (with `channel_slug`) and withdraws the copy if the withdrawal
  fails. Replace server objects create-then-delete.

- 2026-10-30: The player bar's cover sometimes stayed blank for a whole song.
  `CoverFade` (`components/PlayerMotion.tsx`) showed a layer only from its
  `onLoad`; when the URL flipped offline copy -> API -> offline copy as a song
  started, React kept the already-loaded `<img>` by key and no load event came.
  It now also marks layers ready when their image is already `complete`. An
  `<img>` reused by key never fires `load` again; check `complete` too.
  Promo videos are made with the `unreleased-promo-video` skill in
  `../.claude/skills/`.

- 2026-10-29: Desktop ZIP downloads failed at 0 files with "createWritable …
  not allowed by the user agent". The save picker worked, but `main.js`'s
  permission check handler refuses everything it doesn't name, and Electron
  checks `fileSystem` (with no frame, origin only) before writing to a picked
  file. A denied check never reaches the request handler, so nothing was
  logged. `canUseFileSystem` in `electron/microphonePermission.js` now allows
  the app's own origin. A web API that works in Chrome but fails in the app
  probably needs its permission named in both handlers.

- 2026-10-28: The pop-out "Edit metadata" window crashed with React #185
  (maximum update depth). `LocalEditorPage` bounced to `backView` while it had
  no track, which flipped `previousView`, which flipped `backView` and re-ran the
  effect. The pop-out shows its page whatever `activeView` says, and its track
  arrives only once the library loads. A "nothing here, go back" effect must
  skip `IS_FLOAT_WINDOW` and read the back view from a ref, not its deps.

- 2026-10-27: Desktop settings kept displays by Electron's `display.label`, which
  is the monitor model, so two monitors of one model shared a name: hiding one
  hid both, and a widget left on the second came back on the first. Name
  displays only through `displayName(d, all)` in `electron/desktop/widgets.js`,
  passing every display (hidden ones too); it adds left/right or top/bottom for
  twins. Don't key displays by `id` either: twins can share it.

- 2026-10-27: Playlists showed up seconds after launch. Every song in playlist
  and favorites responses carried full `lyrics`/`synced_lyrics` (7.1M of a
  1,235-track library's characters; 0.8M without), so the `include_items`
  list went over `apiCache`'s 2M-character cap, was never cached, and launch
  waited behind getMe and favorites for it. `userApi` now sends
  `omit=lyrics,synced_lyrics` (backend support in `library/views.py`) and strips
  them again before caching; `loadAccount` starts the playlist fetch alongside
  getMe. Keep lyrics out of list payloads you cache, and check an entry's size
  against `MAX_ENTRY_CHARS`: `cacheSet` drops anything bigger without saying so.

- 2026-10-27: `/plays/stats/` `recent_plays` rows have `song_id: null` and
  `public_id: null` for radio plays of files with no catalog song, and
  Statistics asked for `/songs/null/`. Both are typed nullable now; skip null
  ids before resolving songs.

- 2026-10-27: To profile the renderer, serve a `vite build --sourcemap` copy on
  port 3018 and launch `electron . --user-data-dir=<scratch> --remote-debugging-port=9223`
  (see the 2026-10-21 entry for the profile copy). The dev window navigates
  before CDP setup lands even with `waitForDebuggerOnStart`, so expect to
  reload it once, and synthetic wheel input stalls while the window is hidden
  behind others. The API slows sharply under parallel load (one request
  ~0.1 s, 20 at once a median of 2 s), so count startup requests before
  blaming the renderer.

- 2026-10-26: Synced lyrics stamps were off after any jump on a VBR MP3: Chromium
  seeks those by estimate and reports the time it was asked for (11 of 12 jumps
  landed 0.1 to 1.7 s off on a test file; CBR and playing from 0 are exact). The
  dialog's `useAudioClock` now plays VBR MP3s as a decoded WAV
  (`lib/exactSeekAudio.ts`), and the song editor's Sync opens that dialog
  rather than stamping on the app's player. To measure seek accuracy, correlate against seeded
  noise from ffmpeg, never music: repeated bars give false matches whole bars off.
  The typed-time box also read `0:01:26` as m:ss:cc (1.26 s); it is h:mm:ss now.

- 2026-10-26: Playlist PATCH responses (rename, public toggle, reorder,
  description) omit `items`, but `updatePlaylist`/`renamePlaylist`/`reorderPlaylistItems`
  replaced the detail cache and React state with the bare PATCH body. Playlists
  then crashed in `playlistItemsToTracks` (`undefined.some`). Merge PATCH bodies
  into cached detail via `storePlaylistDetail` in `userApi.ts`; treat missing
  `items` as “keep previous”.

- 2026-10-26: A bidirectional `port-c` left relevant uncommitted source changes
  behind because they appeared during the relay. Include source changes from
  both working trees in the review and relay; do not assume they are out of
  scope. Keep machine-local settings, locks and generated reports out of commits.

- 2026-10-26: The profile admin preview fetched every user with proposal counts
  and badges just for totals, and waited for all sections together. Use
  `adminUserCounts` (`admin/users/?counts=1`) and publish sections independently;
  unavailable counts stay unknown. Deploy backend support before the renderer.

- 2026-10-25: Remote iOS Siri changes referenced `SiriRadioDonation` and
  `PlayMediaIntentHandler` without their definitions, breaking the Xcode archive.
  Both live in the already-compiled `SiriIntents.swift`; the media handler returns
  `continueInApp` with the activity handled by the app/scene delegates. JS bridge
  tests do not compile Swift; only a macOS Xcode archive confirms native builds.

- 2026-10-25: The iOS release script fast-forwards `origin/ios` before building.
  A web port left local URL-shortcut edits overlapping a remote Siri fix, so
  release stopped at that first step. Reconcile incoming commits before handing
  off a port: preserve local edits, fast-forward, and merge both the URL-context
  and Siri user-activity handlers in `SceneDelegate.swift`.

- 2026-10-25: Android offline playlist downloads take catalogue song ids, but
  mixed playlists include entries with `song: null`. Use `playlistSongIds`
  from `lib/playlistItems.ts` for both manual download and background sync.
  When porting web ZIP/download helpers, await Android's `saveFile` or
  `triggerDownload` so completion reflects the native write and failures surface.

- 2026-10-24: `GET /accounts/editor/proposals/` (My proposals) now returns
  paginated summaries (`count`, 50 per page by default, 200 max) without
  `proposed_data`/`original_snapshot`, only `changed_fields`. Editing a
  proposal from the list crashed the editor (`'name' in undefined`), and
  resubmit would have sent an empty proposal. Read data from
  `getProposal`/`withProposalData` in `lib/userApi.ts`; the admin queue
  still returns full rows.

- 2026-10-24: `terminal:check-coverage` follows calls by bare name across all
  of `lib/`, so a local helper called `run` inside `syncedLyrics.nudgeTarget`
  made it (and everything calling it) look like a request, because
  `compUploads`/`donorUploads` have a request-making `run`. Name local helpers
  in `lib/` so they don't share a name with a request function elsewhere.

- 2026-10-24: shared CLI uploads used the app's browser token lookup, so their
  XHR requests could be sent unsigned even after CLI login. Its file-backed
  localStorage now delegates `unreleased:authToken` to the CLI config/environment;
  keep that bridge when adding shared API clients. `npm test` checks uploads,
  comp replacement, lyrics, mixed playlists and live logs with isolated data.

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
