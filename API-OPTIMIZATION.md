# API-side optimization proposals

Server-side changes proposed against `juicewrldapi.com`. Everything here was
measured from a 6.7-minute HAR capture of beta (335 requests, 19.9 MB wire /
67.8 MB uncompressed) — the numbers are observed, not estimated.

The client-side fixes that don't need an API change have already landed
separately; these four can only be fixed on the server.

Precedent for all of this already exists in the API:
`GET /library/playlists/?omit_cover_image=true` drops a large base64 field from
a response for exactly these reasons.

---

## 1. `GET /songs/` — add `?omit_lyrics=true`

**Problem.** A song row is ~6.4 KB, and two fields are most of it:

| field | share of payload |
|---|---|
| `synced_lyrics` | 42% |
| `lyrics` | 39% |
| everything else (34 fields) | 19% |

The catalogue is 2741 songs, so a full crawl is **10.3 MB, of which ~8.4 MB is
lyrics**. Every current bulk consumer discards them immediately:

- the Wrapped/stats page slims each row to ~290 bytes (10 fields, neither
  lyrics field among them) before caching
- home, tracker sort mode, field autocomplete and compact grouping all read
  metadata only

Nothing that fetches in bulk renders lyrics. Lyrics are read one song at a
time, from `GET /songs/{id}/`, which should keep returning them.

**Proposal.** `?omit_lyrics=true` omits `lyrics` and `synced_lyrics` from every
row. Applies to the paginated form, `?all=true`, and search — i.e. it composes
with the existing params rather than being a separate mode.

**Effect.** Whole-catalogue fetch **10.3 MB → ~2 MB** (~80% reduction). This is
the single largest win available; `/songs/` traffic was 47% of the capture.

**Notes.** Opt-in, so no existing caller changes behaviour. A denylist
(`?omit=lyrics,synced_lyrics`) or a general `?fields=` allowlist would both
work too — `omit_lyrics` is just the smallest change that matches the
`omit_cover_image` precedent.

---

## 2. Chat list endpoints — stop embedding base64 images

**This is the big one for idle cost, and it's not really a polling problem.**

`GET /chat/dms/` returns 130 KB for **5 conversations**. `GET /chat/servers/`
returns 65 KB for **3 servers**. Breakdown:

| endpoint | size | what it is |
|---|---|---|
| `/chat/dms/` | 130 KB | **99.5%** is `participants[].user.avatar` — base64 JPEG data URIs, ~17 KB each |
| `/chat/servers/` | 65 KB | **94%** is `icon_url` — base64 JPEG data URIs, 13–26 KB each |

`icon_url` is named like a URL but contains `data:image/jpeg;base64,...`.

Three compounding problems:

1. **Base64 costs ~33% over binary** before anything else.
2. **It's uncacheable.** Embedded in a JSON body, these bytes can't be served
   from the HTTP cache, can't 304, and can't be shared between endpoints. The
   app already loads avatars as real URLs elsewhere
   (`cdn.discordapp.com/avatars/...`) — and those are cached perfectly: 143
   image requests in the capture, **0 bytes re-fetched**.
3. **It's re-sent per occurrence.** 6 distinct users across the DM list
   account for 128 KB, because each participant row carries a full copy of the
   user object.

**Proposal.** Return a URL. `avatar` and `icon_url` should point at an endpoint
that serves the image with the same `Cache-Control: public, max-age=…,
immutable` + ETag the rest of the asset routes already use.

If changing the field shape is breaking, `?omit_avatars=true` /
`?omit_icons=true` (again mirroring `omit_cover_image`) lets the client opt out
now and migrate later.

**Effect.** `/chat/dms/` **130 KB → ~1 KB**. `/chat/servers/` **65 KB → ~4 KB**.
Avatars then load once and stay cached, instead of being re-sent every 30 s.

---

## 3. Chat list endpoints — add ETag / `If-None-Match`

Independent of #2, and worth doing even after it.

These endpoints are polled every 30 s. In the capture, `/chat/dms/` and
`/chat/servers/` were each fetched 6 times and returned **byte-identical
bodies every single time** — nothing changed in 6.7 minutes. Neither response
carries `ETag`, `Last-Modified`, or `Cache-Control`.

**Proposal.** Emit an `ETag` on both, and honour `If-None-Match` with a 304.

**Effect.** Unchanged polls cost ~200 bytes instead of ~195 KB. In this capture
that's **every poll after the first**. The API already does this correctly
elsewhere — 16 requests in the capture returned 304, including a 10.3 MB
`/songs/?all=true` that cost 1 KB on its second fetch.

A `?since=<timestamp>` cursor would be better still (it also fixes the
`limit=1` unread probes), but ETag is the smaller change and captures most of
the benefit.

---

## 4. `PATCH /accounts/account/me/` — append endpoint for `listening_plays`

Lowest priority; listed for completeness.

`user_preferences` and `listening_plays` are whole-array blobs: the client must
re-send every row on every debounced push, because a partial array reads as
"cleared". Observed body: **93 KB** (37.7 KB prefs / 291 rows, 55.5 KB plays /
1053 rows).

The client-side part of this is already fixed — omitting null-valued fields cut
the prefs array by 33%. But `listening_plays` rows are already minimal
(`{song, played_at}`, 54 bytes) and can't be trimmed further. They're also
immutable append-only events, so re-sending all 1053 to record one new play is
pure overhead that only the server can remove.

**Proposal.** `POST /accounts/account/me/listening_plays/` appending only new
events, with server-side dedupe on `(song, played_at)` and the existing cap
applied server-side.

**Effect.** Typical push **93 KB → ~25 KB**. Cost stops growing with listening
history.

---

## Priority

| # | Change | Saving | Breaking? |
|---|---|---|---|
| 1 | `?omit_lyrics=true` on `/songs/` | ~8.4 MB per catalogue crawl | No (opt-in) |
| 2 | URLs instead of base64 in chat lists | ~190 KB per poll cycle, then cached | Yes, unless opt-in flag |
| 3 | ETag on chat lists | ~195 KB per unchanged poll | No |
| 4 | `listening_plays` append route | ~68 KB per push | No (additive) |

#1 and #3 are both non-breaking and independently deployable.
