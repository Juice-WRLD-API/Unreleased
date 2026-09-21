import { useMemo } from 'react'
import { ExternalLink } from 'lucide-react'
import { Pre, Table } from './shared'
import { DocsSearchContext, type DocsSearchValue } from './searchContext'
import { usePrimitives } from './primitivesContext'

// ─── Tab content ──────────────────────────────────────────────────────────────
// Single source of truth for API docs content. Desktop and mobile both
// render this, supplying their own Code/Section/Endpoint/MethodPath via
// DocsPrimitivesProvider so touch vs. hover chrome stays platform-specific
// without duplicating the actual documentation text.

function OverviewTab() {
  const { Code, Section, Endpoint, MethodPath } = usePrimitives()
  return (
    <div className="space-y-6">
      <Section title="Introduction">
        <p className="text-sm text-text-secondary leading-relaxed">
          The Juice WRLD API gives programmatic access to the largest Juice WRLD music database: over 2,700
          catalogued songs, unreleased tracks, file browsing, and rich metadata. Public read endpoints need
          no API key.
        </p>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-xs text-text-muted">Base URL</span>
          <Code>https://juicewrldapi.com/juicewrld</Code>
        </div>
        <a
          href="https://juicewrldapi.com/api-docs"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
        >
          Open live API docs <ExternalLink size={11} />
        </a>
      </Section>

      <Section title="Index & Health Check">
        <MethodPath method="GET" path={`/`} />
        <p className="text-xs text-text-muted mb-2">API index. Absolute URIs to the major collections, useful as a quick sanity check or a starting point for API explorers.</p>
        <Pre>{`{
  "artists": "https://…/juicewrld/artists/",
  "albums": "https://…/juicewrld/albums/",
  "songs": "https://…/juicewrld/songs/",
  "versions": "https://…/juicewrld/versions/",
  "eras": "https://…/juicewrld/eras/",
  "stats": "https://…/juicewrld/stats/",
  "categories": "https://…/juicewrld/categories/"
}`}</Pre>
        <MethodPath method="GET" path={`/health/`} className="mt-3" />
        <p className="text-xs text-text-muted">Liveness check. <Code>{'{ "status": "ok" }'}</Code>, nothing else.</p>
      </Section>

      <Section title="Endpoint Overview">
        <div className="divide-y divide-[var(--border)]">
          <Endpoint method="GET" path="/" description="API index with links to the major collections" />
          <Endpoint method="GET" path="/health/" description="Health check" />
          <Endpoint method="GET" path="/artists/" description="List artists" />
          <Endpoint method="GET" path="/artists/{id}/" description="Single artist by ID" />
          <Endpoint method="GET" path="/albums/" description="List albums" />
          <Endpoint method="GET" path="/albums/{id}/" description="Single album by ID" />
          <Endpoint method="GET" path="/songs/" description="List, filter, search and paginate songs" />
          <Endpoint method="GET" path="/songs/{id}/" description="Single song by internal ID" />
          <Endpoint method="GET" path="/categories/" description="Available category values with labels" />
          <Endpoint method="GET" path="/eras/" description="All eras, paginated (34 total, 20 per page)" />
          <Endpoint method="GET" path="/eras/{id}/" description="Single era by ID" />
          <Endpoint method="GET" path="/stats/" description="Database-wide counts by category and era" />
          <Endpoint method="GET" path="/radio/random/" description="Random playable song with full metadata" />
          <Endpoint method="GET" path="/radio/live/" description="Live 999 FM station state: now playing, votes, listeners" />
          <Endpoint method="GET" path="/radio/library/" description="Track list backing the live station, grouped by era" />
          <Endpoint method="GET" path="/radio/stream.mp3" description="Live radio MP3 stream (WebSocket /ws/radio/ carries the same audio + metadata)" />
          <Endpoint method="GET" path="/files/channels/" description="List active comp channels (public)" />
          <Endpoint method="GET" path="/files/browse/" description="Browse the file system" />
          <Endpoint method="GET" path="/files/list-all/" description="Flat listing of every file in a comp channel" />
          <Endpoint method="GET" path="/files/info/" description="Metadata for a single file" />
          <Endpoint method="GET" path="/files/cover-art/" description="Cover art image for an audio file" />
          <Endpoint method="GET" path="/files/thumbnail/" description="Thumbnail image for a file" />
          <Endpoint method="GET" path="/files/download/" description="Stream/download audio, supports Range requests" />
          <Endpoint method="GET" path="/files/download-compressed/" description="Transcoded MP3 stream at a chosen bitrate" />
          <Endpoint method="GET" path="/files/image-thumbnail/" description="Resized JPEG thumbnail for an image file" />
          <Endpoint method="POST" path="/files/zip-selection/" description="Immediate ZIP stream of selected paths (not a background job)" />
          <Endpoint method="GET" path="/zip-jobs/{filename}" description="Download the finished ZIP from a background job" />
          <Endpoint method="GET" path="/versions/" description="All song-version rows (bulk mode via ?all=true)" />
          <Endpoint method="GET" path="/versions/{song_id}/" description="Version rows for one song, if linked" />
          <Endpoint method="GET" path="/versions/{song_id}/{id}/" description="A single version row by its own ID" />
          <Endpoint method="POST" path="/versions/" description="Link a song into a version group (editor+)" />
          <Endpoint method="PATCH" path="/versions/{song_id}/" description="Update a song's version label/title/group (editor+)" />
          <Endpoint method="POST" path="/playlists/share/" description="Create a public shared playlist link" />
          <Endpoint method="GET" path="/playlists/shared/{share_id}/" description="Fetch a shared playlist by ID" />
          <Endpoint method="POST" path="/plays/" description="Record a play event (no auth required)" />
          <Endpoint method="GET" path="/plays/stats/" description="Site-wide play stats: top songs, albums, eras, recent plays" />
          <Endpoint method="GET" path="/heardle/leaderboard/" description="Heardle leaderboards: streak, today, versus" />
          <Endpoint method="GET" path="/heardle/clip/" description="Signed Heardle audio clip (HMAC round token, not a user token)" />
          <Endpoint method="GET" path="/feeds/tracker.rss" description="RSS feed of approved song edits" />
          <Endpoint method="GET" path="/feeds/comp.rss" description="RSS feed of comp file commits" />
          <Endpoint method="GET" path="/feeds/tracker.json" description="JSON feed of approved song edits" />
          <Endpoint method="GET" path="/feeds/comp.json" description="JSON feed of comp file commits" />
          <Endpoint method="GET" path="/cover/{name}" description="Static cover art image by filename" />
          <Endpoint method="GET" path="/media/{path}" description="Static media file (news covers, attachments, etc.)" />
          <Endpoint method="GET" path="/accounts/account/me/" description="Current user info (public-facing), incl. per-song preferences + playlist folders" />
          <Endpoint method="PATCH" path="/accounts/account/me/" description="Update display_name, user_preferences (custom titles, covers, default version, playcounts), user_settings (muted users, theme), and/or playlist_folders" />
          <Endpoint method="GET" path="/accounts/me/" description="Current user with role, for editor/admin dashboards" />
          <Endpoint method="POST" path="/feedback/" description="Submit API feedback (no auth)" />
          <Endpoint method="GET" path="/feedback/" description="List submitted feedback (requires auth)" />
          <Endpoint method="POST" path="/reports/" description="Report wrong info on a song (no auth)" />
          <Endpoint method="GET" path="/reports/" description="List song reports (editor+)" />
          <Endpoint method="PATCH" path="/reports/{id}/" description="Review a song report (editor+)" />
          <Endpoint method="GET" path="/accounts/donor/files/" description="List donor cloud files + quota (donor only, 1 GB)" />
          <Endpoint method="POST" path="/accounts/donor/files/upload/" description="Upload an audio/image file to donor storage (donor only)" />
          <Endpoint method="PATCH" path="/accounts/donor/files/{file_id}/" description="Rename a donor file or toggle its share link" />
          <Endpoint method="GET" path="/accounts/donor/shared/{share_token}/" description="Download a shared donor file (no auth)" />
          <Endpoint method="POST" path="/accounts/logout/" description="Invalidate the current token" />
          <Endpoint method="GET" path="/accounts/application/" description="Fetch the logged-in user's editor or contributor application" />
          <Endpoint method="POST" path="/accounts/application/" description="Apply to become an editor or contributor" />
          <Endpoint method="GET" path="/accounts/editor/proposals/" description="List your own edit proposals" />
          <Endpoint method="POST" path="/accounts/editor/proposals/" description="Submit an edit proposal (editor+)" />
          <Endpoint method="GET" path="/accounts/editor/proposals/{id}/" description="Fetch a single proposal by id, any status" />
          <Endpoint method="PATCH" path="/accounts/editor/proposals/{id}/" description="Edit a pending proposal" />
          <Endpoint method="DELETE" path="/accounts/editor/proposals/{id}/" description="Withdraw a proposal" />
          <Endpoint method="GET" path="/accounts/editor/leaderboard/" description="Editor approved-count leaderboard with badges" />
          <Endpoint method="GET" path="/accounts/contributor/proposals/" description="List your own comp-file proposals (contributor+)" />
          <Endpoint method="POST" path="/accounts/contributor/proposals/" description="Submit a comp-file proposal (multipart, contributor+)" />
          <Endpoint method="PATCH" path="/accounts/contributor/proposals/{id}/" description="Edit a pending comp-file proposal (multipart)" />
          <Endpoint method="DELETE" path="/accounts/contributor/proposals/{id}/" description="Withdraw a comp-file proposal" />
          <Endpoint method="GET" path="/accounts/admin/comp-proposals/" description="List all comp-file proposals (admin)" />
          <Endpoint method="POST" path="/accounts/admin/comp-proposals/{id}/review/" description="Approve/reject a comp-file proposal (admin)" />
          <Endpoint method="POST" path="/accounts/admin/comp-proposals/{id}/reverse/" description="Reverse an approved comp-file proposal (admin)" />
          <Endpoint method="GET" path="/accounts/admin/comp-proposals/{id}/staging/" description="Download the staged file for review (admin)" />
          <Endpoint method="GET" path="/accounts/admin/comp-files/{filepath}/history/" description="Revision history for a compilation file (admin)" />
          <Endpoint method="GET" path="/accounts/admin/channels/" description="List all comp channels, incl. inactive (admin)" />
          <Endpoint method="POST" path="/accounts/admin/channels/" description="Create a comp channel (admin)" />
          <Endpoint method="PATCH" path="/accounts/admin/channels/{id}/" description="Rename/describe/reactivate a comp channel (admin)" />
          <Endpoint method="DELETE" path="/accounts/admin/channels/{id}/" description="Deactivate a comp channel (admin)" />
          <Endpoint method="GET" path="/accounts/admin/channels/{id}/members/" description="List a comp channel's per-user role memberships (admin)" />
          <Endpoint method="POST" path="/accounts/admin/channels/{id}/members/" description="Set a user's editor/contributor/manager flags for a comp channel (admin)" />
          <Endpoint method="GET" path="/accounts/admin/eras/" description="List all eras, ordered by name (admin)" />
          <Endpoint method="POST" path="/accounts/admin/eras/" description="Create an era (admin)" />
          <Endpoint method="PATCH" path="/accounts/admin/eras/{id}/" description="Update an era (admin)" />
          <Endpoint method="DELETE" path="/accounts/admin/eras/{id}/" description="Delete an era (admin)" />
          <Endpoint method="GET" path="/accounts/admin/albums/" description="List all albums, ordered by title, nested artist (admin)" />
          <Endpoint method="POST" path="/accounts/admin/albums/" description="Create an album, optionally with a tracklist (admin)" />
          <Endpoint method="PATCH" path="/accounts/admin/albums/{id}/" description="Update an album; sending songs[] replaces the tracklist (admin)" />
          <Endpoint method="DELETE" path="/accounts/admin/albums/{id}/" description="Delete an album (admin)" />
          <Endpoint method="GET" path="/news/" description="Paginated news feed. Filter: ?channel=, sort: ?ordering=" />
          <Endpoint method="GET" path="/news/{id}/" description="Single news post" />
          <Endpoint method="POST" path="/news/" description="Create a news post (is_news or admin)" />
          <Endpoint method="PATCH" path="/news/{id}/" description="Edit a news post (own post only unless admin)" />
          <Endpoint method="DELETE" path="/news/{id}/" description="Delete a news post (own post only unless admin)" />
          <Endpoint method="GET" path="/news/channels/" description="List news channels" />
          <Endpoint method="POST" path="/news/channels/" description="Create a news channel (admin)" />
          <Endpoint method="PATCH" path="/news/channels/{slug}/" description="Rename/describe a news channel (admin)" />
          <Endpoint method="DELETE" path="/news/channels/{slug}/" description="Delete a news channel, only if empty (admin)" />
          <Endpoint method="POST" path="/news/uploads/" description="Upload a post attachment (multipart, ≤25MB, is_news or admin)" />
          <Endpoint method="GET" path="/news/attachments/{id}/stream/" description="Stream/download a hosted attachment" />
          <Endpoint method="GET" path="/library/favorites/" description="List personal favorites (any logged-in user)" />
          <Endpoint method="POST" path="/library/favorites/" description="Add a favorite" />
          <Endpoint method="DELETE" path="/library/favorites/{song_id}/" description="Remove a favorite" />
          <Endpoint method="GET" path="/library/playlists/" description="List personal playlists" />
          <Endpoint method="POST" path="/library/playlists/" description="Create a personal playlist" />
          <Endpoint method="GET" path="/library/playlists/{id}/" description="Get a personal playlist with tracks" />
          <Endpoint method="PATCH" path="/library/playlists/{id}/" description="Update name, description, cover, visibility, track order" />
          <Endpoint method="DELETE" path="/library/playlists/{id}/" description="Delete a personal playlist" />
          <Endpoint method="POST" path="/library/playlists/{id}/items/" description="Add a track to a playlist" />
          <Endpoint method="DELETE" path="/library/playlists/{id}/items/{song_id}/" description="Remove a track from a playlist" />
          <Endpoint method="GET" path="/library/playlists/public/{id}/" description="Fetch a playlist marked public (no auth required)" />
        </div>
      </Section>

      <Section title="Songs Object: Full Shape">
        <Pre>{`{
  "id": 1,
  "public_id": 123,
  "name": "Song Title",
  "original_key": "Original JSON Key",
  "category": "released|unreleased|unsurfaced|recording_session",
  "path": "Compilation/folder/song.mp3",
  "era": {
    "id": 1,
    "name": "Era Name",
    "description": "Era Description",
    "time_frame": "Time Period",
    "play_count": 0
  },
  "track_titles": ["Title 1", "Title 2"],
  "credited_artists": "Artist Names",
  "producers": "Producer Names",
  "engineers": "Engineer Names",
  "recording_locations": "Studio Locations",
  "record_dates": "Recording Dates",
  "length": "3:59",
  "bitrate": "Bitrate Info",
  "bpm": 140,
  "key": "C# Minor",
  "additional_information": "Extra Info",
  "file_names": "File Name(s)",
  "instrumentals": "Instrumental beat name",
  "instrumental_names": "Instrumental track names",
  "preview_date": "Preview Date",
  "release_date": "Release Date",
  "dates": "Additional Dates",
  "session_titles": "Session Titles",
  "session_tracking": "Session Tracking",
  "notes": "Internal notes",
  "groupbuy_info": {
    "additional_info": "",
    "price": "",
    "start_date": "",
    "end_date": "",
    "blind": false,
    "finished": false,
    "surfaced_with_og": false
  },
  "lyrics": "Song Lyrics",
  "synced_lyrics": "Timestamped lyrics (karaoke-style)",
  "album": "Album Name",
  "snippets": [],
  "date_leaked": "Leak Date",
  "leak_type": "Leak Type",
  "image_url": "/assets/era-image.webp",
  "version_title": "Version label (only with ?versions=true on /songs/)",
  "versions": []
}`}</Pre>
        <p className="text-xs text-text-muted">
          <Code>image_url</Code> is relative; prepend <Code>https://juicewrldapi.com</Code> before use.
        </p>
        <p className="text-xs text-text-muted">
          <Code>version_title</Code> and <Code>versions</Code> are omitted unless the request includes <Code>?versions=true</Code>. See the <Code>/songs/</Code> params below.
        </p>
        <p className="text-xs text-text-muted font-semibold mt-3">
          <Code>synced_lyrics</Code>: no separate param, no opt-in flag
        </p>
        <p className="text-xs text-text-muted">
          Unlike <Code>version_title</Code>/<Code>versions</Code> above, <Code>synced_lyrics</Code> is a plain field
          on the song object like <Code>lyrics</Code>. It comes back on every request that returns a song (list,
          detail, radio, live); no query param requests it. It&apos;s <Code>null</Code> when the song
          has no synced lyrics.
        </p>
        <p className="text-xs text-text-muted">
          Format is <span className="font-semibold text-text-primary">LRC</span>: one timestamp per line,{' '}
          <Code>[mm:ss.xx]</Code> (also accepts <Code>[mm:ss:xx]</Code>), text after the bracket:
        </p>
        <Pre>{`[00:12.50]First line
[00:15.80]Second line
[00:19.10](ad-lib) Next line`}</Pre>
        <p className="text-xs text-text-muted">
          A line can carry more than one timestamp (repeats the same text at each). Parenthesized runs like{' '}
          <Code>(ad-lib)</Code> are a convention this app renders dimmer, not part of the LRC spec itself.
        </p>
      </Section>
    </div>
  )
}

function SongsTab() {
  const { Code, Section, MethodPath } = usePrimitives()
  return (
    <div className="space-y-6">
      <Section title="List & Search (GET /songs/)">
        <p className="text-sm text-text-secondary">Paginated song list with rich filtering. All params are optional.</p>
        <Table
          headers={['Param', 'Type', 'Description']}
          rows={[
            [<Code>page</Code>, 'number', 'Page number (default: 1)'],
            [<Code>page_size</Code>, 'number', 'Results per page (default: 20)'],
            [<Code>category</Code>, 'string', <><Code>released</Code>, <Code>unreleased</Code>, <Code>unsurfaced</Code>, <Code>recording_session</Code></>],
            [<Code>era</Code>, 'string', 'Era abbreviation, e.g. "GB&GR", "DRFL", "WOD", "OUT", "POST". Use the name from /eras/'],
            [<Code>search</Code>, 'string', 'Search names, artists, track titles (normalizes special chars, so "dont" matches "don\'t")'],
            [<Code>searchall</Code>, 'string', 'Search names, artists, producers, track titles'],
            [<Code>lyrics</Code>, 'string', 'Full-text search within lyrics content'],
            [<Code>all</Code>, 'string', <>&quot;true&quot; returns the <span className="font-semibold text-text-primary">entire catalogue in one response</span> as a plain array. There's no pagination envelope, and <Code>page</Code>/<Code>page_size</Code> are ignored. It's ~2,500 songs, so use it for whole-dataset work (calendars, grouping, offline seeding), not for lists a user scrolls.</>],
            [<Code>file_names_array</Code>, 'string', '"true" to return file_names as array instead of string'],
            [<Code>versions</Code>, 'string', <>"true" to add <Code>version_title</Code> and a <Code>versions</Code> array to each song. Collection endpoint only; <Code>{'/songs/{id}/'}</Code> ignores it.</>],
          ]}
        />
        <p className="text-xs text-text-muted font-semibold mt-2">Response shape:</p>
        <Pre>{`{
  "count": 1234,
  "next": "https://juicewrldapi.com/juicewrld/songs/?page=2",
  "previous": null,
  "results": [ /* Song objects */ ]
}`}</Pre>
        <p className="text-xs text-text-muted font-semibold mt-2">With <Code>?all=true</Code>: bare array, no envelope:</p>
        <Pre>{`[ /* every Song object */ ]`}</Pre>
        <p className="text-xs text-text-muted">
          Note there is <span className="font-semibold text-text-primary">no ordering/sort param</span>, and{' '}
          <Code>category</Code>/<Code>era</Code> each accept only one value per request. Sorting, and any
          multi-category or multi-era view, has to be assembled client-side.
        </p>
      </Section>

      <Section title="Single Song (GET /songs/{id}/)">
        <p className="text-sm text-text-secondary">Returns a full song object by internal ID (<Code>song.id</Code>, not <Code>public_id</Code>).</p>
      </Section>

      <Section title="Batch Fetch (GET /songs/?ids=...)">
        <p className="text-sm text-text-secondary">
          Despite the param name, <Code>ids</Code> filters by <Code>public_id</Code>, not the internal{' '}
          <Code>id</Code> used everywhere else on this page - and most unreleased songs have no{' '}
          <Code>public_id</Code> at all, so it can&apos;t resolve them. The response is also the normal
          paginated JSON envelope, not CSV. Until this endpoint gets a real batch-by-internal-id mode,
          resolve many IDs with parallel <Code>{'/songs/{id}/'}</Code> calls instead.
        </p>
      </Section>

      <Section title="GET /categories/">
        <Pre>{`{
  "categories": [
    { "value": "released",          "label": "Released" },
    { "value": "unreleased",        "label": "Unreleased" },
    { "value": "unsurfaced",        "label": "Unsurfaced" },
    { "value": "recording_session", "label": "Recording Session" }
  ]
}`}</Pre>
      </Section>

      <Section title="GET /eras/">
        <p className="text-sm text-text-secondary">Paginated, same envelope as /songs/. 34 eras total. Era names use short abbreviation strings.</p>
        <Pre>{`{
  "count": 34,
  "next": "https://juicewrldapi.com/juicewrld/eras/?page=2",
  "previous": null,
  "results": [
    { "id": 101, "name": "jute",        "description": "JUICED UP THE EP era (~2014-February 2017)", "time_frame": "(January 2014-February 2017)", "play_count": 2980 },
    { "id": 103, "name": "afflictions", "description": "Affliction era (February 2017-May 2017)",    "time_frame": "(February 2017-May 2017)",   "play_count": 1398 },
    { "id": 105, "name": "jw 999",      "description": "Juice WRLD 999 era (May 2017-May 2018)",     "time_frame": "(May 2017-May 2018)",        "play_count": 1389 },
    { "id": 108, "name": "GB&GR",       "description": "Goodbye & Good Riddance era",                "time_frame": "(December 2017-May 2018)",   "play_count": 15485 },
    { "id": 109, "name": "WOD",         "description": "WRLD On Drugs era",                          "time_frame": "(August 2018-December 2018)", "play_count": 11228 },
    { "id": 110, "name": "DRFL",        "description": "Death Race For Love era",                    "time_frame": "(May 2018-March 2019)",      "play_count": 11040 },
    { "id": 111, "name": "OUT",         "description": "Outsiders era",                              "time_frame": "(March 2019-December 2019)", "play_count": 13729 },
    { "id": 112, "name": "POST",        "description": "Posthumous era",                             "time_frame": "(December 2019-Present)",    "play_count": 3660 }
    // ... 34 total
  ]
}`}</Pre>
        <p className="text-xs text-text-muted mt-1">
          Pass <Code>name</Code> as the <Code>era</Code> filter param on /songs/, e.g. <Code>era=GB%26GR</Code>.
        </p>
        <p className="text-xs text-text-muted mt-1">
          <Code>{'GET /eras/{id}/'}</Code> returns a single era object with the same fields.
        </p>
      </Section>

      <Section title="Artists">
        <p className="text-sm text-text-secondary">A separate, lighter object from <Code>credited_artists</Code> on the song shape: a proper Artist record with an id and bio.</p>
        <MethodPath method="GET" path={`/artists/`} className="mt-2" />
        <p className="text-xs text-text-muted mb-2">Returns a plain array of Artist objects, no pagination envelope.</p>
        <Pre>{`[
  { "id": 1, "name": "Juice WRLD", "bio": "..." }
]`}</Pre>
        <MethodPath method="GET" path={`/artists/{id}/`} className="mt-3" />
        <p className="text-xs text-text-muted">Single Artist object by <Code>id</Code>.</p>
      </Section>

      <Section title="Albums">
        <p className="text-sm text-text-secondary">Album metadata, distinct from the <Code>album</Code> string on the song shape. Each album links back to its Artist.</p>
        <MethodPath method="GET" path={`/albums/`} className="mt-2" />
        <p className="text-xs text-text-muted mb-2">Paginated: standard DRF <Code>{'{count, next, previous, results}'}</Code> envelope, not a bare array.</p>
        <Pre>{`{
  "count": 18,
  "next": null,
  "previous": null,
  "results": [
    {
      "id": 1,
      "title": "Goodbye & Good Riddance",
      "type": "album",
      "artist": { "id": 1, "name": "Juice WRLD", "bio": "..." },
      "release_date": "2018-05-23",
      "description": "...",
      "cover_url": "",
      "play_count": 0
    }
  ]
}`}</Pre>
        <p className="text-xs text-text-muted">
          <Code>artist_id</Code> can also show up on write payloads; the read shape nests the full <Code>artist</Code> object instead.
        </p>
        <p className="text-xs text-text-muted">
          <Code>cover_url</Code>: string, cover art for the album. Empty string when unset (not null).
        </p>
        <MethodPath method="GET" path={`/albums/{id}/`} className="mt-3" />
        <p className="text-xs text-text-muted">Single Album object by <Code>id</Code>.</p>
      </Section>

      <Section title="GET /stats/">
        <Pre>{`{
  "total_songs": 2452,
  "category_stats": {
    "released":          320,
    "unreleased":        1462,
    "unsurfaced":        269,
    "recording_session": 401
  },
  "era_stats": {
    "GB&GR":       574,
    "OUT":         312,
    "POST":        369,
    "WOD":         488,
    "DRFL":        326,
    "Mainstream":  63,
    "jute":        37
    // ... one key per era
  }
}`}</Pre>
        <p className="text-xs text-text-muted">Era keys in <Code>era_stats</Code> match the <Code>name</Code> field from <Code>/eras/</Code>.</p>
      </Section>

      <Section title="GET /radio/random/">
        <p className="text-sm text-text-secondary">Returns a random playable song with full metadata and stream path.</p>
        <Pre>{`{
  "id": "Compilation/1. Released Discography/.../song.mp3",
  "title": "Song Title",
  "path": "Compilation/1. Released Discography/.../song.mp3",
  "size": 5195736,
  "modified": "2025-10-18T19:19:53.784271",
  "hash": "d199a85e510b32b9ef3c02a29044a41d",
  "song": { /* Full song object */ }
}`}</Pre>
      </Section>
    </div>
  )
}

function FilesTab() {
  const { Code, Section, MethodPath } = usePrimitives()
  return (
    <div className="space-y-6">
      <Section title="Comp Channels">
        <p className="text-sm text-text-secondary leading-relaxed">
          The file tree can be split into multiple <span className="font-semibold text-text-primary">comp
          channels</span> (<Code>comp</Code>, <Code>comp_alrdywrld</Code>, …), each its own root on disk, with its
          own staging/archive folders and its own edit-proposal and comp-file-proposal queues. Editor/contributor/manager
          access is a <span className="font-semibold text-text-primary">per-channel membership</span>, not just the
          old global profile flags (see Roles above). These are a completely separate system from News channels
          (News tab): different slugs, different roles, different storage. <Code>?channel=</Code> means something
          different depending which endpoint it&apos;s on.
        </p>
        <p className="text-xs text-text-muted mt-2">
          Every endpoint on this tab accepts an optional <Code>channel</Code> param (query string on GET, JSON/form
          field on POST). Omit it, or pass an unrecognized slug, and the API falls back to the primary channel.
          Paths are always relative to that one channel&apos;s root, never across trees.
        </p>
        <MethodPath method="GET" path={`/files/channels/`} className="mt-3" />
        <p className="text-xs text-text-muted mb-2">Public, no auth. Active channels only.</p>
        <Pre>{`{
  "channels": [
    { "slug": "compilation", "name": "Compilation", "description": "", "is_primary": true }
  ]
}`}</Pre>
        <p className="text-xs text-text-muted">
          For the full list including inactive channels (plus <Code>id</Code>, <Code>is_active</Code>,{' '}
          <Code>sort_order</Code>), see <Code>GET /accounts/admin/channels/</Code> under Admin: Channels
          (Accounts tab), admin-only.
        </p>
      </Section>

      <Section title="Directory Listing (GET /files/browse/)">
        <Table
          headers={['Param', 'Required', 'Description']}
          rows={[
            [<Code>path</Code>, 'No', 'Directory path relative to compilation root'],
            [<Code>search</Code>, 'No', 'Filter items by name (e.g. ".mp3")'],
            [<Code>channel</Code>, 'No', 'Comp channel slug. Defaults to the primary channel'],
          ]}
        />
      </Section>

      <Section title="Flat File List (GET /files/list-all/)" defaultOpen={false}>
        <Table
          headers={['Param', 'Required', 'Description']}
          rows={[
            [<Code>channel</Code>, 'No', 'Comp channel slug. Defaults to the primary channel'],
          ]}
        />
      </Section>

      <Section title="Thumbnail Image (GET /files/thumbnail/)" defaultOpen={false}>
        <Table
          headers={['Param', 'Required', 'Description']}
          rows={[
            [<Code>path</Code>, 'Yes', 'File path relative to compilation root'],
            [<Code>channel</Code>, 'No', 'Comp channel slug. Defaults to the primary channel'],
          ]}
        />
      </Section>

      <Section title="File Metadata (GET /files/info/)">
        <Table
          headers={['Param', 'Required', 'Description']}
          rows={[
            [<Code>path</Code>, 'Yes', 'File path relative to compilation root'],
            [<Code>channel</Code>, 'No', 'Comp channel slug. Defaults to the primary channel'],
          ]}
        />
      </Section>

      <Section title="Cover Art Image (GET /files/cover-art/)">
        <Table
          headers={['Param', 'Required', 'Description']}
          rows={[
            [<Code>path</Code>, 'Yes', 'Audio file path relative to compilation root'],
            [<Code>small</Code>, 'No', <>&quot;true&quot; returns a degraded ~128px JPEG instead of the full-size embedded art</>],
            [<Code>size</Code>, 'No', 'Target size in px, e.g. size=400 returns a 400×400 JPEG. Overrides small when both are passed'],
            [<Code>channel</Code>, 'No', 'Comp channel slug. Defaults to the primary channel'],
          ]}
        />
        <p className="text-xs text-text-muted">
          The original is often a 600×600 PNG around 1&nbsp;MB. <Code>small=true</Code> serves the same image
          downscaled to a few KB. Use it for anything drawn at thumbnail size, and as a fast first paint
          before the full-size one loads.
        </p>
        <p className="text-xs text-text-muted">
          <Code>size</Code> gives finer control than <Code>small</Code>: pass an exact target px (e.g.{' '}
          <Code>size=400</Code>) and the embedded art is downscaled to that square instead of the fixed ~128px{' '}
          <Code>small</Code> gives you.
        </p>
        <Pre>{`GET /files/cover-art/?path=Compilation/…/Lucid Dreams.mp3&small=true
GET /files/cover-art/?path=Compilation/…/Lucid Dreams.mp3&size=400`}</Pre>
        <p className="text-xs text-text-muted mt-1">
          <Code>{'GET /files/art/'}</Code> is an alias for this same endpoint, same params, same response.
        </p>
      </Section>

      <Section title="Resized Image Thumbnail (GET /files/image-thumbnail/)" defaultOpen={false}>
        <Table
          headers={['Param', 'Required', 'Description']}
          rows={[
            [<Code>path</Code>, 'Yes', 'Image file path relative to compilation root'],
            [<Code>size</Code>, 'No', 'Target size in px, 32-1024 (default 256)'],
            [<Code>channel</Code>, 'No', 'Comp channel slug. Defaults to the primary channel'],
          ]}
        />
        <p className="text-xs text-text-muted">Returns a resized JPEG. An SVG source passes through unresized.</p>
      </Section>

      <Section title="Audio Stream (GET /files/download/)">
        <p className="text-sm text-text-secondary">
          The primary audio streaming endpoint. Supports HTTP Range requests; the browser{' '}
          <Code>{'<audio>'}</Code> element handles seeking automatically when you set <Code>src</Code>.
        </p>
        <Table
          headers={['Param', 'Required', 'Description']}
          rows={[
            [<Code>path</Code>, 'Yes', 'File path relative to compilation root'],
            [<Code>small</Code>, 'No', <>&quot;true&quot; for an image path returns a degraded/downscaled version instead of the original</>],
            [<Code>channel</Code>, 'No', 'Comp channel slug. Defaults to the primary channel'],
          ]}
        />
        <p className="text-xs text-text-muted">
          <Code>small=true</Code> only makes sense when <Code>path</Code> points at an image (e.g. a cover art
          file). Pass it to shrink a large cover for a thumbnail without fetching the full-size original.
          For audio, it has no effect.
        </p>
        <Pre>{`GET /files/download/?path=Compilation/cover.jpg&small=true`}</Pre>
        <p className="text-xs text-text-muted font-semibold mt-3">Simple playback:</p>
        <Pre>{`<audio
  controls
  src={\`https://juicewrldapi.com/juicewrld/files/download/?path=\${encodeURIComponent(song.path)}\`}
/>`}</Pre>
        <p className="text-xs text-text-muted font-semibold mt-3">Manual Range request (for custom seeking):</p>
        <Pre>{`fetch(
  \`https://juicewrldapi.com/juicewrld/files/download/?path=\${encodeURIComponent(path)}\`,
  { headers: { Range: 'bytes=0-1048575' } }
)
// Returns 206 Partial Content with Content-Range header`}</Pre>
        <p className="text-xs text-text-muted mt-2">Responses: <Code>200 OK</Code> full file · <Code>206 Partial Content</Code> range</p>
      </Section>

      <Section title="Compressed Audio (GET /files/download-compressed/)" defaultOpen={false}>
        <p className="text-sm text-text-secondary">On-the-fly transcode to a lower bitrate MP3, for bandwidth-constrained playback.</p>
        <Table
          headers={['Param', 'Required', 'Description']}
          rows={[
            [<Code>path</Code>, 'Yes', 'File path relative to compilation root'],
            [<Code>bitrate</Code>, 'No', 'Target bitrate, e.g. "160k" (default)'],
            [<Code>channel</Code>, 'No', 'Comp channel slug. Defaults to the primary channel'],
          ]}
        />
        <p className="text-xs text-text-muted">Response is always served as an attachment, not inline.</p>
      </Section>

      <Section title="ZIP Operations">
        <div className="space-y-3">
          <div>
            <MethodPath method="POST" path={`/start-zip-job/`} />
            <p className="text-xs text-text-muted">Start a background ZIP job. Returns a <Code>job_id</Code> for polling.</p>
            <Pre>{`{ "paths": ["Compilation/song1.mp3", "Compilation/song2.mp3"], "channel": "sessions-comp" }`}</Pre>
            <p className="text-xs text-text-muted"><Code>channel</Code> is optional; omit it for the primary channel.</p>
          </div>
          <div>
            <MethodPath method="GET" path={`/zip-job-status/{'{job_id}'}/ `} />
            <p className="text-xs text-text-muted">
              Poll ZIP job progress. Once <Code>status</Code> is <Code>"done"</Code>, the response carries a{' '}
              <Code>download_url</Code> pointing at <Code>{'GET /zip-jobs/{filename}'}</Code>, which streams the
              finished archive (supports Range) and deletes it from disk once fully downloaded.
            </p>
          </div>
          <div>
            <MethodPath method="POST" path={`/cancel-zip-job/{'{job_id}'}/ `} />
            <p className="text-xs text-text-muted">Cancel an in-progress ZIP job.</p>
          </div>
          <div>
            <MethodPath method="POST" path={`/files/zip-selection/`} />
            <p className="text-xs text-text-muted">
              Immediate ZIP stream, not background: POST a list of relative paths, get a streaming zip of those
              files/folders from that channel&apos;s tree back directly (no <Code>job_id</Code> polling).
            </p>
            <Pre>{`{ "paths": ["Compilation/Folder"], "channel": "sessions-comp" }`}</Pre>
            <p className="text-xs text-text-muted"><Code>channel</Code> is optional; omit it for the primary channel.</p>
          </div>
        </div>
      </Section>
    </div>
  )
}

function PlaylistsTab() {
  const { Code, Section, MethodPath } = usePrimitives()
  return (
    <div className="space-y-6">
      <Section title="Shared Playlists (no auth required)">
        <p className="text-sm text-text-secondary">
          Public, anonymous-link playlists. Anyone with the share ID can read them.
        </p>
        <div className="space-y-3">
          <div>
            <MethodPath method="POST" path={`/playlists/share/`} />
            <Pre>{`// Request
{ "paths": ["Compilation/song1.mp3", "Compilation/song2.mp3"] }

// Response
{ "share_id": "abc123..." }`}</Pre>
          </div>
          <div>
            <MethodPath method="GET" path={`/playlists/shared/{'{share_id}'}/ `} />
            <p className="text-xs text-text-muted">Full shared playlist with all track metadata.</p>
          </div>
          <div>
            <MethodPath method="GET" path={`/playlists/shared/{'{share_id}'}/info/`} />
            <p className="text-xs text-text-muted">Lightweight preview: name and track count, no full fetch.</p>
          </div>
        </div>
      </Section>

      <Section title="Personal Library Playlists (auth required)">
        <p className="text-sm text-text-secondary">
          Private, account-synced playlists. Any logged-in user, including standard accounts, can use these; no editor role required.
        </p>
        <Table
          headers={['Method', 'Path', 'Description']}
          rows={[
            ['GET', '/library/playlists/', 'List all playlists for logged-in user (supports ?omit_cover_image=true)'],
            ['POST', '/library/playlists/', 'Create a playlist'],
            ['GET', '/library/playlists/{id}/', 'Get playlist with full track list'],
            ['PATCH', '/library/playlists/{id}/', 'Update name, description, cover, visibility, or reorder tracks'],
            ['DELETE', '/library/playlists/{id}/', 'Delete a playlist'],
            ['POST', '/library/playlists/{id}/items/', 'Add a track'],
            ['DELETE', '/library/playlists/{id}/items/{song_id}/', 'Remove a track'],
          ]}
        />
        <p className="text-xs text-text-muted mt-2">
          <Code>?omit_cover_image=true</Code> drops the (large, base64) <Code>cover_image</Code> field from the response. Use it for
          list views that only need <Code>cover_image_url</Code>.
        </p>
        <p className="text-xs text-text-muted font-semibold mt-3">Create:</p>
        <Pre>{`POST /library/playlists/
Authorization: Token <token>

{
  "name": "My Playlist",
  "description": "optional",
  "cover_image": undefined  // optional base64 string
}`}</Pre>
        <p className="text-xs text-text-muted font-semibold mt-3">Update (all fields optional, including track reorder):</p>
        <Pre>{`PATCH /library/playlists/{id}/

{
  "name": "New name",
  "description": "New description",
  "cover_image": "",         // base64, or "" to clear
  "is_public": true,         // toggle public sharing (see below)
  "order": [123, 456, 789]  // song IDs in desired order
}`}</Pre>
        <p className="text-xs text-text-muted font-semibold mt-3">List response, each item:</p>
        <Pre>{`{
  "id": 1,
  "name": "My Playlist",
  "description": "optional",
  "cover_image": "...",
  "cover_image_url": "...",  // fallback to first track image_url
  "track_count": 12,
  "is_public": false,
  "created_at": "...",
  "updated_at": "..."
}`}</Pre>
        <p className="text-xs text-text-muted font-semibold mt-3">Detail response, same fields plus <Code>items[]</Code>:</p>
        <Pre>{`{
  "id": 1,
  "name": "My Playlist",
  "is_public": false,
  "items": [
    {
      "id": 501,
      "position": 0,
      "added_at": "...",
      "song": {
        "id": 123, "public_id": 163, "name": "Maze",
        "path": "Compilation/.../Maze.mp3",
        "length": "2:24", "credited_artists": "Juice WRLD",
        "category": "released", "album": "...",
        "image_url": "/assets/drfl.png",
        "era": { /* era object */ },
        "lyrics": "...", "synced_lyrics": "..."
      }
    }
  ]
}`}</Pre>
        <p className="text-xs text-text-muted mt-2">The song object in playlist items is a trimmed shape, with no <Code>producers</Code>, <Code>engineers</Code>, or <Code>bitrate</Code>.</p>
      </Section>

      <Section title="Public Library Playlists (no auth required)">
        <p className="text-sm text-text-secondary">
          A personal library playlist with <Code>is_public: true</Code> can be fetched anonymously by its numeric{' '}
          <Code>id</Code>, distinct from the ephemeral, no-account "Shared Playlists" above. Toggle visibility via{' '}
          <Code>{'PATCH /library/playlists/{id}/'}</Code> with <Code>{'{ "is_public": true }'}</Code>.
        </p>
        <Table
          headers={['Method', 'Path', 'Description']}
          rows={[
            ['GET', '/library/playlists/public/{id}/', 'Full playlist detail (same shape as the authed detail response)'],
          ]}
        />
        <p className="text-xs text-text-muted mt-2">Making a playlist public does not change its owner or contents; it only exposes this read-only endpoint.</p>
      </Section>

      <Section title="Favorites (auth required)">
        <Table
          headers={['Method', 'Path', 'Description']}
          rows={[
            ['GET', '/library/favorites/', 'List favorite tracks'],
            ['POST', '/library/favorites/', 'Add a favorite, body: { song_id }'],
            ['DELETE', '/library/favorites/{song_id}/', 'Remove a favorite'],
          ]}
        />
      </Section>
    </div>
  )
}

function AccountsTab() {
  const { Code, Section, MethodPath } = usePrimitives()
  return (
    <div className="space-y-6">
      <Section title="Roles">
        <Table
          headers={['Role', 'role string', 'is_editor', 'is_administrator', 'is_contributor', 'is_manager']}
          rows={[
            ['Standard', <Code>applicant</Code>, '-', '-', '-', '-'],
            ['Editor', <Code>editor</Code>, '✓', '-', '-', '-'],
            ['Contributor', <Code>contributor</Code>, '-', '-', '✓', '-'],
            ['Manager', <Code>manager</Code>, '-', '-', '-', '✓'],
            ['Admin', <Code>administrator</Code>, '✓', '✓', '-', '-'],
          ]}
        />
        <p className="text-xs text-text-muted mt-2">
          New Discord users start as <Code>applicant</Code>. Editors are promoted after application approval. Admins are assigned manually.
          Admins always have <Code>is_editor: true</Code>.
        </p>
        <p className="text-xs text-text-muted mt-2">
          <Code>contributor</Code> is a separate track from editor: it grants access to the comp-file proposal
          pipeline below (uploading/replacing/moving/deleting files in the compilation), not to song-data edit
          proposals. <Code>manager</Code> is likewise independent, a flag (<Code>manager_enabled</Code> on{' '}
          <Code>/admin/users/</Code>, <Code>is_manager</Code> on the account payload) that grants the proposal/comp-proposal
          review queues without full admin access (no user management, no security settings). A user can hold any
          combination of editor/contributor/manager. All three are optional/undefined on older account payloads,
          read them defensively.
        </p>
        <p className="text-xs text-text-muted mt-2">
          <Code>is_news</Code> is a fourth, similarly independent flag: it grants News write access (create posts,
          edit/delete your own) without needing <Code>is_editor</Code>. Admins get News write access regardless of{' '}
          <Code>is_news</Code>. See the News tab.
        </p>
        <p className="text-xs text-text-muted mt-2">
          On a deployment with multiple comp channels (see Comp Channels, Files &amp; Stream tab), these role
          booleans are the <span className="font-semibold text-text-primary">global</span> grant. A user can
          additionally hold editor/contributor/manager <span className="font-semibold text-text-primary">per
          comp channel</span> via <Code>account.memberships</Code>, an array of{' '}
          <Code>{'{ channel_slug, channel_name, is_primary, is_editor, is_contributor, is_manager, auto_approve_proposals, auto_approve_comp_proposals }'}</Code>{' '}
          rows, one per channel the user has any flag set on. Admins implicitly get every active channel with every
          flag on. Treat a missing global flag as "check memberships for this channel" rather than "denied." This
          is a completely separate system from News channels below: different slugs, different roles, different
          storage.
        </p>
        <p className="text-xs text-text-muted font-semibold mt-3">Attach token to every authenticated request:</p>
        <Pre>{`Authorization: Token YOUR_TOKEN_HERE`}</Pre>
      </Section>


      <Section title="Permission Matrix">
        <Table
          headers={['Access Level', 'Endpoints']}
          rows={[
            ['No login', 'Songs, eras, categories, files, radio, stats, shared playlists, play tracking, feedback submission, report submission, /auth/register/, /auth/login/, public user profiles'],
            ['Any logged-in user', '/account/me/ (incl. PATCH), /application/, /library/*, GET /feedback/'],
            ['Editor or admin', '/me/, /editor/proposals/, /editor/leaderboard/, /badges/, /reports/ (read + review)'],
            ['Contributor', '/contributor/proposals/ (comp-file proposals, read/write your own)'],
            ['Manager or admin', '/admin/proposals/, /admin/comp-proposals/ (review queues only, not /admin/users/ or /admin/applications/)'],
            ['Admin only', '/admin/users/, /admin/applications/, /admin/comp-files/, /admin/channels/'],
            ['is_news or admin, gated on author for edit/delete', '/news/ (is_news or admin can create; is_news holders can only edit/delete their own posts, admins any)'],
            ['Beta code (X-Beta-Code)', '/beta/versions, /beta/download (independent of the token/role system)'],
          ]}
        />
        <p className="text-xs text-text-muted mt-2">
          A 403 response means insufficient role; message text is typically{' '}
          <Code>"Editor access required."</Code> or <Code>"Administrator access required."</Code>.
        </p>
      </Section>


      <Section title="Discord Login (recommended)">
        <ol className="space-y-3 text-sm text-text-secondary list-decimal list-inside">
          <li><code className="text-accent font-mono text-xs">GET /accounts/auth/discord/url/</code> → returns <Code>authorize_url</Code> and <Code>state</Code></li>
          <li>Redirect the user through Discord OAuth using <Code>authorize_url</Code></li>
          <li>Exchange the code Discord returns:</li>
        </ol>
        <Pre>{`POST /accounts/auth/discord/exchange/

{
  "code": "discord_auth_code",
  "state": "state_from_step_1",
  "redirect_uri": "https://your-app.com/callback"
}

// Response includes token + user object`}</Pre>
        <p className="text-xs text-text-muted">Store the token and attach it as <Code>Authorization: Token &lt;token&gt;</Code> on subsequent requests.</p>
        <p className="text-xs text-text-muted mt-2">
          <Code>GET /accounts/discord/login/</Code> and <Code>POST /accounts/discord/callback/</Code> are an
          older, fixed-redirect variant of the same flow, no <Code>redirect_uri</Code> param on the URL step,
          same response shapes otherwise. Prefer the two-step flow above for a new integration.
        </p>
      </Section>

      <Section title="Username + Password Auth (Public Signup)">
        <p className="text-sm text-text-secondary">
          A second login path for public app users, parallel to Discord OAuth above — not the same as{' '}
          <Code>/accounts/login/</Code> below, which is staff-only with OTP. Returns the same{' '}
          <Code>{'{ token, user }'}</Code> shape as Discord login, so the two are interchangeable once you have a
          token. Throttled under the <Code>auth</Code> scope.
        </p>
        <div className="space-y-4 mt-3">
          <div>
            <MethodPath method="POST" path={`/accounts/auth/register/`} />
            <p className="text-xs text-text-muted mb-2">No auth required.</p>
            <Pre>{`{
  "username": "myuser",
  "password": "secure-password",
  "display_name": "Optional Display Name"
}`}</Pre>
            <Table
              headers={['Field', 'Required', 'Rules']}
              rows={[
                [<Code>username</Code>, 'yes', '3–30 chars, case-insensitive unique, cannot start with "discord_"'],
                [<Code>password</Code>, 'yes', 'Django password validators'],
                [<Code>display_name</Code>, 'no', 'Max 120 chars; defaults to username if omitted'],
              ]}
            />
            <p className="text-xs text-text-muted font-semibold mt-2">201:</p>
            <Pre>{`{ "token": "abc123...", "user": { /* same shape as GET /accounts/account/me/ */ } }`}</Pre>
            <p className="text-xs text-text-muted font-semibold mt-2">400 (field-level):</p>
            <Pre>{`{
  "username": ["That username is already taken."],
  "password": ["This password is too common."]
}`}</Pre>
          </div>
          <div>
            <MethodPath method="POST" path={`/accounts/auth/login/`} />
            <p className="text-xs text-text-muted mb-2">No auth required.</p>
            <Pre>{`{ "username": "myuser", "password": "secure-password" }`}</Pre>
            <p className="text-xs text-text-muted font-semibold mt-2">200:</p>
            <Pre>{`{ "token": "abc123...", "user": { /* same shape as GET /accounts/account/me/ */ } }`}</Pre>
            <p className="text-xs text-text-muted font-semibold mt-2">400:</p>
            <Pre>{`{ "non_field_errors": ["Invalid username or password."] }`}</Pre>
            <p className="text-xs text-text-muted">Disabled accounts return <Code>"Account is disabled."</Code> instead.</p>
          </div>
        </div>
      </Section>

      <Section title="Access Code Login">
        <p className="text-sm text-text-secondary">
          A simple shared-password gate, unrelated to Discord OAuth or the token/role system. Used to lock an
          otherwise-public deployment behind one access code.
        </p>
        <Pre>{`POST /juicewrld/auth/login/

{ "password": "required" }`}</Pre>
        <p className="text-xs text-text-muted font-semibold mt-2">200:</p>
        <Pre>{`{ "success": true, "message": "Authentication successful" }`}</Pre>
        <p className="text-xs text-text-muted font-semibold mt-2">401:</p>
        <Pre>{`{ "success": false, "message": "Invalid access code" }`}</Pre>
      </Section>

      <Section title="Admin Login">
        <p className="text-sm text-text-secondary">Username/password, administrators only. Not needed for a public music player.</p>
        <Pre>{`POST /accounts/login/

{
  "token": "abc123...",
  "profile": { "role": "administrator", "is_editor": true, "is_administrator": true },
  "requires_otp_setup": false
}`}</Pre>
      </Section>


      <Section title="Logout">
        <Pre>{`POST /accounts/logout/
Authorization: Token <token>`}</Pre>
        <p className="text-xs text-text-muted">Invalidates the token server-side. Clear the locally stored token regardless of whether this call succeeds.</p>
      </Section>


      <Section title="Who Am I: Two Endpoints">
        <div className="space-y-4">
          <div>
            <MethodPath method="GET" path={`/accounts/account/me/`} />
            <p className="text-xs text-text-muted mb-2">Public-facing. No <Code>role</Code> string, booleans only. Use this for music player UI gating.</p>
            <Pre>{`{
  "id": 42,
  "display_name": "someuser",
  "discord_id": "123456789",
  "discord_username": "someuser",
  "discord_avatar": "https://cdn.discordapp.com/avatars/...",
  "avatar": "data:image/jpeg;base64,...",   // custom upload, falls back to discord_avatar, else ""
  "bio": "I love Juice WRLD",               // max 500 chars
  "public_play_history": false,             // opt-in, default false
  "public_playlists": false,                // opt-in, default false
  "is_editor": false,
  "is_administrator": false,
  "is_contributor": false,
  "is_manager": false,
  "is_news": false,
  "otp_enabled": false,
  "user_preferences": [
    { "song": 94086, "name": "My title", "cover_url": "/assets/wod.jpg", "default_version": "v1", "playcount": 12 }
  ],
  "playlist_folders": [
    { "id": "f1", "name": "Favorites", "playlist_ids": [12, 34] }
  ],
  "listening_plays": [
    { "song": 94086, "played_at": "2026-08-03T20:14:00Z" }
  ],
  "news_subscriptions": ["announcements"],   // news-channel slugs the user follows, max 50
  "memberships": [
    { "channel_slug": "alrdywrld", "channel_name": "alrdywrld", "is_primary": false, "is_editor": true, "is_contributor": true, "is_manager": false, "auto_approve_proposals": false, "auto_approve_comp_proposals": false }
  ]
}`}</Pre>
            <p className="text-xs text-text-muted mt-2">
              Also mounted at <Code>/juicewrld/accounts/account/me/</Code> (same handler, different prefix).
            </p>
            <p className="text-xs text-text-muted mt-2">
              <Code>listening_plays</Code>, <Code>is_manager</Code>, <Code>is_news</Code>, <Code>news_subscriptions</Code>,
              and <Code>memberships</Code> aren&apos;t guaranteed present on every account payload yet. Read them
              defensively (optional/undefined, not required). <Code>memberships</Code> only lists channels the
              user has at least one flag set on; see Roles above for how per-channel access composes with the
              global booleans. <Code>news_subscriptions</Code> is capped at 50 entries.
            </p>
            <p className="text-xs text-text-muted mt-2">
              <Code>avatar</Code>, <Code>bio</Code>, <Code>public_play_history</Code>, and{' '}
              <Code>public_playlists</Code> are newer fields, same defensive-read rule. Use <Code>avatar</Code> for
              display everywhere on this payload — it&apos;s already resolved (custom upload preferred,{' '}
              <Code>discord_avatar</Code> as fallback, empty string otherwise). See Custom Avatar and Public User
              Profile below.
            </p>
          </div>
          <div>
            <MethodPath method="PATCH" path={`/accounts/account/me/`} />
            <p className="text-xs text-text-muted mb-2">
              Updates the logged-in user&apos;s own <Code>display_name</Code>, <Code>user_preferences</Code>,{' '}
              <Code>playlist_folders</Code>, <Code>listening_plays</Code>, <Code>avatar</Code>, <Code>bio</Code>,{' '}
              <Code>public_play_history</Code>, and/or <Code>public_playlists</Code>. Partial update — send only
              the fields you&apos;re changing. See the sections below for what goes in each of the blob fields.
            </p>
            <Pre>{`PATCH /accounts/account/me/

{ "display_name": "New Name" }`}</Pre>
            <p className="text-xs text-text-muted">
              Self-service rename, independent of the Discord-derived <Code>discord_username</Code>. Send just{' '}
              <Code>display_name</Code> on its own; it doesn&apos;t require the blob fields to be present.
            </p>
          </div>
          <div>
            <MethodPath method="GET" path={`/accounts/me/`} />
            <p className="text-xs text-text-muted mb-2">Editor/admin dashboards. Includes raw <Code>role</Code> string and extra stats.</p>
            <Pre>{`{
  "username": "discord_123456789",
  "role": "applicant",
  "is_editor": false,
  "is_administrator": false,
  "is_contributor": false,
  "is_superuser": false,
  "otp_enabled": false,
  "discord_id": "123456789",
  "discord_username": "someuser",
  "discord_avatar": "https://cdn.discordapp.com/avatars/...",
  "approved_count": 0,
  "badges": []
}`}</Pre>
            <p className="text-xs text-text-muted mt-2">
              <Code>role</Code> is <Code>&quot;applicant&quot; | &quot;editor&quot; | &quot;contributor&quot; | &quot;administrator&quot;</Code>,
              widened from three values to four with the contributor track. Don&apos;t treat it as a strict
              editor-vs-admin ladder; check the specific boolean (<Code>is_editor</Code>/<Code>is_contributor</Code>/<Code>is_administrator</Code>)
              for the access you actually need.
            </p>
          </div>
        </div>
      </Section>


      <Section title="Custom Avatar">
        <p className="text-sm text-text-secondary">
          Custom avatars are stored on the user profile and returned resolved on the <Code>avatar</Code> field
          (custom upload preferred, Discord avatar as fallback).
        </p>
        <p className="text-xs text-text-muted font-semibold mt-3">Upload / update:</p>
        <Pre>{`PATCH /accounts/account/me/

{ "avatar": "data:image/jpeg;base64,/9j/4AAQ..." }`}</Pre>
        <Table
          headers={['Rule', 'Value']}
          rows={[
            ['Format', <>Must be a <Code>data:image/...</Code> data URI</>],
            ['Max size', '500 KB (UTF-8 encoded string length)'],
          ]}
        />
        <p className="text-xs text-text-muted font-semibold mt-3">Remove custom avatar:</p>
        <Pre>{`PATCH /accounts/account/me/

{ "avatar": "" }`}</Pre>
        <p className="text-xs text-text-muted">
          Clears the custom avatar. The response <Code>avatar</Code> field then falls back to{' '}
          <Code>discord_avatar</Code> for Discord-linked accounts, or empty string otherwise.
        </p>
        <p className="text-xs text-text-muted mt-2">
          Compress/resize before upload (e.g. 256px, ~200KB target). Use the response <Code>avatar</Code> field
          everywhere for display — don&apos;t read <Code>discord_avatar</Code> directly unless you specifically
          need the raw Discord URL (still returned separately for Discord-linked accounts).
        </p>
        <p className="text-xs text-text-muted mt-2">
          The resolved custom avatar also surfaces through the <Code>discord_avatar</Code> field name (unchanged)
          on other endpoints that predate this feature: the Editor leaderboard, Heardle leaderboards/match
          results, and the admin user list/detail. Treat <Code>discord_avatar</Code> on those payloads as the
          resolved display avatar, not necessarily a Discord CDN URL.
        </p>
      </Section>

      <Section title="Public User Profile">
        <p className="text-sm text-text-secondary">
          A limited public view of any active user, including non-editors, for profile pages / sharing.
        </p>
        <MethodPath method="GET" path={`/accounts/profile/{user_id}/`} />
        <p className="text-xs text-text-muted mb-2">No auth required.</p>
        <Pre>{`{
  "id": 42,
  "display_name": "someuser",
  "avatar": "data:image/jpeg;base64,...",
  "bio": "I love Juice WRLD",
  "is_editor": false,
  "is_contributor": false,
  "is_donor": false,
  "donor_since": null,
  "public_play_history": true,
  "public_playlists": true
}`}</Pre>
        <p className="text-xs text-text-muted font-semibold mt-3">Conditionally included (key omitted entirely when disabled, not null):</p>
        <Table
          headers={['Field', 'When included', 'Shape']}
          rows={[
            [<Code>play_history</Code>, <Code>public_play_history === true</Code>, <>Same shape as private <Code>listening_plays</Code>: <Code>{'[{ song, played_at }, ...]'}</Code></>],
            [<Code>playlists</Code>, <Code>public_playlists === true</Code>, "The user's playlists where is_public === true"],
          ]}
        />
        <p className="text-xs text-text-muted font-semibold mt-3">Playlist entry shape (cover art omitted):</p>
        <Pre>{`{
  "id": 7,
  "name": "Bangers",
  "description": "",
  "is_public": true,
  "track_count": 24,
  "cover_image_url": "https://...",
  "created_at": "2026-01-01T00:00:00Z",
  "updated_at": "2026-03-01T00:00:00Z"
}`}</Pre>
        <p className="text-xs text-text-muted">
          Base64 <Code>cover_image</Code> is omitted here. Use <Code>cover_image_url</Code>, or fetch the full
          playlist via <Code>{'GET /library/playlists/public/{id}/'}</Code>.
        </p>
        <p className="text-xs text-text-muted font-semibold mt-3">404:</p>
        <Pre>{`{ "detail": "Profile not found." }`}</Pre>
        <p className="text-xs text-text-muted">Invalid user id or inactive account.</p>
        <p className="text-xs text-text-muted mt-2">
          <Code>public_play_history</Code> and <Code>public_playlists</Code> default to <Code>false</Code> for
          all users (existing and new) — public profiles won&apos;t include <Code>play_history</Code> or{' '}
          <Code>playlists</Code> until the user opts in via <Code>PATCH /accounts/account/me/</Code>. A playlist
          also needs its own <Code>is_public: true</Code> to appear, even with <Code>public_playlists</Code> on.
        </p>
        <p className="text-xs text-text-muted mt-2">
          <Code>is_donor</Code> / <Code>donor_since</Code> are included here too, same shape as on{' '}
          <Code>GET /accounts/account/me/</Code> — donor status is public on any user's profile, not just your own.
        </p>
      </Section>

      <Section title="Now Playing">
        <p className="text-sm text-text-secondary">
          Opt-in public broadcast of what a user is currently listening to. The client pushes playback state
          while a track is playing; anyone can read it from a dedicated public endpoint, no auth required.
        </p>
        <div className="space-y-4 mt-3">
          <div>
            <MethodPath method="PATCH" path={`/accounts/account/me/`} />
            <p className="text-xs text-text-muted mb-2">
              Toggle visibility and/or push playback state, same pattern as <Code>public_play_history</Code> and{' '}
              <Code>public_playlists</Code>. Partial update — send only the fields you&apos;re changing.
            </p>
            <Pre>{`{ "public_now_playing": true }`}</Pre>
            <Pre>{`{
  "now_playing": {
    "song": 94080,
    "path": "Compilation/2. Unreleased Discography/1. JUICED UP THE EP (Sessions)/Lucid Dreams.mp3",
    "position": 12.5
  }
}`}</Pre>
            <Table
              headers={['Field', 'Required', 'Rules']}
              rows={[
                [<Code>song</Code>, 'yes', 'Positive integer (internal song id, same as tracker / listening_plays.song)'],
                [<Code>path</Code>, 'no', <>String, max 1024 chars; empty string if unknown</>],
                [<Code>position</Code>, 'no', <>Float &gt;= 0; defaults to <Code>0</Code></>],
              ]}
            />
            <p className="text-xs text-text-muted mt-2">
              Clear it by sending <Code>{'{ "now_playing": {} }'}</Code> or <Code>{'{ "now_playing": null }'}</Code> —
              do this on pause/stop/logout or when the user disables the feature.
            </p>
            <p className="text-xs text-text-muted font-semibold mt-2">400:</p>
            <Pre>{`{ "now_playing": ["A valid song id is required."] }`}</Pre>
            <p className="text-xs text-text-muted mt-2">
              The server stamps <Code>updated_at</Code> on every successful PATCH — don&apos;t send it yourself.
              While a track is actively playing, re-PATCH every 15–30s (on seek/track-change too) so the
              5-minute staleness window below stays fresh.
            </p>
          </div>
          <div>
            <MethodPath method="GET" path={`/accounts/profile/{user_id}/np/`} />
            <p className="text-xs text-text-muted mb-2">No auth required.</p>
            <Pre>{`{
  "now_playing": {
    "song": 94080,
    "path": "Compilation/2. Unreleased Discography/1. JUICED UP THE EP (Sessions)/Lucid Dreams.mp3",
    "position": 12.5,
    "updated_at": "2026-09-17T19:00:00.123456+00:00"
  }
}`}</Pre>
            <p className="text-xs text-text-muted font-semibold mt-2">Hidden / stale / empty (always 200, never 404):</p>
            <Pre>{`{ "now_playing": null }`}</Pre>
            <p className="text-xs text-text-muted font-semibold mt-2">Returned null when:</p>
            <ul className="text-xs text-text-muted list-disc pl-4 space-y-0.5">
              <li>User id doesn't exist or account is inactive</li>
              <li><Code>public_now_playing</Code> is false</li>
              <li>No <Code>now_playing</Code> data stored</li>
              <li>Last update was more than 5 minutes ago</li>
            </ul>
          </div>
        </div>
        <p className="text-xs text-text-muted mt-3">
          <Code>public_now_playing</Code> also appears on <Code>{'GET /accounts/profile/{user_id}/'}</Code> (see
          Public User Profile above) so you can show a &quot;listening&quot; indicator without fetching playback
          data on every profile load — the live <Code>now_playing</Code> payload itself is only on the{' '}
          <Code>/np/</Code> endpoint. Defaults to <Code>false</Code> for all users; disabling it makes{' '}
          <Code>/np/</Code> always return <Code>null</Code> even if stale data remains stored.
        </p>
      </Section>

      <Section title="Per-Song Preferences: Custom Titles, Covers, Playcounts">
        <p className="text-sm text-text-secondary leading-relaxed">
          <Code>user_preferences</Code> is a per-user, per-song override list carried on the profile: a personal
          display <span className="font-semibold text-text-primary">name</span>, a personal{' '}
          <span className="font-semibold text-text-primary">cover</span>, a preferred{' '}
          <span className="font-semibold text-text-primary">version</span> to play within the song&apos;s version
          group, and a <span className="font-semibold text-text-primary">playcount</span>. These are personal only:
          they never change the song for anyone else, and editors proposing upstream edits see the API&apos;s own
          untouched values.
        </p>
        <Pre>{`{
  "song": 94086,              // API song id (song.id, not public_id)
  "name": "My title",         // null = use the song's own title
  "cover_url": "Compilation/.../cover.jpg",
  "default_version": "v1",    // null = no preference
  "playcount": 12
}`}</Pre>
        <Table
          headers={['Field', 'Type', 'Meaning']}
          rows={[
            [<Code>song</Code>, 'number', 'Which song this row overrides. The only required field.'],
            [<Code>name</Code>, 'string | null', 'Custom display title. Null falls back to the song\'s own title.'],
            [<Code>cover_url</Code>, 'string | null', 'Custom cover art. Null falls back to the song\'s image_url.'],
            [<Code>default_version</Code>, 'string | null', <>Preferred version <span className="font-semibold text-text-primary">label</span> (e.g. <Code>v1</Code>, <Code>OG</Code>, <Code>TV Mix</Code>), matched against the <Code>version</Code> field in the <Code>/versions/</Code> table rather than a song id, so it survives songs being relinked or groups merging. A default set on any group member governs the whole group.</>],
            [<Code>playcount</Code>, 'number', 'How many times this user played the song. Client-owned; there is no server-side increment endpoint.'],
          ]}
        />
        <p className="text-xs text-text-muted font-semibold mt-3">Resolving <Code>cover_url</Code>:</p>
        <Table
          headers={['Form', 'Example', 'Resolves to']}
          rows={[
            ['Absolute URL', 'https://… / data: / blob:', 'Used as-is'],
            ['Leading slash', '/assets/wod.jpg', <>Site-relative asset. Prepend <Code>https://juicewrldapi.com</Code> (same shape as a song&apos;s <Code>image_url</Code>)</>],
            ['Anything else', 'Compilation/…/cover.jpg', <>A path into file storage. Fetch via <Code>/files/cover-art/?path=</Code></>],
          ]}
        />
        <p className="text-xs text-text-muted font-semibold mt-3">Write semantics, read this before implementing:</p>
        <ul className="space-y-2 text-sm text-text-secondary">
          <li className="flex items-start gap-2"><span className="text-accent mt-0.5">•</span> It&apos;s <span className="font-semibold text-text-primary">one JSON blob, not per-song rows</span>: there is no per-song save and no delete. The client owns the whole array and PATCHes it in full; sending a shorter array is how a row gets removed.</li>
          <li className="flex items-start gap-2"><span className="text-accent mt-0.5">•</span> Debounce the pushes. A burst of edits (or plays) should collapse into one PATCH rather than one per change.</li>
          <li className="flex items-start gap-2"><span className="text-accent mt-0.5">•</span> On login, merge the server&apos;s copy into the local one taking <Code>max()</Code> of each <Code>playcount</Code>; otherwise plays made while signed out or on another device get overwritten.</li>
          <li className="flex items-start gap-2"><span className="text-accent mt-0.5">•</span> The validator caps the array at <span className="font-semibold text-text-primary">500 rows</span>. Past that, drop playcount-only rows first. Rows carrying a real override (name/cover/version) are the ones worth keeping, since every song played creates a playcount row.</li>
          <li className="flex items-start gap-2"><span className="text-accent mt-0.5">•</span> Normalize cleared text fields to <Code>null</Code>, not <Code>""</Code>: an empty string reads as a real override downstream.</li>
        </ul>
      </Section>


      <Section title="User Settings">
        <p className="text-sm text-text-secondary leading-relaxed">
          <Code>user_settings</Code> is a free-form JSON object carried on the profile for account-level settings
          that should follow the user across devices - appearance, navigation layout, playback/EQ preferences,
          hotkeys, and chat mutes. Unlike <Code>user_preferences</Code>, this isn&apos;t per-song, and unlike{' '}
          <Code>playlist_folders</Code> it&apos;s not an array - it&apos;s a single object, PATCHed whole (same rule:
          sending a partial object overwrites the rest of the blob, so merge client-side first, same as{' '}
          <Code>muted_user_ids</Code> below).
        </p>
        <Pre>{`{
  "muted_user_ids": [412, 88],
  "theme": "dark",

  "custom_skins": [ /* Skin objects - see the in-app skin editor */ ],
  "accent_color": "#1db954",
  "app_text_scale": 1,
  "app_font": "system",
  "lyrics_font": "system",
  "lyrics_scale": 1,
  "lyrics_align": "left",
  "lyrics_blur": true,
  "lyrics_blur_amount": 1,
  "lyrics_color_active": null,
  "lyrics_color_inactive": null,
  "lyrics_override": false,
  "full_era_names": false,
  "gradients_enabled": true,
  "surface_gradients_enabled": false,
  "wrld_theme_background": false,
  "playlist_hero_enabled_dark": true,
  "playlist_hero_enabled_light": false,
  "sidebar_position": "left",

  "nav_order": ["home", "wrld", "..."],
  "nav_visibility": { "wrld": true },
  "nav_control_order": ["queue", "..."],
  "nav_control_visibility": { "queue": true },
  "home_section_visibility": { "recentlyPlayed": true },

  "playback_speed": 1,
  "crossfade_enabled": false,
  "crossfade_duration": 5,
  "pause_fade_enabled": false,
  "prefer_og_version": false,
  "rotate_suggested_covers": false,
  "media_overlay_enabled": true,
  "lastfm_enabled": true,
  "auto_report_errors": true,
  "eq_enabled": false,
  "eq_gains": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "eq_preset": "flat",
  "eq_balance": 0,
  "eq_mono": false,
  "eq_boost": 1,
  "skip_silence": false,
  "reverb_enabled": false,
  "reverb_mix": 0.4,
  "reverb_decay": 3,
  "pitch_shift": false,

  "hotkey_bindings": { "playPause": "Space" },
  "hotkey_seek_seconds": 10,
  "global_hotkeys_enabled": false,

  "muted_servers": [3],
  "muted_conversations": [17]
}`}</Pre>
        <Table
          headers={['Field', 'Type', 'Meaning']}
          rows={[
            [<Code>muted_user_ids</Code>, 'number[]', 'Account ids whose channel/server messages this user has hidden. Doesn\'t affect DMs.'],
            [<Code>theme</Code>, 'string', 'Active skin/theme id.'],
            [<Code>custom_skins</Code>, 'object[]', 'User-created skins from the in-app skin editor.'],
            [<><Code>muted_servers</Code> / <Code>muted_conversations</Code></>, 'number[]', 'Chat server/conversation ids with notifications muted - distinct from muted_user_ids, which hides message content.'],
            ['everything else', 'varies', 'Appearance, navigation layout, playback/EQ, and hotkey preferences - one field per Settings page toggle, named to match.'],
          ]}
        />
        <p className="text-xs text-text-muted mt-2">
          Every field is optional. On login, the client merges the server&apos;s copy into local state (muted lists
          union, everything else adopts the server&apos;s value if present) and pushes the merged whole object back.
        </p>
      </Section>

      <Section title="Playlist Folders">
        <p className="text-sm text-text-secondary">
          <Code>playlist_folders</Code> groups the user&apos;s playlists into folders. Same blob mechanics as{' '}
          <Code>user_preferences</Code> above: whole-array PATCH on <Code>/accounts/account/me/</Code>, no per-folder route.
        </p>
        <Pre>{`{
  "id": "f1",
  "name": "Favorites",
  "playlist_ids": [12, 34]
}`}</Pre>
        <Table
          headers={['Field', 'Type', 'Meaning']}
          rows={[
            [<Code>id</Code>, 'string', 'Client-generated folder id, round-trips unchanged'],
            [<Code>name</Code>, 'string', 'Folder display name'],
            [<Code>playlist_ids</Code>, 'number[]', 'Library playlist IDs in this folder'],
          ]}
        />
        <p className="text-xs text-text-muted">Limits: max 200 folders, max 500 playlist ids per folder.</p>
      </Section>


      <Section title="Listening History">
        <p className="text-sm text-text-secondary">
          <Code>listening_plays</Code> is a raw per-play log, one entry per listen, distinct from{' '}
          <Code>user_preferences[].playcount</Code> which is just a running total per song. Same blob mechanics:
          whole-array PATCH on <Code>/accounts/account/me/</Code>, no per-event route.
        </p>
        <Pre>{`{
  "song": 94086,
  "played_at": "2026-08-03T20:14:00Z"
}`}</Pre>
        <Table
          headers={['Field', 'Type', 'Meaning']}
          rows={[
            [<Code>song</Code>, 'number', 'API song id that was played'],
            [<Code>played_at</Code>, 'string', 'ISO 8601 timestamp of the play'],
          ]}
        />
        <p className="text-xs text-text-muted">
          Capped at <span className="font-semibold text-text-primary">10,000 events</span>. Send the whole array,
          debounced the same way as <Code>user_preferences</Code>, so a burst of plays collapses into one PATCH
          rather than one per play.
        </p>
      </Section>


      <Section title="Donor File Storage" defaultOpen={false}>
        <p className="text-sm text-text-secondary">
          Donors get <span className="font-semibold text-text-primary">1 GB</span> of private cloud storage for
          audio and image files, optionally shareable by link. All donor routes require{' '}
          <Code>Authorization: Token ...</Code> and <Code>is_donor = true</Code> (read it from{' '}
          <Code>GET /accounts/account/me/</Code>); non-donors get 403 <Code>&quot;Donor status is required.&quot;</Code>{' '}
          Paths below are relative to <Code>/accounts/</Code>.
        </p>
        <Table
          headers={['Method', 'Path', 'Auth', 'Description']}
          rows={[
            ['GET', '/donor/files/', 'Donor', 'List files (newest first) + quota'],
            ['GET', '/donor/files/quota/', 'Donor', 'Quota only'],
            ['POST', '/donor/files/upload/', 'Donor', 'Upload a file (multipart, field "file")'],
            ['GET', '/donor/files/{file_id}/', 'Donor', 'File metadata'],
            ['PATCH', '/donor/files/{file_id}/', 'Donor', 'Rename and/or toggle sharing'],
            ['DELETE', '/donor/files/{file_id}/', 'Donor', 'Delete file and reclaim space'],
            ['GET', '/donor/files/{file_id}/download/', 'Donor', 'Stream own file (Range supported)'],
            ['GET', '/donor/shared/{share_token}/', 'None', 'Download a shared file'],
          ]}
        />

        <p className="text-xs text-text-muted font-semibold mt-3">Limits</p>
        <Table
          headers={['Limit', 'Value']}
          rows={[
            ['Total storage per donor', '1 GB (1073741824 bytes)'],
            ['Max single file', '100 MB'],
            ['Upload rate', '60 uploads per hour'],
            ['Audio types', '.mp3 .flac .wav .m4a .aac .ogg .opus .aiff .wma'],
            ['Image types', '.jpg .jpeg .png .gif .webp'],
          ]}
        />
        <p className="text-xs text-text-muted">
          Quota is enforced on upload; deleting a file reclaims its size immediately. Other extensions are rejected with 400.
        </p>

        <p className="text-xs text-text-muted font-semibold mt-3">File object</p>
        <Pre>{`{
  "file_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "filename": "custom-track.mp3",
  "mime_type": "audio/mpeg",
  "size": 8432100,
  "is_shared": false,
  "share_token": "f0e1d2c3b4a5968778695a4b3c2d1e0f",
  "share_url": "",
  "created_at": "2026-09-21T17:00:00.000000+00:00",
  "updated_at": "2026-09-21T17:00:00.000000+00:00"
}`}</Pre>
        <p className="text-xs text-text-muted">
          <Code>share_url</Code> is empty unless <Code>is_shared</Code> is true. <Code>share_token</Code> is
          generated at upload and never rotates.
        </p>

        <p className="text-xs text-text-muted font-semibold mt-3">Quota object</p>
        <Pre>{`{ "used": 52428800, "quota": 1073741824, "remaining": 1021313024 }`}</Pre>
        <p className="text-xs text-text-muted">
          Returned as <Code>quota</Code> on list, upload and delete responses, and bare from{' '}
          <Code>/donor/files/quota/</Code>. List returns <Code>{'{ "files": [...], "quota": {...} }'}</Code>;
          upload returns <Code>{'{ "file": {...}, "quota": {...} }'}</Code> (201); delete returns{' '}
          <Code>{'{ "detail": "Deleted.", "quota": {...} }'}</Code>.
        </p>

        <p className="text-xs text-text-muted font-semibold mt-3">Upload errors</p>
        <Table
          headers={['Status', 'Reason']}
          rows={[
            ['400', 'No file, invalid filename, extension not allowed, over 100 MB, or would exceed 1 GB (body includes current quota)'],
            ['403', 'Not a donor'],
            ['429', 'Upload rate limit exceeded'],
          ]}
        />

        <p className="text-xs text-text-muted font-semibold mt-3">Update (PATCH)</p>
        <p className="text-xs text-text-muted mb-2">
          Both fields optional. <Code>filename</Code> keeps the basename only (path segments stripped). Returns the
          updated file object with <Code>share_url</Code> populated when sharing is on. Turning sharing off disables the link
          without rotating the token.
        </p>
        <Pre>{`{ "filename": "renamed-track.mp3", "is_shared": true }`}</Pre>

        <p className="text-xs text-text-muted font-semibold mt-3">Download</p>
        <p className="text-xs text-text-muted">
          Both download routes stream with Range support (206), so they work as an <Code>&lt;audio&gt;</Code> src.
          Supports GET and HEAD. Add <Code>?download=1</Code> to force an attachment instead of inline playback. The
          shared route needs no auth and only works while <Code>is_shared</Code> is true. 404 means not found, not
          owned, deleted, or sharing disabled.
        </p>

        <p className="text-xs text-text-muted font-semibold mt-3">Sharing flow</p>
        <Pre>{`1. POST  /donor/files/upload/            -> file
2. PATCH /donor/files/<file_id>/         { "is_shared": true }
3. Copy share_url from the PATCH response
4. Anyone: GET <share_url>               (links never expire)
5. PATCH { "is_shared": false }, or DELETE, to revoke`}</Pre>
      </Section>


      <Section title="Two-Factor (OTP)" defaultOpen={false}>
        <Table
          headers={['Method', 'Path', 'Description']}
          rows={[
            ['GET', '/accounts/otp/setup/', 'Generate a new OTP secret + QR code for enrolling'],
            ['POST', '/accounts/otp/setup/', 'Confirm enrollment with a code from the authenticator app'],
          ]}
        />
        <Pre>{`// GET response
{
  "otp_enabled": false,
  "account_label": "someuser",
  "otp_secret": "JBSWY3DPEHPK3PXP",
  "provisioning_uri": "otpauth://totp/...",
  "qr_code": "data:image/png;base64,..."
}

// POST request
{ "otp_token": "123456" }
// Response: { "otp_enabled": true }`}</Pre>
      </Section>
    </div>
  )
}

function EditorWorkflowTab() {
  const { Code, Section, MethodPath } = usePrimitives()
  return (
    <div className="space-y-6">
      <Section title="Edit Proposals (Editor+)">
        <Table
          headers={['Method', 'Path', 'Description']}
          rows={[
            ['GET', '/accounts/editor/proposals/', "List the logged-in editor's own proposals"],
            ['POST', '/accounts/editor/proposals/', 'Submit a new proposal'],
            ['GET', '/accounts/editor/proposals/{id}/', 'Fetch a single proposal by id, any status - not just pending'],
            ['PATCH', '/accounts/editor/proposals/{id}/', 'Edit a still-pending proposal'],
            ['DELETE', '/accounts/editor/proposals/{id}/', 'Withdraw a proposal'],
          ]}
        />
        <p className="text-xs text-text-muted">
          <Code>change_type</Code> is <Code>"create"</Code>, <Code>"update"</Code>, or <Code>"delete"</Code>. <Code>"update"</Code> is by far the most common in practice.
        </p>
        <p className="text-xs text-text-muted">
          <Code>GET</Code> and <Code>POST</Code> both accept an optional <Code>channel</Code> param/field (slug);
          omit for the primary channel's proposal queue. Channel access is governed by the per-channel{' '}
          <Code>is_editor</Code> membership flag (see Roles above), not just the global one.
        </p>
        <Pre>{`POST /accounts/editor/proposals/
Authorization: Token <token>
Content-Type: application/json

{
  "change_type": "update",
  "song": 94086,
  "title": "Song Title",
  "editor_notes": "",
  "proposed_data": {
    "lyrics": "..."
  }
}`}</Pre>
        <Table
          headers={['Field', 'Type', 'Description']}
          rows={[
            [<Code>change_type</Code>, 'string', '"create" | "update" | "delete"'],
            [<Code>song</Code>, 'number | null', 'Internal song ID (song.id, not public_id); null for a "create" proposal'],
            [<Code>title</Code>, 'string', 'Song title for display purposes'],
            [<Code>editor_notes</Code>, 'string', 'Optional notes from the editor'],
            [<Code>proposed_data</Code>, 'object', 'Only the fields being changed'],
          ]}
        />
        <p className="text-xs text-text-muted">
          To re-submit a stale/stuck pending proposal, <Code>DELETE</Code> it then <Code>POST</Code> the same data again as a fresh proposal (there's no separate "resubmit" endpoint).
        </p>
        <p className="text-xs text-text-muted font-semibold mt-3">Proposal object shape:</p>
        <Pre>{`{
  "id": 167,
  "editor_username": "freakypallet",
  "editor_id": 12,
  "channel_slug": "compilation",
  "song": 94086,
  "song_public_id": 163,
  "change_type": "update",
  "title": "Song Title",
  "proposed_data": { "lyrics": "..." },
  "original_proposed_data": { "lyrics": "..." },
  "applied_data": {},
  "revised_by_admin": false,
  "original_snapshot": { /* Full song fields at time of proposal */ },
  "editor_notes": "",
  "status": "pending",
  "reviewer_username": null,
  "review_notes": "",
  "edit_count": 0,
  "last_edited_at": null,
  "created_at": "2026-06-16T22:07:24.970047Z",
  "reviewed_at": null
}`}</Pre>
        <p className="text-xs text-text-muted"><Code>status</Code> is one of <Code>pending</Code>, <Code>approved</Code>, <Code>rejected</Code>, <Code>reversed</Code>.</p>
      </Section>


      <Section title="Applications (Editor or Contributor)">
        <p className="text-sm text-text-secondary">
          How a standard user applies for either the editor or the contributor track: same endpoint, distinguished
          by <Code>application_type</Code>.
        </p>
        <Table
          headers={['Method', 'Path', 'Description']}
          rows={[
            ['GET', '/accounts/application/', "Fetch the logged-in user's own application (null if none)"],
            ['POST', '/accounts/application/', 'Submit an application'],
          ]}
        />
        <Pre>{`POST /accounts/application/

{
  "application_type": "editor",  // "editor" | "contributor"
  "display_name": "optional",
  "contact": "optional",
  "experience": "optional",
  "motivation": "required, why you want this access",
  "areas": "optional",
  "channel": "optional, applying for a role scoped to one channel rather than globally"
}`}</Pre>
        <p className="text-xs text-text-muted"><Code>status</Code> on the returned application is <Code>pending</Code>, <Code>approved</Code>, or <Code>rejected</Code>.</p>
        <p className="text-xs text-text-muted">
          Approving a <Code>contributor</Code> application should set <Code>is_contributor</Code>, not{' '}
          <Code>is_editor</Code>; the two tracks are separate (see Roles above).
        </p>
      </Section>


      <Section title="Editor Leaderboard">
        <MethodPath method="GET" path={`/accounts/editor/leaderboard/`} />
        <p className="text-xs text-text-muted mb-2">Ranked by approved proposal count. No auth required to view.</p>
        <Pre>{`[
  {
    "rank": 1,
    "user_id": 12,
    "username": "freakypallet",
    "discord_username": "freakypallet",
    "discord_avatar": "https://cdn.discordapp.com/avatars/...",
    "approved_count": 214,
    "badges": [
      {
        "slug": "hundred-club",
        "name": "100 Club",
        "description": "100 approved edits",
        "icon": "🏅",
        "category": "milestone",
        "note": "",
        "awarded_at": "...",
        "awarded_by_username": null
      }
    ]
  }
]`}</Pre>
      </Section>


      <Section title="Comp File Proposals: Overview" defaultOpen={false}>
        <p className="text-sm text-text-secondary leading-relaxed">
          A second, separate proposal pipeline from song-data Edit Proposals above. This one is for changes to the{' '}
          <span className="font-semibold text-text-primary">compilation&apos;s files themselves</span> (uploading a
          new file, replacing one, moving/renaming a file or a whole folder, or deleting a file or folder), submitted
          by contributors and reviewed by admins or managers. Everything under <Code>/accounts/contributor/</Code>{' '}
          requires <Code>is_contributor</Code> (globally or via a comp-channel membership); everything under{' '}
          <Code>/accounts/admin/comp-proposals/</Code> requires admin or manager (again, globally or per-channel);{' '}
          <Code>/accounts/admin/comp-files/</Code> requires <Code>is_administrator</Code>.
        </p>
        <p className="text-xs text-text-muted mt-2">
          Comp-channel scoped: list, create, review, and history calls only see that channel&apos;s proposals and
          files. Pass <Code>?channel=</Code>/a <Code>channel</Code> field on every endpoint below, same as the
          Files &amp; Stream tab. Staging storage lives under <Code>comp_staging/&lt;slug&gt;/proposals/</Code> per
          channel (the primary channel keeps the older unprefixed <Code>comp_staging/proposals/</Code> path).
        </p>
        <p className="text-xs text-text-muted mt-2">
          <span className="font-semibold text-text-primary">Tracker path sync (server-side, automatic):</span> when a
          comp file&apos;s path changes, the API updates matching <Code>Song.path</Code> values without a separate
          call. A single-file <Code>move</Code> (renames count) updates that one <Code>Song.path</Code>;{' '}
          <Code>rename_folder</Code>/<Code>move_folder</Code> updates every affected file&apos;s <Code>Song.path</Code>{' '}
          by swapping the folder prefix. <Code>delete</Code>/<Code>delete_folder</Code> leave <Code>Song.path</Code>{' '}
          untouched since the files are archived, not destroyed &mdash; refetch song data after a folder move/rename
          is approved to pick up the already-updated paths.
        </p>
      </Section>


      <Section title="Contributor: Comp File Proposals" defaultOpen={false}>
        <Table
          headers={['Method', 'Path', 'Description']}
          rows={[
            ['GET', '/accounts/contributor/proposals/', "List the logged-in contributor's own comp-file proposals"],
            ['POST', '/accounts/contributor/proposals/', 'Submit a new comp-file proposal (multipart)'],
            ['PATCH', '/accounts/contributor/proposals/{id}/', 'Edit a still-pending proposal (multipart)'],
            ['DELETE', '/accounts/contributor/proposals/{id}/', 'Withdraw a proposal'],
          ]}
        />
        <p className="text-xs text-text-muted">
          The two write endpoints send <Code>multipart/form-data</Code>, not JSON. The request carries the actual
          file being uploaded/replaced alongside the metadata fields. Send{' '}
          <Code>Authorization: Token &lt;token&gt;</Code> and deliberately{' '}
          <span className="font-semibold text-text-primary">omit</span> <Code>Content-Type</Code> so the browser
          sets the multipart boundary itself. Setting it manually breaks the boundary, and the server can&apos;t
          parse the body.
        </p>
        <Pre>{`POST /accounts/contributor/proposals/
Authorization: Token <token>
Content-Type: multipart/form-data; boundary=... (set automatically, do not set this header yourself)

FormData:
  change_type       "upload" | "replace" | "move" | "delete" | "create_folder"
                    | "rename_folder" | "move_folder" | "delete_folder"
  file_path         "Compilation/Unreleased/Song.mp3"     // target path; a folder path for the folder change types
  destination_path  "Compilation/Unreleased/New Name.mp3" // "move", "rename_folder", "move_folder" only
  contributor_notes "optional"
  file              <binary>                              // only for "upload"/"replace"
  channel           "optional, channel slug, defaults to the primary channel"`}</Pre>
        <p className="text-xs text-text-muted mt-2">
          <Code>create_folder</Code> takes only <Code>file_path</Code> (the new folder&apos;s path, with no
          extension), with no <Code>file</Code> and no <Code>destination_path</Code>. On approval the empty folder is
          created under <Code>comp/</Code>, ready to be filled with upload proposals.
        </p>
        <p className="text-xs text-text-muted font-semibold mt-3">Chunked upload (files &ge; 16&nbsp;MB):</p>
        <p className="text-xs text-text-muted">
          For an <Code>upload</Code>/<Code>replace</Code> whose file is 16&nbsp;MB or larger, send it in pieces
          instead of one multipart body &mdash; the single-request path above is prone to timing out or getting
          dropped mid-transfer at that size. The three calls below replace a single{' '}
          <Code>POST /accounts/contributor/proposals/</Code> for that file only; every other <Code>change_type</Code>
          (including small uploads) still uses the plain multipart endpoint.
        </p>
        <Table
          headers={['Method', 'Path', 'Description']}
          rows={[
            ['POST', '/accounts/contributor/proposals/upload/init/', 'Start a chunked upload, get an upload_id and chunk size'],
            ['POST', '/accounts/contributor/proposals/upload/chunk/', 'Upload one chunk (multipart, repeat per chunk_index)'],
            ['POST', '/accounts/contributor/proposals/upload/complete/', 'Finish the upload and create the proposal from the assembled file'],
          ]}
        />
        <Pre>{`POST /accounts/contributor/proposals/upload/init/
Authorization: Token <token>
Content-Type: application/json

{ "filename": "Song.wav", "total_size": 41943040, "channel": "optional, defaults to the primary channel" }

→ { "upload_id": "...", "chunk_size": 8388608, "total_chunks": 5 }

POST /accounts/contributor/proposals/upload/chunk/          (multipart, repeat for every chunk_index)
Authorization: Token <token>

FormData:
  upload_id     "..."                    // from init
  chunk_index   "0"                      // 0-based, in order
  chunk         <binary>                 // file.slice(start, end) for this chunk_size
  channel       "optional, same as init"

POST /accounts/contributor/proposals/upload/complete/        (once every chunk has been uploaded)
Authorization: Token <token>
Content-Type: application/json

{
  "upload_id": "...",
  "change_type": "upload" | "replace",
  "file_path": "Compilation/Unreleased/Song.wav",
  "destination_path": "optional, \\"replace\\" only",
  "contributor_notes": "optional",
  "channel": "optional, same as init"
}

→ the same comp file proposal object shape as the plain multipart endpoint`}</Pre>
        <p className="text-xs text-text-muted">
          Chunks must be uploaded in order and each must match <Code>chunk_size</Code> from <Code>init</Code> (the
          last chunk may be shorter, up to the remainder of <Code>total_size</Code>). <Code>complete</Code> fails if
          any chunk is missing.
        </p>
        <p className="text-xs text-text-muted font-semibold mt-3">Folder change types</p>
        <p className="text-xs text-text-muted">
          No file is attached for any of the three &mdash; sending <Code>file</Code> on a folder proposal is
          rejected with a <Code>file</Code> field error. <Code>file_path</Code>/<Code>destination_path</Code> are
          comp-root-relative folder paths, forward slashes, no leading slash.
        </p>
        <Table
          headers={['change_type', 'Use when', 'destination_path']}
          rows={[
            [<Code>rename_folder</Code>, 'Only the final folder segment changes; parent stays the same', 'Required &mdash; must share the same parent as file_path'],
            [<Code>move_folder</Code>, 'The folder moves under a different parent directory', 'Required &mdash; must have a different parent than file_path'],
            [<Code>delete_folder</Code>, 'Archive and remove every active file in the folder, then remove it', 'Omit &mdash; not accepted'],
          ]}
        />
        <p className="text-xs text-text-muted">
          Both rename and move require the source folder to exist and contain at least one active indexed file, and
          the destination to not already exist. Using the wrong one of the two for a same-vs-different-parent change
          is a 400: <Code>destination_path</Code>: &quot;Rename must keep the folder in the same parent
          directory.&quot; or &quot;Move must place the folder under a different parent directory.&quot;
        </p>
        <p className="text-xs text-text-muted font-semibold mt-3">
          Auto-approve (trusted contributors, i.e. <Code>auto_approve_comp_proposals</Code>):
        </p>
        <p className="text-xs text-text-muted">
          <Code>rename_folder</Code> and <Code>move_folder</Code> get instant approval like <Code>upload</Code>/
          <Code>replace</Code>/<Code>move</Code>/<Code>create_folder</Code>. <Code>delete</Code> and{' '}
          <Code>delete_folder</Code> are <span className="font-semibold text-text-primary">never</span> auto-approved
          &mdash; both always go to manual review regardless of trust status. See Admin: Comp File Proposal Review
          below for the extra approval gates on <Code>delete_folder</Code> specifically.
        </p>
        <p className="text-xs text-text-muted font-semibold mt-3">Folder proposal object shape (rename_folder):</p>
        <Pre>{`{
  "id": 42,
  "contributor_username": "someone",
  "contributor_id": 7,
  "channel_slug": "comp",
  "file_path": "Era Name/Old Folder",
  "destination_path": "Era Name/New Folder",
  "change_type": "rename_folder",
  "staging_filename": "",
  "original_snapshot": {
    "folder": "Era Name/Old Folder",
    "files": [
      "Era Name/Old Folder/song1.mp3",
      "Era Name/Old Folder/song2.mp3"
    ]
  },
  "contributor_notes": "Fixing typo in folder name",
  "status": "pending",
  "reviewer_username": null,
  "review_notes": "",
  "applied_commit_id": "",
  "edit_count": 0,
  "last_edited_at": null,
  "created_at": "...",
  "reviewed_at": null
}`}</Pre>
        <p className="text-xs text-text-muted">
          For all three folder change types, <Code>staging_filename</Code> is always empty (no upload involved), and{' '}
          <Code>original_snapshot</Code> on <Code>move_folder</Code>/<Code>delete_folder</Code> lists every active
          file the change will affect as <Code>{'{ folder, files: [...] }'}</Code>, useful for showing an
          &quot;affected files&quot; list on a pending proposal.
        </p>
        <p className="text-xs text-text-muted font-semibold mt-3">Comp file proposal object shape:</p>
        <Pre>{`{
  "id": 55,
  "contributor_username": "someuser",
  "contributor_id": 12,
  "channel_slug": "compilation",
  "file_path": "Compilation/Unreleased/Song.mp3",
  "destination_path": null,
  "change_type": "replace",
  "staging_filename": "staged-a1b2c3.mp3",
  "original_snapshot": { /* file metadata before this change */ },
  "contributor_notes": "Higher quality rip",
  "status": "pending",
  "reviewer_username": null,
  "review_notes": "",
  "applied_commit_id": null,
  "edit_count": 0,
  "created_at": "...",
  "reviewed_at": null
}`}</Pre>
        <p className="text-xs text-text-muted">
          <Code>status</Code> is <Code>pending</Code>, <Code>approved</Code>, <Code>rejected</Code>, or{' '}
          <Code>reversed</Code>. <Code>staging_filename</Code> points at the uploaded file sitting in staging until
          an admin approves it; <Code>applied_commit_id</Code> is set once approval actually lands the change.
        </p>
      </Section>

    </div>
  )
}

function AdminTab() {
  const { Code, Section } = usePrimitives()
  return (
    <div className="space-y-6">
      <Section title="Admin: User Lookup" defaultOpen={false}>
        <Table
          headers={['Method', 'Path', 'Description']}
          rows={[
            ['GET', '/accounts/admin/users/', 'List all users. Filter: ?role=editor|contributor|manager|administrator|applicant'],
            ['GET', '/accounts/admin/users/{user_id}/', 'Single user detail: role, is_active, Discord info, proposal counts, badges'],
            ['PATCH', '/accounts/admin/users/{user_id}/', 'Update role, is_active, auto_approve_proposals, or contributor/manager flags'],
          ]}
        />
        <Pre>{`PATCH /accounts/admin/users/{user_id}/

{
  "role": "contributor",            // "editor" | "contributor" | "manager" | "applicant"
  "is_active": true,
  "auto_approve_proposals": false,
  "contributor_enabled": true,
  "manager_enabled": false,
  "auto_approve_comp_proposals": false
}`}</Pre>
        <Table
          headers={['Field', 'Type', 'Meaning']}
          rows={[
            [<Code>contributor_enabled</Code>, 'boolean', 'Whether this user has comp-file proposal access, independent of role string'],
            [<Code>manager_enabled</Code>, 'boolean', 'Whether this user can review proposals/comp-proposals without full admin access, independent of role string'],
            [<Code>auto_approve_comp_proposals</Code>, 'boolean', "Skip manual review and apply this user's comp-file proposals automatically"],
            [<Code>comp_proposal_count</Code>, 'number', "Read-only: this user's total comp-file proposal submissions"],
            [<Code>comp_approved_count</Code>, 'number', 'Read-only: how many of those were approved'],
          ]}
        />
        <p className="text-xs text-text-muted">
          These fields grant access <span className="font-semibold text-text-primary">globally</span>. For a
          per-channel grant instead, use Admin: Channels below.
        </p>
        <p className="text-xs text-text-muted">Requires admin token (<Code>is_administrator: true</Code>).</p>
      </Section>


      <Section title="Admin: Channels" defaultOpen={false}>
        <p className="text-sm text-text-secondary leading-relaxed">
          Manages the <span className="font-semibold text-text-primary">comp</span> channels referenced throughout
          this doc (Files &amp; Stream&apos;s <Code>?channel=</Code>, proposal/comp-proposal scoping, per-channel{' '}
          <Code>memberships</Code>), not News channels, a separate system. Exactly one channel has{' '}
          <Code>is_primary: true</Code>; it can never be deactivated and its <Code>is_active</Code> can&apos;t be
          changed.
        </p>
        <Table
          headers={['Method', 'Path', 'Description']}
          rows={[
            ['GET', '/accounts/admin/channels/', 'List all channels, including inactive ones (adds id/is_active/sort_order over the public /files/channels/ list)'],
            ['POST', '/accounts/admin/channels/', 'Create a channel and its disk folders'],
            ['PATCH', '/accounts/admin/channels/{id}/', 'Update name, description, sort_order, is_active'],
            ['DELETE', '/accounts/admin/channels/{id}/', "Deactivate (not a hard delete; files aren't touched). Primary can't be deleted"],
            ['GET', '/accounts/admin/channels/{id}/members/', "List the channel's per-user role memberships"],
            ['POST', '/accounts/admin/channels/{id}/members/', "Create or update one user's editor/contributor/manager flags for this channel"],
          ]}
        />
        <Pre>{`POST /accounts/admin/channels/

{
  "name": "alrdywrld",
  "description": "optional",
  "slug": "optional",
  "root_dirname": "optional",
  "sort_order": 0
}`}</Pre>
        <p className="text-xs text-text-muted">
          <Code>slug</Code> and the <Code>comp_&lt;slug&gt;</Code> disk root are generated from{' '}
          <Code>name</Code> when omitted. A new channel is never primary.
        </p>
        <Pre>{`PATCH /accounts/admin/channels/{id}/

{
  "name": "optional",
  "description": "optional",
  "sort_order": "optional",
  "is_active": true             // reactivate a previously-deactivated channel; no-op/rejected on the primary channel
}`}</Pre>
        <Table
          headers={['Field', 'Type', 'Meaning']}
          rows={[
            [<Code>id</Code>, 'number', 'Numeric id, used in the URL, not the slug'],
            [<Code>slug</Code>, 'string', 'Stable identifier used as the ?channel= query value elsewhere'],
            [<Code>is_primary</Code>, 'boolean', 'True on exactly one channel, the default when ?channel= is omitted'],
            [<Code>is_active</Code>, 'boolean', "False after DELETE; deactivated channels are hidden, not erased"],
          ]}
        />
        <p className="text-xs text-text-muted font-semibold mt-3">Set a member&apos;s flags:</p>
        <Pre>{`POST /accounts/admin/channels/{id}/members/

{
  "user_id": 42,
  "editor_enabled": true,
  "contributor_enabled": true,
  "manager_enabled": false,
  "auto_approve_proposals": false,
  "auto_approve_comp_proposals": false
}`}</Pre>
        <p className="text-xs text-text-muted">
          Adding a member with every flag omitted/false still creates the membership row (visible in the channel&apos;s
          member list) with no access yet; flags are toggled afterward. On the{' '}
          <span className="font-semibold text-text-primary">primary</span> channel specifically, setting these
          flags also mirrors the old global profile flags (<Code>is_editor</Code>, etc).
        </p>
        <p className="text-xs text-text-muted">
          Admins implicitly get every active channel with every role flag on in{' '}
          <Code>memberships</Code> (see Roles above); everyone else only sees channels they were explicitly added
          to.
        </p>
        <p className="text-xs text-text-muted">Requires admin token (<Code>is_administrator: true</Code>).</p>
      </Section>


      <Section title="Admin: Eras &amp; Albums" defaultOpen={false}>
        <p className="text-sm text-text-secondary leading-relaxed">
          CRUD for the <Code>Era</Code> and <Code>Album</Code> catalog objects surfaced read-only on the public{' '}
          <Code>/eras/</Code> and <Code>/albums/</Code> endpoints (Songs tab). Requires admin token (
          <Code>is_administrator: true</Code>) plus OTP enabled.
        </p>
        <p className="text-xs text-text-muted font-semibold mt-2">Eras</p>
        <Table
          headers={['Method', 'Path', 'Description']}
          rows={[
            ['GET', '/accounts/admin/eras/', 'All eras, ordered by name'],
            ['POST', '/accounts/admin/eras/', 'Create an era'],
            ['PATCH', '/accounts/admin/eras/{id}/', 'Update an era; only include fields you want to change'],
            ['DELETE', '/accounts/admin/eras/{id}/', 'Delete an era'],
          ]}
        />
        <Pre>{`POST /accounts/admin/eras/

{
  "name": "Late 2019",       // required
  "description": "",         // optional
  "time_frame": "",          // optional
  "play_count": 0             // optional, defaults to 0
}`}</Pre>
        <p className="text-xs text-text-muted">Same body shape for <Code>PATCH</Code>, any subset of fields. Both return the era object; <Code>DELETE</Code> returns <Code>{'{ "detail": "Era deleted." }'}</Code>.</p>

        <p className="text-xs text-text-muted font-semibold mt-4">Albums</p>
        <Table
          headers={['Method', 'Path', 'Description']}
          rows={[
            ['GET', '/accounts/admin/albums/', 'All albums, ordered by title, each with a nested artist object'],
            ['POST', '/accounts/admin/albums/', 'Create an album'],
            ['PATCH', '/accounts/admin/albums/{id}/', 'Update an album; only include fields you want to change'],
            ['DELETE', '/accounts/admin/albums/{id}/', 'Delete an album'],
          ]}
        />
        <Pre>{`POST /accounts/admin/albums/

{
  "title": "Death Race for Love",   // required
  "artist_id": 1,                    // required, FK to an existing Artist
  "release_date": "2019-03-08",      // required, YYYY-MM-DD
  "type": "Album",                   // optional, e.g. "Album" | "EP" | "Single"
  "description": "",                 // optional
  "cover_url": "",                    // optional, cover art URL
  "play_count": 0,                    // optional, defaults to 0
  "songs": [                          // optional, ordered tracklist
    { "order": 1, "path": "Released/DRFL/Empty.flac" },
    { "order": 2, "path": "Released/DRFL/Maze.flac" }
  ]
}`}</Pre>
        <p className="text-xs text-text-muted">
          Each <Code>songs</Code> entry is <Code>{'{ order, path }'}</Code>; the backend re-sorts the array by{' '}
          <Code>order</Code> on save, so send it unsorted if convenient.
        </p>
        <p className="text-xs text-text-muted">
          <Code>PATCH</Code> takes the same fields as <Code>POST</Code>. Sending <Code>songs</Code> replaces the
          entire tracklist, same whole-array semantics as the blob fields on{' '}
          <Code>/accounts/account/me/</Code> above &mdash; there is no per-track add/remove route.
        </p>
        <p className="text-xs text-text-muted">Both return the album object with nested <Code>artist</Code>; <Code>DELETE</Code> returns <Code>{'{ "detail": "Album deleted." }'}</Code>.</p>

        <p className="text-xs text-text-muted font-semibold mt-4">Errors</p>
        <Pre>{`{ "detail": "Error message here." }`}</Pre>
        <Table
          headers={['Status', 'Meaning']}
          rows={[
            ['400', 'Validation error: missing required field, bad type, invalid songs format'],
            ['401', 'Not authenticated'],
            ['403', 'Not an administrator, or OTP not enabled'],
            ['404', 'Era or album not found'],
          ]}
        />
      </Section>


      <Section title="Admin: Proposal Review" defaultOpen={false}>
        <Table
          headers={['Method', 'Path', 'Description']}
          rows={[
            ['GET', '/accounts/admin/proposals/', 'List all proposals. Filter: ?status=pending|approved|rejected|reversed&channel='],
            ['GET', '/accounts/admin/proposals/?counts=1', 'Grouped status counts only (total/pending/approved/rejected/reversed), no proposal rows'],
            ['POST', '/accounts/admin/proposals/{id}/review/', 'Approve, reject, or revise-and-approve a proposal'],
            ['POST', '/accounts/admin/proposals/{id}/reverse/', 'Reverse a previously approved proposal'],
          ]}
        />
        <Pre>{`POST /accounts/admin/proposals/{id}/review/

{
  "action": "approve",          // "approve" | "reject" | "revise"
  "review_notes": "optional",
  "revised_data": { },          // only for action: "revise"; overrides proposed_data
  "channel": "optional, the proposal's channel slug"
}`}</Pre>
        <p className="text-xs text-text-muted">
          Requires admin or manager token, and, on a channel-scoped deployment, the per-channel{' '}
          <Code>is_manager</Code>/<Code>is_editor</Code> membership flag for the proposal&apos;s own channel.
        </p>
        <p className="text-xs text-text-muted">
          <Code>?counts=1</Code> short-circuits the normal list response and instead returns{' '}
          <Code>{'{ total, pending, approved, rejected, reversed }'}</Code>, grouped via{' '}
          <Code>.values('status').annotate(Count('id'))</Code> before any row is serialized. Still respects{' '}
          <Code>&amp;channel=</Code>.
        </p>
      </Section>


      <Section title="Admin: Applications" defaultOpen={false}>
        <Table
          headers={['Method', 'Path', 'Description']}
          rows={[
            ['GET', '/accounts/admin/applications/', 'List editor applications. Filter: ?status=pending|approved|rejected'],
            ['POST', '/accounts/admin/applications/{id}/review/', 'Approve or reject an application'],
          ]}
        />
        <Pre>{`POST /accounts/admin/applications/{id}/review/

{
  "action": "approve",          // "approve" | "reject"
  "review_notes": "optional"
}`}</Pre>
        <p className="text-xs text-text-muted">
          Approving promotes the applicant to the role matching the application&apos;s{' '}
          <Code>application_type</Code>: <Code>editor</Code> or <Code>contributor</Code>.
        </p>
      </Section>


      <Section title="Admin: Comp File Proposal Review" defaultOpen={false}>
        <Table
          headers={['Method', 'Path', 'Description']}
          rows={[
            ['GET', '/accounts/admin/comp-proposals/', 'List all comp-file proposals. Filter: ?status=pending|approved|rejected|reversed&channel='],
            ['GET', '/accounts/admin/comp-proposals/?counts=1', 'Grouped status counts only (total/pending/approved/rejected/reversed), no proposal rows'],
            ['POST', '/accounts/admin/comp-proposals/{id}/review/', 'Approve or reject a proposal'],
            ['POST', '/accounts/admin/comp-proposals/{id}/reverse/', 'Reverse a previously approved proposal'],
            ['GET', '/accounts/admin/comp-proposals/{id}/staging/', 'Download the staged file to inspect before approving'],
          ]}
        />
        <Pre>{`POST /accounts/admin/comp-proposals/{id}/review/

{
  "action": "approve",          // "approve" | "reject"
  "review_notes": "optional",
  "channel": "optional, the proposal's channel slug"
}`}</Pre>
        <p className="text-xs text-text-muted">
          <Code>/reverse/</Code> and <Code>/staging/</Code> also accept <Code>?channel=</Code>.
        </p>
        <p className="text-xs text-text-muted">
          Unlike song-data proposals, there is no <Code>&quot;revise&quot;</Code> action here. A comp-file change
          is either accepted as staged or rejected, since there&apos;s no meaningful way to hand-edit a binary file
          upload.
        </p>
        <p className="text-xs text-text-muted">
          <Code>/staging/</Code> streams the actual staged file (not JSON). Treat it as a download/preview link,
          the same way <Code>/files/download/</Code> is used for library audio.
        </p>
        <p className="text-xs text-text-muted">
          <Code>?counts=1</Code> works the same way as on <Code>/accounts/admin/proposals/</Code> above: a single
          grouped aggregate (<Code>{'{ total, pending, approved, rejected, reversed }'}</Code>) instead of the
          proposal list, still filterable by <Code>&amp;channel=</Code>.
        </p>
        <p className="text-xs text-text-muted font-semibold mt-3">
          <Code>delete_folder</Code> &mdash; stricter approval rules:
        </p>
        <p className="text-xs text-text-muted">
          On top of the normal review endpoint above, a <Code>delete_folder</Code> proposal is (1) never
          auto-approved, always sitting <Code>pending</Code> until a human reviews it, (2) only approvable by a full{' '}
          <Code>is_administrator</Code> (or superuser) &mdash; a channel manager alone gets a 403, and (3) not
          self-approvable &mdash; the approver must be a different administrator than whoever proposed the deletion,
          even if the proposer is also an admin.
        </p>
        <Table
          headers={['Status', 'detail']}
          rows={[
            ['403', 'Folder deletions require administrator approval.'],
            ['403', 'Folder deletions must be approved by a different administrator.'],
          ]}
        />
        <p className="text-xs text-text-muted">
          Frontend should hide/disable the approve button for non-administrators on <Code>delete_folder</Code>{' '}
          proposals, show a notice that it needs a second administrator, and if the current user is the proposer,
          make clear they can&apos;t self-approve even as an admin.
        </p>
        <p className="text-xs text-text-muted">
          Reversal works the same way as other comp proposals (<Code>/reverse/</Code>): <Code>rename_folder</Code>/
          <Code>move_folder</Code> move the folder back and restore all file paths and <Code>Song.path</Code> values;{' '}
          <Code>delete_folder</Code> restores the archived files to their original paths, recreates the folder, and
          reactivates their <Code>CompFile</Code> rows.
        </p>
      </Section>


      <Section title="Admin: Comp File History" defaultOpen={false}>
        <Table
          headers={['Method', 'Path', 'Description']}
          rows={[
            ['GET', '/accounts/admin/comp-files/{filepath}/history/', 'Every revision applied to a given compilation file path'],
          ]}
        />
        <Pre>{`{
  "filepath": "Compilation/Unreleased/Song.mp3",
  "revisions": [
    {
      "id": 9,
      "filepath": "Compilation/Unreleased/Song.mp3",
      "hash": "d199a85e510b32b9ef3c02a29044a41d",
      "size": 7381244,
      "archive_path": "archive/Compilation/Unreleased/Song.mp3.v9",
      "proposal_id": 55,
      "commit_id": "c_9f2a",
      "is_current": true,
      "created_at": "..."
    }
  ]
}`}</Pre>
        <p className="text-xs text-text-muted">
          Exactly one revision per file has <Code>is_current: true</Code>. Older revisions stay addressable via{' '}
          <Code>archive_path</Code> for rollback/audit, even after a newer one supersedes them.
        </p>
      </Section>

    </div>
  )
}

function FeedbackTab() {
  const { Code, Section, MethodPath } = usePrimitives()
  return (
    <div className="space-y-6">
      <Section title="Play Tracking">
        <p className="text-sm text-text-secondary">Record a listen event, no auth required. Call when a track starts (or after e.g. 30 s).</p>
        <MethodPath method="POST" path={`/juicewrld/plays/`} className="mt-2" />
        <Table
          headers={['Field', 'Required', 'Notes']}
          rows={[
            [<Code>song_id</Code>, 'No', ''],
            [<Code>public_id</Code>, 'No', ''],
            [<Code>title</Code>, 'Conditional', 'Required if the song can\'t be resolved from song_id/public_id'],
            [<Code>era_name</Code>, 'No', ''],
            [<Code>category</Code>, 'No', ''],
            [<Code>album_name</Code>, 'No', ''],
            [<Code>file_path</Code>, 'No', ''],
            [<Code>source</Code>, 'No', ''],
          ]}
        />
        <p className="text-xs text-text-muted mt-2">201 response is just <Code>{'{ "id": 0 }'}</Code>.</p>
        <MethodPath method="GET" path={`/juicewrld/plays/stats/`} className="mt-3" />
        <p className="text-xs text-text-muted mb-2">Site-wide play stats, cached 5 minutes: totals, category breakdown, top songs/albums/eras, and a recent-plays log.</p>
        <Pre>{`{
  "total_plays": 0,
  "total_songs_with_plays": 0,
  "total_albums_with_plays": 0,
  "total_eras_with_plays": 0,
  "category_breakdown": [{ "category": "", "count": 0 }],
  "top_songs": [{
    "id": 0, "public_id": 0, "name": "", "era_name": "",
    "category": "", "play_count": 0
  }],
  "top_albums": [{ "id": 0, "title": "", "artist_name": "", "play_count": 0 }],
  "top_eras": [{ "id": 0, "name": "", "play_count": 0 }],
  "recent_plays": [{
    "id": 0, "song_id": 0, "public_id": 0, "title": "", "era_name": "",
    "category": "", "album_name": "", "source": "", "played_at": "ISO8601"
  }]
}`}</Pre>
      </Section>


      <Section title="Feedback">
        <MethodPath method="POST" path={`/juicewrld/feedback/`} />
        <p className="text-xs text-text-muted mb-2">General API/app feedback. No auth required. Forwards to a webhook + the mod server.</p>
        <Pre>{`{
  "message": "required",
  "contact": "optional",
  "automated": "optional, true for a crash report the client sent on its own"
}`}</Pre>
        <p className="text-xs text-text-muted mb-3">Throttled at <Code>10/min</Code>.</p>
        <MethodPath method="GET" path={`/juicewrld/feedback/`} />
        <p className="text-xs text-text-muted">List submitted feedback. Requires auth.</p>
      </Section>


      <Section title="Song Reports">
        <p className="text-sm text-text-secondary">
          Public-facing way to flag wrong/missing info on a specific song. Submissions go to the DB and are forwarded
          to the mod server via webhook; editors triage them from the queue.
        </p>
        <Table
          headers={['Method', 'Path', 'Access', 'Description']}
          rows={[
            ['POST', '/juicewrld/reports/', 'No auth', 'Submit a report'],
            ['GET', '/juicewrld/reports/', 'Editor+', 'List reports, filter: ?status=pending|resolved'],
            ['PATCH', '/juicewrld/reports/{id}/', 'Editor+', 'Set status/review_notes (records reviewer + time)'],
          ]}
        />
        <p className="text-xs text-text-muted font-semibold mt-3">Create:</p>
        <Pre>{`POST /juicewrld/reports/

{
  "song_id": 94086,     // or "public_id": 163, one of the two, not both
  "message": "required, what's wrong",
  "contact": "optional"
}`}</Pre>
        <p className="text-xs text-text-muted">Throttled at <Code>10/min</Code>.</p>
        <p className="text-xs text-text-muted font-semibold mt-3">Report row (from the editor list):</p>
        <Pre>{`{
  "id": 31,
  "song": 94086,
  "song_name": "Maze",
  "message": "Issues: Wrong era\\n\\nSong: Maze\\n\\n(Unreleased v1.18.0)",
  "contact": "someuser",
  "status": "pending",
  "review_notes": "",
  "reviewer_username": null,
  "created_at": "...",
  "reviewed_at": null
}`}</Pre>
        <p className="text-xs text-text-muted">
          Read the list defensively: it may come back as a bare array <span className="font-semibold text-text-primary">or</span> a
          DRF <Code>{'{ results: [...] }'}</Code> envelope, and the song id has been seen under{' '}
          <Code>song</Code>, <Code>song_id</Code>, and <Code>public_id</Code> depending on the serializer. Only{' '}
          <Code>status</Code>, <Code>review_notes</Code>, and the reviewer/timestamp fields are guaranteed.
        </p>
        <p className="text-xs text-text-muted">
          There&apos;s no structured category/issue field on submit. Clients fold those into the{' '}
          <Code>message</Code> text, which is why the messages above look pre-formatted.
        </p>
        <p className="text-xs text-text-muted font-semibold mt-3">Review:</p>
        <Pre>{`PATCH /juicewrld/reports/{id}/
Authorization: Token <token>

{
  "status": "resolved",     // "pending" | "resolved"
  "review_notes": "optional"
}`}</Pre>
        <p className="text-xs text-text-muted">
          The server records the reviewer and review time itself; don&apos;t send those. Note there is no
          idempotency key on submit, so a client retrying a queued report can double-post.
        </p>
      </Section>


      <Section title="Beta App (installer gating)" defaultOpen={false}>
        <p className="text-sm text-text-secondary">
          Gates access to in-development desktop builds behind a beta code, separate from the public token/role
          system above. Auth here is the <Code>X-Beta-Code</Code> header, not <Code>Authorization: Token</Code>.
        </p>
        <Table
          headers={['Method', 'Path', 'Auth', 'Description']}
          rows={[
            ['GET', '/beta/unlock?code=X', 'None', <>Check a code, returns <Code>{'{ "valid": true|false }'}</Code></>],
            ['GET', '/beta/versions', <Code>X-Beta-Code</Code>, 'List active beta builds (401 if the code is invalid)'],
            ['GET', '/beta/download?version=X', <Code>X-Beta-Code</Code>, 'Stream the installer for that build (401/404)'],
          ]}
        />
        <Pre>{`GET /beta/versions
X-Beta-Code: YOUR_CODE`}</Pre>
      </Section>

    </div>
  )
}

function NewsTab() {
  const { Code, Section } = usePrimitives()
  return (
    <div className="space-y-6">
      <Section title="Overview">
        <p className="text-sm text-text-secondary leading-relaxed">
          Announcement feed. Posts belong to a <span className="font-semibold text-text-primary">news
          channel</span> (freeform editorial feeds like Announcements/Releases/Leaks, a completely different
          system from the Comp Channels on the Files &amp; Stream tab; <Code>?channel=</Code> here is a news slug,
          not a file-tree slug), can be featured, and can carry image and audio/file attachments. Posting requires{' '}
          <Code>is_news</Code> or admin; editing/deleting a post is restricted to its author unless the caller is
          an admin.
        </p>
      </Section>

      <Section title="Feed">
        <Table
          headers={['Method', 'Path', 'Access', 'Description']}
          rows={[
            ['GET', '/news/', 'No auth', 'Paginated feed. Filter: ?channel=, sort: ?ordering=-published_at|published_at, ?page=, ?page_size='],
            ['GET', '/news/{id}/', 'No auth', 'Single post'],
            ['POST', '/news/', 'is_news or admin', 'Create a post'],
            ['PATCH', '/news/{id}/', 'is_news or admin', "Edit a post, own post only unless admin"],
            ['DELETE', '/news/{id}/', 'is_news or admin', "Delete a post, own post only unless admin"],
          ]}
        />
        <Pre>{`GET /news/?channel=announcements&ordering=-published_at

{
  "results": [ /* NewsItem[], see shape below */ ],
  "count": 42,
  "next": "https://juicewrldapi.com/juicewrld/news/?channel=announcements&page=2"
}`}</Pre>
        <p className="text-xs text-text-muted">
          Omit <Code>channel</Code> (or pass the client&apos;s pseudo-value <Code>&quot;all&quot;</Code>, which is
          never sent to the server) for the unfiltered feed across every channel.
        </p>
        <p className="text-xs text-text-muted font-semibold mt-3">Create payload (title + channel required, rest optional):</p>
        <Pre>{`POST /news/
Authorization: Token <token>

{
  "title": "required",
  "channel": "announcements",   // a news-channel slug, required
  "summary": "optional, short plain-text teaser shown in the feed",
  "body": "optional, full article, Markdown",
  "category": "optional, freeform label, e.g. \\"Release\\"",
  "featured": false,
  "image_url": "optional, https URL, or a base64 data: image ≤2MB",
  "attachments": [ /* { name, url } from POST /news/uploads/, the full desired set */ ]
}`}</Pre>
        <p className="text-xs text-text-muted font-semibold mt-3">Post object shape:</p>
        <Pre>{`{
  "id": 12,
  "title": "New leak dropped",
  "summary": "Short teaser text",
  "body": "Full **markdown** article body",
  "image_url": "https://juicewrldapi.com/media/news/cover.jpg",
  "channel": "leaks",
  "category": "Leak",
  "featured": true,
  "author": "someuser",
  "author_id": 12,
  "attachments": [
    { "id": 5, "name": "snippet.mp3", "url": "...", "mime": "audio/mpeg", "size": 1048576 }
  ],
  "published_at": "2026-08-19T16:00:00Z"
}`}</Pre>
        <p className="text-xs text-text-muted">
          <Code>author_id</Code> is what the client compares against the logged-in user&apos;s own id to decide
          whether Edit/Delete show up. This field being absent or wrong on the server response breaks that gating,
          so make sure it&apos;s always populated.
        </p>
        <p className="text-xs text-text-muted">
          Body is rendered client-side as Markdown with raw HTML stripped; links/images are restricted to
          http/https/mailto. There is no server-side sanitization requirement beyond that (the client never
          executes raw HTML from <Code>body</Code>).
        </p>
      </Section>

      <Section title="Channels">
        <Table
          headers={['Method', 'Path', 'Access', 'Description']}
          rows={[
            ['GET', '/news/channels/', 'No auth', 'List news channels'],
            ['POST', '/news/channels/', 'Admin', 'Create a channel, slug generated from label'],
            ['PATCH', '/news/channels/{slug}/', 'Admin', 'Rename/re-describe a channel'],
            ['DELETE', '/news/channels/{slug}/', 'Admin', 'Delete a channel, only if it has no posts'],
          ]}
        />
        <Pre>{`{ "results": [
  { "id": "announcements", "label": "Announcements", "description": "optional one-liner" }
] }`}</Pre>
        <p className="text-xs text-text-muted">
          <Code>id</Code> on the returned object <span className="font-semibold text-text-primary">is</span> the
          slug, used both in the URL for PATCH/DELETE and as the <Code>?channel=</Code> value on the Feed
          endpoints above.
        </p>
      </Section>

      <Section title="Attachments">
        <p className="text-sm text-text-secondary leading-relaxed">
          Cover images ride inline as an https URL or a base64 <Code>data:</Code> image (≤2MB) in the post payload.
          Everything else, including audio clips, uploads separately through a dedicated endpoint first, and the
          post payload then references the returned hosted <Code>{'{ name, url }'}</Code>.
        </p>
        <Table
          headers={['Method', 'Path', 'Access', 'Description']}
          rows={[
            ['POST', '/news/uploads/', 'is_news or admin', 'Upload one file (multipart, ≤25MB). Returns a hosted attachment record'],
            ['GET', '/news/attachments/{id}/stream/', 'No auth', 'Stream/download a hosted attachment. An optional /{name} suffix and ?download=1 (forces a download instead of inline playback) are both supported'],
          ]}
        />
        <Pre>{`POST /news/uploads/
Authorization: Token <token>
Content-Type: multipart/form-data; boundary=... (set automatically)

FormData:
  file  <binary>`}</Pre>
        <p className="text-xs text-text-muted font-semibold mt-3">Attachment object shape:</p>
        <Pre>{`{
  "id": 5,
  "name": "snippet.mp3",
  "url": "https://juicewrldapi.com/media/news/attachments/snippet.mp3",
  "mime": "audio/mpeg",
  "size": 1048576
}`}</Pre>
        <p className="text-xs text-text-muted">
          The client classifies an attachment as image/audio/generic-file first by <Code>mime</Code>, falling back
          to a guess from <Code>name</Code>&apos;s extension when <Code>mime</Code> is missing or generic (e.g.{' '}
          <Code>application/octet-stream</Code>). Send an accurate <Code>mime</Code> where possible so that guess
          is never needed.
        </p>
        <p className="text-xs text-text-muted">
          The client builds attachment stream/download URLs from <Code>id</Code> via{' '}
          <Code>{'/news/attachments/{id}/stream/{name}'}</Code> when <Code>id</Code> is present, and falls back
          to the raw <Code>url</Code> field only for older/id-less rows. A new upload should always come back with
          an <Code>id</Code>.
        </p>
      </Section>
    </div>
  )
}

function VersionsTab() {
  const { Code, Section } = usePrimitives()
  return (
    <div className="space-y-6">
      <Section title="What is the Versions API?">
        <p className="text-sm text-text-secondary leading-relaxed">
          Groups multiple song rows together as versions of the same underlying track: e.g. a released mix and a
          leaked earlier take, or several titled variants like &quot;v1&quot;, &quot;v2&quot;, &quot;TV Mix&quot;.
          Each row links one <Code>song_id</Code> to a shared <Code>group_id</Code>; every song in a group shares
          the same <Code>title</Code> (the display name for the group, e.g. &quot;She&apos;s The One&quot;), while
          each song keeps its own <Code>version</Code> label (e.g. &quot;v1&quot;) distinguishing it from its
          groupmates.
        </p>
        <p className="text-sm text-text-secondary leading-relaxed mt-2">
          Reads require no auth. Writes (<Code>POST</Code>/<Code>PATCH</Code>) require an editor or admin token.
        </p>
      </Section>

      <Section title="Version Row Shape">
        <Pre>{`{
  "id": 501,
  "song_id": 94086,
  "group_id": 94086,
  "version": "v1",
  "title": "She's The One",
  "created_at": "2026-03-04T12:00:00Z",
  "created_by": "freakypallet"
}`}</Pre>
        <p className="text-xs text-text-muted">
          <Code>group_id</Code> is just the <Code>song_id</Code> of whichever song originally anchored the group; it
          has no meaning beyond being a shared key. <Code>title</Code> is <Code>null</Code> until an editor names the
          group; <Code>version</Code> is <Code>null</Code> until an editor labels that specific song.
        </p>
      </Section>

      <Section title="This Song's Row (GET /versions/{song_id}/)">
        <p className="text-sm text-text-secondary">
          The one filtered read the API supports server-side. Returns the paginated envelope with 0 or 1 result:
          empty means the song isn&apos;t linked into any group.
        </p>
        <Pre>{`{
  "count": 1,
  "next": null,
  "previous": null,
  "results": [ { "id": 501, "song_id": 94086, "group_id": 94086, "version": "v1", "title": "She's The One", ... } ]
}`}</Pre>
        <p className="text-xs text-text-muted mt-2">
          <Code>{'GET /versions/{song_id}/{id}/'}</Code> fetches a single version row directly by its own <Code>id</Code>, unpaginated, instead of the song-filtered list above.
        </p>
      </Section>

      <Section title="All Rows (GET /versions/)">
        <p className="text-sm text-text-secondary">
          The list endpoint does <span className="font-semibold text-text-primary">not</span> apply query params
          (<Code>group_id</Code>, <Code>search</Code>, <Code>title</Code>) server-side. Any filtering by group or
          title has to happen client-side. Pass <Code>?all=true</Code> to get every row in one response instead of
          paging through it (same bulk-mode convention <Code>/songs/</Code> supports).
        </p>
        <Pre>{`GET /versions/?all=true

// Response: a plain array (not the paginated envelope)
[
  { "id": 501, "song_id": 94086, "group_id": 94086, "version": "v1",   "title": "She's The One", ... },
  { "id": 502, "song_id": 94112, "group_id": 94086, "version": "v2",   "title": "She's The One", ... },
  { "id": 503, "song_id": 95230, "group_id": 95230, "version": null,   "title": null, ... }
]`}</Pre>
      </Section>

      <Section title="Create a Row (POST /versions/, editor+)">
        <Pre>{`POST /versions/
Authorization: Token <token>
Content-Type: application/json

{
  "song_id": 94112,
  "group_id": 94086,
  "version": "v2",
  "title": "She's The One"
}`}</Pre>
        <p className="text-xs text-text-muted">
          Used both to link a previously-ungrouped song into an existing group and to seed a brand-new group
          (pass a <Code>group_id</Code> no other row uses yet; the app conventionally uses one of the two
          songs&apos; own <Code>song_id</Code>).
        </p>
      </Section>

      <Section title="Update a Row (PATCH /versions/{song_id}/, editor+)">
        <Pre>{`PATCH /versions/{song_id}/
Authorization: Token <token>
Content-Type: application/json

{ "group_id": 94086, "title": "She's The One" }`}</Pre>
        <p className="text-xs text-text-muted">
          Any subset of <Code>group_id</Code>, <Code>version</Code>, <Code>title</Code> may be sent. There is no
          bulk-write endpoint. Merging two groups or renaming a group&apos;s title means sending one
          <Code> PATCH</Code> per affected song.
        </p>
      </Section>

      <Section title="Common Operations (client-side recipes)">
        <ul className="space-y-3 text-sm text-text-secondary">
          <li>
            <span className="font-semibold text-text-primary">Link two ungrouped songs:</span> create two rows
            sharing a new <Code>group_id</Code> (e.g. the lower of the two song IDs).
          </li>
          <li>
            <span className="font-semibold text-text-primary">Add an ungrouped song to an existing group:</span>{' '}
            <Code>POST</Code> one row with that group&apos;s <Code>group_id</Code> and <Code>title</Code>.
          </li>
          <li>
            <span className="font-semibold text-text-primary">Merge two existing groups:</span> fetch every row in
            both groups (via <Code>?all=true</Code>), then <Code>PATCH</Code> every row in the losing group to the
            surviving <Code>group_id</Code>. If only one side had a <Code>title</Code> set, <Code>PATCH</Code>{' '}
            that title onto every row in the merged group so all members agree.
          </li>
          <li>
            <span className="font-semibold text-text-primary">Rename a group&apos;s title:</span> <Code>PATCH</Code>{' '}
            <Code>{'{ title }'}</Code> onto every row whose <Code>group_id</Code> matches.
          </li>
        </ul>
      </Section>
    </div>
  )
}

function FetchPatternTab() {
  const { Code, Section } = usePrimitives()
  return (
    <div className="space-y-6">
      <Section title="Fetch Utility">
        <p className="text-sm text-text-secondary">Always use a utility function. Never fetch inline in components.</p>
        <Pre>{`// lib/juicewrld.ts
const BASE = 'https://juicewrldapi.com/juicewrld'

export async function apiFetch(
  path: string,
  params: Record<string, string | number | undefined> = {},
  opts: { method?: string; token?: string; body?: unknown } = {}
) {
  const url = new URL(BASE + path)
  Object.entries(params).forEach(([k, v]) => {
    if (v != null) url.searchParams.set(k, String(v))
  })
  const headers: Record<string, string> = {}
  if (opts.token) headers['Authorization'] = \`Token \${opts.token}\`
  if (opts.body)  headers['Content-Type'] = 'application/json'
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) throw new Error(\`API error \${res.status}\`)
  return res.json()
}`}</Pre>
      </Section>

      <Section title="React Hook Pattern">
        <Pre>{`// hooks/useSongs.ts
import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/juicewrld'

export function useSongs({
  category, era, search, searchall, lyrics,
  page = 1, page_size = 20
} = {}) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    setLoading(true)
    apiFetch('/songs/', { category, era, search, searchall, lyrics, page, page_size })
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [category, era, search, searchall, lyrics, page, page_size])

  return { songs: data?.results ?? [], count: data?.count ?? 0, loading, error }
}`}</Pre>
      </Section>

      <Section title="Audio Streaming">
        <Pre>{`// Simple: browser handles range/seeking automatically
<audio
  controls
  src={\`https://juicewrldapi.com/juicewrld/files/download/?path=\${encodeURIComponent(song.path)}\`}
/>

// Tier check before rendering play button
{song.path && (
  <button onClick={() => playSong(song)}>▶</button>
)}`}</Pre>
      </Section>

      <Section title="Tips">
        <ul className="space-y-2 text-sm text-text-secondary">
          <li className="flex items-start gap-2"><span className="text-accent mt-0.5">•</span> Use <Code>song.path</Code> directly as the stream path. It's already in the right format.</li>
          <li className="flex items-start gap-2"><span className="text-accent mt-0.5">•</span> The browser <Code>{'<audio>'}</Code> element handles Range requests automatically. Just set <Code>src</Code>.</li>
          <li className="flex items-start gap-2"><span className="text-accent mt-0.5">•</span> Debounce search inputs 300–500 ms to avoid hammering the API.</li>
          <li className="flex items-start gap-2"><span className="text-accent mt-0.5">•</span> <Code>track_titles</Code> is an array; a song may have multiple alternative titles. Show the first or let users pick.</li>
          <li className="flex items-start gap-2"><span className="text-accent mt-0.5">•</span> Not all songs have a <Code>path</Code> (some are metadata-only). Check before rendering a play button.</li>
          <li className="flex items-start gap-2"><span className="text-accent mt-0.5">•</span> <Code>image_url</Code> is relative; prepend <Code>https://juicewrldapi.com</Code>.</li>
          <li className="flex items-start gap-2"><span className="text-accent mt-0.5">•</span> Use <Code>/radio/random/</Code> for a shuffle/discover feature; it already returns a playable file.</li>
          <li className="flex items-start gap-2"><span className="text-accent mt-0.5">•</span> Check <Code>/account/me/</Code> first to know the role; don't probe restricted endpoints and handle 403s.</li>
        </ul>
      </Section>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────


// ─── 999 FM Tab ───────────────────────────────────────────────────────────────

function RadioTab() {
  const { Code, Section } = usePrimitives()
  return (
    <div className="space-y-6">
      <Section title="What is 999 FM?">
        <p className="text-sm text-text-secondary leading-relaxed">
          999 FM is the Juice WRLD API radio: a single endpoint that returns a random, fully playable song
          on every request. Named after Juice WRLD&apos;s 999 brand, it&apos;s designed for discover or continuous
          playback features: call it, stream the song, call it again for the next one.
        </p>
        <p className="text-sm text-text-secondary leading-relaxed mt-2">
          No authentication required. Returns a full song object plus the direct stream path.
        </p>
      </Section>

      <Section title="GET /radio/random/">
        <p className="text-sm text-text-secondary">Pick a random song from the full catalogue and return its stream path and metadata.</p>
        <Pre>{`GET https://juicewrldapi.com/juicewrld/radio/random/`}</Pre>
        <p className="text-xs text-text-muted mt-2">No parameters required. Every call returns a different song.</p>
        <div className="mt-4">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Response</p>
          <Pre>{`{
  "id":       "Compilation/2. Unreleased Discography/8. WOD (Sessions)/Maze.mp3",
  "title":    "Maze",
  "path":     "Compilation/2. Unreleased Discography/8. WOD (Sessions)/Maze.mp3",
  "size":     7381244,
  "modified": "2025-10-18T19:19:53.784271",
  "hash":     "d199a85e510b32b9ef3c02a29044a41d",
  "song": {
    "id": 95001,
    "public_id": 2232,
    "name": "Maze",
    "category": "unreleased",
    "era": { "id": 109, "name": "WOD", "description": "WRLD On Drugs era" },
    "path": "Compilation/2. Unreleased Discography/8. WOD (Sessions)/Maze.mp3",
    "credited_artists": "Juice WRLD",
    "length": "2:24",
    "lyrics": "...",
    "synced_lyrics": "...",
    "image_url": "/assets/wod.jpg"
    // ... all standard song fields
  }
}`}</Pre>
        </div>
        <Table
          headers={['Field', 'Type', 'Description']}
          rows={[
            [<Code>id</Code>, 'string', 'Internal file path (same as path)'],
            [<Code>title</Code>, 'string', 'Song title'],
            [<Code>path</Code>, 'string', 'Stream path, pass to /files/download/?path='],
            [<Code>size</Code>, 'number', 'File size in bytes'],
            [<Code>modified</Code>, 'string', 'ISO 8601 last-modified timestamp'],
            [<Code>hash</Code>, 'string', 'MD5 file hash (use for deduplication or cache-busting)'],
            [<Code>song</Code>, 'object', 'Full song object, same shape as GET /songs/{id}/'],
          ]}
        />
      </Section>

      <Section title="Streaming the result">
        <p className="text-sm text-text-secondary">
          The <Code>path</Code> field maps directly to the <Code>/files/download/</Code> endpoint. Pass it as the
          stream URL for your audio element.
        </p>
        <Pre>{`const BASE = 'https://juicewrldapi.com/juicewrld';

async function getRadioSong() {
  const res = await fetch(\`\${BASE}/radio/random/\`);
  const data = await res.json();
  return {
    title:        data.title,
    streamUrl:    \`\${BASE}/files/download/?path=\${encodeURIComponent(data.path)}\`,
    coverUrl:     \`https://juicewrldapi.com\${data.song.image_url}\`,
    artist:       data.song.credited_artists,
    era:          data.song.era?.name,
    lyrics:       data.song.lyrics || null,
    syncedLyrics: data.song.synced_lyrics || null,
  };
}

// Basic usage
const track = await getRadioSong();
audioElement.src = track.streamUrl;
audioElement.play();`}</Pre>
      </Section>

      <Section title="React hook: useRadio">
        <Pre>{`import { useState, useCallback } from 'react';

const BASE = 'https://juicewrldapi.com/juicewrld';

export function useRadio() {
  const [track, setTrack] = useState(null);
  const [loading, setLoading] = useState(false);

  const next = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(\`\${BASE}/radio/random/\`);
      const data = await res.json();
      setTrack({
        title:        data.title,
        streamUrl:    \`\${BASE}/files/download/?path=\${encodeURIComponent(data.path)}\`,
        coverUrl:     \`https://juicewrldapi.com\${data.song.image_url}\`,
        artist:       data.song.credited_artists,
        era:          data.song.era?.name,
        length:       data.song.length,
        lyrics:       data.song.lyrics || null,
        syncedLyrics: data.song.synced_lyrics || null,
        song:         data.song,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  return { track, loading, next };
}

// In your component:
function RadioPlayer() {
  const { track, loading, next } = useRadio();

  return (
    <div>
      {track ? (
        <>
          <img src={track.coverUrl} alt={track.title} />
          <p>{track.title} by {track.artist}</p>
          <audio
            src={track.streamUrl}
            autoPlay
            onEnded={next}
          />
        </>
      ) : (
        <button onClick={next} disabled={loading}>
          {loading ? 'Loading...' : 'Start 999 FM'}
        </button>
      )}
      <button onClick={next} disabled={loading}>Next</button>
    </div>
  );
}`}</Pre>
      </Section>

      <Section title="Live Radio: one shared broadcast">
        <p className="text-sm text-text-secondary leading-relaxed">
          Separate from <Code>/radio/random/</Code> above. That endpoint hands each client its own random song;
          this is a single <span className="font-semibold text-text-primary">shared station</span>: every listener
          hears the same audio at the same time, with listener counts and community skip/queue votes. No auth required.
        </p>
        <Table
          headers={['Transport', 'Endpoint', 'Purpose']}
          rows={[
            ['REST', 'GET /radio/live/', 'One-shot snapshot of station state: now playing, up next, vote, listener counts'],
            ['WebSocket', '/ws/radio/', 'Live metadata pushes, vote participation, and (optionally) the audio itself'],
            ['HTTP', 'GET /radio/stream.mp3', 'Plain MP3 stream, the fallback when MediaSource is unavailable'],
          ]}
        />
        <p className="text-xs text-text-muted">
          The websocket URL is the API base with its scheme swapped to <Code>ws</Code>/<Code>wss</Code> and{' '}
          <Code>/ws/radio/</Code> appended, e.g. <Code>wss://juicewrldapi.com/juicewrld/ws/radio/</Code>.
        </p>
      </Section>

      <Section title="Station State (GET /radio/live/)">
        <Pre>{`{
  "is_live": true,
  "station": "999 FM",
  "state": "playing",
  "stream_url": "https://juicewrldapi.com/juicewrld/radio/stream.mp3",
  "now_playing": {
    "title": "Maze",
    "artist": "Juice WRLD",
    "album": "...",
    "display": "Juice WRLD - Maze",
    "elapsed_ms": 41000,
    "duration_ms": 144000,
    "image_url": "/assets/wod.jpg",
    "song_id": 95001
  },
  "up_next": { /* same shape, or null */ },
  "queue_preview": ["Song A", "Song B"],
  "dj_enabled": true,
  "dj_line": "Coming up next…",
  "vote": {
    "active": true,
    "kind": "skip",           // "skip" | "queue"
    "yes": 3,
    "no": 1,
    "votes_needed": 5,
    "total_listeners": 12,
    "seconds_left": 20,
    "track": "Maze"
  },
  "web_listeners": 8,
  "discord_listeners": 4,
  "total_listeners": 12,
  "stale_seconds": null
}`}</Pre>
        <p className="text-xs text-text-muted">
          <Code>song_id</Code> on a track is the numeric API song id, so a live track can be looked up via{' '}
          <Code>{'/songs/{id}/'}</Code> for full metadata, lyrics, or cover art. <Code>image_url</Code> is
          relative; prepend <Code>https://juicewrldapi.com</Code>. <Code>vote.active: false</Code> means no vote
          is running and the other vote fields may be absent.
        </p>
      </Section>

      <Section title="Track Library (GET /radio/library/)" defaultOpen={false}>
        <p className="text-sm text-text-secondary">The pool of tracks 999 FM draws from, grouped by era. Useful for building a "what's in rotation" view without polling <Code>/radio/live/</Code>.</p>
        <Pre>{`{
  "eras": [
    {
      "name": "WOD",
      "tracks": [
        { "id": "94086", "title": "Maze", "artist": "Juice WRLD" }
      ]
    }
  ]
}`}</Pre>
      </Section>

      <Section title="WebSocket /ws/radio/">
        <p className="text-sm text-text-secondary">
          The socket carries <span className="font-semibold text-text-primary">both</span> metadata and audio:
          text frames are JSON station-state objects (same shape as <Code>/radio/live/</Code>), binary frames are
          MP3 chunks. Set <Code>binaryType = &apos;arraybuffer&apos;</Code> and branch on the frame type.
        </p>
        <Pre>{`const ws = new WebSocket('wss://juicewrldapi.com/juicewrld/ws/radio/')
ws.binaryType = 'arraybuffer'

ws.onmessage = (e) => {
  if (typeof e.data === 'string') {
    const state = JSON.parse(e.data)   // RadioLiveState, update the UI
  } else {
    // MP3 chunk, feed to a MediaSource SourceBuffer('audio/mpeg')
  }
}`}</Pre>
        <p className="text-xs text-text-muted font-semibold mt-3">Client → server messages:</p>
        <Table
          headers={['Message', 'Purpose']}
          rows={[
            [<Code>{'{ type: "listening", value, audio }'}</Code>, <>Join/leave the listener count. <Code>audio</Code> is <Code>&quot;ws&quot;</Code> or <Code>&quot;http&quot;</Code> depending on which stream you&apos;re consuming. Re-send on reconnect if still listening.</>],
            [<Code>{'{ type: "propose_skip" }'}</Code>, 'Start a vote to skip the current track'],
            [<Code>{'{ type: "propose_queue", song_id }'}</Code>, <>Start a vote to queue a song. <Code>song_id</Code> must be the <span className="font-semibold text-text-primary">number</span>; a stringified id is silently ignored and the vote never starts.</>],
            [<Code>{'{ type: "vote", value }'}</Code>, <><Code>&quot;yes&quot;</Code> or <Code>&quot;no&quot;</Code> on the active vote</>],
          ]}
        />
        <p className="text-xs text-text-muted font-semibold mt-3">Playback notes:</p>
        <ul className="space-y-2 text-sm text-text-secondary">
          <li className="flex items-start gap-2"><span className="text-accent mt-0.5">•</span> Binary frames only make sense with MediaSource (<Code>audio/mpeg</Code>). Where it&apos;s unsupported, ignore them and point an <Code>{'<audio>'}</Code> element at <Code>/radio/stream.mp3</Code> instead. Tell the server which you chose via the <Code>audio</Code> field.</li>
          <li className="flex items-start gap-2"><span className="text-accent mt-0.5">•</span> Because it&apos;s a live stream, buffered audio drifts behind. Seek forward when you fall more than a few seconds behind the buffered end, and evict old buffered ranges or the SourceBuffer eventually throws <Code>QuotaExceededError</Code>.</li>
          <li className="flex items-start gap-2"><span className="text-accent mt-0.5">•</span> Reconnect on close. Background tabs get their socket closed and audio paused silently, with no event fired, so a periodic health check is worth having.</li>
        </ul>
      </Section>

      <Section title="Notes">
        <ul className="space-y-2 text-sm text-text-secondary">
          <li className="flex items-start gap-2"><span className="text-accent mt-0.5">•</span> Calls are not seeded; every request is independent. Repeats are possible but rare given the 2,452-song catalogue.</li>
          <li className="flex items-start gap-2"><span className="text-accent mt-0.5">•</span> The <Code>song</Code> object is identical to <Code>{`/songs/{id}/`}</Code>: full producers, engineers, lyrics, synced lyrics, and groupbuy info included.</li>
          <li className="flex items-start gap-2"><span className="text-accent mt-0.5">•</span> <Code>image_url</Code> is a relative path (e.g. <Code>/assets/wod.jpg</Code>); prepend <Code>https://juicewrldapi.com</Code> for use in <Code>&lt;img&gt;</Code> tags.</li>
          <li className="flex items-start gap-2"><span className="text-accent mt-0.5">•</span> The stream endpoint supports HTTP Range requests; the browser <Code>&lt;audio&gt;</Code> element handles seeking automatically.</li>
          <li className="flex items-start gap-2"><span className="text-accent mt-0.5">•</span> No rate limiting on public endpoints, but call once per track end, not on a tight loop.</li>
        </ul>
      </Section>
    </div>
  )
}

function HeardleTab() {
  const { Code, Section, MethodPath } = usePrimitives()
  return (
    <div className="space-y-6">
      <Section title="What is Heardle?">
        <p className="text-sm text-text-secondary leading-relaxed">
          A daily song-guessing game: a short clip plays, and each wrong guess unlocks a little more of it. The
          leaderboards and the signed audio clip below are the only Heardle endpoints that work without a user
          token; the puzzle itself (fetching today's round, submitting a guess, skipping, personal stats) needs
          an authenticated account and isn't covered on this tab.
        </p>
      </Section>

      <Section title="Leaderboard (GET .../heardle/leaderboard/)">
        <p className="text-sm text-text-secondary">
          Mounted at <Code>/juicewrld/heardle/leaderboard/</Code> and mirrored under{' '}
          <Code>/accounts/heardle/leaderboard/</Code> and <Code>/juicewrld/accounts/heardle/leaderboard/</Code>.
        </p>
        <Table
          headers={['Param', 'Default', 'Values']}
          rows={[
            [<Code>board</Code>, <Code>streak</Code>, <><Code>streak</Code>, <Code>today</Code>, <Code>versus</Code></>],
            [<Code>mode</Code>, <Code>daily</Code>, <>Also <Code>personal</Code>; ignored for <Code>versus</Code></>],
            [<Code>day</Code>, 'today', <><Code>YYYY-MM-DD</Code></>],
            [<Code>limit</Code>, '50', 'Max 100'],
            [<Code>offset</Code>, '0', ''],
          ]}
        />
        <Pre>{`{
  "board": "streak",
  "mode": "daily",
  "day": "2026-09-10",
  "entries": [ /* row shape depends on board, see below */ ],
  "me": null
}`}</Pre>
        <p className="text-xs text-text-muted">
          <Code>me</Code> is only populated when an auth token is sent; sending one is optional here.
        </p>
        <p className="text-xs text-text-muted font-semibold mt-3">Row shapes by board:</p>
        <Table
          headers={['Board', 'Fields']}
          rows={[
            ['streak', 'rank, user_id, display_name, discord_username, discord_avatar, played, won, win_rate, current_streak, max_streak, distribution'],
            ['today', 'rank, user_id, display_name, discord_avatar, guesses, won'],
            ['versus', 'rank, user_id, display_name, discord_avatar, played, won, lost, drawn, win_rate'],
          ]}
        />
      </Section>

      <Section title="Signed Clip (GET /heardle/clip/)">
        <p className="text-sm text-text-secondary">
          Serves the round's audio clip. Auth here is a signed <Code>round_token</Code>/<Code>sig</Code> pair
          (HMAC) handed out when the puzzle round was fetched, not an <Code>Authorization</Code> header.
        </p>
        <Table
          headers={['Param', 'Required', 'Description']}
          rows={[
            [<Code>round_token</Code>, 'Yes', ''],
            [<Code>sig</Code>, 'Yes', 'HMAC signature over the round token'],
            [<Code>unlock</Code>, 'No', 'Integer, how much of the clip to unlock (default 0)'],
          ]}
        />
        <p className="text-xs text-text-muted font-semibold mt-2">403 on a bad signature:</p>
        <Pre>{`{ "error": "Invalid signature" }`}</Pre>
        <p className="text-xs text-text-muted">Otherwise streams the audio file with <Code>Accept-Ranges: bytes</Code>.</p>
      </Section>
    </div>
  )
}

function FeedsMediaTab() {
  const { Code, Section } = usePrimitives()
  return (
    <div className="space-y-6">
      <Section title="RSS & JSON Feeds">
        <p className="text-sm text-text-secondary leading-relaxed">
          Activity feeds under <Code>/juicewrld/feeds/</Code>, one pair each for the two edit pipelines: song-data
          edits (<Code>tracker</Code>) and comp-file changes (<Code>comp</Code>). Each comes as RSS XML for feed
          readers and as JSON for anything that wants the data directly. All four accept a <Code>limit</Code>{' '}
          param, 1-200, default 50.
        </p>
        <Table
          headers={['Route', 'Content']}
          rows={[
            [<Code>GET /feeds/tracker.rss</Code>, 'RSS XML of approved song edits'],
            [<Code>GET /feeds/comp.rss</Code>, 'RSS XML of comp file commits'],
            [<Code>GET /feeds/tracker.json</Code>, 'JSON of approved song edits'],
            [<Code>GET /feeds/comp.json</Code>, 'JSON of comp file commits'],
          ]}
        />
        <p className="text-xs text-text-muted font-semibold mt-2"><Code>tracker.json</Code> row shape:</p>
        <Pre>{`{
  "results": [{
    "id": "song-proposal-0",
    "proposal_id": 0,
    "song_id": 0,
    "action": "",
    "name": "",
    "user": "",
    "fields": [],
    "notes": "",
    "timestamp": "datetime",
    "link": "url"
  }]
}`}</Pre>
        <p className="text-xs text-text-muted font-semibold mt-2"><Code>comp.json</Code> row shape:</p>
        <Pre>{`{
  "results": [{
    "id": "",
    "action": "",
    "is_folder": false,
    "path": "",
    "name": "",
    "folder": "",
    "user": "",
    "size": 0,
    "md5": "",
    "source_path": "",
    "timestamp": "datetime",
    "link": "url"
  }]
}`}</Pre>
      </Section>

      <Section title="Static Files">
        <p className="text-sm text-text-secondary">
          Two plain static-file routes outside the main file browser: cover art served straight off disk, and
          general media (news covers, attachments) served from the app's media root.
        </p>
        <Table
          headers={['Route', 'Description']}
          rows={[
            [<Code>{'GET /cover/{name}'}</Code>, 'Image from the Cover Art directory. jpg/jpeg/png/webp/gif only'],
            [<Code>{'GET /media/{path}'}</Code>, "Any file under the app's MEDIA_ROOT, e.g. news covers and attachments"],
          ]}
        />
      </Section>
    </div>
  )
}

function ChatTab() {
  const { Code, Section, MethodPath } = usePrimitives()
  return (
    <div className="space-y-6">
      <Section title="Overview">
        <p className="text-sm text-text-secondary leading-relaxed">
          Discord-like servers with text channels, roles/permissions, 1:1 and group DMs, real-time delivery
          over WebSocket, attachments, reactions, read receipts, message pinning, and threads. Direct
          messages are end-to-end encrypted; server channels are plaintext (server-readable).
        </p>
        <p className="text-sm text-text-secondary leading-relaxed mt-2">
          Access is no longer staff-only for servers/channels: admins can flag a server as{' '}
          <Code>is_public</Code>, and any authenticated user can discover, join, and use it. DMs remain
          staff-only.
        </p>
        <Table
          headers={['User', 'Access']}
          rows={[
            ['Staff (manager/admin)', 'Full access, DMs, can create servers'],
            ['Non-staff, member of a server', "That server's channels only, no DMs"],
            ['Non-staff, not a member', 'Can only discover + join public servers'],
          ]}
        />
        <div className="flex items-center gap-2 mt-2">
          <span className="text-xs text-text-muted">Base path</span>
          <Code>/juicewrld/chat/</Code>
          <span className="text-xs text-text-muted">(also </span>
          <Code>/chat/</Code>
          <span className="text-xs text-text-muted">depending on deployment routing)</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-text-muted">WebSocket path</span>
          <Code>/juicewrld/ws/chat/</Code>
          <span className="text-xs text-text-muted">(also </span>
          <Code>/ws/chat/</Code>
          <span className="text-xs text-text-muted">)</span>
        </div>
      </Section>

      <Section title="Access Control">
        <p className="text-sm text-text-secondary">
          Every request needs a token. DMs still require staff (<Code>administrator</Code> or{' '}
          <Code>manager</Code> role, or a Django superuser). Server/channel access is now permission-driven:
          staff get full access everywhere, and any authenticated user can join public servers and use their
          channels per that server's roles. An unauthenticated caller gets <Code>401</Code>; an authenticated
          caller without the required permission gets <Code>403</Code>. The same token authenticates the
          WebSocket via a query param.
        </p>
        <Pre>{`Authorization: Token YOUR_TOKEN_HERE`}</Pre>
        <Table
          headers={['Object', 'Rule']}
          rows={[
            ['Server channels', "Caller must be a server member with view_channels resolved for that channel (see Permission Resolution below). Staff/owner/platform admin bypass"],
            ['DMs', 'Caller must be staff and a participant of the conversation'],
            ['Editing a message', 'Author only'],
            ['Deleting / pinning a message', 'Author, users with manage_messages, server owner, or platform administrator'],
            ['Managing roles/overrides', 'Requires manage_roles / manage_channels on the resolved permission set, or owner/platform admin'],
            ['Kicking / timing out a member', 'Requires kick_members or manage_server. Never allowed against the owner'],
            ['Banning / unbanning', 'Requires ban_members or manage_server. Never allowed against the owner or a platform administrator'],
            ['Site-wide moderation', 'Platform administrators only (is_administrator or superuser)'],
          ]}
        />
      </Section>

      <Section title="Conventions">
        <p className="text-sm text-text-secondary">
          Bodies are JSON except uploads (multipart). Timestamps are ISO-8601. List endpoints return{' '}
          <Code>{'{ results: [...] }'}</Code>; message lists also return <Code>has_more</Code>. Errors return{' '}
          <Code>{'{ detail: "..." }'}</Code>.
        </p>
        <Table
          headers={['Code', 'Meaning']}
          rows={[
            ['200 / 201 / 204', 'OK / Created / Deleted (no body)'],
            ['400', 'Validation error'],
            ['401 / 403', 'Missing/invalid token / authenticated but not allowed'],
            ['404', 'Not found or not visible to you'],
            ['409', 'Conflict (e.g. member already exists)'],
            ['429', 'Throttled'],
          ]}
        />
        <p className="text-xs text-text-muted font-semibold mt-3">Throttle scopes</p>
        <Table
          headers={['Scope', 'Limit', 'Applies to']}
          rows={[
            [<Code>chat_send</Code>, '120/min', 'Creating channel or DM messages'],
            [<Code>chat_edit</Code>, '120/min', 'Editing, deleting, pinning, reacting'],
            [<Code>chat_upload</Code>, '60/min', 'Attachment uploads'],
          ]}
        />
        <p className="text-xs text-text-muted font-semibold mt-3"><Code>message</Code> shape:</p>
        <Pre>{`{
  "id": 501,
  "channel": 8,
  "conversation": null,
  "author": { "id": 12, "username": "jdoe", "display_name": "J Doe", "avatar": "", "role": "manager" },
  "content": "hello team",
  "is_encrypted": false,
  "ciphertext": "", "nonce": "", "key_version": null,
  "parent": null,
  "mentions": [15, 16],
  "attachments": [
    { "id": 3, "name": "log.txt", "url": "https://host/.../ab12_log.txt", "mime": "text/plain", "size": 2048,
      "encrypted_name": "", "nonce": "", "key_version": null }
  ],
  "reactions": [ { "emoji": "fire", "count": 2, "user_ids": [12, 15], "me": true } ],
  "reply_count": 0,
  "pinned": false, "pinned_by": null, "pinned_at": null,
  "edited_at": null, "deleted_at": null,
  "created_at": "2026-09-16T19:00:00Z"
}`}</Pre>
        <p className="text-xs text-text-muted">
          For DM messages, <Code>is_encrypted</Code> is <Code>true</Code>, <Code>content</Code> is empty, and{' '}
          <Code>ciphertext</Code>/<Code>nonce</Code>/<Code>key_version</Code> are populated instead. Deleted
          messages come back with empty <Code>content</Code>/<Code>ciphertext</Code>/<Code>nonce</Code>/
          <Code>attachments</Code> and <Code>deleted_at</Code> set.
        </p>
      </Section>

      <Section title="Servers">
        <MethodPath method="GET" path="/servers/" />
        <p className="text-xs text-text-muted mb-2">→ <Code>{'{ results: [server, ...] }'}</Code>. <Code>channels</Code> on each server only lists channels you can see.</p>
        <MethodPath method="POST" path="/servers/" className="mt-2" />
        <p className="text-xs text-text-muted mb-2">
          <Code>{'{ name, description?, icon?, is_public? }'}</Code> — creates the server, makes you owner,
          adds a default <Code>general</Code> channel.
        </p>
        <p className="text-xs text-text-muted mb-2">
          <Code>is_public</Code> is honoured only for platform administrators, same as the{' '}
          <Code>PATCH</Code>. Deployments that predate it ignore the field, so a client that offers the
          choice at creation should check <Code>is_public</Code> on the response and follow up with{' '}
          <Code>{'PATCH /servers/{id}/'}</Code> when it came back <Code>false</Code>.
        </p>
        <Table
          headers={['Method', 'Path', 'Description']}
          rows={[
            ['GET', '/servers/{id}/', 'Server detail'],
            ['PATCH', '/servers/{id}/', 'Update name/description/icon (owner/admin)'],
            ['DELETE', '/servers/{id}/', 'Delete (owner or platform admin)'],
            ['GET', '/servers/{id}/members/', 'List members'],
            ['POST', '/servers/{id}/members/', 'Add a member: { user_id, server_role } (owner/admin, 409 if already a member, 400 if target not staff)'],
            ['PATCH', '/servers/{id}/members/{user_id}/', 'Update server_role and/or muted (owner/admin)'],
            ['DELETE', '/servers/{id}/members/{user_id}/', 'Kick a member (kick_members or manage_server); you may always remove yourself, owner cannot be removed'],
            ['POST', '/servers/{id}/members/{user_id}/timeout/', 'Time a member out: { duration } in minutes (kick_members or manage_server)'],
            ['DELETE', '/servers/{id}/members/{user_id}/timeout/', 'Lift a timeout early'],
            ['GET', '/servers/{id}/bans/', 'List server bans (ban_members or manage_server)'],
            ['POST', '/servers/{id}/bans/', 'Ban a user: { user_id, reason? }'],
            ['DELETE', '/servers/{id}/bans/{user_id}/', 'Unban a user'],
            ['POST', '/servers/{id}/channels/', 'Create a channel: { name, topic?, category?, is_private?, allowed_members? } (owner/admin)'],
            ['GET', '/channels/{id}/', 'Channel detail'],
            ['PATCH', '/channels/{id}/', 'Update name/topic/category/position/is_private/allowed_members (owner/admin)'],
            ['DELETE', '/channels/{id}/', 'Delete a channel (owner/admin)'],
          ]}
        />
        <p className="text-xs text-text-muted mt-2"><Code>server_role</Code> is <Code>admin</Code> or <Code>member</Code> (owner can&apos;t be assigned). <Code>allowed_members</Code> only applies when <Code>is_private</Code> is true.</p>
        <p className="text-xs text-text-muted mt-2">
          <Code>Channel.is_private</Code>/<Code>allowed_members</Code> still exist and are returned, but no
          longer gate access — that&apos;s driven entirely by permissions + channel overrides now (see below).
          Migrate any private-channel UI to overrides: deny <Code>view_channels</Code> on the{' '}
          <Code>@everyone</Code> role override for that channel, then allow it on the roles/members who
          should see it.
        </p>
        <p className="text-xs text-text-muted font-semibold mt-3">Server object, new fields:</p>
        <Table
          headers={['Field', 'Type', 'Description']}
          rows={[
            [<Code>is_public</Code>, 'boolean', 'Whether the server is publicly discoverable/joinable'],
            [<Code>my_permissions</Code>, 'number', "The current user's resolved server-level permission bitmask"],
            [<Code>roles</Code>, 'array', 'All roles in the server (see Roles below)'],
          ]}
        />
        <p className="text-xs text-text-muted mt-1">
          Existing fields unchanged: <Code>id</Code>, <Code>name</Code>, <Code>slug</Code>,{' '}
          <Code>description</Code>, <Code>icon_url</Code>, <Code>owner</Code>, <Code>member_count</Code>,{' '}
          <Code>my_role</Code>, <Code>channels</Code>, <Code>created_at</Code>. <Code>my_role</Code>{' '}
          (<Code>owner</Code>/<Code>admin</Code>/<Code>member</Code>) is kept for backward compatibility —
          prefer <Code>my_permissions</Code> for gating UI.
        </p>
        <p className="text-xs text-text-muted mt-2">
          Only platform admins can toggle <Code>is_public</Code>, via <Code>{'PATCH /servers/{id}/'}</Code>{' '}
          with <Code>{'{ is_public: true }'}</Code> (<Code>403</Code> otherwise). Also accepted on{' '}
          <Code>POST /servers/</Code> (ignored for non-admins).
        </p>
      </Section>

      <Section title="Public Servers: Discover, Join, Leave">
        <MethodPath method="GET" path="/servers/discover/" />
        <p className="text-xs text-text-muted mb-2">Any authenticated user.</p>
        <Pre>{`{
  "results": [
    {
      "id": 3,
      "name": "Community Hub",
      "slug": "community-hub",
      "description": "Talk about everything 999",
      "icon_url": "https://...",
      "member_count": 128,
      "is_member": false,
      "created_at": "2026-09-17T20:00:00Z"
    }
  ]
}`}</Pre>
        <p className="text-xs text-text-muted">Use <Code>is_member</Code> to decide whether to show a Join or an Open button.</p>
        <MethodPath method="POST" path="/servers/{id}/join/" className="mt-3" />
        <p className="text-xs text-text-muted mb-2">
          Any authenticated user for public servers; staff for private. Returns the full server object (
          <Code>201</Code>). <Code>409</Code> if already a member. <Code>403</Code> if the server is not
          public and you are not staff.
        </p>
        <MethodPath method="DELETE" path="/servers/{id}/join/" />
        <p className="text-xs text-text-muted">
          Leave a server. <Code>204</Code> on success. <Code>400</Code> if you are the owner (owners cannot
          leave). <Code>404</Code> if not a member.
        </p>
      </Section>

      <Section title="Roles">
        <p className="text-sm text-text-secondary">
          Each server has named roles with colors, an ordered hierarchy, and a permission bitmask. Channels
          can override permissions per role or per member, exactly like Discord.
        </p>
        <p className="text-xs text-text-muted font-semibold mt-3">Permission bitmask — fetch the canonical map:</p>
        <MethodPath method="GET" path="/permissions/" className="mt-2" />
        <Pre>{`{
  "permissions": {
    "view_channels": 1,
    "send_messages": 2,
    "manage_messages": 4,
    "manage_channels": 8,
    "manage_server": 16,
    "manage_roles": 32,
    "kick_members": 64,
    "ban_members": 128,
    "mention_everyone": 256,
    "attach_files": 512,
    "add_reactions": 1024,
    "manage_threads": 2048,
    "administrator": 4096
  }
}`}</Pre>
        <p className="text-xs text-text-muted">
          <Code>administrator</Code> (4096) grants every permission and bypasses channel overrides. Check
          client-side with <Code>{'(perms & bit) !== 0'}</Code>.
        </p>
        <p className="text-xs text-text-muted font-semibold mt-3">Role shape:</p>
        <Pre>{`{
  "id": 12,
  "server": 3,
  "name": "Moderator",
  "color": "#FF5733",
  "position": 50,
  "permissions": 1543,
  "permission_names": ["view_channels", "send_messages", "manage_messages", "attach_files", "add_reactions"],
  "is_default": false,
  "created_at": "2026-09-17T20:10:00Z"
}`}</Pre>
        <p className="text-xs text-text-muted">
          <Code>position</Code>: higher = more authority. The default <Code>@everyone</Code> role is{' '}
          <Code>position 0</Code>. <Code>is_default</Code>: the <Code>@everyone</Code> role, cannot be
          renamed, repositioned, or deleted — every member implicitly has it. <Code>permission_names</Code>{' '}
          is a read-only convenience list derived from the bitmask.
        </p>
        <p className="text-xs text-text-muted">
          Every server is created with two roles: <Code>@everyone</Code> (basic view/send/react/attach) and{' '}
          <Code>Admin</Code> (administrator). The creator gets the <Code>Admin</Code> role.
        </p>
        <MethodPath method="GET" path="/servers/{id}/roles/" className="mt-3" />
        <p className="text-xs text-text-muted mb-2">Any member. → <Code>{'{ results: [role, ...] }'}</Code>, ordered by position desc.</p>
        <MethodPath method="POST" path="/servers/{id}/roles/" />
        <p className="text-xs text-text-muted mb-2">Requires <Code>manage_roles</Code>.</p>
        <Pre>{`{
  "name": "Moderator",
  "color": "#FF5733",
  "position": 50,
  "permissions": 1607
}`}</Pre>
        <p className="text-xs text-text-muted">
          You cannot create a role at or above your own highest role position (unless owner or platform
          admin) — the position is clamped below yours. <Code>201</Code> with the role object. <Code>409</Code>{' '}
          if the name is taken.
        </p>
        <MethodPath method="PATCH" path="/servers/{id}/roles/{role_id}/" className="mt-3" />
        <p className="text-xs text-text-muted mb-2">Requires <Code>manage_roles</Code>. All fields optional.</p>
        <Pre>{`{ "name": "Senior Mod", "color": "#00AAFF", "permissions": 1671, "position": 60 }`}</Pre>
        <p className="text-xs text-text-muted">
          The <Code>@everyone</Code> role rejects <Code>name</Code>/<Code>position</Code> changes
          (permissions/color still editable). You cannot edit a role at or above your highest role.{' '}
          <Code>position</Code> is clamped below your highest role.
        </p>
        <MethodPath method="DELETE" path="/servers/{id}/roles/{role_id}/" className="mt-3" />
        <p className="text-xs text-text-muted">
          Requires <Code>manage_roles</Code>. <Code>204</Code>. <Code>400</Code> for the <Code>@everyone</Code>{' '}
          role. <Code>403</Code> for a role at or above your highest role.
        </p>
        <p className="text-xs text-text-muted font-semibold mt-4">Assign roles to a member:</p>
        <MethodPath method="PUT" path="/servers/{id}/members/{user_id}/roles/" />
        <p className="text-xs text-text-muted mb-2">Requires <Code>manage_roles</Code>.</p>
        <Pre>{`{ "role_ids": [12, 15] }`}</Pre>
        <p className="text-xs text-text-muted">
          Replaces the member&apos;s role set (<Code>@everyone</Code> is always implicit, cannot be assigned/
          removed). You cannot assign a role at or above your own highest role. Returns the updated member
          object:
        </p>
        <Pre>{`{
  "id": 44,
  "user": { "id": 1450, "username": "saint", "display_name": "saint", "avatar": "...", "role": "editor" },
  "server_role": "member",
  "roles": [
    { "id": 12, "name": "Moderator", "color": "#FF5733", "position": 50 }
  ],
  "muted": false,
  "timeout_until": null,
  "joined_at": "2026-09-17T20:00:00Z"
}`}</Pre>
        <p className="text-xs text-text-muted">
          <Code>timeout_until</Code> is an ISO-8601 datetime while the member is timed out and{' '}
          <Code>null</Code> otherwise. Once it passes, posting is allowed again on its own — no call is
          needed to clear it. See Moderation below.
        </p>
        <p className="text-xs text-text-muted"><Code>{'GET /servers/{id}/members/'}</Code> now includes each member&apos;s <Code>roles</Code> array too.</p>
      </Section>

      <Section title="Channel Permission Overrides">
        <p className="text-sm text-text-secondary">
          Overrides let a channel grant or revoke specific permissions for a role or a single member. This
          replaces the old <Code>is_private</Code>/<Code>allowed_members</Code> mechanism as the source of
          truth for channel access.
        </p>
        <p className="text-xs text-text-muted font-semibold mt-3">Override shape:</p>
        <Pre>{`{
  "id": 7,
  "channel": 2,
  "role": 12,
  "member": null,
  "allow": 1,
  "deny": 0
}`}</Pre>
        <p className="text-xs text-text-muted">
          Exactly one of <Code>role</Code> or <Code>member</Code> is set. <Code>member</Code> is the{' '}
          <span className="font-semibold text-text-primary">ServerMember id</span> (the <Code>id</Code> field
          from the members list), not the user id.
        </p>
        <MethodPath method="GET" path="/channels/{id}/overrides/" className="mt-3" />
        <p className="text-xs text-text-muted mb-2">Any member who can view the channel. → <Code>{'{ results: [override, ...] }'}</Code></p>
        <MethodPath method="PUT" path="/channels/{id}/overrides/" />
        <p className="text-xs text-text-muted mb-2">Requires <Code>manage_channels</Code>. Upserts (one override per role, one per member, per channel).</p>
        <p className="text-xs text-text-muted font-semibold mt-2">For a role:</p>
        <Pre>{`{ "role": 12, "allow": 8, "deny": 0 }`}</Pre>
        <p className="text-xs text-text-muted font-semibold mt-2">For a member:</p>
        <Pre>{`{ "member": 44, "allow": 0, "deny": 2 }`}</Pre>
        <p className="text-xs text-text-muted">Provide exactly one of <Code>role</Code>/<Code>member</Code> or you get <Code>400</Code>.</p>
        <MethodPath method="DELETE" path="/channels/{id}/overrides/{override_id}/" className="mt-3" />
        <p className="text-xs text-text-muted">Requires <Code>manage_channels</Code>. <Code>204</Code>.</p>
      </Section>

      <Section title="Permission Resolution">
        <p className="text-sm text-text-secondary">
          Mirror this client-side to pre-disable UI. The server is authoritative.
        </p>
        <Pre>{`1. If user is the server owner or a platform admin -> ALL permissions.
2. base = @everyone.permissions
3. base |= each of the member's assigned role permissions
4. If base has administrator -> ALL permissions.
5. If evaluating a channel:
   a. perms = base
   b. Apply @everyone channel override:  perms = (perms & ~deny) | allow
   c. Apply combined role overrides:      perms = (perms & ~deny) | allow
   d. Apply member channel override:      perms = (perms & ~deny) | allow
6. If perms has administrator -> ALL permissions.`}</Pre>
        <p className="text-xs text-text-muted">
          Member overrides beat role overrides; role overrides beat the base. <Code>my_permissions</Code> on
          the server object is the result of steps 1-4 (server-level, no channel).
        </p>
      </Section>

      <Section title="Moderation">
        <p className="text-sm text-text-secondary leading-relaxed">
          Four server-level actions — mute, timeout, kick, ban — plus a site-wide tier for platform
          administrators. Enforcement is server-side: a restricted user is rejected at send time, so the
          client only needs to mirror the state to pre-disable its UI.
        </p>
        <Table
          headers={['Action', 'Scope', 'Endpoint', 'Permission']}
          rows={[
            ['Mute', 'Server', 'PATCH /servers/{id}/members/{user_id}/', <Code>manage_server</Code>],
            ['Timeout', 'Server', 'POST / DELETE /servers/{id}/members/{user_id}/timeout/', <Code>kick_members</Code>],
            ['Kick', 'Server', 'DELETE /servers/{id}/members/{user_id}/', <Code>kick_members</Code>],
            ['Ban', 'Server', 'POST / DELETE /servers/{id}/bans/', <Code>ban_members</Code>],
            ['Ban / mute / timeout', 'Site-wide', 'POST / DELETE /site-moderation/', 'Platform admin'],
          ]}
        />
        <p className="text-xs text-text-muted mt-2">
          <Code>manage_server</Code> (16) is accepted in place of <Code>kick_members</Code> (64) or{' '}
          <Code>ban_members</Code> (128) everywhere above. Server owners and platform administrators always
          pass. Mute is the exception: it needs <Code>manage_server</Code> specifically.
        </p>

        <p className="text-xs text-text-muted font-semibold mt-4">Mute — indefinite, server-scoped</p>
        <MethodPath method="PATCH" path="/servers/{id}/members/{user_id}/" />
        <Pre>{`{ "muted": true }`}</Pre>
        <p className="text-xs text-text-muted">
          They stay a member and keep reading; they just can&apos;t post in any channel on that server.
          Broadcasts <Code>member.updated</Code>. The owner cannot be muted.
        </p>

        <p className="text-xs text-text-muted font-semibold mt-4">Timeout — a mute with an expiry</p>
        <MethodPath method="POST" path="/servers/{id}/members/{user_id}/timeout/" />
        <Pre>{`{ "duration": 60 }`}</Pre>
        <p className="text-xs text-text-muted">
          <Code>duration</Code> is required, in <span className="font-semibold text-text-primary">minutes</span>,
          1–40320 (28 days). Sets <Code>timeout_until</Code> on the member and broadcasts{' '}
          <Code>member.timeout</Code>. The owner cannot be timed out.
        </p>
        <MethodPath method="DELETE" path="/servers/{id}/members/{user_id}/timeout/" className="mt-2" />
        <p className="text-xs text-text-muted">
          Clears it early. Broadcasts <Code>member.updated</Code> with <Code>timeout_until: null</Code>.
          Letting it lapse instead needs no call at all.
        </p>

        <p className="text-xs text-text-muted font-semibold mt-4">Kick — removal without a ban</p>
        <MethodPath method="DELETE" path="/servers/{id}/members/{user_id}/" />
        <p className="text-xs text-text-muted">
          Broadcasts <Code>member.left</Code>. A kicked user can rejoin immediately if the server is public
          (or be re-added by a moderator) — ban them instead to keep them out. Self-removal is always
          allowed; the owner can never be removed.
        </p>

        <p className="text-xs text-text-muted font-semibold mt-4">Ban — removal that survives a rejoin</p>
        <MethodPath method="GET" path="/servers/{id}/bans/" />
        <p className="text-xs text-text-muted mb-2">→ <Code>{'{ results: [ban, ...] }'}</Code></p>
        <Pre>{`{
  "id": 7,
  "server": 3,
  "user": { "id": 15, "username": "jdoe", "display_name": "J Doe", "avatar": "", "role": "editor" },
  "reason": "Spam",
  "banned_by": { "id": 12, "username": "admin", "display_name": "Admin", "avatar": "", "role": "administrator" },
  "created_at": "2026-09-10T17:00:00Z"
}`}</Pre>
        <MethodPath method="POST" path="/servers/{id}/bans/" className="mt-2" />
        <Pre>{`{ "user_id": 15, "reason": "Spam" }`}</Pre>
        <p className="text-xs text-text-muted">
          Creates or updates the ban record, removes the user from the server if they were a member, and
          broadcasts <Code>member.left</Code> followed by <Code>member.banned</Code>. A banned user who tries
          to join gets <Code>403 &quot;You are banned from this server.&quot;</Code> The server owner and
          platform administrators cannot be banned.
        </p>
        <MethodPath method="DELETE" path="/servers/{id}/bans/{user_id}/" className="mt-2" />
        <p className="text-xs text-text-muted">
          Broadcasts <Code>member.unbanned</Code>; they can rejoin afterwards. <Code>404</Code> if that user
          isn&apos;t banned.
        </p>
      </Section>

      <Section title="Site-wide Moderation" defaultOpen={false}>
        <p className="text-sm text-text-secondary leading-relaxed">
          Platform administrators only (<Code>UserProfile.is_administrator</Code> or a Django superuser).
          These apply across every chat server <span className="font-semibold text-text-primary">and</span>{' '}
          DMs, independent of any server&apos;s own roles. Non-admins get{' '}
          <Code>403 &quot;Administrator access required.&quot;</Code>
        </p>
        <MethodPath method="GET" path="/site-moderation/?active=true" className="mt-3" />
        <p className="text-xs text-text-muted mb-2">
          Without <Code>active=true</Code> you get every record, including revoked and expired ones.
        </p>
        <Pre>{`{
  "results": [
    {
      "id": 1,
      "user": { "id": 15, "username": "jdoe", "display_name": "J Doe", "avatar": "", "role": "editor" },
      "action": "ban",
      "reason": "Repeated harassment",
      "moderator": { "id": 12, "username": "admin", "display_name": "Admin", "avatar": "", "role": "administrator" },
      "expires_at": null,
      "is_active": true,
      "created_at": "2026-09-10T17:00:00Z"
    }
  ]
}`}</Pre>
        <MethodPath method="POST" path="/site-moderation/" className="mt-3" />
        <Pre>{`{
  "user_id": 15,
  "action": "ban",
  "reason": "Repeated harassment",
  "duration": 1440
}`}</Pre>
        <Table
          headers={['Field', 'Required', 'Notes']}
          rows={[
            [<Code>user_id</Code>, 'yes', 'Target user'],
            [<Code>action</Code>, 'yes', 'ban, mute, or timeout'],
            [<Code>reason</Code>, 'no', 'Max 500 characters'],
            [<Code>duration</Code>, 'no', 'Minutes, max 525600 (1 year). Omit for "until revoked"'],
          ]}
        />
        <p className="text-xs text-text-muted mt-2">
          A new action of the same type for the same user deactivates the previous one. Platform
          administrators cannot be moderated.
        </p>
        <MethodPath method="DELETE" path="/site-moderation/{id}/" className="mt-3" />
        <p className="text-xs text-text-muted">Sets <Code>is_active: false</Code>. <Code>204</Code>.</p>
        <p className="text-xs text-text-muted font-semibold mt-4">What each action does</p>
        <Table
          headers={['Action', 'Blocks posting', 'Blocks chat access', 'Blocks DMs', 'Auto-expires']}
          rows={[
            [<Code>ban</Code>, 'yes', 'yes', 'yes', 'only with duration'],
            [<Code>mute</Code>, 'yes', 'no (can still read)', 'yes', 'only with duration'],
            [<Code>timeout</Code>, 'yes', 'no (can still read)', 'yes', 'only with duration'],
          ]}
        />
        <p className="text-xs text-text-muted mt-2">
          Site-banned users lose chat access entirely (<Code>has_chat_access</Code> returns false) and should
          be dropped from server views on the next <Code>resync</Code>.
        </p>
      </Section>

      <Section title="Moderation Enforcement" defaultOpen={false}>
        <p className="text-sm text-text-secondary">
          What the API refuses, and with which message. There is no endpoint that reports your own
          restrictions, so a client can pre-disable its composer from the member fields it can already see
          (<Code>muted</Code>, <Code>timeout_until</Code>) and must treat the site-wide cases as a{' '}
          <Code>403</Code> on send.
        </p>
        <p className="text-xs text-text-muted font-semibold mt-3">Posting in a channel — blocked when any of:</p>
        <Pre>{`1. An active site-wide ban, mute, or timeout on the user
2. ServerMember.muted is true
3. ServerMember.timeout_until is in the future
4. The user lacks send_messages on that channel

-> 403 { "detail": "You cannot post in this channel." }`}</Pre>
        <p className="text-xs text-text-muted font-semibold mt-3">Posting in a DM</p>
        <Pre>{`Active site-wide ban / mute / timeout
-> 403 { "detail": "You are restricted from sending messages." }`}</Pre>
        <p className="text-xs text-text-muted font-semibold mt-3">Joining a server</p>
        <Pre>{`Active site-wide ban, or a ServerBan for that server
-> 403 { "detail": "You are banned from this server." }`}</Pre>
        <p className="text-xs text-text-muted">
          Platform administrators bypass member-level mute/timeout checks when posting, and cannot be banned.
        </p>
        <p className="text-xs text-text-muted font-semibold mt-3">Moderation errors</p>
        <Table
          headers={['Status', 'detail', 'Cause']}
          rows={[
            ['400', 'A duration in minutes is required.', 'Timeout POST without duration'],
            ['400', 'Duration must be between 1 and 40320 minutes.', 'Server timeout out of range'],
            ['400', 'Duration must be between 1 and 525600 minutes.', 'Site timeout out of range'],
            ['400', 'Invalid action.', 'Site moderation action not ban/mute/timeout'],
            ['400', 'The owner cannot be banned. / ...timed out. / ...removed.', 'Target is the server owner'],
            ['400', 'Administrators cannot be banned. / ...moderated.', 'Target is a platform admin'],
            ['403', 'You cannot ban members.', 'Missing ban_members and manage_server'],
            ['403', 'You cannot remove members.', 'Missing kick_members and manage_server'],
            ['404', 'Ban not found.', 'Unban on a user who is not banned'],
          ]}
        />
      </Section>

      <Section title="Channel Messages (plaintext)">
        <MethodPath method="GET" path="/channels/{id}/messages/?limit=30&before={messageId}" />
        <Table
          headers={['Param', 'Description']}
          rows={[
            [<Code>limit</Code>, 'Default 30, max 100'],
            [<Code>{'before={id}'}</Code>, 'Older messages than that id (infinite scroll up)'],
            [<Code>{'after={id}'}</Code>, 'Newer messages than that id (catch-up)'],
          ]}
        />
        <p className="text-xs text-text-muted mt-2">
          → <Code>{'{ results: [message, ...], has_more }'}</Code>, ascending by id. <Code>has_more</Code>{' '}
          means older messages exist before the first item.
        </p>
        <MethodPath method="POST" path="/channels/{id}/messages/" className="mt-3" />
        <Pre>{`{
  "content": "hello",
  "parent": null,
  "mentions": [15],
  "attachments": [ { "name": "log.txt", "url": "chat/attachments/ab12_log.txt", "mime": "text/plain", "size": 2048 } ]
}`}</Pre>
        <p className="text-xs text-text-muted">
          <Code>content</Code> or at least one attachment is required. <Code>attachments[].url</Code> is the{' '}
          <Code>url</Code> returned by the upload endpoint. <Code>mentions</Code> keeps only ids that are server
          members. <Code>parent</Code> makes it a threaded reply. Returns the created <Code>message</Code>{' '}
          (201) and broadcasts <Code>message.created</Code>.
        </p>
      </Section>

      <Section title="Direct Messages (end-to-end encrypted)">
        <p className="text-sm text-text-secondary">
          DM bodies are encrypted client-side; the server stores and relays ciphertext only. See End-to-End
          Encryption below for the full crypto flow.
        </p>
        <MethodPath method="GET" path="/dms/" className="mt-2" />
        <p className="text-xs text-text-muted mb-2">→ <Code>{'{ results: [conversation, ...] }'}</Code></p>
        <Pre>{`{
  "id": 20,
  "is_group": false,
  "name": "",
  "created_by": 12,
  "current_key_version": 1,
  "participants": [ { "id": 1, "user": user_brief, "muted": false, "joined_at": "..." } ],
  "created_at": "...", "updated_at": "..."
}`}</Pre>
        <MethodPath method="POST" path="/dms/" className="mt-3" />
        <Pre>{`{ "participant_ids": [15], "is_group": false, "name": "" }`}</Pre>
        <p className="text-xs text-text-muted">
          Your own id is added automatically; all participants must be staff. A 2-person non-group conversation
          that already exists returns <Code>200</Code> with the existing conversation instead of duplicating
          it. Groups (<Code>is_group: true</Code> or 3+ participants) may set <Code>name</Code>. Run the E2E
          envelope distribution after creating, before sending encrypted messages.
        </p>
        <Table
          headers={['Method', 'Path', 'Description']}
          rows={[
            ['GET', '/dms/{id}/', 'Conversation detail'],
            ['PATCH', '/dms/{id}/', '{ name?, add_participant_ids?, remove_participant_ids? } (participant). Removing a participant bumps current_key_version — broadcasts conversation.updated, key.rotated on rotation'],
            ['DELETE', '/dms/{id}/', 'Delete (creator or platform admin)'],
            ['GET', '/dms/{id}/messages/?limit=30&before={messageId}', 'Same pagination as channels; returns encrypted message objects'],
            ['POST', '/dms/{id}/messages/', 'Create an encrypted message (below)'],
          ]}
        />
        <p className="text-xs text-text-muted font-semibold mt-3"><Code>{'POST /dms/{id}/messages/'}</Code>:</p>
        <Pre>{`{
  "ciphertext": "base64...", "nonce": "base64...", "key_version": 1,
  "parent": null,
  "mentions": [15],
  "attachments": [
    { "name": "blob.bin", "url": "chat/attachments/xx_blob.bin", "mime": "application/octet-stream",
      "size": 1024, "encrypted_name": "base64...", "nonce": "base64...", "key_version": 1 }
  ]
}`}</Pre>
        <p className="text-xs text-text-muted">
          <Code>ciphertext</Code> (with <Code>nonce</Code>/<Code>key_version</Code>) or at least one attachment
          is required. Attachments must be encrypted client-side before upload, each with its own{' '}
          <Code>nonce</Code>/<Code>key_version</Code> and optional <Code>encrypted_name</Code>.
        </p>
      </Section>

      <Section title="Message Actions (channels and DMs)">
        <Table
          headers={['Method', 'Path', 'Description']}
          rows={[
            ['GET', '/messages/{id}/', 'Fetch a message'],
            ['PATCH', '/messages/{id}/', 'Author only. Plaintext: { content }. Encrypted: { ciphertext, nonce, key_version }. Sets edited_at, broadcasts message.updated'],
            ['DELETE', '/messages/{id}/', 'Soft delete (author, server owner/admin, or platform admin); broadcasts message.deleted'],
            ['POST / DELETE', '/messages/{id}/pin/', 'Pin / unpin; broadcasts message.pinned / message.unpinned'],
            ['POST', '/messages/{id}/reactions/', '{ emoji } — add a reaction; broadcasts reaction.added'],
            ['DELETE', '/messages/{id}/reactions/', '{ emoji } or ?emoji= — remove your reaction; broadcasts reaction.removed'],
            ['GET', '/messages/{id}/thread/', 'Replies whose parent is this message'],
          ]}
        />
        <p className="text-xs text-text-muted mt-2">Create a reply by posting a normal message with <Code>parent</Code> set.</p>
      </Section>

      <Section title="Read State">
        <Table
          headers={['Method', 'Path', 'Description']}
          rows={[
            ['POST', '/channels/{id}/read/', '{ message_id } — marks the channel read up to that message; broadcasts read.receipt'],
            ['POST', '/dms/{id}/read/', 'Same, for a conversation'],
          ]}
        />
        <p className="text-xs text-text-muted mt-2">
          <Code>message_id</Code> may be omitted to clear. Combine <Code>read.receipt</Code> events with each
          message&apos;s <Code>created_at</Code>/id to render unread counts and read indicators.
        </p>
      </Section>

      <Section title="Attachments">
        <MethodPath method="POST" path="/uploads/" />
        <p className="text-xs text-text-muted mb-2">
          <Code>multipart/form-data</Code> with a <Code>file</Code> field. Max 25 MB, executable types rejected.
          For DM attachments, encrypt the file bytes client-side first and upload the encrypted blob as{' '}
          <Code>application/octet-stream</Code>.
        </p>
        <Pre>{`{ "name": "log.txt", "url": "chat/attachments/ab12_log.txt", "mime": "text/plain", "size": 2048 }`}</Pre>
        <p className="text-xs text-text-muted">
          Pass the returned <Code>url</Code> (+ <Code>name</Code>/<Code>mime</Code>/<Code>size</Code>) in a
          message&apos;s <Code>attachments</Code>. DM attachments also need <Code>encrypted_name</Code>,{' '}
          <Code>nonce</Code>, and <Code>key_version</Code>.
        </p>
        <MethodPath method="GET" path="/attachments/{attachmentId}/stream/" className="mt-3" />
        <p className="text-xs text-text-muted">
          Supports HTTP range requests. Access is checked against the message&apos;s channel/DM membership.
          Since <Code>{'<img>'}</Code>/<Code>{'<audio>'}</Code> can&apos;t send an <Code>Authorization</Code>{' '}
          header, this endpoint also accepts <Code>?token=</Code>; add <Code>?download=1</Code> to force
          download disposition. For DM attachments the bytes are ciphertext — decrypt with the conversation
          room key after fetching.
        </p>
      </Section>

      <Section title="Presence">
        <MethodPath method="GET" path="/presence/" />
        <p className="text-xs text-text-muted">
          → <Code>{'{ online: [12, 15, 16] }'}</Code> — currently connected staff user ids. Live changes arrive
          as <Code>presence.update</Code> events.
        </p>
      </Section>

      <Section title="WebSocket">
        <Pre>{`wss://YOUR_HOST/juicewrld/ws/chat/?token=YOUR_TOKEN`}</Pre>
        <p className="text-xs text-text-muted">
          Authenticates from the <Code>token</Code> query param; closes with code <Code>4401</Code> if missing/
          invalid or the user isn&apos;t staff. On connect you receive, in order:
        </p>
        <Pre>{`{ "type": "connected", "user_id": 12 }
{ "type": "presence.snapshot", "online": [12, 15] }`}</Pre>
        <p className="text-xs text-text-muted">
          The server auto-subscribes you to your servers, visible channels, and conversations, and tells your
          socket to resubscribe when membership changes.
        </p>
        <p className="text-xs text-text-muted font-semibold mt-3">Client → server</p>
        <Table
          headers={['Type', 'Payload', 'Effect']}
          rows={[
            [<Code>ping</Code>, '{}', 'Server replies { type: "pong" }'],
            [<Code>typing.start</Code>, '{ target: { kind: "channel"|"conversation", id } }', 'Broadcasts typing (active) to that room'],
            [<Code>typing.stop</Code>, 'same as above', 'Broadcasts typing (inactive)'],
            [<Code>resync</Code>, '{}', 'Re-subscribes your socket; replies { type: "resynced" }'],
          ]}
        />
        <p className="text-xs text-text-muted font-semibold mt-3">Server → client</p>
        <Table
          headers={['Type', 'Key fields']}
          rows={[
            [<Code>message.created</Code>, 'message'],
            [<Code>message.updated</Code>, 'message'],
            [<Code>message.deleted</Code>, 'message_id, channel, conversation'],
            [<Code>message.pinned</Code> + ' / ' + <Code>message.unpinned</Code>, 'message'],
            [<Code>reaction.added</Code> + ' / ' + <Code>reaction.removed</Code>, 'message_id, emoji, user_id, channel, conversation'],
            [<Code>read.receipt</Code>, 'user_id, last_read_message_id, channel or conversation'],
            [<Code>typing</Code>, 'user_id, active, kind, id'],
            [<Code>presence.update</Code>, 'user_id, online'],
            [<Code>member.joined</Code> + ' / ' + <Code>member.updated</Code> + ' / ' + <Code>member.left</Code>, 'server, member or user_id (member.updated also fires on role assignment)'],
            [<Code>member.timeout</Code>, 'server, member (member.timeout_until is now set)'],
            [<Code>member.banned</Code>, 'server, ban — fires right after the member.left for the same user'],
            [<Code>member.unbanned</Code>, 'server, user_id'],
            [<Code>resync</Code>, '(no payload) — sent to a user whose own access changed; re-fetch servers and memberships'],
            [<Code>server.updated</Code>, 'server'],
            [<Code>channel.created</Code> + ' / ' + <Code>channel.updated</Code>, 'server, channel'],
            [<Code>channel.deleted</Code>, 'server, channel_id'],
            [<Code>conversation.updated</Code>, 'conversation'],
            [<Code>key.rotated</Code>, 'conversation, key_version'],
            [<Code>device.added</Code>, 'conversation, user_id'],
            [<Code>envelope.available</Code>, 'conversation, key_version'],
            [<Code>role.created</Code> + ' / ' + <Code>role.updated</Code>, 'server, role'],
            [<Code>role.deleted</Code>, 'server, role_id'],
            [<Code>channel.override.updated</Code>, 'server, channel, override'],
            [<Code>channel.override.deleted</Code>, 'server, channel, override_id'],
          ]}
        />
        <p className="text-xs text-text-muted mt-2">
          Recommended pattern: render optimistic UI from your own REST responses, reconcile/append via these
          events for other users&apos; activity. On <Code>key.rotated</Code>, <Code>device.added</Code>, or{' '}
          <Code>envelope.available</Code>, refetch envelopes for that conversation.
        </p>
        <p className="text-xs text-text-muted">
          Override changes also trigger a <Code>resync</Code> to affected members so their channel list
          refreshes. Non-staff members of public servers can now connect to the WebSocket.
        </p>
      </Section>

      <Section title="End-to-End Encryption (DMs only)">
        <p className="text-sm text-text-secondary leading-relaxed">
          The server never sees DM plaintext — only device public keys, wrapped room keys, and ciphertext.
          Server channels are plaintext and need none of this. Recommended library: libsodium (
          <Code>libsodium-wrappers</Code>) or TweetNaCl.
        </p>
        <Table
          headers={['Primitive', 'Use']}
          rows={[
            ['X25519 key pair', 'Identity key, one per device'],
            ['Random 32-byte key', 'Room key, per conversation, versioned'],
            [<Code>crypto_box_seal</Code>, "Wrap the room key to a device's X25519 public key"],
            ['XChaCha20-Poly1305 secretbox', 'Encrypt messages/attachments with a fresh nonce per item, using the room key'],
          ]}
        />
        <p className="text-xs text-text-muted font-semibold mt-3">1. Register a device key</p>
        <Pre>{`POST /keys/devices/
{ "device_id": "uuid-per-device", "public_key": "base64 X25519 pub", "algorithm": "x25519", "label": "Chrome on Win" }`}</Pre>
        <p className="text-xs text-text-muted"><Code>GET /keys/devices/</Code> lists your devices, <Code>{'DELETE /keys/devices/{device_id}/'}</Code> revokes one.</p>

        <p className="text-xs text-text-muted font-semibold mt-3">2. Establish a room key for a DM</p>
        <p className="text-xs text-text-muted">
          Create the conversation, then <Code>{'GET /dms/{id}/keys/'}</Code> for every participant device (
          <Code>{'{ current_key_version, results: [device, ...] }'}</Code>), generate a random 32-byte room key
          for that version, and seal it to each device&apos;s public key:
        </p>
        <Pre>{`POST /dms/{id}/envelopes/
{
  "envelopes": [
    { "recipient_device": 3, "key_version": 1, "encrypted_key": "base64 sealed box" },
    { "recipient_device": 4, "key_version": 1, "encrypted_key": "base64 sealed box" }
  ]
}`}</Pre>
        <p className="text-xs text-text-muted">
          The server validates every <Code>recipient_device</Code> belongs to a participant, bumps{' '}
          <Code>current_key_version</Code> if you posted a higher version, and emits <Code>key.rotated</Code>{' '}
          and <Code>envelope.available</Code>.
        </p>

        <p className="text-xs text-text-muted font-semibold mt-3">3. Obtain your room key</p>
        <Pre>{`GET /dms/{id}/envelopes/              // all versions wrapped for your devices
GET /dms/{id}/envelopes/?key_version=1`}</Pre>
        <p className="text-xs text-text-muted">
          Each result has <Code>encrypted_key</Code>, <Code>key_version</Code>, <Code>recipient_device</Code>.
          Open the sealed box with your device secret key and cache the room key by{' '}
          <Code>(conversation_id, key_version)</Code>.
        </p>

        <p className="text-xs text-text-muted font-semibold mt-3">4-6. Send, read, attachments</p>
        <p className="text-xs text-text-muted">
          Encrypt plaintext with the current room key + a fresh nonce, post <Code>ciphertext</Code>/<Code>nonce</Code>/
          <Code>key_version</Code> to <Code>{'POST /dms/{id}/messages/'}</Code>. To read, look up the room key
          for a message&apos;s <Code>key_version</Code> (fetching envelopes if needed) and decrypt. For
          attachments: encrypt the file bytes (and optionally the filename) with the room key, upload the
          encrypted blob, include <Code>nonce</Code>/<Code>key_version</Code>/<Code>encrypted_name</Code> in the
          message, and decrypt after fetching <Code>{'GET /attachments/{id}/stream/'}</Code>.
        </p>

        <p className="text-xs text-text-muted font-semibold mt-3">7. Key rotation and new devices</p>
        <p className="text-xs text-text-muted">
          Removing a participant bumps <Code>current_key_version</Code> — a remaining participant must generate
          a fresh room key and redistribute envelopes to all current devices. A new device triggers{' '}
          <Code>device.added</Code>; distribute the current room key to it. Refetch envelopes on{' '}
          <Code>key.rotated</Code>/<Code>envelope.available</Code>. Old messages stay readable since
          prior-version envelopes and cached room keys are retained.
        </p>
      </Section>

      <Section title="Deployment Notes">
        <p className="text-sm text-text-secondary">
          The channel layer uses Redis (<Code>channels_redis</Code>) at{' '}
          <Code>redis://localhost:6379/2</Code> by default; override with <Code>CHANNEL_REDIS_URL</Code>. Set{' '}
          <Code>USE_INMEMORY_CHANNEL_LAYER=1</Code> to force the in-memory layer (single process only) — it
          also falls back automatically if <Code>channels_redis</Code> isn&apos;t installed.
        </p>
        <p className="text-xs text-text-muted mt-2">
          Run <Code>pip install -r requirements.txt</Code> and <Code>python manage.py migrate</Code> after
          deploying, and serve via the ASGI app so WebSockets work.
        </p>
        <Table
          headers={['Migration', 'What it does']}
          rows={[
            [<Code>chat.0002_server_roles_and_public</Code>, <>Adds <Code>is_public</Code>, <Code>ServerRole</Code>, <Code>ChannelPermissionOverride</Code>, member <Code>roles</Code> M2M</>],
            [<Code>chat.0003_backfill_default_roles</Code>, <>Creates <Code>@everyone</Code> + <Code>Admin</Code> roles for existing servers and assigns <Code>Admin</Code> to existing owners/admins</>],
          ]}
        />
      </Section>
    </div>
  )
}

export const TABS = [
  { id: 'overview',  label: 'Overview' },
  { id: 'songs',     label: 'Songs & Search' },
  { id: 'versions',  label: 'Versions' },
  { id: 'files',     label: 'Files & Stream' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'radio',     label: '999 FM' },
  { id: 'heardle',   label: 'Heardle' },
  { id: 'accounts',  label: 'Accounts' },
  { id: 'chat',      label: 'Staff Chat' },
  { id: 'editor',    label: 'Editor Workflow' },
  { id: 'admin',     label: 'Admin' },
  { id: 'feedback',  label: 'Feedback & Reports' },
  { id: 'news',      label: 'News' },
  { id: 'feeds',     label: 'Feeds & Media' },
  { id: 'patterns',  label: 'Code Patterns' },
] as const

export type TabId = typeof TABS[number]['id']

const TAB_CONTENT: Record<TabId, () => JSX.Element> = {
  overview:  OverviewTab,
  songs:     SongsTab,
  versions:  VersionsTab,
  files:     FilesTab,
  playlists: PlaylistsTab,
  radio:     RadioTab,
  heardle:   HeardleTab,
  accounts:  AccountsTab,
  chat:      ChatTab,
  editor:    EditorWorkflowTab,
  admin:     AdminTab,
  feedback:  FeedbackTab,
  news:      NewsTab,
  feeds:     FeedsMediaTab,
  patterns:  FetchPatternTab,
}

// One tab's worth of content. Kept mounted even when hidden so its Sections
// stay registered with the search index. `hidden` (not unmounting) is what
// makes cross-tab search possible without duplicating the content as data.
export function TabPanel({ tab, query, register, visible, showLabel }: {
  tab: typeof TABS[number]
  query: string
  register: DocsSearchValue['register']
  visible: boolean
  showLabel: boolean
}): JSX.Element {
  const ctx = useMemo(() => ({ query, tab: tab.id, register }), [query, tab.id, register])
  const Content = TAB_CONTENT[tab.id]
  return (
    <div id={`docs-panel-${tab.id}`} hidden={!visible}>
      <DocsSearchContext.Provider value={ctx}>
        {showLabel && (
          <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-3 mt-2">{tab.label}</p>
        )}
        <Content />
      </DocsSearchContext.Provider>
    </div>
  )
}
