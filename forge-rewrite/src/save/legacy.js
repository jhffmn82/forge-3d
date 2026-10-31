// EP44 (1.7 save.js importLegacySaves, packet H save-import): what the earlier build kept in this browser carries over.
// Its settings (key binds, sound, lighting, map zoom, map art, ambient motion, animation speed) are copied once into
// this build's options, each only where this build has no choice of its own yet; its journal and finished runs are
// read beside this build's own every time (journal.js), only ever adding. 1.7's runs in progress are not converted:
// that build made its floors another way, so a run cannot continue here.

import { KEYS } from './keys.js';

const FLAG = KEYS.legacy, OPTIONS = KEYS.options;   // save/slots.js owns the keys (C15)
export const LEGACY = { journal: 'astra-temple-journal', runs: 'astra-temple-run-history' };

/** 1.7's bind ids (keybind.js BIND_ACTIONS) and this build's actions (data/bindings.json). */
const BIND = {
  up: 'move-n', down: 'move-s', left: 'move-w', right: 'move-e', ul: 'move-nw', ur: 'move-ne', dl: 'move-sw', dr: 'move-se',
  wait: 'wait', rest: 'rest', search: 'search', explore: 'explore', grab: 'pickup', stairs: 'descend', upstairs: 'ascend', close: 'close-door',
  h1: 'hotbar-1', h2: 'hotbar-2', h3: 'hotbar-3', h4: 'hotbar-4', h5: 'hotbar-5', h6: 'hotbar-6', h7: 'hotbar-7', h8: 'hotbar-8',
  char: 'character', gear: 'inventory', faith: 'faith', map: 'map', mute: 'mute', music: 'music',
};
const nearest = (v, list) => list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
const get = (storage, key) => { try { return storage.getItem(key); } catch { return null; } };
// 1.7 copied the original game's fote-* settings into its astra-temple-* keys once (save.js importLegacySaves); a
// browser that never ran 1.7 still has only the fote-* ones, so a setting falls back to its fote-* key.
const read = (storage, key) => get(storage, key) ?? (key.startsWith('astra-temple-') ? get(storage, 'fote-' + key.slice(13)) : null);
const json = (storage, key) => { try { const raw = read(storage, key); return raw ? JSON.parse(raw) : null; } catch { return null; } };

/** 1.7's settings as this build's options ({} when it left none). */
export function legacyOptions(storage) {
  const out = {};
  const audio = json(storage, 'astra-temple-audio');
  if (audio && typeof audio === 'object') {
    if (typeof audio.muted === 'boolean') out.sound = !audio.muted;
    if (typeof audio.musicOn === 'boolean') out.music = audio.musicOn;
    const steps = [0, 25, 50, 75, 100];
    if (Number.isFinite(audio.vol?.sfx)) out.sfxVolume = nearest(audio.vol.sfx * 100, steps);
    if (Number.isFinite(audio.vol?.music)) out.musicVolume = nearest(audio.vol.music * 100, steps);
  }
  const light = read(storage, 'astra-temple-light');
  if (light === 'off') out.lighting = false;
  const zoom = read(storage, 'astra-temple-map-zoom');
  if (['far', 'normal', 'close', 'closest'].includes(zoom)) out.zoom = zoom;
  const art = read(storage, 'astra-temple-map-art');
  if (art === 'block') out.mapArt = 'blocks'; else if (art === 'sprite') out.mapArt = 'sprites';
  const motion = read(storage, 'astra-temple-motion');
  if (motion === 'auto' || motion === 'on' || motion === 'off') out.motion = motion === 'auto' ? 'auto' : motion === 'on';
  const speed = parseFloat(read(storage, 'astra-temple-anim-speed'));
  if (Number.isFinite(speed) && speed > 0) out.animSpeed = nearest(speed, [1, 1.5, 2, 3]);
  const binds = json(storage, 'astra-temple-binds');
  if (binds && typeof binds === 'object' && !Array.isArray(binds)) {
    const keys = {};
    for (const [id, key] of Object.entries(binds)) {
      if (!BIND[id] || typeof key !== 'string' || !key) continue;
      // 1.7 kept a main-row digit as the key itself; this build keeps the hotbar's digits by code (Digit1).
      keys[BIND[id]] = [/^[0-9]$/.test(key) ? 'Digit' + key : key];
    }
    if (Object.keys(keys).length) out.keys = keys;
  }
  return out;
}

/**
 * Once per browser: 1.7's settings join this build's options where this build has none. Returns how many were taken.
 * Call before the options are read.
 */
export function importLegacy(storage) {
  if (get(storage, FLAG)) return 0;
  const opts = json(storage, OPTIONS) ?? {};
  let n = 0;
  for (const [k, v] of Object.entries(legacyOptions(storage))) if (opts[k] === undefined) { opts[k] = v; n += 1; }
  try {
    if (n) storage.setItem(OPTIONS, JSON.stringify(opts));
    storage.setItem(FLAG, new Date().toISOString());
  } catch { /* storage blocked: tried again next time */ }
  return n;
}

/** 1.7's legacy run id (run-history.js legacyId) for a record kept before runs had one. */
function legacyId(r) {
  const src = JSON.stringify([r.name, r.race, r.cls, r.finishedAt || r.date, r.floor, r.level, r.turns, r.kills, r.score, r.won || r.victory]);
  let h = 2166136261;
  for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 16777619);
  return 'legacy-' + (h >>> 0).toString(36);
}

/** A 1.7 finished-run record in this build's shape (1.7 run-history.js normalize), or null. */
export function legacyRun(row, score, version) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const n = v => Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(v) || 0))), t = v => (typeof v === 'string' ? v : '');
  const r = { ...row };
  r.id = t(row.id) || t(row.runId) || legacyId(row);
  r.won = row.won === true || row.victory === true || row.outcome === 'victory';
  for (const k of ['name', 'race', 'cls', 'who', 'god', 'faith', 'biome', 'cause']) r[k] = t(row[k]);
  r.name ||= 'Unknown adventurer';
  r.finishedAt = t(row.finishedAt) || t(row.date);
  for (const k of ['level', 'kills', 'turns', 'bosses', 'faithRank', 'floor']) r[k] = n(row[k]);
  r.depth = Math.max(r.floor, n(row.depth));
  r.affinities = Array.isArray(row.affinities) ? row.affinities.filter(a => a && typeof a.element === 'string').map(a => ({ element: a.element, rank: n(a.rank) })) : [];
  if (Array.isArray(row.gear)) r.gear = row.gear.filter(g => g && typeof g.slot === 'string' && typeof g.name === 'string').map(g => ({ slot: g.slot, name: g.name }));
  else delete r.gear;
  const earned = Number.isFinite(row.xpGained) && Number.isFinite(row.essenceGained);
  if (Number.isFinite(row.score) && row.score >= 0) { r.score = Math.floor(row.score); r.scoreVersion = n(row.scoreVersion); }
  else if (earned) { r.score = score(r); r.scoreVersion = version; }
  else { r.score = 0; r.scoreVersion = 0; }
  return r;
}
