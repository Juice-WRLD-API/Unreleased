package com.juicewrldapi.player;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Local music library for the Android wrap — the counterpart to the desktop
 * build's filesystem scanner.
 *
 * Android gives an app no general filesystem access, so everything here goes
 * through the Storage Access Framework: the user picks a folder (or individual
 * files) in the system picker, and we take a *persistable* URI permission on
 * the result so the grant survives app restarts and reboots. Every track is
 * therefore identified by a `content://` URI rather than a path — including in
 * its store id, which is why ids look like `local-content://…` here.
 *
 * Three things worth knowing before changing this:
 *
 *  - Tags are read with MediaMetadataRetriever (the platform's own extractor,
 *    so it covers everything the WebView can play) rather than a JS parser.
 *    It costs roughly 5–20 ms per file, which is why {@link #scan} takes the
 *    previous scan's tracks and skips any file whose size and mtime are
 *    unchanged. A rescan of an untouched library does almost no work.
 *  - Album art is NOT returned by the scan. Embedded pictures are frequently
 *    a megabyte each; returning them for a few thousand files would blow up
 *    both the bridge payload and the JS heap. The UI asks for art per visible
 *    row via {@link #getArt}, which also downsamples before encoding.
 *  - Playback doesn't come through this plugin at all. The WebView can't load
 *    a content:// URI directly, so the renderer runs the URI through
 *    Capacitor.convertFileSrc() and Capacitor's local server streams it —
 *    range requests included, which is what makes seeking work.
 */
@CapacitorPlugin(name = "LocalLibrary")
public class LocalLibraryPlugin extends Plugin {

    /** Extensions accepted when a provider reports a useless MIME type. */
    private static final Set<String> AUDIO_EXTS = new HashSet<>(Arrays.asList(
            "mp3", "flac", "wav", "m4a", "ogg", "aac", "opus", "wma", "alac", "caf", "aiff", "aif"
    ));

    /** Longest side, in px, that {@link #getArt} will return. */
    private static final int ART_MAX_PX = 600;

    /** Files between `scanProgress` events — see emitProgress. */
    private static final int PROGRESS_EVERY = 25;

    private static final String LIBRARY_FILE = "library.json";
    private static final String PLAYLISTS_FILE = "local-playlists.json";

    // ── Source picking ───────────────────────────────────────────────────────

    /** Requests read/write access and persists whichever permissions the provider grants. */
    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            ret.put("canceled", true);
            call.resolve(ret);
            return;
        }
        Uri tree = data.getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(
                    tree, data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
        } catch (SecurityException e) {
            // Some providers hand back a non-persistable grant. The folder still
            // works this session; it just won't survive a restart.
        }
        ret.put("uri", tree.toString());
        ret.put("name", treeLabel(tree));
        call.resolve(ret);
    }

    /** Opens the system file picker (multi-select) for individual audio files. */
    @PluginMethod
    public void pickFiles(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "audio/*", "application/ogg" });
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "filesPicked");
    }

    @ActivityCallback
    private void filesPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null) {
            ret.put("canceled", true);
            call.resolve(ret);
            return;
        }

        List<Uri> picked = new ArrayList<>();
        if (data.getClipData() != null) {
            for (int i = 0; i < data.getClipData().getItemCount(); i++) {
                picked.add(data.getClipData().getItemAt(i).getUri());
            }
        } else if (data.getData() != null) {
            picked.add(data.getData());
        }

        JSArray uris = new JSArray();
        for (Uri uri : picked) {
            try {
                getContext().getContentResolver().takePersistableUriPermission(
                        uri, data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
            } catch (SecurityException ignored) { }
            uris.put(uri.toString());
        }
        ret.put("uris", uris);
        call.resolve(ret);
    }

    /**
     * Opens the system file picker for a single arbitrary file and reads it
     * back as text — used for importing an .m3u/.m3u8 playlist. Unlike
     * pickFiles above, this is a one-off read: no persisted grant, since the
     * text comes back to JS immediately and the plugin never touches the URI
     * again.
     */
    @PluginMethod
    public void pickTextFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        // Providers are as unreliable about .m3u/.m3u8 mime types as they are
        // about audio ones (see isAudio's comment below) — most report
        // application/octet-stream or don't recognise the extension at all,
        // so filtering by mime type would hide the exact file a user is
        // trying to pick. "*/*" leaves the choice to them.
        intent.setType("*/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call, intent, "textFilePicked");
    }

    @ActivityCallback
    private void textFilePicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            ret.put("canceled", true);
            call.resolve(ret);
            return;
        }
        Uri uri = data.getData();
        try {
            String[] meta = queryDocumentMeta(uri);
            String name = meta != null && meta[0] != null ? meta[0] : fallbackName(uri);
            long size = meta != null ? Long.parseLong(meta[1]) : 0;
            ret.put("name", name);
            ret.put("text", readText(uri, size));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "Could not read the file" : e.getMessage(), e);
        }
    }

    private String fallbackName(Uri uri) {
        String tail = uri.getLastPathSegment();
        return tail == null ? "file.txt" : tail;
    }

    /** Reads a document's full contents as UTF-8 text. `sizeHint` (from
     *  queryDocumentMeta, 0 if unknown) sizes the buffer up front so a normal
     *  playlist file doesn't grow it via repeated doubling. */
    private String readText(Uri uri, long sizeHint) throws Exception {
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) throw new Exception("Could not open the file for reading");
            ByteArrayOutputStream buf = new ByteArrayOutputStream(
                    sizeHint > 0 && sizeHint < Integer.MAX_VALUE ? (int) sizeHint : 8192);
            byte[] chunk = new byte[8192];
            int read;
            while ((read = in.read(chunk)) != -1) buf.write(chunk, 0, read);
            return new String(buf.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    /**
     * Drops our persisted grant on a source. Best-effort: a grant that was
     * never persistable (or has already been revoked) throws, and the caller
     * only cares that the source is gone from its list either way.
     */
    @PluginMethod
    public void releaseSource(PluginCall call) {
        String uri = call.getString("uri");
        if (uri != null) {
            try {
                getContext().getContentResolver().releasePersistableUriPermission(
                        Uri.parse(uri), Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (SecurityException ignored) { }
        }
        call.resolve();
    }

    /** Human-readable label for a source, for the folder list in Settings. */
    @PluginMethod
    public void sourceLabel(PluginCall call) {
        String uri = call.getString("uri");
        JSObject ret = new JSObject();
        ret.put("value", uri == null ? "" : treeLabel(Uri.parse(uri)));
        call.resolve(ret);
    }

    // ── Scanning ─────────────────────────────────────────────────────────────

    /**
     * Walks every source and returns the full track list.
     *
     * `sources` mixes folder trees and single files — a tree URI is enumerated
     * recursively, anything else is treated as one document. `known` carries
     * only the id/size/mtime of the previous scan's tracks; a file matching on
     * all three comes back as a bare `{id, unchanged: true}` stub that the JS
     * side swaps for the metadata it already holds. That keeps a rescan from
     * both re-reading tags and re-sending every tag across the bridge.
     *
     * Emits `scanProgress` ({found, parsed}) while it runs.
     */
    @PluginMethod
    public void scan(PluginCall call) {
        final JSArray sourcesArg = call.getArray("sources");
        final JSArray knownArg = call.getArray("known");
        if (sourcesArg == null) { call.reject("sources is required"); return; }

        new Thread(() -> {
            try {
                List<String> sources = toStringList(sourcesArg);
                Map<String, JSONObject> known = indexKnown(knownArg);

                List<JSONObject> out = new ArrayList<>();
                Set<String> seen = new HashSet<>();
                int[] counters = new int[] { 0, 0 }; // found, parsed

                for (String source : sources) {
                    Uri uri = Uri.parse(source);
                    if (isTreeUri(uri)) walkTree(uri, known, out, seen, counters);
                    else collectDocument(uri, null, 0, 0, known, out, seen, counters);
                }

                JSONArray tracks = new JSONArray();
                for (JSONObject t : out) tracks.put(t);

                JSObject ret = new JSObject();
                ret.put("tracks", tracks);
                // One last event so the UI's counters land on the true totals —
                // the per-file emitter is throttled and will usually have
                // skipped the final few.
                emitProgress(counters, true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Scan failed" : e.getMessage(), e);
            }
        }).start();
    }

    /** Breadth-first walk of a document tree, collecting audio files. */
    private void walkTree(Uri tree, Map<String, JSONObject> known, List<JSONObject> out,
                          Set<String> seen, int[] counters) {
        ContentResolver cr = getContext().getContentResolver();
        Deque<String> queue = new ArrayDeque<>();
        try {
            queue.add(DocumentsContract.getTreeDocumentId(tree));
        } catch (Exception e) {
            return; // Not actually a tree URI — nothing to walk.
        }

        // Guards against a provider that reports a cyclic tree (symlinked
        // storage does this): without it the walk never terminates.
        Set<String> visitedDirs = new HashSet<>();

        String[] projection = {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_SIZE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED,
        };

        while (!queue.isEmpty()) {
            String parentId = queue.poll();
            if (parentId == null || !visitedDirs.add(parentId)) continue;

            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId);
            try (Cursor c = cr.query(children, projection, null, null, null)) {
                if (c == null) continue;
                while (c.moveToNext()) {
                    String docId = c.getString(0);
                    String name = c.getString(1);
                    String mime = c.getString(2);
                    long size = c.isNull(3) ? 0 : c.getLong(3);
                    long modified = c.isNull(4) ? 0 : c.getLong(4);

                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                        queue.add(docId);
                        continue;
                    }
                    if (!isAudio(name, mime)) continue;

                    Uri fileUri = DocumentsContract.buildDocumentUriUsingTree(tree, docId);
                    collectDocument(fileUri, name, size, modified, known, out, seen, counters);
                }
            } catch (Exception ignored) {
                // A single unreadable folder shouldn't abort the whole scan.
            }
        }
    }

    /**
     * Adds one audio document to `out`, reusing the previous scan's metadata
     * when size and mtime are unchanged. `name`/`size`/`modified` may be null/0
     * for a directly-picked file, in which case they're queried here.
     */
    private void collectDocument(Uri uri, String name, long size, long modified,
                                 Map<String, JSONObject> known, List<JSONObject> out,
                                 Set<String> seen, int[] counters) {
        String id = "local-" + uri.toString();
        if (!seen.add(id)) return; // Same file reachable from two sources.

        if (name == null) {
            String[] meta = queryDocumentMeta(uri);
            if (meta == null) return;
            name = meta[0];
            size = Long.parseLong(meta[1]);
            modified = Long.parseLong(meta[2]);
            if (!isAudio(name, meta[3])) return;
        }

        counters[0]++;

        JSONObject prev = known.get(id);
        if (prev != null
                && prev.optLong("fileSize", -1) == size
                && prev.optLong("lastModified", -1) == modified) {
            // Unchanged: send back a stub, not `prev` — `known` only carries
            // the three comparison fields, so returning it would blank out the
            // track's title, artist and everything else.
            try {
                JSONObject stub = new JSONObject();
                stub.put("id", id);
                stub.put("unchanged", true);
                out.add(stub);
            } catch (JSONException ignored) { }
            emitProgress(counters, false);
            return;
        }

        JSONObject track = readTags(uri, name, size, modified);
        if (track != null) {
            out.add(track);
            counters[1]++;
        }
        emitProgress(counters, false);
    }

    /** Pulls tags off one file. Returns null if the extractor can't open it. */
    private JSONObject readTags(Uri uri, String name, long size, long modified) {
        MediaMetadataRetriever mmr = new MediaMetadataRetriever();
        try {
            mmr.setDataSource(getContext(), uri);

            String title = meta(mmr, MediaMetadataRetriever.METADATA_KEY_TITLE);
            String artist = meta(mmr, MediaMetadataRetriever.METADATA_KEY_ARTIST);
            String album = meta(mmr, MediaMetadataRetriever.METADATA_KEY_ALBUM);
            String albumArtist = meta(mmr, MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST);
            String composer = meta(mmr, MediaMetadataRetriever.METADATA_KEY_COMPOSER);
            String genre = meta(mmr, MediaMetadataRetriever.METADATA_KEY_GENRE);
            String durationMs = meta(mmr, MediaMetadataRetriever.METADATA_KEY_DURATION);
            String bitrate = meta(mmr, MediaMetadataRetriever.METADATA_KEY_BITRATE);
            boolean hasArt = mmr.getEmbeddedPicture() != null;

            JSONObject t = new JSONObject();
            t.put("id", "local-" + uri.toString());
            t.put("filePath", uri.toString());
            t.put("ext", extOf(name));
            // Fall back to the filename (sans extension) so an untagged file is
            // still identifiable in the list rather than showing up blank.
            t.put("title", isBlank(title) ? stripExt(name) : title);
            t.put("artist", isBlank(artist) ? "" : artist);
            t.put("album", isBlank(album) ? "" : album);
            t.put("albumArtist", isBlank(albumArtist) ? (isBlank(artist) ? "" : artist) : albumArtist);
            t.put("year", parseYear(meta(mmr, MediaMetadataRetriever.METADATA_KEY_YEAR),
                    meta(mmr, MediaMetadataRetriever.METADATA_KEY_DATE)));
            t.put("trackNumber", parseLeadingInt(
                    meta(mmr, MediaMetadataRetriever.METADATA_KEY_CD_TRACK_NUMBER)));
            t.put("discNumber", parseLeadingInt(
                    meta(mmr, MediaMetadataRetriever.METADATA_KEY_DISC_NUMBER)));
            t.put("composer", isBlank(composer) ? "" : composer);
            t.put("genre", isBlank(genre) ? "" : genre);
            // The renderer works in seconds everywhere; the extractor reports ms.
            t.put("duration", durationMs == null ? 0 : Long.parseLong(durationMs) / 1000.0);
            t.put("bitrate", bitrate == null ? JSONObject.NULL : Integer.parseInt(bitrate));
            t.put("sampleRate", JSONObject.NULL); // Not exposed before API 31.
            t.put("fileSize", size);
            t.put("lastModified", modified);
            t.put("hasAlbumArt", hasArt);
            t.put("addedAt", System.currentTimeMillis());
            return t;
        } catch (Exception e) {
            return null;
        } finally {
            // release() is declared to throw on newer API levels and not on
            // older ones; catching Exception compiles against both.
            try { mmr.release(); } catch (Exception ignored) { }
        }
    }

    /**
     * Throttled progress. An event per file would be thousands of bridge
     * crossings and re-renders on a real library, so this only reports every
     * {@link #PROGRESS_EVERY} files unless `force` says otherwise — except the
     * very first file, which always reports immediately. Without that a
     * library smaller than PROGRESS_EVERY (very plausible while testing, or
     * just a small collection) would never see an incremental update at all,
     * only the final one once the whole scan is already done.
     */
    private void emitProgress(int[] counters, boolean force) {
        if (!force && counters[0] != 1 && counters[0] % PROGRESS_EVERY != 0) return;
        JSObject p = new JSObject();
        p.put("found", counters[0]);
        p.put("parsed", counters[1]);
        notifyListeners("scanProgress", p);
    }

    // ── Album art ────────────────────────────────────────────────────────────

    /**
     * Embedded cover for one track, as a data URL, or null when it has none.
     * Downsampled to {@link #ART_MAX_PX} first: full-size embedded art runs to
     * megabytes, and the renderer holds these in a map keyed by track id.
     */
    @PluginMethod
    public void getArt(PluginCall call) {
        final String uriArg = call.getString("uri");
        if (uriArg == null) { call.reject("A uri is required"); return; }

        new Thread(() -> {
            MediaMetadataRetriever mmr = new MediaMetadataRetriever();
            try {
                mmr.setDataSource(getContext(), Uri.parse(uriArg));
                byte[] raw = mmr.getEmbeddedPicture();
                JSObject ret = new JSObject();
                if (raw == null) {
                    ret.put("art", JSONObject.NULL);
                } else {
                    ret.put("art", encodeArt(raw));
                }
                call.resolve(ret);
            } catch (Exception e) {
                JSObject ret = new JSObject();
                ret.put("art", JSONObject.NULL);
                call.resolve(ret);
            } finally {
                // release() is declared to throw on newer API levels and not on
            // older ones; catching Exception compiles against both.
            try { mmr.release(); } catch (Exception ignored) { }
            }
        }).start();
    }

    private String encodeArt(byte[] raw) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(raw, 0, raw.length, bounds);

        int longest = Math.max(bounds.outWidth, bounds.outHeight);
        BitmapFactory.Options opts = new BitmapFactory.Options();
        // inSampleSize only honours powers of two, so this halves until the
        // decoded image is at or below the cap.
        int sample = 1;
        while (longest / sample > ART_MAX_PX) sample *= 2;
        opts.inSampleSize = sample;

        Bitmap bmp = BitmapFactory.decodeByteArray(raw, 0, raw.length, opts);
        if (bmp == null) return null;
        try {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.JPEG, 85, buf);
            return "data:image/jpeg;base64,"
                    + Base64.encodeToString(buf.toByteArray(), Base64.NO_WRAP);
        } finally {
            bmp.recycle();
        }
    }

    // ── Persistence ──────────────────────────────────────────────────────────
    // The scanned list and the local playlists live as JSON in the app's
    // private files dir rather than in localStorage: a few thousand tracks is
    // well past what the WebView's quota comfortably holds, and blowing that
    // quota would take the rest of the app's settings down with it.

    @PluginMethod
    public void saveLibrary(PluginCall call) {
        writeJson(LIBRARY_FILE, call.getString("json"), call);
    }

    @PluginMethod
    public void loadLibrary(PluginCall call) {
        readJson(LIBRARY_FILE, call);
    }

    @PluginMethod
    public void savePlaylists(PluginCall call) {
        writeJson(PLAYLISTS_FILE, call.getString("json"), call);
    }

    @PluginMethod
    public void loadPlaylists(PluginCall call) {
        readJson(PLAYLISTS_FILE, call);
    }

    private void writeJson(String fileName, String json, PluginCall call) {
        if (json == null) { call.reject("json is required"); return; }
        File out = new File(getContext().getFilesDir(), fileName);
        // Write to a sibling temp file and rename, so a crash mid-write can't
        // leave a truncated library.json that fails to parse on next launch.
        File tmp = new File(getContext().getFilesDir(), fileName + ".tmp");
        try (FileOutputStream fos = new FileOutputStream(tmp)) {
            fos.write(json.getBytes(StandardCharsets.UTF_8));
            fos.getFD().sync();
        } catch (IOException e) {
            call.reject("Could not save " + fileName, e);
            return;
        }
        if (!tmp.renameTo(out)) {
            tmp.delete();
            call.reject("Could not replace " + fileName);
            return;
        }
        call.resolve();
    }

    private void readJson(String fileName, PluginCall call) {
        File in = new File(getContext().getFilesDir(), fileName);
        JSObject ret = new JSObject();
        if (!in.exists()) {
            ret.put("json", JSONObject.NULL);
            call.resolve(ret);
            return;
        }
        try (FileInputStream fis = new FileInputStream(in)) {
            byte[] buf = new byte[(int) in.length()];
            int read = fis.read(buf);
            ret.put("json", read <= 0 ? JSONObject.NULL : new String(buf, 0, read, StandardCharsets.UTF_8));
            call.resolve(ret);
        } catch (IOException e) {
            ret.put("json", JSONObject.NULL);
            call.resolve(ret);
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /** DISPLAY_NAME / SIZE / LAST_MODIFIED / MIME for a single document URI. */
    private String[] queryDocumentMeta(Uri uri) {
        String[] projection = {
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_SIZE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
        };
        try (Cursor c = getContext().getContentResolver().query(uri, projection, null, null, null)) {
            if (c == null || !c.moveToFirst()) return null;
            return new String[] {
                    c.getString(0),
                    String.valueOf(c.isNull(1) ? 0 : c.getLong(1)),
                    String.valueOf(c.isNull(2) ? 0 : c.getLong(2)),
                    c.getString(3),
            };
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Providers are inconsistent about MIME types — Google's own Files app
     * reports application/octet-stream for .flac and .opus — so the extension
     * is the fallback authority.
     */
    private boolean isAudio(String name, String mime) {
        if (mime != null && mime.startsWith("audio/")) return true;
        if ("application/ogg".equals(mime)) return true;
        return name != null && AUDIO_EXTS.contains(extOf(name));
    }

    private boolean isTreeUri(Uri uri) {
        List<String> segments = uri.getPathSegments();
        return segments.size() >= 2 && "tree".equals(segments.get(0));
    }

    /**
     * Best-effort display name for a source. Tree document ids look like
     * "primary:Music/Unreleased", so the last path component is the folder
     * name the user actually recognises.
     */
    private String treeLabel(Uri uri) {
        try {
            String docId = isTreeUri(uri)
                    ? DocumentsContract.getTreeDocumentId(uri)
                    : DocumentsContract.getDocumentId(uri);
            String tail = docId.contains(":") ? docId.substring(docId.lastIndexOf(':') + 1) : docId;
            if (tail.isEmpty()) return "Internal storage";
            int slash = tail.lastIndexOf('/');
            return slash >= 0 ? tail.substring(slash + 1) : tail;
        } catch (Exception e) {
            return uri.getLastPathSegment() == null ? uri.toString() : uri.getLastPathSegment();
        }
    }

    private Map<String, JSONObject> indexKnown(JSArray known) {
        Map<String, JSONObject> map = new HashMap<>();
        if (known == null) return map;
        try {
            List<Object> rows = known.toList();
            for (Object row : rows) {
                JSONObject o = row instanceof JSONObject
                        ? (JSONObject) row
                        : new JSONObject(row.toString());
                String id = o.optString("id", null);
                if (id != null) map.put(id, o);
            }
        } catch (JSONException ignored) { }
        return map;
    }

    private List<String> toStringList(JSArray arr) {
        List<String> out = new ArrayList<>();
        try {
            for (Object o : arr.toList()) if (o != null) out.add(o.toString());
        } catch (JSONException ignored) { }
        return out;
    }

    private final Object tagWriteLock = new Object();

    @PluginMethod
    public void writeTags(PluginCall call) {
        String value = call.getString("uri");
        JSObject patch = call.getObject("changes");
        if (value == null || !value.startsWith("content://") || patch == null || patch.length() == 0) {
            call.reject("Choose a local file and change at least one tag.");
            return;
        }
        new Thread(() -> {
            synchronized (tagWriteLock) {
                File backup = null;
                File edited = null;
                boolean retainBackup = false;
                try {
                    Uri uri = Uri.parse(value);
                    ContentResolver resolver = getContext().getContentResolver();
                    if (getContext().checkUriPermission(uri, android.os.Process.myPid(), android.os.Process.myUid(),
                            Intent.FLAG_GRANT_WRITE_URI_PERMISSION) != android.content.pm.PackageManager.PERMISSION_GRANTED)
                        throw new IOException("Write access is needed. In Library settings, add this folder or file again and allow access, then retry.");
                    String[] info = queryDocumentMeta(uri);
                    if (info == null || !"mp3".equals(extOf(info[0])))
                        throw new IOException("Tag editing currently supports MP3 files only.");
                    backup = File.createTempFile("tag-backup-", ".mp3", getContext().getFilesDir());
                    try (InputStream in = resolver.openInputStream(uri); OutputStream out = new FileOutputStream(backup)) {
                        copyTagFile(in, out);
                    }
                    edited = File.createTempFile("tag-edited-", ".mp3", getContext().getCacheDir());
                    Map<String, String> changes = new HashMap<>();
                    java.util.Iterator<String> keys = patch.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        changes.put(key, patch.getString(key));
                    }
                    LocalMp3Tags.write(backup, edited, changes);
                    JSONObject track = readTags(Uri.fromFile(edited), info[0], edited.length(), 0);
                    if (track == null) throw new IOException("The edited copy could not be read. Original file was not changed.");
                    try {
                        replaceTagFile(resolver, uri, edited);
                        verifyTagFile(resolver, uri, edited);
                    } catch (Exception writeError) {
                        try {
                            replaceTagFile(resolver, uri, backup);
                            verifyTagFile(resolver, uri, backup);
                        } catch (Exception restoreError) {
                            retainBackup = true;
                            throw new IOException("Saving and restoring failed. Original backup retained at " + backup.getAbsolutePath(), writeError);
                        }
                        throw new IOException("Could not save tags; the original was restored. " + writeError.getMessage(), writeError);
                    }
                    String[] saved = queryDocumentMeta(uri);
                    track.put("id", "local-" + value);
                    track.put("filePath", value);
                    track.put("fileSize", saved == null ? edited.length() : Long.parseLong(saved[1]));
                    track.put("lastModified", saved == null ? 0 : Long.parseLong(saved[2]));
                    JSObject result = new JSObject();
                    result.put("track", track);
                    call.resolve(result);
                } catch (Exception e) {
                    call.reject(e.getMessage() == null ? "Could not save tags." : e.getMessage(), e);
                } finally {
                    if (backup != null && !retainBackup) backup.delete();
                    if (edited != null) edited.delete();
                }
            }
        }, "local-tag-write").start();
    }

    private static void copyTagFile(InputStream in, OutputStream out) throws IOException {
        if (in == null || out == null) throw new IOException("Cannot open this file.");
        byte[] buffer = new byte[65536];
        int n;
        while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
        out.flush();
    }

    private static void replaceTagFile(ContentResolver resolver, Uri uri, File source) throws IOException {
        try (InputStream in = new FileInputStream(source); OutputStream out = resolver.openOutputStream(uri, "rwt")) {
            copyTagFile(in, out);
        }
    }

    private static void verifyTagFile(ContentResolver resolver, Uri uri, File source) throws IOException {
        try (InputStream actual = resolver.openInputStream(uri); InputStream expected = new FileInputStream(source)) {
            if (actual == null) throw new IOException("Cannot verify saved file.");
            byte[] a = new byte[65536];
            byte[] b = new byte[65536];
            int n;
            while ((n = expected.read(a)) != -1) {
                int offset = 0;
                while (offset < n) {
                    int count = actual.read(b, offset, n - offset);
                    if (count < 0) throw new IOException("Saved file was truncated.");
                    offset += count;
                }
                for (int j = 0; j < n; j++) if (a[j] != b[j]) throw new IOException("Saved file did not match.");
            }
            if (actual.read() != -1) throw new IOException("Provider did not replace the complete file.");
        }
    }

    private String meta(MediaMetadataRetriever mmr, int key) {
        try { return mmr.extractMetadata(key); } catch (Exception e) { return null; }
    }

    private static boolean isBlank(String s) { return s == null || s.trim().isEmpty(); }

    private static String extOf(String name) {
        if (name == null) return "";
        int dot = name.lastIndexOf('.');
        return dot < 0 ? "" : name.substring(dot + 1).toLowerCase(Locale.US);
    }

    private static String stripExt(String name) {
        if (name == null) return "";
        int dot = name.lastIndexOf('.');
        return dot <= 0 ? name : name.substring(0, dot);
    }

    /** METADATA_KEY_YEAR is often absent; DATE ("20190315", ISO stamps) isn't. */
    private static Object parseYear(String year, String date) {
        Integer y = parseLeadingIntOrNull(year);
        if (y != null && y > 0) return y;
        if (date != null && date.length() >= 4) {
            Integer fromDate = parseLeadingIntOrNull(date.substring(0, 4));
            if (fromDate != null && fromDate > 1000) return fromDate;
        }
        return JSONObject.NULL;
    }

    /** "3/12" → 3. Returns JSONObject.NULL rather than 0 so "untagged" is distinguishable. */
    private static Object parseLeadingInt(String value) {
        Integer n = parseLeadingIntOrNull(value);
        return n == null ? JSONObject.NULL : n;
    }

    private static Integer parseLeadingIntOrNull(String value) {
        if (value == null) return null;
        int end = 0;
        while (end < value.length() && Character.isDigit(value.charAt(end))) end++;
        if (end == 0) return null;
        try { return Integer.parseInt(value.substring(0, end)); } catch (NumberFormatException e) { return null; }
    }
}
