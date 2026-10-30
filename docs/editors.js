(async function () {
  const $ = id => document.getElementById(id);
  const data = await loadData();
  const { site, tracks } = data;

  $("owners").textContent = site.owners.join(", ");
  if (site.repo) {
    const base = `https://github.com/${site.repo}`;
    $("linkTracks").href = `${base}/tree/main/tracks`;
    $("linkNotes").href = `${base}/blob/main/tracks/NOTES.txt`;
  } else {
    $("repoMissing").hidden = false;
  }

  $("cmpTrack").innerHTML = tracks.map(t => `<option value="${t.id}">${t.id} · ${esc(t.name)}</option>`).join("");

  const map = baseMap("cmpMap");
  let group = L.featureGroup().addTo(map);
  let rec = null;

  function metersXY(lat0) {
    const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
    return ([lat, lon]) => [lon * kx, lat * ky];
  }

  // Shortest distance from each recorded point to the current track line, in metres.
  function offsets(line, pts) {
    const toXY = metersXY(line[0][0]);
    const L2 = line.map(toXY);
    return pts.map(p => {
      const [px, py] = toXY(p);
      let best = Infinity;
      for (let i = 0; i < L2.length - 1; i++) {
        const [x1, y1] = L2[i], [x2, y2] = L2[i + 1];
        const dx = x2 - x1, dy = y2 - y1, seg = dx * dx + dy * dy;
        const t = seg ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / seg)) : 0;
        const d = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
        if (d < best) best = d;
      }
      return best;
    });
  }

  function draw() {
    group.clearLayers();
    const t = tracks.find(t => t.id === $("cmpTrack").value);
    const idx = tracks.indexOf(t);
    L.polyline(t.line, { color: colorFor(idx), weight: 5, opacity: 0.9 }).addTo(group);
    if (!rec) {
      $("cmpResult").textContent = "";
      map.fitBounds(group.getBounds(), { padding: [20, 20] });
      return;
    }
    const step = Math.max(1, Math.floor(rec.length / 3000));
    const pts = rec.filter((_, i) => i % step === 0);
    const off = offsets(t.line, pts);
    L.polyline(pts, { color: "#fff", weight: 2, opacity: 0.9 }).addTo(group);
    let runs = 0, inRun = false, worst = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const bad = off[i] > 50;
      if (bad) {
        L.polyline([pts[i], pts[i + 1]], { color: "#ff4d4d", weight: 6 }).addTo(group);
        worst = Math.max(worst, off[i]);
        if (!inRun) runs++;
      }
      inRun = bad;
    }
    $("cmpResult").innerHTML = runs
      ? `<b style="color:var(--warn)">${runs} section${runs > 1 ? "s" : ""} off the track</b> · furthest ${Math.round(worst)} m away.`
      : `<b style="color:var(--ok)">The recording follows the track</b> (everything within 50 m).`;
    map.fitBounds(group.getBounds(), { padding: [20, 20] });
  }

  $("cmpTrack").addEventListener("change", draw);
  $("cmpFile").addEventListener("change", async e => {
    const f = e.target.files[0];
    if (!f) return;
    rec = parseGpxText(await f.text());
    if (rec.length < 2) {
      rec = null;
      $("cmpResult").textContent = "No track points found in that file.";
      return;
    }
    draw();
  });
  draw();
})();
