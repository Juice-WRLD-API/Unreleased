import AppIntents

// Siri / Shortcuts actions. Each one only queues a command for the renderer
// (SiriCommandCenter); playback lives in the WebView, so these have to run in
// the app process.
//
// Transport intents (pause / next / previous / like / shuffle) don't open the
// app: they act on playback that's already running in the background. Intents
// that start something (resume, play a song) bring the app forward, because
// the WebView needs a live scene to load and start audio.
//
// App Intents are iOS 16+; the deployment target stays 15, so everything here
// is availability-gated and older systems simply don't get the actions.

@available(iOS 16.0, *)
struct ResumePlaybackIntent: AppIntent {
    static var title: LocalizedStringResource = "Resume Playback"
    static var description = IntentDescription("Resume the current song.")
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        SiriCommandCenter.shared.send("play")
        return .result()
    }
}

@available(iOS 16.0, *)
struct PausePlaybackIntent: AppIntent {
    static var title: LocalizedStringResource = "Pause Playback"
    static var description = IntentDescription("Pause the current song.")

    func perform() async throws -> some IntentResult {
        SiriCommandCenter.shared.send("pause")
        return .result()
    }
}

@available(iOS 16.0, *)
struct NextTrackIntent: AppIntent {
    static var title: LocalizedStringResource = "Next Song"
    static var description = IntentDescription("Skip to the next song.")

    func perform() async throws -> some IntentResult {
        SiriCommandCenter.shared.send("next")
        return .result()
    }
}

@available(iOS 16.0, *)
struct PreviousTrackIntent: AppIntent {
    static var title: LocalizedStringResource = "Previous Song"
    static var description = IntentDescription("Go back to the previous song.")

    func perform() async throws -> some IntentResult {
        SiriCommandCenter.shared.send("previous")
        return .result()
    }
}

@available(iOS 16.0, *)
struct ToggleShuffleIntent: AppIntent {
    static var title: LocalizedStringResource = "Toggle Shuffle"
    static var description = IntentDescription("Turn shuffle on or off.")

    func perform() async throws -> some IntentResult {
        SiriCommandCenter.shared.send("toggleShuffle")
        return .result()
    }
}

@available(iOS 16.0, *)
struct LikeCurrentTrackIntent: AppIntent {
    static var title: LocalizedStringResource = "Like Current Song"
    static var description = IntentDescription("Add the playing song to your liked songs.")

    func perform() async throws -> some IntentResult {
        SiriCommandCenter.shared.send("like")
        return .result()
    }
}

@available(iOS 16.0, *)
struct PlaySongIntent: AppIntent {
    static var title: LocalizedStringResource = "Play a Song"
    static var description = IntentDescription("Search for a song and play the best match.")
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Song", requestValueDialog: "Which song?")
    var song: String

    static var parameterSummary: some ParameterSummary {
        Summary("Play \(\.$song)")
    }

    func perform() async throws -> some IntentResult {
        SiriCommandCenter.shared.send("playSong", query: song)
        return .result()
    }
}

// Phrases must contain the app name; string parameters can't appear in them,
// so "Play a song" makes Siri ask which one.
@available(iOS 16.0, *)
struct UnreleasedShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: PlaySongIntent(),
            phrases: ["Play a song in \(.applicationName)", "Play a song on \(.applicationName)"],
            shortTitle: "Play a Song",
            systemImageName: "music.note"
        )
        AppShortcut(
            intent: ResumePlaybackIntent(),
            phrases: ["Resume \(.applicationName)", "Play \(.applicationName)"],
            shortTitle: "Resume",
            systemImageName: "play.fill"
        )
        AppShortcut(
            intent: PausePlaybackIntent(),
            phrases: ["Pause \(.applicationName)"],
            shortTitle: "Pause",
            systemImageName: "pause.fill"
        )
        AppShortcut(
            intent: NextTrackIntent(),
            phrases: ["Next song in \(.applicationName)", "Skip in \(.applicationName)"],
            shortTitle: "Next Song",
            systemImageName: "forward.fill"
        )
        AppShortcut(
            intent: PreviousTrackIntent(),
            phrases: ["Previous song in \(.applicationName)"],
            shortTitle: "Previous Song",
            systemImageName: "backward.fill"
        )
        AppShortcut(
            intent: ToggleShuffleIntent(),
            phrases: ["Toggle shuffle in \(.applicationName)"],
            shortTitle: "Toggle Shuffle",
            systemImageName: "shuffle"
        )
        AppShortcut(
            intent: LikeCurrentTrackIntent(),
            phrases: ["Like this song in \(.applicationName)"],
            shortTitle: "Like Song",
            systemImageName: "heart.fill"
        )
    }
}
