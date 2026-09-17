/* VELTRUVIA service worker — Web Push display + notification clicks. */
self.addEventListener('install', (event) => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'VELTRUVIA';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: data.icon || './icons/patient-192.png',
    badge: './icons/patient-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || './patient.html' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './patient.html';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const client of list) {
      if (client.url.includes('veltruvia') || client.url.endsWith('patient.html') || client.url.endsWith('lab.html')) {
        return client.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
