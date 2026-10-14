#!/usr/bin/env python3
"""
Unreleased Music Player — Interactive Release Script

Just run it — no arguments needed.

The very first question is whether this is a beta. A beta skips ALL git and
GitHub work (no sync, commit, push, web sync or release): pick a version, add
notes, build the installer locally and upload it to juicewrldapi.com's gated
beta backend. The rest of this list is the stable path.

Prompts are asked up front, then everything else runs unattended:
  1. Fast-forward app onto origin/app. The previous release's web push
     fires the sync-web-to-app workflow, which advances origin/app behind
     our back — so without this every release after a successful one is
     rejected at step 7 and rolled back. Runs before the version bump,
     while the tree is still clean.
  2. Pick a version (bump patch / minor / major, or keep / custom)
  3. Enter a commit message (only if the tree is dirty)
  4. Enter release notes (blank = auto-generate from commits)
  ── nothing left to answer past this point ──
  5. Commit all changes to the desktop branch (app)
  6. Beta only: build the renderer + Electron installer locally (needed
     right here, since step 9's beta publish uploads the .exe this
     produces). Stable builds are NOT done locally anymore — see step 9.
  7. Push the desktop branch to GitHub (origin)
  8. Sync the web branch (copies src/ + package.json from app, skips
     electron/) — skipped for beta releases, betas are desktop-only
  9. Stable: create the GitHub release on origin, already published, with
     no assets attached. That publish event is what triggers
     .github/workflows/build-{windows,mac,linux}.yml — every platform
     builds in CI and attaches its own installer.
     Beta: POST the local build from step 6 to
     juicewrldapi.com/beta/admin/versions/ (multipart; needs BETA_ADMIN_TOKEN
     in .env.local - an administrator's API token, with 2FA enabled).
"""

import os, sys, re, json, shutil, subprocess, threading, time, urllib.request, urllib.error
if hasattr(sys.stdout, "reconfigure"): sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"): sys.stderr.reconfigure(encoding="utf-8")

# Enable ANSI colours on Windows
if sys.platform == "win32":
    os.system("")

from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
ROOT         = Path(__file__).parent.parent.parent
REPO_OWNER   = "Juice-WRLD-API"
REPO_NAME    = "Unreleased"
APP_BRANCH   = "app"
WEB_BRANCH   = "web"
API_BASE     = "https://api.github.com"
BETA_API_BASE = "https://juicewrldapi.com/beta"

# How much we hand the socket per read(). http.client streams a file-like body
# with `while block := data.read(self.blocksize)` and blocksize is 8192 — so a
# multi-MB upload would otherwise be thousands of read/callback/sendall
# round-trips. Returning more than the requested `n` is fine: send() just
# sendall()s whatever comes back. 1 MB drops that dramatically. Only the beta
# installer upload (_MultipartUpload) still streams through this now — GitHub
# release assets are uploaded by CI, not this script.
UPLOAD_CHUNK = 1_048_576

# ── ANSI helpers ──────────────────────────────────────────────────────────────
RST  = "\033[0m"
BOLD = "\033[1m"
DIM  = "\033[2m"
RED  = "\033[91m"
GRN  = "\033[92m"
YLW  = "\033[93m"
CYN  = "\033[96m"
WHT  = "\033[97m"

def _c(text, *codes):
    return "".join(codes) + str(text) + RST

def banner(title="Release & Publish", icon="🎵"):
    w = 66
    print()
    print(_c("╔" + "═"*(w-2) + "╗", CYN, BOLD))
    row = f"  {icon}  UNRELEASED  —  {title}  "
    print(_c("║", CYN, BOLD) + _c(row.ljust(w-2), WHT, BOLD) + _c("║", CYN, BOLD))
    print(_c("╚" + "═"*(w-2) + "╝", CYN, BOLD))
    print()

def section(n, total, title):
    print()
    bar = "─" * 52
    print(_c(f"  [{n}/{total}]  {title}", WHT, BOLD))
    print(_c("  " + bar, DIM))
    print()

def ok(msg):     print(_c("  ✓  ", GRN, BOLD)  + msg)
def info(msg):   print(_c("  ·  ", CYN)         + msg)
def warn(msg):   print(_c("  ⚠  ", YLW, BOLD)  + msg)
def detail(msg): print(_c("     " + msg, DIM))

def die(msg):
    print()
    print(_c("  ✗  ", RED, BOLD) + _c(msg, RED))
    wait()
    sys.exit(1)

def ask(prompt, default=""):
    hint = _c(f"  [{default}]", DIM) if default else ""
    try:
        ans = input(_c(f"\n  ▶  {prompt}", CYN, BOLD) + hint + _c(": ", CYN, BOLD)).strip()
    except KeyboardInterrupt:
        print()
        die("Cancelled.")
    return ans if ans else default

def confirm(prompt, default=True):
    yn = "Y/n" if default else "y/N"
    return ask(f"{prompt} ({yn})", "y" if default else "n").lower() in ("y", "yes")

def wait():
    try:
        input(_c("\n\n  Press Enter to close…", DIM))
    except (EOFError, KeyboardInterrupt):
        pass

# ── Shell ─────────────────────────────────────────────────────────────────────

def run(cmd, check=True):
    detail(f"> {cmd}")
    r = subprocess.run(cmd, shell=True, cwd=ROOT)
    if check and r.returncode != 0:
        # Raised (not die()'d) so main() can roll back whatever earlier steps
        # already did before reporting the failure and exiting.
        raise RuntimeError(f"Command failed (exit {r.returncode}):\n  {cmd}")
    return r

def capture(cmd):
    r = subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True)
    return r.stdout.strip()

def is_dirty():
    return bool(capture("git status --porcelain"))

def git_branch():
    return capture("git rev-parse --abbrev-ref HEAD")

# ── package.json ──────────────────────────────────────────────────────────────

def load_version():
    pkg = json.loads((ROOT / "package.json").read_text("utf-8"))
    return pkg["version"]

def set_version(new_ver):
    path = ROOT / "package.json"
    text = path.read_text("utf-8")
    new_text, n = re.subn(r'("version"\s*:\s*)"[^"]+"', rf'\g<1>"{new_ver}"', text, count=1)
    if n == 0:
        die("Could not find version field in package.json")
    path.write_text(new_text, "utf-8")

def bump(v, part):
    # a current version like 1.15.0-beta.1 bumps from its 1.15.0 base
    maj, mn, pat = map(int, v.split("-")[0].split("."))
    if part == "major": return f"{maj+1}.0.0"
    if part == "minor": return f"{maj}.{mn+1}.0"
    return f"{maj}.{mn}.{pat+1}"

# ── GitHub API ────────────────────────────────────────────────────────────────

def _env_local_files():
    """ROOT's .env.local first, then any sibling worktree's (app/beta/web/...
    are separate checkouts under one parent, and .env.local is gitignored, so
    a fresh worktree never has its own copy)."""
    yield ROOT / ".env.local"
    try:
        for d in sorted(ROOT.parent.iterdir()):
            if d != ROOT and (d / "package.json").exists():
                yield d / ".env.local"
    except OSError:
        pass

def _read_env(key):
    v = os.environ.get(key)
    if v and v.strip(): return v.strip()
    for env in _env_local_files():
        if not env.is_file(): continue
        for line in env.read_text("utf-8-sig", errors="ignore").splitlines():
            line = line.strip()
            if line.startswith(f"{key}="):
                val = line.split("=", 1)[1].strip().strip('"').strip("'")
                if val: return val
    return None

def get_token(required=True):
    t = _read_env("GH_TOKEN")
    if t or not required: return t
    die("GH_TOKEN not found.\nSet it as an environment variable or add GH_TOKEN=xxx to .env.local")

def get_beta_admin_token():
    t = _read_env("BETA_ADMIN_TOKEN")
    if t: return t
    die("BETA_ADMIN_TOKEN not found.\nAdd BETA_ADMIN_TOKEN=xxx to .env.local - an administrator's API token\n"
        "(admin role, 2FA on) for juicewrldapi.com's POST /beta/admin/versions/,\n"
        "separate from GH_TOKEN.")

def api(method, path, token, data=None, api_base=API_BASE):
    url  = f"{api_base}{path}"
    hdrs = {
        "Authorization": f"token {token}",
        "Accept":        "application/vnd.github+json",
        "Content-Type":  "application/json",
        "User-Agent":    "release.py",
    }
    body = json.dumps(data).encode() if data else None
    req  = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    with urllib.request.urlopen(req) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else {}

# ── Upload with live progress bar ─────────────────────────────────────────────

class _Bar:
    """Throttled, thread-safe in-place progress bar.

    Redrawing used to happen on every read() the HTTP layer made — ~24,000
    console writes per release once you count both big assets. A Windows
    console write is slow enough (and synchronous with the socket) that the
    bar itself was throttling the upload. Now it only repaints when the
    integer percentage moves AND at most ~10×/second.
    """
    def __init__(self, total, prefix="     "):
        self._total  = max(int(total), 0)
        self._prefix = prefix
        self._done   = 0
        self._lock   = threading.Lock()
        self._last_pct  = -1
        self._last_draw = 0.0
        self._start  = time.time()
        self._finished = False

    def advance(self, delta):
        with self._lock:
            self._done += delta
            pct = self._done * 100 // self._total if self._total else 100
            now = time.time()
            if pct != self._last_pct and now - self._last_draw >= 0.1:
                self._last_pct, self._last_draw = pct, now
                self._draw(pct)

    def finish(self):
        with self._lock:
            if self._finished:
                return
            self._finished = True
            self._draw(self._done * 100 // self._total if self._total else 100)
            print()

    def _draw(self, pct):
        pct = min(max(pct, 0), 100)
        bar = "#" * (pct // 2) + "-" * (50 - pct // 2)
        elapsed = max(time.time() - self._start, 0.001)
        rate = self._done / elapsed / 1_048_576
        print(f"\r{self._prefix}[{bar}] {pct:3d}%  "
              f"{self._done/1_048_576:.1f}/{self._total/1_048_576:.1f} MB  "
              f"{rate:.1f} MB/s", end="", flush=True)


# ── Beta publish (private — never touches GitHub) ─────────────────────────────
# GitHub release assets are no longer uploaded by this script — stable builds
# happen in CI (see .github/workflows/build-{windows,mac,linux}.yml, triggered
# by the release this script publishes in step 9). Only the beta path still
# uploads a file directly, streaming a multipart/form-data body (fields +
# files) without loading the whole installer into memory at once.

class _MultipartUpload:
    def __init__(self, boundary, fields, files, on_progress=None):
        self._segments = []  # ('bytes', b'...') | ('file', Path)
        for name, value in fields.items():
            self._segments.append(("bytes",
                f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode("utf-8")))
        for name, path in files.items():
            header = (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{path.name}"\r\n'
                      f'Content-Type: application/octet-stream\r\n\r\n').encode("utf-8")
            self._segments.append(("bytes", header))
            self._segments.append(("file", path))
            self._segments.append(("bytes", b"\r\n"))
        self._segments.append(("bytes", f"--{boundary}--\r\n".encode("utf-8")))

        self._size = sum(len(d) if k == "bytes" else d.stat().st_size for k, d in self._segments)
        self._idx = 0
        self._fh = None
        self._done = 0
        self._bar = None
        # on_progress(done_bytes, total_bytes) — defaults to printing an
        # in-place ASCII bar; a GUI can pass its own callback instead.
        if on_progress is None:
            self._bar = _Bar(self._size)
            on_progress = lambda done, total: None
        self._on_progress = on_progress

    def __len__(self):
        return self._size

    def _emit(self, data):
        self._done += len(data)
        if self._bar is not None:
            self._bar.advance(len(data))
        self._on_progress(self._done, self._size)
        return data

    def read(self, n=-1):
        while self._idx < len(self._segments):
            kind, data = self._segments[self._idx]
            if kind == "bytes":
                self._idx += 1
                if data:
                    return self._emit(data)
                continue
            if self._fh is None:
                self._fh = open(data, "rb")
            # `n` ignored in favour of UPLOAD_CHUNK, same reasoning as
            # _ProgressFile.read — http.client would otherwise ask for 8 KB.
            chunk = self._fh.read(UPLOAD_CHUNK if n is None or n < 0 else max(n, UPLOAD_CHUNK))
            if chunk:
                return self._emit(chunk)
            self._fh.close()
            self._fh = None
            self._idx += 1
        return b""

    def close(self):
        if self._bar is not None:
            self._bar.finish()
        if self._fh:
            self._fh.close()
            self._fh = None

def upload_beta(url, token, fields, files, on_progress=None):
    boundary = f"----unreleased-{int(time.time())}"
    wrap = _MultipartUpload(boundary, fields, files, on_progress)
    print(f"\n  Uploading: {_c(', '.join(p.name for p in files.values()), WHT, BOLD)}  ({len(wrap)/1_048_576:.1f} MB)")
    req = urllib.request.Request(url, data=wrap, method="POST", headers={
        "Authorization":  f"Token {token}",
        "Content-Type":   f"multipart/form-data; boundary={boundary}",
        "Content-Length": str(len(wrap)),
        "User-Agent":     "release.py",
    })
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read()
            wrap.close()   # flush the bar's final line before anything else prints
            return body
    finally:
        wrap.close()

def sha512_base64(path):
    import hashlib, base64
    h = hashlib.sha512()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1_048_576), b""):
            h.update(chunk)
    return base64.b64encode(h.digest()).decode("ascii")

# ── Prompts (collected up front, before any build/deploy/commit) ──────────────

TOTAL = 9


def step_sync_remote(state):
    """Fast-forward the local app branch onto origin before anything is built,
    committed or pushed.

    Without this, every release that follows a successful one fails. The tail of
    a release pushes the web branch, which fires .github/workflows/
    sync-web-to-app.yml; that merges web back into app and pushes, so origin/app
    advances behind our back. The next run then commits onto a stale app, builds
    for two minutes, and only discovers the problem at `git push` — where the
    rejection triggers rollback()'s `git reset --hard`, throwing the just-made
    commit away (recoverable only via reflog).

    Runs before the version bump so the tree is still clean: a fast-forward that
    has to overwrite a locally-modified package.json would abort. Deliberately
    --ff-only — a genuine divergence means someone else pushed real work, and
    silently merging it into a release build is not this script's call to make.
    """
    section(1, TOTAL, f"Sync with origin/{APP_BRANCH}")

    if git_branch() != APP_BRANCH:
        info(f"Switching to {APP_BRANCH}")
        run(f"git checkout {APP_BRANCH}")

    run("git fetch origin")

    behind = capture(f"git rev-list --count {APP_BRANCH}..origin/{APP_BRANCH}")
    ahead = capture(f"git rev-list --count origin/{APP_BRANCH}..{APP_BRANCH}")
    behind, ahead = int(behind or 0), int(ahead or 0)

    if behind and ahead:
        die(f"{APP_BRANCH} has diverged from origin/{APP_BRANCH} "
            f"({ahead} local, {behind} remote).\n"
            f"     Reconcile by hand, then re-run:\n"
            f"       git log --oneline origin/{APP_BRANCH}..{APP_BRANCH}\n"
            f"       git rebase origin/{APP_BRANCH}   (or merge)")

    if behind:
        info(f"{behind} new commit(s) on origin/{APP_BRANCH} — fast-forwarding")
        run(f"git merge --ff-only origin/{APP_BRANCH}")
        ok(f"Fast-forwarded to {capture('git rev-parse --short HEAD')}")
    elif ahead:
        ok(f"Up to date ({ahead} unpushed local commit(s))")
    else:
        ok(f"Up to date with origin/{APP_BRANCH}")


def auto_beta_version(cur):
    """Next beta version, no prompt. Betas must carry a pre-release suffix: the
    installer and updater tell a beta from a stable build by the "-" in the
    version. 3.0.1-beta.2 -> 3.0.1-beta.3; anything else -> the next patch's
    first beta (3.0.1 -> 3.0.2-beta.1)."""
    m = re.fullmatch(r"(\d+\.\d+\.\d+)-beta\.(\d+)", cur)
    if m:
        return f"{m.group(1)}-beta.{int(m.group(2)) + 1}"
    return f"{bump(cur, 'patch')}-beta.1"


def prompt_version():
    section(2, TOTAL, "Version")
    cur = load_version()
    info(f"Current version: {_c(cur, WHT, BOLD)}")
    print()
    opts = [
        ("1", "keep",   cur,              "Keep current"),
        ("2", "patch",  bump(cur,"patch"),"Bump patch  "),
        ("3", "minor",  bump(cur,"minor"),"Bump minor  "),
        ("4", "major",  bump(cur,"major"),"Bump major  "),
        ("5", "custom", None,             "Custom…     "),
    ]
    for k, _, v, label in opts:
        print(_c(f"    {k}) {label}  {v or '?'}", DIM))

    choice = ask("Choice", default="2")
    entry  = next((o for o in opts if o[0] == choice), None)
    if not entry:
        die("Invalid choice.")

    _, part, new_ver, _ = entry
    if part == "custom":
        new_ver = ask("Version (e.g. 2.0.0 or 1.15.0-beta.1)")
        if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", new_ver):
            die("Invalid format. Use major.minor.patch, optionally with a\n"
                "pre-release suffix (e.g. 1.15.0-beta.1)")
    elif part == "keep":
        ok(f"Keeping {_c(cur, WHT, BOLD)}")
        return cur

    ok(f"Version: {cur}  →  {_c(new_ver, WHT, BOLD)}")
    return new_ver


def prompt_commit_message(version):
    section(3, TOTAL, f"Commit message")

    if is_dirty():
        info("Uncommitted changes:")
        for line in capture("git status --short").splitlines():
            detail(line)
        return ask("Commit message", default=f"v{version}")
    else:
        ok("Nothing to commit — tree is clean")
        return None


def prompt_release_notes():
    section(4, TOTAL, "Release notes")
    return ask("Release notes  (blank = auto-generate from commits)", default="")


# ── Steps (run only after every prompt above has been answered) ──────────────

def step_apply_version(new_ver, state):
    if new_ver != state["original_version"]:
        set_version(new_ver)
        state["version_changed"] = True


def download_file(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": "release.py"})
    with urllib.request.urlopen(req) as resp, open(dest, "wb") as f:
        shutil.copyfileobj(resp, f)


def ensure_bundled_stub():
    """package.json's win.extraResources embeds build/bundled/Unreleased-Setup.exe
    (the nsis-web repair/reinstall stub) into every packaged installer —
    electron-builder needs that file to already exist before packaging starts.
    It's gitignored, so a fresh checkout never has it; it used to only get
    refreshed as a side effect of the PREVIOUS local build (see step_build's
    stub-refresh below), which broke the moment builds stopped always
    happening on the same machine back-to-back (a fresh clone, a new machine,
    or — now — CI). Fetching a copy from whatever past GitHub release still
    has one closes that gap everywhere — it has the longest unbroken
    history, so it's never mid-bootstrap itself the way a CI run building
    the release that was JUST published (with no assets yet) could be."""
    dest = ROOT / "build" / "bundled" / "Unreleased-Setup.exe"
    if dest.exists():
        return
    info("build/bundled/Unreleased-Setup.exe missing — fetching from a past release…")
    dest.parent.mkdir(parents=True, exist_ok=True)
    token = get_token()
    releases = api("GET", f"/repos/{REPO_OWNER}/{REPO_NAME}/releases?per_page=30", token)
    for r in releases:
        asset = next((a for a in r.get("assets", []) if a["name"] == "Unreleased-Setup.exe"), None)
        if asset:
            download_file(asset["browser_download_url"], dest)
            ok(f"Fetched stub from {r['tag_name']}")
            return
    raise RuntimeError(
        f"No recent {REPO_OWNER}/{REPO_NAME} release has an Unreleased-Setup.exe asset\n"
        "     to seed build/bundled/ from — package.json's win.extraResources needs one.")


def refresh_bundled_binaries():
    """Obsolete since ffmpeg/yt-dlp stopped shipping in the installer: the app
    now downloads both on first use into userData/bin (yt-dlp always from the
    latest release, so freshness takes care of itself — see electron/main.js
    "On-demand tool binaries"). Kept as a stub so older notes/runbooks that
    mention this step don't point at a missing function."""
    info("Skipping bundled-binary refresh — ffmpeg/yt-dlp are downloaded on demand since v1.19")


def guard_no_mobile_dirs():
    """android/ and ios/ are the Capacitor mobile project — it lives on
    mobile-android-ux, not here. It already leaked into app once (sat
    committed and unused for months after a shared-ancestor merge, never
    caught until someone noticed it by eye) and .gitignore alone won't stop
    a re-merge from re-tracking it, since `git add -A` still stages changes
    to files that are already tracked regardless of ignore rules. Checked
    right before the commit that would otherwise ship it again."""
    for name in ("android", "ios"):
        d = ROOT / name
        if not d.exists():
            continue
        tracked = capture(f'git ls-files -- "{name}"')
        if tracked:
            die(f"{name}/ is tracked on {APP_BRANCH} — this is the Electron desktop branch,\n"
                f"     the Capacitor mobile project belongs on mobile-android-ux only.\n"
                f"     Likely came in through a merge. Remove it before releasing:\n"
                f"       git rm -r {name}/")
        else:
            warn(f"{name}/ exists untracked in the working tree — gitignored, won't be committed, "
                 f"but consider deleting it (it has no purpose on {APP_BRANCH}).")


def step_commit(version, msg, state):
    section(5, TOTAL, f"Commit → {APP_BRANCH}")

    if git_branch() != APP_BRANCH:
        info(f"Switching to {APP_BRANCH}")
        run(f"git checkout {APP_BRANCH}")

    guard_no_mobile_dirs()

    # Recorded even when there's nothing to commit — a no-op reset to this
    # sha is still correct, it just reverts nothing.
    state["pre_commit_sha"] = capture("git rev-parse HEAD")

    if msg is not None:
        run("git add -A")
        run(f'git commit -m "{msg}"')
        state["committed"] = True
        ok(f"Committed: {msg}")
    else:
        ok("Nothing to commit — tree is clean")


def step_build():
    """Beta releases only — stable releases build in CI (see
    .github/workflows/build-windows.yml, fired by step_release's publish).
    Beta has no such trigger (it publishes to juicewrldapi.com's gated
    backend, not GitHub), so it still needs the installer built right here,
    since step_publish_beta uploads the .exe this produces."""
    section(6, TOTAL, "Build Electron app  (beta)")
    warn("This takes ~2 minutes — output streams below")
    print()

    # (ffmpeg/yt-dlp are no longer bundled — the app downloads them on first
    # use, so there's nothing to refresh before packaging anymore.)

    # 1. Rebuild the renderer FIRST (tsc --noEmit && vite build) so dist/ is
    #    fresh. electron-builder only packages whatever is already in dist/ —
    #    skipping this ships a stale renderer (old bugs) under a new version.
    info("Compiling renderer (npm run build)…")
    renderer = subprocess.run("npm run build", shell=True, cwd=ROOT)
    print()
    if renderer.returncode != 0:
        raise RuntimeError("Renderer build failed (tsc / vite). See output above.")
    ok("Renderer compiled → dist/")
    print()

    # 2. Package the Electron installers (offline nsis + web nsis-web) from the
    #    freshly built dist/. Clear last build's artifacts first — the
    #    web-installer stub has a version-free name (Unreleased-Setup.exe), so
    #    a stale copy is indistinguishable from a fresh one at upload time.
    for directory, patterns in (
        (ROOT / "release" / "nsis-web", ("Unreleased-Setup*.exe*", "latest.yml", "*.nsis.7z")),
        (ROOT / "release", ("Unreleased-Setup*.exe*", "latest.yml")),
    ):
        if directory.exists():
            for pattern in patterns:
                for stale in directory.glob(pattern):
                    stale.unlink()

    ensure_bundled_stub()

    # The Session Maker's VST3 host (native/vsthost) — win.extraResources ships
    # build/vsthost/vsthost.exe, and electron-builder only warns when it's
    # missing, so a build without it would quietly lose plug-in support.
    info("Building the VST3 plug-in host (scripts/build-vsthost.mjs)…")
    vsthost = subprocess.run("node scripts/build-vsthost.mjs", shell=True, cwd=ROOT)
    print()
    if vsthost.returncode != 0:
        raise RuntimeError("VST3 host build failed. See output above.")
    ok("VST3 host built → build/vsthost/vsthost.exe")
    print()

    info("Packaging installer (electron-builder)…")
    result = subprocess.run(
        r"node_modules\.bin\electron-builder.cmd --win --publish never",
        shell=True, cwd=ROOT,
    )
    print()
    if result.returncode != 0:
        raise RuntimeError("Build failed. See output above.")
    ok("Build complete")

    # 3. Refresh the bundled web-installer stub for the NEXT release. The app
    #    embeds this copy (see package.json win.extraResources) as an emergency
    #    repair/reinstall tool, but it can't embed the file this same build just
    #    produced — electron-builder needs it to exist before packaging starts.
    #    The stub is a version-agnostic bootstrapper (fetches whatever is
    #    latest.yml-current at run time), so shipping one release behind is
    #    harmless. build/ is gitignored, so this just updates the local copy.
    stub = ROOT / "release" / "nsis-web" / "Unreleased-Setup.exe"
    if stub.exists():
        bundled_dir = ROOT / "build" / "bundled"
        bundled_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(stub, bundled_dir / "Unreleased-Setup.exe")
        ok("Bundled installer stub refreshed for next build")
    else:
        warn(f"Not found (skipping bundled-stub refresh): {stub.name}")


def step_push_app(state):
    section(7, TOTAL, f"Push → origin/{APP_BRANCH}")
    run(f"git push origin {APP_BRANCH}")
    state["pushed_app"] = True
    ok(f"Pushed to origin/{APP_BRANCH}")


def step_sync_web(version, is_beta, token, state):
    # web/dev now carries its own independent mobile-web UI work (a
    # .desktop/.mobile component split per view, an Electron-only-code purge
    # that deleted files app's main process still needs, etc.) — overwriting
    # its src/ from app here would silently wreck all of that on the next
    # release. The counterpart web->app auto-merge workflow was removed from
    # web for the same reason. Re-enable only if web goes back to being a
    # pure mirror of app's src/.
    section(8, TOTAL, f"Sync → {WEB_BRANCH}  (skipped — decoupled, see step_sync_web)")
    info(f"{WEB_BRANCH} carries independent mobile-web UI work now; left untouched.")


def step_publish_beta(version, notes):
    section(9, TOTAL, "Beta publish  (gated backend, not GitHub)")
    tag = f"v{version}"
    token = get_beta_admin_token()

    exe = ROOT / "release" / f"Unreleased-Setup-{version}.exe"
    if not exe.exists():
        raise RuntimeError(f"No {exe.name} in release/\nDid the build succeed?")

    # No git here: a beta never touches it, so there's no commit log to draw
    # default notes from.
    notes = notes or f"Beta {tag}"

    url = f"{BETA_API_BASE}/admin/versions/"
    info(f"Publishing {_c(version, WHT, BOLD)} to {url} …")
    # A dropped connection mid-upload (WinError 10054 at 92% on a slow link)
    # used to fall straight through to rollback, throwing away a multi-minute
    # build over a network blip. Retry those; HTTP errors are real answers
    # from the backend and still fail immediately.
    attempts = 3
    for attempt in range(1, attempts + 1):
        try:
            upload_beta(
                url, token,
                fields={
                    "version": version, "notes": notes, "is_active": "true",
                    "published_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                },
                files={"file": exe},
            )
            break
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            if e.code == 409 and attempt > 1:
                # The previous attempt's body reached the server even though
                # the connection died before its response came back.
                warn(f"Version {version} already exists — the previous attempt landed after all.")
                break
            hint = ""
            if e.code in (401, 403):
                hint = "\n     BETA_ADMIN_TOKEN must be an administrator's token with 2FA enabled."
            elif e.code == 409:
                hint = f"\n     Version {version} already exists - pick a new version, or delete it on the Admin page's Beta tab."
            raise RuntimeError(f"Beta publish failed: HTTP {e.code}\n{body[:300]}{hint}")
        except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
            print()
            if attempt == attempts:
                raise RuntimeError(f"Beta upload failed after {attempts} attempts: {e}\n"
                                   f"     The installer is still at {exe}")
            wait = 10 * attempt
            warn(f"Upload interrupted ({e}) — retrying in {wait}s  (attempt {attempt + 1}/{attempts})")
            time.sleep(wait)

    ok("Beta build published — private, not a public GitHub release")
    print()
    print(_c(f"  🧪  Beta {tag} is live for code holders only.", GRN, BOLD))


def step_release(version, token, notes, state):
    """Publishes the GitHub release itself, with no assets — CI attaches
    those. Publishing (not drafting) is what fires
    build-{windows,mac,linux}.yml's `on: release: types: [published]`
    trigger; every platform builds from this tag in parallel and uploads its
    own installer + latest*.yml straight to this same release."""
    section(9, TOTAL, "GitHub release  (CI builds & attaches installers)")
    tag = f"v{version}"
    state["tag"] = tag
    state["token"] = token

    if not notes:
        # Auto-generate from commits since last tag
        notes = capture(
            f'git log $(git describe --tags --abbrev=0 2>nul)..HEAD --pretty="- %s" --no-merges 2>nul'
            if sys.platform == "win32" else
            f'git log $(git describe --tags --abbrev=0 2>/dev/null)..HEAD --pretty="- %s" --no-merges 2>/dev/null'
        ) or f"Release {tag}"

    _publish_github_release(REPO_OWNER, REPO_NAME, tag, notes, token, state,
                             id_key="release_id", new_key="release_created_new")

    print()
    info("CI is now building Windows/macOS/Linux installers and will attach them to")
    info("the release as each platform finishes — nothing left to do here.")


def _publish_github_release(owner, repo, tag, notes, token, state, id_key, new_key):
    """Create/update a published GitHub release on (owner, repo) — no assets."""
    info(f"Creating release {_c(tag, WHT, BOLD)} on {owner}/{repo}…")
    try:
        release = api("POST",
            f"/repos/{owner}/{repo}/releases", token,
            {"tag_name": tag, "name": tag, "body": notes,
             "target_commitish": APP_BRANCH,
             "draft": False, "prerelease": False})
        state[id_key] = release["id"]
        state[new_key] = True
        ok(f"Release created  (id={release['id']})")
    except urllib.error.HTTPError as e:
        if e.code == 422:
            release = api("GET",
                f"/repos/{owner}/{repo}/releases/tags/{tag}", token)
            api("PATCH",
                f"/repos/{owner}/{repo}/releases/{release['id']}", token,
                {"prerelease": False, "body": notes})
            state[id_key] = release["id"]
            state[new_key] = False
            ok(f"Release already exists — updated  (id={release['id']})")
        else:
            raise

    url = f"https://github.com/{owner}/{repo}/releases/tag/{tag}"
    print()
    print(_c(f"  🚀  {url}", GRN, BOLD))


# ── Rollback ──────────────────────────────────────────────────────────────────
# Undoes whatever earlier steps already did when a later step fails. Scoped to
# what's safely automatable: the local version bump/commit, and a GitHub
# release created by *this* run. It never force-pushes app or web — web is the
# live production branch (Vercel), and rewriting shared history unattended on
# failure is a bigger risk than the failure itself. Those cases just print the
# manual undo command instead.

def rollback(state):
    if not state:
        return
    print()
    warn("Rolling back what's safely revertible (local commit/version + GitHub release)…")

    if state.get("release_id") and state.get("release_created_new") and state.get("token"):
        try:
            api("DELETE", f"/repos/{REPO_OWNER}/{REPO_NAME}/releases/{state['release_id']}", state["token"])
            ok(f"Deleted GitHub release {state.get('tag')}")
        except Exception as e:
            warn(f"Could not delete GitHub release: {e}")
        try:
            api("DELETE", f"/repos/{REPO_OWNER}/{REPO_NAME}/git/refs/tags/{state['tag']}", state["token"])
            ok(f"Deleted tag {state['tag']}")
        except Exception:
            pass  # tag may not exist yet, or was already cleaned up with the release

    if state.get("web_pushed"):
        warn(f"Web branch already pushed to origin/{WEB_BRANCH} — the live site. Not auto-reverting.")
        detail(f"To undo manually: git checkout {WEB_BRANCH} && "
               f"git reset --hard {state.get('pre_web_sha')} && git push --force origin {WEB_BRANCH}")

    if state.get("pushed_app"):
        warn(f"App branch already pushed to origin/{APP_BRANCH}. Not auto-reverting shared history.")
        detail(f"To undo manually: git reset --hard {state.get('pre_commit_sha')} && "
               f"git push --force origin {APP_BRANCH}")
    elif state.get("committed") and state.get("pre_commit_sha"):
        # `reset --hard` throws away the commit we just made *and* anything
        # uncommitted alongside it. Park a branch on it first so recovering is
        # `git cherry-pick <branch>` rather than digging through the reflog —
        # this rollback has eaten real work more than once.
        doomed = capture("git rev-parse --short HEAD")
        backup = f"backup/{state.get('tag') or 'release'}-{time.strftime('%Y%m%d-%H%M%S')}"
        if capture(f"git branch {backup} 2>&1") == "":
            ok(f"Saved the discarded commit ({doomed}) on branch {_c(backup, WHT, BOLD)}")
            detail(f"Recover with: git cherry-pick {backup}")
        else:
            warn(f"Could not create backup branch — recover {doomed} via `git reflog`")
        run(f"git reset --hard {state['pre_commit_sha']}", check=False)
        ok(f"Reverted local commit (and version bump) on {APP_BRANCH}")
    elif state.get("version_changed") and state.get("original_version"):
        set_version(state["original_version"])
        ok(f"Reverted package.json version to {state['original_version']}")

    print()


# ── Entry point ───────────────────────────────────────────────────────────────

def main(force_beta=False):
    """force_beta=True (beta.py) skips the question and goes straight down the
    beta path; otherwise the first prompt decides."""
    banner()
    # First question, before anything touches git: a beta skips all of it.
    if not force_beta:
        force_beta = confirm("Is this a beta?  (gated - skips all git and GitHub)", default=False)
    if force_beta:
        info("Beta: no sync, commit, push, web sync or GitHub release")
    state = {}
    try:
        # Beta releases never touch GitHub, so GH_TOKEN is only mandatory
        # for stable ones (checked once we know which this is).
        token = get_token(required=False)

        # Before anything else, and before the version bump makes the tree
        # dirty — a stale app branch is what sinks the push seven steps later.
        if not force_beta:
            step_sync_remote(state)

        # Read after the fast-forward: origin may have carried a newer version.
        state["original_version"] = load_version()

        # ── Every user prompt happens first — once these are answered, the
        #    rest of the release runs unattended (build, push, sync, commit).
        if force_beta:
            # A beta asks nothing: version and notes are picked for it.
            version = auto_beta_version(load_version())
            ok(f"Version: {state['original_version']}  →  {_c(version, WHT, BOLD)}")
        else:
            version = prompt_version()
        step_apply_version(version, state)
        # A beta never touches git: no sync, commit or push.
        commit_msg = None if force_beta else prompt_commit_message(version)
        release_notes = "" if force_beta else prompt_release_notes()
        is_beta = force_beta

        if not force_beta:
            step_commit(version, commit_msg, state)
        if is_beta:
            # Stable builds happen in CI (see step_release) — only beta needs
            # a local installer, since it's uploaded straight from here to
            # the gated backend instead of going through a GitHub release.
            step_build()
        if not force_beta:
            step_push_app(state)
        step_sync_web(version, is_beta, token, state)
        if is_beta:
            step_publish_beta(version, release_notes)
        else:
            step_release(version, token or get_token(), release_notes, state)

        print()
        print(_c("  " + "═" * 46, GRN, BOLD))
        print(_c(f"  ✓  v{version} {'published as beta' if is_beta else 'released'} successfully!", GRN, BOLD))
        print(_c("  " + "═" * 46, GRN, BOLD))
        print()

    except KeyboardInterrupt:
        print()
        warn("Interrupted.")
        rollback(state)
    except SystemExit:
        raise
    except Exception as exc:
        rollback(state)
        die(str(exc))
    finally:
        # Always land back on the desktop branch
        try:
            if git_branch() != APP_BRANCH:
                subprocess.run(f"git checkout {APP_BRANCH}", shell=True, cwd=ROOT)
        except Exception:
            pass

    wait()


if __name__ == "__main__":
    main()
