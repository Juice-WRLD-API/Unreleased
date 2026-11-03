package com.juicewrldapi.player;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Inet4Address;
import java.net.Socket;
import java.net.URL;

import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * Bridges JS playback state to a real Android media session — see
 * PlaybackService for the foreground Service / MediaSessionCompat mechanics
 * this starts and drives (deliberately no AudioManager focus request of its
 * own — see that class's doc comment for why). lib/mediaControl.ts is the
 * JS-side counterpart.
 *
 * Every playback *decision* (what "next" does, what track is loaded) stays
 * in JS — this plugin and PlaybackService only report state one way and
 * events the other; neither one plays or controls audio itself.
 */
@CapacitorPlugin(
    name = "MediaControl",
    permissions = {
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
    }
)
public class MediaSessionPlugin extends Plugin implements PlaybackService.Listener {

    @Override
    public void load() {
        PlaybackService.setListener(this);
    }

    private void ensureStarted() {
        Context ctx = getContext();
        Intent intent = new Intent(ctx, PlaybackService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(intent);
        } else {
            ctx.startService(intent);
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationPermsCallback");
            return;
        }
        ensureStarted();
        call.resolve();
    }

    @PermissionCallback
    private void notificationPermsCallback(PluginCall call) {
        // ensureStarted() runs regardless of the outcome — a denied
        // permission just means the notification stays invisible while the
        // foreground service (and audio focus) keep working normally.
        ensureStarted();
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), PlaybackService.class));
        call.resolve();
    }

    // Bumped on every updateMetadata call; a completed download only applies
    // if it's still the most recent request when it finishes — otherwise a
    // slow fetch for a track the user already skipped past would land its
    // artwork on whatever's playing by then.
    private static int artworkRequestSeq = 0;

    @PluginMethod
    public void updateMetadata(PluginCall call) {
        String title = call.getString("title", "");
        String artist = call.getString("artist", "");
        String album = call.getString("album", "");
        Double durationSec = call.getDouble("duration");
        long durationMs = durationSec != null ? Math.round(durationSec * 1000) : 0L;
        // Two mutually-exclusive art sources from the JS side (see
        // mediaControl.ts): `artworkUrl` for http(s) API/CDN covers, fetched
        // natively here — the WebView's own fetch() is CORS-restricted and
        // the art CDN doesn't send Access-Control-Allow-Origin, even though
        // an <img> tag displays the same URL fine; a plain java.net request
        // isn't subject to that browser-only policy at all. `artworkBase64`
        // for local-library embedded covers, which JS already decoded from a
        // data:/blob: URI (no network involved, nothing for this to gain by
        // re-fetching).
        String artworkUrl = call.getString("artworkUrl");
        Bitmap localArtwork = decodeArtwork(call.getString("artworkBase64"));
        int seq = ++artworkRequestSeq;

        PlaybackService.pendingTitle = title;
        PlaybackService.pendingArtist = artist;
        PlaybackService.pendingAlbum = album;
        PlaybackService.pendingArtwork = localArtwork;
        PlaybackService.pendingDurationMs = durationMs;

        ensureStarted();
        PlaybackService instance = PlaybackService.getInstance();
        if (instance != null) instance.update(title, artist, album, localArtwork, durationMs);
        call.resolve();

        if (localArtwork == null && artworkUrl != null && !artworkUrl.isEmpty()) {
            fetchArtwork(artworkUrl, seq, title, artist, album, durationMs);
        }
    }

    private Bitmap decodeArtwork(String base64) {
        if (base64 == null || base64.isEmpty()) return null;
        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (Exception e) {
            return null;
        }
    }

    private void fetchArtwork(String url, int seq, String title, String artist, String album, long durationMs) {
        new Thread(() -> {
            Bitmap bitmap = null;
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);
                try (InputStream in = conn.getInputStream()) {
                    bitmap = BitmapFactory.decodeStream(in);
                }
            } catch (Exception e) {
                // Android's built-in HttpURLConnection (com.android.okhttp, an
                // old bundled fork — not real OkHttp3) picks whichever address
                // DNS returns first and gives up on that one attempt; it has
                // none of Chromium's Happy-Eyeballs dual-stack racing/fallback
                // (that's specifically why the WebView's own fetch() for the
                // JSON API works fine while this failed here). Seen on the
                // Android emulator's virtual network, which has no real IPv6
                // route at all — a AAAA-only first attempt just hard-fails
                // instead of falling through to the A record that works. Some
                // real carrier/router setups have the same partial-IPv6 gap,
                // so this isn't purely an emulator artifact. Retry once,
                // forcing an IPv4 route explicitly.
                try {
                    bitmap = fetchViaIPv4(url);
                } catch (Exception e2) {
                    // Offline, no IPv4 route either, 404, bad image data —
                    // notification just keeps its text-only look.
                }
            } finally {
                if (conn != null) conn.disconnect();
            }
            if (bitmap == null || seq != artworkRequestSeq) return;
            PlaybackService.pendingArtwork = bitmap;
            PlaybackService instance = PlaybackService.getInstance();
            if (instance != null) instance.update(title, artist, album, bitmap, durationMs);
        }).start();
    }

    /** Connects to an explicit IPv4 address for the host but keeps TLS SNI
     *  and hostname verification against the real hostname — the standard
     *  "connect by IP, verify by name" pattern via SSLSocketFactory's
     *  createSocket(Socket, host, port, autoClose) overload, which wraps an
     *  already-TCP-connected socket instead of resolving/connecting itself.
     *  Only http(s) art URLs ever reach here (see updateMetadata), and in
     *  practice always https, but this only implements the https path since
     *  that's the only case that exists. */
    private Bitmap fetchViaIPv4(String urlStr) throws Exception {
        URL url = new URL(urlStr);
        String host = url.getHost();
        int port = url.getPort() == -1 ? url.getDefaultPort() : url.getPort();
        String path = url.getFile().isEmpty() ? "/" : url.getFile();

        InetAddress ipv4 = null;
        for (InetAddress addr : InetAddress.getAllByName(host)) {
            if (addr instanceof Inet4Address) { ipv4 = addr; break; }
        }
        if (ipv4 == null) throw new IOException("no IPv4 address for " + host);

        Socket raw = new Socket();
        raw.connect(new InetSocketAddress(ipv4, port), 8000);
        SSLSocketFactory factory = (SSLSocketFactory) SSLSocketFactory.getDefault();
        try (SSLSocket ssl = (SSLSocket) factory.createSocket(raw, host, port, true)) {
            ssl.setSoTimeout(8000);
            ssl.startHandshake();

            OutputStream out = ssl.getOutputStream();
            String request = "GET " + path + " HTTP/1.1\r\n"
                + "Host: " + host + "\r\n"
                + "Connection: close\r\n"
                + "User-Agent: Unreleased-Android\r\n\r\n";
            out.write(request.getBytes("UTF-8"));
            out.flush();

            InputStream in = ssl.getInputStream();
            ByteArrayOutputStream headerBuf = new ByteArrayOutputStream();
            int b, p1 = -1, p2 = -1, p3 = -1;
            while ((b = in.read()) != -1) {
                headerBuf.write(b);
                if (p3 == '\r' && p2 == '\n' && p1 == '\r' && b == '\n') break;
                p3 = p2; p2 = p1; p1 = b;
            }
            String statusLine = headerBuf.toString("UTF-8").split("\r\n", 2)[0];
            if (!statusLine.contains(" 200 ")) throw new IOException("HTTP " + statusLine);

            // "Connection: close" means the server closing the socket is the
            // end-of-body signal, regardless of Content-Length/chunked
            // encoding — no need to parse either.
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) != -1) body.write(buf, 0, n);
            return BitmapFactory.decodeByteArray(body.toByteArray(), 0, body.size());
        }
    }

    @PluginMethod
    public void updatePlaybackState(PluginCall call) {
        Boolean playingVal = call.getBoolean("playing");
        boolean playing = playingVal != null && playingVal;
        Double positionSec = call.getDouble("position");
        long positionMs = positionSec != null ? Math.round(positionSec * 1000) : 0L;
        Double speedVal = call.getDouble("speed");
        float speed = speedVal != null ? speedVal.floatValue() : 1f;

        PlaybackService.pendingPlaying = playing;
        PlaybackService.pendingPositionMs = positionMs;
        PlaybackService.pendingSpeed = speed;

        ensureStarted();
        PlaybackService instance = PlaybackService.getInstance();
        if (instance != null) instance.updatePlaybackState(playing, positionMs, speed);
        call.resolve();
    }

    /** Settings → Playback → "Resume when Bluetooth connects". */
    @PluginMethod
    public void setResumeOnBluetooth(PluginCall call) {
        PlaybackService.setResumeOnBluetooth(getContext(), call.getBoolean("enabled", true));
        call.resolve();
    }

    // ── PlaybackService.Listener — native callbacks routed to JS ────────────

    @Override public void onPlay() { notifyListeners("play", new JSObject()); }
    @Override public void onPause() { notifyListeners("pause", new JSObject()); }
    @Override public void onNext() { notifyListeners("next", new JSObject()); }
    @Override public void onPrevious() { notifyListeners("previous", new JSObject()); }

    @Override
    public void onSeekTo(long positionMs) {
        JSObject data = new JSObject();
        data.put("position", positionMs / 1000.0);
        notifyListeners("seek", data);
    }
}
