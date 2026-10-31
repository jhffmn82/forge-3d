// What the windows show about the hero, read from the engine state and the data packets (A, C, E).
// Read only. The engine's hero record (`state.hero`, docs: side-session note UI-HOOKS.md) is still growing,
// so each part falls back to what the player actor carries today and shows nothing it cannot know.

import races from '../../../data/races.json' with { type: 'json' };
import courts from '../../../data/courts.json' with { type: 'json' };
import classes from '../../../data/classes.json' with { type: 'json' };
import gods from '../../../data/gods.json' with { type: 'json' };
import prayers from '../../../data/prayers.json' with { type: 'json' };
import progression from '../../../data/progression.json' with { type: 'json' };
import piety from '../../../data/piety.json' with { type: 'json' };
import { itemView, gearPassives } from './item-view.js';
import elements from '../../../data/elements.json' with { type: 'json' };
import loot from '../../../data/loot.json' with { type: 'json' };
import combos from '../../../data/combos.json' with { type: 'json' };
import strings from '../../../data/strings.json' with { type: 'json' };
import { RACE, GOD, STAT_PASSIVE, GIFT, rank3Line, ELEMENT_IDS, ATTR_NAME, damageWord } from './words.js';
import { stealthScore, actionCost, moveCost, heroStats, pietyDepth, itemRow, weaponDamage } from '../../engine/reads.js';   // C17: the rules' answers through the engine (PLAN section 2)
import { passiveRows } from './creation-model.js';
import tuning from '../../../data/tuning.json' with { type: 'json' };
import { affinityLine } from './preview-words.js';
import { AFFINITY_HIGHLIGHT } from '../core/widgets.js';
import { toNum } from '../core/colour.js';

/** W30 (1.7 sheets.js:135-141, :163, :172): a god's colour as a number, for the lines that came from it. */
const godInk = id => (gods.rows[id]?.color ? toNum(gods.rows[id].color) : undefined);

export const ATTRS = progression.rows.attributes;
const LEGACY_ATTR = { mig: 'might', agi: 'agility', vit: 'vitality', foc: 'focus' };
const RESISTS = ['fire', 'ice', 'lightning', 'poison', 'light', 'dark', 'magic'].map(id => [id, damageWord(id)]);
const WORN = [['main', 'Main hand'], ['off', 'Off hand'], ['armour', 'Armor'], ['amulet', 'Amulet'], ['ring1', 'Ring'], ['ring2', 'Ring'], ['ranged', 'Ranged']];
export const ELEMENTS = ELEMENT_IDS;
export const BAG_SIZE = loot.rows.bag.slots;   // loot.json, as the rules' bag
/** 1.7's element ladder: which element and rank grant each spell (js/elements/elements.js ELEMENT_ABILS). */
const SPELL_RANK = Object.fromEntries(ELEMENTS.flatMap(el => Object.entries(elements.rows[el].abilities ?? {}).map(([rank, id]) => [id, [el, Number(rank)]])));
const EQUIP_WORDS = { holy: 'holy symbols', ring: 'rings', amulet: 'amulets' };

/** 1.7's live words for an element's first point and its rank 3 power (forge.js T1_LIVE, enchtext.js RANK_LIVE @3c8b312),
 * from strings.json with elements.json's numbers; the sheet's first point drops the full stop. */
const RANK1 = el => n => GIFT[el].line(n).replace(/\.$/, '');
const CHILL = tuning.rows.chill;
const RANK3 = el => n => rank3Line(el, n, { slow: Math.min(CHILL.slowCapPct, CHILL.slowBasePct + CHILL.slowPerWaterRankPct * n) });

/**
 * 1.7 sheets.js:153-181: the passives beyond the class, stats and boons: the race's, each held element's point, rank 3 and
 * rank 6 powers with their live numbers, the element pairs held (combos.json: first at 3, second at 2), and what worn gear
 * gives. text is what it does now (the card's words); from and group say where it came from.
 */
function morePassives(state, h) {
  const out = [], word = el => elements.rows[el]?.name ?? titleCase(el);
  const race = races.rows[h.race];
  if (race) out.push({ name: strings.rows['passive.race.' + h.race] ?? race.name, text: strings.rows[`passive.race.${h.race}.text`] ?? RACE[h.race]?.blurb ?? '', group: race.name, from: race.name, source: 'race' });
  const aff = h.affinity ?? {};
  for (const el of ELEMENTS) {
    const n = aff[el] ?? 0, E = elements.rows[el];
    if (n <= 0 || !E) continue;
    out.push({ name: strings.rows[`element.${el}.rank1`] ?? E.perPoint?.name ?? word(el), text: RANK1(el)(n), group: `${word(el)} ${n}`, from: `${word(el)} 1`, tint: AFFINITY_HIGHLIGHT[el], source: 'affinity' });
    if (n >= 3 && E.rank3) out.push({ name: E.rank3.name, text: RANK3(el)(n), group: `${word(el)} ${n}`, from: `${word(el)} 3`, tint: AFFINITY_HIGHLIGHT[el], source: 'affinity' });
    if (n >= 6 && E.rank6) out.push({ name: E.rank6.name, text: strings.rows[`element.${el}.rank6`] ?? '', group: `${word(el)} ${n}`, from: `${word(el)} 6`, tint: AFFINITY_HIGHLIGHT[el], source: 'affinity' });
  }
  const rule = combos.rows['combo-rule'];
  for (const [id, c] of Object.entries(combos.rows)) {
    if (c.kind !== 'combo' || (aff[c.first] ?? 0) < rule.first || (aff[c.second] ?? 0) < rule.second) continue;
    { const from = `${word(c.first)} ${rule.first} / ${word(c.second)} ${rule.second}`; out.push({ name: c.name, text: strings.rows[c.text ?? 'combo.' + id] ?? '', group: 'Element pair', from, source: 'affinity' }); }
  }
  for (const g of gearPassives(state)) out.push({ name: g.name, text: g.text, group: 'Gear', from: 'Gear', source: 'gear' });
  return out;
}

/** A readable name for an id that has no data row yet (packet D abilities, for one). */
export const titleCase = id => String(id).split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

/** The XP needed from level n to n + 1, or null at the cap. */
export function xpToNext(level) {
  const c = progression.rows['xp-curve'];
  return level >= c.levelCap ? null : c.toNext[level - 1] ?? null;
}

/** "Dwarve Fighter", with the court for a Fae and the god for a Cleric. */
export function whoLine(h) {
  const parts = [races.rows[h.race]?.name, classes.rows[h.cls]?.name].filter(Boolean).join(' ');
  const court = h.court ? courts.rows[h.court]?.name : null;
  const god = h.god && h.cls === 'cleric' ? gods.rows[h.god]?.name : null;
  return [parts + (god ? ` of ${god}` : ''), court].filter(Boolean).join(', ');
}

/** The off-hand weapon's line for the Character sheet, or nothing (sandbox item 62). */
function offHandRow(h) {
  const off = h.worn?.off, main = h.worn?.main;
  try {
    if (!off || itemRow(off.id).kind !== 'weapon' || (main && itemRow(main.id).row.hands === 2)) return [];
    const [lo, hi] = weaponDamage(off, h);
    return [['Off hand', `${lo}-${hi} ×${tuning.rows['weapon-damage'].offhandMult}`]];
  } catch { return []; }
}

const pct = v => `${Math.round(v)}%`;
const mult = v => `×${Number(v).toFixed(2)}`;

/** W13 (1.7 slotCard): what an empty slot takes, for its card. */
const EMPTY_SLOT = {
  main: 'Main hand: drag a weapon here.', off: 'Off hand: a shield, focus or light weapon.', armour: 'Armor: drag body armor here.',
  amulet: 'Amulet: activated from the hotbar; kills build charges.', ring1: 'Ring: works passively while worn.', ring2: 'Ring: works passively while worn.',
  ranged: 'Ranged: a bow here shoots anything out of reach.',
};

/**
 * The worn slots (1.7 slotHTML, slotCard): each piece's full card; the off hand's card also gives the hero's own block
 * and parry; under a two-hander the off hand reads Both hands; an empty slot's card says what it takes.
 */
function wornView(state, h, s) {
  const main = h.worn?.main;
  let both = null;
  try { const r = main && itemRow(main.id).row; both = r && r.hands === 2 ? r.name : null; } catch { both = null; }
  return WORN.map(([slot, label]) => {
    const item = itemView(h.worn?.[slot], state, { worn: true, slot });
    if (item && slot === 'off') {
      const own = [s.block ? ['Your block', pct(s.block)] : null, s.parry ? ['Your parry', pct(s.parry)] : null].filter(Boolean);
      if (own.length) item.detail = { ...item.detail, rows: [...item.detail.rows, ...own] };
    }
    const twoHand = slot === 'off' && !item && both;
    return { slot, label: twoHand ? 'Both hands' : label, item,
      empty: item ? null : { title: twoHand ? `Both hands on the ${both}` : 'Empty', lines: [EMPTY_SLOT[slot]] } };
  });
}

/** The full view of the hero for the Character, Inventory and Faith windows. */
export function heroView(state) {
  const p = state.actors[state.playerId];
  const h = state.hero ?? {};
  const s = state.hero ? heroStats(state.hero) : {};
  const level = h.level ?? 1;
  const attr = ATTRS.ids.map(id => ({ id, name: ATTRS.names[id], value: h.attr?.[id] ?? p.attr?.[LEGACY_ATTR[id]] ?? ATTRS.base, max: ATTRS.max }));
  const shield = p.guard ?? 0;
  const timed = { ...p, statuses: p.statuses ?? {} };   // an actor read before its first status (a test's or an old save's) times as clean
  const combat = [
    ['HP', `${p.hp} / ${p.maxhp}${shield ? ' +' + shield : ''}`, 'hp'],
    ['Mana', `${p.mana} / ${p.maxmana}`, 'mana'],
    ['Damage', (s.damageShown ?? p.dmg) ? (s.damageShown ?? p.dmg).join('-') : '-'],
    // A weapon in the off hand strikes again with every melee blow at its own damage x0.6 (rules/attack.js offHandSwing).
    ...offHandRow(h),
    ['Accuracy', String(s.acc ?? p.acc ?? '-')],
    ['Crit', pct(s.crit ?? p.crit ?? 0)],
    ['Crit damage', mult(s.critMult ?? p.critMult ?? 1.5)],
    ['Armor', String(s.armour ?? p.armour ?? 0)],
    ['Evasion', String(Math.round(s.eva ?? p.eva ?? 0))],
    ['Block', pct(s.block ?? p.block ?? 0)],
    ['Parry', pct(s.parry ?? p.parry ?? 0)],
    ['Spell power', mult(s.spellPower ?? 1)],
    ['Divine power', mult(s.divine ?? 1)],
    // G6 (1.7 costs-adapter.js playerSpeedPercent): the next ordinary attack and step, as 10000 / their time in units.
    ['Attack speed', pct(10000 / Math.max(1, actionCost(timed, { melee: true, unarmed: !h.worn?.main, weapon: h.worn?.main ?? null })))],
    ['Move speed', pct(10000 / Math.max(1, moveCost(timed, state.floor ?? null)))],
    ['Range', String(s.range ?? 1)],
    // Proof pass windows #10 (1.7 geometry-adapter.js stealthScore): the moment's stealth, standing still, in grass or a
    // dark room counted, as the turn's AI read it (ai.js stealthNow); before the first turn, worked out the same way.
    ['Stealth', pct(h.stealthNow != null ? h.stealthNow * 100 : state.floor && state.actors?.[state.playerId] ? stealthScore(state) * 100 : s.stealth ?? 0)],
  ];
  const resist = RESISTS.map(([id, name]) => [name, s.resist?.[id] ?? null]);
  const cls = classes.rows[h.cls], race = races.rows[h.race];
  const invoke = h.god ? gods.rows[h.god]?.invoke : null;
  // Every ability and passive says where it came from (Justin 10-16); source is its kind, for the sheet's groups (item 173).
  // The god sworn to (a shrine sets only hero.faith), else the cleric's own: never "null, rank 1".
  const godId = h.faith?.god ?? h.god, godName = godId ? gods.rows[godId]?.name.split(',')[0] : null;
  const abilities = (h.abilities ?? cls?.abilities ?? []).map(id => (id === 'invoke' && invoke ? invoke : id)).map(id => {
    const el = SPELL_RANK[id];
    const from = id === invoke ? `${godName} (invoke)` : el ? `${titleCase(el[0])} ${el[1]}` : cls?.name ?? '';
    const tint = id === invoke ? godInk(godId) : el ? AFFINITY_HIGHLIGHT[el[0]] : undefined;
    return { id, name: prayers.rows[id]?.name ?? titleCase(id), icon: prayers.rows[id]?.icon, group: from, from, tint, source: id === invoke ? 'god' : el ? 'affinity' : 'class' };
  });
  const fv = faithView(h.faith, state);
  for (const p of fv?.prayers ?? []) if (p.have) abilities.push({ id: p.id, name: p.name, icon: p.icon, group: `${godName}, rank ${p.rank}`, from: `${godName}, rank ${p.rank}`, tint: godInk(godId), source: 'god' });
  const statPassives = [];
  for (const [a, list] of Object.entries(progression.rows['stat-passives'])) if (Array.isArray(list)) for (const sp of list) if ((h.attr?.[a] ?? 0) >= sp.at) statPassives.push({ name: sp.name, text: STAT_PASSIVE[sp.name] ?? '', group: `${ATTR_NAME[a]} ${sp.at}`, from: `${ATTR_NAME[a]} ${sp.at}`, source: 'attribute' });   // W8: what it does (1.7 sheets.js:157)
  const passives = [
    cls?.passiveName && { name: cls.passiveName, group: cls.name, from: cls.name, rows: passiveRows(h.cls), source: 'class' },
    ...statPassives,
    ...(state.hero ? morePassives(state, h) : []),
    ...(fv?.boons ?? []).filter(b => b.have).map(b => ({ name: b.name, boon: b.id, group: `${godName}, rank ${b.rank}`, from: `${godName}, rank ${b.rank}`, tint: godInk(godId), source: 'god' })),
  ].filter(Boolean);
  return {
    name: h.name ?? p.name,
    who: whoLine(h),
    race: h.race, sex: h.sex, cls: h.cls,
    level, xp: h.xp ?? 0, xpNext: xpToNext(level), points: h.points ?? 0,
    attr, combat, resist, abilities, passives,
    // What the next point in each element gives (sandbox E2): held elements, or every element before the hero holds two.
    affinityNext: ELEMENTS.filter(el => (h.affinity?.[el] ?? 0) > 0 || Object.values(h.affinity ?? {}).filter(n => n > 0).length < 2)
      .map(el => affinityLine(h, el, titleCase(el))).filter(Boolean),
    affinity: { have: h.affinity ?? {}, cap: (h.affinityCap ?? progression.rows['affinity-cap'].base) + (race?.affinityCapBonus ?? 0) },
    worn: wornView(state, h, s),
    bag: Array.from({ length: BAG_SIZE }, (_, i) => itemView(h.bag?.[i], state)),
    essence: h.essence ?? 0,
    motes: ELEMENTS.map(el => ({ el, n: h.motes?.[el] ?? 0 })),
    keys: typeof h.keys === 'number' ? { iron: h.keys } : h.keys ?? {},
    // W35 (1.7 equipResourcesHTML, sheets.js:226): the dungeon core carried to the exit gate, by name.
    core: h.core ?? null,
    look: p.look?.sheet ?? null,
    faith: faithView(h.faith, state),
  };
}

/** Rank, piety and favor, the boons so far, the prayers by rank. Null when unsworn. `state` gives the floor's piety worth. */
export function faithView(f, state) {
  if (!f?.god) return null;
  const g = gods.rows[f.god], ranks = piety.rows.ranks;
  const rank = f.rank ?? ranks.rankOnJoining;
  const nextAt = ranks.thresholds[Math.max(rank, 1)];
  return {
    id: f.god, name: g.name, title: g.title, colour: g.color, rank, maxRank: ranks.maxRank,
    // 1.7 renderFaithPane (gods.js:245-251): whole numbers; a chaos god's Amusement first (CD15).
    piety: Math.round(f.piety ?? 0), next: rank >= ranks.maxRank ? null : nextAt ?? null, favor: Math.round(f.favor ?? 0), favorCap: piety.rows.favor.cap,
    amusement: g.chaos ? Math.max(0, Math.min(100, Math.round(f.amusement ?? 0))) : null,
    rule: ruleLine(g),
    // CF46 (1.7 renderFaithPane "Piety from" and "Depth", gods.js:181, :253): how this god awards piety, and its worth here.
    gain: GOD[f.god]?.piety ?? null, depth: state ? pietyDepth(state) : null,
    boons: g.boons.map(b => ({ id: b.id, rank: b.rank, name: b.name, have: b.rank <= rank })),
    // Item 292 (Justin 2026-10-20: "vellum shows arcane lance as a rank 1 prayer ... when that is the invocation"): the
    // god's prayers only, as 1.7 renderFaithPane (gods.js:260); the invocation is the Cleric's own ability, never a prayer.
    prayers: (g.prayers ?? []).map(id => {
      const pr = prayers.rows[id];
      return { id, name: pr?.name ?? titleCase(id), rank: pr?.rank ?? 1, favor: pr?.favor ?? 0, health: pr?.health ?? 0, cooldown: pr?.cooldown ?? 0,
        left: f.cooldowns?.[id] ?? 0, icon: pr?.icon, have: (pr?.rank ?? 1) <= rank, kind: pr?.kind ?? null, aim: pr?.aim?.kind ?? null };
    }),
  };
}

/** A god's rule in a few words, from its conduct row. */
export function ruleLine(g) {
  const c = g.conduct ?? {}, out = [];
  if (c.noSpells) out.push('No spells');
  if (c.noSigils) out.push('No sigils');
  if (c.equipOnly?.length) out.push('Bare but for ' + c.equipOnly.map(k => EQUIP_WORDS[k] ?? k).join(', '));
  if (g.forbiddenElements?.length) out.push('Forbids ' + g.forbiddenElements.join(', '));
  return out.join('. ');
}
