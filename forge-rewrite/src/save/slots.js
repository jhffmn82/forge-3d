// What the browser keeps for the game (consolidation C15, moved from main.js): every storage key in one place, the slot
// summaries the title shows, Continue's newest slot, the options and the tutorial preference. save.js packs a run;
// this module names where it goes. Storage may be blocked: every read and write survives that.

import races from '../../data/races.json' with { type: 'json' };
import classes from '../../data/classes.json' with { type: 'json' };
import gods from '../../data/gods.json' with { type: 'json' };
import { loadFrom } from './save.js';
import { KEYS } from './keys.js';

export { KEYS };

export const SLOTS = ['auto', '1', '2', '3'];

export function createSlots(storage) {
  const tryDo = fn => { try { return fn(); } catch { return undefined; } };
  const slotInfo = id => {
    const g = loadFrom(storage, id);
    if (!g || (g.over && !g.won)) return null;   // a dead run (saved before C81 was kept) is never offered
    const at = tryDo(() => Number(storage.getItem(KEYS.at(id))) || null) ?? null;
    // EP43 (1.7 slotSummary, save.js:213-218): name, race and class, level, floor and the sworn god's short name; the
    // Continue plate keeps 1.7's shorter line (name, level, floor).
    const h = g.hero, god = h?.faith?.god ? gods.rows[h.faith.god]?.name.split(',')[0] : null;
    const who = h ? [races.rows[h.race]?.name, classes.rows[h.cls]?.name].filter(Boolean).join(' ') : '';
    const label = h ? [h.name, who, `level ${h.level ?? 1}`, `floor ${g.floorNo}`, god].filter(Boolean).join(' · ') : `floor ${g.floorNo}`;
    return { label, line: h ? `${h.name} · level ${h.level ?? 1} · floor ${g.floorNo}` : label, savedAt: at, won: !!g.won };
  };
  return {
    slotInfo,
    /** EP40 (1.7 latestSave, save.js:313-317): Continue takes the newest save of any slot; item 80: never a won run. */
    newestSlot() {
      let best = null;
      for (const id of SLOTS) { const s = slotInfo(id); if (s && !s.won && (!best || (s.savedAt ?? 0) > (best.s.savedAt ?? 0))) best = { id, s }; }
      return best;
    },
    /** When a slot was saved (the title shows it). */
    stamp: id => tryDo(() => storage.setItem(KEYS.at(id), String(Date.now()))),
    /** A slot gone: its run and, with stamp, when it was saved. */
    remove: (id, { stamp = true } = {}) => tryDo(() => { storage.removeItem(KEYS.slot(id)); if (stamp) storage.removeItem(KEYS.at(id)); return true; }) ?? false,
    readOptions: () => tryDo(() => JSON.parse(storage.getItem(KEYS.options) || '{}')) ?? {},
    writeOptions: opts => tryDo(() => storage.setItem(KEYS.options, JSON.stringify(opts))),
    /** The tutorial preference (1.7 fote-tutorial-enabled-v1): creation's Tutorial plate and a card's Don't show again. */
    tutorialOn: () => tryDo(() => storage.getItem(KEYS.tutorial) !== 'off') ?? true,
    /** Turning tutorials back on shows every card again (Justin 2026-10-21: "A: once ever on this device; turning the
     * Tutorial plate back on shows them all again."). */
    setTutorial: on => tryDo(() => { if (on && storage.getItem(KEYS.tutorial) === 'off') storage.removeItem(KEYS.tutorialSeen); storage.setItem(KEYS.tutorial, on ? 'on' : 'off'); }),
    /** The tutorial cards this device has shown, each once ever (hud/tips.js). */
    tutorialSeen: id => tryDo(() => JSON.parse(storage.getItem(KEYS.tutorialSeen) || '[]').includes(id)) ?? false,
    markTutorial: id => tryDo(() => { const seen = JSON.parse(storage.getItem(KEYS.tutorialSeen) || '[]'); if (!seen.includes(id)) storage.setItem(KEYS.tutorialSeen, JSON.stringify([...seen, id])); }),
    /** RB11 (1.7 RUN.historySaved): whether this browser keeps anything at all. */
    works: () => tryDo(() => { storage.setItem(KEYS.probe, '1'); storage.removeItem(KEYS.probe); return true; }) ?? false,
  };
}
