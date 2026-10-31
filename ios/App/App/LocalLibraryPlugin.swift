import AVFoundation
import Capacitor
import Foundation
import UIKit
import UniformTypeIdentifiers

@objc(LocalLibraryPlugin)
public class LocalLibraryPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "LocalLibraryPlugin"
    public let jsName = "LocalLibrary"
    public let pluginMethods: [CAPPluginMethod] = [
        "pickFolder", "pickFiles", "pickTextFile", "releaseSource", "sourceLabel", "scan", "getArt",
        "writeTags", "saveLibrary", "loadLibrary", "savePlaylists", "loadPlaylists"
    ].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }

    // A single queue serializes scans, saves and bookmark changes. Keep source scopes open for WebView playback.
    private let worker = DispatchQueue(label: "unreleased.local-library", qos: .userInitiated)
    private var scopes: [String: URL] = [:]
    private var pickerCall: CAPPluginCall?
    private var pickerKind = ""
    private let bookmarkKey = "localLibraryBookmarks"
    private let extensions: Set<String> = ["mp3", "m4a", "aac", "wav", "aiff", "aif", "caf", "flac", "alac"]

    public override func load() {
        worker.async { self.restoreScopes() }
    }

    deinit { for url in scopes.values { url.stopAccessingSecurityScopedResource() } }

    private func bookmarks() -> [String: Data] { UserDefaults.standard.dictionary(forKey: bookmarkKey) as? [String: Data] ?? [:] }

    private func restoreScopes() {
        var stored = bookmarks()
        for (key, data) in stored where scopes[key] == nil {
            var stale = false
            guard let url = try? URL(resolvingBookmarkData: data, options: [.withoutUI], relativeTo: nil, bookmarkDataIsStale: &stale),
                  url.startAccessingSecurityScopedResource() else { continue }
            scopes[key] = url
            if stale, let refreshed = try? url.bookmarkData(options: [.minimalBookmark], includingResourceValuesForKeys: nil, relativeTo: nil) { stored[key] = refreshed }
        }
        UserDefaults.standard.set(stored, forKey: bookmarkKey)
    }

    private func remember(_ url: URL) throws {
        let started = url.startAccessingSecurityScopedResource()
        defer { if started { url.stopAccessingSecurityScopedResource() } }
        let data = try url.bookmarkData(options: [.minimalBookmark], includingResourceValuesForKeys: nil, relativeTo: nil)
        var stored = bookmarks()
        let key = url.absoluteString
        stored[key] = data
        UserDefaults.standard.set(stored, forKey: bookmarkKey)
        if let old = scopes.removeValue(forKey: key) { old.stopAccessingSecurityScopedResource() }
        if url.startAccessingSecurityScopedResource() { scopes[key] = url }
    }

    private func authorizedURL(_ value: String) throws -> URL {
        restoreScopes()
        guard let requested = URL(string: value), requested.isFileURL else { throw LocalTagError.message("Invalid local file URL.") }
        let path = requested.standardizedFileURL.resolvingSymlinksInPath().path
        for (key, root) in scopes {
            if key == value { return root }
            let rootPath = root.standardizedFileURL.resolvingSymlinksInPath().path
            if path == rootPath || path.hasPrefix(rootPath + "/") { return requested }
        }
        throw LocalTagError.message("File access has expired. Add the folder or file again in Library settings.")
    }

    private func run(_ call: CAPPluginCall, _ body: @escaping () throws -> JSObject) {
        worker.async {
            do { call.resolve(try body()) }
            catch { call.reject(error.localizedDescription) }
        }
    }

    private func pick(_ call: CAPPluginCall, kind: String) {
        DispatchQueue.main.async {
            guard self.pickerCall == nil else { call.reject("A file picker is already open."); return }
            guard let controller = self.bridge?.viewController else { call.reject("The file picker is unavailable."); return }
            self.pickerCall = call
            self.pickerKind = kind
            let types: [UTType] = kind == "folder" ? [.folder] : kind == "text" ? [.item] : [.audio]
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: false)
            picker.allowsMultipleSelection = kind == "files"
            picker.delegate = self
            controller.present(picker, animated: true)
        }
    }

    @objc func pickFolder(_ call: CAPPluginCall) { pick(call, kind: "folder") }
    @objc func pickFiles(_ call: CAPPluginCall) { pick(call, kind: "files") }
    @objc func pickTextFile(_ call: CAPPluginCall) { pick(call, kind: "text") }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pickerCall?.resolve(["canceled": true]); pickerCall = nil
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pickerCall else { return }
        let kind = pickerKind
        pickerCall = nil
        run(call) {
            guard let first = urls.first else { return ["canceled": true] }
            if kind == "text" {
                let started = first.startAccessingSecurityScopedResource()
                defer { if started { first.stopAccessingSecurityScopedResource() } }
                let text: String = try self.coordinatedRead(first) { url in
                    let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                    guard size <= 5 * 1024 * 1024 else { throw LocalTagError.message("This text file is too large.") }
                    return try String(contentsOf: url, encoding: .utf8)
                }
                return ["name": first.lastPathComponent, "text": text]
            }
            for url in urls { try self.remember(url) }
            if kind == "folder" { return ["uri": first.absoluteString, "name": first.lastPathComponent] }
            return ["uris": urls.map { $0.absoluteString }]
        }
    }

    @objc func releaseSource(_ call: CAPPluginCall) {
        run(call) {
            let key = call.getString("uri") ?? ""
            var stored = self.bookmarks(); stored.removeValue(forKey: key)
            UserDefaults.standard.set(stored, forKey: self.bookmarkKey)
            if let url = self.scopes.removeValue(forKey: key) { url.stopAccessingSecurityScopedResource() }
            return [:]
        }
    }

    @objc func sourceLabel(_ call: CAPPluginCall) {
        call.resolve(["value": URL(string: call.getString("uri") ?? "")?.lastPathComponent ?? "Music"])
    }

    private func coordinatedRead<T>(_ url: URL, body: (URL) throws -> T) throws -> T {
        var coordinationError: NSError?
        var result: Result<T, Error>?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { target in
            result = Result { try body(target) }
        }
        if let error = coordinationError { throw error }
        guard let result = result else { throw LocalTagError.message("Could not open this file.") }
        return try result.get()
    }

    private func metadata(_ url: URL) throws -> JSObject {
        let asset = AVURLAsset(url: url)
        guard asset.isPlayable else { throw LocalTagError.message("This audio file cannot be read.") }
        let items = asset.metadata
        func string(_ identifier: AVMetadataIdentifier) -> String {
            AVMetadataItem.metadataItems(from: items, filteredByIdentifier: identifier).first?.stringValue ?? ""
        }
        func common(_ key: AVMetadataKey) -> String {
            asset.commonMetadata.first { $0.commonKey == key }?.stringValue ?? ""
        }
        func number(_ value: String) -> JSValue {
            if let number = Int(value.split(separator: "/").first.map(String.init) ?? "") { return number }
            return NSNull()
        }
        let info = try url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
        let title = common(.commonKeyTitle)
        let artist = common(.commonKeyArtist)
        let albumArtist = string(.id3MetadataBand)
        let seconds = CMTimeGetSeconds(asset.duration)
        let year = string(.id3MetadataYear).isEmpty ? common(.commonKeyCreationDate) : string(.id3MetadataYear)
        return ["id": "local-" + url.absoluteString, "filePath": url.absoluteString,
                "ext": url.pathExtension.lowercased(), "title": title.isEmpty ? url.deletingPathExtension().lastPathComponent : title,
                "artist": artist, "album": common(.commonKeyAlbumName), "albumArtist": albumArtist.isEmpty ? artist : albumArtist,
                "composer": string(.id3MetadataComposer), "genre": string(.id3MetadataContentType),
                "year": number(String(year.prefix(4))), "trackNumber": number(string(.id3MetadataTrackNumber)),
                "discNumber": number(string(.id3MetadataPartOfASet)), "duration": seconds.isFinite ? seconds : 0,
                "bitrate": NSNull(), "sampleRate": NSNull(), "fileSize": info.fileSize ?? 0,
                "lastModified": (info.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000,
                "hasAlbumArt": asset.commonMetadata.contains { $0.commonKey == .commonKeyArtwork },
                "addedAt": Date().timeIntervalSince1970 * 1000]
    }

    @objc func scan(_ call: CAPPluginCall) {
        run(call) {
            let sources = call.getArray("sources", String.self) ?? []
            let knownRows = call.getArray("known", JSObject.self) ?? []
            var known: [String: JSObject] = [:]
            for row in knownRows { if let id = row["id"] as? String { known[id] = row } }
            var tracks: [JSObject] = []
            var seen = Set<String>()
            var found = 0, parsed = 0
            func collect(_ file: URL) throws {
                guard self.extensions.contains(file.pathExtension.lowercased()), seen.insert(file.absoluteString).inserted else { return }
                let row: JSObject = try self.coordinatedRead(file) { target in
                    let info = try target.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey])
                    guard info.isRegularFile == true else { return [:] }
                    found += 1
                    let id = "local-" + file.absoluteString
                    let modified = (info.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000
                    if let old = known[id], (old["fileSize"] as? NSNumber)?.intValue == info.fileSize,
                       (old["lastModified"] as? NSNumber)?.doubleValue == modified {
                        return ["id": id, "unchanged": true]
                    }
                    guard var meta = try? self.metadata(target) else { return [:] }
                    meta["id"] = id; meta["filePath"] = file.absoluteString
                    parsed += 1
                    return meta
                }
                if !row.isEmpty { tracks.append(row) }
                if found == 1 || found % 25 == 0 { self.notifyListeners("scanProgress", data: ["found": found, "parsed": parsed]) }
            }
            for source in sources {
                let root = try self.authorizedURL(source)
                let isDirectory = try root.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true
                if isDirectory {
                    var enumerationError: Error?
                    let files: [URL] = try self.coordinatedRead(root) { target in
                        guard let enumerator = FileManager.default.enumerator(at: target, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles, .skipsPackageDescendants], errorHandler: { _, error in enumerationError = error; return false }) else {
                            throw LocalTagError.message("Could not read this folder.")
                        }
                        return enumerator.allObjects.compactMap { $0 as? URL }
                    }
                    if let error = enumerationError { throw error }
                    for file in files { try collect(file) }
                } else { try collect(root) }
            }
            self.notifyListeners("scanProgress", data: ["found": found, "parsed": parsed])
            return ["tracks": tracks]
        }
    }

    @objc func getArt(_ call: CAPPluginCall) {
        run(call) {
            let url = try self.authorizedURL(call.getString("uri") ?? "")
            let art: String? = try self.coordinatedRead(url) { target in
                let items = AVURLAsset(url: target).commonMetadata
                guard let data = items.first(where: { $0.commonKey == .commonKeyArtwork })?.dataValue,
                      let image = UIImage(data: data) else { return nil }
                let scale = min(1, 600 / max(image.size.width, image.size.height))
                let size = CGSize(width: max(1, image.size.width * scale), height: max(1, image.size.height * scale))
                let format = UIGraphicsImageRendererFormat(); format.scale = 1
                let thumbnail = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
                return thumbnail.jpegData(compressionQuality: 0.85).map { "data:image/jpeg;base64," + $0.base64EncodedString() }
            }
            if let art = art { return ["art": art] }
            return ["art": NSNull()]
        }
    }

    @objc func writeTags(_ call: CAPPluginCall) {
        run(call) {
            let value = call.getString("uri") ?? ""
            let url = try self.authorizedURL(value)
            guard url.pathExtension.lowercased() == "mp3", let changes = call.getObject("changes") as? [String: String], !changes.isEmpty else {
                throw LocalTagError.message("Choose an MP3 file and change at least one tag.")
            }
            var coordinationError: NSError?
            var outcome: Result<JSObject, Error>?
            NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordinationError) { target in
                outcome = Result {
                    let size = try target.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                    guard size <= 256 * 1024 * 1024 else { throw LocalTagError.message("Tag editing supports files up to 256 MB.") }
                    let original = try Data(contentsOf: target)
                    let edited = try LocalMP3Tags.edit(original, changes: changes)
                    let backup = try self.storageURL("tag-backup-" + UUID().uuidString + ".mp3")
                    try original.write(to: backup, options: .atomic)
                    var keepBackup = false
                    defer { if !keepBackup { try? FileManager.default.removeItem(at: backup) } }
                    do {
                        try edited.write(to: target, options: .atomic)
                        guard try Data(contentsOf: target) == edited else { throw LocalTagError.message("The saved file did not match.") }
                        var track = try self.metadata(target)
                        track["id"] = "local-" + value; track["filePath"] = value
                        return ["track": track]
                    } catch {
                        let saveError = error
                        do {
                            try original.write(to: target, options: .atomic)
                            guard try Data(contentsOf: target) == original else { throw LocalTagError.message("Restore verification failed.") }
                        } catch {
                            keepBackup = true
                            throw LocalTagError.message("Saving and restoring failed. Original backup retained at \(backup.path).")
                        }
                        throw LocalTagError.message("Could not save tags; the original was restored. \(saveError.localizedDescription)")
                    }
                }
            }
            if let error = coordinationError { throw error }
            guard let outcome = outcome else { throw LocalTagError.message("Could not write this file.") }
            return try outcome.get()
        }
    }

    private func storageURL(_ name: String) throws -> URL {
        let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let directory = root.appendingPathComponent("LocalLibrary", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent(name)
    }

    private func save(_ call: CAPPluginCall, name: String) {
        run(call) {
            guard let json = call.getString("json"), let data = json.data(using: .utf8) else { throw LocalTagError.message("Missing library data.") }
            try data.write(to: self.storageURL(name), options: .atomic)
            return [:]
        }
    }
    private func load(_ call: CAPPluginCall, name: String) {
        run(call) {
            let url = try self.storageURL(name)
            if !FileManager.default.fileExists(atPath: url.path) { return ["json": NSNull()] }
            return ["json": try String(contentsOf: url, encoding: .utf8)]
        }
    }
    @objc func saveLibrary(_ call: CAPPluginCall) { save(call, name: "library.json") }
    @objc func loadLibrary(_ call: CAPPluginCall) { load(call, name: "library.json") }
    @objc func savePlaylists(_ call: CAPPluginCall) { save(call, name: "playlists.json") }
    @objc func loadPlaylists(_ call: CAPPluginCall) { load(call, name: "playlists.json") }
}
