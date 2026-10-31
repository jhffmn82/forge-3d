// The windows' words, read from data (consolidation U4; audit ui-03, ui-21, ui-41). The prose lives in data/strings.json,
// moved verbatim from 1.7 and Justin's fixes; the names come from the data books; a number in prose is a placeholder
// filled from the book that holds it, so it never drifts from the rule.
//
// Placeholders and their filling live in lib/fill.js (fill, say).

import progression from '../../../data/progression.json' with { type: 'json' };
import elements from '../../../data/elements.json' with { type: 'json' };
import biomes from '../../../data/biomes.json' with { type: 'json' };
import tiers from '../../../data/tiers.json' with { type: 'json' };
import gods from '../../../data/gods.json' with { type: 'json' };

import { S, fill, say, cap, AHEAD, boonWords } from '../../lib/fill.js';
export { fill, say, cap, boonWords };

/**
 * A card stored under `key` (U6, ui-13 and ui-14): lines 'Label<TAB>value[<TAB>bad]' become rows, '- note' lines notes,
 * and a line led by [cond] counts only when it holds: cursed, !cursed, pos=k, neg=k, nonneg=k, nonpos=k (vars.v(k) against
 * 0), eq=k:n, gt=k:n (vars[k]). A lone '- ' says the card has no note of its own. null when there is no such card.
 */
export function card(key, vars = {}) {
  if (S[key] === undefined) return null;
  const holds = c => {
    if (c === 'cursed' || c === '!cursed') return !!vars.cursed === (c === 'cursed');
    const [op, arg] = c.split('='), [k, n] = arg.split(':');
    const v = op === 'eq' || op === 'gt' ? vars[k] : vars.v(k);
    return { pos: v > 0, neg: v < 0, nonneg: v >= 0, nonpos: v <= 0, eq: v === Number(n), gt: v > Number(n) }[op];
  };
  const out = { rows: [], notes: [], noNote: false };
  for (let line of S[key].split('\n')) {
    const m = /^\[([^\]]+)\]/.exec(line);
    if (m) { if (!holds(m[1])) continue; line = line.slice(m[0].length); }
    if (line === '- ') out.noNote = true;
    else if (line.startsWith('- ')) out.notes.push(fill(line.slice(2), vars));
    else { const [label, value, bad] = line.split('\t'), row = [fill(label, vars), value === undefined ? undefined : fill(value, vars)]; out.rows.push(bad ? [...row, 'bad'] : row); }
  }
  return out;
}

/** Every row under `prefix`, in file order, as { id: words } (a dotted id keeps its dots). */
const under = prefix => Object.fromEntries(Object.keys(S).filter(k => k.startsWith(prefix)).map(k => [k.slice(prefix.length), S[k]]));
/** Rows like race.human.summary as { human: { summary } }, filled. */
function table(prefix) {
  const out = {};
  for (const [k, v] of Object.entries(under(prefix))) { const i = k.lastIndexOf('.'), id = k.slice(0, i); (out[id] ??= {})[k.slice(i + 1)] = fill(v); }
  return out;
}

export const STEP_TITLE = under('step.');
export const RACE = table('race.');
export const CLASS = table('class.');
export const GOD = table('god.');
export const ACTION = Object.fromEntries(Object.entries(under('action.')).map(([k, v]) => [k, fill(v, AHEAD)]));
/** An ability's words for this hero: an invocation the hero holds as a Cleric at the hero's faith rank, else ACTION's. */
export const actionWords = (id, hero) => (hero?.god && gods.rows[hero.god]?.invoke === id ? say('action.' + id, { n: hero.faith?.rank ?? 1, per: '' }) : ACTION[id]);
export const STAT_PASSIVE = under('stat-passive.');
export const INVOKE = { name: S['invoke.name'], text: S['invoke.text'] };
export const CLERIC_BOUND = S['cleric.bound'];

const ELEMENT_ROWS = Object.entries(elements.rows).filter(([, r]) => r?.kind === 'element');
/** The six elements in the Forge's order. */
export const ELEMENT_IDS = ELEMENT_ROWS.map(([id]) => id);
/** A damage type's word ("ice" is Frost) and an element's damage word ("water" deals Frost). */
export const damageWord = type => S['damage.' + type] ?? type;
export const DAMAGE_WORD = Object.fromEntries(ELEMENT_ROWS.map(([id, r]) => [id, damageWord(r.damageType)]));
/** An element's first gift and rank 3 power, in words at rank n. */
export const GIFT = Object.fromEntries(ELEMENT_IDS.map(id => [id, { name: S[`gift.${id}.name`], line: n => say(`gift.${id}.line`, { n }) }]));
export const rank3Line = (id, n, vars = {}) => say(`rank3.${id}`, { n, ...vars });
/** An attribute's name by id ("mig" is Might). */
export const ATTR_NAME = progression.rows.attributes.names;
/** A biome's name as a sentence names it ("the Realm of Chaos"). */
export const biomePlace = id => (biomes.rows[id]?.name ? 'the ' + biomes.rows[id].name : id);

/** The Journal's attribute and combat entries in order, as [name, words]. */
export const ATTRIBUTES = Object.entries(under('encyclopedia.attribute.')).map(([k, v]) => [k, fill(v)]);
export const COMBAT = Object.entries(under('encyclopedia.combat.')).map(([k, v]) => [k, fill(v)]);
const SHORT_ALIAS = { Speed: 'Move speed', 'Max HP': 'HP', 'Max mana': 'Mana' };
/** The gear an attribute meets the requirements of (items 150-152, Justin 10-18): a group of stat-gear.groups is named when
 *  every kind in it takes that attribute in tiers.json's requirements. */
function gearFor(stat) {
  const req = tiers.rows.requirements.items, takes = k => (req[k]?.any ?? Object.keys(req[k]?.all ?? {})).includes(stat);
  const names = S['stat-gear.groups'].split('; ').map(g => g.split('=')).filter(([, kinds]) => kinds.split(' ').every(takes)).map(([n]) => n);
  return names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names.at(-1) : names[0];
}
/** The hover lines for a stat name ([] when it has none): Justin 10-16, terse, numbers first. */
export function statShort(name) {
  const t = S['stat-short.' + name] ?? S['stat-short.' + SHORT_ALIAS[name]];
  return t ? fill(t, { gear: gearFor }).split('\n') : [];
}

/** A word with its first letter capital (U7, ui-42: the one capitalise for the windows). */

const SMALL = new Set(['of', 'the', 'a', 'an', 'and']);
/** A god's epithet as a name line: "the smith below" becomes "The Smith Below". */
export const titleLine = s => String(s).split(' ').map((w, i) => (i && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
