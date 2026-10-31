// Creatures from data/monsters.json (spec/monsters.md): one row becomes one body on the floor.

import monsters from '../../data/monsters.json' with { type: 'json' };
import { bodySheet } from '../data/sheets.js';

// C2 (consolidation 2026-10-18, engine-rules-06): a body's id is kind-serial from the game's own counter,
// state.nextBodyId, which saves with it, so a reload never hands out an id a live body has. The engine binds its state
// around every step and floor build (bodyIds); a body made outside any game (a test, a tool) counts on LOOSE.
const LOOSE = { nextBodyId: 1 };
let ids = LOOSE;

/** Runs fn with makeCreature counting on state.nextBodyId; an old save starts it past its highest id. */
export function bodyIds(state, fn) {
  if (state.nextBodyId == null) state.nextBodyId = highestBodyId(state) + 1;
  const outer = ids;
  ids = state;
  try { return fn(); } finally { ids = outer; }
}

/** The highest number ending a body id the state holds: on this floor and on every floor it keeps. */
export function highestBodyId(state) {
  let n = 0;
  const see = a => { const m = /-(\d+)$/.exec(a?.id ?? ''); if (m) n = Math.max(n, Number(m[1])); };
  for (const a of Object.values(state.actors ?? {})) see(a);
  for (const kept of Object.values(state.stored ?? {})) for (const c of kept?.creatures ?? []) see(c);
  return n;
}

export const monsterRow = id => {
  const r = monsters.rows[id];
  if (!r) throw new Error('unknown monster ' + id);
  return r;
};

/** A new creature of kind `id` at (x, y). `asleep` follows spec/world.md W43. */
export function makeCreature(id, x, y, { asleep = false, idSuffix } = {}) {
  const r = monsterRow(id);
  let n = ids.nextBodyId++;
  while (ids.actors?.[`${id}-${n}`]) n = ids.nextBodyId++;   // an id set by hand (the test room's) is never handed out again
  return {
    id: `${id}-${idSuffix ?? n}`, kind: id, name: r.name, side: 'foe', x, y, t: 0,
    hp: r.hp, maxhp: r.hp, dmg: [...r.dmg], acc: r.acc, eva: r.eva, armour: r.armour ?? 0, speed: r.speed ?? 100,
    range: r.range ?? 1, xp: r.xp ?? 10, noXp: !!r.noXp, element: r.element ?? null, flags: r.flags ?? [], behaviour: r.behaviour ?? 'hunter',
    boss: (r.flags ?? []).includes('boss'), undead: (r.flags ?? []).includes('undead'), shadowy: (r.flags ?? []).includes('shadowy'),
    look: { sheet: bodySheet(r.look), art: r.look.art, ...(r.look.bigScale ? { bigScale: r.look.bigScale } : {}), ...(r.look.facesLeft ? { facesLeft: true } : {}) }, sfx: r.sfx ?? null, drops: r.drops ?? null,
    family: r.family ?? null, caller: !!r.caller, abilityScale: r.abilityScale ?? 1, params: r.params ?? null, moves: r.moves ?? null, passives: r.passives ?? null,
    statuses: {}, hunting: false, asleep, caughtOff: -1,
    ...(r.conceal?.rule === 'until-revealed' ? { unseen: true, hidden: true } : {}),   // X10, item 287: unseen until it acts (ai.js)
  };
}

/** CD27 (1.7 data.js:14-18): "the Goblin", "an Emberling"; a name with its own article or a proper name stands alone
 * ("The Emberlord", "Grukk the Warchief"). */
const nameAlone = n => /^The | the /.test(n ?? '');
export const theName = n => (nameAlone(n) ? n : 'the ' + n);
export const capFirst = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** A chaos creature as the floor keeps it (chaos 58): asleep, on its island, its first special a game turn away. */
export function chaosBody(kind, x, y, region, o = {}) {
  const c = makeCreature(kind, x, y, { asleep: o.asleep ?? true });
  Object.assign(c, { immune: monsterRow(kind).immune ?? [], set: 'chaos', chaos: true, region, chaosWait: o.wait ?? 100, group: o.group ?? null });
  if (o.offspring) { c.offspring = true; c.drops = null; c.owner = o.owner ?? null; }
  return c;
}

// ---- body factories (consolidation C5; engine-rules-15, engine-rules-30, world-16)

/**
 * One limb of a big body (bosses.md decided 7: limbs pass every hit to the body): an unkillable, never-acting object
 * on one of the body's other cells, named for it, marked limbOf. i numbers it; eva and immune as the body needs.
 */
export function makeLimb(owner, i, at, { kind, set, eva = 0, immune = null } = {}) {
  return { id: `${owner.id}-limb-${i}`, kind, name: owner.name, side: 'foe', limbOf: owner.id, x: at.x, y: at.y, t: 1e15, hp: 1e9, maxhp: 1e9,
    dmg: [0, 0], acc: 0, eva, armour: owner.armour, speed: 100, flags: ['object'], set, statuses: {}, look: null, hidden: true, noXp: true,
    drops: null, hunting: false, ...(immune ? { immune } : {}) };
}

