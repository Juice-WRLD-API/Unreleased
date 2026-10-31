package com.juicewrldapi.player;

import com.mpatric.mp3agic.*;
import java.io.File;
import java.io.IOException;
import java.util.Map;

/** Changes only requested text frames; leaves artwork, lyrics and custom frames intact. */
final class LocalMp3Tags {
    private static final class TextData extends ID3v2TextFrameData {
        TextData(boolean unsynchronisation, String value) {
            super(unsynchronisation, new EncodedText(EncodedText.TEXT_ENCODING_UTF_16, value));
        }
        byte[] bytes() { return toBytes(); }
    }
    static void write(File source, File destination, Map<String, String> changes) throws Exception {
        Mp3File mp3 = new Mp3File(source);
        ID3v2 tag = mp3.hasId3v2Tag() ? mp3.getId3v2Tag() : new ID3v24Tag();
        if (!mp3.hasId3v2Tag() && mp3.hasId3v1Tag()) {
            ID3v1 old = mp3.getId3v1Tag();
            tag.setTitle(old.getTitle());
            tag.setArtist(old.getArtist());
            tag.setAlbum(old.getAlbum());
            tag.setYear(old.getYear());
            tag.setTrack(old.getTrack());
            tag.setComment(old.getComment());
            tag.setGenre(old.getGenre());
        }
        if (tag.getVersion().startsWith("2.")) {
            throw new IOException("ID3v2.2 tags cannot be edited safely. Convert this file's tags to ID3v2.3 or ID3v2.4 first.");
        }
        boolean v4 = tag.getVersion().startsWith("4.");
        for (Map.Entry<String, String> change : changes.entrySet()) {
            String frame;
            switch (change.getKey()) {
                case "title": frame = "TIT2"; break;
                case "artist": frame = "TPE1"; break;
                case "album": frame = "TALB"; break;
                case "albumArtist": frame = "TPE2"; break;
                case "composer": frame = "TCOM"; break;
                case "genre": frame = "TCON"; break;
                case "year": frame = v4 ? "TDRC" : "TYER"; break;
                case "trackNumber": frame = "TRCK"; break;
                case "discNumber": frame = "TPOS"; break;
                default: throw new IOException("Unsupported tag: " + change.getKey());
            }
            String value = change.getValue().trim();
            if (change.getKey().equals("year") && !value.isEmpty() && !value.matches("[0-9]{4}"))
                throw new IOException("Year must contain four digits.");
            if ((change.getKey().equals("trackNumber") || change.getKey().equals("discNumber"))
                    && !value.isEmpty() && !value.matches("[1-9][0-9]{0,3}(/[1-9][0-9]{0,3})?"))
                throw new IOException("Track and disc must be positive numbers, optionally followed by /total.");
            tag.clearFrameSet(frame);
            // Some v2.4 files retain the older year frame too.
            if (change.getKey().equals("year") && v4) tag.clearFrameSet("TYER");
            if (!value.isEmpty()) {
                byte[] data = new TextData(tag.hasUnsynchronisation(), value).bytes();
                ID3v2FrameSet frames = new ID3v2FrameSet(frame);
                frames.addFrame(v4 ? new ID3v24Frame(frame, data) : new ID3v2Frame(frame, data));
                tag.getFrameSets().put(frame, frames);
            }
            // Avoid stale ID3v1 fallback when a v2 field is cleared.
            if (mp3.hasId3v1Tag()) {
                ID3v1 v1 = mp3.getId3v1Tag();
                switch (change.getKey()) {
                    case "title": v1.setTitle(value); break;
                    case "artist": v1.setArtist(value); break;
                    case "album": v1.setAlbum(value); break;
                    case "year": v1.setYear(value); break;
                    case "trackNumber": v1.setTrack(value.split("/")[0]); break;
                    case "genre": v1.setGenre(-1); break;
                }
            }
        }
        if (tag.getFrameSets().isEmpty()) mp3.removeId3v2Tag();
        else mp3.setId3v2Tag(tag);
        mp3.save(destination.getAbsolutePath());
        // Parse the prepared copy before touching the user's original.
        new Mp3File(destination);
    }
}
