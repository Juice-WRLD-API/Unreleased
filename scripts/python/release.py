#!/usr/bin/env python3
"""
Unreleased Music Player - Web Release Script

Just run it - no arguments needed.

This branch (the mobile-web UI port, currently `dev`, destined to become the
live `web` branch) is fully decoupled from `app`'s release pipeline - see
`app`'s scripts/python/release.py `step_sync_web`, which is now a no-op for
exactly this reason. There is no build step and no GitHub-release/installer
machinery here: the live site (player.juicewrldapi.com) is served straight
from a checkout of this branch, so "release" just means "get a clean commit
onto origin and let that checkout pick it up".

Steps:
  1. Fast-forward onto origin/<branch> (whatever branch you're actually on -
     this script doesn't assume it's already been renamed to `web`).
  2. Pick a version (bump patch / minor / major, or keep / custom).
  3. Enter a commit message (only if the tree is dirty).
  4. Commit, then push to origin.
  5. Optionally tag the commit and create a GitHub release (changelog only -
     no assets; nothing downloads this branch's build).
"""

import os, sys, re, json, subprocess, time, urllib.request, urllib.error
if hasattr(sys.stdout, "reconfigure"): sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"): sys.stderr.reconfigure(encoding="utf-8")

if sys.platform == "win32":
    os.system("")

from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
ROOT       = Path(__file__).parent.parent.parent
REPO_OWNER = "leanwrldd"
REPO_NAME  = "unreleased"
API_BASE   = "https://api.github.com"

# Best-effort mirror (same GH_TOKEN, same pattern as app's release.py) - origin
# is the source of truth, the mirror is a nice-to-have that never blocks or
# rolls back the real push.
MIRROR_OWNER = "Juice-WRLD-API"
MIRROR_NAME  = "Unreleased"

# ── ANSI helpers ──────────────────────────────────────────────────────────────
RST, BOLD, DIM = "\033[0m", "\033[1m", "\033[2m"
RED, GRN, YLW, CYN, WHT = "\033[91m", "\033[92m", "\033[93m", "\033[96m", "\033[97m"

def _c(text, *codes): return "".join(codes) + str(text) + RST

def banner():
    w = 66
    print()
    print(_c("╔" + "═"*(w-2) + "╗", CYN, BOLD))
    row = "  🌐  UNRELEASED  - Web Release  "
    print(_c("║", CYN, BOLD) + _c(row.ljust(w-2), WHT, BOLD) + _c("║", CYN, BOLD))
    print(_c("╚" + "═"*(w-2) + "╝", CYN, BOLD))
    print()

def section(n, total, title):
    print()
    print(_c(f"  [{n}/{total}]  {title}", WHT, BOLD))
    print(_c("  " + "─"*52, DIM))
    print()

def ok(msg):     print(_c("  ✓  ", GRN, BOLD)  + msg)
def info(msg):   print(_c("  ·  ", CYN)        + msg)
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
        raise RuntimeError(f"Command failed (exit {r.returncode}):\n  {cmd}")
    return r

def capture(cmd):
    r = subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True)
    return r.stdout.strip()

def is_dirty():
    return bool(capture("git status --porcelain"))

def git_branch():
    return capture("git rev-parse --abbrev-ref HEAD")

def push_mirror_branch(branch, token):
    """Force-push a branch to the mirror repo, authenticating via the token
    embedded in the URL (no persistent remote, nothing written to
    .git/config). Always --force: the mirror isn't collaborative, it just
    has to match origin's branch exactly, and on a brand-new/empty mirror
    repo a plain push has nothing to fast-forward from.

    The token never reaches the console or an exception message - it's
    redacted from both the printed command and any captured stderr.
    """
    url = f"https://{token}@github.com/{MIRROR_OWNER}/{MIRROR_NAME}.git"
    detail(f"> git push https://***@github.com/{MIRROR_OWNER}/{MIRROR_NAME}.git {branch}:{branch} --force")
    r = subprocess.run(f'git push "{url}" {branch}:{branch} --force',
                        shell=True, cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        err = (r.stderr or r.stdout or "").replace(token, "***")
        raise RuntimeError(err.strip()[:500])

# ── package.json ──────────────────────────────────────────────────────────────

def load_version():
    return json.loads((ROOT / "package.json").read_text("utf-8"))["version"]

def set_version(new_ver):
    path = ROOT / "package.json"
    text = path.read_text("utf-8")
    new_text, n = re.subn(r'("version"\s*:\s*)"[^"]+"', rf'\g<1>"{new_ver}"', text, count=1)
    if n == 0:
        die("Could not find version field in package.json")
    path.write_text(new_text, "utf-8")

def bump(v, part):
    maj, mn, pat = map(int, v.split("-")[0].split("."))
    if part == "major": return f"{maj+1}.0.0"
    if part == "minor": return f"{maj}.{mn+1}.0"
    return f"{maj}.{mn}.{pat+1}"

# ── GitHub API (only used for the optional release step) ─────────────────────

def get_token():
    t = os.environ.get("GH_TOKEN")
    if t: return t
    env = ROOT / ".env.local"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("GH_TOKEN="):
                return line.split("=", 1)[1].strip()
    return None

def api(method, path, token, data=None):
    url = f"{API_BASE}{path}"
    hdrs = {
        "Authorization": f"token {token}",
        "Accept":        "application/vnd.github+json",
        "Content-Type":  "application/json",
        "User-Agent":    "release.py",
    }
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    with urllib.request.urlopen(req) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else {}

# ── Prompts (collected up front, then everything runs unattended) ────────────

TOTAL = 5

def step_sync_remote(branch, state):
    """Fast-forward onto origin/<branch> before touching anything, so a stale
    local checkout doesn't get rejected at push time after the version bump
    and commit already happened."""
    section(1, TOTAL, f"Sync with origin/{branch}")
    run("git fetch origin")

    behind = int(capture(f"git rev-list --count {branch}..origin/{branch}") or 0)
    ahead  = int(capture(f"git rev-list --count origin/{branch}..{branch}") or 0)

    if behind and ahead:
        die(f"{branch} has diverged from origin/{branch} ({ahead} local, {behind} remote).\n"
            f"     Reconcile by hand, then re-run:\n"
            f"       git log --oneline origin/{branch}..{branch}\n"
            f"       git rebase origin/{branch}   (or merge)")

    if behind:
        info(f"{behind} new commit(s) on origin/{branch} - fast-forwarding")
        run(f"git merge --ff-only origin/{branch}")
        ok(f"Fast-forwarded to {capture('git rev-parse --short HEAD')}")
    elif ahead:
        ok(f"Up to date ({ahead} unpushed local commit(s))")
    else:
        ok(f"Up to date with origin/{branch}")


def prompt_version():
    section(2, TOTAL, "Version")
    cur = load_version()
    info(f"Current version: {_c(cur, WHT, BOLD)}")
    print()
    opts = [
        ("1", "keep",   cur,               "Keep current"),
        ("2", "patch",  bump(cur, "patch"),"Bump patch  "),
        ("3", "minor",  bump(cur, "minor"),"Bump minor  "),
        ("4", "major",  bump(cur, "major"),"Bump major  "),
        ("5", "custom", None,              "Custom…     "),
    ]
    for k, _, v, label in opts:
        print(_c(f"    {k}) {label}  {v or '?'}", DIM))

    choice = ask("Choice", default="2")
    entry = next((o for o in opts if o[0] == choice), None)
    if not entry:
        die("Invalid choice.")

    _, part, new_ver, _ = entry
    if part == "custom":
        new_ver = ask("Version (e.g. 2.1.0)")
        if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", new_ver):
            die("Invalid format. Use major.minor.patch, optionally with a pre-release suffix.")
    elif part == "keep":
        ok(f"Keeping {_c(cur, WHT, BOLD)}")
        return cur

    ok(f"Version: {cur}  →  {_c(new_ver, WHT, BOLD)}")
    return new_ver


def prompt_commit_message(version):
    section(3, TOTAL, "Commit message")
    if is_dirty():
        info("Uncommitted changes:")
        for line in capture("git status --short").splitlines():
            detail(line)
        return ask("Commit message", default=f"v{version}")
    ok("Nothing to commit - tree is clean")
    return None


def prompt_release():
    """A GitHub release here is a changelog entry, not a downloadable
    artifact - nothing consumes this branch's build. Skippable since most
    web releases won't need one."""
    make = confirm("Create a GitHub release for this version? (changelog only, no assets)", default=False)
    if not make:
        return None, None
    notes = ask("Release notes  (blank = auto-generate from commits)", default="")
    return True, notes


# ── Steps ──────────────────────────────────────────────────────────────────

def step_apply_version(new_ver, state):
    if new_ver != state["original_version"]:
        set_version(new_ver)
        state["version_changed"] = True


def step_commit(branch, version, msg, state):
    state["pre_commit_sha"] = capture("git rev-parse HEAD")
    if msg is not None:
        run("git add -A")
        run(f'git commit -m "{msg}"')
        state["committed"] = True
        ok(f"Committed: {msg}")
    else:
        ok("Nothing to commit - tree is clean")


def step_push(branch, state):
    section(4, TOTAL, f"Push → origin/{branch}")
    run(f"git push origin {branch}")
    state["pushed"] = True
    ok(f"Pushed to origin/{branch}")

    token = get_token()
    if not token:
        warn("GH_TOKEN not found (env var or .env.local) - skipping mirror push.")
        return
    try:
        info(f"Mirroring {branch} → {MIRROR_OWNER}/{MIRROR_NAME}")
        push_mirror_branch(branch, token)
        ok(f"Mirrored to {MIRROR_OWNER}/{MIRROR_NAME}")
    except Exception as e:
        warn(f"Mirror push failed (origin unaffected): {e}")


def step_release(branch, version, notes, state):
    section(5, TOTAL, "GitHub release  (changelog only)")
    token = get_token()
    if not token:
        warn("GH_TOKEN not found (env var or .env.local) - skipping release.")
        detail(f"Tag it later with: git tag v{version} && git push origin v{version}")
        return

    tag = f"v{version}"
    state["tag"] = tag
    state["token"] = token

    if not notes:
        notes = capture(
            f'git log $(git describe --tags --abbrev=0 2>nul)..HEAD --pretty="- %s" --no-merges 2>nul'
            if sys.platform == "win32" else
            f'git log $(git describe --tags --abbrev=0 2>/dev/null)..HEAD --pretty="- %s" --no-merges 2>/dev/null'
        ) or f"Release {tag}"

    info(f"Creating release {_c(tag, WHT, BOLD)}…")
    try:
        release = api("POST", f"/repos/{REPO_OWNER}/{REPO_NAME}/releases", token,
            {"tag_name": tag, "name": tag, "body": notes,
             "target_commitish": branch, "draft": False, "prerelease": False})
        state["release_id"] = release["id"]
        state["release_created_new"] = True
        ok(f"Release created  (id={release['id']})")
    except urllib.error.HTTPError as e:
        if e.code == 422:
            release = api("GET", f"/repos/{REPO_OWNER}/{REPO_NAME}/releases/tags/{tag}", token)
            api("PATCH", f"/repos/{REPO_OWNER}/{REPO_NAME}/releases/{release['id']}", token,
                {"body": notes})
            state["release_id"] = release["id"]
            state["release_created_new"] = False
            ok(f"Release already exists - updated  (id={release['id']})")
        else:
            raise

    print()
    print(_c(f"  🚀  https://github.com/{REPO_OWNER}/{REPO_NAME}/releases/tag/{tag}", GRN, BOLD))


# ── Rollback ──────────────────────────────────────────────────────────────────

def rollback(state):
    if not state:
        return
    print()
    warn("Rolling back what's safely revertible…")

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
        warn(f"Already pushed to origin/{state.get('branch')} - the live site reads from this "
             f"branch. Not auto-reverting.")
        detail(f"To undo manually: git reset --hard {state.get('pre_commit_sha')} && "
               f"git push --force origin {state.get('branch')}")
    elif state.get("committed") and state.get("pre_commit_sha"):
        doomed = capture("git rev-parse --short HEAD")
        backup = f"backup/{state.get('tag') or 'release'}-{time.strftime('%Y%m%d-%H%M%S')}"
        if capture(f"git branch {backup} 2>&1") == "":
            ok(f"Saved the discarded commit ({doomed}) on branch {_c(backup, WHT, BOLD)}")
            detail(f"Recover with: git cherry-pick {backup}")
        else:
            warn(f"Could not create backup branch - recover {doomed} via `git reflog`")
        run(f"git reset --hard {state['pre_commit_sha']}", check=False)
        ok("Reverted local commit (and version bump)")
    elif state.get("version_changed") and state.get("original_version"):
        set_version(state["original_version"])
        ok(f"Reverted package.json version to {state['original_version']}")

    print()


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    banner()
    state = {}
    try:
        branch = git_branch()
        state["branch"] = branch
        info(f"On branch {_c(branch, WHT, BOLD)}")

        step_sync_remote(branch, state)
        state["original_version"] = load_version()

        version = prompt_version()
        step_apply_version(version, state)
        commit_msg = prompt_commit_message(version)
        make_release, release_notes = prompt_release()

        step_commit(branch, version, commit_msg, state)
        step_push(branch, state)
        if make_release:
            step_release(branch, version, release_notes, state)

        print()
        print(_c("  " + "═"*46, GRN, BOLD))
        print(_c(f"  ✓  v{version} released to {branch}!", GRN, BOLD))
        print(_c("  " + "═"*46, GRN, BOLD))
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
