# Unreleased (web)

The browser version of Unreleased, a music player for Juice WRLD's unreleased
catalogue built on the [Juice WRLD API](https://juicewrldapi.com). It runs live
at **[player.juicewrldapi.com](https://player.juicewrldapi.com)**.

This is the `web` branch. It shares most of its code with the desktop app
(`app`), but has its own mobile layouts and leaves out everything that needs
Electron. You can install it to your home screen as a web app; the Download
page links the desktop, Android and iOS builds.

---

## What's in it

**Listening**
- **Home**: a dashboard whose sections you can show or hide: recently played
  (synced across devices), playlists, albums, 999 FM, news, games and your
  listening stats.
- **Tracker**: search and filter the whole API song catalogue, with
  field-qualified search such as `artists:"Juice WRLD"`. You choose which
  fields show in the list and in the detail panel, and drag to reorder them.
- **Files**: browse the API's file archive, with previews, a text and `.lrc`
  viewer, and ZIP downloads built in the browser.
- **Playlists**: folders, custom covers, share links, following someone
  else's playlist live, and JSON/M3U export.
- **Player**: a queue with history, search and reshuffle, radio/shuffle mode,
  automatic recovery when a stream stalls, synced lyrics, an equalizer with
  volume boost, era covers and personal covers. It also shows on your phone's
  lock screen.
- **WRLD**: a full-screen now-playing view with blurred art, scrolling
  synced lyrics, audio-reactive visualizers and 999 FM controls.
- **999 FM**: the API's live radio, with listener votes and song suggestions.
- **Downloads** can carry the song's lyrics and your cover art in the MP3.

**Sharing**
- Track pages with real URLs, plus link previews for tracks, playlists,
  profiles and news when they're posted on Discord, X and similar sites (see
  [Social previews](#social-previews)).
- Lyrics and now-playing image cards.
- Share songs, playlists and news straight into chat.

**Extras**
- **Games**: Heardle (daily, practice and live 1v1), Wordle, and tier lists
  saved to your account.
- **Wrapped** for your own listening, and **Statistics** for the whole
  catalogue.
- **News** with channels and notifications.
- **Last.fm** scrobbling.
- **Customisation**: skins and themes, a sidebar or pill nav where you choose
  and reorder the tabs, and rebindable keyboard shortcuts.

**Accounts and community**
- Sign in with Discord, or with a username and password plus optional
  two-factor auth. Your settings sync across devices.
- Public profiles, liked songs, and API key management.
- Song edit proposals, a synced-lyrics timing tool, bulk editing, file
  ("comp") uploads, reports and feedback.
- Roles (contributor, editor, manager, admin) with review queues, and an admin
  console covering users, eras, albums, channels, broadcasts, CDN nodes and
  beta builds.
- End-to-end encrypted chat with servers, DMs, GIFs, link previews, device
  linking and message search.
- Donor file storage and playback, plus an optional peer-to-peer CDN for
  downloads.
- **Terminal**: a command line in the browser that can do almost everything
  the UI does.
- **API docs**, both in the app and as Markdown in [`docs/api-docs`](docs/api-docs).

**Desktop app only, not available here:** local file library, offline
downloads, audio format conversion, URL import, Discord Rich Presence, global
hotkeys, mini player and pop-out windows.

---

## Phones and desktop browsers

Most views come in two versions: `Component.desktop.tsx` and
`Component.mobile.tsx`. The plain `Component.tsx` uses `responsiveView()` to
load whichever one matches the screen size, so a phone never downloads the
desktop layout. Phones get a bottom tab bar with a More sheet, full-height
bottom sheets you can swipe to dismiss, and touch gestures. Desktop browsers
get the same layout as the desktop app.

The service worker (`src/renderer/public/sw.js`) always loads the page HTML
from the network, so nobody boots an old build. The cache is only an offline
fallback, plus a cache for the hashed `/assets/` files.

---

## Running locally

You need Node.js (22 or newer is what the project uses) and npm.

```bash
npm install
npm run dev
```

The dev server runs on port `5173` and is reachable from your local network,
so you can test on a phone. On Windows, `run.bat` does the same thing.

### Local config

Put any of these in `.env.local`. Every value is optional:

| Variable | Used for |
|---|---|
| `VITE_AUTH_TOKEN` | An API token, so local dev skips signing in |
| `VITE_LASTFM_API_KEY` / `VITE_LASTFM_API_SECRET` | Last.fm scrobbling |
| `VITE_GIPHY_API_KEY` / `VITE_TENOR_API_KEY` | The chat GIF picker |
| `VITE_JWAPI_WS` | Points the realtime sockets (chat, notifications, Heardle 1v1) at a different server |

The API defaults to `https://juicewrldapi.com/juicewrld`. Developers can
change it at runtime under **Settings → Developer → API servers**.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck and build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run docs:check-drift` | Report where `docs/api-docs/*.md` and the in-app docs disagree |
| `npm run terminal:check-coverage` | List UI API calls the terminal can't reach yet |
| `npm run social-preview` | Start the social preview server |

---

## Social previews

The site is a single-page app, so crawlers that don't run JavaScript
(Discordbot, for one) would only ever see the generic site tags.
`server/social-preview.mjs` fixes that. nginx sends known bot user agents on
`/track/`, `/shared/` and `/news/` links to it, and it returns a small page
with the right title, description and image for that item. Track links can
include a playable video embed. It also serves the link-preview endpoint the
chat uses.

[`server/nginx-social-preview.conf.example`](server/nginx-social-preview.conf.example)
and [`server/social-preview.service.example`](server/social-preview.service.example)
show how to wire it up. The header comment in the script lists its
environment variables.

---

## Project layout

```
src/renderer/
  index.html          entry page and default meta tags
  public/             manifest, service worker, icons, fonts, sitemap
  src/
    App.tsx           app shell
    components/       views (.desktop / .mobile pairs), modals, panels
    lib/              API clients, chat crypto, CDN, player helpers
    lib/terminal/     terminal commands, one module per area
    hooks/  store/    React hooks and Zustand stores
server/               social preview server and deployment examples
docs/api-docs/        API reference in Markdown
scripts/              release script, docs and terminal checks, data tools
```

---

## Releasing

`scripts\release.bat` runs `scripts/python/release.py`. It fast-forwards onto
the remote branch, bumps the version, commits, pushes, and can tag a GitHub
release with notes. There's no build artifact: the live site is served
straight from a checkout of this branch.

The `web` branch doesn't sync with `app`, `android` or `ios` automatically.
Changes are ported between them by hand, and `app`'s `md/RELAY_LOG.md`
records each port.

---

## License

[MIT](LICENSE).
