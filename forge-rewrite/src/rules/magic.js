// Affinity, Fuse and the bar's grants (spec/magic.md D12, D34, D50, D51; forge.json fuse, core-infusion;
// elements.json affinity-rules; progression.json affinity-cap). Rows: elements.json (each element's spells by rank).

import elements from '../../data/elements.json' with { type: 'json' };
import progression from '../../data/progression.json' with { type: 'json' };
import abilities from '../../data/abilities.json' with { type: 'json' };
import races from '../../data/races.json' with { type: 'json' };
import gods from '../../data/gods.json' with { type: 'json' };
import { atForge } from './forge.js';

const E = elements.rows, RULE = E['affinity-rules'], CAP = progression.rows['affinity-cap'];
const GRANT_RANKS = abilities.rows['bar-order'].grantRanks;

/** A26: 1 + boss cores claimed + the race's cap bonus. */
export function affinityCap(state) {
  return CAP.base + CAP.perBossCore * (state.run?.cores ?? 0) + (races.rows[state.hero.race]?.affinityCapBonus ?? 0);
}

/** The held elements in the order gained; the first is primary (a race or court element counts first). */
export function elementOrder(hero) {
  const held = Object.keys(hero.affinity ?? {}).filter(k => hero.affinity[k] > 0);
  const order = (hero.elementOrder ?? []).filter(k => held.includes(k));
  for (const k of held) if (!order.includes(k)) order.push(k);
  return order;
}

/** D34, D50: every reason a mote of this element cannot be fused now, in the order they are told; none when it can. */
export function fuseRefusals(state, el) {
  const h = state.hero, aff = h.affinity ?? {}, order = elementOrder(h);
  if (!E[el] || E[el].kind !== 'element') return ['no-element'];
  const god = h.faith?.god && gods.rows[h.faith.god];
  const total = Object.values(aff).reduce((s, n) => s + n, 0) - (h.kindled ? 1 : 0);   // Kindled's Light is outside the cap
  return [god?.forbiddenElements?.includes(el) && 'forbidden', (h.motes?.[el] ?? 0) < 1 && 'no-mote', total >= affinityCap(state) && 'at-cap',
    (aff[el] ?? 0) >= RULE.maxPerElement && 'at-max', !order.includes(el) && order.length >= RULE.maxElements && 'third-element',
    order.some(k => E[k].opposite === el) && 'opposite', order.length && order[0] !== el && (aff[el] ?? 0) + 1 > (aff[order[0]] ?? 0) && 'passes-primary'].filter(Boolean);
}
export const fuseRefusal = (state, el) => fuseRefusals(state, el)[0] ?? null;

const SAY = {
  'not-at-forge': 'You must stand at the Forge.', forbidden: 'Your god forbids that element.', 'no-mote': 'You have no mote of that element.',
  'at-cap': 'Your affinity is at its cap. Claim a boss core to raise it.', 'at-max': 'That element is already at 6.',
  'third-element': 'You can hold only two elements.', opposite: 'That element opposes one you hold.',
  'passes-primary': 'Your second element cannot pass your first.', 'no-element': 'No such element.',
};

/** D12: the hero's abilities: the class's own, then each held element's spells at ranks 2, 4, 5, element by element. */
export function grantedSpells(hero) {
  const out = [];
  for (const el of elementOrder(hero)) for (const r of GRANT_RANKS) if ((hero.affinity[el] ?? 0) >= r && E[el].abilities?.[r]) out.push(E[el].abilities[r]);
  return out;
}

/** Adds any newly reached spells to the ability list, and each into the first empty hotbar slot (ruled Q28). */
export function grantSpells(state, events) {
  const h = state.hero;
  for (const id of grantedSpells(h)) {
    if (h.abilities.includes(id)) continue;
    h.abilities.push(id);
    const slot = h.hotbar?.findIndex(s => !s) ?? -1;
    if (slot >= 0) h.hotbar[slot] = { kind: 'ability', id };
    // G28, G40 (1.7 progression-adapter.js:61-72 announceLearned): 'Learned <b>X</b>.' with the new-ability chime; on a
    // full bar (the player's own slots stay, Q28) it says where to find the spell.
    const full = slot < 0 && Array.isArray(h.hotbar) ? ' Your hotbar is full: drag it on from the Character sheet.' : '';
    events.push({ type: 'log', words: `Learned <b>${abilities.rows[id]?.name ?? id}</b>.${full}`, cls: 'c-kill', sfx: 'new-ability' }, { type: 'ability-gained', id });
  }
}

/** D50: one mote for +1 affinity. The window asks "This cannot be undone." first. Returns a refusal or null; no game time. */
export function fuse(state, el, events) {
  const why = !atForge(state) && !state.coreInfusion ? 'not-at-forge' : fuseRefusal(state, el);
  if (why) { events.push({ type: 'log', words: SAY[why] }); return why; }
  state.hero.motes[el] -= 1;
  infuse(state, el, events);
  return null;
}

/** D50: a point of affinity in `el` (a fuse; the sandbox, item 180): the order gained, the line, and any spell it reaches. */
export function infuse(state, el, events) {
  const h = state.hero;
  h.affinity[el] = (h.affinity[el] ?? 0) + 1;
  h.elementOrder = elementOrder(h);
  events.push({ type: 'fused', element: el, affinity: h.affinity[el], sfx: 'forge-fuse' }, { type: 'log', words: `${E[el].name} affinity ${h.affinity[el]}.` });
  grantSpells(state, events);
}

/** The sandbox's -1 (item 180; play never lowers affinity): the point goes, and each element spell it no longer reaches. */
export function loseAffinity(state, el, events) {
  const h = state.hero;
  if (!(h.affinity?.[el] > 0)) return;
  if (!--h.affinity[el]) delete h.affinity[el];
  h.elementOrder = elementOrder(h);
  const kept = new Set(grantedSpells(h)), spells = new Set(Object.values(E).flatMap(r => Object.values(r?.abilities ?? {})));
  for (const id of h.abilities.filter(id => spells.has(id) && !kept.has(id))) {
    h.abilities.splice(h.abilities.indexOf(id), 1);
    h.hotbar = h.hotbar?.map(s => (s?.kind === 'ability' && s.id === id ? null : s));
    events.push({ type: 'log', words: `Forgot <b>${abilities.rows[id]?.name ?? id}</b>.` });
  }
  events.push({ type: 'log', words: `${E[el].name} affinity ${h.affinity[el] ?? 0}.` });
}
