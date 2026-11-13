package com.juicewrldapi.player;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

/**
 * Offline playlist/track downloads for the Android wrap — the counterpart to
 * the desktop build's Electron main-process offline* IPC handlers, which have
 * no equivalent on this platform at all (that's why "Keep on device" used to
 * silently do nothing here: the renderer's offline* store actions all start
 * with `if (!window.electron) return`).
 *
 * Storage lives in the app's private files dir, same shape as {@link
 * LocalLibraryPlugin}'s persistence: two small JSON registries (this plugin's
 * own, unrelated to that plugin's scanned-folder library) plus the actual
 * downloaded audio files under files/offline/. `getLibrary` is the renderer's
 * "disk truth" — every mutation here is followed by a getLibrary() refresh on
 * the JS side, so the registries here are the only thing that has to stay
 * correct; nothing is cached renderer-side across a relaunch.
 *
 * Playback of a downloaded track needs no changes anywhere else in the app:
 * Player.tsx's resolvePlaybackUrl() already runs an offline track's
 * `localPath` through toFileUrl() → Capacitor.convertFileSrc(), the exact
 * same path the local-library scanner's files use, and that already streams
 * (range requests included) from a plain absolute filesystem path just as
 * well as from a content:// URI.
 */
@CapacitorPlugin(name = "Offline")
public class OfflinePlugin extends Plugin {

    private static final String TRACKS_FILE = "offline-tracks.json";
    private static final String PLAYLISTS_FILE = "offline-playlists.json";
    private static final String TRACKS_DIR = "offline";

    /** Minimum gap between `offlineDownloadProgress` events for one file — an
     *  event per read() call would be thousands of bridge crossings on a large
     *  file for no visible benefit. */
    private static final long PROGRESS_MIN_INTERVAL_MS = 200;

    /** Every registry read-modify-write, including the prune that follows a
     *  playlist change. The download itself stays outside this lock. */
    private static final Object REGISTRY_LOCK = new Object();

    // ── Library ──────────────────────────────────────────────────────────────

    @PluginMethod
    public void getLibrary(PluginCall call) {
        JSONObject lib = new JSONObject();
        try {
            synchronized (REGISTRY_LOCK) {
                lib.put("tracks", readJson(TRACKS_FILE));
                lib.put("playlists", readJson(PLAYLISTS_FILE));
            }
        } catch (JSONException ignored) { }
        JSObject ret = new JSObject();
        ret.put("json", lib.toString());
        call.resolve(ret);
    }

    // ── Downloading ──────────────────────────────────────────────────────────

    @PluginMethod
    public void downloadTrack(PluginCall call) {
        final String id = call.getString("id");
        final String url = call.getString("url");
        final String ext = call.getString("ext", "mp3");
        final String path = call.getString("path", "");
        final String metaJson = call.getString("meta", "{}");
        if (id == null || url == null) { call.reject("id and url are required"); return; }

        new Thread(() -> {
            File dest = trackFile(id, ext);
            File tmp = new File(dest.getParentFile(), dest.getName() + ".part");
            HttpURLConnection conn = null;
            try {
                File dir = dest.getParentFile();
                if (dir != null && !dir.exists()) dir.mkdirs();

                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.connect();
                int status = conn.getResponseCode();
                if (status < 200 || status >= 300) {
                    call.resolve(errorResult("HTTP " + status));
                    return;
                }

                long total = conn.getContentLengthLong();
                long received = 0;
                long lastEmit = 0;
                try (InputStream in = conn.getInputStream();
                     FileOutputStream out = new FileOutputStream(tmp)) {
                    byte[] buf = new byte[16 * 1024];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        out.write(buf, 0, n);
                        received += n;
                        long now = System.currentTimeMillis();
                        if (now - lastEmit >= PROGRESS_MIN_INTERVAL_MS) {
                            lastEmit = now;
                            emitProgress(id, received, total);
                        }
                    }
                    out.getFD().sync();
                }
                emitProgress(id, received, total);

                // A dropped connection can end the stream without throwing.
                // Promoting that partial file used to delete a working copy.
                if (total > 0 && received != total) {
                    tmp.delete();
                    call.resolve(errorResult("Download was incomplete (" + received + " of " + total + " bytes) — check your connection and try again."));
                    return;
                }

                synchronized (REGISTRY_LOCK) {
                    if (dest.exists()) dest.delete();
                    if (!tmp.renameTo(dest)) { call.resolve(errorResult("Could not save downloaded file")); return; }

                    JSONObject meta = new JSONObject(metaJson);
                    meta.put("path", path);
                    meta.put("localPath", dest.getAbsolutePath());
                    meta.put("ext", ext);
                    meta.put("downloadedAt", System.currentTimeMillis());
                    JSONObject tracks = readJson(TRACKS_FILE);
                    tracks.put(id, meta);
                    writeJson(TRACKS_FILE, tracks);
                }

                JSObject ret = new JSObject();
                ret.put("localPath", dest.getAbsolutePath());
                ret.put("size", received);
                call.resolve(ret);
            } catch (Exception e) {
                tmp.delete();
                call.resolve(errorResult(e.getMessage() == null ? "Download failed" : e.getMessage()));
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    private JSObject errorResult(String message) {
        JSObject ret = new JSObject();
        ret.put("error", message);
        return ret;
    }

    private void emitProgress(String id, long received, long total) {
        JSObject p = new JSObject();
        p.put("id", id);
        p.put("received", received);
        p.put("total", total);
        p.put("percent", total > 0 ? (int) ((received * 100) / total) : 0);
        notifyListeners("offlineDownloadProgress", p);
    }

    // ── Playlist membership ─────────────────────────────────────────────────

    @PluginMethod
    public void setPlaylist(PluginCall call) {
        final String key = call.getString("key");
        final JSArray idsArg = call.getArray("trackIds");
        final String name = call.getString("name", "");
        if (key == null || idsArg == null) { call.reject("key and trackIds are required"); return; }

        new Thread(() -> {
            try {
                List<String> ids = new ArrayList<>();
                for (Object o : idsArg.toList()) if (o != null) ids.add(o.toString());

                synchronized (REGISTRY_LOCK) {
                    JSONObject playlists = readJson(PLAYLISTS_FILE);
                    JSONObject entry = new JSONObject();
                    entry.put("songIds", new JSONArray(ids));
                    entry.put("name", name);
                    entry.put("updatedAt", System.currentTimeMillis());
                    playlists.put(key, entry);
                    writeJson(PLAYLISTS_FILE, playlists);
                    pruneOrphanedTracks(playlists);
                }
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "setPlaylist failed" : e.getMessage(), e);
            }
        }).start();
    }

    @PluginMethod
    public void removePlaylist(PluginCall call) {
        final String key = call.getString("key");
        if (key == null) { call.reject("key is required"); return; }

        new Thread(() -> {
            try {
                synchronized (REGISTRY_LOCK) {
                    JSONObject playlists = readJson(PLAYLISTS_FILE);
                    playlists.remove(key);
                    writeJson(PLAYLISTS_FILE, playlists);
                    pruneOrphanedTracks(playlists);
                }
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "removePlaylist failed" : e.getMessage(), e);
            }
        }).start();
    }

    @PluginMethod
    public void removeTrack(PluginCall call) {
        final String id = call.getString("id");
        if (id == null) { call.reject("id is required"); return; }

        new Thread(() -> {
            try {
                synchronized (REGISTRY_LOCK) {
                    JSONObject tracks = readJson(TRACKS_FILE);
                    deleteTrackFile(tracks, id);
                    tracks.remove(id);
                    writeJson(TRACKS_FILE, tracks);
                }
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "removeTrack failed" : e.getMessage(), e);
            }
        }).start();
    }

    /**
     * Deletes any downloaded file no longer referenced by ANY entry in
     * `playlists` — a track kept offline only because it belonged to a
     * playlist that's since been un-synced (or had that song removed)
     * shouldn't linger on disk forever. Mirrors the desktop build's behaviour
     * (see the renderer's downloadPlaylistOffline/removePlaylistOffline
     * comments on pruning).
     */
    private void pruneOrphanedTracks(JSONObject playlists) {
        try {
            Set<String> referenced = new HashSet<>();
            Iterator<String> keys = playlists.keys();
            while (keys.hasNext()) {
                JSONObject entry = playlists.optJSONObject(keys.next());
                JSONArray ids = entry == null ? null : entry.optJSONArray("songIds");
                if (ids == null) continue;
                for (int i = 0; i < ids.length(); i++) referenced.add(ids.optString(i));
            }

            JSONObject tracks = readJson(TRACKS_FILE);
            List<String> orphaned = new ArrayList<>();
            Iterator<String> trackKeys = tracks.keys();
            while (trackKeys.hasNext()) {
                String id = trackKeys.next();
                if (!referenced.contains(id)) orphaned.add(id);
            }
            if (orphaned.isEmpty()) return;
            for (String id : orphaned) {
                deleteTrackFile(tracks, id);
                tracks.remove(id);
            }
            writeJson(TRACKS_FILE, tracks);
        } catch (Exception ignored) {
            // A failed prune leaves an extra file on disk at worst — not worth
            // taking down the playlist mutation that triggered it.
        }
    }

    private void deleteTrackFile(JSONObject tracks, String id) {
        JSONObject entry = tracks.optJSONObject(id);
        String localPath = entry == null ? null : entry.optString("localPath", null);
        if (localPath == null) return;
        File f = new File(localPath);
        if (f.exists()) f.delete();
    }

    private File trackFile(String id, String ext) {
        // Ids are always "jw-<number>" in practice, but sanitise anyway rather
        // than trust a renderer-supplied string as a filename.
        String safe = id.replaceAll("[^A-Za-z0-9_-]", "_");
        return new File(new File(getContext().getFilesDir(), TRACKS_DIR), safe + "." + ext);
    }

    // ── JSON persistence ─────────────────────────────────────────────────────
    // Same atomic-write pattern as LocalLibraryPlugin: write to a sibling temp
    // file and rename, so a crash mid-write can't leave a truncated registry
    // that fails to parse on next launch.

    private JSONObject readJson(String fileName) {
        File f = new File(getContext().getFilesDir(), fileName);
        if (!f.exists()) return new JSONObject();
        try {
            byte[] buf = AtomicJson.readBytes(f);
            if (buf.length == 0) return new JSONObject();
            return new JSONObject(new String(buf, StandardCharsets.UTF_8));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private void writeJson(String fileName, JSONObject obj) throws IOException {
        AtomicJson.writeBytes(new File(getContext().getFilesDir(), fileName), obj.toString().getBytes(StandardCharsets.UTF_8));
    }
}
