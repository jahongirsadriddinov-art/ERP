/* QurilishERP Service Worker v4 — cache, push, offline IndexedDB + sync queue */
const CACHE_NAME = 'qurilish-erp-v4';
const STATIC_CACHE = 'qurilish-static-v4';
const DB_NAME = 'qurilish-offline';
const DB_VERSION = 2;

const PRECACHE_URLS = ['/', '/manifest.json', '/favicon.svg'];

const API_ORIGINS = [
  'https://qurilisherp-backend.onrender.com',
  'http://localhost:5000',
];

/* ── IndexedDB ─────────────────────────────────────────────────────────────── */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('api-cache')) {
        db.createObjectStore('api-cache', { keyPath: 'url' });
      }
      if (!db.objectStoreNames.contains('sync-queue')) {
        const store = db.createObjectStore('sync-queue', { keyPath: 'id', autoIncrement: true });
        store.createIndex('status', 'status');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(url) {
  const db = await openDB();
  return new Promise(resolve => {
    const req = db.transaction('api-cache', 'readonly').objectStore('api-cache').get(url);
    req.onsuccess = () => resolve(req.result?.data || null);
    req.onerror = () => resolve(null);
  });
}

async function idbPut(url, data) {
  const db = await openDB();
  return new Promise(resolve => {
    const tx = db.transaction('api-cache', 'readwrite');
    tx.objectStore('api-cache').put({ url, data, timestamp: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
}

async function queueRequest(method, url, body, headers) {
  const db = await openDB();
  return new Promise(resolve => {
    const tx = db.transaction('sync-queue', 'readwrite');
    tx.objectStore('sync-queue').add({
      method, url, body, headers,
      status: 'pending',
      createdAt: Date.now(),
    });
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
}

async function getPendingCount() {
  const db = await openDB();
  return new Promise(resolve => {
    const req = db.transaction('sync-queue', 'readonly')
      .objectStore('sync-queue').index('status').count('pending');
    req.onsuccess = () => resolve(req.result || 0);
    req.onerror = () => resolve(0);
  });
}

async function notifyClients(msg) {
  const list = await self.clients.matchAll({ type: 'window' });
  list.forEach(c => c.postMessage(msg));
}

/* ── Sync queue replay ─────────────────────────────────────────────────────── */
async function replayQueue() {
  const db = await openDB();
  const items = await new Promise(resolve => {
    const req = db.transaction('sync-queue', 'readonly')
      .objectStore('sync-queue').index('status').getAll('pending');
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
  if (!items.length) return;

  notifyClients({ type: 'SYNC_STATUS', status: 'syncing', count: items.length });

  for (const item of items) {
    try {
      const resp = await fetch(item.url, {
        method: item.method,
        headers: item.headers || { 'Content-Type': 'application/json' },
        body: item.body,
      });
      if (resp.ok || resp.status < 500) {
        // Muvaffaqiyatli yoki server tomonidan rad etildi — queuedan olib tashlaymiz
        const db2 = await openDB();
        await new Promise(r => {
          const tx = db2.transaction('sync-queue', 'readwrite');
          tx.objectStore('sync-queue').delete(item.id);
          tx.oncomplete = r;
          tx.onerror = r;
        });
      }
    } catch { /* tarmoq xatosi — keyingisiga o'tamiz */ }
  }

  const remaining = await getPendingCount();
  notifyClients({ type: 'SYNC_STATUS', status: remaining === 0 ? 'synced' : 'pending', count: remaining });
}

/* ── Install & Activate ────────────────────────────────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== STATIC_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* ── Fetch strategy ────────────────────────────────────────────────────────── */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.protocol === 'chrome-extension:') return;

  const isApi = API_ORIGINS.some(o => request.url.startsWith(o));

  /* Non-GET API requests — queue when offline */
  if (isApi && request.method !== 'GET') {
    event.respondWith(
      fetch(request.clone()).catch(async () => {
        try {
          const body = await request.clone().text();
          const headers = {};
          request.headers.forEach((v, k) => { headers[k] = v; });
          await queueRequest(request.method, request.url, body, headers);
          const count = await getPendingCount();
          notifyClients({ type: 'SYNC_STATUS', status: 'pending', count });
        } catch {}
        return new Response(JSON.stringify({ queued: true, offline: true }), {
          status: 202, headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  /* GET API requests — network-first, fallback to IndexedDB */
  if (isApi) {
    event.respondWith(
      fetch(request.clone())
        .then(async resp => {
          if (resp.ok) {
            try {
              const data = await resp.clone().json();
              await idbPut(request.url, data);
            } catch {}
          }
          return resp;
        })
        .catch(async () => {
          const cached = await idbGet(request.url);
          if (cached) {
            return new Response(JSON.stringify(cached), {
              headers: { 'Content-Type': 'application/json', 'X-From-Cache': 'true' }
            });
          }
          return new Response(JSON.stringify({ error: 'Offline' }), {
            status: 503, headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }

  /* Immutable static assets */
  if (url.pathname.match(/\/assets\/.*\.[a-f0-9]{8}\.(js|css)$/)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const resp = await fetch(request);
        if (resp.ok) cache.put(request, resp.clone());
        return resp;
      })
    );
    return;
  }

  /* Images & fonts — stale-while-revalidate */
  if (request.destination === 'image' || request.destination === 'font') {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(request);
        const fetchPromise = fetch(request).then(resp => {
          if (resp.ok) cache.put(request, resp.clone());
          return resp;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  /* HTML navigation */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(resp => {
          if (resp.ok) {
            // MUHIM: clone() BUYURTMA BILAN, sinxron — caches.open() natijasini
            // kutib turib keyin clone() chaqirilsa, "Response body is already
            // used" xatosiga olib keladi: respondWith(resp) darhol brauzerga
            // qaytadi va sahifa resp body'ni o'qishni boshlab yuboradi, shundan
            // keyin (caches.open resolve bo'lgach) clone() chaqirilsa — original
            // stream allaqachon iste'mol qilingan bo'ladi. Shu sabab clone() shu
            // yerda, .then ichida darhol (hech qanday async kutishsiz) olinadi.
            const cacheable = resp.clone();
            caches.open(STATIC_CACHE).then(c => c.put(request, cacheable)).catch(() => {});
          }
          return resp;
        })
        .catch(() => caches.match('/') || caches.match(request))
    );
    return;
  }
});

/* ── Background Sync ───────────────────────────────────────────────────────── */
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-queue') {
    event.waitUntil(replayQueue());
  }
});

/* ── Online event relay (from client) ─────────────────────────────────────── */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ONLINE') replayQueue();
  if (event.data?.type === 'GET_PENDING_COUNT') {
    getPendingCount().then(count =>
      event.source?.postMessage({ type: 'SYNC_STATUS', status: count > 0 ? 'pending' : 'idle', count })
    );
  }
});

/* ── Push Notifications ────────────────────────────────────────────────────── */
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { title: 'QurilishERP', body: event.data.text() }; }
  event.waitUntil(self.registration.showNotification(payload.title || 'QurilishERP', {
    body: payload.body || '',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: payload.tag || 'qurilish-default',
    data: { url: payload.url || '/' },
    vibrate: [200, 100, 200],
    requireInteraction: payload.requireInteraction || false,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.postMessage({ type: 'NAVIGATE', url: targetUrl });
          return;
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true })
      .then(sub => fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })).catch(console.error)
  );
});
