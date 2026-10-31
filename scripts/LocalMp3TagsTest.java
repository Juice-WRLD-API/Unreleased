package com.juicewrldapi.player;

import com.mpatric.mp3agic.*;
import java.nio.file.*;
import java.util.*;

/** Standalone regression check: compile alongside LocalMp3Tags with mp3agic on the classpath. */
public final class LocalMp3TagsTest {
    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    public static void main(String[] args) throws Exception {
        Path dir = Files.createTempDirectory("local-tags-test-");
        try {
            // MPEG-1 Layer III, 128 kbps, 44.1 kHz: ten complete 417-byte frames.
            byte[] audio = new byte[4170];
            for (int i = 0; i < audio.length; i += 417) {
                audio[i] = (byte) 0xff; audio[i + 1] = (byte) 0xfb;
                audio[i + 2] = (byte) 0x90;
            }
            Path raw = dir.resolve("raw.mp3");
            Files.write(raw, audio);
            for (ID3v2 tag : new ID3v2[] { new ID3v23Tag(), new ID3v24Tag() }) {
                tag.setTitle("Before"); tag.setArtist("Keep artist"); tag.setAlbum("Keep album");
                tag.setLyrics("Keep lyrics"); tag.setComment("Keep comment");
                byte[] art = new byte[] { (byte) 0xff, (byte) 0xd8, 1, 2, 3 };
                tag.setAlbumImage(art, "image/jpeg");
                Mp3File mp3 = new Mp3File(raw);
                mp3.setId3v2Tag(tag);
                ID3v1Tag legacy = new ID3v1Tag(); legacy.setTitle("Before"); legacy.setArtist("Keep artist");
                mp3.setId3v1Tag(legacy);
                Path source = dir.resolve("source.mp3"), dest = dir.resolve("dest.mp3");
                mp3.save(source.toString());
                byte[] original = Files.readAllBytes(source);
                LocalMp3Tags.write(source.toFile(), dest.toFile(), Map.of("title", "New \u00e7\u0131\u011f", "genre", "Custom genre", "year", "2026", "trackNumber", "2/12"));
                Mp3File result = new Mp3File(dest);
                ID3v2 saved = result.getId3v2Tag();
                check("New \u00e7\u0131\u011f".equals(saved.getTitle()), "Unicode title round-trip");
                check("Keep artist".equals(saved.getArtist()), "Artist preserved");
                check("Keep album".equals(saved.getAlbum()), "Album preserved");
                check("Keep lyrics".equals(saved.getLyrics()), "Lyrics preserved");
                check("Keep comment".equals(saved.getComment()), "Comment preserved");
                check(Arrays.equals(art, saved.getAlbumImage()), "Artwork preserved");
                check("Custom genre".equals(saved.getGenreDescription()), "Free-text genre");
                check("2/12".equals(saved.getTrack()), "Track total");
                check(saved.getFrameSets().containsKey(tag instanceof ID3v24Tag ? "TDRC" : "TYER"), "Version-correct year");
                check(Arrays.equals(original, Files.readAllBytes(source)), "Original untouched");
                byte[] bytes = Files.readAllBytes(dest);
                check(Arrays.equals(audio, Arrays.copyOfRange(bytes, result.getStartOffset(), result.getEndOffset() + 1)), "Audio unchanged");
                LocalMp3Tags.write(dest.toFile(), source.toFile(), Map.of("title", "", "genre", ""));
                Mp3File cleared = new Mp3File(source);
                check(cleared.getId3v2Tag().getTitle() == null, "Title cleared");
                check(cleared.getId3v1Tag().getTitle().isEmpty(), "Legacy title cleared");
                check(!cleared.getId3v2Tag().getFrameSets().containsKey("TCON"), "Genre cleared");
                try {
                    LocalMp3Tags.write(source.toFile(), dest.toFile(), Map.of("year", "bad"));
                    throw new AssertionError("Invalid year accepted");
                } catch (java.io.IOException expected) { }
            }
            LocalMp3Tags.write(raw.toFile(), dir.resolve("new.mp3").toFile(), Map.of("title", "Previously untagged"));
            check("Previously untagged".equals(new Mp3File(dir.resolve("new.mp3")).getId3v2Tag().getTitle()), "Untagged file");
            LocalMp3Tags.write(dir.resolve("new.mp3").toFile(), dir.resolve("clear.mp3").toFile(), Map.of("title", ""));
            check(!new Mp3File(dir.resolve("clear.mp3")).hasId3v2Tag(), "Clearing the last frame leaves valid audio");
            Mp3File legacyOnly = new Mp3File(raw);
            ID3v1Tag legacy = new ID3v1Tag(); legacy.setArtist("Legacy artist"); legacy.setAlbum("Legacy album");
            legacyOnly.setId3v1Tag(legacy);
            legacyOnly.save(dir.resolve("legacy.mp3").toString());
            LocalMp3Tags.write(dir.resolve("legacy.mp3").toFile(), dir.resolve("upgraded.mp3").toFile(), Map.of("title", "New title"));
            ID3v2 upgraded = new Mp3File(dir.resolve("upgraded.mp3")).getId3v2Tag();
            check("Legacy artist".equals(upgraded.getArtist()), "Legacy artist copied into v2");
            check("Legacy album".equals(upgraded.getAlbum()), "Legacy album copied into v2");
            System.out.println("Local MP3 tag checks passed (v2.3, v2.4, untagged, preservation, clear, validation).");
        } finally {
            try (var files = Files.list(dir)) { for (Path file : files.toList()) Files.delete(file); }
            Files.delete(dir);
        }
    }
}
