// The run's own record (1.7 run-history.js snapshot/score, death-adapter.js RUN.kills, progression-adapter.js
// earnings): kills, the bosses beaten, the deepest floor, the XP and essence earned, what killed the hero. The end
// screen, the Journal's Previous runs and the achievements read it. It lives in state.stats and saves with the run.

import gods from '../../data/gods.json' with { type: 'json' };
import classes from '../../data/classes.json' with { type: 'json' };
import races from '../../data/races.json' with { type: 'json' };
import { itemRow } from './items.js';

export const SCORE_VERSION = 3;
const BOSS_FLOORS = [5, 10, 15, 20];
const BIOME_NAMES = { dungeon: 'Dungeon', crypt: 'Crypt', caverns: 'Caverns', underdark: 'Underdark', chaos: 'Realm of Chaos' };

/** The run's tallies, made on first use (a save from before them starts at zero). */
export function stats(state) {
  return state.stats ??= { kills: 0, xp: 0, essence: 0, deepest: state.floorNo ?? 1, bossFloors: {}, slain: {}, cause: '' };
}

/** Adds to one tally: 'kills', 'xp', 'essence'. */
export function tally(state, key, n = 1) {
  if (!(n > 0)) return;
  const s = stats(state);
  s[key] = (s[key] ?? 0) + n;
}

/** The hero stands on a floor: the deepest one counts (planes share their floor's number). */
export function noteFloor(state) {
  const s = stats(state);
  if (state.floorNo > s.deepest) s.deepest = state.floorNo;
}

/** A foe died. The hero's kill counts it and its kind (the bestiary); a boss on its floor is beaten whoever killed it. */
export function noteKill(state, actor, playerSide) {
  const s = stats(state);
  if (playerSide) { s.kills += 1; if (actor.kind) s.slain[actor.kind] = (s.slain[actor.kind] ?? 0) + 1; }
  if (actor.boss && BOSS_FLOORS.includes(state.floorNo) && !state.floor?.plane) s.bossFloors[state.floorNo] = true;
}

const CAUSES = { starvation: 'Starvation', fall: 'Falling into a chasm', drowning: 'Drowning', sacrifice: 'A blood sacrifice', spikes: 'A spiked door', thorns: 'Thorns', curse: 'A cursed item', bleed: 'Bleeding', burn: 'Burning', poison: 'Poison', lava: 'Lava' };
const TYPE_WORD = { phys: 'physical', dark: 'shadow', ice: 'frost' };

/**
 * EP38 (1.7 run-history.js damageCause): the hero died; what did it, in a few words. A named cause first (Starvation,
 * Burning), then the source and the damage ("Goblin (physical damage)", "Reflected fire damage from Imp"), then the
 * damage alone ("Fire damage").
 */
export function noteDeath(state, by, tags = [], cause = null, type = null) {
  stats(state).cause = deathCause(by, tags, cause, type);
}
// Item 90: the same cause as the log says it, "You have been killed by <killer>.".
const KILLED_BY = { starvation: 'starvation', fall: 'a fall into a chasm', drowning: 'drowning', sacrifice: 'a blood sacrifice', spikes: 'a spiked door', thorns: 'thorns', curse: 'a cursed item', bleed: 'bleeding', burn: 'burning', poison: 'poison', lava: 'lava', explosion: 'an explosion', wrath: 'divine wrath' };
const TRAP_WORDS = { dart: 'a dart trap', web: 'a web', alarm: 'an alarm', fire: 'a fire vent', frost: 'a frost jet', spark: 'a spark plate', teleport: 'a teleport rune', gas: 'a gas vent', pit: 'a pit', spikes: 'a spike trap' };
const article = n => (/^[aeiou]/i.test(n) ? 'an ' : 'a ') + n;
export function killedBy(by, tags = [], cause = null, type = null) {
  if (typeof cause === 'string' && cause.startsWith('trap:')) return TRAP_WORDS[cause.slice(5)] ?? 'a trap';
  const key = Object.keys(KILLED_BY).find(k => tags.includes(k) || cause === k);
  if (key) return KILLED_BY[key];
  if (by && by.side !== 'player' && by.name) return by.boss || /^The /.test(by.name) ? by.name : article(by.name.toLowerCase());
  return `${TYPE_WORD[type] ?? type ?? 'unknown'} damage`;
}
export function deathCause(by, tags = [], cause = null, type = null) {
  const key = Object.keys(CAUSES).find(k => tags.includes(k) || cause === k);
  if (key) return CAUSES[key];
  const label = TYPE_WORD[type] ?? type ?? 'unknown', source = by && by.side !== 'player' ? by.name ?? '' : '';
  if (tags.includes('reflected')) return `Reflected ${label} damage${source ? ' from ' + source : ''}`;
  if (source) return `${source} (${label} damage)`;
  return `${label[0].toUpperCase()}${label.slice(1)} damage`;
}

/** The bosses beaten: every boss floor the hero went below, the one beaten on its floor, the Unmaker on a win. */
export function bossCount(state) {
  const s = stats(state), beaten = new Set(Object.keys(s.bossFloors).map(Number));
  for (const n of BOSS_FLOORS) if (s.deepest > n) beaten.add(n);
  if (state.won) beaten.add(25);
  return beaten.size;
}

/** 1.7's score (version 3): (XP + essence earned) / turns x deepest floor x (1 + level / 20) x (1 + god rank / 5), doubled for a win. */
export function score(r) {
  const n = v => Math.max(0, Math.floor(Number(v) || 0));
  const total = (n(r.xpGained) + n(r.essenceGained)) / Math.max(1, n(r.turns)) * n(r.depth) * (1 + n(r.level) / 20) * (1 + n(r.faithRank) / 5) * (r.won ? 2 : 1);
  return Math.min(Number.MAX_SAFE_INTEGER, Math.round(total));
}

const GEAR_SLOTS = [['main', 'Main hand'], ['off', 'Off hand'], ['ranged', 'Ranged weapon'], ['armour', 'Armor'], ['ring1', 'Ring 1'], ['ring2', 'Ring 2'], ['amulet', 'Amulet']];

const rowName = it => { try { return itemRow(it.id).row.name; } catch { return it.id; } };

/** The run as one finished record (1.7 snapshot): who, how deep, how it ended, its score. `nameOf` names worn gear. */
export function runRecord(state, won = !!state.won, nameOf = rowName) {
  const h = state.hero ?? {}, s = stats(state), faith = h.faith?.god ? h.faith : null;
  noteFloor(state);
  state.runId ??= `run-${(state.seed >>> 0).toString(36)}-${Date.now().toString(36)}`;
  const r = {
    id: state.runId, name: h.name || 'Adventurer',
    who: [races.rows[h.race]?.name, classes.rows[h.cls]?.name].filter(Boolean).join(' '),
    race: h.race ?? '', cls: h.cls ?? '', level: h.level ?? 1, floor: state.floorNo, depth: s.deepest,
    xpGained: s.xp, essenceGained: s.essence, kills: s.kills, turns: state.actions ?? 0, bosses: bossCount(state),
    god: faith?.god ?? '', faith: faith ? gods.rows[faith.god]?.name?.split(',')[0] ?? faith.god : 'No patron', faithRank: faith?.rank ?? 0,
    affinities: Object.entries(h.affinity ?? {}).filter(([, v]) => v > 0).map(([element, rank]) => ({ element, rank })),
    gear: GEAR_SLOTS.map(([slot, label]) => h.worn?.[slot]?.id ? { slot: label, name: nameOf(h.worn[slot]) } : null).filter(Boolean),
    slain: { ...s.slain }, cause: won ? '' : s.cause, won, finishedAt: new Date().toISOString(), sandbox: !!state.sandbox,
    biome: BIOME_NAMES[state.where] ?? '',
  };
  r.score = score(r); r.scoreVersion = SCORE_VERSION;
  return r;
}

const cap = v => { v = String(v ?? '').replace(/[\r\n\t]+/g, ' '); return v ? v[0].toUpperCase() + v.slice(1) : 'Not recorded'; };
const flat = v => String(v ?? '').replace(/[\r\n\t]+/g, ' ');

/**
 * CSS-20 (1.7 run-history.js breakdown, score version 3): how the score was earned, as label and value rows and the
 * sentence under them.
 */
export function scoreBreakdown(r) {
  const n = v => Math.max(0, Math.floor(Number(v) || 0));
  const x = v => `×${Math.round(v * 100) / 100}`;
  return {
    rows: [
      ['Total XP earned', n(r.xpGained)], ['Total essence earned', n(r.essenceGained)], ['Turns', n(r.turns)],
      ['Deepest floor reached', n(r.depth)], ['Character level', n(r.level)], ['God rank', n(r.faithRank)],
      ['Level multiplier', x(1 + n(r.level) / 20)], ['God rank multiplier', x(1 + n(r.faithRank) / 5)], ['Victory multiplier', x(r.won ? 2 : 1)],
    ],
    words: 'Add the XP and essence you earned, divide by turns, multiply by the deepest floor, then multiply by (1 + character level / 20) and (1 + god rank / 5). A win doubles the total. Spending essence never lowers your score.',
  };
}

/**
 * CSS-20 (1.7 run-history.js report): the run as plain text to copy and share. `achievements` is the journal's list
 * ({name, text, have}); without it the closing tally is left out.
 */
export function reportText(r, achievements = null, version = '') {
  const rows = [
    `Forge of the Elements${version ? ` · ${flat(version)}` : ''} · Run report`,
    `${flat(r.name)}: ${r.won ? 'Victory' : 'Fallen'}${r.sandbox ? ' (sandbox)' : ''}`,
    `Build: ${flat(r.who) || `${cap(r.race)} ${cap(r.cls)}`}`,
    `Race: ${cap(races.rows[r.race]?.name ?? r.race)} | Class: ${cap(classes.rows[r.cls]?.name ?? r.cls)} | Level: ${r.level}`,
    `Affinities: ${r.affinities?.length ? r.affinities.map(a => `${cap(a.element)} ${a.rank}`).join(', ') : 'None recorded'}`,
    `Patron: ${flat(r.faith || r.god || 'No patron')}${r.faithRank ? ` (rank ${r.faithRank})` : ''}`,
    `Deepest floor: ${r.depth} | Final floor: ${r.floor}${r.biome ? ` (${flat(r.biome)})` : ''}`,
    `Kills: ${r.kills} | Bosses: ${r.bosses} | Turns: ${r.turns}`,
    `Score: ${r.score ?? 'Not recorded'}`,
  ];
  if (!r.won) rows.push(`Cause of death: ${flat(r.cause) || 'Not recorded'}`);
  rows.push('Gear:');
  if (!r.gear) rows.push('  Not recorded for this older run.');
  else if (!r.gear.length) rows.push('  None');
  else for (const g of r.gear) rows.push(`  ${flat(g.slot)}: ${flat(g.name)}`);
  if (r.finishedAt) rows.push(`Finished: ${flat(r.finishedAt)}`);
  if (Array.isArray(achievements)) {
    const earned = achievements.filter(a => a.have);
    rows.push('', `Current browser-wide achievements (across all runs): ${earned.length} / ${achievements.length}`);
    if (!earned.length) rows.push('  None earned yet.');
    for (const a of earned) rows.push(`  ${flat(a.name)}: ${flat(a.text)}`);
  }
  return rows.join('\n');
}

