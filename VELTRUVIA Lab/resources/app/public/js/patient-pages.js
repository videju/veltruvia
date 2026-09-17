// ═══════════════════════════════════════════════════════════════════
// VELTRUVIA Patient Portal — Page Scripts
// Extracted from patient.html inline <script> blocks.
// Depends on: js/ui.js (AppDialog + Widgets + helpers), js/secure-store.js,
// js/utils.js, js/telehealth-ws.js, js/actions.js
// ═══════════════════════════════════════════════════════════════════

// ── Global Error Boundary ──
window.onerror=function(msg,src,line,col,err){console.error("[VELTRUVIA Error]",{msg,src,line,col,err});return false;};
window.addEventListener("unhandledrejection",function(e){console.error("[VELTRUVIA Unhandled Promise]",e.reason);});

// ═══════════════════════════════════════════════════════════════════
// STORAGE — encrypted-at-rest via SecureStore ('cc' + 'lex' namespaces)
// ═══════════════════════════════════════════════════════════════════
const LS = {
  get(k) { return SecureStore.get('cc_' + k); },
  set(k, v) { SecureStore.set('cc_' + k, v); },
  remove(k) { SecureStore.remove('cc_' + k); },
  key(i) { return (SecureStore.enryptedKeys().find(x => x.startsWith('cc_')) || {}).key ? '' : ''; },
  length() { return SecureStore.enryptedKeys().length; },
  clear() { SecureStore.clear(); },
};
