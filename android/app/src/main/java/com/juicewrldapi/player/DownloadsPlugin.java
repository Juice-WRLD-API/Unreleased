package com.juicewrldapi.player;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Saves an in-memory file built in JS (a playlist ZIP, a synced-lyrics
 * export, a track download) into the user's Downloads folder — or, if
 * they've picked one in Settings, into a folder of their own choosing.
 *
 * Why this exists: the desktop/web build "downloads" a file with a plain
 * `<a download>` click on a blob: URL — that works in a real browser and in
 * Electron, but this WebView doesn't wire `download` up to an actual save
 * the same way, so every download in the app silently did nothing on
 * Android; the click just no-ops.
 *
 * Three destinations, in order of preference:
 *  - A user-picked folder (`folderUri`, a SAF tree URI persisted from
 *    {@link #pickFolder}) — written via DocumentsContract, the same
 *    low-level API LocalLibraryPlugin already uses for reading, so this adds
 *    no new dependency. Existing same-name files are replaced rather than
 *    left to pick up a "(1)" suffix from createDocument, matching how the
 *    MediaStore/legacy paths below silently overwrite too.
 *  - MediaStore.Downloads on API 29+ (the overwhelming majority of active
 *    devices), which needs no storage permission at all.
 *  - The legacy public Downloads directory below that, which technically
 *    needs a runtime-granted WRITE_EXTERNAL_STORAGE on API 23–28 — not
 *    requested here (no permission-request plumbing exists in this app yet,
 *    and API ≤28 is now a vanishing sliver of devices); the write will fail
 *    there with a clear error via the normal reject path rather than crash.
 */
@CapacitorPlugin(name = "Downloads")
public class DownloadsPlugin extends Plugin {

    @PluginMethod
    public void save(PluginCall call) {
        final String filename = call.getString("filename");
        final String base64 = call.getString("base64");
        final String mimeType = call.getString("mimeType", "application/octet-stream");
        final String folderUri = call.getString("folderUri");
        if (filename == null || base64 == null) { call.reject("filename and base64 are required"); return; }

        new Thread(() -> {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                if (folderUri != null && !folderUri.isEmpty()) {
                    saveToTree(Uri.parse(folderUri), filename, mimeType, bytes);
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    saveViaMediaStore(filename, mimeType, bytes);
                } else {
                    saveLegacy(filename, bytes);
                }
                JSObject ret = new JSObject();
                ret.put("filename", filename);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Save failed" : e.getMessage(), e);
            }
        }).start();
    }

    private void saveViaMediaStore(String filename, String mimeType, byte[] bytes) throws Exception {
        Context ctx = getContext();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
        values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
        // Hidden from other apps (and from the user opening Files mid-write)
        // until the write below finishes, then cleared.
        values.put(MediaStore.Downloads.IS_PENDING, 1);

        Uri uri = ctx.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new Exception("Could not create the download entry");
        try {
            try (OutputStream out = ctx.getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new Exception("Could not open the download for writing");
                out.write(bytes);
            }
            values.clear();
            values.put(MediaStore.Downloads.IS_PENDING, 0);
            ctx.getContentResolver().update(uri, values, null, null);
        } catch (Exception e) {
            try { ctx.getContentResolver().delete(uri, null, null); } catch (Exception ignored) { }
            throw e;
        }
    }

    private void saveLegacy(String filename, byte[] bytes) throws Exception {
        File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("Could not create the Downloads directory");
        File out = new File(dir, filename);
        try (FileOutputStream fos = new FileOutputStream(out)) {
            fos.write(bytes);
        }
    }

    /** Writes into a SAF tree the user picked via {@link #pickFolder}. */
    private void saveToTree(Uri tree, String filename, String mimeType, byte[] bytes) throws Exception {
        ContentResolver cr = getContext().getContentResolver();
        String parentDocId;
        try {
            parentDocId = DocumentsContract.getTreeDocumentId(tree);
        } catch (Exception e) {
            throw new Exception("The selected download folder is no longer accessible — choose it again in Settings");
        }
        Uri parentDocUri = DocumentsContract.buildDocumentUriUsingTree(tree, parentDocId);

        // createDocument doesn't overwrite — a stale file from a previous
        // download of the same name would otherwise pick up a "foo (1).mp3"
        // suffix from the provider instead of replacing it.
        Uri existing = findChild(cr, tree, parentDocId, filename);
        if (existing != null) {
            try { DocumentsContract.deleteDocument(cr, existing); } catch (Exception ignored) { }
        }

        Uri fileUri;
        try {
            fileUri = DocumentsContract.createDocument(cr, parentDocUri, mimeType, filename);
        } catch (SecurityException e) {
            throw new Exception("Lost permission to the selected download folder — choose it again in Settings");
        }
        if (fileUri == null) throw new Exception("Could not create the file in the selected folder");
        try (OutputStream out = cr.openOutputStream(fileUri)) {
            if (out == null) throw new Exception("Could not open the file for writing");
            out.write(bytes);
        }
    }

    private Uri findChild(ContentResolver cr, Uri tree, String parentDocId, String name) {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentDocId);
        String[] projection = {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        };
        try (Cursor c = cr.query(children, projection, null, null, null)) {
            if (c == null) return null;
            while (c.moveToNext()) {
                if (name.equals(c.getString(1))) {
                    return DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0));
                }
            }
        } catch (Exception ignored) { }
        return null;
    }

    // ── Folder picking ───────────────────────────────────────────────────────
    // Same pattern as LocalLibraryPlugin's pickFolder — see its class comment
    // for why everything here goes through the Storage Access Framework
    // rather than a raw filesystem path. This one takes a *write* grant
    // instead of read, since the point is saving into the folder.

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_READ_URI_PERMISSION
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
            getContext().getContentResolver().takePersistableUriPermission(tree,
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException e) {
            // Some providers hand back a non-persistable grant. The folder
            // still works this session; it just won't survive a restart.
        }
        ret.put("uri", tree.toString());
        ret.put("name", SafUris.treeLabel(tree));
        call.resolve(ret);
    }

    /** Drops the persisted grant when the user resets to the default folder. */
    @PluginMethod
    public void releaseFolder(PluginCall call) {
        String uri = call.getString("uri");
        if (uri != null) {
            try {
                getContext().getContentResolver().releasePersistableUriPermission(Uri.parse(uri),
                        Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (SecurityException ignored) { }
        }
        call.resolve();
    }

}
