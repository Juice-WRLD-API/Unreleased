package com.juicewrldapi.player;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;

/** Temp-file write plus a read that keeps going until the buffer is full.
 *  One {@code read(byte[])} is allowed to return short, and a short read
 *  used to be parsed as the whole registry. */
final class AtomicJson {
    private AtomicJson() {}

    static byte[] readBytes(File file) throws IOException {
        int size = (int) file.length();
        byte[] buf = new byte[size];
        int off = 0;
        try (FileInputStream in = new FileInputStream(file)) {
            while (off < size) {
                int n = in.read(buf, off, size - off);
                if (n < 0) break;
                off += n;
            }
        }
        if (off == size) return buf;
        byte[] partial = new byte[Math.max(off, 0)];
        if (off > 0) System.arraycopy(buf, 0, partial, 0, off);
        return partial;
    }

    static void writeBytes(File dest, byte[] bytes) throws IOException {
        File dir = dest.getParentFile();
        File tmp = new File(dir, dest.getName() + ".tmp");
        try (FileOutputStream fos = new FileOutputStream(tmp)) {
            fos.write(bytes);
            fos.getFD().sync();
        }
        if (!tmp.renameTo(dest)) {
            tmp.delete();
            throw new IOException("Could not replace " + dest.getName());
        }
    }
}
