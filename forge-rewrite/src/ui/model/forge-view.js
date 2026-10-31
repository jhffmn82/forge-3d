// What the Forge and the core infusion show, read from the hero and the data (packet D: elements.json, sigils.json,
// forge.json; the rules in src/rules/magic.js and forge.js). Recycle values and enchant effect text are not specified
// yet; deps.magic() may supply them (review captures do).

import elements from '../../../data/elements.json' with { type: 'json' };
import sigils from '../../../data/sigils.json' with { type: 'json' };
import abilities from '../../../data/abilities.json' with { type: 'json' };
import { itemView } from './item-view.js';
import { upgradeCost, affinityCap, fuseRefusal, elementOrder, recycleValue, sigilForbidden, carveCost } from '../../engine/reads.js';
import strings from '../../../data/strings.json' with { type: 'json' };
import gods from '../../../data/gods.json' with { type: 'json' };
import { ELEMENTS, titleCase } from './hero-view.js';
import { GIFT, rank3Line } from './words.js';
import tuning from '../../../data/tuning.json' with { type: 'json' };

/** What the next point in an element gives (elements.json): a spell at ranks 2, 4, 5, a passive at 3 and 6. */
function nextAt(el, rank) {
  const row = elements.rows[el];
  if (!row || rank > 6) return null;
  const spell = row.abilities?.[String(rank)];
  if (spell) return { name: abilities.rows[spell]?.name ?? titleCase(spell), text: `New spell: ${abilities.rows[spell]?.name ?? titleCase(spell)}.` };
  if (rank === 3) {
    const c = tuning.rows.chill;
    return { name: row.rank3?.name, text: rank3Line(el, rank, { slow: Math.min(c.slowCapPct, c.slowBasePct + c.slowPerWaterRankPct * rank) }) };
  }
  if (rank === 6) return { name: row.rank6?.name, text: strings.rows[`element.${el}.rank6`] ?? null };
  // A rank with no new spell or power raises the element's gift, named as 1.7 named it (proof pass item 11: 'Fire 1: Fire 1'
  // read 'Fire 1: Burning Touch 1' in 1.7; sheets.js PASSIVE_NAMES, forge.js T1_LIVE).
  const gift = GIFT[el];
  return gift ? { name: `${gift.name} ${rank}`, text: gift.line(rank) } : { name: `${row.name} ${rank}`, text: `+1 ${row.damageType ?? el} damage on every hit and spell.` };
}

/**
 * The Forge's sigil recipes in the Forge's order (sigils.json groups), with their essence cost, whether they can be carved
 * now, what each does (G30, EQ23: 1.7 forge.js:131-135 tip words, SIGILS desc) and the god's refusal, which bars carving.
 */
function sigilList(state) {
  const h = state.hero ?? {}, S = sigils.rows, G = S.groups;
  const order = [...G.singles, ...G.plus, ...G.pairs, ...G.triple, ...G.quadruple, ...G.grand].filter((k, i, a) => a.indexOf(k) === i && S[k]);
  return order.map(id => {
    const r = S[id], need = {};
    r.motes.forEach(m => { need[m] = (need[m] ?? 0) + 1; });
    const essence = sigilCost(id);
    const barred = state.hero ? sigilForbidden(state, id) : '';
    // Why it cannot be carved, said on its card (item 301): the god's refusal, else what is short.
    const lack = Object.entries(need).filter(([m, n]) => (h.motes?.[m] ?? 0) < n).map(([m, n]) => `${titleCase(m)} ${n}`);
    const why = barred || [lack.length ? `Not enough motes: needs ${lack.join(', ')}.` : '', (h.essence ?? 0) < essence ? `Not enough essence: needs ${essence}, you have ${h.essence ?? 0}.` : ''].filter(Boolean).join(' ');
    return { id, name: shortSigil(r.name), elements: r.motes, cost: essence, can: !why, why: why || null, text: strings.rows[r.text] ?? null, barred: barred || null };
  });
}

/** A sigil's carving price, the Craft tile's and the journal's: what carve() takes (rules/sigils.js carveCost, through engine/reads.js). */
export const sigilCost = id => carveCost(id);

/** EQ24 (1.7 forge.js:134-135): a craft tile's name, 'Firestorm' for the Sigil of the Firestorm, 'Greater Firestorm' for
 * the Greater Sigil of the Firestorm. */
export const shortSigil = n => { const t = n.replace(/^Greater Sigil of (the )?/, 'Greater ').replace(/^Sigil of (the )?/, ''); return t[0].toUpperCase() + t.slice(1); };

const SLOT_WORDS = { main: 'Main hand', ranged: 'Ranged', off: 'Off hand', armour: 'Armor', ring1: 'Ring 1', ring2: 'Ring 2' };
/** Which enchant family a worn slot takes (upgrades.json enchant-slots). */
const ENCHANT_FAMILY = { main: 'weapon', ranged: 'weapon', armour: 'armour' };
const OFF_FAMILY = { buckler: 'shield', kite: 'shield', orb: 'orb', tome: 'tome', holy: 'holy' };

/** The forge's whole view: the strip on top and each tab's rows. */
export function forgeView(state, magic = {}) {
  const h = state.hero ?? {}, aff = h.affinity ?? {};
  const cap = state.hero ? affinityCap(state) : 1;
  const total = Object.values(aff).reduce((a, b) => a + b, 0);
  const primary = state.hero ? elementOrder(h)[0] ?? null : null;
  // W27 (1.7 forgeui.js:42-50): the sworn god's forbidden elements cannot be set into gear; the tile says who forbids it.
  const god = h.faith?.god ? gods.rows[h.faith.god] : null;
  const motes = ELEMENTS.map(el => ({ el, n: h.motes?.[el] ?? 0, barred: god?.forbiddenElements?.includes(el) ? `${god.name.split(',')[0]} forbids this enchantment.` : null }));
  const fuse = ELEMENTS.map(el => {
    const have = aff[el] ?? 0, why = state.hero ? fuseRefusal(state, el) : 'no-mote';
    return { el, name: titleCase(el), have, next: nextAt(el, have + 1), can: !why || why === 'not-at-forge', why };
  });
  const worn = ['main', 'ranged', 'armour', 'off', 'ring1', 'ring2'].map(slot => ({ slot, label: SLOT_WORDS[slot], raw: h.worn?.[slot], item: itemView(h.worn?.[slot], state, { worn: true, slot }) })).filter(w => w.item);
  // The rules' cost (rules/forge.js, I29); null at the top or for gear the Forge will not work.
  const upgrade = worn.map(w => { let cost = null; try { cost = upgradeCost(h, w.raw); } catch { /* unknown row */ } return { ...w, plus: w.raw.plus ?? 0, cost }; });
  const enchant = worn.filter(w => w.slot !== 'ring1' && w.slot !== 'ring2').map(w => {
    // G09 (1.7 forge-adapter.js:7 forgeTarget): a light weapon in the off hand takes the weapon enchants.
    const family = ENCHANT_FAMILY[w.slot] ?? (w.raw.kind === 'weapon' ? 'weapon' : OFF_FAMILY[w.raw.id]);
    // An unidentified piece keeps its enchant hidden, and the Forge will not work it (1.7 forgeui.js:53-58).
    const unknown = w.raw.known === false;
    return { ...w, family, unknown, current: unknown ? null : w.raw.enchant ?? null, can: !!family };
  }).filter(w => w.can);
  // The rules' value (rules/sigils.js recycleValue, D54): gear, rings and amulets melt; food and sigils do not.
  const worth = it => { try { return recycleValue(state, it); } catch { return 0; } };
  const recycle = (h.bag ?? []).map((it, i) => ({ bag: i, item: itemView(it, state), value: it && it.kind !== 'food' && it.kind !== 'sigil' ? worth(it) : 0 })).filter(r => r.item && r.value > 0);
  return {
    motes, primary, primaryLevel: primary ? aff[primary] : 0, total, cap, essence: h.essence ?? 0,
    // EQ25 (1.7 forge.js:94 affLine): every element held, primary first, with its points.
    held: state.hero ? elementOrder(h).map(el => ({ el, n: aff[el], primary: el === primary })) : [],
    fuse, enchant, upgrade, recycle, sigils: sigilList(state), enchantText: magic.enchantText ?? {},
  };
}
