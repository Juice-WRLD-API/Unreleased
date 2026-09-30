# Handoff: account-saved tier lists (API backend)

## What this is

The web player's Tier List game (rank songs into S/A/B/... rows) now supports
several saved lists per user: an album list, an era list, and so on. Until
now they lived only in the browser's localStorage. The client is being
changed to **save them to the user's account** and to let a user **make a
list public** so others can open it by link or from the user's profile.

The client side is already written on `web-dev` in the web repo
(`src/renderer/src/lib/tierlistApi.ts`, `lib/tierlistSync.ts`). It assumes the
contract below. **This handoff is the backend half only.** Until these routes
exist, the client sees 404/405 from `GET /library/tierlists/` and quietly stays
local-only, so the routes can be deployed whenever they're ready.

Model everything on **library playlists** (`/library/playlists/`): same auth,
same ownership rules, same `is_public` flag plus an anonymous `/public/{id}/`
read, and the same inclusion on the public profile.

## Data model

`TierList`:

| Field | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `owner` | FK → user | on delete cascade |
| `name` | str, max 100 | required, trimmed, non-empty (client caps at 60) |
| `is_public` | bool | default `false` |
| `data` | JSON | opaque to the server apart from validation (below) |
| `ranked_count` | int | **computed on save**: total song ids across `data.rows` |
| `created_at` | datetime | auto |
| `updated_at` | datetime | auto, bumped on **every** successful PATCH |

`updated_at` matters. The client compares it byte-for-byte against the value
it saw last, to detect edits made on another device. Always return it in the
same ISO-8601 format, and change it whenever the row changes.

### `data` shape (client-defined, version 1)

```json
{
  "v": 1,
  "tiers": [
    { "id": "s", "label": "S", "color": "#ff7f7f" },
    { "id": "tier-lx3k9-4", "label": "Mid", "color": "#7fbfff" }
  ],
  "rows": {
    "s": [4312, 118, 902],
    "tier-lx3k9-4": []
  },
  "filters": {
    "categories": ["released", "unreleased"],
    "eras": ["DRFL"],
    "albumId": 12
  }
}
```

- `tiers`: ordered, display order top to bottom.
- `rows`: tier id → **ordered** song ids (order within a tier is the user's
  ranking, so preserve array order exactly).
- `filters`: which songs the list draws from. The server doesn't need to
  interpret it.

### Validation (reject with 400 `{ "detail": "..." }`)

- `v` must be `1`.
- `tiers`: array, 1–30 items. Each has `id` (string, 1–64 chars, unique within
  the list), `label` (string, ≤ 20 chars, may be empty), `color` (string, ≤ 16
  chars).
- `rows`: object. Every key must be one of the `tiers[].id`. Values are arrays
  of positive integers. A song id may appear **at most once across all rows**.
  Total ids ≤ 5000.
- `filters`: object with `categories` (non-empty array, subset of
  `["released","unreleased"]`), `eras` (array of strings, ≤ 50), and `albumId`
  (int or null).
- Don't check that song ids exist in the catalogue. Songs get merged or removed
  and the client already skips ids it can't find.
- Request body cap of ~256 KB. A full list of 5000 ids is well under that.
- Max **200 tier lists per user**. Return 400 on POST past that.

## Endpoints

All under `/library/`, `Authorization: Token <token>`, same as playlists.
Errors use the usual `{ "detail": "..." }` body.

### Authenticated (owner only)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/library/tierlists/` | none | `200` array of **full** objects (including `data`) for the requesting user, newest `updated_at` first |
| POST | `/library/tierlists/` | `{ name, data, is_public? }` | `201` full object |
| PATCH | `/library/tierlists/{id}/` | any of `{ name, is_public, data }` | `200` full object |
| DELETE | `/library/tierlists/{id}/` | none | `204` |

- The list response may be a bare array or the DRF `{count,next,previous,results}`
  envelope, since the client accepts both. **Don't paginate it to a small page
  size**, because the client reads only the first page. Either return
  everything (≤ 200 rows) or honour `?all=true` like `/songs/`.
- PATCH/DELETE on a list the user doesn't own: **404**, not 403. The client
  treats 404 on PATCH as "deleted on another device" and re-creates it, and
  404 on DELETE as already done.
- `data` is replaced wholesale on PATCH (no deep merge). The client always
  sends the whole object.

Full object shape (used for every response above):

```json
{
  "id": 42,
  "name": "Death Race For Love",
  "is_public": true,
  "data": { "v": 1, "tiers": [...], "rows": {...}, "filters": {...} },
  "ranked_count": 57,
  "created_at": "2026-09-30T18:02:11.123456Z",
  "updated_at": "2026-09-30T18:40:02.987654Z"
}
```

### Public read (no auth required)

| Method | Path | Response |
|---|---|---|
| GET | `/library/tierlists/public/{id}/` | `200` full object **plus** `owner: { id, display_name }` |

- Return the list if `is_public` is true, **or** if the request carries the
  owner's token (the client calls this with auth when signed in).
- Otherwise **404** `{ "detail": "Not found." }`. Don't reveal that a
  private list exists.
- Same CORS behaviour as `/library/playlists/public/{id}/`. It's opened from
  share links by signed-out visitors.

### Public profile

`GET /accounts/profile/{user_id}/` gets a new key:

```json
"tierlists": [
  { "id": 42, "name": "Death Race For Love", "ranked_count": 57,
    "created_at": "...", "updated_at": "..." }
]
```

- Only lists with `is_public === true`, newest `updated_at` first, and no
  `data` (the client fetches the full list via the public endpoint on click).
- **Not** gated by a profile-level privacy flag, unlike `playlists` /
  `public_playlists`. Each list is already an explicit opt-in. Returning
  `[]` or omitting the key when there are none are both fine.

## What the client does with this (so edge cases make sense)

- It syncs on sign-in: `GET` the list, reconcile with local, then push. After
  that, edits are debounced about 1.5 s, then it sends one PATCH per changed
  list. Expect bursts of PATCHes while someone is dragging songs around, but
  never more than one in flight per client.
- Conflicts are last-writer-wins per list. The server doesn't need any
  version/ETag handling.
- Deletes are queued client-side and retried, so a DELETE for an id that's
  already gone is normal (404 is fine).
- Share links are `https://player.juicewrldapi.com/tierlist?id={id}`, using the
  server `id`.

## Verify

```bash
T=<a user token>; B=https://juicewrldapi.com/juicewrld

curl -s -H "Authorization: Token $T" $B/library/tierlists/            # []
curl -s -X POST -H "Authorization: Token $T" -H 'Content-Type: application/json' \
  -d '{"name":"Test","data":{"v":1,"tiers":[{"id":"s","label":"S","color":"#ff7f7f"}],"rows":{"s":[1,2]},"filters":{"categories":["released"],"eras":[],"albumId":null}}}' \
  $B/library/tierlists/                                                 # 201, ranked_count 2
curl -s $B/library/tierlists/public/<id>/                               # 404 (private, no auth)
curl -s -X PATCH -H "Authorization: Token $T" -H 'Content-Type: application/json' \
  -d '{"is_public":true}' $B/library/tierlists/<id>/                    # 200, updated_at changed
curl -s $B/library/tierlists/public/<id>/                               # 200 with owner
curl -s $B/accounts/profile/<user_id>/ | jq .tierlists                  # contains it
# validation: duplicate song across rows, unknown tier key, 31 tiers -> 400
curl -s -X DELETE -H "Authorization: Token $T" $B/library/tierlists/<id>/   # 204
```

## Not in scope here

- API docs. Once the routes are live, report the final shapes back.
  `docs/api-docs/05-playlists.md` and the in-app docs page
  (`components/docs/content.tsx`, which is hand-written) get updated on the web
  side.
- Discord/social unfurls for `/tierlist?id=`. That's a web-side follow-up in
  `server/social-preview.mjs` once the public endpoint exists.
