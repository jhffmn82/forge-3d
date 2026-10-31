// The player's record across runs, kept in this browser apart from the saves (1.7 js/persistence/journal.js and
// run-history.js): the deepest floor and best level, element paths, god ranks, bosses, combinations, enchantments,
// sigils and creatures found, every finished run, and the 89 achievements read from them with 1.7's titles and
// reveal rule (a locked one shows only once it has progress and the one before it is earned).

import { score, SCORE_VERSION } from '../engine/reads.js';   // C17: the rules' answers through the engine (PLAN section 2)
import { LEGACY, legacyRun } from './legacy.js';
import rings from '../../data/rings.json' with { type: 'json' };
import amulets from '../../data/amulets.json' with { type: 'json' };
import offhands from '../../data/offhands.json' with { type: 'json' };
import prayers from '../../data/prayers.json' with { type: 'json' };
import gods from '../../data/gods.json' with { type: 'json' };
import { KEYS } from './keys.js';

const KEY = KEYS.journal, RUNS = KEYS.runs, VERSION = 1;   // save/slots.js owns the keys (C15)
const COUNTS = ['highestDepth', 'maxLevel'], RANKS = ['paths', 'godRanks'];
// G43 (1.7 journal.js DISCOVERIES): rings and amulets learned, planes entered and god abilities used are kept too, for
// the Encyclopedia's locked entries; 1.7's own journal carries them over.
const FLAGS = ['bosses', 'combos', 'enchantments', 'sigils', 'wins', 'raceWins', 'rings', 'amulets', 'planes', 'godAbilities'];
const RACES = ['human', 'elf', 'dwarf', 'fae', 'gloomling'], CLASSES = ['fighter', 'cleric', 'mage', 'scoundrel', 'tourist'];
export const ELEMENTS = ['fire', 'water', 'air', 'earth', 'light', 'shadow'];
const OPPOSITE = { fire: 'water', water: 'fire', air: 'earth', earth: 'air', light: 'shadow', shadow: 'light' };
const count = v => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(n))) : 0; };
const validKey = v => typeof v === 'string' && v.length > 0 && v.length <= 160 && !['__proto__', 'constructor', 'prototype'].includes(v);

/** An empty journal. `enemies` counts kills per kind (1.7 kept only a flag; the bestiary shows the count). */
export function emptyJournal() {
  const d = { version: VERSION, highestDepth: 0, maxLevel: 0, enemies: {}, completedRuns: {} };
  for (const k of [...RANKS, ...FLAGS]) d[k] = {};
  return d;
}

/** Folds `src` into `into`, only ever upward (two tabs, a backup copy). Returns true when anything changed. */
function mergeInto(into, src) {
  let changed = false;
  if (!src || typeof src !== 'object') return false;
  for (const k of COUNTS) { const v = count(src[k]); if (v > into[k]) { into[k] = v; changed = true; } }
  for (const k of [...RANKS, 'enemies']) for (const [id, v] of Object.entries(src[k] ?? {})) if (validKey(id) && count(v) > count(into[k][id])) { into[k][id] = count(v); changed = true; }
  for (const k of FLAGS) for (const [id, v] of Object.entries(src[k] ?? {})) if (validKey(id) && v === true && into[k][id] !== true) { into[k][id] = true; changed = true; }
  for (const [id, r] of Object.entries(src.completedRuns ?? {})) {
    if (!validKey(id) || typeof r?.won !== 'boolean' || into.completedRuns[id]) continue;
    into.completedRuns[id] = { won: r.won, cls: validKey(r.cls) ? r.cls : '', race: RACES.includes(r.race) ? r.race : '' };
    changed = true;
  }
  return changed;
}

// ---- the 89 achievements (1.7 journal.js:148-236, titles and words as 1.7 has them)
const DEFS = [];
const def = (id, title, text, category, target, key = null, previous = null) => DEFS.push({ id, title, text, category, target, key, previous });
const label = id => id.charAt(0).toUpperCase() + id.slice(1);
[[5, 'The Scenic Route Is Down'], [10, 'Well Below Expectations'], [15, 'No Ground Floor'], [20, 'A Long Way from Lunch'], [25, 'Rock Bottom, Professionally']]
  .forEach(([n, t], i, all) => def('depth-' + n, t, `Reach dungeon floor ${n} in any run.`, 'highestDepth', n, null, i ? 'depth-' + all[i - 1][0] : null));
[[5, 'Qualified to Worry'], [10, 'A Veteran of Bad Decisions'], [20, 'An Occupational Hazard']]
  .forEach(([n, t], i, all) => def('level-' + n, t, `Reach character level ${n} in any run.`, 'maxLevel', n, null, i ? 'level-' + all[i - 1][0] : null));
[[10, 'A Short Career in Heroics'], [50, 'Frequent Dier Miles'], [100, 'Death Knows Your Order']]
  .forEach(([n, t], i, all) => def('deaths-' + n, t, `Die in ${n} different runs. Each run counts once.`, 'deaths', n, null, i ? 'deaths-' + all[i - 1][0] : null));
[[5, 'Grukk the Warchief', 'A Change of Chieftain'], [10, 'Morty the Mostly-Dead', 'Mostly Is No Longer Enough'], [15, 'the Deep Maw', 'A Bite More Than It Could Chew'],
  [20, 'the Matron of the Web', 'Your Web Has Been Cancelled'], [25, 'the Unmaker', 'Unmaking an Unmaker']]
  .forEach(([n, who, t], i) => def('biome-' + (i + 1), t, `Defeat ${who} on floor ${n}${n === 25 ? ' by beating all three of its forms.' : '.'}`, 'bosses', 1, String(n), i ? 'biome-' + i : null));
[[1, 'Forged and Found'], [3, "The Forge's Regular"], [10, 'Here We Forge Again']]
  .forEach(([n, t], i, all) => def('victories-' + n, t, n === 1 ? 'Win a run.' : `Win ${n} different runs. Each run counts once.`, 'victories', n, null, i ? 'victories-' + all[i - 1][0] : null));
const CLASS_TITLES = { fighter: 'Percussive Maintenance', cleric: 'Divine Intervention, Delivered', mage: 'A Degree in Destruction', scoundrel: 'Crime Pays Dividends', tourist: 'Five Stars, Would Survive Again' };
CLASSES.forEach(c => def('victory-' + c, CLASS_TITLES[c], `Win a run as a ${label(c)}.`, 'wins', 1, c));
def('all-classes', 'A Resume Written in Scars', 'Win at least one run as each of the five classes.', 'classes', 5);
const RACE_TITLES = { human: 'Only Human, Somehow', elf: 'A Long Life, Briefly Endangered', dwarf: 'Short Stature, Long Odds', fae: 'Terms and Conditions Apply', gloomling: 'A Bright Future in Darkness' };
const RACE_NAMES = { human: 'Human', elf: 'Elf', dwarf: 'Dwarve', fae: 'Fae', gloomling: 'Gloomling' };
RACES.forEach(r => def('victory-race-' + r, RACE_TITLES[r], `Win a run as ${r === 'elf' ? 'an' : 'a'} ${RACE_NAMES[r]}.`, 'raceWins', 1, r));
def('all-races', 'The Whole Adventuring Family', 'Win at least one run as each of the five races: Human, Elf, Dwarve, Fae and Gloomling.', 'races', RACES.length);
const PATH_TITLES = {
  fire: ['An Unsupervised Spark', 'Playing with Matches', 'A Walking Fire Code Violation'], water: ['Testing the Waters', 'Cold Comfort', 'A Very Deep Problem'],
  air: ['A Breath of Trouble', 'Throwing Caution', 'The Forecast Is You'], earth: ['A Solid Start', 'Stubborn as a Boulder', 'An Immovable Inconvenience'],
  light: ['A Glimmer of Sense', 'Radiant Misconduct', 'Too Bright to Ignore'], shadow: ['A Shady Beginning', 'Comfortably Ominous', 'The Dark Has a New Manager'],
};
const COMBO_TITLES = {
  'fire/earth': 'Lava Is a Contact Sport', 'fire/air': 'Fan Service', 'fire/light': 'A Burning Revelation', 'fire/shadow': 'Dark Roast',
  'water/air': 'Shockingly Cold', 'water/earth': 'Frozen Assets', 'water/light': 'Pure Liquid Judgment', 'water/shadow': 'A Chill Down Your Spine',
  'air/fire': 'Frictional Employment', 'air/water': 'Ice to Meet You', 'air/light': 'Flash of Bad News', 'air/shadow': 'Surprise Forecast',
  'earth/fire': "Strike While You're Hot", 'earth/water': 'Mud, Sweat and Tears', 'earth/light': 'Rooted in Righteousness', 'earth/shadow': 'A Toxic Workplace',
  'light/fire': 'Smite Makes Right', 'light/water': 'Blessed to Excess', 'light/air': 'Justice Strikes Twice', 'light/earth': 'Stay for the Sermon',
  'shadow/fire': 'Smoke and Vanish', 'shadow/water': 'Cold Shoulder, Colder Dagger', 'shadow/air': 'Boo, with Thunder', 'shadow/earth': 'Poisoned Pleasantries',
};
const SIXTH = { fire: 'a Fae of the Ember Court', water: 'a Fae of the Tide Court', air: 'a Fae of the Gale Court', earth: 'a Fae of the Stone Court', light: 'a rank 5 follower of Saint Glimmer', shadow: 'a Gloomling' };
for (const el of ELEMENTS) {
  [1, 3, 6].forEach((n, i, all) => def(`path-${el}-${n}`, PATH_TITLES[el][i], `Reach affinity ${n} in the ${label(el)} path${n === 6 ? `. Only ${SIXTH[el]} can.` : ' in any run.'}`, 'paths', n, el, i ? `path-${el}-${all[i - 1]}` : null));
  for (const second of ELEMENTS) {
    if (second === el || second === OPPOSITE[el]) continue;
    def(`combo-${el}-${second}`, COMBO_TITLES[`${el}/${second}`], `Unlock the combination requiring ${label(el)} 3 / ${label(second)} 2 in the same run.`, 'combos', 1, `${el}/${second}`);
  }
}
const GOD_NAMES = { grom: 'Chad the Unclad', grumbok: 'Grumbok, Who Hates Wizards', glimmer: 'Saint Glimmer', murk: 'Mother Murk', reginald: 'Sir Reginald the Unsneaky', anvil: 'Old Anvil', vellum: 'Vellum, the Open Book', wobbles: 'Wobbles, the Giggling Chaos', sylla: 'Sylla the Patient' };
const FAITH_TITLES = { grom: "The Emperor's New Armor", grumbok: 'No Spells, No Problem', glimmer: 'Holier Than Yesterday', murk: "Mother's Favorite Problem", reginald: 'Subtlety Has Left the Dungeon', anvil: 'A Hammer of Faith', vellum: 'Read It and Reap', wobbles: 'Certified Chaos Consultant', sylla: 'Patience Is a Weapon' };
for (const g of Object.keys(GOD_NAMES)) def('faith-' + g, FAITH_TITLES[g], `Reach faith rank 5 with ${GOD_NAMES[g]} in any run.`, 'godRanks', 5, g);
[[10, 'Ask Questions, Then Hit Things'], [25, 'A Field Guide to Regrets'], [50, 'The Encyclopedia of Teeth']]
  .forEach(([n, t], i, all) => def('bestiary-' + n, t, `Kill ${n} different kinds of enemy across your runs.`, 'enemies', n, null, i ? 'bestiary-' + all[i - 1][0] : null));
[[5, 'Signed, Sealed, Incinerated'], [15, 'A Rather Expensive Alphabet']]
  .forEach(([n, t], i, all) => def('sigils-' + n, t, `Discover ${n} different sigils across your runs.`, 'sigils', n, null, i ? 'sigils-' + all[i - 1][0] : null));
def('first-enchantment', 'A Little Extra Sparkle', 'Discover an equipment enchantment.', 'enchantments', 1);
def('all-achievements', 'The Forge Has No Further Questions', 'Earn every other achievement.', 'achievements', DEFS.length);

/** Every achievement, as the journal stands: current progress, unlocked, visible (1.7 achievements()). */
export function achievements(data) {
  const d = emptyJournal(); mergeInto(d, data);
  const runs = Object.values(d.completedRuns);
  const out = DEFS.filter(x => x.category !== 'achievements').map(x => {
    const v = d[x.category];
    let cur;
    if (COUNTS.includes(x.category)) cur = v;
    else if (x.category === 'deaths' || x.category === 'victories') cur = runs.filter(r => r.won === (x.category === 'victories')).length;
    else if (x.category === 'classes') cur = CLASSES.filter(c => d.wins[c] === true).length;
    else if (x.category === 'races') cur = RACES.filter(r => d.raceWins[r] === true).length;
    else if (x.key) cur = RANKS.includes(x.category) ? count(v[x.key]) : v[x.key] ? 1 : 0;
    else cur = Object.keys(v).length;
    return { ...x, current: Math.min(cur, x.target), unlocked: cur >= x.target };
  });
  const all = { ...DEFS.find(x => x.category === 'achievements') };
  all.current = out.filter(r => r.unlocked).length; all.unlocked = all.current === all.target;
  out.push(all);
  const byId = Object.fromEntries(out.map(r => [r.id, r]));
  for (const r of out) r.visible = r.unlocked || (r.current > 0 && (!r.previous || byId[r.previous].unlocked));
  return out;
}

/** The combinations an affinity spread holds: a primary at 3 with a non-opposed second at 2. */
export function combosOf(aff = {}) {
  const out = [];
  for (const a of ELEMENTS) if ((aff[a] ?? 0) >= 3) for (const b of ELEMENTS) if (b !== a && b !== OPPOSITE[a] && (aff[b] ?? 0) >= 2) out.push(`${a}/${b}`);
  return out;
}

/** 1.7's ordering of finished runs: wins first, then the current scoring, then score, then newest. */
export function sortRuns(rows) {
  return rows.slice().sort((a, b) => Number(b.won) - Number(a.won) || Number(b.scoreVersion === SCORE_VERSION) - Number(a.scoreVersion === SCORE_VERSION)
    || (b.score ?? 0) - (a.score ?? 0) || String(b.finishedAt).localeCompare(String(a.finishedAt)));
}

/**
 * The journal and the run history over a Storage. Writes go to two keys (a main copy and a backup) and only ever add.
 * @param {Storage} storage
 */
export function createJournal(storage) {
  const read = key => { try { const raw = storage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; } };
  const write = (key, v) => { let ok = false; for (const k of [key, key + '-backup']) { try { storage.setItem(k, JSON.stringify(v)); ok = true; } catch { /* storage full or blocked */ } } return ok; };
  let memory = emptyJournal(), runs = [];
  function load() {
    const d = emptyJournal();
    // EP44: the earlier build's journal (1.7 astra-temple-journal, the same version 1 shape) adds to this one.
    for (const doc of [read(KEY), read(KEY + '-backup'), read(LEGACY.journal), read(LEGACY.journal + '-backup')]) if (doc?.version === VERSION) mergeInto(d, doc);
    mergeInto(d, memory); memory = d;
    const byId = new Map();
    // EP44: and its finished runs (1.7 astra-temple-run-history), in this build's shape.
    const old = [read(LEGACY.runs), read(LEGACY.runs + '-backup')].flatMap(doc => (Array.isArray(doc) ? doc : doc?.version === VERSION ? doc.records ?? [] : []))
      .map(r => legacyRun(r, score, SCORE_VERSION)).filter(Boolean);
    for (const list of [read(RUNS)?.records, read(RUNS + '-backup')?.records, runs, old]) for (const r of Array.isArray(list) ? list : []) if (r?.id && !byId.has(r.id)) byId.set(r.id, r);
    runs = [...byId.values()];
    return memory;
  }
  load();
  const save = () => write(KEY, memory);
  function change(category, key, value) {
    if (COUNTS.includes(category)) { const n = count(value); if (n <= memory[category]) return false; memory[category] = n; return true; }
    if (!validKey(key) || !memory[category]) return false;
    if (RANKS.includes(category)) { const n = count(value); if (n <= count(memory[category][key])) return false; memory[category][key] = n; return true; }
    if (category === 'enemies') { memory.enemies[key] = count(memory.enemies[key]) + count(value || 1); return true; }
    if (memory[category][key] === true) return false;
    memory[category][key] = true; return true;
  }
  return {
    /** Records one fact: ('highestDepth', null, 7), ('paths', 'fire', 3), ('sigils', 'ember'), ('enemies', 'rat', 1). */
    record(category, key, value = true) { return change(category, key, value); },
    flush: save,
    /** A finished run: its deaths or wins, its class and race, kept once per run; its row in Previous runs. */
    finishRun(r) {
      if (!r || r.sandbox || !validKey(r.id)) return false;
      load();
      let changed = false;
      const add = (c, k, v) => { if (change(c, k, v)) changed = true; };
      add('highestDepth', null, Math.max(count(r.depth), count(r.floor)));
      add('maxLevel', null, r.level);
      const aff = {};
      for (const a of r.affinities ?? []) { add('paths', a.element, a.rank); aff[a.element] = a.rank; }
      for (const k of combosOf(aff)) add('combos', k, true);
      if (validKey(r.god)) add('godRanks', r.god, r.faithRank);
      if (!memory.completedRuns[r.id]) {
        memory.completedRuns[r.id] = { won: !!r.won, cls: validKey(r.cls) ? r.cls : '', race: RACES.includes(r.race) ? r.race : '' };
        if (r.won) { add('wins', r.cls || 'unknown', true); if (RACES.includes(r.race)) add('raceWins', r.race, true); }
        changed = true;
      }
      if (!runs.some(x => x.id === r.id)) { runs.push({ ...r, score: r.score ?? score(r), scoreVersion: r.scoreVersion ?? SCORE_VERSION }); write(RUNS, { version: VERSION, records: runs }); }
      save();
      return changed;
    },
    data: () => load(),
    /** W44 (1.7 FoteJournal.persisted): false when this browser's storage refuses writes (the journal lasts this session). */
    persisted() { try { storage.setItem(KEY + '-probe', '1'); storage.removeItem(KEY + '-probe'); return true; } catch { return false; } },
    achievements: () => achievements(load()),
    runs: () => (load(), sortRuns(runs)),
  };
}

/** 1.7's equipment type for an enchant: weapon, armor, or an off hand's shield, orb, tome or holy symbol. */
function enchantType(it) {
  if (it.kind === 'weapon') return 'weapon';
  if (it.kind === 'armour') return 'armor';
  const row = offhands.rows[it.id];
  return row ? row.enchantSlot ?? row.family ?? null : null;
}
const trinketKnown = (state, id) => !!state?.run?.knownTrinkets?.includes(id);

/**
 * What a run adds to the journal as it is played (1.7 journal-adapter.js): call `start` when a run begins or loads,
 * `step` after every command with its events, `finish` with the run's record when it ends. Each returns the titles of
 * achievements newly earned, to be said once in the log; `earned` lists this run's for the end screen. A sandbox run
 * adds nothing.
 */
export function journalWatcher(journal) {
  let known = null, fresh = [], timer = null;
  const held = () => new Set(journal.achievements().filter(a => a.unlocked).map(a => a.id));
  const announce = changed => {
    if (!changed || !known) return [];
    const out = [];
    for (const a of journal.achievements()) if (a.unlocked && !known.has(a.id)) { known.add(a.id); fresh.push(a.title); out.push(a.title); }
    return out;
  };
  const soon = () => { if (timer) return; timer = setTimeout(() => { timer = null; journal.flush(); }, 250); };
  function observe(state, events = []) {
    if (!state || state.sandbox || !state.hero) return false;
    const h = state.hero, s = state.stats ?? {};
    let changed = false;
    const rec = (c, k, v) => { if (journal.record(c, k, v)) changed = true; };
    rec('highestDepth', null, Math.max(state.floorNo ?? 0, s.deepest ?? 0));
    rec('maxLevel', null, h.level);
    for (const [el, n] of Object.entries(h.affinity ?? {})) if (n > 0) rec('paths', el, n);
    for (const k of combosOf(h.affinity)) rec('combos', k, true);
    if (h.faith?.god) rec('godRanks', h.faith.god, h.faith.rank);
    for (const id of state.run?.knownSigils ?? []) rec('sigils', id, true);
    // G43 (1.7 journal-adapter.js gear): an enchant is kept by 1.7's equipment type (weapon, armor, shield, orb, tome,
    // holy), as its Encyclopedia lists them; a ring or amulet once its kind is learned this run.
    for (const it of [...Object.values(h.worn ?? {}), ...(h.bag ?? [])]) {
      if (!it || it.known === false && !trinketKnown(state, it.id)) continue;
      if (rings.rows[it.id]?.kind === 'ring') rec('rings', it.id, true);
      if (amulets.rows[it.id]?.kind === 'amulet') rec('amulets', it.id, true);
      const type = it.known !== false && it.enchant ? enchantType(it) : null;
      if (type) rec('enchantments', `${type}/${it.enchant}`, true);
    }
    for (const id of state.run?.knownTrinkets ?? []) rec(rings.rows[id]?.kind === 'ring' ? 'rings' : 'amulets', id, true);
    for (const el of state.planesVisited ?? []) rec('planes', el, true);
    for (const n of [5, 10, 15, 20]) if (s.bossFloors?.[n] || (s.deepest ?? 0) > n) rec('bosses', String(n), true);
    if (state.won) rec('bosses', '25', true);
    for (const e of events) if (e.type === 'died' && e.creditPlayer) { const kind = state.actors?.[e.id]?.kind; if (kind) rec('enemies', kind, 1); }
    // G43 (1.7 gods.js startPrayerCd, startInvokeCd): a prayer or the Cleric's invocation that went off.
    for (const e of events) {
      if (e.type !== 'ability' || e.id !== state.playerId) continue;
      if (prayers.rows[e.ability]?.kind === 'prayer' && e.kind === 'prayer') rec('godAbilities', 'pray:' + e.ability, true);
      else if (h.faith?.god && e.ability === gods.rows[h.faith.god]?.invoke && (h.abilities ?? []).includes('invoke')) rec('godAbilities', 'invoke:' + e.ability, true);
    }
    if (changed) soon();
    return changed;
  }
  return {
    // A run that has not taken a turn holds only what it was made with (a Fae's court element), and that is news; what
    // a loaded save already proves is not.
    start(state) {
      fresh = []; known = null;
      if (!state || state.sandbox) return [];
      const isNew = (state.actions ?? 0) === 0;
      if (isNew) known = held();
      const changed = observe(state);
      if (!isNew) { known = held(); return []; }
      return announce(changed);
    },
    step(state, events) { return announce(observe(state, events)); },
    finish(state, record) {
      if (!record || record.sandbox) return [];
      const a = observe(state), b = journal.finishRun(record);
      clearTimeout(timer); timer = null; journal.flush();
      return announce(a || b);
    },
    earned: () => fresh.slice(),
  };
}
