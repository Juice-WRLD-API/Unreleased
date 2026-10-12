# unreleased — iOS

A sideloaded iPhone and iPad build of the Juice WRLD music player. It uses the same catalog and shared interface as the web player and desktop app, packaged for iOS with [Capacitor](https://capacitorjs.com) and powered by the [Juice WRLD API](https://juicewrldapi.com).

> This app is not distributed through the App Store. iOS releases are provided as unsigned IPA files that must be signed and sideloaded with your own Apple ID.

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Capacitor](https://img.shields.io/badge/Capacitor-iOS-119EFF?logo=capacitor&logoColor=white)
![iOS](https://img.shields.io/badge/iOS-15%2B-000000?logo=apple&logoColor=white)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/jwa)

**Get the app:** [iOS releases](https://github.com/Juice-WRLD-API/Unreleased/releases?q=ios-v&expanded=true) — download the newest `Unreleased-ios-v*.ipa`.

---

## Install

1. Download the latest IPA from the [iOS releases page](https://github.com/Juice-WRLD-API/Unreleased/releases?q=ios-v&expanded=true).
2. Sign and install it with an iOS sideloading tool such as AltStore or Sideloadly.
3. Trust the developer profile in iOS Settings if prompted.

The app requires **iOS 15.0 or newer**. Releases are unsigned because the project does not use an Apple Developer signing certificate in CI.

---

## Features

The iOS app carries over the shared player's core experience, including the catalog, streaming, search, playlists, lyrics, Tracker, 999 FM, Heardle, Wordle, Wrapped, skins, fonts, account features, and encrypted chat with device linking.

Downloaded files and exports are saved in **Files → On My iPhone (or iPad) → Unreleased**. Playback uses the device's volume buttons; crossfade and audio effects are unavailable on iOS to preserve background audio.

Some desktop-only integrations are not available on iOS, including format conversion, importing from YouTube or other URLs, Discord Rich Presence, and local metadata editing.

---

## Development

Web development works anywhere Node.js is supported. Building or running the native iOS app requires macOS and Xcode.

```bash
# Install the locked dependencies
npm ci

# Run the shared web interface at http://localhost:3018
npm run dev

# Build the web bundle and sync it into the iOS project
npm run ios:sync

# Open the native project in Xcode
open ios/App/App.xcodeproj
```

Choose an iOS simulator or a provisioned device in Xcode, then build and run the `App` scheme.

---

## Releases

iOS releases use `ios-v*` tags. GitHub Actions builds an unsigned IPA and attaches it to the matching GitHub release as `Unreleased-ios-v*.ipa`.

This branch shares most of its interface and history with the [`app`](https://github.com/Juice-WRLD-API/Unreleased/tree/app) branch. See the [main changelog](https://github.com/Juice-WRLD-API/Unreleased/blob/app/CHANGELOG.md) for the broader project history.

---

## Stack

- **React 18** and **TypeScript 5** — shared application interface
- **Vite 6** — development server and web bundler
- **Capacitor 8** — native iOS wrapper
- **Swift and Xcode** — native application project and packaging
- **[juicewrldapi.com](https://juicewrldapi.com)** — songs, streaming, lyrics, eras, playlists, and authentication

---

## Credits

- **[juicewrldapi.com](https://juicewrldapi.com)** — the API powering the catalog, streaming, lyrics, eras, categories, accounts, and file browser
- **juicewrldapi** on Discord — help and support building the integration
- Built by **freakylatif** — find me on Discord
- Join the **[Discord](https://discord.gg/jwa)** server

---

## License

MIT
