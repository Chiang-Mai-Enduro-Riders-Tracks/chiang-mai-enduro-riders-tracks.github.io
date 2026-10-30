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
  // Sections (Easy Enduro, Adventure, …) come from site.json; each track's Category line in NOTES.txt picks one.
  const sections = site.sections;
  const sectionOf = id => sections.find(s => s.id === id) || sections[0];
  const sectionHash = id => (id === sections[0].id ? "" : id);
  let section = sections[0].id;
  $("restricted").textContent = site.restricted;
  $("contribute").textContent = site.contribute;

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
  const boundsOf = sec => L.latLngBounds(tracks.filter(t => t.category === sec).flatMap(t => t.line));
  // A map fitted while its box still has no size zooms all the way in; wait for layout first.
  let fitTimer = null;
  const fitTo = (bounds, pad) => {
    clearTimeout(fitTimer);
    map.invalidateSize();
    const size = map.getSize();
    if (size.x < 100 || size.y < 100) { fitTimer = setTimeout(() => fitTo(bounds, pad), 100); return; }
    map.fitBounds(bounds, { padding: [pad, pad] });
  };
  const fitAll = () => fitTo(boundsOf(section), 24);

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
    return h ? `v${h.version} · ${fmtDate(h.date)}` : "";
  };
  const field = (t, key) => (t.fields.find(f => f[0].toLowerCase() === key) || [])[1];
  const hours = t => (field(t, "length") || "").match(/\(([^)]*)\)/)?.[1];

  $("tabs").innerHTML = sections.map(s => {
    const n = tracks.filter(t => t.category === s.id).length;
    return `<button class="tab" role="tab" data-sec="${s.id}">${esc(s.title)} <span class="muted">${n}</span></button>`;
  }).join("");
  document.querySelectorAll(".tab").forEach(b => b.onclick = () => go(sectionHash(b.dataset.sec)));

  $("list").innerHTML = tracks.map(t => `
    <li data-sec="${t.category}"><button class="card" data-id="${t.id}">
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

  $("changesHead").hidden = $("changes").hidden = !data.changes.length;
  $("changes").innerHTML = data.changes.slice(0, 12).map(c => `
    <li><time>${fmtDate(c.date)}</time>
    <span>${c.track ? `<a href="#${c.track}">${esc(c.what)}</a>` : `<b>${esc(c.what)}</b>`}
    — ${esc(c.note)}</span></li>`).join("");

  // ---------- detail ----------
  let current = null;
  let hoverMarker = null;

  function go(id) { location.hash = id ? "#" + id : ""; }

  // Only the active section's tracks are on the map; a track page keeps its own section's tracks (dimmed).
  function setSection(sec) {
    section = sec;
    for (const t of tracks) {
      if (t.category === sec) all.addLayer(layers[t.id].g);
      else all.removeLayer(layers[t.id].g);
    }
    document.querySelectorAll(".tab").forEach(b => b.setAttribute("aria-selected", b.dataset.sec === sec));
    document.querySelectorAll("#list > li").forEach(li => { li.hidden = li.dataset.sec !== sec; });
    $("intro").textContent = sectionOf(sec).intro;
  }

  function showOverview(sec) {
    current = null;
    setSection(sec);
    $("detail").hidden = true;
    $("overview").hidden = false;
    $("profile").hidden = true;
    if (hoverMarker) { hoverMarker.remove(); hoverMarker = null; }
    for (const l of Object.values(layers)) {
      l.line.setStyle({ opacity: 0.95, weight: 4 });
      l.casing.setStyle({ opacity: 0.55 });
      l.start.setStyle({ opacity: 1, fillOpacity: 1 });
    }
    fitAll();
  }

  function showTrack(t) {
    current = t;
    setSection(t.category);
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
      <button class="back" id="back">← All ${esc(sectionOf(t.category).title)} tracks</button>
      <div class="detail-head">
        <div class="muted small">${esc(sectionOf(t.category).title)} · Track ${t.id} · ${dots(t.difficulty)} ${t.difficulty ? t.difficulty + "/5" : ""}</div>
        <h2>${esc(t.name)}</h2>
        <div class="chips">${t.flags.map(f => `<span class="chip ${f.level}">${esc(f.text)}</span>`).join("")}</div>
      </div>
      <div class="actions">
        <a class="btn primary" href="gpx/${encodeURIComponent(t.file)}" download>Download GPX</a>
        <a class="btn" href="${gmaps}" target="_blank" rel="noopener">Directions to start</a>
        <button class="btn" id="copy">Copy link</button>
      </div>
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
      ${site.submitUrl ? `<details class="sendbox" id="sendbox">
        <summary>Found a change on this track? Send it to us</summary>
        <form id="sendForm">
          <p class="muted small">New "no off-road" sign, now paved, blocked trail? Mark the spot or send your ride recording.
            We check it and update the track. Nothing goes on the site until we do.</p>
          <div class="spotpick">
            <div class="spotrow"><span>Where is it? <span class="muted">Tap the track on the map</span></span>
              <button type="button" class="btn small" id="spotGps">Use my location</button></div>
            <div id="spotMap"></div>
            <p id="spotInfo" class="small muted">No spot marked yet.</p>
          </div>
          <label>What changed
            <select name="kind">
              <option>New "no off-road" sign</option>
              <option>Now paved</option>
              <option>Trail blocked or closed</option>
              <option>Better line or reroute</option>
              <option>Track is fine, just confirming</option>
              <option>Other</option>
            </select></label>
          <label>Note <span class="muted">(what you saw)</span><textarea name="note" rows="3" maxlength="4000"></textarea></label>
          <label>Your name<input name="name" required maxlength="80" autocomplete="name"></label>
          <label>Contact, so we can ask questions <span class="muted">(optional: email or LINE)</span><input name="contact" maxlength="120"></label>
          <label>Your GPX recording <span class="muted">(optional if you marked the spot)</span><input type="file" name="gpx" accept=".gpx,application/gpx+xml"></label>
          <label>Photo <span class="muted">(optional, e.g. the sign)</span><input type="file" name="photo" accept="image/*"></label>
          <input name="website" tabindex="-1" autocomplete="off" class="trap" aria-hidden="true">
          <button class="btn primary" type="submit">Send to us</button>
          <p id="sendStatus" class="small" role="status"></p>
        </form>
      </details>` : `<p class="muted small">${esc(site.contribute)}</p>`}`;
    $("overview").hidden = true;
    $("detail").hidden = false;
    $("back").onclick = () => go(sectionHash(t.category));
    $("copy").onclick = async () => {
      try { await navigator.clipboard.writeText(location.href); $("copy").textContent = "Copied"; }
      catch { $("copy").textContent = "Copy failed"; }
    };
    if ($("sendForm")) setupSendForm(t);
    document.querySelector(".panel").scrollTop = 0;
    if (window.innerWidth <= 820) window.scrollTo({ top: 0 });

    drawProfile(t);
    fitTo(L.latLngBounds(t.line), 30);
  }

  // ---------- rider updates → emailed to Pavel by the Google Apps Script in apps-script/ ----------

  const readDataUrl = file => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });

  // Phone photos are several MB; shrink to 1600 px JPEG before sending.
  async function shrinkPhoto(file) {
    try {
      const img = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return { name: file.name.replace(/\.\w+$/, "") + ".jpg", type: "image/jpeg", data: c.toDataURL("image/jpeg", 0.82) };
    } catch {
      return { name: file.name, type: file.type, data: await readDataUrl(file) };
    }
  }

  // Spot picker: a small map of the track inside the form. A tap (or the phone's GPS) is snapped to
  // the nearest point on the track, so the report says "km 12.4" rather than loose coordinates.
  function setupSendForm(t) {
    const form = $("sendForm");
    let spot = null, spotMap = null, pin = null;
    // km along the simplified display line, scaled to the GPX's real length
    const cum = [0];
    for (let i = 1; i < t.line.length; i++) cum.push(cum[i - 1] + L.latLng(t.line[i - 1]).distanceTo(t.line[i]));
    const kmScale = t.km / (cum[cum.length - 1] / 1000 || 1);

    function setSpot(latlng) {
      const n = nearestOnLine(t.line, [latlng.lat, latlng.lng]);
      const km = ((cum[n.i] + n.f * (cum[n.i + 1] - cum[n.i])) / 1000) * kmScale;
      spot = { lat: +n.lat.toFixed(6), lon: +n.lon.toFixed(6), km: +km.toFixed(1), off: Math.round(n.dist) };
      if (!pin) pin = L.marker([n.lat, n.lon]).addTo(spotMap);
      else pin.setLatLng([n.lat, n.lon]);
      $("spotInfo").className = "small";
      $("spotInfo").innerHTML = `📍 <b>km ${spot.km}</b>` + (spot.off > 150 ? ` <span class="muted">(nearest point on the track, ${spot.off} m away)</span>` : "");
    }

    $("sendbox").addEventListener("toggle", () => {
      if (!$("sendbox").open) return;
      if (spotMap) { spotMap.invalidateSize(); return; }
      spotMap = baseMap("spotMap", { layersControl: false });
      L.polyline(t.line, { color: "#000", weight: 7, opacity: 0.5 }).addTo(spotMap);
      L.polyline(t.line, { color: t.color, weight: 4 }).addTo(spotMap);
      spotMap.fitBounds(L.latLngBounds(t.line), { padding: [16, 16] });
      spotMap.on("click", e => setSpot(e.latlng));
    });
    $("spotGps").onclick = () => {
      if (!navigator.geolocation) { $("spotInfo").textContent = "This phone can't share its location here."; return; }
      $("spotInfo").textContent = "Finding you…";
      navigator.geolocation.getCurrentPosition(
        p => { const ll = L.latLng(p.coords.latitude, p.coords.longitude); setSpot(ll); spotMap.setView(ll, 15); },
        () => { $("spotInfo").textContent = spot ? `Couldn't get your location. Still marked: km ${spot.km}.` : "Couldn't get your location. Tap the map instead."; },
        { enableHighAccuracy: true, timeout: 15000 });
    };
    form.onsubmit = ev => { ev.preventDefault(); sendUpdate(t, form, spot, () => { spot = null; if (pin) { pin.remove(); pin = null; } $("spotInfo").className = "small muted"; $("spotInfo").textContent = "No spot marked yet."; }); };
  }

  async function sendUpdate(t, form, spot, onSent) {
    const status = $("sendStatus");
    const btn = form.querySelector("button[type=submit]");
    const f = new FormData(form);
    const gpx = f.get("gpx"), photo = f.get("photo");
    const hasGpx = gpx && gpx.size;
    status.style.color = "var(--warn)";
    if (!spot && !hasGpx) { status.textContent = "Please mark the spot on the map or add your GPX recording."; return; }
    if (hasGpx && gpx.size > 10 * 1024 * 1024) { status.textContent = "That GPX is over 10 MB. Please trim it or send a shorter recording."; return; }
    btn.disabled = true;
    status.style.color = "";
    status.textContent = "Sending…";
    try {
      const payload = {
        track: `${t.id} ${t.name}`, trackId: t.id,
        name: f.get("name"), contact: f.get("contact"), kind: f.get("kind"), note: f.get("note"),
        website: f.get("website"),
        spot,
        gpx: hasGpx ? { name: gpx.name, type: "application/gpx+xml", data: await readDataUrl(gpx) } : null,
        photo: photo && photo.size ? await shrinkPhoto(photo) : null,
      };
      // text/plain keeps this a "simple" request, so the browser skips the CORS preflight Apps Script can't answer
      const r = await fetch(site.submitUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) });
      const out = await r.json();
      if (!out.ok) throw new Error(out.error || "Failed");
      form.reset();
      onSent();
      status.style.color = "var(--ok)";
      status.textContent = "Sent. Thank you! We'll take a look.";
    } catch (e) {
      status.style.color = "var(--warn)";
      status.textContent = `Couldn't send: ${e.message}. Please try again, or post it in the group.`;
    } finally {
      btn.disabled = false;
    }
  }

  function drawProfile(t) {
    const box = $("profile");
    box.hidden = false;
    const p = t.profile;
    if (!p.length) {
      box.innerHTML = `<div class="none">No elevation data in this GPX file.</div>`;
      return;
    }
    const W = 1000, H = 128, padT = 8, padB = 18, GUT = 52;  // GUT: px gutter left of the chart for the height scale
    const maxKm = p[p.length - 1][0];
    let lo = Math.min(...p.map(q => q[1])), hi = Math.max(...p.map(q => q[1]));
    // round the scale to a step that gives 2-4 labelled heights
    const yStep = [20, 50, 100, 200, 250, 500, 1000].find(s => (hi - lo) / s <= 4) || 1000;
    lo = Math.floor(lo / yStep) * yStep;
    hi = Math.max(Math.ceil(hi / yStep) * yStep, lo + yStep);
    const yTicks = [];
    for (let v = lo; v <= hi; v += yStep) yTicks.push(v);
    const x = km => (km / maxKm) * W;
    const y = e => padT + (1 - (e - lo) / (hi - lo)) * (H - padT - padB);
    const pts = p.map(q => `${x(q[0]).toFixed(1)},${y(q[1]).toFixed(1)}`).join(" ");
    const ticks = [];
    const step = maxKm > 80 ? 20 : maxKm > 30 ? 10 : 5;
    for (let k = step; k < maxKm; k += step) ticks.push(k);
    box.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Elevation profile">
        ${yTicks.map(v => `<line x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join("")}
        <polygon points="0,${H - padB} ${pts} ${W},${H - padB}" fill="${t.color}" fill-opacity="0.22"/>
        <polyline points="${pts}" fill="none" stroke="${t.color}" stroke-width="2" vector-effect="non-scaling-stroke"/>
        ${ticks.map(k => `<line x1="${x(k)}" x2="${x(k)}" y1="${H - padB}" y2="${H - padB + 4}" stroke="var(--muted)" vector-effect="non-scaling-stroke"/>`).join("")}
        <line id="cursor" y1="0" y2="${H - padB}" stroke="var(--text)" stroke-width="1" vector-effect="non-scaling-stroke" visibility="hidden"/>
      </svg>
      ${ticks.map(k => `<span class="axis" style="bottom:0;left:calc(${GUT}px + (100% - ${GUT}px) * ${k / maxKm});transform:translateX(-50%)">${k} km</span>`).join("")}
      ${yTicks.map(v => `<span class="axis" style="right:calc(100% - ${GUT - 6}px);top:${(y(v) / H) * 100}%;transform:translateY(-50%)">${v} m</span>`).join("")}
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
      tip.style.left = GUT + Math.min(r.width - 120, Math.max(4, fx * r.width - 50)) + "px";
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
    if (t) showTrack(t);
    else showOverview(sections.some(s => s.id === id) ? id : sections[0].id);
  }
  window.addEventListener("hashchange", route);
  route();

})();
