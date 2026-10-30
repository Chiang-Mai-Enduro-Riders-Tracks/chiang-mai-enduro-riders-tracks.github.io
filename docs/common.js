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

function baseMap(el) {
  const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
  const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    maxZoom: 17, subdomains: "abc",
    attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Style &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
  });
  const map = L.map(el, { layers: [osm], zoomControl: true, preferCanvas: true }).setView([18.85, 98.98], 9);
  L.control.layers({ "Streets": osm, "Topo": topo }, null, { position: "topright" }).addTo(map);
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
