# Relay Log

Tracks cross-branch "relay" merges — where work from one platform branch
(app/android/ios) is ported into another. Most relays so far have landed on
`web`, but this file covers relays onto **any** branch, not just web — this
file lives only on `app` (removed from android/ios/web to avoid duplication),
but since `app` holds the actual repository that all other branches are
worktrees of, `git log --all` from here sees every branch's full history
regardless of which branch this file is checked out on.

Each entry: the relay commit, the branch it landed on, that branch's version at
the commit, and the `app` branch's version as of the same time.

## Entries

| Date (UTC+3) | Relay commit | Landed on | Branch version | app version | Summary |
|---|---|---|---|---|---|
| 2026-10-10 03:48:55 | [`f7481f2`](https://github.com/Juice-WRLD-API/Unreleased/commit/f7481f205cb04b4afb7085cfc643a0f65af474e8) | app | 2.2.9 | 2.2.9 | Relay web `97b9ab6`: dedupe the pending song reports request (profile page asked twice) and stop refetching the global leaderboard on channel switch |
| 2026-10-09 22:37:22 | [`facbdb3`](https://github.com/Juice-WRLD-API/Unreleased/commit/facbdb3d20ed2b502010ec3d72ead922cff89b90) | app | 2.2.8 | 2.2.8 | Relay web `0582614`: CDN node binary upload (platform + version + file, progress bar) in the admin CDN nodes tab. Desktop tab only; web's mobile tab has no counterpart on app |
| 2026-10-09 16:24:20 | [`62960c6`](https://github.com/Juice-WRLD-API/Unreleased/commit/62960c6346911976cab13f66598533e76a510584) | web | 2.1.0 | 2.2.7 | Relay app `61a77b0`: Pill nav style now locks auto-hide off (was locked on) |
| 2026-10-09 04:45:24 | [`1e09345`](https://github.com/Juice-WRLD-API/Unreleased/commit/1e093455) | web | 2.1.0 | 2.2.7 | Mirror of app `c68cde1`: fix news Copy link, add Copy link button to the article page |
| 2026-10-09 04:44:44 | [`0071402`](https://github.com/Juice-WRLD-API/Unreleased/commit/00714027) | web | 2.1.0 | 2.2.7 | Mirror of app `6685e9b`: stacked avatars for group chats in the chat rail |
| 2026-10-09 04:38:08 | [`1cc2940`](https://github.com/Juice-WRLD-API/Unreleased/commit/1cc29406) | web | 2.1.0 | 2.2.6 | Relay pill nav drag-to-edge (NavPillGrip) from app (`9dbdc68`) |
| 2026-10-09 04:31:35 | [`4b32a6a`](https://github.com/Juice-WRLD-API/Unreleased/commit/4b32a6a7) | web | 2.1.0 | 2.2.6 | Mirror of app `45fb633`: remove max width cap on Home page |
| 2026-10-09 04:28:46 | [`9e87e03`](https://github.com/Juice-WRLD-API/Unreleased/commit/9e87e037) | web | 2.1.0 | 2.2.6 | Mobile pass of the above: WRLD mobile transport via `runPlayerCommand`, `prevTrack` restart logic dropped, mobile Credits card, explicit playback contexts in Heardle/Stats mobile |
| 2026-10-09 04:27:02 | [`e5a1647`](https://github.com/Juice-WRLD-API/Unreleased/commit/e5a1647f) | web | 2.1.0 | 2.2.6 | Relay from app: playback recovery/transport hardening (choz-dev series), standalone `playTrack`, Settings Credits, shared `ContextMenu` + `ChangeVersionPanel` (desktop menus migrated) |
| 2026-08-26 00:41:38 | [`312d487`](https://github.com/Juice-WRLD-API/Unreleased/commit/312d487) | web | 2.0.9 | 2.1.6 | Relay queue reshuffle, full era names, lyrics collapse/toggle, sandbox modal fixes, comp-proposal cancel-all, admin immediate-apply |
| 2026-08-20 03:33:50 | [`8a39610`](https://github.com/Juice-WRLD-API/Unreleased/commit/8a39610c30a28c29f955b1c18111fdf68427ad44) | web | 2.0.6 | 2.0.10 | Add Channels feature, relay app/android admin+editor+docs+news+stats+settings work, fix mobile Settings full-page render |
| 2026-08-20 03:32:51 | [`3fc57d9`](https://github.com/Juice-WRLD-API/Unreleased/commit/3fc57d905e4ec03033608242a18b7cc7ae9f9415) | web | 2.0.5 | 2.0.10 | Add era covers, EQ volume boost, queue search; relay from android |
| 2026-08-19 18:48:51 | [`a4ef317`](https://github.com/Juice-WRLD-API/Unreleased/commit/a4ef317b83185a50f5dc46511721a9aa714a1b0d) | claude/fervent-boyd-70a994 | 2.0.5 | 2.0.7 | Add era covers, EQ volume boost, queue search; relay from android |

## How to add a new entry

```bash
# find relay commits not yet logged
git log --all --oneline -i --grep="relay"

# version on the branch the relay commit landed on
git show <commit>:package.json | grep version

# app version as of the same timestamp
ts=$(git show -s --format=%ci <commit>)
app_commit=$(git rev-list -1 --before="$ts" app)
git show "$app_commit:package.json" | grep version
```
