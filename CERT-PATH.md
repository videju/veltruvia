# VELTRUVIA — Getting a CA-Signed Windows Certificate (SmartScreen fix)

Today the Windows installers are signed with a **self-signed** certificate.
Windows SmartScreen shows "Unknown publisher" for every install, and the
auto-updater warns on signature mismatch. A **Code Signing Certificate**
from a Certificate Authority removes both.

## What to buy (only ONE is needed)

| Option | Cost | Provider | Notes |
|---|---|---|---|
| **SignPath Foundation** | **Free** for genuine open-source projects | signpath.org | VELTRUVIA's repo is public — this is the real $0 route. Requires project review (days). EV-grade signature. |
| Certum Open Source Code Signing | ~€25/yr + ~€19 one-time card reader | certum.eu | Cheapest paid OSS option; popular with indie devs |
| SSL.com OSS code signing | ~$70/yr (eSigner cloud) | ssl.com | Cloud-based, no USB token hardware |
| Sectigo / DigiCert standard OV | $100–300/yr | resellers | Standard business route; SmartScreen builds reputation faster with EV |

**Recommendation: apply to SignPath Foundation first** (free, highest trust
tier). If the review stalls, buy Certum.

## What you need before applying

1. The GitHub repo public: ✅ already (`github.com/videju/veltruvia`)
2. A consistent identity: **VELTRUVIA** as publisher name on every release
3. For SignPath: a GitHub org or personal repo with releases + a README that
   describes the project (✅ exists), and an application describing what the
   software does and who verifies it

## Wiring it into the release pipeline (once you have the cert)

The workflow (`.github/workflows/release.yml`) already has the signing step
prepared:

- Secrets needed: `WINDOWS_PFX_BASE64` (the cert file, base64-encoded) and
  `WINDOWS_PFX_PASSWORD`
- CI decodes the PFX to the runner temp dir and passes it to electron-builder
  via `CSC_LINK`/`CSC_KEY_PASSWORD` — it does **not** ship inside any installer
- On non-signed CI runs the step is skipped automatically — nothing breaks
  while you don't have a cert yet

### Exact steps when the PFX arrives
1. `base64 -w0 yourcert.pfx > pfx.b64` → paste contents into the GitHub secret
   `WINDOWS_PFX_BASE64` (repo → Settings → Secrets and variables → Actions)
2. Put the PFX password into `WINDOWS_PFX_PASSWORD`
3. Tag `v2.0.6` (or any next release) — installers come out signed
4. Installers signed by the same cert from then on = auto-updater stays quiet

## SmartScreen reputation

Even with a cert, the **first** downloads may still show a milder warning
("More info → Run anyway") until Microsoft's reputation system has seen the
signed binary a few times (days–weeks). EV certificates skip this period;
standard OV does not. This is normal and clears on its own.

## Android note (no action needed)

The Android APKs are signed with the project keystore (self-managed). Google
Play would require its own app signing, but for direct APK distribution the
current setup is standard practice.
