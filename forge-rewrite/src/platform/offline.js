// The offline copy (1.7 js/platform/offline.js:22-162 and mobile.js:180-181, O1). A stamped release build registers
// sw.js. A copy installed to the home screen then stores the whole game, the files listed in assets/manifest.json
// plus the page, its bundle and the app manifest, as one revision for its build, with a corner badge for progress
// ("Storing the game for offline play… 40%") and "Offline copy ready: this device can play with no signal" when it
// is done. A browser tab only keeps what it loaded (the worker copies each file it serves).
// Every file is fetched past any cache (?forge-offline-verify) and the revision counts only once its receipt is
// written, so a half-stored or mixed copy is never used. It waits until a run is on screen with its floor drawn, and
// pauses while another floor's art loads (1.7 gameSettled, the Tab M8 fix of 2026-10-14). No save data is involved.

import '../../offline-protocol.js';   // sets globalThis.FORGE_OFFLINE, the names sw.js reads too
import { pageBuild } from './build.js';

const P = globalThis.FORGE_OFFLINE, PREFIX = P.REVISION, CACHE = P.CACHE, BATCH = 4;

/**
 * @param {{ say:(text:string|null, done?:boolean)=>void, settled:()=>boolean, log?:(words:string)=>void }} hooks
 */
export function startOffline(hooks) {
  const built = pageBuild();
  if (built === 'dev' || !('caches' in window) || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  const top = window.self === window.top;
  const installed = matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches
    || navigator.standalone === true || (top && /; wv\)/.test(navigator.userAgent || ''));
  // A framed tab (the itch.io page) stores nothing more: a cross-site frame's worker does not share the frame's HTTP
  // cache, so asking again would download it all twice.
  if (!installed && !top) return;
  const announce = () => navigator.serviceWorker.controller?.postMessage({ type: P.CLIENT_MESSAGE, built });
  announce();
  navigator.serviceWorker.addEventListener?.('controllerchange', announce);
  const say = (t, done) => { if (installed) hooks.say(t, done); };
  const start = () => setTimeout(() => fill(built, installed, say, hooks).catch(e => { hooks.say(null); console.warn('Offline storage is unavailable in this browser.', e); }), 3000);
  if (document.readyState === 'complete') start(); else addEventListener('load', start, { once: true });
}

const settledNow = hooks => new Promise(resolve => { (function wait() { if (hooks.settled()) resolve(); else setTimeout(wait, 1000); })(); });
const strip = p => { const u = new URL(p, location.href); u.search = ''; u.hash = ''; return u.href; };

async function verified(path, built) {
  const u = new URL(path, location.href);
  u.searchParams.set(P.VERIFY, built);
  const r = await fetch(u.href, { cache: 'no-store' });
  if (!r || r.status !== 200 || r.headers.get(P.VERIFIED) !== built) throw new Error('Offline file was not verified from the network: ' + path);
  return r;
}

/** Everything the game can ask for: the shell and every file the asset manifest lists. */
export function offlineFiles(manifest) {
  const files = new Set(['index.html', 'build/main.js', 'build/bake-worker.js', 'manifest.webmanifest', 'assets/manifest.json']);
  for (const g of Object.values(manifest.groups ?? {})) for (const f of g.files ?? []) files.add('assets/' + f);
  for (const f of manifest.licences ?? []) files.add('assets/' + f);
  return [...files].sort();
}

async function complete(name, built) {
  if (!(await caches.keys()).includes(name)) return false;
  const r = await (await caches.open(name)).match(new URL(P.RECEIPT, location.href).href);
  return !!r && (await r.json()).built === built;
}

async function fill(built, installed, say, hooks) {
  if (!(await navigator.serviceWorker.getRegistration())) return;
  if (!installed) {
    // A tab: the files it loaded before the worker took over, into the worker's cache (the worker keeps the rest).
    const cache = await caches.open(CACHE), have = new Set((await cache.keys()).map(r => r.url));
    const loaded = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.startsWith(location.origin) && !have.has(strip(n)));
    for (let i = 0; i < loaded.length; i += BATCH) {
      await Promise.all(loaded.slice(i, i + BATCH).map(async n => { try { const r = await fetch(n, { cache: 'no-cache' }); if (r.status === 200) await cache.put(strip(n), r.clone()); } catch { /* skipped */ } }));
      await new Promise(r => setTimeout(r, 30));
    }
    return;
  }
  const name = PREFIX + encodeURIComponent(built);
  if (await complete(name, built)) { say('Offline copy ready: this device can play with no signal', true); return; }
  await settledNow(hooks);
  let list;
  try {
    const b = await (await verified('build.json', built)).json();
    if (b.built !== built) { say('A newer game is available. Reload online before storing it offline.', false); return; }
    list = offlineFiles(await (await verified('assets/manifest.json', built)).json());
  } catch { say('Offline copy incomplete. Reconnect and reopen the game to retry.', false); return; }
  // An unfinished revision is stored again in full: finding its files is no proof they are this build's.
  await caches.delete(name);
  const staged = await caches.open(name);
  let done = 0, failed = 0;
  say('Storing the game for offline play… 0%', false);
  for (let i = 0; i < list.length; i += BATCH) {
    await settledNow(hooks);
    await Promise.all(list.slice(i, i + BATCH).map(async path => {
      try {
        const r = await verified(path, built);
        // The page's stamp catches a release that changed while this copy was being stored.
        if (path === 'index.html' && !(await r.clone().text()).includes(`name="forge-build" content="${built}"`)) throw new Error('Offline shell revision mismatch');
        await staged.put(strip(path), r.clone()); done++;
      } catch { failed++; }
    }));
    await new Promise(r => setTimeout(r, 30));
    say(`Storing the game for offline play… ${Math.round(((done + failed) / list.length) * 100)}%`, false);
  }
  if (!failed) {
    try { if ((await (await verified('build.json', built)).json()).built !== built) failed++; } catch { failed++; }
  }
  if (failed) { await caches.delete(name); say('Offline copy incomplete. Reconnect and reopen the game to retry.', false); return; }
  await staged.put(new URL(P.RECEIPT, location.href).href, new Response(JSON.stringify({ built }), { headers: { 'Content-Type': 'application/json' } }));
  // One pointer write makes this the copy a navigation opens with no signal; the build before it is kept once.
  const control = await caches.open(CACHE), ptr = new URL(P.POINTER, location.href).href;
  const old = await control.match(ptr), was = old ? await old.json() : null;
  await control.put(ptr, new Response(JSON.stringify({ built, previous: was && was.built !== built ? was.built : was?.previous ?? null })));
  const keep = new Set([name, was && PREFIX + encodeURIComponent(was.built)]);
  for (const n of await caches.keys()) if (n.startsWith(PREFIX) && !keep.has(n)) await caches.delete(n);
  say('Offline copy ready: this device can play with no signal', true);
  hooks.log?.('This device now has the whole game stored for offline play.');
}
