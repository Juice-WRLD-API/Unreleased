#!/usr/bin/env python3
"""
upload_release.py — Upload assets to a GitHub release.

Usage:
    python scripts/python/upload_release.py <file> [<file2> ...] [--tag v1.7.9]

Examples:
    python scripts/python/upload_release.py "release/Unreleased-Setup-1.7.9.exe"
    python scripts/python/upload_release.py "release/Unreleased-Setup-1.7.9.exe" "release/latest.yml" "release/Unreleased-Setup-1.7.9.exe.blockmap"
    python scripts/python/upload_release.py release/* --tag v1.7.8

The script:
  - Reads GH_TOKEN from environment or .env.local
  - Gets the release for the given tag (it must already exist)
  - Deletes any existing asset with the same name
  - Streams the upload with a live progress bar
  - Prints the download URL on success
"""

import os
import sys
import json
import argparse
import urllib.request
import urllib.error
import urllib.parse
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
REPO_OWNER = "Juice-WRLD-API"
REPO_NAME  = "Unreleased"
API_BASE   = "https://api.github.com"
UPLOAD_BASE = "https://uploads.github.com"

# ── Token ─────────────────────────────────────────────────────────────────────
def get_token():
    token = os.environ.get("GH_TOKEN")
    if token:
        return token
    # Try .env.local in project root
    env_path = Path(__file__).parent.parent.parent / ".env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("GH_TOKEN="):
                return line.split("=", 1)[1].strip()
    print("ERROR: GH_TOKEN not found. Set it as an environment variable or in .env.local")
    sys.exit(1)

# ── HTTP helpers ──────────────────────────────────────────────────────────────
def api_request(method, path, token, data=None):
    url = f"{API_BASE}{path}"
    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "upload_release.py",
    }
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            # DELETE answers 204 with no body.
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        print(f"HTTP {e.code} on {method} {url}: {body[:300]}")
        raise

# ── Upload with progress ──────────────────────────────────────────────────────
# http.client streams a file-like body with `data.read(self.blocksize)` and
# blocksize is 8192, so a 92 MB asset means ~11,800 reads — each one its own
# sendall and, before this, its own console repaint. 1 MB blocks (read() may
# return more than asked; send() just forwards it) plus a bar that only
# repaints when the percentage actually moves.
UPLOAD_CHUNK = 1_048_576


class ProgressFileWrapper:
    def __init__(self, path):
        self._file = open(path, "rb")
        self._size = os.path.getsize(path)
        self._read = 0
        self._last_pct = -1

    def read(self, n=-1):
        chunk = self._file.read(UPLOAD_CHUNK if n is None or n < 0 else max(n, UPLOAD_CHUNK))
        self._read += len(chunk)
        pct = self._read * 100 // self._size if self._size else 0
        if pct != self._last_pct:
            self._last_pct = pct
            bar = "#" * (pct // 2) + "-" * (50 - pct // 2)
            mb_done = self._read / 1_048_576
            mb_total = self._size / 1_048_576
            print(f"\r  [{bar}] {pct:3d}%  {mb_done:.1f}/{mb_total:.1f} MB", end="", flush=True)
        return chunk

    def __len__(self):
        return self._size

    def close(self):
        self._file.close()

def upload_asset(release_id, filepath, token):
    name = Path(filepath).name
    size = os.path.getsize(filepath)
    print(f"\nUploading: {name}  ({size / 1_048_576:.1f} MB)")

    url = f"{UPLOAD_BASE}/repos/{REPO_OWNER}/{REPO_NAME}/releases/{release_id}/assets?name={urllib.parse.quote(name)}"
    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/octet-stream",
        "Content-Length": str(size),
        "User-Agent": "upload_release.py",
    }

    wrapper = ProgressFileWrapper(filepath)
    req = urllib.request.Request(url, data=wrapper, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read())
            print(f"\n  ✓ {result['name']} uploaded — {result['browser_download_url']}")
            return result
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        print(f"\n  ✗ HTTP {e.code}: {body[:300]}")
        raise
    finally:
        wrapper.close()

# ── Get or infer tag from package.json ───────────────────────────────────────
def get_default_tag():
    pkg = Path(__file__).parent.parent.parent / "package.json"
    if pkg.exists():
        v = json.loads(pkg.read_text()).get("version", "")
        if v:
            return f"v{v}"
    return None

# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Upload files to a GitHub release")
    parser.add_argument("files", nargs="+", help="Files to upload")
    parser.add_argument("--tag", help="Release tag (default: version from package.json)")
    args = parser.parse_args()

    token = get_token()
    tag = args.tag or get_default_tag()
    if not tag:
        print("ERROR: could not determine tag. Pass --tag v1.x.x")
        sys.exit(1)

    # Expand globs / verify files exist
    files = []
    for f in args.files:
        p = Path(f)
        if not p.exists():
            print(f"WARNING: {f} not found, skipping")
            continue
        if p.is_file():
            files.append(str(p))

    if not files:
        print("No files to upload.")
        sys.exit(1)

    print(f"Tag: {tag}")
    print(f"Files: {[Path(f).name for f in files]}")

    # Get release
    try:
        release = api_request("GET", f"/repos/{REPO_OWNER}/{REPO_NAME}/releases/tags/{tag}", token)
        print(f"Found release: {release['name']} (id={release['id']})")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print(f"No release found for tag {tag}. Create the release on GitHub first.")
            sys.exit(1)
        raise

    release_id = release["id"]

    # Delete existing assets with same names
    existing = {a["name"]: a for a in release.get("assets", [])}
    for filepath in files:
        name = Path(filepath).name
        if name in existing:
            print(f"Deleting existing asset: {name}")
            api_request("DELETE", f"/repos/{REPO_OWNER}/{REPO_NAME}/releases/assets/{existing[name]['id']}", token)

    # Upload each file
    for filepath in files:
        upload_asset(release_id, filepath, token)

    print("\nAll done.")

if __name__ == "__main__":
    main()
