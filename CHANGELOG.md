# Changelog

### Chat

- Encrypted servers, channels and DMs.
- Reorder servers, DMs and channels by dragging. Pin your favorites, mute chats, and delete them.
- Replies look like Discord's, with a preview and a cancel button.
- Right-click a message for options. Press the up arrow to edit your last message.
- GIF picker with favorites that sync across your devices.
- Desktop notifications, an in-app banner for new messages, and a choice of notification sounds.
- Optionally share what you're listening to. You can also turn off presence and read receipts.
- Mute a person's messages in shared channels.
- Mention anyone with `@`, or use `@everyone` in a channel. Mentions open that person's profile.
- Links posted in a channel show a preview card with the page's title, description and image. DMs never fetch previews.
- Share songs, playlists, news posts, lyrics cards and themes right into a chat.
- Slash commands: `/song`, `/search`, `/mute`, `/unmute`, `/theme`, `/np`, `/promote`, `/info`, `/kick`, `/help`, `/feedback`, `/sharetheme`. They autocomplete and show hints for what to type next.
- Administrators get a Terminal page (`/terminal`) that works from anywhere in the app. Open it with Ctrl+`, the `>_` button in a chat's header, or add it to the side menu in Settings → Menu items. It's a black, Linux-style console that runs the same slash commands as the chat box, with or without the slash. `cd` and `ls` move between channels and DMs, `cd files` opens the Files tab as a folder tree (`cd`, `ls`, and `get` to download a file, or a folder as a ZIP), Tab completes names and paths, and the arrow keys recall past commands. `nano` opens a small text editor (`^O` saves a copy to your computer, `^X` exits, `^G` lists the keys); in the file tree it loads the file you name. The file tree also has `cat`, `head`, `tail`, `wc`, `grep`, `locate`, `tree` and `du`, and `source -y <file>` runs a text file of commands. You can pipe any command into `grep`, `head`, `tail`, `wc`, `sort` or `uniq`, search your history with Ctrl+R, and click a `→ command` hint to put it on the prompt. `watch <command>` re-runs a command on a live screen, `stats` charts your listening, `shuffle <era>` queues a random pick from an era, and `now` shows a progress bar. For fun: `neofetch`, `fortune`, `cowsay`, `matrix`, `visualizer`, `karaoke`, `wordle`, `heardle`, and `termtheme` to change the colours. Beyond the chat commands it can drive the rest of the app: playback and the queue (`play`, `seek`, `volume`, `queue`, `find`), playlists, any setting (`set theme dark`), `open` any page, and the admin review queues (`proposals`, `approve`, `reject`, `users`, `sitebans`). `user <name>` looks anyone up (even people you share no room with) and `lookup <text>` searches people, rooms, playlists, settings, commands and songs at once; `@names` in any command now resolve across all users. Handy shell touches: `| grep`/`| head`, `!!`, `alias`, `cd -`, saved history and "did you mean" for typos. `help` lists them all.
- Roles and permissions, public servers you can browse and join, and moderation tools (timeout, ban, and site-wide restrictions).

### Profiles

- Create an account without Discord, using a username and password.
- Sync your data across devices.
- Public profiles with a bio, privacy settings, and donor status.
- Custom avatars.

### Home and mobile

- Desktop Home is a real landing page: recent tracks, a News rail, your playlists (most recently opened first), albums, and totals for the whole catalog. 999 FM has a quick-tune shortcut.
- Mobile gets its own Home tab and a More menu for everything else. You can choose which Home sections show.
- WRLD view is smoother to drag and dismiss, and has a theme-background toggle and lyrics display settings.

### Playlists and library

- Playlists have shareable links, and so do news posts.
- Export a playlist as JSON or M3U.
- Drag playlists onto each other to bundle them into a folder, or drag them out to ungroup.
- Press and hold to select several songs at once.
- Double-click a song to play it in the tracker.
- Songs can have versions you exclude from shuffle.
- Search your queue.

### Lyrics

- Make a shareable lyrics image: pick any lines, choose a font and text color, add your own background image, and copy it to your clipboard.
- Customize lyrics size, alignment, blur and colors on desktop.
- Right-click the WRLD art to change the cover.

### Files and stats

- Drag and drop in Files to reorganize. Drag files or folders in from your computer to upload.
- Right-click empty space in Files to refresh, upload, or make a folder.
- Downloading several files, a folder, a playlist or a Tracker selection saves one ZIP built in your browser. Big ZIPs fall back to one file at a time on browsers that can't stream to disk.
- New Statistics page with catalog-wide breakdowns, play stats for the whole site, and a timeline of eras. Its tabs link into the Tracker.

### Downloads

- The download servers are being expanded, and users will be able to help scale them. Expect much faster speeds and better reliability.

### Other

- New Thank You page listing donors, and a dismissible donation notice.
- Terms and Privacy updated to cover settings sync and the GIF picker.
