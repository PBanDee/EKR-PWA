const CACHE_NAME = 'ekr-pwa-shell-v8';
const CACHE_PREFIX = 'ekr-pwa-shell-';
const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './api.js',
  './app.js',
  './manifest.webmanifest',
  './templates.json',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const shellRequests = SHELL_FILES.map((path) => new Request(
      new URL(path, self.registration.scope),
      { cache: 'reload' }
    ));
    await cache.addAll(shellRequests);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  const appScope = new URL(self.registration.scope);

  if (event.request.method !== 'GET'
      || requestUrl.origin !== appScope.origin
      || !requestUrl.pathname.startsWith(appScope.pathname)) {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(event.request);
      } catch (error) {
        const cachedPage = await caches.match(new URL('index.html', appScope).href);
        if (cachedPage) {
          return cachedPage;
        }
        throw error;
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cachedResponse = await caches.match(event.request);
    if (cachedResponse) {
      return cachedResponse;
    }

    const response = await fetch(event.request);
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(event.request, response.clone());
    }
    return response;
  })());
});
