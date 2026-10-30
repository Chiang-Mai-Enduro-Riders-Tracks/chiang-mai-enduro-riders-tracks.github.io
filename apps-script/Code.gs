/**
 * Rider update inbox for Chiang Mai Enduro Riders Tracks.
 *
 * The site's "Send it to us" form posts here. Each report (a spot on the track and/or a GPX, plus
 * a note and optional photo) is emailed to the reviewer, who checks it and publishes changes on
 * GitHub himself. Nothing a rider sends reaches the site directly. Nothing is stored: the email is
 * the record (a copy stays in the setup account's Sent folder). The script only needs "send email".
 *
 * Keep the email text plain ASCII: Gmail garbles characters like arrows in these plain-text mails.
 *
 * Setup (script.google.com, signed in to the Google account that should own the inbox):
 *   1. New project, paste this file, set NOTIFY_TO below.
 *   2. Deploy → New deployment → type "Web app" → Execute as: Me → Who has access: Anyone → Deploy.
 *   3. Authorize when asked, then copy the Web app URL into tracks/site.json → "submitUrl".
 * After editing this file: Deploy → Manage deployments → pencil → Version: New version → Deploy
 * (keeps the same URL).
 */

const NOTIFY_TO = "PUT-REVIEWER-EMAIL-HERE";  // who reviews rider updates (Pavel)
const TEST_TO = "PUT-SETUP-EMAIL-HERE";       // test submissions go here instead, never to the reviewer
const SITE = "https://chiang-mai-enduro-riders-tracks.github.io/";
const MAX_GPX = 10 * 1024 * 1024;
const MAX_PHOTO = 8 * 1024 * 1024;

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.website) return reply({ ok: true });  // hidden field only bots fill in
    const name = clean(d.name, 80);
    const track = clean(d.track, 120);
    const trackId = clean(d.trackId, 4);
    const kind = clean(d.kind, 60);
    const note = clean(d.note, 4000);
    const contact = clean(d.contact, 120);
    const spot = d.spot && isFinite(d.spot.lat) && isFinite(d.spot.lon)
      ? { lat: Number(d.spot.lat), lon: Number(d.spot.lon), km: Number(d.spot.km), off: Number(d.spot.off) || 0 } : null;
    const hasGpx = d.gpx && d.gpx.data;
    if (!name || !track || (!spot && !hasGpx)) return reply({ ok: false, error: "Missing name, track, or a spot or GPX" });

    const gpx = hasGpx ? toBlob(d.gpx, "application/gpx+xml", MAX_GPX) : null;
    if (gpx && !/^\s*<\?xml|<gpx/i.test(gpx.getDataAsString().slice(0, 500))) return reply({ ok: false, error: "That file isn't a GPX" });
    const photo = d.photo && d.photo.data ? toBlob(d.photo, d.photo.type || "image/jpeg", MAX_PHOTO) : null;
    const files = [gpx, photo].filter(Boolean);
    const where = spot ? `km ${spot.km}` : "";

    const to = d.test ? TEST_TO : NOTIFY_TO;
    const body = [
      `${name} sent an update for ${track}${where ? " at " + where : ""}.`,
      ``,
      `What changed: ${kind || "-"}`,
      spot ? `Where: ${where}${spot.off > 150 ? ` (tapped ${spot.off} m from the track)` : ""}, map: https://www.google.com/maps?q=${spot.lat},${spot.lon}` : `Where: no spot marked`,
      `Contact: ${contact || "-"}`,
      ``,
      note || "(no note)",
      ``,
      files.length ? `Attached: ${[gpx && "their GPX", photo && "a photo"].filter(Boolean).join(" and ")}.` : `No files attached.`,
      ``,
      gpx ? `To review the GPX: open ${SITE}editors.html, go to "Check a rider's recording", pick the track and open the attached file.` : ``,
      `To publish a change: upload the corrected GPX or edit the notes on GitHub, and write "By: ${name}" in the description box.`,
      ``,
      `Track page: ${SITE}#${trackId}`,
    ].join("\n");
    const opts = { name: "CNX Tracks", attachments: files };
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)) opts.replyTo = contact;
    MailApp.sendEmail(to, `${d.test ? "[TEST] " : ""}Track update: ${track}${where ? " at " + where : ""} from ${name}`, body, opts);
    return reply({ ok: true });
  } catch (err) {
    console.error(err);
    return reply({ ok: false, error: "Something went wrong. Please try again later." });
  }
}

function doGet() {
  return reply({ ok: true, service: "CNX Tracks rider updates" });
}

function toBlob(file, fallbackType, max) {
  const bytes = Utilities.base64Decode(String(file.data).replace(/^data:[^,]*,/, ""));
  if (bytes.length > max) throw new Error("File too large");
  const name = clean(file.name, 120).replace(/[\\/:*?"<>|]/g, "_") || "file";
  return Utilities.newBlob(bytes, file.type || fallbackType, name);
}

function clean(v, max) {
  return String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
