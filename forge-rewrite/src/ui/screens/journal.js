
import { Container, Graphics, Rectangle, Sprite, Texture } from '../../../../forge-godot/runtime/pixi.js';
import { color, space } from '../core/widgets.js';
import { editText } from '../core/text-entry.js';
import { hasSheet, sheet, loadSheet } from '../core/art.js';   // C17: render through ui/core
import planes from '../../../data/planes.json' with { type: 'json' };
import { stack, row, flow } from '../core/layout.js';
import { paged, none, pairs } from '../core/blocks.js';
import monsters from '../../../data/monsters.json' with { type: 'json' };
import { bodySheet } from '../../data/sheets.js';
import races from '../../../data/races.json' with { type: 'json' };
import classes from '../../../data/classes.json' with { type: 'json' };
import gods from '../../../data/gods.json' with { type: 'json' };
import statuses from '../../../data/statuses.json' with { type: 'json' };
import weapons from '../../../data/weapons.json' with { type: 'json' };
import armour from '../../../data/armour.json' with { type: 'json' };
import rings from '../../../data/rings.json' with { type: 'json' };
import offhands from '../../../data/offhands.json' with { type: 'json' };
import sigils from '../../../data/sigils.json' with { type: 'json' };
import prayers from '../../../data/prayers.json' with { type: 'json' };
import abilities from '../../../data/abilities.json' with { type: 'json' };
import strings from '../../../data/strings.json' with { type: 'json' };
import elements from '../../../data/elements.json' with { type: 'json' };
import combos from '../../../data/combos.json' with { type: 'json' };
import amulets from '../../../data/amulets.json' with { type: 'json' };
import progression from '../../../data/progression.json' with { type: 'json' };
import piety from '../../../data/piety.json' with { type: 'json' };
import { enchantSentence } from '../model/preview-words.js';
import { ATTRIBUTES, COMBAT, STAT_PASSIVE, RACE, CLASS, GOD, boonWords, titleLine, ATTR_NAME, ELEMENT_IDS, say as sayWords, cap } from '../model/words.js';
import { itemView, requirement, ringLine, lineText, TIER_COLOUR } from '../model/item-view.js';
import { ruleLine } from '../model/hero-view.js';
import { actionDetail } from './character.js';
import { SCORE_VERSION, scoreBreakdown } from '../../engine/reads.js';   // C17: the rules' answers through the engine (PLAN section 2)
import { sigilCost } from '../model/forge-view.js';
import { toNum } from '../core/colour.js';

/** Items side by side, wrapping onto the next line when the width runs out. */
function wrapRow(w, nodes) { const c = new Container(); nodes.forEach(n => c.addChild(n)); flow(nodes, w, space.betweenSections * 2, space.inRow); return c; }

const TABS = ['Achievements', 'Encyclopedia', 'Bestiary', 'Previous runs'];
const state = { tab: 'Achievements', page: 0, section: 'Attributes', query: '', place: '' };
let typing = false, sectionsOpen = false;
/** As 1.7's Journal: the tab and section stay for the session; the search and location start empty each opening. */
export const journalFresh = () => { Object.assign(state, { query: '', place: '', page: 0 }); typing = false; sectionsOpen = false; };

const named = book => Object.entries(book.rows).filter(([, r]) => r && r.name && r.kind !== 'rule');
const say = key => (key && strings.rows[key]) || '';
const sentence = s => (s ? cap(s) + (/[.!?]$/.test(s) ? '' : '.') : '');
const mods = m => Object.entries(m ?? {}).filter(([, v]) => v).map(([k, v]) => [ATTR_NAME[k] ?? k, (v > 0 ? '+' : '') + v]);
const locked = (name, how) => ({ name, dim: true, detail: { title: name, lines: [how] } });

const TIER_NAME = ['Worn', 'Plain', 'Fine', 'Masterwork'];
const WORD = { 'Max Mana': 'maximum Mana', 'Spell Mana cost': 'spell Mana cost', 'Divine Power': 'Divine Power', 'Deflect ranged attacks': 'chance to deflect ranged attacks' };
const FACT = new Set(['Hands', 'Range', 'Requires', 'Off-hand strike']);
const GEAR_BASICS = [
  { name: 'Quality and upgrades', detail: { title: 'Quality and upgrades', lines: [sayWords('journal.gear.quality')] } },
  { name: 'Hands and identification', detail: { title: 'Hands and identification', lines: [sayWords('journal.gear.hands')] } },
];

function gearEntries(book) {
  const out = [];
  for (const [id, r] of named(book)) {
    if (r.unarmed && id !== 'fists') continue;   // Chad's fists by rank are the Fists entry's
    const at = t => itemView({ id, tier: t, plus: 0 });
    const base = at(0), graded = base.colour !== null, rows = [], lines = [];
    if (r.kind === 'weapon') rows.push(['Hands', String(r.hands ?? 1)]);
    if (r.range) rows.push(['Base range', `${r.range} tiles`]);
    if (r.kind === 'weapon') rows.push(['Accuracy', (r.accuracy >= 0 ? '+' : '') + (r.accuracy ?? 0)]);
    if (r.light) rows.push(['Off hand', 'Light one-handed weapon']);
    if (r.unarmed) lines.push('Used when your hands are empty. Base damage 1-3. Unarmed combat can be changed by divine powers.');
    if (!graded) {
      rows.push(...base.detail.rows.filter(([k]) => !FACT.has(k) && !(r.kind === 'weapon' && k === 'Accuracy') && !(r.unarmed && k === 'Damage')));
      lines.push(...base.detail.lines.map(l => sentence(lineText(l))));
      out.push({ name: r.name, detail: { title: r.name, rows, lines } });
      continue;
    }
    const views = [0, 1, 2, 3].map(at), said = views.map(v => v.detail.lines.map(lineText));
    const same = said[0].filter(l => said.every(s => s.includes(l)));
    lines.push(...same.map(sentence));
    views.forEach((v, t) => {
      const vals = v.detail.rows.filter(([k]) => !FACT.has(k) && !(r.kind === 'weapon' && k === 'Accuracy')).map(([k, x]) => `${x} ${WORD[k] ?? k.toLowerCase()}`);
      vals.push(...said[t].filter(l => !same.includes(l)));
      const req = requirement(id, t, null);
      lines.push({ text: `${TIER_NAME[t]}: ${vals.join('; ') || 'no bonus'}. ${req ? `Requires ${req.text}.` : 'No attribute requirement.'}`, fill: TIER_COLOUR[t] });
    });
    out.push({ name: r.name, detail: { title: r.name, colour: TIER_COLOUR[1], rows, lines } });
  }
  return out;
}

function ringEntries(rec) {
  return named(rings).map(([id, r], i) => {
    if (!rec.rings?.[id]) return locked(`Undiscovered ring ${i + 1}`, 'Identify or recognize this ring type in a run.');
    const lines = [say(r.text)];
    if (id === 'mending') lines.push('Works while fed and not Poisoned; Rot prevents healing. A cursed Mending ring stops HP regeneration.');
    lines.push('A +0 ring has one point of power; each upgrade adds one. Cursed rings have negative power.');
    return { name: r.name, detail: { title: r.name, rows: [['At +0', ringLine(id, { plus: 0 }, {})]], lines: lines.filter(Boolean) } };
  });
}

function sigilEntries(rec) {
  return named(sigils).filter(([, r]) => r.kind === 'sigil').map(([id, r], i) => {
    if (!rec.sigils?.[id]) return locked(`Undiscovered sigil ${i + 1}`, 'Cast, craft or identify this sigil during a run.');
    const cost = sigilCost(id);
    return { name: r.name, detail: { title: r.name, rows: [['Recipe', r.motes.map(cap).join(' + ')], ['Carving cost', `${cost} essence`]], lines: [say(r.text), 'A consumable power. Appearances change each run.'].filter(Boolean) } };
  });
}

const PLURAL = { human: 'Humans', elf: 'Elves', dwarf: 'Dwarves', fae: 'Fae', gloomling: 'Gloomlings' };
function conduct(g) {
  const no = [...(g.refuses?.races ?? []).map(r => PLURAL[r] ?? r), ...(g.refuses?.classes ?? []).map(c => (classes.rows[c]?.name ?? c) + 's')];
  return [no.length ? 'No ' + no.join(' or ') : '', ruleLine(g)].filter(Boolean).join('. ') || 'None';
}
function godEntries(rec) {
  const out = [];
  for (const [id, g] of named(gods)) {
    const who = g.name.split(',')[0], best = rec.godRanks?.[id] ?? 0;
    out.push({ name: g.name, fill: toNum(g.color), detail: { title: g.name, sub: titleLine(g.title), rows: [['Conduct', conduct(g)]], lines: [GOD[id]?.favors, GOD[id]?.piety && `Piety: ${GOD[id].piety}`].filter(Boolean) } });
    const used = k => !!rec.godAbilities?.[k];
    if (g.invoke) {
      const nm = prayers.rows[g.invoke]?.name ?? abilities.rows[g.invoke]?.name ?? g.invoke;
      out.push(used('invoke:' + g.invoke) ? { name: nm, from: `${who}, invocation`, detail: actionDetail(g.invoke, nm, 'Cleric invocation', null) }
        : { ...locked('Cleric invocation', 'Successfully use this god’s invocation during a run.'), from: who });
    }
    const ranked = [
      ...g.boons.map(b => ({ rank: b.rank, e: best >= b.rank ? { name: b.name, from: `${who}, rank ${b.rank}`, detail: { title: b.name, sub: `Rank ${b.rank} boon`, lines: [boonWords(b.id)].filter(Boolean) } } : { ...locked(`Rank ${b.rank} boon`, `Reach faith rank ${b.rank} with ${who}.`), from: who } })),
      ...g.prayers.filter(p => prayers.rows[p]).map(p => { const pr = prayers.rows[p], rk = pr.rank ?? 1; return { rank: rk, e: used('pray:' + p) ? { name: pr.name, from: `${who}, rank ${rk} prayer`, detail: actionDetail(p, pr.name, `Rank ${rk} prayer`, null) } : { ...locked(`Rank ${rk} prayer`, 'Successfully use this prayer during a run.'), from: who } }; }),
    ].sort((a, b) => a.rank - b.rank);
    out.push(...ranked.map(x => x.e));
  }
  return out;
}

function raceEntries() {
  return named(races).map(([id, r]) => ({ name: r.name, detail: { title: r.name, sub: RACE[id]?.summary, rows: mods(r.mods),
    lines: [`${say('passive.race.' + id) || 'Passive'}: ${say(`passive.race.${id}.text`) || RACE[id]?.blurb || ''}`] } }));
}

function classEntries() {
  return named(classes).map(([id, c]) => ({ name: c.name, detail: { title: c.name, sub: CLASS[id]?.summary,
    rows: [...mods(c.mods), ['Abilities', (c.abilities ?? []).map(a => abilities.rows[a]?.name ?? a).join(', ') || (id === 'cleric' ? 'Invoke' : 'None')]],
    lines: CLASS[id]?.passive ? [`${c.passiveName ?? 'Passive'}: ${CLASS[id].passive}.`] : [] } }));
}

function statusEntries() {
  return named(statuses).map(([, r]) => {
    const rows = [];
    if (r.turns) rows.push(['Turns', r.turns]);
    if (r.element) rows.push(['Element', r.element]);
    return { name: r.name, detail: { title: r.name, rows, lines: [say(r.text) || r.title].filter(Boolean) } };
  });
}

const ATTR_ID = { Might: 'mig', Agility: 'agi', Vitality: 'vit', Focus: 'foc' };
function attributeEntries() {
  return ATTRIBUTES.map(([name, text]) => ({ name, detail: { title: name, lines: [text,
    ...(progression.rows['stat-passives'][ATTR_ID[name]] ?? []).map(sp => `${name} ${sp.at}, ${sp.name}: ${STAT_PASSIVE[sp.name] ?? ''}`)] } }));
}
const RANKS = piety.rows.ranks.thresholds.map((n, i) => `${i + 1} at ${n}`).join('; ');
const combatEntries = () => COMBAT.map(([name, text]) => ({ name, detail: { title: name, lines: [name.startsWith('Piety') ? `${text} Rank thresholds: ${RANKS}.` : text] } }));

const FIRST_PATH = {
  fire: ['Your direct hits deal extra fire damage.', '+1 fire damage per Fire affinity point.'],
  water: ['Absorbs damage before you lose HP. Recovers 1 point per turn after 5 turns without losing HP.', 'Shield capacity is 3 × Water affinity.'],
  air: ['Move faster.', '+10% movement speed per Air affinity point.'],
  earth: ['Reduces physical damage from ordinary hits. Heavy attacks bypass this protection.', 'Subtract 1 damage per Earth affinity point. Combined with armor, this flat reduction cannot remove more than half the hit.'],
  light: ['Weapon and single-target spell hits can trigger an extra light strike.', '10% chance per Light point. Deals 3-6 + Light affinity damage; no Spell power multiplier.'],
  shadow: ['Direct hits can deal extra shadow damage and heal you for the damage it deals.', '10% chance per Shadow point, up to 100%. Deals 2 × Shadow affinity damage; no Spell power multiplier.'],
};
const RANK3_TEXT = {
  fire: '+5% damage per Fire point against Burning enemies. Immune to Burning.',
  water: 'Your Chill slows by 33% + 3% per Water point (max 50%). Immune to Chill and Freeze.',
  air: 'Attacks and spell hits have a 10% chance per Air point to hit up to 2 nearby enemies within 4 tiles for half damage. Arcs do not trigger more arcs. Immune to Stun.',
  earth: 'Root also inflicts Poison for 1 turn (2 at Earth 4, 3 at Earth 5). Poison deals 10% max HP per turn (bosses 5%). Immune to Root.',
  light: 'Heal 1 HP per Light point whenever you deal light damage. Immune to Blind.',
  shadow: 'Hide after 10 quiet turns out of combat, 2 fewer per extra Shadow point (minimum 4). Immune to Fear.',
};
const RANK6 = {
  fire: { rows: [['Spread Burning', '2 + Fire affinity damage per turn for 3 turns.']] },
  air: { text: '15% of stationary attacks and spells take no time. Lightning damage also has a separate 15% chance to Stun for 1 turn. Immune to lightning.' },
  light: { text: 'Light spells and Smites bless the ground for 3 turns. It heals you and your allies, damages enemies and protects against nonphysical damage. Immune to light.',
    rows: [['Healing', '2% of maximum HP × Spell power per turn.'], ['Enemy damage', '(3 + Light affinity) × Spell power per turn; doubled against undead and shadow creatures.'], ['Protection', '+15 percentage points of nonphysical resistance × Spell power, up to 75% total resistance. Existing stronger resistance is preserved.']] },
};
const AREA = new Set(['fireball', 'frostcone', 'chainbolt', 'earthquake', 'radiantbeam', 'glacialtomb', 'upheaval']);
const SPELL_ROWS = {
  firebolt: [['Burning', '3 fire damage per turn for 3 turns. Does not scale with affinity or Spell power.']],
  frostshard: [['Chill', 'Builds toward freezing the target at 4 stacks.']],
  spark: [['Stun', '5% chance per Air affinity point; lasts 1 turn.']],
  root: [['Root', '2 turns; 1 against bosses.']],
  smite: [['Blind', '10% chance per Light affinity point; lasts 2 turns.'], ['Undead & shadow', '+50% damage.']],
  shadowbolt: [['Fear', '2 turns; 1 against bosses.']],
  fireball: [['Burning', '(2 + Fire affinity) × Spell power damage per turn for 3 turns.']],
  frostcone: [['Cone', '6 tiles long; applies Chill and knocks back 1 tile.']],
  chainbolt: [['Jumps', 'Up to 5 targets, each within 4 tiles of the last. No damage falloff between jumps.']],
  earthquake: [['Area', 'Within 5 tiles of you. Can hit your summons.']],
  radiantbeam: [['Blind', '5% chance per Light affinity point; lasts 2 turns.'], ['Undead & shadow', '+50% damage.']],
  shadowswarm: [['Summons', 'Up to 9 Shades. Replaces your previous swarm.']],
  livingflame: [['Duration', '30 turns.'], ['Shots', 'Range 6; every third shot splashes for half damage.'], ['Burning', '22% chance per shot; 2 + Fire affinity damage per turn for 3 turns.']],
  glacialtomb: [['Imprisonment', '10 turns; 6 for elites; 2 for bosses. Damage hits adjacent enemies.']],
  upheaval: [['Ridge', 'Up to 7 tiles wide for 20 turns. Target range stays at 7 tiles.'], ['Root', '2 turns; 1 against bosses. Can affect your summons.']],
  dawn: [['Blind', '3 turns.'], ['Reveal', 'All enemies for 20 turns.']],
  umbral: [['Destination', 'Explored, open ground with no adjacent enemy.'], ['Shadow', 'Lasts until destroyed or replaced by your next cast.']],
};
const TYPE_WORD = { phys: 'physical', ice: 'frost', dark: 'shadow' };
const NO_BASE = new Set(['shadowswarm', 'stormform', 'umbral', 'livingflame', 'dawn']);
/** The first damage roll in an ability's effects ([14, 22]), or null. */
function firstRoll(v) {
  if (!v || typeof v !== 'object') return null;
  if (Array.isArray(v.roll)) return v.roll;
  for (const x of Object.values(v)) { const r = firstRoll(x); if (r) return r; }
  return null;
}
function spellDetail(id, el, rank, rec) {
  const row = abilities.rows[id], name = row?.name ?? id;
  const d = actionDetail(id, name, `${cap(el)} ${rank}`, null);
  const roll = NO_BASE.has(id) ? null : firstRoll(row?.effects);
  const area = AREA.has(id) && rec.paths?.fire ? '(Base damage + Fire affinity) × Spell power.' : 'Base damage × Spell power.';
  let scaling = area;
  if (id === 'shadowswarm') scaling = 'Each Shade has 10 × Spell power HP, deals 10 × Spell power shadow damage, and lasts 5 × Spell power turns.';
  if (id === 'livingflame') scaling = '28 × Spell power HP; shots deal 5-9 × Spell power fire damage. Arrival damage: ' + (rec.paths?.fire ? '(14-22 + Fire affinity) × Spell power.' : '14-22 × Spell power.');
  if (id === 'stormform') scaling = 'Doubles movement and action speed. Duration starts at 6 turns and increases with beneficial-effect duration bonuses; no Air affinity or Spell power multiplier.';
  if (id === 'umbral') scaling = 'The shadow copies your weapons and combat stats when cast. No separate affinity or Spell power multiplier.';
  if (row?.effects?.[0]?.bolt) scaling += ' Focus and casting equipment increase Spell power.';
  const base = roll ? [['Base damage', `${roll[0]}-${roll[1]} ${TYPE_WORD[row.type] ?? row.type ?? ''}`.trim()]] : [];
  return { ...d, rows: [...base, ...d.rows, ['Scaling', scaling], ...(SPELL_ROWS[id] ?? [])] };
}
const ORDER = ELEMENT_IDS;
function pathEntries(rec) {
  const out = [];
  for (const el of ORDER) {
    const E = elements.rows[el], reached = rec.paths?.[el] ?? 0;
    for (let rank = 1; rank <= 6; rank++) {
      const label = `${E.name} ${rank}`;
      if (reached < rank) { out.push({ ...locked(label, `Reach ${label} in a run to discover this milestone.`), from: E.name }); continue; }
      const spell = E.abilities?.[String(rank)];
      if (rank === 1) {
        const nm = strings.rows[`element.${el}.rank1`] ?? E.perPoint?.name ?? label;
        out.push({ name: nm, from: label, detail: { title: nm, sub: label, rows: [['Scaling', FIRST_PATH[el][1]]], lines: [FIRST_PATH[el][0]] } });
      } else if (spell && abilities.rows[spell]) out.push({ name: abilities.rows[spell].name, from: label, detail: spellDetail(spell, el, rank, rec) });
      else {
        const nm = E[`rank${rank}`]?.name ?? label, six = rank === 6 ? RANK6[el] ?? {} : {};
        const text = rank === 3 ? RANK3_TEXT[el] : six.text ?? strings.rows[`element.${el}.rank6`] ?? '';
        out.push({ name: nm, from: label, detail: { title: nm, sub: label, rows: six.rows ?? [], lines: [text].filter(Boolean) } });
      }
    }
  }
  return out;
}

function comboEntries(rec) {
  const rule = combos.rows['combo-rule'], word = el => elements.rows[el]?.name ?? cap(el);
  const all = Object.entries(combos.rows).filter(([, c]) => c.kind === 'combo').map(([id, c]) => {
    const need = `${word(c.first)} ${rule.first} / ${word(c.second)} ${rule.second}`;
    return rec.combos?.[`${c.first}/${c.second}`]
      ? { name: c.name, from: need, detail: { title: c.name, sub: need, lines: [say(c.text ?? 'combo.' + id)].filter(Boolean) } }
      : { ...locked(need, `Hold ${need} in a run. The reverse order is a different combination.`), from: 'Undiscovered' };
  });
  return [...all.filter(e => !e.dim), ...all.filter(e => e.dim)];
}

const ENCHANT_KINDS = [['weapon', 'weapon', 'Weapons'], ['armor', 'armour', 'Armor'], ['shield', 'shield', 'Shields'], ['orb', 'orb', 'Orbs'], ['tome', 'tome', 'Tomes'], ['holy', 'holy', 'Holy Symbols']];
function enchantmentEntries(rec) {
  const out = [];
  for (const [kind, slot, label] of ENCHANT_KINDS) for (const el of ORDER) {
    const name = `${cap(el)} enchantment`;
    out.push(rec.enchantments?.[`${kind}/${el}`]
      ? { name, from: label, detail: { title: name, sub: label, lines: [enchantSentence(null, slot, el, { formula: true })].filter(Boolean) } }
      : { ...locked(name, `Enchant this equipment type with ${cap(el)}, or identify an item carrying this enchantment.`), from: label });
  }
  return out;
}

function amuletEntries(rec) {
  const C = amulets.rows.charges, most = C.capacityByLevel;
  return Object.entries(amulets.rows).filter(([, a]) => a?.kind === 'amulet').map(([id, a], i) => {
    if (!rec.amulets?.[id]) return locked(`Undiscovered amulet ${i + 1}`, 'Use or identify this amulet type in a run.');
    const range = a.values?.range, r = typeof range === 'number' ? range : range?.byLevel?.[0];
    const rows = [['Charges', `${most[0]} at level I; ${most[1]} at level II; ${most[2]} at level III`], ['Base recharge', `${a.killsPerCharge} kill${a.killsPerCharge === 1 ? '' : 's'} per charge`]];
    if (r) rows.push(['Base range', `${r} tile${r === 1 ? '' : 's'}`]);
    return { name: a.name, detail: { title: a.name, rows, lines: [say(a.text), `Elites and bosses count as ${C.eliteOrBossKillCounts} kills. Cursed amulets require ${Math.round((C.killsCursedMult - 1) * 100)}% more kills and unleash a trap instead of their power.`].filter(Boolean) } };
  });
}

const SECTIONS = {
  Attributes: attributeEntries, Combat: combatEntries, Races: raceEntries, Classes: classEntries, Gods: godEntries, Statuses: statusEntries,
  Weapons: () => [...GEAR_BASICS, ...gearEntries(weapons)], Armor: () => gearEntries(armour), 'Off hands': () => gearEntries(offhands),
  Paths: pathEntries, Combinations: comboEntries, Enchantments: enchantmentEntries, Rings: ringEntries, Amulets: amuletEntries, Sigils: sigilEntries,
};

/** One Encyclopedia section's entries, for the record `rec` (deps.journal()): [{ name, from?, dim?, detail }]. */
export const encyclopediaItems = (section, rec = {}) => (SECTIONS[section] ?? (() => []))(rec);

/**
 * W42 (1.7 journal.js:113-116): earned first, then those in progress, then the undiscovered, each keeping its order
 * (Justin 2026-10-15: "show the achievements you've earned up top").
 */
export function earnedFirst(list = []) {
  const rank = a => (a.have ? 0 : a.progress ? 1 : 2);
  return list.map((a, i) => ({ a, i })).sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i).map(x => x.a);
}

export function achievements(rec) {
  return (rec.achievements ?? []).map(a => a.have || a.progress
    ? { name: a.name, num: a.goal > 1 ? `${Math.min(a.progress ?? 0, a.goal)} / ${a.goal}` : null, dim: !a.have, detail: { title: a.name, lines: [a.text] },
      progress: !a.have && a.goal > 1 ? Math.min(a.progress ?? 0, a.goal) / a.goal : null }
    : { name: '???', dim: true, detail: { title: 'Not found yet', lines: [a.hint ?? 'Keep playing.'] } });
}

const ELEMENT_ORDER = ELEMENT_IDS;
const PLANE_OF = {};
for (const p of Object.values(planes.rows)) if (p?.roster) for (const id of [...p.roster.regulars, p.roster.elite]) PLANE_OF[id] = p;
PLANE_OF.crystalnode = PLANE_OF.heartlimb = planes.rows['plane-earth'];
const CHAOS_ISLAND = { 'prism-archives': [5, 'Prism Archives'], 'rot-hollows': [6, 'Rot Hollows'], 'cinder-bastion': [7, 'Cinder Bastion'], 'violet-warrens': [8, 'Violet Warrens'] };
const DEPTHS = ['Dungeon (depths 1-5)', 'Crypt (depths 6-10)', 'Caverns (depths 11-15)', 'Underdark (depths 16-20)', 'Chaos (depths 21-25)'];
const PLACED = { warchief: 0, morty: 1, phylactery: 1, shroomling: 2, wormtender: 2, mawlimb: 2, deepmaw: 2, matron: 3, 'silk-survivor-human': 3 };
/** { order, sub, name } for a creature (1.7 enemyLocation). */
export function creatureLocation(id, m) {
  const plane = PLANE_OF[id] ?? (m.spawn?.plane ? planes.rows['plane-' + m.spawn.plane] : null);
  if (plane) return { order: 20 + ELEMENT_ORDER.indexOf(plane.element), sub: 0, name: `${plane.themeName} (${cap(plane.element)} plane)` };
  const island = CHAOS_ISLAND[m.spawn?.chaosIsland];
  if (island) return { order: island[0], sub: 0, name: `${island[1]} (Chaos)` };
  if (id.startsWith('unmaker-')) return { order: 9, sub: 0, name: 'Crucible (Chaos)' };
  if (m.elementTier) return { order: m.elementTier === 1 ? 0 : m.elementTier, sub: 1, name: ['Dungeon and Crypt', 'Caverns', 'Underdark'][m.elementTier - 1] + ' (elemental creatures)' };
  if (id === 'mimic' || id.startsWith('mimic-')) return { order: 0, sub: 2, name: 'Dungeon and treasure rooms' };
  const first = m.spawn?.floors?.[0];
  const band = PLACED[id] ?? (first >= 1 && first <= 25 ? Math.floor((first - 1) / 5) : undefined);
  if (band === undefined) return { order: 30, sub: 0, name: 'Other encounters' };
  return { order: band, sub: 0, name: DEPTHS[band] };
}

const stills = new Map();
function stillTexture(key) {
  if (!hasSheet(key)) return null;
  const sh = sheet(key), base = sh.textures.static ?? sh.textures['idle-0'] ?? Object.values(sh.textures)[0];
  if (!base) return null;
  const was = stills.get(key);
  if (was && was.source === base.source && !was.tex.destroyed) return was.tex;
  const cell = sh.data.meta?.cell ?? base.frame.width, [bx, by, bw, bh] = sh.data.meta?.box ?? [0, 0, cell, cell];
  const f = base.frame, x = Math.max(0, bx), y = Math.max(0, by);
  const tex = new Texture({ source: base.source, frame: new Rectangle(f.x + x, f.y + y, Math.min(bw, f.width - x), Math.min(bh, f.height - y)) });
  stills.set(key, { source: base.source, tex });
  return tex;
}
function creatureStill(kit, m) {
  const key = m.look?.sheet && bodySheet(m.look);
  return size => {
    const c = new Container();
    c.addChild(new Graphics().roundRect(0, 0, size, size, 4).fill({ color: 0x000000, alpha: 0.18 }));
    const draw = () => {
      const t = stillTexture(key);
      if (!t || c.destroyed) return false;
      const s = new Sprite(t), k = size * 0.9 / Math.max(t.width, t.height);
      s.scale.set(k); s.position.set(Math.round((size - t.width * k) / 2), Math.round((size - t.height * k) / 2));
      c.addChild(s);
      return true;
    };
    if (!m.look?.sheet || draw()) return c;
    const glyph = kit.text(m.look?.glyph ?? '?', { size: 20, font: 'mono', fill: m.look?.colour ? toNum(m.look.colour) : kit.accent });
    glyph.position.set(Math.round((size - glyph.width) / 2), Math.round((size - glyph.height) / 2));
    c.addChild(glyph);
    queueMicrotask(() => { if (!c.destroyed) loadSheet(`sheets/${key}.json`, { background: true }).then(() => { if (!c.destroyed && draw()) glyph.destroy(); }, () => {}); });
    return c;
  };
}

function bestiary(kit, rec) {
  const met = rec.creatures ?? {};
  return Object.entries(monsters.rows).filter(([id, m]) => met[id] && m?.name).map(([id, m]) => ({ id, m, at: creatureLocation(id, m) }))
    .sort((a, b) => a.at.order - b.at.order || a.at.sub - b.at.sub || a.at.name.localeCompare(b.at.name) || a.m.name.localeCompare(b.m.name))
    .map(({ id, m, at }) => ({
      name: m.name, num: `${met[id]} slain`, from: at.name, place: at.name, pic: creatureStill(kit, m),
      detail: creatureDetail(m, at),
    }));
}

const TRAITS = [['boss', 'Boss'], ['elite', 'Elite'], ['undead', 'Undead'], ['flying', 'Flying'], ['spellcaster', 'Spellcaster'], ['heavy', 'Heavy'], ['tiny', 'Tiny']];
export function creatureDetail(m, at) {
  const flags = new Set(m.flags ?? []), traits = TRAITS.filter(([f]) => flags.has(f)).map(([, w]) => w);
  if (m.element) traits.push(`${elements.rows[m.element]?.name ?? cap(m.element)} element`);
  const reach = Number.isFinite(m.range) ? m.range : 1;
  const rows = [['HP', m.hp], ['Damage', `${m.dmg[0]}-${m.dmg[1]}`], ['Accuracy', m.acc], ['Evasion', m.eva], ['Armor', m.armour ?? 0], ['Speed', m.speed ?? 100],
    ['Attack range', `${reach} tile${reach === 1 ? '' : 's'}`], ['XP', m.xp]];
  if (traits.length) rows.push(['Traits', traits.join(', ')]);
  if (m.immune?.length) rows.push(['Status immunities', m.immune.map(s => statuses.rows[s]?.name ?? cap(s)).join(', ')]);
  const lore = say(m.text?.lore), hint = say(m.text?.hint);
  return { title: m.name, sub: at?.name, rows, lines: [lore || 'An unfamiliar creature.', hint && hint !== lore ? hint : null].filter(Boolean) };
}

const plainOf = v => (typeof v === 'string' || typeof v === 'number' ? String(v) : v?.text ?? '');
export function entryMatches(it, query) {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  if (it.name === '???') return '???'.includes(q);
  const d = it.detail ?? {};
  const words = [it.name, it.from, it.num, d.title, d.sub, ...(d.rows ?? []).flatMap(r => [r[0], r[1]]), ...(d.lines ?? [])];
  return words.filter(w => w !== undefined && w !== null).map(plainOf).join(' ').toLocaleLowerCase().includes(q);
}

/** The search field, the count of entries shown, and on the Bestiary the Location picker (1.7 journalControls). */
function controls(kit, area, ctx, shown, total, places) {
  const touch = kit.stage.touch, h = touch ? kit.target : 30;
  const fw = Math.min(260, area.w);
  const field = new Container();
  field.addChild(new Graphics().roundRect(0, 0, fw, h, 4).fill({ color: 0x000000, alpha: 0.35 }).stroke({ color: typing ? kit.accent : color.rest, width: 1, alpha: typing ? 0.9 : 0.4 }));
  const words = kit.text(typing ? state.query + '|' : state.query || 'Search this section', { size: 14, fill: state.query || typing ? color.ink : color.dim });
  const room = fw - 16;
  if (words.width > room) { let end = words.text.length; const full = words.text; while (words.width > room && end > 1) words.text = full.slice(0, --end).trimEnd() + '…'; }
  words.position.set(8, Math.round((h - words.height) / 2));
  field.addChild(words);
  field.label = 'journal-search';
  kit.control(field, () => {
    const g = field.getGlobalPosition(), st = kit.stage;
    typing = true;
    editText(st, { x: (g.x - st.ox) / st.s, y: (g.y - st.oy) / st.s, w: fw, h }, state.query, {
      max: 40,
      onInput: v => { state.query = v; state.page = 0; ctx.reopen(); },
      onDone: v => { typing = false; state.query = v; state.page = 0; ctx.reopen(); },
    });
    ctx.reopen();
  });
  const count = kit.text(`${shown} of ${total} entries`, { size: 14, fill: color.ash });
  const parts = [field, count];
  if (places) {
    const all = ['', ...places], at = Math.max(0, all.indexOf(state.place));
    const step = d => { state.place = all[(at + d + all.length) % all.length]; state.page = 0; ctx.reopen(); };
    const prev = kit.button('‹', () => step(-1), { size: 22, font: 'body' }), next = kit.button('›', () => step(1), { size: 22, font: 'body', tight: true });
    prev.label = 'place-prev'; next.label = 'place-next';
    const name = kit.text(state.place || 'All locations', { size: 14, fill: state.place ? color.ink : color.ash });
    const label = kit.text('Location', { size: 14, fill: color.dim });
    const picker = row([label, prev, name, next], space.inRow);
    picker.label = 'journal-location';
    parts.push(picker);
  }
  const c = wrapRow(area.w, parts);
  for (const p of parts) if (p !== field) p.y += Math.max(0, Math.round((h - p.height) / 2));
  return c;
}

const SCORE_SHOWN = ['Total XP earned', 'Total essence earned', 'Level multiplier', 'God rank multiplier', 'Victory multiplier'];
function scoreRows(r) {
  if ((r.scoreVersion ?? SCORE_VERSION) !== SCORE_VERSION) return { rows: [], lines: ['Score recorded under different scoring rules.'] };
  const b = scoreBreakdown(r), by = Object.fromEntries(b.rows);
  return { rows: SCORE_SHOWN.map(k => [k, typeof by[k] === 'number' ? by[k].toLocaleString('en-US') : by[k]]), lines: [`How this score was earned: ${b.words[0].toLowerCase()}${b.words.slice(1)}`] };
}
export function runs(kit, rec, open) {
  const out = [];
  let group = null, rank = 0;
  for (const r of rec.runs ?? []) {
    const current = (r.scoreVersion ?? SCORE_VERSION) === SCORE_VERSION, g = `${!!r.won}-${r.scoreVersion}`;
    if (g !== group) { group = g; rank = 0; out.push({ name: `${r.won ? 'Victories' : 'Other runs'}${current ? '' : ', earlier scoring'}`, fill: kit.accent }); }
    rank += 1;
    const cause = r.cause || 'Not recorded', how = scoreRows(r);
    out.push({
      name: `${rank}  ${r.name}, ${r.who}`, num: (r.score ?? 0).toLocaleString('en-US'),
      from: r.won ? `Victory, deepest floor ${r.deepest}` : `Fallen on floor ${r.floor ?? r.deepest}: ${cause}`,
      detail: { title: r.name, sub: r.who, rows: [['Result', r.won ? 'Victory' : 'Fallen'], ...(r.won ? [] : [['Cause of death', cause]]), ['Score', (r.score ?? 0).toLocaleString('en-US')],
        ['Deepest floor', r.deepest], ['Level', r.level], ['Kills', r.kills], ['Turns', r.turns], ['Faith', r.faithRank ? `${r.faith}, rank ${r.faithRank}` : r.faith ?? 'None'], ...how.rows, ['Date', r.date]], lines: how.lines },
      side: open ? { words: 'Run report', act: () => open('Report', { ...r, from: 'journal' }), label: 'run-report' } : undefined,
    });
  }
  return out;
}

/**
 * @param {ReturnType<import('../core/widgets.js').createKit>} kit
 * @param {{w:number,h:number}} area
 * @param {{deps:any, reopen:()=>void}} ctx
 */
export function buildJournal(kit, area, ctx) {
  const rec = ctx.deps.journal?.() ?? {};
  const P = kit.stage.kind === 'P', cols = area.w >= 900 ? 3 : area.w >= 560 ? 2 : 1;
  const got = (rec.achievements ?? []).filter(a => a.have).length, all = (rec.achievements ?? []).length;
  const head = wrapRow(area.w, [
    row([kit.text(String(rec.deepest ?? 0), { size: 16, fill: color.ink, weight: '600' }), kit.text('Deepest floor', { size: 14, fill: color.ash })], space.inRow),
    row([kit.text(`${got} / ${all}`, { size: 16, fill: color.ink, weight: '600' }), kit.text('Achievements', { size: 14, fill: color.ash })], space.inRow),
    row([kit.text(String(Object.keys(rec.creatures ?? {}).length), { size: 16, fill: color.ink, weight: '600' }), kit.text('Creatures', { size: 14, fill: color.ash })], space.inRow),
  ]);
  const set = (k, v) => { state[k] = v; if (k !== 'page') state.page = 0; if (k === 'tab' || k === 'section') { state.query = ''; state.place = ''; sectionsOpen = false; } ctx.reopen(); };
  const plates = (list, on, pick, o) => {
    const c = new Container(), w = o.w ?? 0;
    const compact = P && kit.stage.form === 'phone' && o.prefix === 'journal-';
    const ps = list.map(t => Object.assign(compact ? kit.button(t, () => pick(t), { size: 14, selected: on === t, w: Math.floor((area.w - 8) / 2) }) : kit.plateButton(t, () => pick(t), { h: Math.max(o.h, kit.target), size: o.size, w, rank: on === t ? 'prominent' : 'subdued' }), { label: o.prefix + t }));
    ps.forEach(p => c.addChild(p));
    flow(ps, area.w, o.gap, o.gap);
    return c;
  };
  const tabs = plates(TABS, state.tab, t => set('tab', t), { h: P ? 34 : 36, size: P ? 14 : 16, gap: P ? 4 : 12, prefix: 'journal-', w: P ? Math.floor((area.w - 12) / 4) : 0 });
  let sub = null, items;
  if (state.tab === 'Achievements') items = achievements({ ...rec, achievements: earnedFirst(rec.achievements) });
  else if (state.tab === 'Encyclopedia') {
    const choices = () => plates(Object.keys(SECTIONS), state.section, k => set('section', k), { h: 30, size: 14, gap: 6, prefix: 'section-' });
    if (P && kit.stage.form === 'phone') {
      const choose = kit.plateButton(state.section + (sectionsOpen ? ' ▴' : ' ▾'), () => { sectionsOpen = !sectionsOpen; ctx.reopen(); }, { h: kit.target, size: 14 });
      choose.label = 'section-chooser';
      sub = stack([choose, sectionsOpen ? choices() : null], space.betweenRows);
    } else sub = choices();
    items = encyclopediaItems(state.section, rec);
  } else if (state.tab === 'Bestiary') items = bestiary(kit, rec);
  else items = runs(kit, rec, ctx.open);
  let find = null;
  if (state.tab !== 'Previous runs') {
    const places = state.tab === 'Bestiary' ? [...new Set(items.map(it => it.place))] : null;
    if (places && state.place && !places.includes(state.place)) state.place = '';
    const total = items.length;
    items = items.filter(it => (!places || !state.place || it.place === state.place) && entryMatches(it, state.query));
    find = controls(kit, area, ctx, items.length, total, places?.length ? places : null);
  }
  const stored = rec.stored === false ? kit.text('Browser storage is unavailable. New progress is remembered for this session only.', { size: 14, fill: color.ash, wrap: area.w }) : null;
  if (stored) stored.label = 'journal-storage';
  const top = stack([head, stored, tabs, sub, find].filter(Boolean), space.betweenRows);
  const empty = state.query.trim() ? 'No discovered information matches this search.' : { Achievements: 'No achievements yet.', Bestiary: 'Defeat an enemy to record it here.', 'Previous runs': 'No runs finished yet.', Encyclopedia: 'Nothing here yet.' }[state.tab];
  const body = items.length ? paged(kit, items, area.w, area.h - top.height - space.betweenSections, state.tab === 'Previous runs' ? 1 : cols, state.page, n => set('page', n)) : none(kit, empty, area.w);
  return stack([top, body], space.betweenSections);
}
