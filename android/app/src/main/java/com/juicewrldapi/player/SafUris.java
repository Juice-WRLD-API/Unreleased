package com.juicewrldapi.player;

import android.net.Uri;
import android.provider.DocumentsContract;

import java.util.List;

/** Display names for Storage Access Framework folders. Shared so the
 *  tree-versus-document branch cannot drift between plugins. */
final class SafUris {
    private SafUris() {}

    static boolean isTreeUri(Uri uri) {
        List<String> segments = uri.getPathSegments();
        return segments.size() >= 2 && "tree".equals(segments.get(0));
    }

    /** Tree document ids look like "primary:Music/Unreleased", so the last
     *  path component is the folder name the user actually recognises. */
    static String treeLabel(Uri uri) {
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
}
