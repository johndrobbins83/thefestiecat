// Sunken Suite · The Mutiny 2026 · Service Worker

const CACHE_NAME = 'sunken-suite-v5';
const OFFLINE_URL = '/';
const DB_NAME = 'sunken-suite-sw';
const STORE_NAME = 'meta';
const COUNT_KEY = 'unseenCount';

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
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.protocol === 'chrome-extension:') return;

  // Skip your API/auth routes so they never get cached or served stale.
  // Adjust this prefix to match wherever your Worker's auth endpoints actually live
  // (e.g. '/api/', '/auth/'). This replaces the old "workers.dev" string check,
  // which was matching the whole site if the front end is also served from workers.dev.
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        // Cache a copy of successful responses for offline use later
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then(cached => {
          if (cached) return cached;
          // Only fall back to the offline shell for page navigations,
          // not for every failed asset request
          if (req.mode === 'navigate') return caches.match(OFFLINE_URL);
        })
      )
  );
});

// ── IndexedDB helpers (unseen notification counter) ────────
// Service workers can't use localStorage, so we track the count here.
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getCount() {
  try {
    const db = await idbOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(COUNT_KEY);
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return 0;
  }
}

async function setCount(n) {
  try {
    const db = await idbOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(n, COUNT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    // non-fatal — worst case the count resets to showing just the latest message
  }
}

// ── Push Notifications ────────────────────────────────────
// Uses a single shared tag + renotify so each new push REPLACES the
// previous notification instead of piling up separate alerts, and shows
// a running "N new updates" count once more than one has arrived.
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    const payload = { title: '☠ Sunken Suite', body: 'You have a new notification', url: '/' };

    if (event.data) {
      try {
        const parsed = JSON.parse(event.data.text());
        if (parsed.title) payload.title = parsed.title;
        if (parsed.body)  payload.body  = parsed.body;
        if (parsed.url)   payload.url   = parsed.url;
        if (parsed.image) payload.image = parsed.image; // was previously dropped
      } catch (e) {
        payload.body = event.data.text();
      }
    }

    const count = (await getCount()) + 1;
    await setCount(count);

    const title = count > 1 ? `☠ Sunken Suite — ${count} new updates` : payload.title;
    const body  = count > 1 ? `Latest: ${payload.body}` : payload.body;

    await self.registration.showNotification(title, {
      body,
      icon: '/icon512.png',
      badge: '/icon192.png',
      image: payload.image || undefined,
      tag: 'sunken-suite-stack',   // shared tag = one block, not one-per-push
      renotify: true,              // still alerts/vibrates on update
      requireInteraction: false,
      vibrate: [200, 100, 200],
      data: { url: payload.url || '/' }
    });
  })());
});

// ── Notification Click ────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil((async () => {
    await setCount(0); // reset the stack once the person actually looks

    const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      if (client.url.includes(self.location.origin) && 'focus' in client) {
        try { await client.navigate(url); } catch (e) { /* not supported everywhere */ }
        return client.focus();
      }
    }
    if (clients.openWindow) return clients.openWindow(url);
  })());
});

// ── Optional: let the open app reset the counter too ───────
// If the person opens the app directly (not via tapping the notification),
// have the page postMessage({ type: 'RESET_NOTIFICATION_COUNT' }) to the SW
// on load so the next push starts counting fresh instead of continuing an
// old, stale count.
self.addEventListener('message', event => {
  if (event.data?.type === 'RESET_NOTIFICATION_COUNT') {
    event.waitUntil(setCount(0));
  }
});
