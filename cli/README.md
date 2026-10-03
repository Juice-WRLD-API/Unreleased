# unreleased-cli

The site's terminal as a command-line shell. You can browse the Files tab's channels as a folder tree, read text files, search, and download straight to disk. It uses the same API as the site.

```
guest@unreleased:~/files/comp$ ls
     <dir>  Compilation/
     <dir>  Snippets/
     ...
guest@unreleased:~/files/comp$ get -o covers "Compilation/4. Cover Art"
saved 44 files (25.9 MB) to covers
```

## Install

```
cd cli
npm install
npm run build
npm link          # puts `unreleased` on your PATH
```

You can also run it without linking: `node cli/dist/unreleased.mjs`. It needs Node 20 or newer and has no runtime dependencies. Playback also needs [mpv](https://mpv.io) (`winget install shinchiro.mpv`, `brew install mpv`, or your package manager).

## Use

| | |
|---|---|
| `unreleased` | Open the interactive shell. |
| `unreleased ls Snippets` | Run one command and exit. The exit code is 1 if the command failed. |
| `unreleased < script.txt` | Run each line of a file. Lines starting with `#` are comments. |

The shell starts in the main channel (`comp`). `cd /` lists every channel, and `cd` on its own takes you back.

Commands (type `help <command>` in the shell for the details of each one):

- **Files:** `cd`, `ls`, `pwd`, `lcd`, `get`, `cat`, `head`, `tail`, `wc`, `grep`, `locate`, `tree`, `du`
- **Library:** `find`, `song`, `like`, `unlike`, `liked`, `playlists`, `playlist`, `stats`
- **Player:** `play`, `pause`, `toggle`, `next`, `prev`, `seek`, `volume`, `speed`, `shuffle`, `repeat`, `queue`, `status`, `sleep`, `stop`
- **People:** `user`, `lookup`
- **Shell:** `source`, `alias`, `unalias`, `history`, `echo`, `clear`, `exit`, `help`
- **Account:** `login`, `logout`, `whoami`, `version`

Things that work the same as on the site:

- Pipe output into `grep`, `head`, `tail`, `wc`, `sort` or `uniq`.
- `!!`, `!N` and `!text` re-run earlier commands.
- `cd -` goes back to the previous folder.
- `alias` saves shortcuts.
- Tab completes command names and paths.
- Ctrl+C cancels the running command.

`get` saves into the current local folder. Use `lcd` to change that folder, or `get -o <dir>` for a single download. A folder keeps its structure on disk where the site would hand you a ZIP. Files that already exist are skipped unless you pass `-f`.

## Library

`find <title>` searches the songs and numbers the results. `liked` and `playlist show` number theirs too. A number then stands for that row in the next command: `song 2`, `like 2`, `playlist add Chill -- 2`.

- `song <title | N>` shows a song's era, credits and dates, plus the `get` command that downloads its file.
- `playlist` can show, create, delete, add and remove. A playlist can be named by a few letters of its title or by its number in `playlists`. Deleting asks first, or takes `-y`. Playing a playlist is left to the site, since the CLI has no player.
- `stats [all | 7 | 30] [N]` charts your listening history the way the site does. It needs the whole song catalog (about 11 MB), so a slim copy is kept in `~/.unreleased/cache` for a day. `-r` reloads it.
- `user <id>` works for anyone. `user <name>` needs an administrator account, because it searches the admin account list. The site finds people through chat, which the CLI doesn't have.
- `lookup <text>` searches songs, your playlists, channels, commands and (for administrators) people at once.

Playlists, likes and stats need you to be signed in.

## Playback

Music plays through a hidden mpv that the interactive shell starts the first time you play something.

- `play <title | N>` plays a song by title, or by its number from the last list.
- `play <file | folder>` plays something from the file tree. A folder queues the audio files directly inside it, and `play .` plays the folder you're in.
- `playlist play <name>`, `playlist shuffle <name>`, `liked play` and `shuffle <era> [count]` replace the queue.
- `queue add` and `queue next` add to it. `queue` lists it, and `remove N` / `jump N` change it.
- Shuffle, repeat, previous and the end of the queue behave as they do on the site.
- `status` (or `now`) shows the song, a progress bar, the settings and the queue.
- `like` and `unlike` with no song act on the one playing.

The music stops when you leave the shell, so `unreleased play …` on its own says to open the shell instead. If the shell is killed without a chance to stop mpv (for example the terminal window is closed), mpv quits by itself within about 10 seconds.

The CLI looks for mpv on PATH and then in the usual install folders. Set `UNRELEASED_MPV` to its path if it lives somewhere else. mpv reads your own `mpv.conf`, so settings like the audio device carry over.

Plays here aren't added to your listening history on the site.

## Signing in

You can browse the files without an account. To sign in:

- `login` asks for your API token. On the site, open the terminal and type `token copy` to get it.
- `login <username>` signs in with a username and password, and asks for a 2FA code if the account has one.

`logout` only forgets the token on this computer. The token itself keeps working on the site.

## Files and environment

Everything is kept in `~/.unreleased`. Set `UNRELEASED_HOME` to use another folder.

| File | Contents |
|---|---|
| `config.json` | The token and account name (owner-only permissions where the OS supports it), plus an optional `"api"` base URL |
| `history` | Typed commands. Start a line with a space and it won't be saved. |
| `aliases.json` | Your aliases |
| `rc` | Commands run each time the interactive shell starts |

| Environment variable | Effect |
|---|---|
| `UNRELEASED_TOKEN` | Use this token instead of the saved one |
| `UNRELEASED_API` | Use another API base (the default is `https://juicewrldapi.com/juicewrld`) |
| `UNRELEASED_MPV` | The mpv executable to play through |
| `NO_COLOR` | Turn off colours |

Git Bash on Windows rewrites a bare `/` argument into its own install path, so `unreleased ls /` lists the wrong place there. Run it from inside the shell, or set `MSYS_NO_PATHCONV=1`.

## How it's built

Some of the CLI is the site's own code, compiled in by `build.mjs`:

- `cat`, `head`, `tail`, `wc`, `grep`, `locate`, `tree` and `du` come from `src/renderer/src/lib/terminalFileTools.ts`. Its imports point at `src/files.ts`, the Node version of the site's `terminalFiles.ts`.
- The `stats` maths comes from `lib/listeningStats.ts`. Its two helpers from `juicewrldApi.ts` are swapped for `src/shims/juicewrldApi.ts`.
- Playlist name matching comes from `lib/terminal/types.ts`.

A change to those on the site reaches the CLI on the next `npm run build`. The declarations in `src/site.d.ts` have to stay in step with their signatures. The other commands are ports, because their site versions read the app's stores.
