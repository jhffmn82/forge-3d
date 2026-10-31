// An item as the windows show it: icon, one-line name, and the numbers for its hover card (packet C data).
// An item in the state is { id, tier?, plus?, count? }; its kind comes from whichever data file holds the id.
// The card says what the item does, as 1.7's gear cards do (js/engine/gear-cards.js, js/equipment/gear.js:53-97,
// js/equipment/tiers.js:160-183 @3c8b312): the live numbers at the hero's tier, plus and gear bonus, the item's note,
// its enchant at the hero's affinity, what a ring or amulet does, the requirement in green or red, and the curse in red.

import weapons from '../../../data/weapons.json' with { type: 'json' };
import armour from '../../../data/armour.json' with { type: 'json' };
import offhands from '../../../data/offhands.json' with { type: 'json' };
import rings from '../../../data/rings.json' with { type: 'json' };
import amulets from '../../../data/amulets.json' with { type: 'json' };
import foods from '../../../data/foods.json' with { type: 'json' };
import tiers from '../../../data/tiers.json' with { type: 'json' };
import strings from '../../../data/strings.json' with { type: 'json' };
import ui from '../../../data/ui.json' with { type: 'json' };
import tuning from '../../../data/tuning.json' with { type: 'json' };
import sigils from '../../../data/sigils.json' with { type: 'json' };
import { sigilFacts } from './action-facts.js';
import { raceRangeBonus, amuletValues, killsNeeded, capacity, value, weaponDamage, ringPower, armourValue, gearRequirement, itemName, trinketKnown, sigilName, sigilKnown, sigilForbidden } from '../../engine/reads.js';
import { itemArtName } from '../core/art.js';   // C17: render through ui/core; item 325: the floor's own picture name
import { AFFINITY_HIGHLIGHT } from '../core/widgets.js';
import { enchantLive } from './preview-words.js';
import { card, fill, cap } from './words.js';
import { tone, toNum } from '../core/colour.js';

const BOOKS = [weapons, armour, offhands, rings, amulets, foods];
const TIER_IDS = ['worn', 'plain', 'fine', 'masterwork'];
// 1.7's card colours: a curse and an unmet requirement red, a met one green, the unidentified hint violet.
const BAD = tone('bad'), GOOD = tone('good'), UNID = tone('unid');
/** I1: the quality colour by tier index, from the tiers.json token (tier.worn ...) through data/ui.json tier. */
export const TIER_COLOUR = TIER_IDS.map(id => toNum(ui.tier[tiers.rows[id].colour.split('.')[1]]));

const rowFor = id => { for (const b of BOOKS) if (b.rows[id]?.name) return b.rows[id]; return null; };
const atTier = (v, t) => (v && typeof v === 'object' && v.tiers ? v.tiers[Math.min(t, v.tiers.length - 1)] : v);
const text = key => (key && strings.rows[key]) || '';
const num = v => String(Number(Number(v).toFixed(2)));
const signed = v => (v >= 0 ? '+' : '') + num(v);
const pct = v => `${v >= 0 ? '+' : ''}${Math.round(v)}%`;
const cursedLine = { text: 'Cursed: cannot unequip until cleansed.', fill: BAD };

/** One value of an item's row for the card: the rules' value(), curse shapes and all (spec/items.md I15-I19; C4, ui-02). */
function cardValue(row, key, it, hero) {
  const shape = row.values?.[key];
  return shape === undefined ? 0 : value(shape, { ...it, tier: it.tier ?? 0, plus: it.plus ?? 0 }, hero);
}

/** I6 (1.7 reqRow): the requirement at the item's tier, or null (Worn, or an item with none). */
export function requirement(id, tier, hero) {
  const r = gearRequirement(hero, { id, tier });
  return r && { text: r.text, met: r.met };
}

/** 1.7 unidHint: how this piece is learned. */
function unidHint(kind) {
  const how = kind === 'ring' ? 'wear it for a while' : kind === 'amulet' ? 'use it a few times' : kind === 'weapon' ? 'fight with it' : kind === 'armour' ? 'take hits in it' : 'carry it into a few fights';
  return { text: `Unidentified; may be cursed. Learn it: ${how} or use a Sigil of Knowledge.`, fill: UNID };
}

/** The enchant slot an off-hand takes (upgrades.json enchant-slots): a shield, the orb, the tome or the holy symbol. */
const enchantSlot = (kind, row) => (kind === 'weapon' ? 'weapon' : kind === 'armour' ? 'armour' : row.enchantSlot ?? row.family);

function enchantRows(it, kind, row, hero, rows, lines) {
  if (!it.enchant) return;
  rows.push(['Enchant', cap(it.enchant), AFFINITY_HIGHLIGHT[it.enchant]]);
  const live = enchantLive(hero, enchantSlot(kind, row), it.enchant);
  if (live) lines.push(live);
}

/** A gear card's own lines (strings.json item-card.<id>, U6 ui-14): its rows join `rows`, red where marked. */
function cardRows(id, row, it, hero, rows) {
  const c = card('item-card.' + id, { v: k => cardValue(row, k, it, hero), cursed: !!it.cursed || (it.plus ?? 0) < 0 });
  for (const [label, value, bad] of c?.rows ?? []) rows.push(bad ? [label, value, BAD] : [label, value]);
  return c;
}

/** 1.7 weaponPassiveNote: the live number for a crit, pierce or executioner weapon, else its note. */
function weaponNote(id, row, it, hero) {
  const crit = cardValue(row, 'critPct', it, hero), pierce = cardValue(row, 'armourPierce', it, hero);
  if (strings.rows['item-note.' + id]) return fill(strings.rows['item-note.' + id]);
  if (pierce) return `ignores ${num(pierce)} armor`;
  if (crit) return `+${num(crit)}% crit chance`;
  return text(row.text);
}


function weaponCard(id, row, it, hero, rows, lines) {
  const unknown = it.known === false;
  if (unknown) rows.push(['Damage', '?']);
  else if (Array.isArray(row.damage)) rows.push(['Damage', row.damage.join('-')]);
  else { const [lo, hi] = weaponDamage({ ...it, tier: it.tier ?? 0, plus: it.plus ?? 0 }, hero); rows.push(['Damage', `${lo}${lo < 0 ? ' to ' : '-'}${hi}`]); }
  if (!unknown) rows.push(['Accuracy', signed(row.accuracy ?? 0)]);
  rows.push(['Hands', String(row.hands ?? 1)]);
  // G14 (1.7 gear-cards.js:22): the range with the race's bonus (an Elf's bow reaches 7).
  if (row.range) rows.push(['Range', String(row.range + (unknown ? 0 : raceRangeBonus(hero)))]);
  if (unknown) return;
  enchantRows(it, 'weapon', row, hero, rows, lines);
  if (row.values?.divinePct) rows.push(['Divine Power', pct(cardValue(row, 'divinePct', it, hero))]);
  const own = cardRows(id, row, it, hero, rows);   // 1.7 focusRows: the staff's and wand's spell numbers
  const note = own?.noNote ? '' : weaponNote(id, row, it, hero);   // a card whose rows say it all has no note (lead 10-18)
  if (note) lines.push(note);
}

function armourCard(id, row, it, hero, rows, lines) {
  const ev = value(row.evasion ?? 0, { ...it, plus: it.plus ?? 0 }, hero);
  if (it.known === false) { rows.push(['Armor', '?'], ['Evasion', num(atTier(row.evasion ?? 0, it.tier ?? 0))]); return; }
  rows.push(['Armor', String(armourValue({ ...it, tier: it.tier ?? 0 }, hero))], ['Evasion', signed(ev)]);
  enchantRows(it, 'armour', row, hero, rows, lines);
  cardRows(id, row, it, hero, rows);
  const note = text(row.text);
  if (note) lines.push(note);
}

function offhandCard(id, row, it, hero, rows, lines) {
  if (it.known === false) return;
  if (row.block) rows.push(['Block', `${Math.round(atTier(row.block, it.tier ?? 0) + (it.plus ?? 0) * (row.block.perPlus ?? 0))}%`]);
  const own = cardRows(id, row, it, hero, rows);   // the orb's, buckler's, tome's and Holy Symbol's (CF18) numbers
  enchantRows(it, 'offhand', row, hero, rows, lines);
  const note = own?.noNote ? '' : text(row.text);
  if (note) lines.push(note);
}

/** 1.7 ringLine: the ring's live effect at its power and the hero's gear bonus. */
export function ringLine(id, it, hero) {
  const row = rings.rows[id], v = k => value(row.values[k], { ...it, plus: it.plus ?? 0 }, hero), cursed = ringPower({ plus: it.plus ?? 0 }) < 0;
  // strings.json ring-line.<id> (and .cursed): the ring's words, its numbers from value() (U6, ui-14).
  const c = (cursed && card(`ring-line.${id}.cursed`, { v, cursed })) || card(`ring-line.${id}`, { v, cursed });
  return c?.rows.map(([words]) => words).join('') ?? '';
}

/** 1.7 ringSummary: the live bonus once, with the conditions the number alone cannot say (the Passives list). */
export function ringSummary(id, it, hero) {
  if (it.known === false) return 'Strength unknown until identified.';
  const line = ringLine(id, it, hero), cursed = ringPower({ plus: it.plus ?? 0 }) < 0;
  const t = (cursed && strings.rows[`ring-summary.${id}.cursed`]) || strings.rows[`ring-summary.${id}`];   // strings.json ring-summary.<id>
  return t ? fill(t, { line }) : line + '.';
}

function ringCard(id, row, it, hero, kindKnown, rows, lines) {
  const cursed = !!it.cursed || (it.plus ?? 0) < 0;
  if (kindKnown) lines.push(cursed && it.known !== false && text(row.text + '.cursed') ? text(row.text + '.cursed') : text(row.text));
  if (it.known !== false) rows.push(['Effect', ringLine(id, it, hero), cursed ? BAD : undefined]);
}

/** 1.7 AMULET_LIVE facts at the amulet's level (strings.json amulet-facts.<id>, its numbers from the row; U6 ui-14). */
const amuletFacts = (id, v) => card('amulet-facts.' + id, v)?.rows ?? [];

function amuletCard(id, row, it, kindKnown, rows, lines) {
  const known = it.known !== false, cursed = !!it.cursed, level = Math.min(3, Math.max(1, it.level ?? 1)), most = capacity(it);
  if (kindKnown) {
    if (cursed && known) { lines.push({ text: 'Cursed: triggers a random trap instead of its normal power.', fill: BAD }); }
    else { lines.push(text(row.text)); rows.push(...amuletFacts(id, amuletValues(it))); }
    rows.push(['Cost', '1 charge'], ['Kills per charge', known ? String(killsNeeded(it)) : '?']);
  }
  const charges = it.charges ?? amulets.rows.charges.startCharges;
  rows.push(['Charges', `${charges} / ${most}`]);
  if (known && charges < most) { const n = Math.max(1, killsNeeded(it) - (it.progress ?? 0)); rows.push(['Next charge', `${n} more kill${n === 1 ? '' : 's'}`]); }
  if (kindKnown && !(cursed && known) && text(row.text + '.note')) lines.push(text(row.text + '.note'));
  if (cursed && known) lines.push({ text: fill(strings.rows['amulet.cursed-kills']), fill: BAD });
  lines.push(fill(strings.rows['amulet.level'], { level }));
}

/**
 * @param {{id:string, kind?:string, tier?:number, plus?:number, count?:number}|null|undefined} it
 * @param {any} [state] the game, so a sigil shows its rune until its kind is known this run (rules/sigils.js)
 * @param {{worn?:boolean}} [o] worn: the piece is on the hero, so its card has no requirement row and a Holy Symbol shows the god's disc
 */
export function itemView(it, state = null, o = {}) {
  if (!it) return null;
  if (it.kind === 'sigil') {
    const name = state ? sigilName(state, it.id) : it.name ?? it.id;
    // CD22, G22 (1.7 bagCard sigil branch, gear-cards.js:88): a read sigil says what it does with this hero's numbers
    // (action-facts.js sigilFacts; the sigil.* words without a hero), and a sigil the god will refuse says so in red.
    const read = !state || sigilKnown(state, it.id), live = read && state ? sigilFacts(it.id, state) : null;
    const lines = !read ? [] : live ? [live.summary, ...live.notes].filter(Boolean) : [text(sigils.rows[it.id]?.text)].filter(Boolean);
    const barred = read && state ? sigilForbidden(state, it.id) : '';
    if (barred) lines.push({ text: barred, fill: BAD });
    return { id: it.id, kind: 'sigil', name, icon: itemArtName(state, it), count: it.count ?? 1, barred: !!barred,
      detail: { title: name, sub: read ? 'Sigil' : 'Unread sigil', rows: live?.rows ?? [], lines } };
  }
  const row = rowFor(it.id);
  // Items with no data row yet (sigils wait on their packet) show the name and icon they carry.
  // G20 (1.7 trinketCard): an amulet whose kind is gone from the data says it has lost its power.
  if (!row) return { id: it.id, kind: it.kind ?? null, name: it.name ?? it.id, icon: itemArtName(state, it), count: it.count ?? 1,
    detail: { title: it.name ?? it.id, lines: it.kind === 'amulet' ? ['This amulet has lost its power.'] : [] } };
  const hero = state?.hero ?? {};
  const t = it.tier ?? 0;
  // 1.7 itemKey: the camera, the shirt and fists have no quality, so no colour.
  const graded = (row.kind === 'weapon' || row.kind === 'armour' || row.kind === 'offhand') && !row.keepsake && !row.unarmed;
  const colour = graded ? TIER_COLOUR[Math.min(3, t)] : null;
  // The rules' name (rules/pickup.js itemName, I1, I50-I52): no prefix for Plain, "Name?" while unidentified; a ring or
  // amulet whose kind is not learned this run shows only its look ('Jade ring').
  const name = itemName({ kind: row.kind, ...it, tier: t }, state);
  const unknown = it.known === false;
  const trinket = row.kind === 'ring' || row.kind === 'amulet';
  const kindKnown = !trinket || !unknown || trinketKnown(state, it.id);
  // Item 325: the picture the floor draws it with (art.js itemArtName): a ring's or amulet's run look (I44, I48), and a
  // worn Holy Symbol its holder's god's disc (EQ20, W32; 1.7 equip.js:223-228, sheets.js:205-208), plain elsewhere.
  const icon = itemArtName(state, it, { worn: o.worn, hero });
  const rows = [], lines = [];
  if (row.kind === 'weapon') {
    weaponCard(it.id, row, it, hero, rows, lines);
    if (o.slot === 'off') rows.push(['Off-hand strike', `${Math.round(tuning.rows['weapon-damage'].offhandMult * 100)}% damage`]);
  } else if (row.kind === 'armour') armourCard(it.id, row, it, hero, rows, lines);
  else if (row.kind === 'offhand') offhandCard(it.id, row, it, hero, rows, lines);
  else if (row.kind === 'ring') ringCard(it.id, row, it, hero, kindKnown, rows, lines);
  else if (row.kind === 'amulet') amuletCard(it.id, row, it, kindKnown, rows, lines);
  else if (row.kind === 'food') {
    // 1.7 bagCard food: a Ring of Sustenance stretches the buff, and the card says to how long.
    const turns = row.effects?.find(e => e.verb === 'apply-status')?.turns ?? 0;
    const mult = ['ring1', 'ring2'].map(s => hero.worn?.[s]).filter(r => r?.id === 'sustenance' && ringPower({ plus: r.plus ?? 0 }) > 0)
      .reduce((a, r) => a + value(rings.rows.sustenance.values.foodBuffMult, { ...r, plus: r.plus ?? 0 }, hero), 0);
    const long = Math.round(turns * (1 + mult / 100));
    lines.push([text(row.text), long > turns ? `Your ring stretches it to ${long} turns.` : '', `Restores ${row.nutrition} hunger.`].filter(Boolean).join(' '));
  }
  const cursed = !!it.cursed || (it.plus ?? 0) < 0;
  if (unknown) lines.push(unidHint(row.kind));
  else if (cursed && row.kind !== 'amulet') lines.push(cursedLine);
  const req = graded && !o.worn ? requirement(it.id, t, hero) : null;
  if (req) rows.push(['Requires', req.text, req.met ? GOOD : BAD]);
  return {
    id: it.id, kind: row.kind, name, icon, count: it.count ?? 1, tier: t, colour, unmet: !!req && !req.met,
    // W12 (1.7 slotHTML): a known enchant and a known curse show on the worn slot.
    enchant: !unknown && it.enchant ? it.enchant : null, cursed: !unknown && cursed,
    detail: { title: name, colour: colour ?? undefined, pip: colour ?? undefined, rows, lines },
  };
}

/**
 * 1.7 sheets.js:173-180: what worn gear gives all the time, for the Character sheet's Passives: each ring's live summary,
 * the main weapon's note and enchant, the armour's and the off-hand's enchant. [{ name, text }].
 */
export function gearPassives(state) {
  const hero = state?.hero, w = hero?.worn ?? {}, out = [];
  const nameOf = it => itemName({ kind: rowFor(it.id)?.kind, ...it, tier: it.tier ?? 0 }, state);
  for (const s of ['ring1', 'ring2']) { const r = w[s]; if (r && rings.rows[r.id]) out.push({ name: nameOf(r), text: ringSummary(r.id, r, hero) }); }
  const known = it => it && it.known !== false;
  const m = w.main, mRow = m && weapons.rows[m.id];
  if (mRow && !mRow.unarmed) {
    const note = known(m) ? weaponNote(m.id, mRow, m, hero) : '', ench = known(m) && m.enchant ? enchantLive(hero, 'weapon', m.enchant) : '';
    if (note || ench) out.push({ name: nameOf(m), text: [note, ench].filter(Boolean).join(' · ') });
  }
  const a = w.armour;
  if (known(a) && a.enchant && armour.rows[a.id]) { const t = enchantLive(hero, 'armour', a.enchant); if (t) out.push({ name: nameOf(a), text: t }); }
  const o = w.off, oRow = o && offhands.rows[o.id];
  if (known(o) && o.enchant && oRow) { const t = enchantLive(hero, enchantSlot('offhand', oRow), o.enchant); if (t) out.push({ name: nameOf(o), text: t }); }
  return out;
}

/** A card line as plain words (lines may carry a colour: { text, fill }). */
export const lineText = l => (typeof l === 'string' ? l : l?.text ?? '');
