#!/usr/bin/env python3
"""Build the static site into docs/ from tracks/ (GPX files, NOTES.txt, site.json) and the git history.

Run locally:  python3 build.py && python3 -m http.server -d docs 8765
On GitHub the workflow in .github/workflows/build.yml runs this on every push.
"""
import json
import math
import os
import re
import shutil
import subprocess
import sys
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
TRACKS = os.path.join(ROOT, "tracks")
SRC = os.path.join(ROOT, "site")
OUT = os.path.join(ROOT, "docs")

warnings = []


def warn(msg):
    warnings.append(msg)
    print("WARNING:", msg, file=sys.stderr)


# ---------- GPX ----------

def read_gpx(path):
    pts = []
    for el in ET.parse(path).getroot().iter():
        if el.tag.rsplit("}", 1)[-1] not in ("trkpt", "rtept"):
            continue
        ele = None
        for c in el:
            if c.tag.rsplit("}", 1)[-1] == "ele" and c.text:
                ele = float(c.text)
        pts.append((float(el.get("lat")), float(el.get("lon")), ele))
    return pts


def haversine(a, b):
    r = 6371000.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def simplify(pts, tol_m=4.0):
    """Douglas-Peucker on a local flat projection; returns kept indices."""
    if len(pts) < 3:
        return list(range(len(pts)))
    lat0 = math.radians(pts[0][0])
    xy = [(p[1] * 111320 * math.cos(lat0), p[0] * 110540) for p in pts]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        s, e = stack.pop()
        (x1, y1), (x2, y2) = xy[s], xy[e]
        dx, dy = x2 - x1, y2 - y1
        seg = dx * dx + dy * dy
        best, idx = -1.0, -1
        for i in range(s + 1, e):
            px, py = xy[i]
            if seg == 0:
                d = math.hypot(px - x1, py - y1)
            else:
                t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / seg))
                d = math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
            if d > best:
                best, idx = d, i
        if best > tol_m:
            keep[idx] = True
            stack += [(s, idx), (idx, e)]
    return [i for i, k in enumerate(keep) if k]


def track_stats(pts):
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + haversine(a, b))
    eles = [p[2] for p in pts if p[2] is not None]
    has_ele = len(eles) > len(pts) * 0.8
    gain = loss = 0.0
    if has_ele:
        # Planned routes take elevation from a terrain model, which is bumpy. Resample every 50 m,
        # smooth over 250 m, then ignore wiggles under 3 m. Gives a conservative estimate.
        res, nxt = [], 0.0
        for p, d in zip(pts, cum):
            if d >= nxt and p[2] is not None:
                res.append(p[2])
                nxt = d + 50
        sm = [sum(res[max(0, i - 2):i + 3]) / len(res[max(0, i - 2):i + 3]) for i in range(len(res))]
        ref = sm[0]
        for e in sm[1:]:
            if e > ref + 3:
                gain += e - ref
                ref = e
            elif e < ref - 3:
                loss += ref - e
                ref = e
    total = cum[-1]
    profile = []
    if has_ele:
        step, nxt = total / 400, 0.0
        for p, d in zip(pts, cum):
            if d >= nxt and p[2] is not None:
                profile.append([round(d / 1000, 2), round(p[2]), round(p[0], 5), round(p[1], 5)])
                nxt = d + step
    line = [[round(pts[i][0], 5), round(pts[i][1], 5)] for i in simplify(pts)]
    return {
        "km": round(total / 1000, 1),
        "climb": round(gain) if has_ele else None,
        "descent": round(loss) if has_ele else None,
        "minEle": round(min(eles)) if has_ele else None,
        "maxEle": round(max(eles)) if has_ele else None,
        "loop": haversine(pts[0], pts[-1]) < 1000,
        "start": [round(pts[0][0], 5), round(pts[0][1], 5)],
        "end": [round(pts[-1][0], 5), round(pts[-1][1], 5)],
        "line": line,
        "profile": profile,
    }


# ---------- NOTES.txt ----------

FIELD = re.compile(r"^([A-Z][A-Za-z/ ()-]{1,30}):\s*(.*)$")
LABELS = {  # tidy label names so similar fields read the same on every track
    "shade": "Shaded", "climbs/descents": "Up/downhills", "notes": "Notes",
}


def parse_body(body):
    fields = []
    for line in body.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        m = FIELD.match(line)
        if m:
            key = LABELS.get(m.group(1).lower(), m.group(1))
            fields.append([key, m.group(2).strip()])
        elif fields:
            fields[-1][1] += " " + line
        else:
            fields.append(["Notes", line])
    return fields


def parse_header(text):
    blocks = []
    for line in text.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("* "):
            if not blocks or blocks[-1]["type"] != "ul":
                blocks.append({"type": "ul", "items": []})
            blocks[-1]["items"].append(line[2:])
        elif re.match(r"^\dof5\s*-", line):
            n, txt = re.match(r"^(\d)of5\s*-\s*(.*)$", line).groups()
            if not blocks or blocks[-1]["type"] != "scale":
                blocks.append({"type": "scale", "items": []})
            blocks[-1]["items"].append([int(n), txt])
        else:
            blocks.append({"type": "p", "text": line})
    return blocks


def parse_notes(text):
    parts = re.split(r"\n\s*-{10,}\s*\n", "\n" + text.replace("\r\n", "\n"))
    header = parse_header(parts[0])
    sections = {}
    for i in range(1, len(parts) - 1, 2):
        name, body = parts[i].strip(), parts[i + 1]
        m = re.match(r"(\d+)-", name)
        if not m:
            warn(f"NOTES.txt: can't find a track number in section title '{name}'")
            continue
        sections[m.group(1).zfill(2)] = {"title": name, "fields": parse_body(body)}
    return header, sections


# ---------- git history ----------

def git(*args):
    try:
        return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


def commits(pathspec):
    """Oldest first. A 'By: name' line in the commit message credits someone other than the uploader;
    a 'Skip-Version: yes' line keeps a commit (like the first import) out of the version count."""
    out = git("log", "--reverse", "--format=%H%x1f%an%x1f%aI%x1f%B%x1e", "--", pathspec)
    result = []
    for rec in out.split("\x1e"):
        rec = rec.strip("\n")
        if not rec:
            continue
        sha, author, date, body = rec.split("\x1f")
        by, skip, lines = author, False, []
        for line in body.strip().splitlines():
            if re.match(r"^by:\s*", line, re.I):
                by = re.sub(r"^by:\s*", "", line, flags=re.I).strip()
            elif re.match(r"^skip-version:\s*yes", line, re.I):
                skip = True
            elif not re.match(r"^[\w-]+:\s", line) or not lines:
                lines.append(line)
        note = lines[0].strip() if lines else "Updated"
        if by != author:
            by = f"{by} (uploaded by {author})"
        if not skip:
            result.append({"date": date[:10], "by": by, "note": note, "sha": sha[:7]})
    return result


# ---------- build ----------

def track_name(filename):
    stem = os.path.splitext(filename)[0]
    stem = re.sub(r"^\d+-(\d+of\d+-)?", "", stem)
    return stem.replace("-", " ")


def flags(fields):
    d = {k.lower(): v for k, v in fields}
    out = []
    if "smoke" in d.get("legal", "").lower():
        out.append({"level": "warn", "text": "Part closed in smoke season"})
    wet = d.get("wet conditions", "").lower()
    if "problematic" in wet:
        out.append({"level": "warn", "text": "Hard when wet"})
    elif wet.startswith("medium") or "slippery" in wet:
        out.append({"level": "mid", "text": "Slippery when wet"})
    elif wet:
        out.append({"level": "ok", "text": "OK when wet"})
    return out


def main():
    with open(os.path.join(TRACKS, "site.json")) as f:
        site = json.load(f)
    with open(os.path.join(TRACKS, "history-seed.json")) as f:
        seed = json.load(f)
    notes_path = os.path.join(TRACKS, "NOTES.txt")
    with open(notes_path, encoding="utf-8") as f:
        header, sections = parse_notes(f.read())

    gpx_files = sorted(f for f in os.listdir(TRACKS) if f.lower().endswith(".gpx"))
    tracks = []
    for fn in gpx_files:
        m = re.match(r"(\d+)-", fn)
        if not m:
            warn(f"{fn}: file name should start with a track number like '08-'")
            continue
        tid = m.group(1).zfill(2)
        pts = read_gpx(os.path.join(TRACKS, fn))
        if len(pts) < 2:
            warn(f"{fn}: no track points found")
            continue
        st = track_stats(pts)
        sec = sections.get(tid)
        fields = sec["fields"] if sec else []
        if not sec:
            warn(f"{fn}: no section for track {tid} in NOTES.txt")
        fd = {k.lower(): v for k, v in fields}
        diff = None
        dm = re.match(r"(\d)\s*/\s*5", fd.get("difficulty", ""))
        fm = re.match(r"\d+-(\d)of5", fn)
        if dm:
            diff = int(dm.group(1))
        elif fm:
            diff = int(fm.group(1))
        if dm and fm and dm.group(1) != fm.group(1):
            warn(f"{fn}: file name says {fm.group(1)}of5 but NOTES.txt says {dm.group(1)}/5")
        if sec and os.path.splitext(sec["title"])[0] != os.path.splitext(fn)[0]:
            warn(f"NOTES.txt section title '{sec['title']}' doesn't match the file name '{fn}'")
        lm = re.search(r"(\d+)\s*km", fd.get("length", ""))
        if lm and abs(int(lm.group(1)) - st["km"]) > max(5, 0.15 * st["km"]):
            warn(f"{fn}: NOTES.txt says {lm.group(1)} km, the GPX measures {st['km']} km")
        terrain = [int(x) for x in re.findall(r"(\d+)%", fd.get("terrain", ""))]
        if terrain and sum(terrain) != 100:
            warn(f"{fn}: terrain percentages add up to {sum(terrain)}%, not 100%")
        if st["climb"] is None:
            warn(f"{fn}: no elevation data, so no climb total or profile")

        history = seed.get(tid, []) + commits(f"tracks/{tid}-*")
        for i, h in enumerate(history):
            h["version"] = i + 1
        notes_hist = commits("tracks/NOTES.txt")
        tracks.append({
            "id": tid,
            "file": fn,
            "name": track_name(fn),
            "difficulty": diff,
            "fields": [f for f in fields if f[0].lower() != "difficulty"],
            "flags": flags(fields),
            "history": history,
            "notesUpdated": notes_hist[-1] if notes_hist else (seed.get("notes") or [None])[-1],
            **st,
        })

    # site-wide change log, newest first
    changes = []
    for key, entries in seed.items():
        if key.startswith("_"):
            continue
        for e in entries:
            label = "Track notes" if key == "notes" else next((t["name"] for t in tracks if t["id"] == key), key)
            changes.append({**e, "what": label, "track": None if key == "notes" else key})
    for c in commits("tracks/"):
        files = git("show", "--name-only", "--format=", c["sha"]).split()
        ids = sorted({m.group(1) for f in files if (m := re.match(r"tracks/(\d+)-", f))})
        what = ", ".join(next((t["name"] for t in tracks if t["id"] == i), i) for i in ids)
        if "tracks/NOTES.txt" in files:
            what = (what + ", track notes") if what else "Track notes"
        changes.append({**c, "what": what or "Site text", "track": ids[0] if len(ids) == 1 else None})
    changes.sort(key=lambda c: c["date"], reverse=True)

    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    shutil.copytree(SRC, OUT)
    os.makedirs(os.path.join(OUT, "gpx"))
    zpath = os.path.join(OUT, "gpx", "all-tracks.zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for t in tracks:
            shutil.copy2(os.path.join(TRACKS, t["file"]), os.path.join(OUT, "gpx", t["file"]))
            z.write(os.path.join(TRACKS, t["file"]), t["file"])
        z.write(notes_path, "IMPORTANT NOTES.txt")
    shutil.copy2(notes_path, os.path.join(OUT, "gpx", "IMPORTANT NOTES.txt"))
    open(os.path.join(OUT, ".nojekyll"), "w").close()

    data = {
        "site": site,
        "rules": header,
        "tracks": tracks,
        "changes": changes[:60],
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "commit": git("rev-parse", "--short", "HEAD").strip() or None,
    }
    os.makedirs(os.path.join(OUT, "data"), exist_ok=True)
    with open(os.path.join(OUT, "data", "tracks.json"), "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"Built {len(tracks)} tracks into docs/ ({len(warnings)} warnings)")


if __name__ == "__main__":
    main()
