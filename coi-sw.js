// The two headers GitHub Pages cannot send, added to the page and the engine's worker as they load: with them the page
// is isolated from other sites', which is what lets it share memory with the worker (web/page.js, the engine's answers).
// Nothing is cached here, and every other file goes straight to the network.
//
// The game's own code and data (the pack, the engine, the scripts, the data files) are asked of the site again on every
// load, not taken from the browser's copy: GitHub Pages lets a browser keep a file ten minutes, so a refresh after a
// build went live still ran the one before it (Justin 2026-11-03: "is the build live? i refersed and don't see the
// changes"). One unchanged comes back as "not modified", with nothing sent again. Pictures and sounds keep their copy.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
const FRESH = /\.(pck|wasm|js|json)$/;
self.addEventListener('fetch', e => {
  const r = e.request;
  const url = new URL(r.url);
  const own = url.origin === self.location.origin;
  if (r.mode !== 'navigate' && !url.pathname.endsWith('/runtime/web.js')) {
    if (own && r.method === 'GET' && FRESH.test(url.pathname)) e.respondWith(fetch(r, { cache: 'no-cache' }));
    return;
  }
  e.respondWith(fetch(r, r.mode === 'navigate' ? undefined : { cache: 'no-cache' }).then(x => {
    const h = new Headers(x.headers);
    h.set('Cross-Origin-Opener-Policy', 'same-origin');
    h.set('Cross-Origin-Embedder-Policy', 'require-corp');
    return new Response(x.body, { status: x.status, statusText: x.statusText, headers: h });
  }));
});
