// ═══════════════════════════════════════════════════════════════════════
// Self-service password recovery — shared by Doctor / Patient / Lab portals.
//
// Adds a "Forgot password?" flow next to any login form. Two steps:
//   1. POST /api/{auth|sync}/forgot-password  → single-use code emailed
//   2. POST /api/{auth|sync}/reset-password   → code + new password
//
// CSP-safe: static markup built with DOM APIs, user input only via
// textContent/value — nothing is ever interpolated into innerHTML.
// ═══════════════════════════════════════════════════════════════════════
(() => {
  'use strict';

  const STYLES = {
    overlay: 'position:fixed;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;z-index:99999;',
    card: 'background:#101828;color:#e5e7eb;border:1px solid #2b3648;border-radius:14px;padding:22px;width:min(92vw,380px);font:14px/1.45 system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.5);',
    label: 'display:block;font-size:12px;color:#94a3b8;margin:12px 0 4px;',
    input: 'width:100%;box-sizing:border-box;background:#0b1220;color:#e5e7eb;border:1px solid #2b3648;border-radius:8px;padding:9px 10px;font-size:14px;',
    btn: 'width:100%;margin-top:16px;background:#2563eb;color:#fff;border:0;border-radius:8px;padding:10px;font-size:14px;font-weight:600;cursor:pointer;',
    ghost: 'width:100%;margin-top:8px;background:transparent;color:#94a3b8;border:0;padding:8px;font-size:12px;cursor:pointer;',
    msg: 'margin-top:10px;font-size:12.5px;min-height:16px;',
    title: 'margin:0;font-size:16px;font-weight:700;color:#f8fafc;',
  };

  const CONFIG = {
    doctor: { idLabel: 'Account email', idPh: 'dr@hospital.com', endpoint: '/api/auth', minPass: 10 },
    patient: { idLabel: 'MRN', idPh: 'MRN-XXXXXXXX', endpoint: '/api/sync', minPass: 6, idField: 'mrn' },
    lab: { idLabel: 'Lab username', idPh: 'lab_username', endpoint: '/api/sync', minPass: 6, idField: 'username' },
  };

  let overlay = null;

  function el(tag, style, text) {
    const n = document.createElement(tag);
    if (style) n.setAttribute('style', style);
    if (text !== undefined) n.textContent = text;
    return n;
  }

  async function post(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    return d;
  }

  function close() { if (overlay) { overlay.remove(); overlay = null; } }

  function open(mode) {
    close();
    const cfg = CONFIG[mode];
    if (!cfg) return;
    const state = { mode };

    overlay = el('div', STYLES.overlay);
    const card = el('div', STYLES.card);
    overlay.appendChild(card);

    const title = el('h3', STYLES.title, 'Reset your password');
    const sub = el('p', 'margin:6px 0 0;font-size:12.5px;color:#94a3b8;',
      'Enter your ' + (mode === 'doctor' ? 'account email' : cfg.idLabel.toLowerCase() + ' and account email') +
      '. We will email a single-use reset code valid for 15 minutes.');
    const msg = el('div', STYLES.msg);
    card.append(title, sub);

    // Step 1 fields
    const idIn = el('input', STYLES.input);
    idIn.placeholder = cfg.idPh;
    idIn.autocomplete = 'username';
    card.append(el('label', STYLES.label, cfg.idLabel), idIn);

    // Doctors identify by email alone — no second field needed.
    let emailIn = null;
    if (mode !== 'doctor') {
      emailIn = el('input', STYLES.input);
      emailIn.type = 'email';
      emailIn.placeholder = 'you@example.com';
      emailIn.autocomplete = 'email';
      card.append(el('label', STYLES.label, 'Email on the account'), emailIn);
    }
    card.append(msg);

    const sendBtn = el('button', STYLES.btn, 'Email me a reset code');
    const cancel1 = el('button', STYLES.ghost, 'Cancel');
    cancel1.addEventListener('click', close);
    card.append(sendBtn, cancel1);

    sendBtn.addEventListener('click', async () => {
      const id = idIn.value.trim();
      const email = (mode === 'doctor' ? id : (emailIn ? emailIn.value.trim().toLowerCase() : '')).toLowerCase();
      msg.style.color = '#f87171';
      msg.textContent = '';
      if (!id || !email) { msg.textContent = 'Fill in all fields.'; return; }
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending…';
      try {
        const body = { email };
        body[cfg.idField || 'email'] = id;
        const d = await post(cfg.endpoint + '/forgot-password', body);
        msg.style.color = '#4ade80';
        msg.textContent = d.message || d.error || 'Check your email.';
        if (d.ok) showStep2(card, cfg, state, { id, email }, msg);
      } catch (e) {
        msg.textContent = e.message;
      } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Email me a reset code';
      }
    });

    document.body.appendChild(overlay);
    idIn.focus();
  }

  function showStep2(card, cfg, state, ids, msg) {
    // Remove step-1 controls, keep title/sub/msg
    card.querySelectorAll('input,button,label').forEach(n => n.remove());
    msg.textContent = '';

    const codeIn = el('input', STYLES.input);
    codeIn.placeholder = 'Paste the code from the email';
    codeIn.autocomplete = 'one-time-code';
    const passIn = el('input', STYLES.input);
    passIn.type = 'password';
    passIn.placeholder = 'New password (min ' + cfg.minPass + ' chars)';
    passIn.autocomplete = 'new-password';
    card.append(
      el('label', STYLES.label, 'Reset code'), codeIn,
      el('label', STYLES.label, 'New password'), passIn
    );

    const okBtn = el('button', STYLES.btn, 'Set new password');
    const cancel2 = el('button', STYLES.ghost, 'Cancel');
    cancel2.addEventListener('click', close);
    card.append(okBtn, cancel2);

    okBtn.addEventListener('click', async () => {
      const token = codeIn.value.trim();
      const pass = passIn.value;
      msg.style.color = '#f87171';
      msg.textContent = '';
      if (!token || !pass) { msg.textContent = 'Enter the code and a new password.'; return; }
      if (pass.length < cfg.minPass) { msg.textContent = 'Password too short (min ' + cfg.minPass + ').'; return; }
      okBtn.disabled = true;
      okBtn.textContent = 'Saving…';
      try {
        const body = { email: ids.email, token, newPassword: pass };
        body[cfg.idField || 'email'] = ids.id;
        await post(cfg.endpoint + '/reset-password', body);
        msg.style.color = '#4ade80';
        msg.textContent = 'Password updated! You can sign in now.';
        setTimeout(close, 1600);
      } catch (e) {
        msg.textContent = e.message;
        okBtn.disabled = false;
        okBtn.textContent = 'Set new password';
      }
    });
    codeIn.focus();
  }

  // Delegated click handling — works with each portal's data-action style
  // without touching their dispatchers. Links use data-recover="mode".
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-recover]');
    if (!t) return;
    ev.preventDefault();
    open(t.getAttribute('data-recover'));
  });

  window.VELTRUVIA_RECOVER = { open };
})();
