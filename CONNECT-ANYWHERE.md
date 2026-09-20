# CONNECT-ANYWHERE — keep every VELTRUVIA app linked after you share them

VELTRUVIA is a **star**: one **Server** holds all the data; every Patient phone,
Lab phone, and Doctor PC connects to it. Sharing the installers is easy — the
only real question is *which address each app points at*. Pick your scenario:

| Scenario | What you get | Effort |
|---|---|---|
| **A. Same building (one Wi-Fi)** | Works today, fully offline, nothing leaves the building | Zero — scan a QR |
| **B. Different cities, private** (Tailscale) | Encrypted remote access, data stays on your PC, free | ~10 min, once |
| **C. Different cities, public** (cloud VM) | Any internet device on Earth can connect over HTTPS | ~30 min + ~$6/mo VPS |

---

## A. Same building — one Wi-Fi (default, zero setup)

1. Install the **Server** on the always-on Windows PC (lives in the tray).
2. On that PC, open `http://127.0.0.1:3000/download.html`.
3. **Scan the “Connect a phone” QR** at the top of that page with each phone’s
   camera → the page opens **on the phone** → install Patient/Lab there.
4. In each app: tap **⚙** → the address shown on the page is already correct —
   paste it in. Done: every phone now shares the one server.
5. Doctor PCs in the same building: install `VELTRUVIA-Doctor-Setup.exe` —
   it finds the local server **automatically** (no address needed).

## B. Different cities — private (Tailscale, recommended)

Free (up to 100 devices), WireGuard-encrypted, **data stays on your PC** —
nothing is exposed to the public internet.

1. On the **server PC**: install https://tailscale.com and sign in.
2. On **every phone and Doctor PC** that should connect remotely: install
   Tailscale and sign in to the **same account** (invite team members from the
   Tailscale admin panel — they never see your logins).
3. In the Tailscale app on the server PC, note its address — looks like
   `100.x.y.z`.
4. Point the apps there, from anywhere in the world:
   - **Phones:** ⚙ → `http://100.x.y.z:3000`
   - **Doctor PCs:** either set the environment variable
     `VELTRUVIA_SERVER_URL=http://100.x.y.z:3000` before launching, or put
     `{"serverUrl": "http://100.x.y.z:3000"}` in
     `%APPDATA%\VELTRUVIA-shared\server-config.json`

## C. Different cities — public (cloud VM with HTTPS)

Any device on any network connects to one public address.

1. Rent a small VM (Hetzner/DigitalOcean ~$6/mo) with a domain like
   `emr.yourclinic.com`.
2. Follow **DEPLOY.md** (in the repo): Docker, Caddy HTTPS, data restore.
3. Point every app at it:
   - **Phones:** ⚙ → `https://emr.yourclinic.com`
   - **Doctor PCs:** same two options as in B, with the https URL

> ⚠️ A public URL means anyone on the internet can reach the login page. The
> server has lockout + encrypted PHI + audit trails, but for clinical data
> scenario B is the safer default unless you need public access.

---

## What to send to whom

| Recipient | Send them | They do |
|---|---|---|
| Clinic PC (same building) | `ventruvia` folder (or GitHub release link) | Run `INSTALL-ALL.bat` — connected automatically |
| Phone (same building) | Just the **QR on the download page** | Scan → install → paste address |
| Phone (anywhere) | `VELTRUVIA-Patient.apk` / `-Lab.apk` + your server address (B or C above) | Install → ⚙ → paste address |
| Doctor anywhere | `VELTRUVIA-Doctor-Setup.exe` + the address | Install → env var or `server-config.json` |
| No-internet clinic | Whole `ventruvia` folder on USB | `README-FIRST.txt` inside walks them through |

## Verifying everything is linked

Open the server’s dashboard → patients/records you create on any connected
app appear for all the others within seconds. The tray menu shows every
address the server is reachable on (local + LAN).
