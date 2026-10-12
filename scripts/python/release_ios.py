#!/usr/bin/env python3
"""
Unreleased Music Player — iOS (Capacitor) Release Script

Just run it (or double-click release_ios.bat).

Separate from release.py and release_android.py on purpose: this one only
ever touches the `ios` branch. It never checks out, commits to, or pushes
app/web/android, and the GitHub release it creates uses its own `ios-v*`
tag prefix (and `target_commitish: ios`) so it never shows up as the
"latest" release for the desktop app's auto-updater or gets anywhere near
the web deploy or the Android release feed.

Unlike release_android.py, there's no local --install step here — building
and running an iOS app requires Xcode, which only runs on macOS, and this
script assumes it's being run from Windows same as the others. The actual
.ipa is built entirely in CI (build-ios.yml) once the release is published,
same as how build-android.yml now builds the release APK.

  1. Fast-forward ios onto origin/ios (avoid building on a stale branch and
     getting rejected at push).
  2. Pick a version (bump patch / minor / major, or keep / custom). This sets
     MARKETING_VERSION in ios/App/App.xcodeproj/project.pbxproj (both the
     Debug and Release build configs); CURRENT_PROJECT_VERSION (the build
     number) always bumps by 1 regardless, same reasoning as Android's
     versionCode — App Store Connect / TestFlight (and some sideloading
     tools) require a strictly increasing build number per version.
  3. Enter a commit message (only if the tree is dirty)
  4. Enter release notes (blank = auto-generate from commits since the last
     ios-v* tag)
  ── nothing left to answer past this point ──
  5. Commit all changes to ios
  6. Push ios to GitHub — origin (Juice-WRLD-API/Unreleased) and the
     leanwrldd/unreleased mirror.
  7. Create the GitHub release (tag ios-v<version>, target_commitish ios) on
     both repos, already published with no .ipa attached. Publishing is what
     fires each repo's build-ios.yml `on: release: types: [published]`
     trigger — CI archives an unsigned .ipa on a macOS runner and uploads it
     to that same release. Unsigned because there's no Apple Developer
     account behind this: users sideload via AltStore/Sideloadly, which
     re-signs locally with their own free Apple ID.
"""

import os, sys, re, json, subprocess, time, urllib.request, urllib.error
if hasattr(sys.stdout, "reconfigure"): sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"): sys.stderr.reconfigure(encoding="utf-8")

if sys.platform == "win32":
    os.system("")

from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
ROOT       = Path(__file__).parent.parent.parent
REPO_OWNER = "Juice-WRLD-API"
REPO_NAME  = "Unreleased"
IOS_BRANCH = "ios"
API_BASE   = "https://api.github.com"
IOS_PACKAGE = "com.juicewrldapi.player"

# Best-effort mirror: every ios release also pushes the branch and publishes
# a matching release here, same as release_android.py does.
MIRROR_OWNER = "leanwrldd"
MIRROR_NAME  = "unreleased"

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
    row = "  🤖  UNRELEASED — iOS Release & Publish  "
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

def is_dirty():
    return bool(capture("git status --porcelain"))

def git_branch():
    return capture("git rev-parse --abbrev-ref HEAD")

def push_mirror_branch(branch, token):
    """Force-push a branch to the mirror repo, authenticating via the token
    embedded in the URL (no persistent remote, nothing written to
    .git/config). Always --force: the mirror isn't collaborative, it just
    has to match origin's branch exactly.

    The token never reaches the console or an exception message — it's
    redacted from both the printed command and any captured stderr.
    """
    url = f"https://{token}@github.com/{MIRROR_OWNER}/{MIRROR_NAME}.git"
    detail(f"> git push https://***@github.com/{MIRROR_OWNER}/{MIRROR_NAME}.git {branch}:{branch} --force")
    r = subprocess.run(f'git push "{url}" {branch}:{branch} --force',
                        shell=True, cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        err = (r.stderr or r.stdout or "").replace(token, "***")
        raise RuntimeError(err.strip()[:500])

# ── ios/App/App.xcodeproj/project.pbxproj version fields ───────────────────────

PBXPROJ_PATH = ROOT / "ios" / "App" / "App.xcodeproj" / "project.pbxproj"

def load_version():
    text = PBXPROJ_PATH.read_text("utf-8")
    m = re.search(r'MARKETING_VERSION\s*=\s*([^;]+);', text)
    if not m:
        die("Could not find MARKETING_VERSION in ios/App/App.xcodeproj/project.pbxproj")
    ver = m.group(1).strip()
    # Xcode's default MARKETING_VERSION is "1.0" (two components) — normalize
    # to major.minor.patch so bump() and the custom-version regex both work.
    parts = ver.split(".")
    while len(parts) < 3:
        parts.append("0")
    return ".".join(parts)

def load_version_code():
    text = PBXPROJ_PATH.read_text("utf-8")
    m = re.search(r'CURRENT_PROJECT_VERSION\s*=\s*(\d+);', text)
    if not m:
        die("Could not find CURRENT_PROJECT_VERSION in ios/App/App.xcodeproj/project.pbxproj")
    return int(m.group(1))

def set_version(new_ver, new_code):
    text = PBXPROJ_PATH.read_text("utf-8")
    # Both fields appear once per build config (Debug + Release) — replace
    # every occurrence so the two configs never drift apart.
    text, n1 = re.subn(r'(MARKETING_VERSION\s*=\s*)[^;]+;', rf'\g<1>{new_ver};', text)
    text, n2 = re.subn(r'(CURRENT_PROJECT_VERSION\s*=\s*)\d+;', rf'\g<1>{new_code};', text)
    if n1 == 0 or n2 == 0:
        die("Could not update MARKETING_VERSION/CURRENT_PROJECT_VERSION in project.pbxproj")
    PBXPROJ_PATH.write_text(text, "utf-8")

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
        "User-Agent":    "release_ios.py",
    }
    body = json.dumps(data).encode() if data else None
    req  = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    with urllib.request.urlopen(req) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else {}

# ── Guard ─────────────────────────────────────────────────────────────────────

def guard_only_ios_branch():
    """This script must never run its commit/push/release steps against
    app/web/android — an ios/ tree change landing on any of those would be
    exactly the leak the per-platform release scripts exist to prevent (see
    release.py's guard_no_mobile_dirs and release_android.py's
    guard_only_android_branch). Checked before anything mutates state."""
    if git_branch() != IOS_BRANCH:
        die(f"Expected to be on '{IOS_BRANCH}', got '{git_branch()}'.\n"
            f"     This script only operates on {IOS_BRANCH} — switch manually\n"
            f"     if that's really where you want to be, then re-run.")

# ── Prompts ───────────────────────────────────────────────────────────────────

TOTAL = 7

def step_sync_remote(state):
    section(1, TOTAL, f"Sync with origin/{IOS_BRANCH}")
    guard_only_ios_branch()

    run("git fetch origin")

    behind = capture(f"git rev-list --count {IOS_BRANCH}..origin/{IOS_BRANCH}")
    ahead  = capture(f"git rev-list --count origin/{IOS_BRANCH}..{IOS_BRANCH}")
    behind, ahead = int(behind or 0), int(ahead or 0)

    if behind and ahead:
        die(f"{IOS_BRANCH} has diverged from origin/{IOS_BRANCH} "
            f"({ahead} local, {behind} remote).\n"
            f"     Reconcile by hand, then re-run:\n"
            f"       git log --oneline origin/{IOS_BRANCH}..{IOS_BRANCH}\n"
            f"       git rebase origin/{IOS_BRANCH}   (or merge)")

    if behind:
        info(f"{behind} new commit(s) on origin/{IOS_BRANCH} — fast-forwarding")
        run(f"git merge --ff-only origin/{IOS_BRANCH}")
        ok(f"Fast-forwarded to {capture('git rev-parse --short HEAD')}")
    elif ahead:
        ok(f"Up to date ({ahead} unpushed local commit(s))")
    else:
        ok(f"Up to date with origin/{IOS_BRANCH}")


def prompt_version():
    section(2, TOTAL, "Version")
    cur = load_version()
    cur_code = load_version_code()
    info(f"Current MARKETING_VERSION: {_c(cur, WHT, BOLD)}   CURRENT_PROJECT_VERSION: {_c(cur_code, WHT, BOLD)}")
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
        new_ver = ask("Version (e.g. 1.1.0)")
        if not re.fullmatch(r"\d+\.\d+\.\d+", new_ver):
            die("Invalid format. Use major.minor.patch")
    elif part == "keep":
        new_ver = cur

    # CURRENT_PROJECT_VERSION always advances — App Store Connect/TestFlight
    # (and some sideloading tools) require a strictly increasing build
    # number, same reasoning as Android's versionCode.
    new_code = cur_code + 1
    ok(f"MARKETING_VERSION: {cur} → {_c(new_ver, WHT, BOLD)}   CURRENT_PROJECT_VERSION: {cur_code} → {_c(new_code, WHT, BOLD)}")
    return new_ver, new_code


def prompt_commit_message(version):
    section(3, TOTAL, "Commit message")

    if is_dirty():
        info("Uncommitted changes:")
        for line in capture("git status --short").splitlines():
            detail(line)
        return ask("Commit message", default=f"ios v{version}")
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
    section(5, TOTAL, f"Commit → {IOS_BRANCH}")
    guard_only_ios_branch()

    state["pre_commit_sha"] = capture("git rev-parse HEAD")

    if msg is not None:
        run("git add -A")
        run(f'git commit -m "{msg}"')
        state["committed"] = True
        ok(f"Committed: {msg}")
    else:
        ok("Nothing to commit — tree is clean")


def step_push(token, state):
    section(6, TOTAL, f"Push → origin/{IOS_BRANCH}")
    guard_only_ios_branch()
    run(f"git push origin {IOS_BRANCH}")
    state["pushed"] = True
    ok(f"Pushed to origin/{IOS_BRANCH}")

    try:
        info(f"Mirroring {IOS_BRANCH} → {MIRROR_OWNER}/{MIRROR_NAME}")
        push_mirror_branch(IOS_BRANCH, token)
        ok(f"Mirrored to {MIRROR_OWNER}/{MIRROR_NAME}")
    except Exception as e:
        warn(f"Mirror push failed (origin unaffected): {e}")


def step_release(version, token, notes, state):
    section(7, TOTAL, "GitHub release")
    """Publishes the GitHub release itself, with no assets — CI attaches the
    unsigned .ipa. Publishing (not drafting) is what fires build-ios.yml's
    `on: release: types: [published]` trigger on each repo the branch was
    just pushed to."""
    tag = f"ios-v{version}"
    state["tag"] = tag
    state["token"] = token

    if not notes:
        notes = capture(
            'git log $(git describe --tags --match "ios-v*" --abbrev=0 2>nul)..HEAD --pretty="- %s" --no-merges 2>nul'
            if sys.platform == "win32" else
            'git log $(git describe --tags --match "ios-v*" --abbrev=0 2>/dev/null)..HEAD --pretty="- %s" --no-merges 2>/dev/null'
        ) or f"iOS release {tag}"

    _publish_github_release(REPO_OWNER, REPO_NAME, tag, notes, token, state,
                             id_key="release_id", new_key="release_created_new")

    try:
        info(f"Mirroring release to {MIRROR_OWNER}/{MIRROR_NAME}…")
        mstate = {}
        _publish_github_release(MIRROR_OWNER, MIRROR_NAME, tag, notes, token, mstate,
                                 id_key="release_id", new_key="release_created_new")
        state["mirror_release_id"] = mstate.get("release_id")
        state["mirror_release_created_new"] = mstate.get("release_created_new")
        state["mirror_tag"] = tag
    except Exception as e:
        warn(f"Mirror release to {MIRROR_OWNER}/{MIRROR_NAME} failed (origin release unaffected): {e}")

    print()
    info("CI is now archiving an unsigned .ipa on a macOS runner and will attach it")
    info("to both releases once the build finishes — nothing left to do here.")


def _publish_github_release(owner, repo, tag, notes, token, state, id_key, new_key):
    """Create/update a published GitHub release on (owner, repo) — no assets.
    Shared by the real release (leanwrldd/unreleased) and the mirror
    (Juice-WRLD-API/Unreleased) so both go through identical create/update
    logic and both end up published (so both fire their own CI build)."""
    info(f"Creating release {_c(tag, WHT, BOLD)} on {owner}/{repo} (target: {IOS_BRANCH})…")
    try:
        release = api("POST",
            f"/repos/{owner}/{repo}/releases", token,
            # target_commitish pins the tag to this branch specifically —
            # without it GitHub defaults to the repo's default branch, which
            # would misattach an ios tag to unrelated history.
            {"tag_name": tag, "name": tag, "body": notes,
             "target_commitish": IOS_BRANCH,
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

    # Mirror release cleanup is best-effort too — it was best-effort to
    # create, so a failure here is just left for manual cleanup.
    if state.get("mirror_release_id") and state.get("mirror_release_created_new") and state.get("token"):
        try:
            api("DELETE", f"/repos/{MIRROR_OWNER}/{MIRROR_NAME}/releases/{state['mirror_release_id']}", state["token"])
            api("DELETE", f"/repos/{MIRROR_OWNER}/{MIRROR_NAME}/git/refs/tags/{state['mirror_tag']}", state["token"])
            ok(f"Deleted mirror release {state.get('mirror_tag')} on {MIRROR_OWNER}/{MIRROR_NAME}")
        except Exception:
            pass

    if state.get("pushed"):
        warn(f"{IOS_BRANCH} already pushed to origin. Not auto-reverting shared history.")
        detail(f"To undo manually: git reset --hard {state.get('pre_commit_sha')} && "
               f"git push --force origin {IOS_BRANCH}")
    elif state.get("committed") and state.get("pre_commit_sha"):
        doomed = capture("git rev-parse --short HEAD")
        backup = f"backup/{state.get('tag') or 'ios-release'}-{time.strftime('%Y%m%d-%H%M%S')}"
        if capture(f"git branch {backup} 2>&1") == "":
            ok(f"Saved the discarded commit ({doomed}) on branch {_c(backup, WHT, BOLD)}")
            detail(f"Recover with: git cherry-pick {backup}")
        else:
            warn(f"Could not create backup branch — recover {doomed} via `git reflog`")
        run(f"git reset --hard {state['pre_commit_sha']}", check=False)
        ok(f"Reverted local commit (and version bump) on {IOS_BRANCH}")
    elif state.get("version_changed"):
        set_version(state["original_version"], state["original_version_code"])
        ok(f"Reverted project.pbxproj version to {state['original_version']} ({state['original_version_code']})")

    print()


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    banner()
    state = {}
    try:
        token = get_token()

        guard_only_ios_branch()
        step_sync_remote(state)

        state["original_version"] = load_version()
        state["original_version_code"] = load_version_code()

        version, version_code = prompt_version()
        step_apply_version(version, version_code, state)
        commit_msg = prompt_commit_message(version)
        release_notes = prompt_release_notes()

        step_commit(version, commit_msg, state)
        step_push(token, state)
        step_release(version, token, release_notes, state)

        print()
        print(_c("  " + "═" * 46, GRN, BOLD))
        print(_c(f"  ✓  ios v{version} released successfully!", GRN, BOLD))
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
