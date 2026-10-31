// Run on a machine with Swift:
// swiftc ios/App/App/LocalMP3Tags.swift scripts/LocalMP3TagsTests.swift -o /tmp/local-tags-tests && /tmp/local-tags-tests
import Foundation

@main
struct LocalMP3TagsTests {
    static func size(_ value: Int, sync: Bool) -> Data {
        let step = sync ? 7 : 8
        return Data((0..<4).reversed().map { UInt8((value >> ($0 * step)) & (sync ? 127 : 255)) })
    }
    static func frame(_ id: String, _ payload: Data, version: Int) -> Data {
        var data = Data(id.utf8); data.append(size(payload.count, sync: version == 4))
        data.append(contentsOf: [0, 0]); data.append(payload); return data
    }
    static func main() throws {
        var audio = Data(repeating: 0, count: 4170)
        for i in stride(from: 0, to: audio.count, by: 417) { audio[i] = 0xff; audio[i + 1] = 0xfb; audio[i + 2] = 0x90 }
        for version in [3, 4] {
            let picture = frame("APIC", Data([0, 1, 2, 3, 4]), version: version)
            let lyrics = frame("USLT", Data([0, 101, 110, 103, 0, 108, 121, 114, 105, 99, 115]), version: version)
            let unknown = frame("TXXX", Data([0, 99, 117, 115, 116, 111, 109]), version: version)
            var body = picture; body.append(lyrics); body.append(unknown)
            body.append(frame("TIT2", Data([0]) + Data("Before".utf8), version: version))
            var source = Data([73, 68, 51, UInt8(version), 0, 0]); source.append(size(body.count, sync: true)); source.append(body); source.append(audio)
            let edited = try LocalMP3Tags.edit(source, changes: ["title": "After \u{00e7}", "year": "2026", "trackNumber": "2/12"])
            precondition(edited.suffix(audio.count) == audio, "Audio bytes changed")
            for preserved in [picture, lyrics, unknown] { precondition(edited.range(of: preserved) != nil, "Untouched frame changed") }
            precondition(edited.range(of: Data("Before".utf8)) == nil, "Old title retained")
            precondition(edited.range(of: Data((version == 4 ? "TDRC" : "TYER").utf8)) != nil, "Wrong year frame")
            let cleared = try LocalMP3Tags.edit(edited, changes: ["title": ""])
            precondition(cleared.range(of: Data("TIT2".utf8)) == nil, "Title not cleared")
            precondition(cleared.suffix(audio.count) == audio, "Clearing changed audio")
            var flagged = source; flagged[5] = 0x80
            do { _ = try LocalMP3Tags.edit(flagged, changes: ["title": "x"]); preconditionFailure("Unsupported flags accepted") }
            catch is LocalTagError { }
            var truncated = source; truncated[9] = 127; truncated.removeLast(audio.count)
            do { _ = try LocalMP3Tags.edit(truncated, changes: ["title": "x"]); preconditionFailure("Truncated tag accepted") }
            catch is LocalTagError { }
        }
        let added = try LocalMP3Tags.edit(audio, changes: ["title": "New"])
        precondition(added.suffix(audio.count) == audio)
        let cleared = try LocalMP3Tags.edit(added, changes: ["title": ""])
        precondition(cleared == audio, "Clearing last frame should remove the tag")
        for changes in [["year": "bad"], ["trackNumber": "0"], ["unknown": "value"]] {
            do { _ = try LocalMP3Tags.edit(audio, changes: changes); preconditionFailure("Invalid change accepted") }
            catch is LocalTagError { }
        }
        print("MP3 tag preservation, audio, clearing, version and validation checks passed.")
    }
}
