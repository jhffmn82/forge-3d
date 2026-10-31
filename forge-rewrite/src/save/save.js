// Saves: a versioned envelope around the game state. Storage is passed in, so this runs headless.
// G46, as 1.7 (js/engine/persistence.js:31-58): a slot is stored gzipped (fflate, UTF-16 bytes, base64, with its
// length and CRC checked on reading); when the browser's storage is full, the plain saves left in the other slots are
// compacted and the write is tried once more; a write that still fails is reported (saveProblem) so the game says so.
// Export and import stay plain JSON text.

import fflate from '../vendor/fflate-0.8.2.cjs';
import { rulesOwnFloors, lightsOwnRecord, replaceWebScenery } from '../engine/floors.js';
import { KEYS } from './keys.js';   // the keys (C15: save/slots.js owns them)
import { authoredCreatureBalance } from './balance.js';

export const SAVE_FORMAT = 'forge2-save';
export const SAVE_VERSION = 8;

/** Migrations by the version they upgrade from. 5: door materials and floor lights become the rules' (M3, render-02).
 *  6: every light a floor.lights entry, the Realm's relief palette floor.palette (W8).
 *  7: authored creature combat definitions replace saved depth formulas, preserving run state and Chaos. */
const MIGRATIONS = { 5: rulesOwnFloors, 6: lightsOwnRecord, 7: authoredCreatureBalance };

/** @param {any} state @param {string} label */
export function toSave(state, label) {
  return JSON.stringify({ format: SAVE_FORMAT, version: SAVE_VERSION, label, state });
}

/** @param {string} text @returns {any} the game state, or null when the text is not a save */
export function fromSave(text) {
  let env;
  try { env = JSON.parse(text); } catch { return null; }
  if (!env || env.format !== SAVE_FORMAT || typeof env.version !== 'number' || !env.state) return null;
  let { version, state } = env;
  if ((typeof __FORGE_PUBLIC__ !== 'undefined' && __FORGE_PUBLIC__) && state.sandbox) return null;   // sandbox saves remain usable in the local play build
  // Old development saves without terrain cannot be drawn. Keep the run unchanged and reject it before migration.
  const floors = [state.floor, ...Object.values(state.stored ?? {}).map(s => s?.floor)];
  if (floors.some(f => !f || !Array.isArray(f.ground) || f.ground.length !== f.w * f.h)) return null;
  while (version < SAVE_VERSION) {
    const up = MIGRATIONS[version];
    if (!up) return null;
    state = up(state);
    version += 1;
  }
  if (version !== SAVE_VERSION) return null;
  // Repair the old room-wide barrel spill using the broken barrel's saved position.
  for (const f of floors) for (const r of f.fields ?? []) {
    if (r.kind !== 'poison-trail' || r.until !== null || r.ooze || r.cells.length <= 9) continue;
    const cells = new Set(r.cells), barrels = (f.debris ?? []).filter(d => d.id === 'barrel-poison' && cells.has(d.y * f.w + d.x));
    if (!barrels.length) continue;
    r.cells = r.cells.filter(k => barrels.some(b => Math.abs(k % f.w - b.x) <= 1 && Math.abs(Math.floor(k / f.w) - b.y) <= 1));
  }
  for (const f of floors) {
    if (f.treasureRoom) f.biome = 'underdark';
    replaceWebScenery(f);
  }
  return state;
}

const STORAGE_FORMAT = 'forge2-gzip-1', MAX_BYTES = 128 * 1024 * 1024;
const SLOTS = ['auto', '1', '2', '3', 'sandbox'];
const CRC = new Uint32Array(256);
for (let i = 0; i < 256; i++) { let c = i; for (let n = 0; n < 8; n++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[i] = c; }
const crc32 = bytes => { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const u32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const toB64 = bytes => { const parts = []; for (let i = 0; i < bytes.length; i += 8192) parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 8192))); return btoa(parts.join('')); };
const fromB64 = text => { const s = atob(text), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; };

/** The text a slot stores: the save gzipped, or the plain text when packing would not make it smaller. */
export function packSave(raw) {
  if (raw.length * 2 > MAX_BYTES) throw new Error('Save is too large for browser storage.');
  const bytes = new Uint8Array(raw.length * 2);   // UTF-16 keeps every code unit, unusual names included
  for (let i = 0; i < raw.length; i++) { const c = raw.charCodeAt(i); bytes[i * 2] = c; bytes[i * 2 + 1] = c >>> 8; }
  const packed = JSON.stringify({ storage: STORAGE_FORMAT, encoding: 'utf16le', bytes: bytes.length, data: toB64(fflate.gzipSync(bytes, { level: 1, mtime: 0 })) });
  return packed.length < raw.length ? packed : raw;
}

/** A slot's stored text back to the save text; plain text passes through. Throws on a damaged or unknown pack. */
export function unpackSave(text) {
  if (!text.startsWith('{"storage"')) return text;
  const env = JSON.parse(text);
  if (env.storage !== STORAGE_FORMAT || env.encoding !== 'utf16le' || !Number.isInteger(env.bytes) || env.bytes < 0 || env.bytes > MAX_BYTES || env.bytes % 2) throw new Error('Unsupported compressed save.');
  const packed = fromB64(env.data);
  if (packed.length < 18 || u32(packed, packed.length - 4) !== env.bytes) throw new Error('Incomplete compressed save.');
  const bytes = fflate.gunzipSync(packed, { out: new Uint8Array(env.bytes) });
  if (bytes.length !== env.bytes || crc32(bytes) !== u32(packed, packed.length - 8)) throw new Error('Damaged compressed save.');
  const parts = [];
  for (let at = 0; at < bytes.length; at += 16384) {
    const codes = [];
    for (let i = at; i < Math.min(bytes.length, at + 16384); i += 2) codes.push(bytes[i] | (bytes[i + 1] << 8));
    parts.push(String.fromCharCode.apply(null, codes));
  }
  return parts.join('');
}

const quotaError = e => !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);

/** 1.7 compactStorage: packs the slots still stored as plain text (each setItem is atomic: a refused one keeps its bytes). */
export function compactSaves(storage) {
  let n = 0;
  for (const slot of SLOTS) {
    try {
      const raw = storage.getItem(KEYS.slot(slot));
      if (!raw || raw.startsWith('{"storage"')) continue;
      const packed = packSave(raw);
      if (packed.length < raw.length) { storage.setItem(KEYS.slot(slot), packed); n++; }
    } catch { /* a damaged or refused slot stays exactly as it was */ }
  }
  return n;
}

let problem = null;
/** Why the last saveTo failed: 'full' (the browser's storage quota), 'failed' (anything else), or null after a success. */
export const saveProblem = () => problem;

/**
 * @param {{getItem(k:string):string|null, setItem(k:string,v:string):void}} storage
 * @param {string} slot
 */
export function saveTo(storage, slot, state, label = '') {
  try {
    const packed = packSave(toSave(state, label));
    try { storage.setItem(KEYS.slot(slot), packed); } catch (e) { if (!quotaError(e)) throw e; compactSaves(storage); storage.setItem(KEYS.slot(slot), packed); }
    problem = null;
    return true;
  } catch (e) { problem = quotaError(e) ? 'full' : 'failed'; return false; }
}

export function loadFrom(storage, slot) {
  let text = null;
  try { text = storage.getItem(KEYS.slot(slot)); } catch { return null; }
  if (!text) return null;
  try { return fromSave(unpackSave(text)); } catch { return null; }
}
