// Game text's placeholders filled from the books that hold their numbers (moved from ui/model/words.js for item 315, so
// the rules' log lines and the windows fill a boon's words the same way; lib, so every layer may read it).
//
// Placeholders: {n} and other words come from `vars`; {book:path} reads that book's row by dotted path. A "scaled" value
// ({scaled: {base, per, min, max}}) is evaluated at rank `vars.n`. Filters after a bar: pct (x100), gain ((v-1) x100),
// less ((1-v) x100), over100 (v-100), abs, f2 (two decimals), lo and hi (a rolled base's ends), s (plural "s" unless 1).
// With the hero's numbers in `vars` (a card, U6): pctof (a pct-of amount of vars.maxhp or maxmp), pctmp (v% of maxmp),
// heal (x vars.healMult), more=<book:path> (x (1 + that number / 100)), own=<status> (vars.own: the hero's buff turns),
// foe=<status> (vars.foe: a foe's turns, bosses shorter), xn (x vars.n: a per-rank number at the hero's rank).
// Item 315 (Justin 2026-10-22: "when you have a passive ... it shouldn't show what you get per rank but what you are
// getting"): a boon's or invocation's words take the hero's rank as n, {per} empty; looking ahead, n is 1 and {per}
// says " per rank" (boonWords, actionWords).

import strings from '../../data/strings.json' with { type: 'json' };
import tuning from '../../data/tuning.json' with { type: 'json' };
import progression from '../../data/progression.json' with { type: 'json' };
import races from '../../data/races.json' with { type: 'json' };
import courts from '../../data/courts.json' with { type: 'json' };
import classes from '../../data/classes.json' with { type: 'json' };
import elements from '../../data/elements.json' with { type: 'json' };
import biomes from '../../data/biomes.json' with { type: 'json' };
import sigils from '../../data/sigils.json' with { type: 'json' };
import statuses from '../../data/statuses.json' with { type: 'json' };
import upgrades from '../../data/upgrades.json' with { type: 'json' };
import weapons from '../../data/weapons.json' with { type: 'json' };
import armour from '../../data/armour.json' with { type: 'json' };
import offhands from '../../data/offhands.json' with { type: 'json' };
import rings from '../../data/rings.json' with { type: 'json' };
import amulets from '../../data/amulets.json' with { type: 'json' };
import tiers from '../../data/tiers.json' with { type: 'json' };
import gods from '../../data/gods.json' with { type: 'json' };
import prayers from '../../data/prayers.json' with { type: 'json' };

// The gods' boons by id, as the rules read them (gods.json).
const boons = { rows: Object.fromEntries(Object.values(gods.rows).flatMap(g => g.boons ?? []).map(b => [b.id, b])) };
const BOOKS = { tuning, progression, races, courts, classes, elements, sigils, statuses, upgrades, weapons, armour, offhands, rings, amulets, boons, prayers };
// The book is before the first colon; the path may hold one ("per.affinity:shadow").
const ref = r => { const i = r.indexOf(':'), book = r.slice(0, i); return r.slice(i + 1).split('.').reduce((o, k) => o?.[k], BOOKS[book]?.rows); };
export const S = strings.rows;

/** A scaled number at rank n; `end` picks a rolled base's low or high end. */
export function scaled(v, n, end) {
  if (typeof v === 'number') return v;
  const s = v?.scaled;
  if (!s) return Array.isArray(v?.roll) ? v.roll[end === 'hi' ? 1 : 0] : v;
  const base = typeof s.base === 'number' ? s.base : Array.isArray(s.base?.roll) ? s.base.roll[end === 'hi' ? 1 : 0] : 0;
  let out = base + Object.values(s.per ?? {}).reduce((a, p) => a + p * n, 0);
  if (s.min !== undefined) out = Math.max(s.min, out);
  if (s.max !== undefined) out = Math.min(s.max, out);
  return out;
}

const tidy = x => (typeof x === 'number' ? String(Math.round(x * 100) / 100) : String(x));
const FILTER = {
  pct: v => v * 100, gain: v => (v - 1) * 100, less: v => (1 - v) * 100, over100: v => v - 100, abs: Math.abs, f2: v => v.toFixed(2), s: v => (v === 1 ? '' : 's'),
  pctof: (v, a, x) => { const p = v['pct-of']; return Math.max(p.min ?? 0, Math.round((p.stat === 'max-mp' ? x.maxmp : x.maxhp) * p.pct / 100)); },
  pctmp: (v, a, x) => (x.maxmp * v) / 100, heal: (v, a, x) => Math.round(v * (x.healMult ?? 1)), more: (v, a) => Math.round(v * (1 + ref(a) / 100)),
  own: (v, a, x) => x.own(v, a), foe: (v, a, x) => x.foe(a, v), xn: (v, a, x) => v * (x.n ?? 1),
  // An item card's numbers (item-view's own formats): signed (+3, +0.5), signpct (+12%), round, neg.
  signed: v => (v >= 0 ? '+' : '') + String(Number(Number(v).toFixed(2))), cap: v => cap(String(v)), signpct: v => `${v >= 0 ? '+' : ''}${Math.round(v)}%`, round: Math.round, neg: v => -v,
};

/** One placeholder's value. */
function value(spec, vars) {
  const [at, ...filters] = spec.split('|');
  let v;
  if (at.includes('=')) { const [fn, arg] = at.split('='); v = vars[fn](arg); }   // {v=spellPct}: a value the card asks for
  else if (!at.includes(':')) v = vars[at];
  else v = scaled(ref(at), vars.n ?? 1, filters.find(f => f === 'lo' || f === 'hi'));
  if (v === undefined || v === null) throw new Error(`words: no value for {${spec}}`);
  for (const f of filters) { const [name, arg] = f.split('='); if (FILTER[name]) v = FILTER[name](v, arg, vars); }
  return tidy(v);
}

/** A template with its placeholders filled. */
export const fill = (t, vars = {}) => String(t).replace(/\{([^{}]+)\}/g, (_, spec) => value(spec, vars));

/** The words stored under `key`, filled; '' when there are none. */
export const say = (key, vars) => (S[key] === undefined ? '' : fill(S[key], vars));

/** Looking ahead at something not held: its per-rank amounts, said per rank. */
export const AHEAD = { n: 1, per: ' per rank' };
/** A boon's words: held at `rank`, what it gives now; with no rank, per rank. '' when it has none. */
export const boonWords = (id, rank) => say('boon.' + id, rank ? { n: rank, per: '' } : AHEAD);
/** A word with its first letter capitalised. */
export const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
