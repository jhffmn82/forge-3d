// Version 7 -> 8: replace saved creature combat definitions with the authored balance pass once, at load.
// Positions, clocks, wounds, statuses, encounter restrictions and custom summons remain the run's own state.
import monsters from '../../data/monsters.json' with { type: 'json' };
import puzzles from '../../data/puzzles.json' with { type: 'json' };
import { applyHero } from '../engine/game.js';

const ROWS = monsters.rows;
const chaosKind = kind => /^(chaos-|unmaker-)/.test(kind ?? '');
const isChaos = a => a.chaos || a.set === 'chaos' || a.set === 'unmaker' || chaosKind(a.kind);
const customAlly = a => a.side === 'ally' && (a.summon || a.summoned || a.shade || a.servant || a.graveBase);
const passiveKey = p => `${p.verb}:${p.trigger ?? ''}`;

function refresh(saved, current, key) {
  if (!Array.isArray(saved)) return saved;
  return saved.map((old, i) => {
    const row = current?.[i] && key(current[i]) === key(old) ? current[i] : current?.find(r => key(r) === key(old));
    return row ? structuredClone(row) : old;
  });
}

/** Keep damage already taken; reducing maximum HP must never revive or kill a body during load. */
function maximum(a, hp) {
  const lost = Math.max(0, a.maxhp - a.hp);
  a.hp = a.hp > 0 ? Math.max(1, hp - lost) : a.hp;
  a.maxhp = hp;
}

function creature(a) {
  const row = ROWS[a?.kind];
  if (!row || a.side === 'player' || a.echo || a.limbOf || isChaos(a) || customAlly(a)) return;
  a.dmg = [...row.dmg]; a.acc = row.acc;
  if ('moves' in a) a.moves = refresh(a.moves, row.moves, m => m.id);
  if ('passives' in a) a.passives = refresh(a.passives, row.passives, passiveKey);
  const hpAtScale = hp => Math.max(1, Math.round(hp * (a.sbScale ?? 1)));
  if (a.sentinelRoom) {
    const s = puzzles.rows.sentinels.sentinel;
    maximum(a, hpAtScale(s.hp)); a.dmg = [...s.dmg]; a.acc = s.acc;
  } else if (a.kind === 'slime' && a.maxhp === hpAtScale(32) && a.name === row.name && !a.elite && !a.summon && !a.summoned && !a.id?.includes('-split-')) {
    maximum(a, hpAtScale(row.hp));
  }
}

/** Find field definitions nested under a move, telegraph or event. */
function fieldsIn(value, out = []) {
  if (!value || typeof value !== 'object') return out;
  if (value.verb === 'field') out.push(value);
  for (const child of Object.values(value)) fieldsIn(child, out);
  return out;
}

function fields(floor, byId) {
  for (const f of floor.fields ?? []) {
    if (f.kind === 'gas' && f.puzzleDoor && !f.byPlayer) {
      const gas = puzzles.rows.poisonvault.hazards[0].effects[0];
      for (const e of f.each ?? []) if (e.verb === 'damage' && e.type === gas.type) e.amount = structuredClone(gas.amount);
      continue;
    }
    if (f.byPlayer || !f.owner) continue;
    const owner = byId.get(f.owner);
    if (owner && (owner.side !== 'foe' || owner.echo || isChaos(owner))) continue;
    // A dead source can already have left the actor map; makeCreature IDs retain its exact kind prefix.
    const kind = owner?.kind ?? Object.keys(ROWS).find(k => f.owner.startsWith(k + '-'));
    if (!kind || !ROWS[kind] || chaosKind(kind)) continue;
    const row = ROWS[kind], fieldKind = kind === 'sporecaller' && f.kind === 'spore-field' ? 'spores' : f.kind;
    const source = fieldsIn([row.moves, row.passives]).find(e => e.field === fieldKind);
    if (!source) continue;
    for (const key of ['each', 'eachOnce', 'enter']) if (Array.isArray(source[key])) {
      f[key] = source[key].map((e, i) => {
        const copy = structuredClone(e), old = f[key]?.[i];
        // Crypt gas adds its undead/object/beetle immunity when laid; keep that runtime condition.
        if (!copy.if && old?.if && old.verb === e.verb) copy.if = old.if;
        return copy;
      });
    }
  }
}

export function authoredCreatureBalance(state) {
  // A field can outlive its owner's stay on this floor (for example, an ally falling through a pit).
  const owners = new Map([
    ...Object.values(state.actors ?? {}), state.floor?.maw?.body,
    ...Object.values(state.stored ?? {}).flatMap(kept => [...(kept?.creatures ?? []), kept?.floor?.maw?.body]),
    ...Object.values(state.fallen ?? {}).flat(),
  ].filter(Boolean).map(a => [a.id, a]));
  const migrate = (floor, bodies) => {
    if (!floor || floor.chaos || floor.biome === 'chaos') return;
    const all = [...bodies, floor.maw?.body].filter(Boolean);
    for (const a of new Set(all)) creature(a);
    fields(floor, owners);
  };
  migrate(state.floor, Object.values(state.actors ?? {}));
  for (const kept of Object.values(state.stored ?? {})) migrate(kept?.floor, kept?.creatures ?? []);
  for (const [floorNo, bodies] of Object.entries(state.fallen ?? {})) if (Number(floorNo) < 21) for (const a of bodies) creature(a);
  // Refresh cached equipment values through the same path as an equip, without refilling HP, mana or shields.
  if (state.hero && state.actors?.[state.playerId]) applyHero(state);
  return state;
}
