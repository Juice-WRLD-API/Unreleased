#!/usr/bin/env python3
"""
Unreleased Music Player — Android (Capacitor) Release Script

Just run it (or double-click release_android.bat). Optional flag:
  --install   also adb-install and launch the APK on whatever device/emulator
              is connected. Off by default — most runs of this script are
              cutting a release with no device attached, and requiring an
              explicit opt-in beats failing mid-script on a missing adb target.

Separate from release.py on purpose: this one only ever touches the
`android` branch. It never checks out, commits to, or pushes app/web, and
the GitHub release it creates uses its own `android-v*` tag prefix (and
`target_commitish: android`) so it never shows up as the "latest" release
for the desktop app's auto-updater or gets anywhere near the web deploy.

  1. Fast-forward android onto origin/android (same reason as release.py's
     step 1 — avoid building on a stale branch and getting rejected at push).
  2. Pick a version (bump patch / minor / major, or keep / custom). This sets
     versionName in android/app/build.gradle; versionCode always bumps by 1
     regardless, since Android needs a strictly increasing code per build
     and two APKs sharing one would be indistinguishable to anything that
     tracks updates.
  3. Enter a commit message (only if the tree is dirty)
  4. Enter release notes (blank = auto-generate from commits since the last
     android-v* tag)
  ── nothing left to answer past this point ──
  5. Commit all changes to android
  6. With --install (off by default): build the renderer, `cap sync android`,
     `gradlew assembleDebug`, then install and launch it on whatever
     device/emulator adb sees, purely for local testing. (Same recipe
     scripts/run-android.bat runs interactively; see step_build for why this
     script issues the commands itself.) Debug-signed; no release keystore
     exists yet, see step_build's docstring before wiring in a real one.
     Without --install this step is skipped entirely — the release build now
     happens in CI (see below), so no local Android SDK is required for an
     ordinary release.
  7. Push android to GitHub — origin (Juice-WRLD-API/Unreleased).
  8. Create the GitHub release (tag android-v<version>, target_commitish
     android) on origin, already published with no APK attached.
     Publishing is what fires each repo's build-android.yml
     `on: release: types: [published]` trigger — CI builds the debug APK via
     Gradle and uploads it to that same release.
"""

import os, sys, re, json, subprocess, time, urllib.request, urllib.error
if hasattr(sys.stdout, "reconfigure"): sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"): sys.stderr.reconfigure(encoding="utf-8")

if sys.platform == "win32":
    os.system("")

from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
ROOT           = Path(__file__).parent.parent.parent
REPO_OWNER     = "Juice-WRLD-API"
REPO_NAME      = "Unreleased"
# Release channels, keyed by branch. `android` cuts stable releases
# (android-v<ver>); `android-dev` cuts betas (android-beta-v<ver>). The branch
# you're on picks the channel; any other branch is refused by the guard.
CHANNELS = {
    "android":     {"tag_prefix": "android-v",      "label": "stable"},
    "android-dev": {"tag_prefix": "android-beta-v", "label": "beta"},
}

def _current_branch():
    r = subprocess.run("git rev-parse --abbrev-ref HEAD", shell=True, cwd=ROOT,
                       capture_output=True, text=True)
    return r.stdout.strip()

# The branch we're on, if it's a release channel; otherwise fall back to
# "android" so guard_only_android_branch() reports the mismatch.
ANDROID_BRANCH = _current_branch() if _current_branch() in CHANNELS else "android"
TAG_PREFIX     = CHANNELS[ANDROID_BRANCH]["tag_prefix"]
CHANNEL        = CHANNELS[ANDROID_BRANCH]["label"]
API_BASE       = "https://api.github.com"
APK_PATH       = ROOT / "android" / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"
ANDROID_PACKAGE = "com.juicewrldapi.player"

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

def banner():
    w = 66
    print()
    print(_c("╔" + "═"*(w-2) + "╗", CYN, BOLD))
    row = "  🤖  UNRELEASED — Android Release & Publish  "
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

def run(cmd, check=True, cwd=None):
    detail(f"> {cmd}")
    r = subprocess.run(cmd, shell=True, cwd=cwd or ROOT)
    if check and r.returncode != 0:
        raise RuntimeError(f"Command failed (exit {r.returncode}):\n  {cmd}")
    return r

def capture(cmd, cwd=None):
    r = subprocess.run(cmd, shell=True, cwd=cwd or ROOT, capture_output=True, text=True)
    return r.stdout.strip()

def find_adb():
    """adb is frequently not on PATH even when the Android SDK is installed —
    fall back to the standard platform-tools location (mirrors the same
    fallback in scripts/run-android.bat)."""
    from shutil import which
    found = which("adb")
    if found:
        return found
    local = os.environ.get("LOCALAPPDATA", "")
    fallback = Path(local) / "Android" / "Sdk" / "platform-tools" / "adb.exe"
    if fallback.exists():
        return str(fallback)
    die("adb not found (checked PATH and the default Android SDK location).\n"
        "     Install the Android SDK platform-tools, or drop --install to skip deploying.")


def is_dirty():
    return bool(capture("git status --porcelain"))

def git_branch():
    return capture("git rev-parse --abbrev-ref HEAD")

# ── android/app/build.gradle version fields ────────────────────────────────────

GRADLE_PATH = ROOT / "android" / "app" / "build.gradle"

def load_version():
    text = GRADLE_PATH.read_text("utf-8")
    m = re.search(r'versionName\s+"([^"]+)"', text)
    if not m:
        die("Could not find versionName in android/app/build.gradle")
    return m.group(1)

def load_version_code():
    text = GRADLE_PATH.read_text("utf-8")
    m = re.search(r'versionCode\s+(\d+)', text)
    if not m:
        die("Could not find versionCode in android/app/build.gradle")
    return int(m.group(1))

def set_version(new_ver, new_code):
    text = GRADLE_PATH.read_text("utf-8")
    text, n1 = re.subn(r'(versionName\s+)"[^"]+"', rf'\g<1>"{new_ver}"', text, count=1)
    text, n2 = re.subn(r'(versionCode\s+)\d+', rf'\g<1>{new_code}', text, count=1)
    if n1 == 0 or n2 == 0:
        die("Could not update versionName/versionCode in android/app/build.gradle")
    GRADLE_PATH.write_text(text, "utf-8")

def bump(v, part):
    maj, mn, pat = map(int, v.split("-")[0].split("."))
    if part == "major": return f"{maj+1}.0.0"
    if part == "minor": return f"{maj}.{mn+1}.0"
    return f"{maj}.{mn}.{pat+1}"

# ── GitHub API ────────────────────────────────────────────────────────────────

def get_token():
    t = os.environ.get("GH_TOKEN")
    if t: return t
    env = ROOT / ".env.local"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("GH_TOKEN="):
                return line.split("=", 1)[1].strip()
    die("GH_TOKEN not found.\nSet it as an environment variable or add GH_TOKEN=xxx to .env.local")

def api(method, path, token, data=None):
    url  = f"{API_BASE}{path}"
    hdrs = {
        "Authorization": f"token {token}",
        "Accept":        "application/vnd.github+json",
        "Content-Type":  "application/json",
        "User-Agent":    "release_android.py",
    }
    body = json.dumps(data).encode() if data else None
    req  = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    with urllib.request.urlopen(req) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else {}

# ── Guard ─────────────────────────────────────────────────────────────────────

def guard_only_android_branch():
    """This script must never run its commit/build/push/release steps against
    app or web — an android/ tree change landing on either would be exactly
    the leak this whole two-script split exists to prevent (see release.py's
    guard_no_mobile_dirs). Checked before anything mutates state."""
    if git_branch() not in CHANNELS:
        die(f"Expected to be on one of {', '.join(CHANNELS)}, got '{git_branch()}'.\n"
            f"     This script only operates on those branches — switch manually\n"
            f"     if that's really where you want to be, then re-run.")

# ── Prompts ───────────────────────────────────────────────────────────────────

TOTAL = 8

def step_sync_remote(state):
    section(1, TOTAL, f"Sync with origin/{ANDROID_BRANCH}")
    guard_only_android_branch()

    run("git fetch origin")

    behind = capture(f"git rev-list --count {ANDROID_BRANCH}..origin/{ANDROID_BRANCH}")
    ahead  = capture(f"git rev-list --count origin/{ANDROID_BRANCH}..{ANDROID_BRANCH}")
    behind, ahead = int(behind or 0), int(ahead or 0)

    if behind and ahead:
        die(f"{ANDROID_BRANCH} has diverged from origin/{ANDROID_BRANCH} "
            f"({ahead} local, {behind} remote).\n"
            f"     Reconcile by hand, then re-run:\n"
            f"       git log --oneline origin/{ANDROID_BRANCH}..{ANDROID_BRANCH}\n"
            f"       git rebase origin/{ANDROID_BRANCH}   (or merge)")

    if behind:
        info(f"{behind} new commit(s) on origin/{ANDROID_BRANCH} — fast-forwarding")
        run(f"git merge --ff-only origin/{ANDROID_BRANCH}")
        ok(f"Fast-forwarded to {capture('git rev-parse --short HEAD')}")
    elif ahead:
        ok(f"Up to date ({ahead} unpushed local commit(s))")
    else:
        ok(f"Up to date with origin/{ANDROID_BRANCH}")


def prompt_version():
    section(2, TOTAL, "Version")
    cur = load_version()
    cur_code = load_version_code()
    info(f"Current versionName: {_c(cur, WHT, BOLD)}   versionCode: {_c(cur_code, WHT, BOLD)}")
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
        new_ver = ask("Version (e.g. 2.0.0)")
        if not re.fullmatch(r"\d+\.\d+\.\d+", new_ver):
            die("Invalid format. Use major.minor.patch")
    elif part == "keep":
        new_ver = cur

    # versionCode always advances — two APKs can't legally share one, and
    # nothing here should require the operator to remember to bump it.
    new_code = cur_code + 1
    ok(f"versionName: {cur} → {_c(new_ver, WHT, BOLD)}   versionCode: {cur_code} → {_c(new_code, WHT, BOLD)}")
    return new_ver, new_code


def prompt_commit_message(version):
    section(3, TOTAL, "Commit message")

    if is_dirty():
        info("Uncommitted changes:")
        for line in capture("git status --short").splitlines():
            detail(line)
        return ask("Commit message", default=f"android v{version}")
    else:
        ok("Nothing to commit — tree is clean")
        return None


def prompt_release_notes():
    section(4, TOTAL, "Release notes")
    return ask("Release notes  (blank = auto-generate from commits)", default="")


# ── Steps ─────────────────────────────────────────────────────────────────────

def step_apply_version(new_ver, new_code, state):
    if new_ver != state["original_version"] or new_code != state["original_version_code"]:
        set_version(new_ver, new_code)
        state["version_changed"] = True


def step_commit(version, msg, state):
    section(5, TOTAL, f"Commit → {ANDROID_BRANCH}")
    guard_only_android_branch()

    state["pre_commit_sha"] = capture("git rev-parse HEAD")

    if msg is not None:
        run("git add -A")
        run(f'git commit -m "{msg}"')
        state["committed"] = True
        ok(f"Committed: {msg}")
    else:
        ok("Nothing to commit — tree is clean")


def step_build(skip_install):
    """Only runs at all when --install is passed — an ordinary release no
    longer needs a local build, since build-android.yml builds the APK in CI
    once the GitHub release is published (see step_release). --install exists
    purely for deploying a local test build to a connected device/emulator,
    same recipe scripts/run-android.bat runs interactively; issuing the
    commands directly here (not shelling out to the .bat) because the .bat is
    built around a *person* watching it (boots an emulator, waits, prompts,
    pauses at the end), none of which suits a script, and the previous
    incarnation of delegating to a bash script broke outright because
    `subprocess.run(shell=True)` on Windows always goes through cmd.exe, whose
    PATH has no Git usr/bin.

    If you change these build steps, keep build-android.yml in sync by hand.

    Debug-signed (assembleDebug) — there's no release-signing keystore for
    this app yet. Fine for sideloading, not for a Play Store submission or an
    auto-update feed — don't repurpose this step for either without adding
    real signing first."""
    section(6, TOTAL, "Build, sync, compile & deploy APK  (--install)")
    if skip_install:
        info("Skipped — CI builds the release APK now (pass --install to also build")
        info("and deploy a local test build to a connected device/emulator)")
        return

    warn("This can take a few minutes on a cold Gradle cache — output streams below")
    warn("--install: requires a device or emulator connected via adb")
    print()

    if APK_PATH.exists():
        APK_PATH.unlink()

    detail("> npm run build")
    if subprocess.run("npm run build", shell=True, cwd=ROOT).returncode != 0:
        raise RuntimeError("npm run build failed. See output above.")

    detail("> npx cap sync android")
    if subprocess.run("npx cap sync android", shell=True, cwd=ROOT).returncode != 0:
        raise RuntimeError("cap sync failed. See output above.")

    # Full path, not a bare `gradlew.bat` — this machine has
    # NoDefaultCurrentDirectoryInExePath set, a Windows security setting that
    # disables the implicit "search cwd" fallback cmd.exe normally uses to
    # resolve an executable name. A bare name silently fails to resolve even
    # though cwd is set correctly (dir/cmd builtins are unaffected, which is
    # what made this confusing to track down — only the exe-search path is
    # blocked). An explicit path bypasses that resolution step entirely.
    gradlew = ROOT / "android" / "gradlew.bat"
    detail(f"> {gradlew.name} assembleDebug")
    if subprocess.run([str(gradlew), "assembleDebug"], shell=True, cwd=ROOT / "android").returncode != 0:
        raise RuntimeError("Gradle build failed. See output above.")

    if not APK_PATH.exists():
        raise RuntimeError(f"Build reported success but no APK at {APK_PATH}")

    adb = find_adb()
    detail(f"> {adb} install -r {APK_PATH.relative_to(ROOT)}")
    if subprocess.run([adb, "install", "-r", str(APK_PATH)], cwd=ROOT).returncode != 0:
        raise RuntimeError("adb install failed — if there's no device/emulator connected, "
                            "connect one, or re-run without --install.")

    detail(f"> {adb} shell am start -n {ANDROID_PACKAGE}/.MainActivity")
    subprocess.run([adb, "shell", "am", "start", "-n", f"{ANDROID_PACKAGE}/.MainActivity"], cwd=ROOT)

    ok(f"Build complete, installed & launched → {APK_PATH.relative_to(ROOT)}")


def step_push(token, state):
    section(7, TOTAL, f"Push → origin/{ANDROID_BRANCH}")
    guard_only_android_branch()
    run(f"git push origin {ANDROID_BRANCH}")
    state["pushed"] = True
    ok(f"Pushed to origin/{ANDROID_BRANCH}")


def step_release(version, token, notes, state):
    section(8, TOTAL, "GitHub release")
    """Publishes the GitHub release itself, with no assets — CI attaches the
    APK. Publishing (not drafting) is what fires build-android.yml's
    `on: release: types: [published]` trigger on each repo the branch was
    just pushed to."""
    tag = f"{TAG_PREFIX}{version}"
    state["tag"] = tag
    state["token"] = token

    if not notes:
        notes = capture(
            f'git log $(git describe --tags --match "{TAG_PREFIX}*" --abbrev=0 2>nul)..HEAD --pretty="- %s" --no-merges 2>nul'
            if sys.platform == "win32" else
            f'git log $(git describe --tags --match "{TAG_PREFIX}*" --abbrev=0 2>/dev/null)..HEAD --pretty="- %s" --no-merges 2>/dev/null'
        ) or f"Android {CHANNEL} release {tag}"

    _publish_github_release(REPO_OWNER, REPO_NAME, tag, notes, token, state,
                             id_key="release_id", new_key="release_created_new")

    print()
    info("CI is now building the debug APK and will attach it to the release")
    info("once the build finishes — nothing left to do here.")


def _publish_github_release(owner, repo, tag, notes, token, state, id_key, new_key):
    """Create/update a published GitHub release on (owner, repo) — no assets.
    Publishing fires build-android.yml, which builds and attaches the APK."""
    info(f"Creating release {_c(tag, WHT, BOLD)} on {owner}/{repo} (target: {ANDROID_BRANCH})…")
    try:
        release = api("POST",
            f"/repos/{owner}/{repo}/releases", token,
            # target_commitish pins the tag to this branch specifically —
            # without it GitHub defaults to the repo's default branch, which
            # would misattach an android tag to unrelated history.
            {"tag_name": tag, "name": tag, "body": notes,
             "target_commitish": ANDROID_BRANCH,
             "draft": False, "prerelease": False,
             # keep desktop v* as GitHub's "Latest" so the desktop auto-updater is unaffected
             "make_latest": "false"})
        state[id_key] = release["id"]
        state[new_key] = True
        ok(f"Release created  (id={release['id']})")
    except urllib.error.HTTPError as e:
        if e.code == 422:
            release = api("GET",
                f"/repos/{owner}/{repo}/releases/tags/{tag}", token)
            api("PATCH",
                f"/repos/{owner}/{repo}/releases/{release['id']}", token,
                {"prerelease": False, "make_latest": "false", "body": notes})
            state[id_key] = release["id"]
            state[new_key] = False
            ok(f"Release already exists — updated  (id={release['id']})")
        else:
            raise

    url = f"https://github.com/{owner}/{repo}/releases/tag/{tag}"
    print()
    print(_c(f"  🚀  {url}", GRN, BOLD))


# ── Rollback ──────────────────────────────────────────────────────────────────

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
            pass

    if state.get("pushed"):
        warn(f"{ANDROID_BRANCH} already pushed to origin. Not auto-reverting shared history.")
        detail(f"To undo manually: git reset --hard {state.get('pre_commit_sha')} && "
               f"git push --force origin {ANDROID_BRANCH}")
    elif state.get("committed") and state.get("pre_commit_sha"):
        doomed = capture("git rev-parse --short HEAD")
        backup = f"backup/{state.get('tag') or 'android-release'}-{time.strftime('%Y%m%d-%H%M%S')}"
        if capture(f"git branch {backup} 2>&1") == "":
            ok(f"Saved the discarded commit ({doomed}) on branch {_c(backup, WHT, BOLD)}")
            detail(f"Recover with: git cherry-pick {backup}")
        else:
            warn(f"Could not create backup branch — recover {doomed} via `git reflog`")
        run(f"git reset --hard {state['pre_commit_sha']}", check=False)
        ok(f"Reverted local commit (and version bump) on {ANDROID_BRANCH}")
    elif state.get("version_changed"):
        set_version(state["original_version"], state["original_version_code"])
        ok(f"Reverted build.gradle version to {state['original_version']} ({state['original_version_code']})")

    print()


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    # Off by default: --skip-install is still accepted (it's already the
    # default behavior, so this is a no-op) purely so an old habit or a
    # script calling this one with that flag doesn't break.
    args = sys.argv[1:]
    skip_install = "--install" not in args
    banner()
    state = {}
    try:
        token = get_token()

        guard_only_android_branch()
        step_sync_remote(state)

        state["original_version"] = load_version()
        state["original_version_code"] = load_version_code()

        version, version_code = prompt_version()
        step_apply_version(version, version_code, state)
        commit_msg = prompt_commit_message(version)
        release_notes = prompt_release_notes()

        step_commit(version, commit_msg, state)
        step_build(skip_install)
        step_push(token, state)
        step_release(version, token, release_notes, state)

        print()
        print(_c("  " + "═" * 46, GRN, BOLD))
        print(_c(f"  ✓  android {CHANNEL} v{version} released successfully!", GRN, BOLD))
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

    wait()


if __name__ == "__main__":
    main()
