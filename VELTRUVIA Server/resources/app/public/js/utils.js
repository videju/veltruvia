// ═══════════════════════════════════════════════════════════════════
// VELTRUVIA Shared Frontend Utilities
// Used by all HTML pages (index, patient, lab, admin)
// ═══════════════════════════════════════════════════════════════════

// ── XSS Protection ────────────────────────────────────────────────
/** Escape HTML entities to prevent XSS */
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape for use in HTML attributes */
function escAttr(s) {
  return esc(s).replace(/'/g, '&#39;');
}

// ── API Helpers ───────────────────────────────────────────────────
/** Make an authenticated API call */
async function api(method, path, body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(path, options);

  if (res.status === 401) {
    // Session expired — redirect to login
    if (typeof showLogin === 'function') showLogin();
    throw new Error('Session expired');
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data;
}

// ── Date/Time Formatting ──────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch { return dateStr; }
}

function formatDateTime(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return dateStr; }
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Number Formatting ─────────────────────────────────────────────
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
}

function formatNumber(n) {
  return new Intl.NumberFormat('en-US').format(n || 0);
}

function formatPercent(n, decimals = 0) {
  return `${(n || 0).toFixed(decimals)}%`;
}

// ── DOM Helpers ───────────────────────────────────────────────────
function $(selector) { return document.querySelector(selector); }
function $$(selector) { return document.querySelectorAll(selector); }

function show(el) { if (typeof el === 'string') el = $(el); if (el) el.style.display = ''; }
function hide(el) { if (typeof el === 'string') el = $(el); if (el) el.style.display = 'none'; }
function toggle(el) { if (typeof el === 'string') el = $(el); if (el) el.style.display = el.style.display === 'none' ? '' : 'none'; }

function setText(el, text) {
  if (typeof el === 'string') el = $(el);
  if (el) el.textContent = text;
}

function setHTML(el, html) {
  if (typeof el === 'string') el = $(el);
  if (el) el.innerHTML = html;
}

// ── Toast Notifications ───────────────────────────────────────────
function showToast(message, type = 'info', duration = 3000) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 10000;
    padding: 12px 20px; border-radius: 8px; color: #fff;
    font-size: 14px; font-weight: 500; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    animation: slideIn 0.3s ease;
    background: ${type === 'error' ? '#dc2626' : type === 'success' ? '#059669' : type === 'warning' ? '#d97706' : '#2563eb'};
  `;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; }, duration);
  setTimeout(() => toast.remove(), duration + 300);
}

// ── Confirmation Dialog ───────────────────────────────────────────
function confirm2(message) {
  return new Promise(resolve => resolve(window.confirm(message)));
}

// ── Debounce ──────────────────────────────────────────────────────
function debounce(fn, ms = 300) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// ── Export all to window ──────────────────────────────────────────
if (typeof window !== 'undefined') {
  Object.assign(window, {
    esc, escAttr, api, formatDate, formatDateTime, formatTime, timeAgo,
    formatCurrency, formatNumber, formatPercent,
    $, $$, show, hide, toggle, setText, setHTML,
    showToast, confirm2, debounce,
  });
}
