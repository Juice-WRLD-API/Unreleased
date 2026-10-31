import Foundation

enum LocalTagError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}

// Preserve untouched frames and the complete audio payload rather than exporting/re-encoding audio.
enum LocalMP3Tags {
    static func edit(_ source: Data, changes: [String: String]) throws -> Data {
        guard source.count >= 10 else { throw LocalTagError.message("This MP3 file is incomplete.") }
        var version = 4
        var audioStart = 0
        var frames: [(String, Data)] = []
        func number(_ bytes: Data, syncSafe: Bool) throws -> Int {
            var result = 0
            for byte in bytes {
                if syncSafe && byte > 127 { throw LocalTagError.message("Invalid ID3 size.") }
                result = (result << (syncSafe ? 7 : 8)) | Int(byte)
            }
            return result
        }
        if source.prefix(3) == Data("ID3".utf8) {
            version = Int(source[3])
            guard (version == 3 || version == 4), source[4] == 0, source[5] == 0 else {
                throw LocalTagError.message("This file uses an unsupported ID3 variant. Convert its tags to standard ID3v2.3 or ID3v2.4 first. The original is unchanged.")
            }
            audioStart = 10 + (try number(source.subdata(in: 6..<10), syncSafe: true))
            guard audioStart <= source.count else { throw LocalTagError.message("The ID3 tag is truncated.") }
            var offset = 10
            while offset < audioStart {
                if source[offset] == 0 {
                    guard source[offset..<audioStart].allSatisfy({ $0 == 0 }) else { throw LocalTagError.message("Invalid ID3 padding.") }
                    break
                }
                guard offset + 10 <= audioStart else { throw LocalTagError.message("Truncated ID3 frame.") }
                let idBytes = source.subdata(in: offset..<(offset + 4))
                guard idBytes.allSatisfy({ (65...90).contains($0) || (48...57).contains($0) }),
                      let id = String(data: idBytes, encoding: .ascii) else { throw LocalTagError.message("Invalid ID3 frame.") }
                let size = try number(source.subdata(in: (offset + 4)..<(offset + 8)), syncSafe: version == 4)
                let end = offset + 10 + size
                guard end <= audioStart else { throw LocalTagError.message("Truncated ID3 frame payload.") }
                frames.append((id, source.subdata(in: offset..<end)))
                offset = end
            }
        }
        var payload = source.subdata(in: audioStart..<source.count)
        guard payload.count >= 2, payload[0] == 0xff, payload[1] & 0xe0 == 0xe0 else {
            throw LocalTagError.message("This file does not contain supported MP3 audio.")
        }
        func encodedSize(_ value: Int, syncSafe: Bool) -> Data {
            let step = syncSafe ? 7 : 8
            let mask = syncSafe ? 127 : 255
            return Data((0..<4).reversed().map { UInt8((value >> ($0 * step)) & mask) })
        }
        func textFrame(_ id: String, _ text: String) -> Data {
            var body = Data([1, 0xff, 0xfe]) // UTF-16LE with BOM, valid in v2.3 and v2.4.
            for unit in text.utf16 { body.append(UInt8(unit & 255)); body.append(UInt8(unit >> 8)) }
            var frame = Data(id.utf8)
            frame.append(encodedSize(body.count, syncSafe: version == 4))
            frame.append(contentsOf: [0, 0]); frame.append(body)
            return frame
        }
        let ids = ["title": "TIT2", "artist": "TPE1", "album": "TALB", "albumArtist": "TPE2",
                   "composer": "TCOM", "genre": "TCON", "year": version == 4 ? "TDRC" : "TYER",
                   "trackNumber": "TRCK", "discNumber": "TPOS"]
        let legacyStart = payload.count - 128
        let hasLegacy = legacyStart >= 0 && payload.subdata(in: legacyStart..<(legacyStart + 3)) == Data("TAG".utf8)
        let legacyFields = ["title": (3, 30), "artist": (33, 30), "album": (63, 30), "year": (93, 4)]
        // Seed fields from ID3v1 before adding a first v2 tag, so readers don't lose legacy metadata.
        if audioStart == 0 && hasLegacy {
            for (key, range) in legacyFields {
                let data = payload.subdata(in: (legacyStart + range.0)..<(legacyStart + range.0 + range.1))
                let text = String(data: data, encoding: .isoLatin1)?.trimmingCharacters(in: .whitespacesAndNewlines.union(.controlCharacters)) ?? ""
                if !text.isEmpty, let id = ids[key] { frames.append((id, textFrame(id, text))) }
            }
            if payload[legacyStart + 125] == 0 && payload[legacyStart + 126] > 0 {
                frames.append(("TRCK", textFrame("TRCK", String(payload[legacyStart + 126]))))
            }
            if payload[legacyStart + 127] < 255 {
                frames.append(("TCON", textFrame("TCON", "(\(payload[legacyStart + 127]))")))
            }
        }
        for (key, input) in changes.sorted(by: { $0.key < $1.key }) {
            guard let id = ids[key] else { throw LocalTagError.message("Unsupported tag: \(key)") }
            let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty && key == "year" && value.range(of: "^[0-9]{4}$", options: .regularExpression) == nil {
                throw LocalTagError.message("Year must contain four digits.")
            }
            if !value.isEmpty && (key == "trackNumber" || key == "discNumber") && value.range(of: "^[1-9][0-9]{0,3}(/[1-9][0-9]{0,3})?$", options: .regularExpression) == nil {
                throw LocalTagError.message("Track and disc must be positive numbers, optionally followed by /total.")
            }
            frames.removeAll { $0.0 == id || (key == "year" && $0.0 == "TYER") }
            if !value.isEmpty { frames.append((id, textFrame(id, value))) }
            // Clear the corresponding legacy value, preventing stale fallback after clearing a v2 field.
            if hasLegacy {
                if let range = legacyFields[key] {
                    payload.replaceSubrange((legacyStart + range.0)..<(legacyStart + range.0 + range.1), with: repeatElement(UInt8(0), count: range.1))
                } else if key == "genre" { payload[legacyStart + 127] = 255 }
                else if key == "trackNumber" && payload[legacyStart + 125] == 0 { payload[legacyStart + 126] = 0 }
            }
        }
        var body = Data()
        for (_, frame) in frames { body.append(frame) }
        if body.isEmpty { return payload }
        guard body.count < 0x10000000 else { throw LocalTagError.message("Tags are too large.") }
        var output = Data([0x49, 0x44, 0x33, UInt8(version), 0, 0])
        output.append(encodedSize(body.count, syncSafe: true)); output.append(body); output.append(payload)
        return output
    }
}
