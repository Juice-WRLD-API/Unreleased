"""Compare the API's unreleased songs against the tracker spreadsheet's
"Unreleased Discography" tab and write a report of what differs.

    python scripts/python/sheet_sweep.py                 # fetch both, write report
    python scripts/python/sheet_sweep.py --cache DIR     # reuse/save raw downloads in DIR
    python scripts/python/sheet_sweep.py --out DIR       # where the report goes
    python scripts/python/sheet_sweep.py --fields all    # every field (default: length, era, credits)

Writes <out>/unreleased_sheet_report.md (Discord markdown), the same split
into <=2000-char messages as <out>/discord/001.md, 002.md, ..., and
<out>/unreleased_sheet_report.json (same content, for follow-up scripting).
Songs that match are left out; each listed song shows only its differing fields.
By default only length, era and credits are reported; --fields all shows everything.

Matching: the sheet gets edited after we imported it (versions renumbered,
"with" -> "feat.", titles reworded), so rows are paired with API songs by
base title first and then by content (length, file name, dates, ...), not
just by exact title.
"""

import argparse
import csv
import difflib
import io
import json
import re
import sys
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

SHEET_ID = "1I6g2jrFdxIoYraZqnJ6NfivVHQXLmHR29rFvTAymE_E"
SHEET_GID = "1705371403"  # Unreleased Discography
SHEET_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&gid={SHEET_GID}"
API_URL = "https://juicewrldapi.com/juicewrld/songs/?category=unreleased&page_size=100"
UA = {"User-Agent": "Mozilla/5.0 (unreleased sheet sweep)"}

# Sheet era code -> API era name.
ERA_MAP = {
    "JUTE": "jute",
    "AFF": "afflictions",
    "JW 9 9 9": "jw 999",
    "BDM": "bdm",
    "HIH 9 9 9": "HIH 999",
    "GB&GR": "GB&GR",
    "WOD": "WOD",
    "DRFL": "DRFL",
    "OUT": "OUT",
    "ND </3": "ND",
    "POST": "POST",
}

# Sheet column index -> API field. Compared after normalisation.
FIELDS = {
    3: "credited_artists",
    4: "producers",
    5: "engineers",
    6: "additional_information",
    7: "file_names",
    8: "instrumentals",
    9: "recording_locations",
    10: "record_dates",
    11: "preview_date",
    12: "dates",
    13: "length",
    14: "leak_type",
    15: "bitrate",
}
# Fields the report shows by default (--fields all shows every field plus the
# songs missing from either side).
DEFAULT_FIELDS = ["length", "era", "credited_artists", "producers", "engineers"]
WEAK_SCORE = 5  # pairs scoring below this get listed for manual review
EMPTY = {"", "-", "n/a", "none", "?"}


# ─── Fetching ────────────────────────────────────────────────────────────────

def http_get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read().decode("utf-8")


def fetch_sheet(cache):
    path = cache / "sheet.csv" if cache else None
    if path and path.exists():
        return path.read_text(encoding="utf-8")
    text = http_get(SHEET_URL)
    if text.lstrip().startswith("<"):
        sys.exit("Sheet download returned HTML (not public anymore?)")
    if path:
        path.write_text(text, encoding="utf-8")
    return text


def fetch_api(cache):
    path = cache / "api_unreleased.json" if cache else None
    if path and path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    songs, url = [], API_URL
    while url:
        page = json.loads(http_get(url.replace("http://", "https://")))
        songs += page["results"]
        url = page["next"]
        print(f"  api: {len(songs)}/{page['count']}", end="\r", file=sys.stderr)
    print(file=sys.stderr)
    if path:
        path.write_text(json.dumps(songs, ensure_ascii=False), encoding="utf-8")
    return songs


# ─── Normalisation ───────────────────────────────────────────────────────────

def norm_text(s):
    """Field value -> comparable form: unify newlines/whitespace, drop blanks."""
    s = (s or "").replace("\r\n", "\n").replace("\r", "\n")
    s = s.replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    lines = [re.sub(r"\s+", " ", ln).strip() for ln in s.split("\n")]
    out = "\n".join(ln for ln in lines if ln)
    return "" if out.lower() in EMPTY else out


ORIG_SENTENCE_RE = re.compile(r"[^.]*\boriginally (?:called|titled|named)\b[^.]*\.?", re.I)


def strip_orig_titles(s):
    """The API importer folded "Song was originally called 'X'." notes from the
    title cell into additional_information; drop those sentences on both sides
    (the old title itself is compared through the aliases)."""
    return norm_text(re.sub(r"\s+(and|,)\s*$", "", ORIG_SENTENCE_RE.sub("", s)))


def loose(s):
    """Key for spotting cosmetic-only differences (case, punctuation, spacing)."""
    s = s.lower().replace("completed", "complete")
    return re.sub(r"[^a-z0-9]", "", s)


def norm_title(s):
    s = norm_text(s).lower()
    s = re.sub(r"[^\w\s\[\]()]", "", s)
    return re.sub(r"\s+", " ", s).strip()


FEAT_RE = re.compile(r"\s*[\(\[](?:feat\.?|ft\.?|with|prod\.?)\s[^\)\]]*[\)\]]", re.I)
VER_RE = re.compile(r"\s*[\(\[]v(\d+(?:\.\d+)?)[\)\]]", re.I)


def base_title(s):
    """Title without feature credit, version/mix tag or '*': the grouping key."""
    s = VER_RE.sub("", FEAT_RE.sub("", s.replace("*", "")))
    s = re.sub(r"\s*[\(\[](?:mix|edit) \d+[\)\]]", "", s, flags=re.I)
    return norm_title(s)


def version_of(s):
    m = VER_RE.search(s or "")
    return m.group(1) if m else None


NOTE_RE = re.compile(r"^(song|track|the|this|originally|titled|untitled)\b|\b(was|is|were)\b", re.I)
ORIG_RE = re.compile(r"originally (?:called|titled|named) ['\"‘“](.+?)['\"’”](?:\.|$|\s)", re.I)


def parse_titles(cell):
    """Sheet title cell -> (main title, [aliases], [notes])."""
    lines = [ln.strip() for ln in norm_text(cell).split("\n") if ln.strip()]
    if not lines:
        return "", [], []
    main, aliases, notes = lines[0], [], []
    for ln in lines[1:]:
        if NOTE_RE.search(ln) and len(ln.split()) >= 3:
            notes.append(ln)
            aliases += ORIG_RE.findall(ln)
        else:
            aliases += [a.strip() for a in ln.split(" | ") if a.strip()]
    if " | " in main:  # occasionally the first line already holds aliases
        main, *rest = [a.strip() for a in main.split(" | ")]
        aliases = rest + aliases
    return main, aliases, notes


# ─── Loading ─────────────────────────────────────────────────────────────────

def load_sheet(text):
    rows = list(csv.reader(io.StringIO(text)))
    tracks = []
    for i, row in enumerate(rows, start=1):
        row += [""] * (17 - len(row))
        era, num = row[0].strip(), row[1].strip()
        if not num.isdigit():
            continue  # banners, headers, era separators
        main, aliases, notes = parse_titles(row[2])
        tracks.append({
            "sheet_row": i,
            "era": ERA_MAP.get(era, era),
            "era_raw": era,
            "num": int(num),
            "name": main.replace("*", "").strip(),
            "starred": "*" in main,
            "aliases": aliases,
            "title_notes": notes,
            "fields": {f: norm_text(row[c]) for c, f in FIELDS.items()},
        })
        f = tracks[-1]["fields"]
        f["additional_information"] = strip_orig_titles(f["additional_information"])
    return tracks


def api_track(s):
    fields = {f: norm_text(s.get(f)) for f in FIELDS.values()}
    # The sheet's Date(s) column was imported into date_leaked; `dates` is only
    # filled for a handful of songs (where it holds the full value).
    fields["dates"] = fields["dates"] or norm_text(s.get("date_leaked"))
    fields["additional_information"] = strip_orig_titles(fields["additional_information"])
    return {
        "id": s["id"],
        "public_id": s.get("public_id"),
        "era": (s.get("era") or {}).get("name", ""),
        "name": s["name"],
        "aliases": [t for t in (s.get("track_titles") or []) if t != s["name"]],
        "path": s.get("path", ""),
        "fields": fields,
    }


# ─── Matching ────────────────────────────────────────────────────────────────

def content_score(a, b):
    fa, fb = a["fields"], b["fields"]
    score = 0.0
    for f, w in (("length", 3), ("file_names", 3), ("dates", 2), ("record_dates", 1),
                 ("recording_locations", 1), ("producers", 1), ("bitrate", 1), ("leak_type", 1)):
        if fa[f] and fa[f] == fb[f]:
            score += w
    if norm_title(a["name"]) == norm_title(b["name"]):
        score += 3
    if version_of(a["name"]) == version_of(b["name"]):
        score += 1
    if a["era"] == b["era"]:
        score += 1
    return score


def match(sheet, api):
    """Greedy one-to-one pairing. Returns [(sheet, api, how)], unmatched lists."""
    pairs, used_s, used_a = [], set(), set()

    def assign(cands, how, min_score):
        for score, si, ai in sorted(cands, key=lambda c: -c[0]):
            if si in used_s or ai in used_a or score < min_score:
                continue
            used_s.add(si)
            used_a.add(ai)
            pairs.append((sheet[si], api[ai], how, score))

    by_base = defaultdict(list)
    for ai, a in enumerate(api):
        by_base[base_title(a["name"])].append(ai)

    # 1. same base title (ignores feat./version tags), ranked by content.
    cands = []
    for si, s in enumerate(sheet):
        for ai in by_base.get(base_title(s["name"]), []):
            cands.append((content_score(s, api[ai]), si, ai))
    assign(cands, "title", 0)

    # 2. a sheet title/alias equals an API title/alias (song was renamed).
    alias_idx = defaultdict(set)
    for ai, a in enumerate(api):
        if ai in used_a:
            continue
        for t in [a["name"], *a["aliases"]]:
            alias_idx[base_title(t)].add(ai)
    cands = []
    for si, s in enumerate(sheet):
        if si in used_s:
            continue
        hits = set()
        for t in [s["name"], *s["aliases"]]:
            hits |= alias_idx.get(base_title(t), set())
        cands += [(content_score(s, api[ai]), si, ai) for ai in hits]
    assign(cands, "alias", 5)  # alias alone isn't enough; needs some matching content

    # 3. fuzzy title in the same era, backed by content.
    cands = []
    for si, s in enumerate(sheet):
        if si in used_s:
            continue
        for ai, a in enumerate(api):
            if ai in used_a or a["era"] != s["era"]:
                continue
            r = difflib.SequenceMatcher(None, base_title(s["name"]), base_title(a["name"])).ratio()
            if r >= 0.75:
                cands.append((content_score(s, a) + r * 3, si, ai))
    assign(cands, "fuzzy", 6)

    # 4. no title link at all but identical content (length + file name + dates).
    cands = []
    for si, s in enumerate(sheet):
        if si in used_s:
            continue
        for ai, a in enumerate(api):
            if ai not in used_a:
                cs = content_score(s, a)
                if cs >= 9:
                    cands.append((cs, si, ai))
    assign(cands, "content", 9)

    miss_s = [s for i, s in enumerate(sheet) if i not in used_s]
    miss_a = [a for i, a in enumerate(api) if i not in used_a]
    return pairs, miss_s, miss_a


# ─── Comparison ──────────────────────────────────────────────────────────────

def compare(s, a):
    """-> ({field: (sheet, api)} substantive, {field: ...} cosmetic-only)."""
    diffs = {}
    if s["name"] != a["name"]:
        diffs["name"] = (s["name"], a["name"])
    if s["era"] != a["era"]:
        diffs["era"] = (s["era"], a["era"])
    s_alias = {norm_title(t) for t in s["aliases"]}
    a_alias = {norm_title(t) for t in a["aliases"]}
    if s_alias != a_alias:
        diffs["aliases"] = (sorted(s["aliases"]), sorted(a["aliases"]))
    for f in FIELDS.values():
        if s["fields"][f] != a["fields"][f]:
            diffs[f] = (s["fields"][f], a["fields"][f])
    real, cosmetic = {}, {}
    for k, (sv, av) in diffs.items():
        if k == "aliases":
            same = {loose(t) for t in sv} == {loose(t) for t in av}
        else:
            same = loose(sv) == loose(av)
        (cosmetic if same else real)[k] = (sv, av)
    return real, cosmetic


# ─── Report ──────────────────────────────────────────────────────────────────

DISCORD_LIMIT = 2000  # characters per message
FIELD_LABELS = {
    "name": "Name", "era": "Era", "aliases": "Aliases", "credited_artists": "Credited artists",
    "producers": "Producers", "engineers": "Engineers", "additional_information": "Additional info",
    "file_names": "File names", "instrumentals": "Instrumentals", "recording_locations": "Recording locations",
    "record_dates": "Record dates", "preview_date": "Preview date", "dates": "Dates", "length": "Length",
    "leak_type": "Category", "bitrate": "Available files",
}


def dc_val(v):
    """Value as a Discord inline code span (no escaping needed inside)."""
    if isinstance(v, list):
        v = " / ".join(v)
    v = (v or "").replace("\n", " / ").replace("`", "'")
    return f"`{v}`" if v else "*(empty)*"


def dc_text(s):
    """Escape Discord markdown in plain text (titles can contain * and _)."""
    return re.sub(r"([\*_~`|>#-])", r"\\1", s)


def song_block(r):
    s, a = r["sheet"], r["api"]
    weak = " · ⚠ weak pair, check it's the right version" if r["score"] < WEAK_SCORE else ""
    out = [f"**{dc_text(s['name'])}**", f"-# sheet row {s['sheet_row']} · API id {a['id']}{weak}"]
    for k, (sv, av) in r["diffs"].items():
        out.append(f"- {FIELD_LABELS.get(k, k)}: {dc_val(av)} → {dc_val(sv)}")
    return "\n".join(out)


def split_messages(sections):
    """[(heading, [block, ...]), ...] -> messages of at most DISCORD_LIMIT chars.
    Blocks are never split; a section continued in a new message repeats its heading."""
    msgs, cur = [], ""
    for heading, blocks in sections:
        pending = heading
        for b in blocks:
            piece = (pending + "\n" if pending else "") + b
            if cur and len(cur) + 2 + len(piece) > DISCORD_LIMIT:
                msgs.append(cur)
                cur = ""
                if not pending and heading:
                    piece = f"{heading} (cont.)\n{b}"
            cur = f"{cur}\n\n{piece}" if cur else piece
            pending = ""
    if cur:
        msgs.append(cur)
    return msgs


def write_report(out, sheet, api, pairs, miss_s, miss_a, fields=None):
    """Only songs with at least one real difference (in `fields`, if given)
    make it into the report, and each lists only the fields that differ.
    Written as Discord markdown, split into message-sized chunks."""
    if fields:
        miss_s, miss_a = [], []
    results = []
    for s, a, how, score in pairs:
        d, _ = compare(s, a)
        if fields:
            d = {k: v for k, v in d.items() if k in fields}
        if d:
            results.append({"sheet": s, "api": a, "match": how, "score": score, "diffs": d})
    results.sort(key=lambda r: r["sheet"]["sheet_row"])
    field_counts = Counter(k for r in results for k in r["diffs"])

    summary = (f"{', '.join(FIELD_LABELS.get(f, f) for f in fields)} · {len(results)} songs differ" if fields else
               f"{len(results)} songs differ · {len(miss_s)} only in the sheet · {len(miss_a)} only in the API")
    sections = [("", ["# Unreleased discography: API vs tracker sheet",
                      f"-# {summary}\n-# each line reads API value → sheet value"])]
    if miss_s:
        sections.append((f"## Only in the sheet ({len(miss_s)})",
                         [f"- **{dc_text(s['name'])}** ({s['era']}) -# row {s['sheet_row']}" for s in miss_s]))
    if miss_a:
        sections.append((f"## Only in the API ({len(miss_a)})",
                         [f"- **{dc_text(a['name'])}** ({a['era']}) -# id {a['id']}" for a in miss_a]))
    by_era = defaultdict(list)
    for r in results:
        by_era[r["sheet"]["era"]].append(song_block(r))
    sections += [(f"## {era}", blocks) for era, blocks in by_era.items()]

    messages = split_messages(sections)
    out.mkdir(parents=True, exist_ok=True)
    md = out / "unreleased_sheet_report.md"
    md.write_text("\n\n".join(messages) + "\n", encoding="utf-8")
    msg_dir = out / "discord"
    msg_dir.mkdir(exist_ok=True)
    for old in msg_dir.glob("*.md"):
        old.unlink()
    for i, m in enumerate(messages, 1):
        (msg_dir / f"{i:03d}.md").write_text(m + "\n", encoding="utf-8")
    (out / "unreleased_sheet_report.json").write_text(json.dumps({
        "sheet_only": miss_s, "api_only": miss_a, "differences": results,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    return md, field_counts, len(results), len(messages)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "reports")
    ap.add_argument("--cache", type=Path, help="save/reuse raw downloads here")
    ap.add_argument("--fields", default=",".join(DEFAULT_FIELDS),
                    help=f"comma-separated fields to report, or 'all' (default: {','.join(DEFAULT_FIELDS)})")
    args = ap.parse_args()
    if args.cache:
        args.cache.mkdir(parents=True, exist_ok=True)

    print("Fetching sheet…", file=sys.stderr)
    sheet = load_sheet(fetch_sheet(args.cache))
    print("Fetching API…", file=sys.stderr)
    api = [api_track(s) for s in fetch_api(args.cache)]

    unknown = sorted({t["era_raw"] for t in sheet if t["era_raw"] not in ERA_MAP})
    if unknown:
        print(f"warning: unmapped sheet eras {unknown}", file=sys.stderr)

    pairs, miss_s, miss_a = match(sheet, api)
    fields = None if args.fields == "all" else [f.strip() for f in args.fields.split(",") if f.strip()]
    valid = {"name", "era", "aliases", *FIELDS.values()}
    bad = [f for f in fields or [] if f not in valid]
    if bad:
        sys.exit(f"unknown field(s) {bad}; pick from {sorted(valid)}")
    md, field_counts, differing, n_msgs = write_report(args.out, sheet, api, pairs, miss_s, miss_a, fields)

    print(f"sheet {len(sheet)} | api {len(api)} | paired {len(pairs)} ({differing} differ) | "
          f"sheet-only {len(miss_s)} | api-only {len(miss_a)}")
    print("differing fields:", ", ".join(f"{f}={n}" for f, n in field_counts.most_common()))
    print(f"report: {md} ({n_msgs} Discord messages in {md.parent / 'discord'})")


if __name__ == "__main__":
    main()
