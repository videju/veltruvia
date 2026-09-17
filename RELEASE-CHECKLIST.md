# GitHub Releases — upload checklist

Goal: the download page (`public/download.html`) links to
`https://github.com/sakshibiradar022002-wq/veltruvia1/releases/latest/download/<NAME>`.
A release tagged **`latest`-resolved** must contain assets with these **exact names**
(spaces, capitalization — GitHub URLs are case-sensitive; `%20` = space):

| Asset (exact name)       | Size     | Source on this PC                              |
|--------------------------|----------|------------------------------------------------|
| `VELTRUVIA Server.exe`   | ~180 MB  | `dist\VELTRUVIA Server.exe`                    |
| `VELTRUVIA Doctor.exe`   | ~180 MB  | `dist\VELTRUVIA Doctor.exe`                    |
| `VELTRUVIA Patient.apk`  | 6.9 MB   | `dist\VELTRUVIA Patient.apk`                   |
| `VELTRUVIA Lab.apk`      | 6.9 MB   | `dist\VELTRUVIA Lab.apk`                       |
| `SHA256SUMS.txt`         | <1 KB    | `dist\SHA256SUMS.txt`                          |

> ⚠️ Upload the **release** APKs (`VELTRUVIA Patient.apk`), **not** the
> `-debug` builds — the download links use these exact names.
> Note: `dist/` is gitignored — files are copied out of it, never committed.

---

## Method A — Browser (no tools needed) ✅ recommended

1. Open **https://github.com/sakshibiradar022002-wq/veltruvia1/releases/new**
   (sign in as an owner of the repo).
2. **Choose a tag:** type `v2.1.0` → **Create new tag: v2.1.0 on publish** (target: `main`).
3. **Release title:** `VELTRUVIA v2.1.0 — Mobile apps + background server`
4. **Describe** (paste, then edit):
   ```
   ## Downloads
   - 📱 **VELTRUVIA Patient.apk** — Android app for patients (install: allow "unknown apps")
   - 📱 **VELTRUVIA Lab.apk** — Android app for lab technicians
   - 🖥️ **VELTRUVIA Doctor.exe** — Windows software for the doctor (no install, portable)
   - 🖲️ **VELTRUVIA Server.exe** — background server with tray icon (runs the shared database)
   - 🔐 SHA256SUMS.txt — verify your download: `sha256sum -c SHA256SUMS.txt`

   Mobile apps: install APK → tap ⚙ → set server address → sign in.
   Server can auto-start with Windows (tray icon → "Run at Windows startup").
   ```
5. **Attach** the 5 files from `Desktop\ve\dist\` by dragging them into the
   "Attach binaries" box. Wait for all uploads to finish (the two exes are ~180 MB each).
6. ☑️ If this is your first/only release, leave **"Set as the latest release"** checked
   (it is by default) → **Publish release**.
7. Continue at **Verify** below.

## Method B — GitHub CLI (scriptable)

```bash
# once: install gh (winget install GitHub.cli) and log in
gh auth login

cd dist   # all 5 files are here with exact names

gh release create v2.1.0 \
  "VELTRUVIA Server.exe" \
  "VELTRUVIA Doctor.exe" \
  "VELTRUVIA Patient.apk" \
  "VELTRUVIA Lab.apk" \
  "SHA256SUMS.txt" \
  --repo sakshibiradar022002-wq/veltruvia1 \
  --title "VELTRUVIA v2.1.0 — Mobile apps + background server" \
  --notes "Patient & Lab Android apps + Doctor/Server Windows exes. See SHA256SUMS.txt to verify downloads." \
  --latest
```

---

## Verify — every link must resolve (HTTP 302 → 200)

Run from any terminal **after publishing**:

```bash
for a in "VELTRUVIA%20Server.exe" "VELTRUVIA%20Doctor.exe" "VELTRUVIA%20Patient.apk" "VELTRUVIA%20Lab.apk"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -L -m 60 \
    "https://github.com/sakshibiradar022002-wq/veltruvia1/releases/latest/download/$a")
  echo "$code  $a"
done
```

All four lines must print `200`. Then open the real download page and click each
button once (phone browser for the APK cards):

**http://192.168.1.6:3000/download.html** (or wherever the page is hosted)

## Failure modes to check if a link 404s

- **Asset name typo** — must be exactly `VELTRUVIA Patient.apk` (capital V, spaces,
  `.apk` not `.zip`; watch for auto-renamed ` (1)` duplicates).
- **No "latest" release** — the URL uses `/releases/latest/`; if you published as a
  draft or pre-release, "latest" may not point at it. Publish it / mark as latest.
- **Uploaded to the wrong repo** — must be `veltruvia1`, not a fork.

## Re- releasing later (new build)

1. Rebuild → collect fresh artifacts into `dist/` (same exact names) → regenerate
   `SHA256SUMS.txt` (`cd dist && sha256sum "VELTRUVIA Server.exe" "VELTRUVIA Doctor.exe" "VELTRUVIA Patient.apk" "VELTRUVIA Lab.apk" > SHA256SUMS.txt`).
2. Either **edit the existing release** (delete old asset → upload new) or create a
   new tag (e.g. `v2.1.1`) — `/releases/latest/` always follows the newest
   non-draft release, so download links never change.

## Keep local artifacts in sync (reminder)

After uploading, the copies in `VELTRUVIA Server\` / `VELTRUVIA Doctor\` / `dist\`
are what phones on the LAN install from (`http://192.168.1.6:3000/downloads/…`).
If you rebuild later, redeploy to those folders too (see BUILDING.md →
"Deploying a fresh build").
