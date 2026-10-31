// The two headers GitHub Pages cannot send, added to the page and the engine's worker as they load: with them the page
// is isolated from other sites', which is what lets it share memory with the worker (web/page.js, the engine's answers).
// Nothing is cached here, and every other file goes straight to the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.mode !== 'navigate' && !r.url.endsWith('/runtime/web.js')) return;
  e.respondWith(fetch(r).then(x => {
    const h = new Headers(x.headers);
    h.set('Cross-Origin-Opener-Policy', 'same-origin');
    h.set('Cross-Origin-Embedder-Policy', 'require-corp');
    return new Response(x.body, { status: x.status, statusText: x.statusText, headers: h });
  }));
});
