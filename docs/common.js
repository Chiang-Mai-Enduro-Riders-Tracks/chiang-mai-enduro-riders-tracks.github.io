// Shared by index.html and editors.html.
const COLORS = ["#4fc3f7", "#ffb74d", "#81c784", "#f06292", "#ba68c8", "#fff176", "#4db6ac", "#ff8a65", "#90caf9", "#e6ee9c"];

function colorFor(i) { return COLORS[i % COLORS.length]; }

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function dots(n) {
  if (!n) return "";
  let h = `<span class="dots" title="Difficulty ${n} of 5" aria-label="Difficulty ${n} of 5">`;
  for (let i = 1; i <= 5; i++) h += `<i class="${i <= n ? "on" : ""}"></i>`;
  return h + "</span>";
}

function baseMap(el, opts = {}) {
  const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
  const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    maxZoom: 17, subdomains: "abc",
    attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Style &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
  });
  const map = L.map(el, { layers: [osm], zoomControl: true, preferCanvas: true }).setView([18.85, 98.98], 9);
  map.attributionControl.setPrefix(false);  // drop the "Leaflet" + flag credit; the map data credits stay
  if (opts.layersControl !== false) L.control.layers({ "Streets": osm, "Topo": topo }, null, { position: "topright" }).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);
  return map;
}

async function loadData() {
  const r = await fetch("data/tracks.json", { cache: "no-cache" });
  if (!r.ok) throw new Error("Could not load track data");
  return r.json();
}

// Parse a GPX file in the browser into [[lat, lon], ...].
function parseGpxText(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const pts = [];
  for (const el of doc.querySelectorAll("trkpt, rtept")) {
    pts.push([parseFloat(el.getAttribute("lat")), parseFloat(el.getAttribute("lon"))]);
  }
  return pts;
}

// Nearest point on a [[lat, lon], ...] line to `pt`: {lat, lon, dist (m), i (segment start), f (0-1 along it)}.
function nearestOnLine(line, pt) {
  const kx = 111320 * Math.cos(pt[0] * Math.PI / 180), ky = 110540;
  const px = pt[1] * kx, py = pt[0] * ky;
  let best = { dist: Infinity, i: 0, f: 0, lat: line[0][0], lon: line[0][1] };
  for (let i = 0; i < line.length - 1; i++) {
    const x1 = line[i][1] * kx, y1 = line[i][0] * ky, x2 = line[i + 1][1] * kx, y2 = line[i + 1][0] * ky;
    const dx = x2 - x1, dy = y2 - y1, seg = dx * dx + dy * dy;
    const f = seg ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / seg)) : 0;
    const d = Math.hypot(px - (x1 + f * dx), py - (y1 + f * dy));
    if (d < best.dist) best = { dist: d, i, f, lat: (y1 + f * dy) / ky, lon: (x1 + f * dx) / kx };
  }
  return best;
}
