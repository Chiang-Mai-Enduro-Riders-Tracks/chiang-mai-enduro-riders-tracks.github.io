# Chiang Mai Community Tracks

Beginner-friendly enduro GPX routes around Chiang Mai, by Pavel & Jul.
Site: unlisted (noindex); only people with the link find it.

## How it works

- `tracks/`: everything editors touch.
  - `NN-XofY-Name.gpx`: one file per track. The leading number links versions together.
  - `NOTES.txt`: Pavel's notes file; the site reads each track's description from here.
  - `site.json`: title, intro text, editors, repo name.
  - `history-seed.json`: v1 of each track (the Google Drive versions, from before the site).
- `site/`: page code (HTML/CSS/JS, Leaflet vendored so nothing depends on a CDN).
- `build.py`: reads `tracks/` plus the git history and writes the finished site to `docs/`.
- `.github/workflows/build.yml`: runs `build.py` on every push and commits `docs/`.
  GitHub Pages serves `docs/` from `main`, so the last good build stays up even if Actions break.

Versions: each commit that changes a track's GPX = next version. Date = commit date.
By = the committer, or a `By: name` line in the commit message (shown as "name (uploaded by committer)").
A `Skip-Version: yes` line keeps a commit out of the count.

Step-by-step for editors (no coding): the site's **For track editors** page (`editors.html`).

## Run locally

```bash
python3 build.py && python3 -m http.server -d docs 8765
```

Build warnings (name mismatches, km differences, missing elevation) print to the terminal.

## One-time GitHub setup

1. Create a free GitHub organisation (e.g. `cnx-community-tracks`); invite Pavel, Jul and Gareth as **Owners**.
2. Create a **public** repo in it (Pages on free plans needs public) and push this folder.
3. Repo → Settings → Pages → Deploy from a branch → `main` / `/docs`.
4. Repo → Settings → Actions → General → Workflow permissions → **Read and write**.
5. Put `org/repo` in `tracks/site.json` → `repo`, so the editor page's GitHub links work.
