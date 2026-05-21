// Sunken Suite · The Mutiny 2026 · Service Worker
const CACHE_NAME = 'sunken-suite-v4';
const OFFLINE_URL = '/';

// ── Install ───────────────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(['/'])).catch(() => {})
  );
});

// ── Activate ──────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  // Skip non-GET, chrome-extension, and API requests
  if (event.request.method !== 'GET') return;
  if (event.request.url.startsWith('chrome-extension://')) return;
  if (event.request.url.includes('workers.dev') && !event.request.url.includes('/manifest')) return;

  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request).then(r => r || caches.match(OFFLINE_URL))
    )
  );
});

// ── Push Notifications ────────────────────────────────────
self.addEventListener('push', event => {
  let data = { title: '☠ Sunken Suite', body: 'You have a new notification', url: '/' };

  if (event.data) {
    try {
      // Try JSON parse
      const parsed = JSON.parse(event.data.text());
      if (parsed.title) data.title = parsed.title;
      if (parsed.body)  data.body  = parsed.body;
      if (parsed.url)   data.url   = parsed.url;
    } catch(e) {
      // Plain text fallback
      data.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:     data.body,
      icon:     '/icon192.png',
      badge:    '/icon192.png',
      tag:      'sunken-suite-' + Date.now(),
      vibrate:  [200, 100, 200],
      requireInteraction: false,
      data:     { url: data.url || '/' }
    })
  );
});

// ── Notification Click ────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Focus existing window if open
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Open new window
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
