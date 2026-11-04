"""Surface along each track, from OpenStreetMap road tags (standard library only).

Every ~20 m of track is matched to the nearest mapped road within 25 m, and that road's tags decide the class:
single (paths), double (dirt tracks and dirt roads), concrete, tarmac, or unknown (no surface on the map).
Results are cached in tracks/surface-cache.json, keyed by the track's shape, so rebuilds don't hit Overpass;
delete the cache (or a track's entry) to pick up new OpenStreetMap edits.
"""
import hashlib
import json
import math
import os
import time
import urllib.parse
import urllib.request

OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
STEP_M = 20       # sample spacing along the track
SNAP_M = 25       # max distance from a GPS point to a mapped road
CLASSES = ["single", "double", "concrete", "tarmac", "unknown"]

TARMAC = {"asphalt", "paved", "chipseal"}
CONCRETE = {"concrete", "concrete:plates", "concrete:lanes", "paving_stones", "sett", "cobblestone"}
LOOSE = {"unpaved", "compacted", "fine_gravel", "gravel", "pebblestone", "rock", "dirt", "earth", "ground",
         "mud", "sand", "clay", "grass", "grass_paver", "woodchips"}
PATHS = {"path", "footway", "bridleway", "cycleway", "steps"}


def classify(tags):
    """OpenStreetMap tags of one road → (class, rough). rough = Jul's smoothness tag says bad or worse."""
    hw = tags.get("highway", "")
    surface = tags.get("surface", "").split(";")[0].strip()
    rough = tags.get("smoothness", "") in {"bad", "very_bad", "horrible", "very_horrible", "impassable"}
    if hw in PATHS:
        cls = "single"
    elif surface in TARMAC:
        cls = "tarmac"
    elif surface in CONCRETE:
        cls = "concrete"
    elif surface in LOOSE or (hw == "track" and tags.get("tracktype", "") in {"grade2", "grade3", "grade4", "grade5"}):
        cls = "double"
    else:
        cls = "unknown"
    return cls, rough


def _xy(lat, lon, lat0):
    return (lon * 111320 * math.cos(math.radians(lat0)), lat * 110540)


def _seg_dist(p, a, b):
    ax, ay = a; bx, by = b; px, py = p
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def _resample(pts, step):
    """[(lat, lon, km)] every `step` metres along the line."""
    out, km = [(pts[0][0], pts[0][1], 0.0)], 0.0
    carry = 0.0
    for (a, b) in zip(pts, pts[1:]):
        lat0 = a[0]
        d = math.hypot(*(u - v for u, v in zip(_xy(b[0], b[1], lat0), _xy(a[0], a[1], lat0))))
        pos = step - carry
        while pos <= d:
            f = pos / d
            out.append((a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), (km + pos) / 1000))
            pos += step
        carry = d - (pos - step)
        km += d
    return out


def _overpass(samples):
    # small boxes along the track (one per ~2 km) are much faster for Overpass than an "around" line
    pad = 0.0004  # ~45 m
    boxes = []
    for i in range(0, len(samples), 100):
        chunk = samples[i:i + 101]
        la = [p[0] for p in chunk]; lo = [p[1] for p in chunk]
        boxes.append(f"way[highway]({min(la) - pad:.5f},{min(lo) - pad:.5f},{max(la) + pad:.5f},{max(lo) + pad:.5f});")
    q = f"[out:json][timeout:120];({''.join(boxes)});out tags geom;"
    data = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for attempt in range(4):
        url = OVERPASS[attempt % len(OVERPASS)]
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": "cnx-enduro-tracks-build/1.0"})
            with urllib.request.urlopen(req, timeout=150) as r:
                return json.load(r)["elements"]
        except Exception as e:  # busy server: wait and try the other one
            last = e
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"Overpass failed: {last}")


def match(pts, ways):
    """pts = [(lat, lon, ...)], ways = Overpass elements → list of runs [{from, to, cls, rough}] in km."""
    samples = _resample(pts, STEP_M)
    lat0 = samples[0][0]
    cell = 100.0
    grid = {}
    for w in ways:
        cls, rough = classify(w.get("tags", {}))
        g = [_xy(n["lat"], n["lon"], lat0) for n in w.get("geometry", []) if n]
        for a, b in zip(g, g[1:]):
            x0, x1 = sorted((a[0], b[0])); y0, y1 = sorted((a[1], b[1]))
            for gx in range(int((x0 - SNAP_M) // cell), int((x1 + SNAP_M) // cell) + 1):
                for gy in range(int((y0 - SNAP_M) // cell), int((y1 + SNAP_M) // cell) + 1):
                    grid.setdefault((gx, gy), []).append((a, b, cls, rough))
    runs = []
    for la, lo, km in samples:
        p = _xy(la, lo, lat0)
        best = (SNAP_M, "unknown", False)
        for a, b, cls, rough in grid.get((int(p[0] // cell), int(p[1] // cell)), ()):
            d = _seg_dist(p, a, b)
            if d < best[0]:
                best = (d, cls, rough)
        _, cls, rough = best
        if runs and runs[-1]["cls"] == cls and runs[-1]["rough"] == rough:
            runs[-1]["to"] = km
        else:
            if runs:
                runs[-1]["to"] = km
            runs.append({"from": km, "to": km, "cls": cls, "rough": rough})
    # fold away blips shorter than 60 m (junctions, GPS wobble) into the run before
    out = []
    for r in runs:
        if out and (r["to"] - r["from"] < 0.06 or (out[-1]["cls"] == r["cls"] and out[-1]["rough"] == r["rough"])):
            out[-1]["to"] = r["to"]
        else:
            out.append(r)
    for r in out:
        r["from"], r["to"] = round(r["from"], 3), round(r["to"], 3)
    return out


def shares(runs):
    total = sum(r["to"] - r["from"] for r in runs) or 1
    return {c: round(100 * sum(r["to"] - r["from"] for r in runs if r["cls"] == c) / total) for c in CLASSES}


def surfaces_for(pts, cache, key_extra=""):
    """Cached per track shape. pts = [(lat, lon, ...)]."""
    key = hashlib.sha1((key_extra + "".join(f"{p[0]:.5f},{p[1]:.5f};" for p in pts)).encode()).hexdigest()[:16]
    if key not in cache:
        samples = _resample(pts, STEP_M)
        cache[key] = {"runs": match(pts, _overpass(samples)), "fetched": time.strftime("%Y-%m-%d")}
    return cache[key]
