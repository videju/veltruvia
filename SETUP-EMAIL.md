# VELTRUVIA — Enable Email (OTP + Password Recovery)

The server sends verification codes and password-reset codes by email.
Without email configured, patients cannot register by email and doctors
cannot recover a forgotten password (they are locked out until an admin
resets them). Configure ONE of the three providers below — Gmail is free
and takes 5 minutes.

After editing `.env`, restart the VELTRUVIA Server (tray → Quit, then
relaunch) and check the log line: `[mail] configured via gmail` (or smtp/resend).

---

## Option 1 — Gmail (free, recommended)

1. In a browser, go to https://myaccount.google.com/security
2. Enable **2-Step Verification** (required for app passwords)
3. Go to https://myaccount.google.com/apppasswords
4. Create an app password (name it "VELTRUVIA") — Google shows a 16-character code
5. Add these two lines to `.env` (file next to the VELTRUVIA folders):

```
GMAIL_USER=yourname@gmail.com
GMAIL_APP_PASSWORD=abcdefghijklmnop
```

(No spaces in the app password. Do NOT use your normal Gmail password.)

## Option 2 — Resend (free tier, 100 emails/day, custom domain)

```
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_FROM=VELTRUVIA <alerts@yourdomain.com>
```

## Option 3 — Any SMTP server

```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=alerts@example.com
SMTP_PASS=xxxxxxxx
SMTP_FROM=VELTRUVIA <alerts@example.com>
```

---

## What turns on when email works

| Feature | Without email | With email |
|---|---|---|
| Patient registration OTP | Code shown on screen (local only) | Code sent to the patient's inbox |
| Doctor password recovery | Disabled ("ask your administrator") | 15-minute reset code by email |
| 2FA email codes | Shown on screen | Sent by email |

**Security note:** since v2.0.2 the OTP-on-screen fallback is hard-disabled in
production mode. If email is not configured in production, the API simply
says delivery failed — no code is ever exposed.
