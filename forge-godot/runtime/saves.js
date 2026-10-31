// The 3D build's saved runs: the 2D game's save envelope (forge-rewrite src/save/save.js toSave and fromSave: its
// format, version and migrations; save/slots.js's slot lines), kept as plain JSON in the store. save.js itself gzips
// with a CommonJS library QuickJS cannot load, and a run is 40 to 60 KB of JSON, which the store holds as it is.
import { rulesOwnFloors, lightsOwnRecord, replaceWebScenery } from '../../forge-rewrite/src/engine/floors.js';
import { authoredCreatureBalance } from '../../forge-rewrite/src/save/balance.js';
import { KEYS } from '../../forge-rewrite/src/save/keys.js';
import races from '../../forge-rewrite/data/races.json' with { type: 'json' };
import classes from '../../forge-rewrite/data/classes.json' with { type: 'json' };
import gods from '../../forge-rewrite/data/gods.json' with { type: 'json' };

export const SAVE_FORMAT = 'forge2-save';
export const SAVE_VERSION = 8;
export const SLOTS = ['auto', '1', '2', '3'];
const MIGRATIONS = { 5: rulesOwnFloors, 6: lightsOwnRecord, 7: authoredCreatureBalance };

export const toSave = (state, label = '') => JSON.stringify({ format: SAVE_FORMAT, version: SAVE_VERSION, label, state });

/** save.js fromSave: the game state of a save's text, migrated to this version, or null. */
export function fromSave(text) {
  let env;
  try { env = JSON.parse(text); } catch { return null; }
  if (!env || env.format !== SAVE_FORMAT || typeof env.version !== 'number' || !env.state) return null;
  let { version, state } = env;
  const floors = [state.floor, ...Object.values(state.stored ?? {}).map(s => s?.floor)];
  if (floors.some(f => !f || !Array.isArray(f.ground) || f.ground.length !== f.w * f.h)) return null;
  while (version < SAVE_VERSION) {
    const up = MIGRATIONS[version];
    if (!up) return null;
    state = up(state);
    version += 1;
  }
  for (const f of floors) {
    if (f.treasureRoom) f.biome = 'underdark';
    replaceWebScenery(f);
  }
  return state;
}

export function saveTo(storage, slot, state, label = '') {
  try { storage.setItem(KEYS.slot(slot), toSave(state, label)); storage.setItem(KEYS.at(slot), String(Date.now())); return true; } catch { return false; }
}

export function loadFrom(storage, slot) {
  let text = null;
  try { text = storage.getItem(KEYS.slot(slot)); } catch { return null; }
  return text ? fromSave(text) : null;
}

/** save/slots.js createSlots: each slot's line, the newest, the options and the tutorial's marks. */
export function createSlots(storage) {
  const tryDo = fn => { try { return fn(); } catch { return undefined; } };
  const slotInfo = id => {
    const g = loadFrom(storage, id);
    if (!g || (g.over && !g.won)) return null;
    const at = tryDo(() => Number(storage.getItem(KEYS.at(id))) || null) ?? null;
    const h = g.hero, god = h?.faith?.god ? gods.rows[h.faith.god]?.name.split(',')[0] : null;
    const who = h ? [races.rows[h.race]?.name, classes.rows[h.cls]?.name].filter(Boolean).join(' ') : '';
    const label = h ? [h.name, who, `level ${h.level ?? 1}`, `floor ${g.floorNo}`, god].filter(Boolean).join(' · ') : `floor ${g.floorNo}`;
    return { label, line: h ? `${h.name} · level ${h.level ?? 1} · floor ${g.floorNo}` : label, savedAt: at, won: !!g.won };
  };
  return {
    slotInfo,
    newestSlot() {
      let best = null;
      for (const id of SLOTS) { const s = slotInfo(id); if (s && !s.won && (!best || (s.savedAt ?? 0) > (best.s.savedAt ?? 0))) best = { id, s }; }
      return best;
    },
    stamp: id => tryDo(() => storage.setItem(KEYS.at(id), String(Date.now()))),
    remove: (id, { stamp = true } = {}) => tryDo(() => { storage.removeItem(KEYS.slot(id)); if (stamp) storage.removeItem(KEYS.at(id)); return true; }) ?? false,
    readOptions: () => tryDo(() => JSON.parse(storage.getItem(KEYS.options) || '{}')) ?? {},
    writeOptions: opts => tryDo(() => storage.setItem(KEYS.options, JSON.stringify(opts))),
    tutorialOn: () => tryDo(() => storage.getItem(KEYS.tutorial) !== 'off') ?? true,
    setTutorial: on => tryDo(() => { if (on && storage.getItem(KEYS.tutorial) === 'off') storage.removeItem(KEYS.tutorialSeen); storage.setItem(KEYS.tutorial, on ? 'on' : 'off'); }),
    tutorialSeen: id => tryDo(() => JSON.parse(storage.getItem(KEYS.tutorialSeen) || '[]').includes(id)) ?? false,
    markTutorial: id => tryDo(() => { const seen = JSON.parse(storage.getItem(KEYS.tutorialSeen) || '[]'); if (!seen.includes(id)) storage.setItem(KEYS.tutorialSeen, JSON.stringify([...seen, id])); }),
    works: () => true,
  };
}
