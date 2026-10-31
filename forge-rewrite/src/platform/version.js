// The game's version and its update check (1.7 js/platform/update.js:385-461, CSS-12). A stamped release page
// carries its build time (index.html meta forge-build, tools/assets/stamp-build.mjs); the published build.json says
// which build is live. While the title is up the check runs once a minute, and again when the device comes back
// online or the page is shown; a newer live build shows "Update available" on the title. Installing drops the offline
// worker and this game's cached files, then reloads the page on the new build. Saved games and settings are kept.

import '../../offline-protocol.js';   // globalThis.FORGE_OFFLINE: this game's cache names (shared with sw.js)
import { pageBuild, fetchWithTimeout } from './build.js';

/** The name of this build ('Rewrite preview') and the notes of every version, newest first. */
import { VERSION, PATCHES } from '../data/version.js';   // C17: the name and notes are data
export { VERSION, PATCHES };

const CHECK_MS = 60000, TIMEOUT_MS = 8000, CACHE_PREFIX = globalThis.FORGE_OFFLINE.PREFIX;
const state = { message: 'Checking for updates…', latest: null, pending: null, validated: false, installing: false };
const watchers = new Set();
let timer = null, hooked = false, lastCheck = -Infinity;

const tell = () => { for (const fn of [...watchers]) fn(state); };

/** An ISO build time as ms, NaN when it is not one (1.7 foteBuildTime). */
export function buildTime(value) {
  if (typeof value !== 'string') return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!m) return NaN;
  const month = Number(m[2]), day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(Number(m[1]), month, 0)).getUTCDate() || Number(m[4]) > 23 || Number(m[5]) > 59
    || Number(m[6]) > 59 || Number(m[7] || 0) > 23 || Number(m[8] || 0) > 59) return NaN;
  return Date.parse(value);
}

/** A copy running inside itch.io's frame cannot install: the player reloads the itch.io page instead. */
export const itchUpload = () => typeof location !== 'undefined' && /(^|\.)itch\.zone$/.test(location.hostname);

/** What the check knows now: message, latest (the newer build, or null), validated, installing. */
export const versionState = () => state;

/**
 * The words after the version on the title (1.7 #versionStatus, lower case): "update available" when a newer build is
 * live, else the check's message.
 */
export const titleStatus = () => (state.latest ? 'Update available' : state.message).toLowerCase();

/** Compares this page's build with the live build.json; resolves true when the answer could be checked. */
export function checkVersion() {
  if (state.pending) return state.pending;
  const local = buildTime(pageBuild());
  if (!Number.isFinite(local)) {
    state.latest = null; state.validated = false;
    state.message = pageBuild() === 'dev' ? 'Development build' : 'This copy has no valid build date.';
    tell(); return Promise.resolve(false);
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    state.validated = false;
    state.message = state.latest ? 'Update available. Connect to install.' : 'Offline, updates cannot be checked.';
    tell(); return Promise.resolve(false);
  }
  state.validated = false; state.message = 'Checking for updates…'; tell();
  state.pending = (async () => {
    try {
      const r = await fetchWithTimeout('build.json?t=' + Date.now(), { cache: 'no-store', timeout: TIMEOUT_MS, label: 'Update check' });
      if (!r.ok) throw new Error('Unavailable');
      const b = await r.json(), remote = b && buildTime(b.built);
      if (!b || !Number.isFinite(remote)) throw new Error('Invalid build');
      state.latest = remote > local ? b : null; state.validated = true;
      state.message = state.latest ? (itchUpload() ? 'Update available. Reload the itch.io game page; saved games are kept.' : 'Update available. Open Version to install.')
        : remote < local ? 'This copy is newer than the published build.' : 'Up to date';
      return true;
    } catch {
      state.validated = false;
      state.message = state.latest ? 'Update available. Could not recheck; connect to install.' : 'Could not check for updates. You can keep playing this copy.';
      return false;
    } finally { state.pending = null; tell(); }
  })();
  return state.pending;
}

/** Checks now if the last check is a minute old (a screen rebuilt in between does not ask again), then once a minute. */
function loop(e) {
  clearTimeout(timer); timer = null;
  if (!watchers.size || (typeof document !== 'undefined' && document.hidden)) return;
  const due = lastCheck + CHECK_MS - Date.now();
  if (due <= 0 || e?.type === 'online' || e?.type === 'offline') { lastCheck = Date.now(); checkVersion(); }
  timer = setTimeout(loop, Math.max(1000, due > 0 ? due : CHECK_MS));
}

/**
 * The title (or the Version window) listens while it is on screen: `fn(state)` on every change. The checks run only
 * while something listens. Returns the function that stops listening.
 */
export function watchVersion(fn) {
  const first = !watchers.size;
  watchers.add(fn);
  if (!hooked && typeof window !== 'undefined') {
    hooked = true;
    for (const ev of ['online', 'offline']) window.addEventListener(ev, loop);
    document.addEventListener('visibilitychange', loop);
  }
  if (first) loop();
  return () => { watchers.delete(fn); if (!watchers.size) { clearTimeout(timer); timer = null; } };
}

/** Installs the newer build: the offline worker and this game's cached files go, then the page reloads on it. */
export async function installUpdate() {
  if (state.installing || itchUpload()) return;
  state.installing = true; tell();
  try {
    const ok = await checkVersion(), b = state.latest;
    if (!ok || !state.validated || !b) return;
    const scope = new URL('./', location.href).href;
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.filter(r => r.scope === scope).map(r => r.unregister()));
    }
    if (window.caches) {
      for (const k of (await caches.keys()).filter(k => k.startsWith(CACHE_PREFIX))) {
        const cache = await caches.open(k);
        await Promise.all((await cache.keys()).filter(r => new URL(r.url).href.startsWith(scope)).map(r => cache.delete(r)));
      }
    }
    const url = new URL(location.href);
    url.searchParams.set('b', b.built);
    location.replace(url.href);
  } catch {
    state.message = 'Update could not be installed. Please try again.';
  } finally { state.installing = false; tell(); }
}
