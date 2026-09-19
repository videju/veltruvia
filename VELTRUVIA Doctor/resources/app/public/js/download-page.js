// ═════════════════════════════════════════════════════════════════════
// VELTRUVIA download page — version badge, QR codes, PWA install,
// checksums table. External file: the CSP is `script-src 'self'` and no
// inline scripts or event handlers are allowed anywhere.
//
// External service: api.qrserver.com (already in the CSP connectSrc list,
// used by the 2FA setup page) renders the QR images — no extra dependency.
// ═════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const GH = 'https://github.com/videju/veltruvia';

  // ── Version badge (shown after fetch; hidden on any failure) ──────
  fetch(GH + '/releases/latest', { method: 'HEAD' })
    .then(r => {
      const tag = (r.url.match(/tag\/([^/?#]+)/) || [])[1];
      if (!tag) return;
      const el = document.getElementById('ver-badge');
      if (el) { el.textContent = 'Latest release: ' + decodeURIComponent(tag); el.hidden = false; }
    })
    .catch(() => { /* offline or no releases yet — badge stays hidden */ });

  // ── QR codes for the APK cards ────────────────────────────────────
  document.querySelectorAll('[data-qr]').forEach(btn => {
    btn.addEventListener('click', () => {
      const wrap = document.getElementById(btn.getAttribute('data-qr'));
      if (!wrap) return;
      const img = wrap.querySelector('img[data-url]');
      if (img && !img.src) {
        img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=8&data=' +
          encodeURIComponent(img.getAttribute('data-url'));
      }
      wrap.hidden = !wrap.hidden;
    });
  });

  // ── PWA install (beforeinstallprompt) ─────────────────────────────
  const banner = document.getElementById('pwa-banner');
  const installBtn = document.getElementById('pwa-install');
  const iosHint = document.getElementById('pwa-ios-hint');
  const chromeHint = document.getElementById('pwa-chrome-hint');
  let deferredPrompt = null;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  if (!isStandalone) {
    if (isIOS && iosHint) { iosHint.hidden = false; if (banner) banner.hidden = false; }
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      if (chromeHint) chromeHint.hidden = false;
      if (installBtn) installBtn.hidden = false;
      if (banner) banner.hidden = false;
    });
    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        try { await deferredPrompt.userChoice; } catch (e) { /* dismissed */ }
        deferredPrompt = null;
        installBtn.hidden = true;
      });
    }
  }

  // ── Checksums table from SHA256SUMS.txt ───────────────────────────
  fetch('/SHA256SUMS.txt')
    .then(r => (r.ok ? r.text() : Promise.reject(r.status)))
    .then(text => {
      const rows = document.getElementById('sha-rows');
      const box = document.getElementById('checksums');
      if (!rows || !box) return;
      const files = [];
      for (const line of text.split('\n')) {
        const m = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
        if (m) files.push({ hash: m[1], name: m[2].trim() });
      }
      if (!files.length) return;
      for (const f of files) {
        const tr = document.createElement('tr');
        const tdN = document.createElement('td');
        tdN.textContent = f.name;
        const tdH = document.createElement('td');
        tdH.className = 'sha';
        tdH.textContent = f.hash.slice(0, 16) + '…' + f.hash.slice(-8);
        tdH.title = f.hash;
        tr.appendChild(tdN);
        tr.appendChild(tdH);
        rows.appendChild(tr);
      }
      box.hidden = false;
    })
    .catch(() => { /* no checksums file served — section stays hidden */ });
})();
