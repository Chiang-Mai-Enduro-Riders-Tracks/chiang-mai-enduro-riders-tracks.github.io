(async function () {
  const $ = id => document.getElementById(id);
  let data;
  try {
    data = await loadData();
  } catch (e) {
    $("list").innerHTML = `<li class="muted">Couldn't load the tracks. Please reload the page.</li>`;
    return;
  }
  const { site, tracks } = data;

  document.title = site.title;
  $("title").textContent = site.title;
  $("subtitle").textContent = site.subtitle;
  $("intro").textContent = site.intro;
  $("restricted").textContent = site.restricted;
  $("contribute").textContent = site.contribute;
  $("credit").textContent = site.credit;
  $("built").textContent = `Site updated ${fmtDate(data.built)}`;

  // "Read before riding" block from the header of NOTES.txt
  $("rulesBody").innerHTML = data.rules.map(b => {
    if (b.type === "ul") return `<ul>${b.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>`;
    if (b.type === "scale") return `<div class="scale">${b.items.map(([n, t]) => `${dots(n)}<span>${esc(t)}</span>`).join("")}</div>`;
    return `<p>${esc(b.text)}</p>`;
  }).join("");

  // ---------- map ----------
  const map = baseMap("map");
  const layers = {};
  const all = L.featureGroup().addTo(map);
  tracks.forEach((t, i) => {
    t.color = colorFor(i);
    const casing = L.polyline(t.line, { color: "#000", weight: 7, opacity: 0.55, interactive: false });
    const line = L.polyline(t.line, { color: t.color, weight: 4, opacity: 0.95 });
    const start = L.circleMarker(t.start, { radius: 6, color: "#000", weight: 2, fillColor: t.color, fillOpacity: 1 });
    line.bindTooltip(`${t.id} · ${esc(t.name)}`, { sticky: true });
    start.bindTooltip(`Start · ${esc(t.name)}`);
    const g = L.featureGroup([casing, line, start]).addTo(all);
    g.on("click", () => go(t.id));
    g.on("mouseover", () => highlight(t.id, true));
    g.on("mouseout", () => highlight(t.id, false));
    layers[t.id] = { g, line, casing, start };
  });
  const allBounds = L.latLngBounds(tracks.flatMap(t => t.line));
  const fitAll = () => map.fitBounds(allBounds, { padding: [24, 24] });
  fitAll();

  function highlight(id, on) {
    const card = document.querySelector(`.card[data-id="${id}"]`);
    if (card) card.classList.toggle("hl", on);
    const l = layers[id];
    if (l && !current) l.line.setStyle({ weight: on ? 7 : 4 });
    if (l && on) l.g.bringToFront();
  }

  // ---------- list ----------
  const stat = (label, val) => val == null ? "" : `<span>${label} <b>${val}</b></span>`;
  const latest = t => t.history[t.history.length - 1];
  const verLine = t => {
    const h = latest(t);
    return h ? `v${h.version} · ${fmtDate(h.date)} · ${esc(h.by)}` : "";
  };
  const field = (t, key) => (t.fields.find(f => f[0].toLowerCase() === key) || [])[1];
  const hours = t => (field(t, "length") || "").match(/\(([^)]*)\)/)?.[1];

  $("list").innerHTML = tracks.map(t => `
    <li><button class="card" data-id="${t.id}">
      <span class="swatch" style="background:${t.color}"></span>
      <span>
        <h3><span class="num">${t.id}</span>${esc(t.name)}</h3>
        <span class="stats">
          <span>${dots(t.difficulty)}</span>
          ${stat("", t.km + " km")}
          ${hours(t) ? stat("", esc(hours(t))) : ""}
          ${stat("↑ ≈", t.climb != null ? t.climb + " m" : null)}
          ${stat("", t.loop ? "Loop" : "One way")}
        </span>
        <span class="chips">${t.flags.map(f => `<span class="chip ${f.level}">${esc(f.text)}</span>`).join("")}</span>
        <span class="ver" style="display:block">${verLine(t)}</span>
      </span>
    </button></li>`).join("");
  document.querySelectorAll(".card").forEach(c => {
    c.addEventListener("click", () => go(c.dataset.id));
    c.addEventListener("mouseenter", () => highlight(c.dataset.id, true));
    c.addEventListener("mouseleave", () => highlight(c.dataset.id, false));
  });

  $("changes").innerHTML = data.changes.slice(0, 12).map(c => `
    <li><time>${fmtDate(c.date)}</time>
    <span>${c.track ? `<a href="#${c.track}">${esc(c.what)}</a>` : `<b>${esc(c.what)}</b>`}
    — ${esc(c.note)} <span class="muted">· ${esc(c.by)}</span></span></li>`).join("");

  // ---------- detail ----------
  let current = null;
  let hoverMarker = null;

  function go(id) { location.hash = id ? "#" + id : ""; }

  function showOverview() {
    current = null;
    $("detail").hidden = true;
    $("overview").hidden = false;
    $("profile").hidden = true;
    if (hoverMarker) { hoverMarker.remove(); hoverMarker = null; }
    for (const l of Object.values(layers)) {
      l.line.setStyle({ opacity: 0.95, weight: 4 });
      l.casing.setStyle({ opacity: 0.55 });
      l.start.setStyle({ opacity: 1, fillOpacity: 1 });
    }
    map.invalidateSize();
    fitAll();
  }

  function showTrack(t) {
    current = t;
    for (const [id, l] of Object.entries(layers)) {
      const on = id === t.id;
      l.line.setStyle({ opacity: on ? 1 : 0.25, weight: on ? 5 : 3 });
      l.casing.setStyle({ opacity: on ? 0.7 : 0 });
      l.start.setStyle({ opacity: on ? 1 : 0.25, fillOpacity: on ? 1 : 0.25 });
    }
    layers[t.id].g.bringToFront();

    const h = latest(t);
    const legalIdx = t.fields.findIndex(f => f[0].toLowerCase() === "legal");
    const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${t.start[0]},${t.start[1]}`;
    $("detail").innerHTML = `
      <button class="back" id="back">← All tracks</button>
      <div class="detail-head">
        <div class="muted small">Track ${t.id} · ${dots(t.difficulty)} ${t.difficulty ? t.difficulty + "/5" : ""}</div>
        <h2>${esc(t.name)}</h2>
        <div class="chips">${t.flags.map(f => `<span class="chip ${f.level}">${esc(f.text)}</span>`).join("")}</div>
      </div>
      <div class="actions">
        <a class="btn primary" href="gpx/${encodeURIComponent(t.file)}" download>Download GPX</a>
        <a class="btn" href="${gmaps}" target="_blank" rel="noopener">Directions to start</a>
        <button class="btn" data-app="gaia">Open in Gaia</button>
        <button class="btn" data-app="locus">Open in Locus</button>
        <button class="btn" id="copy">Copy link</button>
      </div>
      <div id="appHelp" class="apphelp" hidden></div>
      <div class="facts">
        <div class="fact"><span>Distance</span><b>${t.km} km</b></div>
        <div class="fact"><span>Climbing (est.)</span><b>${t.climb != null ? "≈" + t.climb + " m" : "—"}</b></div>
        <div class="fact"><span>Highest</span><b>${t.maxEle != null ? t.maxEle + " m" : "—"}</b></div>
        <div class="fact"><span>Route</span><b>${t.loop ? "Loop" : "One way"}</b></div>
      </div>
      <dl class="desc">${t.fields.map((f, i) => `<dt>${esc(f[0])}</dt><dd class="${i === legalIdx ? "legal" : ""}">${esc(f[1])}</dd>`).join("")}</dl>
      <h2 class="section">Version history</h2>
      <ul class="history">${[...t.history].reverse().map(v => `
        <li><b>v${v.version}</b> · ${fmtDate(v.date)} · ${esc(v.by)}<br><span class="muted">${esc(v.note)}</span></li>`).join("")}</ul>
      <p class="muted small">Current file: ${esc(t.file)}${h ? ` (v${h.version})` : ""}.
        Notes last changed ${t.notesUpdated ? fmtDate(t.notesUpdated.date) + " by " + esc(t.notesUpdated.by) : "—"}.</p>
      <p class="muted small">${esc(site.contribute)}</p>`;
    $("overview").hidden = true;
    $("detail").hidden = false;
    $("back").onclick = () => go("");
    $("copy").onclick = async () => {
      try { await navigator.clipboard.writeText(location.href); $("copy").textContent = "Copied"; }
      catch { $("copy").textContent = "Copy failed"; }
    };
    document.querySelectorAll("[data-app]").forEach(b => b.onclick = () => openInApp(t, b.dataset.app));
    document.querySelector(".panel").scrollTop = 0;
    if (window.innerWidth <= 820) window.scrollTo({ top: 0 });

    drawProfile(t);
    map.invalidateSize();
    map.fitBounds(L.latLngBounds(t.line), { padding: [30, 30] });
  }

  // Neither app has a public "open this link" address, so hand the GPX file to Android's share
  // sheet (the rider taps Gaia GPS or Locus Map). Where the browser can't share files, download
  // it and show the import steps for that app instead.
  const APPS = {
    gaia: {
      name: "Gaia GPS",
      steps: ["Open the downloaded file from the notification or the Files app and choose <b>Gaia GPS</b>.",
        "Or in Gaia: <b>Saved</b> → <b>⋮</b> → <b>Import File</b> → pick the file in Downloads."],
    },
    locus: {
      name: "Locus Map",
      steps: ["Open the downloaded file from the notification or the Files app and choose <b>Locus Map</b>.",
        "Or in Locus: <b>Import</b> → <b>Remote file</b> → paste. The track's link is already copied."],
    },
  };

  async function openInApp(t, key) {
    const app = APPS[key];
    const url = new URL("gpx/" + encodeURIComponent(t.file), location.href).href;
    const help = $("appHelp");
    try {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], t.file, { type: "application/gpx+xml" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: t.name });
        help.hidden = false;
        help.innerHTML = `In the list that opened, tap <b>${app.name}</b>.`;
        return;
      }
    } catch (e) {
      if (e.name === "AbortError") return; // rider closed the share sheet
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = t.file;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (key === "locus") { try { await navigator.clipboard.writeText(url); } catch {} }
    help.hidden = false;
    help.innerHTML = `<b>GPX downloaded.</b> To open it in ${app.name}:<ul>${app.steps.map(s => `<li>${s}</li>`).join("")}</ul>`;
  }

  function drawProfile(t) {
    const box = $("profile");
    box.hidden = false;
    const p = t.profile;
    if (!p.length) {
      box.innerHTML = `<div class="none">No elevation data in this GPX file.</div>`;
      return;
    }
    const W = 1000, H = 128, padT = 10, padB = 18;
    const maxKm = p[p.length - 1][0];
    let lo = Math.min(...p.map(q => q[1])), hi = Math.max(...p.map(q => q[1]));
    if (hi - lo < 50) hi = lo + 50;
    const x = km => (km / maxKm) * W;
    const y = e => padT + (1 - (e - lo) / (hi - lo)) * (H - padT - padB);
    const pts = p.map(q => `${x(q[0]).toFixed(1)},${y(q[1]).toFixed(1)}`).join(" ");
    const ticks = [];
    const step = maxKm > 80 ? 20 : maxKm > 30 ? 10 : 5;
    for (let k = step; k < maxKm; k += step) ticks.push(k);
    box.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Elevation profile">
        <polygon points="0,${H - padB} ${pts} ${W},${H - padB}" fill="${t.color}" fill-opacity="0.22"/>
        <polyline points="${pts}" fill="none" stroke="${t.color}" stroke-width="2" vector-effect="non-scaling-stroke"/>
        ${ticks.map(k => `<line x1="${x(k)}" x2="${x(k)}" y1="${H - padB}" y2="${H - padB + 4}" stroke="var(--muted)" vector-effect="non-scaling-stroke"/>`).join("")}
        <line id="cursor" y1="0" y2="${H - padB}" stroke="var(--text)" stroke-width="1" vector-effect="non-scaling-stroke" visibility="hidden"/>
      </svg>
      ${ticks.map(k => `<span class="muted" style="position:absolute;bottom:0;left:${(k / maxKm) * 100}%;transform:translateX(-50%);font-size:11px">${k} km</span>`).join("")}
      <span class="muted" style="position:absolute;left:8px;top:4px;font-size:11px">${Math.round(hi)} m</span>
      <span class="muted" style="position:absolute;left:8px;bottom:18px;font-size:11px">${Math.round(lo)} m</span>
      <div class="tip" hidden></div>`;
    const svg = box.querySelector("svg"), cur = box.querySelector("#cursor"), tip = box.querySelector(".tip");
    const move = ev => {
      const r = svg.getBoundingClientRect();
      const fx = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
      const km = fx * maxKm;
      let q = p[0];
      for (const s of p) { if (s[0] > km) break; q = s; }
      cur.setAttribute("x1", x(q[0])); cur.setAttribute("x2", x(q[0]));
      cur.setAttribute("visibility", "visible");
      tip.hidden = false;
      tip.textContent = `km ${q[0].toFixed(1)} · ${q[1]} m`;
      tip.style.left = Math.min(r.width - 120, Math.max(4, fx * r.width - 50)) + "px";
      if (!hoverMarker) hoverMarker = L.circleMarker([q[2], q[3]], { radius: 7, color: "#fff", weight: 2, fillColor: t.color, fillOpacity: 1 }).addTo(map);
      else hoverMarker.setLatLng([q[2], q[3]]);
    };
    const leave = () => {
      cur.setAttribute("visibility", "hidden");
      tip.hidden = true;
      if (hoverMarker) { hoverMarker.remove(); hoverMarker = null; }
    };
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerdown", move);
    svg.addEventListener("pointerleave", leave);
  }

  function route() {
    const id = location.hash.slice(1);
    const t = tracks.find(t => t.id === id);
    if (t) showTrack(t); else showOverview();
  }
  window.addEventListener("hashchange", route);
  route();
})();
