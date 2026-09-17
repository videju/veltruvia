// ═══════════════════════════════════════════════════════════════════════
// Read-only mode banner (Doctor app, works in all Electron portals).
//
// When the Doctor exe can't reach the central Server it opens the shared
// database READ-ONLY (single-writer lock). Charting in that mode would be
// silently discarded — this banner makes the state impossible to miss:
//   ⚠ READ-ONLY — the central Server owns the database. Changes will NOT
//     be saved. Start VELTRUVIA Server, then restart this app.
//
// CSP-safe: DOM-built, style attributes only (style-src 'unsafe-inline'
// is allowed), textContent for all copy, no inline scripts.
// ═══════════════════════════════════════════════════════════════════════
(() => {
  'use strict';

  let shown = false;

  function show() {
    if (shown) return;
    shown = true;
    const bar = document.createElement('div');
    bar.id = 'veltruvia-readonly-banner';
    bar.setAttribute('role', 'alert');
    bar.setAttribute('style', [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99998',
      'background:#7f1d1d', 'color:#fff', 'padding:9px 16px',
      'font:600 13px/1.4 system-ui,sans-serif', 'text-align:center',
      'box-shadow:0 2px 10px rgba(0,0,0,.4)', 'cursor:default',
    ].join(';'));

    const txt = document.createElement('span');
    txt.textContent = '⚠ READ-ONLY MODE — the central Server owns the database. ' +
      'Changes will NOT be saved. Start the VELTRUVIA Server app, then restart this app to edit.';
    bar.appendChild(txt);

    const dismiss = document.createElement('button');
    dismiss.textContent = '✕';
    dismiss.setAttribute('aria-label', 'Dismiss read-only warning');
    dismiss.setAttribute('style', [
      'margin-left:14px', 'background:transparent', 'border:1px solid rgba(255,255,255,.4)',
      'color:#fff', 'border-radius:6px', 'padding:2px 8px', 'cursor:pointer', 'font-size:12px',
    ].join(';'));
    dismiss.addEventListener('click', () => bar.remove());
    bar.appendChild(dismiss);

    document.body.appendChild(bar);
  }

  function init() {
    // Electron preload bridge only — browsers talking to the HTTP server
    // are always in server-writer mode and never need the banner.
    if (!window.app || typeof window.app.getDbMode !== 'function') return;
    Promise.resolve(window.app.getDbMode())
      .then((info) => {
        if (info && info.readOnly) {
          console.warn('[veltruvia] DB is READ-ONLY (impl: ' + (info.impl || '?') + ') — showing banner');
          show();
        }
      })
      .catch(() => { /* older build / IPC missing — nothing to show */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
