# VELTRUVIA — HTTPS on the Clinic LAN (prepared, optional)

Phone-to-server traffic on the clinic Wi-Fi is plain HTTP by default.
A TLS setup is **already prepared** but **not enabled**:

- Certificate: `config/tls/veltruvia-lan.crt` (self-signed, CN=VELTRUVIA Clinic Server, SAN: localhost/127.0.0.1, valid 825 days)
- Key: `config/tls/veltruvia-lan.key` (keep private — do not copy to phones or share folders)

## How to enable

1. Add two lines to `.env` (next to the VELTRUVIA folders):

```
TLS_KEY=C:/Users/Sara/Desktop/ve/config/tls/veltruvia-lan.key
TLS_CERT=C:/Users/Sara/Desktop/ve/config/tls/veltruvia-lan.crt
```

2. Restart the VELTRUVIA Server. It now speaks **https** on the LAN
   (`https://<your-lan-ip>:3000`).

3. On each phone: install the certificate.
   - Copy `veltruvia-lan.crt` to the phone (or download it from the server).
   - Android: Settings → Security → More security settings →
     **Encryption & credentials → Install a certificate → CA certificate**.
   - The VELTRUVIA apps already trust user-installed CAs (network security config).

4. Update the address in the app ⚙ screen to `https://…` and save.

## Trade-offs to know

| | HTTP (today) | HTTPS (after enabling) |
|---|---|---|
| Setup | Zero | ~5 min per phone (one-time cert install) |
| Traffic on Wi-Fi | Readable by anyone on the network | Encrypted |
| Browser | Opens instantly | Shows a warning once per device until cert installed |

**Remote access is unaffected**: the Cloudflare tunnel already provides real,
trusted TLS from anywhere — this only hardens the in-clinic Wi-Fi leg.

## If something breaks

Remove the two `TLS_*` lines from `.env` and restart — the server falls back
to plain HTTP exactly as before. Nothing else changes.
