// Loads art by the load groups in assets/manifest.json. Sheets come back as PixiJS spritesheets by name.
// A missing sheet is an error the screen shows, never a silent fallback.
//
// 1.7's bounded art loading (render.js:6-134 atlas queue, RC33; environment-terrain.js:22-47 deadline, WT17):
// - at most 4 sheets load at once; the background stream has one lane of its own and anything a screen asks for
//   goes ahead of it (a queued background sheet that a screen then asks for is promoted);
// - the manifest has 15 s and a sheet 45 s to arrive; a failure is remembered and asked again only after 5 s, or at
//   once by a Retry ({ retry: true });
// - a 96 MB budget of decoded art (1.7 trimAtlasCache): past it, the least recently used sheets outside the current
//   floor's art, not drawn for 5 s, are parked oldest first: the GPU copy and the decoded picture both go (the
//   source's picture becomes a 1x1 blank), so the budget bounds memory on a tablet as 1.7's did. The sheet's
//   textures stay valid (several looks keep cut textures over a sheet's source). loadGroup and loadSheet bring a parked
//   picture back, so a floor's art is whole behind the floor hold; drawn while parked, a sheet is blank until its
//   picture is back (1.7 atl() returns null until reloaded), then uploads again; CPU readers ask readable() first.
// - terrain masters belong to the installed floor (1.7 environment-terrain.js:100-108, WT18): when keepArt names a new
//   floor's art, every environment-terrain sheet it does not keep is released whole (its decoded picture and GPU copy),
//   so a phone does not carry the Crypt's masonry into the Caverns. A floor that needs one again loads it again. The
//   Dungeon's masonry stays: the treasure room before the Realm is built from it and no floor list names it there.
// - a group can carry single pictures with it (alsoLoad), loaded and kept with the group's sheets (CH-R17: the material
//   gateway arrives with the Realm's art, as 1.7's Chaos prep loads it before the floor shows).

import { Assets, extensions, ExtensionType, LoaderParserPriority } from '../../../forge-godot/runtime/pixi.js';
import { deadline, fetchWithTimeout } from './build.js';
import { artStore, sheet, hasSheet, readable, onRelease } from '../render/art-store.js';   // C17: the store render reads
import { setSounds, holdSound } from '../audio/sound-list.js';   // C17: the cues audio reads, and their recordings

export { sheet, hasSheet, readable, onRelease };

const BASE = 'assets/';

// A network blip is not a missing file (proof pass, assets item 1: one failed fetch of a UI plate or the art list
// stopped the boot): every picture and sheet PixiJS loads, here or by a screen (title plates, the poster), is tried
// 3 more times, 0.5 s apart, before it counts as failed. The manifest's own fetch does the same (loadManifest).
// Use Pixi's direct bitmap decoder so a silent image worker cannot hold startup (audit 339).
Assets.setPreferences({ preferWorkers: false });
Assets.loader.loadOptions = { ...Assets.loader.loadOptions, strategy: 'retry', retryCount: 3, retryDelay: 500 };
const TRIES = 4, TRY_GAP = 500;
const MAX_ACTIVE = 4, MANIFEST_TIMEOUT = 15000, SHEET_TIMEOUT = 45000, RETRY_AFTER = 5000, BUDGET = 96 * 1024 * 1024;
let manifest = null, manifestJob = null, manifestFailure = null;
const { sheets, releaseHooks } = artStore;
const loaded = new Set();
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function loadManifest(o = {}) {
  if (manifest) return Promise.resolve(manifest);
  if (manifestJob) return manifestJob;
  if (manifestFailure && !o.retry && now() < manifestFailure.retryAt) return Promise.reject(manifestFailure.error);
  const got = fetchWithTimeout(BASE + 'manifest.json', { timeout: MANIFEST_TIMEOUT, tries: TRIES, gap: TRY_GAP, label: 'The art list' }).then(r => {
    if (!r.ok) throw new Error(`The art list could not load (HTTP ${r.status}).`);
    return r.json();
  });
  const job = manifestJob = got
    .then(m => { manifest = m; manifestFailure = null; setSounds(m.sounds); return m; })
    .catch(e => { manifestFailure = { error: e, retryAt: now() + RETRY_AFTER }; throw e; })
    .finally(() => { if (manifestJob === job) manifestJob = null; });
  return job;
}

// Only the transport of sheet metadata changes: Pixi still parses, caches and unloads each logical sheet and image.
// Register once for direct UI Assets.load calls too. The original URL remains the base for meta.image.
const catalogs = new Map();
const sheetPath = url => {
  const pathname = new URL(url).pathname, at = pathname.lastIndexOf('/assets/');
  const p = at < 0 ? '' : pathname.slice(at + 8);
  return /^(?:sheets\/(?!normals\/)|images\/(?:creation|portraits)\/).+\.json$/.test(p) ? p : null;
};
extensions.add({
  extension: { type: ExtensionType.LoadParser, priority: LoaderParserPriority.High },
  name: 'forge-sheet-catalog', id: 'forge-sheet-catalog',
  test: url => !!sheetPath(url),
  async load(url, options) {
    const p = sheetPath(url), m = await loadManifest(), file = m.sheetCatalogs?.[p];
    if (!file) throw new Error('No art catalog for ' + p);
    if (!catalogs.has(file)) {
      const job = fetchWithTimeout(BASE + file, { timeout: SHEET_TIMEOUT, tries: TRIES, gap: TRY_GAP, label: 'Art catalog ' + file })
        .then(r => { if (!r.ok) throw new Error(`Art catalog ${file} could not load (HTTP ${r.status}).`); return r.json(); })
        .catch(e => { catalogs.delete(file); throw e; });
      catalogs.set(file, job);
    }
    const data = (await catalogs.get(file))[p];
    if (!data?.frames) { catalogs.delete(file); throw new Error(`Missing sheet ${p} in ${file}`); }
    options.data ??= {};
    options.data.cachePrefix ??= keyOf(p) + '/';
    return data;
  },
});

// ---- the sheet queue
const jobs = new Map();   // sheet key -> { key, path, phase: queued|load|ready|failed, background, promise, error, retryAt, bytes, used }
const queue = [];
let active = 0, backgroundActive = 0;

function pump() {
  while (active < MAX_ACTIVE && queue.length) {
    let i = queue.findIndex(j => !j.background);
    if (i < 0) { if (backgroundActive >= 1) return; i = 0; }
    const job = queue.splice(i, 1)[0];
    if (jobs.get(job.key) !== job || job.phase !== 'queued') continue;
    start(job);
  }
}

const sourceOf = s => s?.textureSource ?? (s?.textures ? Object.values(s.textures)[0]?.source : s?.source) ?? null;   // a sheet, or a single picture

function start(job) {
  active++; job.phase = 'load';
  const bg = job.background;
  if (bg) backgroundActive++;
  if (job.reload) {   // a parked sheet: its picture fetched and decoded again into the same source
    const src = job.reload;
    deadline(decodePicture(src._sourceOrigin ?? src.label), SHEET_TIMEOUT, 'Art ' + job.path)
      .then(pic => {
        if (jobs.get(job.key) !== job || src.destroyed) { pic?.close?.(); return job.resolve(); }
        unpark(src, pic); job.reload = null; job.error = null;
        job.used = now(); job.phase = 'ready'; job.resolve();
      }, e => { job.phase = 'parked'; job.error = e; job.retryAt = now() + RETRY_AFTER; job.reject(e); })
      .finally(() => { active--; if (bg) backgroundActive--; pump(); trim(); });
    return;
  }
  // A sheet that times out or fails is asked once more, with twice the time, before anyone hears of it (proof pass,
  // assets item 3: floor art timed out on a busy machine and the floor stayed without it). The first load is not
  // cancelled, so a slow one that is nearly in is simply waited for longer.
  const tries = job.tries = (job.tries ?? 0) + 1, sound = SOUND.test(job.path);   // item 256: a recording, held for the audio
  deadline(sound ? holdSound(BASE + job.path) : Assets.load({ src: BASE + job.path, data: { cachePrefix: job.key + '/' } }), SHEET_TIMEOUT * tries, 'Art ' + job.path)
    .then(s => {
      if (!sound) sheets.set(job.key, s);
      const src = sourceOf(s);
      job.bytes = src ? (src.pixelWidth ?? src.width) * (src.pixelHeight ?? src.height) * 4 : 0;
      job.used = now(); job.phase = 'ready'; job.error = null; job.resolve();
    }, e => {
      if (tries < 2 && jobs.get(job.key) === job) { job.phase = 'queued'; queue.unshift(job); return; }
      job.phase = 'failed'; job.error = e; job.retryAt = now() + RETRY_AFTER; job.reject(e);
    })
    .finally(() => { active--; if (bg) backgroundActive--; pump(); trim(); });
}

/** One sheet's load: joined when it is already on its way; a failure is asked again only after 5 s or on a Retry. */
function requestSheet(key, path, o = {}) {
  let job = jobs.get(key);
  if (sheets.has(key) && (!job || job.phase === 'ready')) { if (job) job.used = now(); return Promise.resolve(); }
  if (job?.phase === 'parked') {   // its picture again, through the queue like any sheet
    if (job.error && !o.retry && now() < job.retryAt) return Promise.reject(job.error);
    job.phase = 'queued'; job.background = !!o.background; job.used = now();
    job.promise = new Promise((res, rej) => { job.resolve = res; job.reject = rej; });
    job.promise.catch(() => {});
    queue.push(job); pump();
    return job.promise;
  }
  if (job?.phase === 'failed' && (o.retry || now() >= job.retryAt)) { jobs.delete(key); job = null; }
  if (job) {
    if (!o.background && job.background) { job.background = false; pump(); }   // a screen wants it now: out of the slow lane
    return job.promise;
  }
  job = { key, path, phase: 'queued', background: !!o.background, error: null, retryAt: 0, bytes: 0, used: now() };
  job.promise = new Promise((res, rej) => { job.resolve = res; job.reject = rej; });
  job.promise.catch(() => {});
  jobs.set(key, job); queue.push(job); pump();
  return job.promise;
}

const keyOf = path => path.replace(/^sheets\//, '').replace(/\.json$/, '');
const extras = new Map();    // group name -> single pictures that load with it (alsoLoad)
// Item 256: an audio- group's recordings load with it, as its manifest note says ("before floor 1: effects heard on any
// floor"); a music- group's track is left to the audio, which fades it in when it arrives (nothing waits for it).
const SOUND = /\.mp3$/;
const groupPaths = (m, name) => [...(m?.groups[name]?.sheets ?? []), ...(/^audio-/.test(name) ? (m?.groups[name]?.files ?? []).filter(f => SOUND.test(f)) : []), ...(extras.get(name) ?? [])];

/** A single picture (a path in assets/, for example 'sheets/map-material-gateway.webp') that loads with a group and is
 *  kept with it; sheet() and hasSheet() name it by its file name ('map-material-gateway.webp'). */
export function alsoLoad(group, path) {
  const list = extras.get(group) ?? [];
  if (!list.includes(path)) list.push(path);
  extras.set(group, list);
  loaded.delete(group);
}
const pending = new Map();   // group name -> its load in flight, so a screen and the background stream share one fetch

/** Loads every sheet (and an audio group's recordings) in a group. Resolves when all are ready. A group already on its way is joined, not fetched again.
 *  `o.retry` asks again at once for what failed; `o.background` puts its sheets in the background lane; `o.each(n)` is
 *  told the group's sheet count once known (n), then called with no count as each sheet arrives (RB5's veil count). */
export function loadGroup(name, o = {}) {
  if (loaded.has(name) && !groupPaths(manifest, name).some(p => jobs.get(keyOf(p))?.reload)) return Promise.resolve();
  const was = pending.get(name);
  if (was) {
    if (!o.background) for (const p of was.paths) requestSheet(keyOf(p), p);   // promote a background group's sheets
    return was.promise;
  }
  const entry = { paths: [] };
  entry.promise = (async () => {
    const m = await loadManifest(o);
    const g = m.groups[name];
    if (!g) throw new Error('no asset group ' + name);
    entry.paths = groupPaths(m, name);
    o.each?.(entry.paths.length);
    await Promise.all(entry.paths.map(p => requestSheet(keyOf(p), p, o).then(r => { o.each?.(); return r; })));
    loaded.add(name);
  })();
  entry.promise.catch(() => {}).finally(() => { if (pending.get(name) === entry) pending.delete(name); });
  pending.set(name, entry);
  return entry.promise;
}

/** The background stream (1.7's staged loading): fetches groups one after another in the background lane, so they
 *  never crowd what a screen is waiting for. A screen that needs a group sooner calls loadGroup itself, which promotes
 *  it. Missing groups and failures are skipped; whoever needs that group later asks for it again. */
export async function streamGroups(names) {
  const m = await loadManifest().catch(() => null);
  if (!m) return;
  for (const name of names) if (m.groups[name]) await loadGroup(name, { background: true }).catch(() => {});
}

/** Loads one sheet by its path in assets/ (for a sheet whose group is not otherwise needed yet). */
export function loadSheet(path, o = {}) {
  return requestSheet(keyOf(path), path, o);
}

let keep = new Set(), trimTimer = null;
const retained = new Map();
/** Protects explicit asset paths from parking until released, without changing the floor's keep list. Does not load art. */
export function retainArt(paths) {
  const keys = [...new Set(paths.map(keyOf))];
  for (const key of keys) retained.set(key, (retained.get(key) ?? 0) + 1);
  let live = true;
  return () => {
    if (!live) return;
    live = false;
    for (const key of keys) {
      const left = retained.get(key) - 1;
      if (left) retained.set(key, left); else retained.delete(key);
    }
    trim();
  };
}
/** The current floor's art: the groups and single sheets never trimmed while it is up. Trims at once. */
export function keepArt(groups, extraSheets = []) {
  keep = new Set(extraSheets.map(keyOf));
  for (const g of groups) for (const p of groupPaths(manifest, g)) keep.add(keyOf(p));
  if (manifest && groups.length) for (const j of [...jobs.values()]) if (TERRAIN.test(j.key) && (j.phase === 'ready' || j.phase === 'parked') && !keep.has(j.key)) release(j);
  trim();
}

const TERRAIN = /^environment-terrain-(?!dungeon-)/;
/** WT18: a sheet given up whole: out of the loader and Pixi's cache, and every group holding it loads it again. */
function release(job) {
  const src = sourceOf(sheets.get(job.key));
  for (const fn of releaseHooks) try { fn(job.key, src); } catch (e) { console.error('art release hook', e); }
  sheets.delete(job.key); jobs.delete(job.key);
  for (const name of [...loaded]) if (groupPaths(manifest, name).includes(job.path)) loaded.delete(name);
  try { Promise.resolve(Assets.unload(BASE + job.path)).catch(() => {}); } catch { /* already gone */ }
}

// ---- parking (1.7 trimAtlasCache drops the image; here the source keeps its place and gives up its picture)
let blank = null;
const blankPicture = () => blank ??= (typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: 1, height: 1 }) : { width: 1, height: 1 });
/** Fetches and decodes a picture as Pixi's loader does (loadTextures loadImageBitmap). */
async function decodePicture(url) {
  const r = await fetchWithTimeout(url, { tries: TRIES, gap: TRY_GAP });
  if (!r.ok) throw new Error(`Art ${url} could not load (HTTP ${r.status}).`);
  return createImageBitmap(await r.blob());
}
/** The source's picture swapped for a blank, so its decoded pixels can be freed (not closed: a look may share it).
 *  Reading `resource` while parked (the renderer uploading it because something drew it) asks for the picture again. */
function park(job, src) {
  src.unload?.();
  Object.defineProperty(src, 'resource', {
    configurable: true, enumerable: true,
    get() { wake(job); return blankPicture(); },
    set(v) { unpark(src, v); },   // destroy() sets it
  });
  job.reload = src; job.phase = 'parked'; job.error = null; parkedSources.add(src);
}
function unpark(src, pic) {
  parkedSources.delete(src);
  Object.defineProperty(src, 'resource', { configurable: true, enumerable: true, writable: true, value: pic });
  if (pic) { src.unload?.(); src.emit?.('update', src); }   // the blank's GPU copy goes; the next draw uploads the picture
}
function wake(job) {
  if (job.waking) return;
  job.waking = true;
  queueMicrotask(() => { job.waking = false; if (jobs.get(job.key) === job && job.phase === 'parked') requestSheet(job.key, job.path).catch(() => {}); });
}
/** When a sheet was last asked for or drawn (Pixi stamps a source each time it binds it, GlTextureSystem bindSource). */
const lastUse = j => Math.max(j.used, sourceOf(sheets.get(j.key))?._gcLastUsed ?? -1);

/** 1.7 trimAtlasCache: over the budget, the oldest sheets not used for 5 s and not kept are parked. */
function trim() {
  let bytes = 0;
  const t = now(), spare = [];
  for (const j of jobs.values()) if (j.phase === 'ready') { bytes += j.bytes; if (!keep.has(j.key) && !retained.has(j.key) && t - lastUse(j) > 5000) spare.push(j); }
  spare.sort((a, b) => lastUse(a) - lastUse(b));
  while (bytes > BUDGET && spare.length) {
    const j = spare.shift(), src = sourceOf(sheets.get(j.key));
    if (!src || src.destroyed) continue;
    try { park(j, src); } catch { continue; }
    bytes -= j.bytes;
  }
  if (bytes > BUDGET && !trimTimer) { trimTimer = setTimeout(() => { trimTimer = null; trim(); }, 5100); trimTimer?.unref?.(); }   // unref: a test run is not held open
}

/** What the loader holds (1.7 atlasLoadDiagnostics), for probes. */
export function artLoadState() {
  const files = [], failures = [];
  let bytes = 0;
  for (const j of jobs.values()) {
    files.push({ sheet: j.key, phase: j.phase, bytes: j.bytes, parked: !!j.reload, background: j.background });
    if (j.phase === 'ready') bytes += j.bytes;
    if (j.error) failures.push({ sheet: j.key, message: j.error.message });
  }
  return { active, backgroundActive, queued: queue.length, residentBytes: bytes, budgetBytes: BUDGET, maxActive: MAX_ACTIVE, failures, files };
}


/** Dev: loads a sheet from any served path under a name, with crisp (nearest) pixels for pixel art. */
export async function loadSheetAt(url, key) {
  if (sheets.has(key)) return;
  const s = await Assets.load(url);
  s.textureSource.scaleMode = 'nearest';
  sheets.set(key, s);
}

const parkedSources = new WeakSet();
// The store's answers (render/art-store.js): a sheet asked for counts as used and wakes if parked; a parked picture is
// not readable on the CPU and is asked for again; render's own loads come here.
artStore.plugLoader({
  touch: name => { const j = jobs.get(name); if (j) { j.used = now(); if (j.phase === 'parked') wake(j); } },
  parked: src => parkedSources.has(src),
  wake: src => { for (const j of jobs.values()) if (j.reload === src) { wake(j); break; } },
  loadSheet: (path, o) => loadSheet(path, o),
  loadGroup: (name, o) => loadGroup(name, o),
  retainArt: paths => retainArt(paths),
  alsoLoad: (group, path) => alsoLoad(group, path),
});
