// VELTRUVIA push client — registers the service worker, asks the server for
// the VAPID public key, and subscribes this device. Idempotent: browsers keep
// an existing subscription when the applicationServerKey matches.
// Include on any page after login:  <script src="js/push-client.js"></script>
// (Patient/Lab pages get it automatically; it activates when a session cookie
//  is present. On Capacitor/native builds push permission UX varies, so it
//  degrades silently instead of nagging.)
(async function initVeltruviaPush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    // Only bother when the user looks logged in (auth cookie present or a
    // locally-stored account) — avoids permission prompts on the login screen.
    const looksLoggedIn = document.cookie.length > 0 ||
      Object.keys(localStorage).some(k => k.startsWith('pat_') || k.startsWith('doc_') || k.startsWith('lab_'));
    if (!looksLoggedIn) return;

    const reg = await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;

    const keyRes = await fetch('/api/push/vapid-public-key');
    if (!keyRes.ok) return;                       // push disabled server-side
    const { key } = await keyRes.json();
    if (!key) return;

    const existing = await reg.pushManager.getSubscription();
    const sub = existing || await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(key),
    });

    await fetch('/api/push/subscribe', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
  } catch (err) {
    // Never break the app over push: denied permission, native wrapper, etc.
    console.debug('[push] not enabled:', err && err.message);
  }

  function urlB64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }
})();
