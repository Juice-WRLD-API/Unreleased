# Handoff: social/Discord link previews (deploy)

## What this is

Discord/Twitter/Slack/iMessage link unfurling for `/track/:id`, `/shared/:id`
(anonymous playlist shares) and `/news/:id`. The site is a client-rendered SPA,
so those bots (they don't execute JS) only ever saw the generic site-wide OG
tags in `index.html` no matter which item was actually shared. Fix is a
small standalone Node service that bots get proxied to; real visitors are
completely unaffected and keep hitting the static SPA build.

All app-side code (the new `/track/:id` page, the "Copy link" menu action,
this service) is already written on `web-dev` - make sure it has been
committed and pushed before deploying from it. **This handoff
is the deploy/infra half only** - nothing below touches application code.

## Files already in the repo

- `server/social-preview.mjs` - the prerender service. Zero npm dependencies
  (built-in `http` + global `fetch` only). Tested locally against the live
  API (`https://juicewrldapi.com/juicewrld`) for both `/track/:id` and
  `/news/:id` - confirmed real titles/images/descriptions come back correctly,
  and a missing/invalid id falls back to generic tags instead of erroring.
- `server/nginx-social-preview.conf.example` - nginx snippet, **not a
  drop-in file** - merge the `map` block and the two `location` blocks into
  the real server config for `player.juicewrldapi.com`.
- `server/social-preview.service.example` - systemd unit template.
- `npm run social-preview` - runs `node server/social-preview.mjs` directly
  (for manual testing before wiring nginx).

## What needs to happen on the server

1. **Deploy the service.**
   - Copy `server/social-preview.service.example` to
     `/etc/systemd/system/social-preview.service`, fix `User`,
     `WorkingDirectory`, and the `node` path for that box.
   - `sudo systemctl daemon-reload && sudo systemctl enable --now social-preview`
   - Verify: `curl localhost:8788/track/1` should return HTML with real
     `og:title`/`og:image` for song id 1 (or any known song id).

2. **Wire nginx.**
   - Merge `server/nginx-social-preview.conf.example` into the real
     `player.juicewrldapi.com` server block - the `map $http_user_agent
     $is_social_bot` goes once in `http {}`, the two `location` blocks go
     inside the site's `server {}`, **above** the existing SPA `location /`
     fallback (nginx uses the first matching `location`, order matters).
   - `sudo nginx -t && sudo systemctl reload nginx`

3. **Verify end to end**, spoofing the Discord bot's user-agent so you don't
   need Discord itself to test:
   ```bash
   curl -A "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)" \
     https://player.juicewrldapi.com/track/1
   # should return the prerendered HTML with per-track og:title/og:image

   curl https://player.juicewrldapi.com/track/1
   # should return the normal SPA index.html (no user-agent match -> falls through)
   ```
   Then paste a real `/track/:id`, `/shared/:id`, `/news/:id` link into a
   Discord channel and confirm the embed shows the right title/image.

## Config knobs (env vars on the systemd unit)

| Var | Default | Purpose |
|---|---|---|
| `SOCIAL_PREVIEW_PORT` | `8788` | Port the service listens on; must match nginx's `proxy_pass`. |
| `SOCIAL_PREVIEW_HOST` | `127.0.0.1` | Interface the service binds; keep it loopback so only nginx reaches it. |
| `JWAPI_BASE` | `https://juicewrldapi.com/juicewrld` | API base the service fetches song/playlist/news data from. |
| `SITE_ORIGIN` | `https://player.juicewrldapi.com` | Used to build canonical/og:url links back to the SPA. |

## Known limitation / heads-up

There is a **second, separate playlist-sharing mechanism** already live in
the app: `/playlists?id=<id>&view=shared` (a logged-in user's public library
playlist, distinct from the anonymous `/playlists/share/` -> `/shared/:id`
flow this covers). It is **not** handled by `social-preview.mjs` or the nginx
rule yet - those links will still unfurl with the generic site-wide card. Flag
to product/frontend if that needs covering too; it's a query-param route on
`/playlists`, not a clean path prefix, so the nginx match and the service's
routing would both need a small extension.

## Nothing else required from the API/backend side

The service only ever does read-only `GET` calls against endpoints that
already exist and are already public/anonymous-readable (`/songs/{id}/`,
`/playlists/shared/{id}/`, `/news/{id}/`) - no new endpoints, no CORS changes,
no auth. If any of those three response shapes change, `social-preview.mjs`'s
parsing (`firstTrackArray`, `playlistName`, `trackPath` for playlists;
straight field reads for songs/news) may need a matching update.
