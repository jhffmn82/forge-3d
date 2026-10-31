// The hero: made from a creation choice with packet A's data (spec/character.md A1-A20), and the commands
// the windows send (spend a point, equip, unequip, drop). Derived numbers are in derive.js.

import races from '../../data/races.json' with { type: 'json' };
import courts from '../../data/courts.json' with { type: 'json' };
import classes from '../../data/classes.json' with { type: 'json' };
import progression from '../../data/progression.json' with { type: 'json' };
import piety from '../../data/piety.json' with { type: 'json' };
import gods from '../../data/gods.json' with { type: 'json' };
import { makeItem, itemRow } from './items.js';
import loot from '../../data/loot.json' with { type: 'json' };
import tiers from '../../data/tiers.json' with { type: 'json' };
import weapons from '../../data/weapons.json' with { type: 'json' };
import armourRows from '../../data/armour.json' with { type: 'json' };
import offhands from '../../data/offhands.json' with { type: 'json' };
import rings from '../../data/rings.json' with { type: 'json' };
import amulets from '../../data/amulets.json' with { type: 'json' };

const P = progression.rows;
const ATTR = P.attributes;

/**
 * A1-A14: a new hero from {name, sex, race, court, cls, god}.
 * @param {{name:string, sex:'m'|'f', race:string, court?:string|null, cls:string, god?:string|null}} c
 */
export const raceRow = h => races.rows[h.race], classRow = h => classes.rows[h.cls];   // C16: the hero's race and class rows
export function createHero(c) {
  const race = races.rows[c.race], cls = classes.rows[c.cls];
  if (!race) throw new Error('unknown race ' + c.race);
  if (!cls) throw new Error('unknown class ' + c.cls);
  const attr = {};
  for (const id of ATTR.ids) attr[id] = ATTR.base + (race.mods?.[id] ?? 0) + (cls.mods?.[id] ?? 0);
  const court = c.court ? courts.rows[c.court] : null;
  if (races.rows[c.race]?.needsCourt && !court) throw new Error('a Fae needs a court');
  const affinity = { ...(race.startingAffinity ?? {}), ...(court?.startingAffinity ?? {}) };
  if (cls.kitFrom === 'god' && !cls.kitByGod?.[c.god]) throw new Error('a Cleric needs a god');
  const kit = cls.kitFrom === 'god' ? cls.kitByGod[c.god] : cls.kit ?? {};
  const worn = { main: null, off: null, armour: null, ring1: null, ring2: null, amulet: null, ranged: null };
  for (const slot of ['main', 'off', 'armour', 'ranged']) if (kit[slot]) worn[slot] = makeItem(kit[slot]);
  const look = (race.sexes?.[c.sex] ?? '').replace('%court', court?.look ?? '');
  return {
    name: c.name, sex: c.sex, race: c.race, court: c.court ?? null, cls: c.cls, god: c.god ?? null, look,
    level: P['start-of-run'].level, xp: 0, points: cls.startingStatPoints ?? 0, attr, affinity,
    abilities: [...(cls.abilities ?? [])], worn,
    // The kit's spare gear, then the class's Rations as one stack (food of one kind stacks, I62).
    bag: [...(kit.bag ?? []).map(id => makeItem(id)), ...((cls.rations ?? 1) > 0 ? [{ ...makeItem('ration'), count: cls.rations ?? 1 }] : [])],
    essence: cls.startingEssence ?? 0, motes: {}, keys: 0, hunger: P['start-of-run'].hunger,
    // CF03 (1.7 classes.js:14 'Devout: rank 1'): a Cleric starts at rank 1 with the first boon, as a convert does (F11).
    faith: cls.startingGod === undefined && !c.god ? null : { god: c.god, rank: piety.rows.ranks.rankOnJoining, piety: cls.startingPiety ?? 0, favor: cls.startingFavor ?? 0, amusement: piety.rows.conversion.amusementOnJoining, cooldowns: {} },
    cooldowns: {},
    // The bar of 8, filled with the hero's abilities from slot 1 (1.7); prayers join as they are granted. A kit bow
    // takes the next free slot as the bow slot (EQ12, 1.7 ui-adapter.js:188-192).
    bowSlotted: !!worn.ranged,
    hotbar: withBowSlot(Array.from({ length: 8 }, (_, i) => (cls.abilities ?? [])[i] ? { kind: 'ability', id: cls.abilities[i] } : null), worn.ranged),
  };
}

/** EQ12: the bar with the bow slot ({kind:'ranged', id:'bow'}) in its first free slot, when a bow is worn and the bar has none. */
function withBowSlot(bar, bow) {
  if (!bow || bar.some(e => e?.kind === 'ranged')) return bar;
  const free = bar.indexOf(null);
  if (free >= 0) bar[free] = { kind: 'ranged', id: 'bow' };
  return bar;
}

/**
 * RC3 (1.7 render.js castLookFor, :901-908): the look the hero is drawn in. A Tourist wears the vacation outfit of the
 * same race, court and sex ('<look>-tourist'), even one who follows Chad (Justin 2026-10-08: "i think they should stay
 * in tourist geer"); any other follower of Chad (grom) is drawn in underwear ('<look>-unclad'), except a Dwarf, who has
 * no underwear look. The saved look stays the base look, so no save changes.
 */
export function castLook(hero) {
  if (classes.rows[hero.cls]?.lookSuffix) return hero.look + classes.rows[hero.cls].lookSuffix;
  return gods.rows[hero.faith?.god]?.uncladLooks && !/^dwarf-[mf]$/.test(hero.look) ? hero.look + '-unclad' : hero.look;   // Chad looks (Justin 2026-10-08)
}

/** Replaces the hotbar with 8 entries, each null or {kind: 'ability'|'prayer'|'item'|'ranged', id}. Returns a refusal or null. */
export function setHotbar(hero, slots) {
  if (!Array.isArray(slots) || slots.length !== 8) return 'bad-hotbar';
  const ok = e => e === null || (e && ['ability', 'prayer', 'item', 'ranged', 'amulet'].includes(e.kind) && typeof e.id === 'string');
  if (!slots.every(ok)) return 'bad-hotbar';
  hero.hotbar = slots.map(e => (e ? { kind: e.kind, id: e.id } : null));
  return null;
}

/** T7 (1.7 travel.js CLICK_SPELLS): the single-target basics that can be cast by tapping a foe. */
export const CLICK_SPELLS = ['missile', 'sap', 'firebolt', 'frostshard', 'spark', 'root', 'smite', 'shadowbolt'];

/**
 * T7 (1.7 travel.js toggleClickSpell): set the click spell, or clear it when it is already the one (id null clears).
 * Returns why it was refused, or null.
 */
export function setClickSpell(hero, id) {
  if (id == null || hero.clickSpell === id) { hero.clickSpell = null; return null; }
  if (!CLICK_SPELLS.includes(id)) return 'not-click-spell';
  if (!(hero.abilities ?? []).includes(id)) return 'unknown-ability';
  hero.clickSpell = id;
  return null;
}

/** A31: spend a stat point. Returns why it was refused, or null. */
export function spendPoint(hero, attr) {
  if (!ATTR.ids.includes(attr)) return 'unknown-attribute';
  if (hero.points <= 0) return 'no-points';
  if (hero.attr[attr] >= ATTR.max) return 'at-max';
  hero.attr[attr] += 1; hero.points -= 1;
  return null;
}

const SLOT_OF = { weapon: 'main', armour: 'armour', offhand: 'off', amulet: 'amulet' };

/**
 * CF15 (1.7 gods.js equipmentForbidden, :269-279; gods.json conduct): whether the sworn god forbids this piece. Chad
 * allows only rings, amulets and a holy symbol; an enchant of the god's forbidden element is refused; Grumbok refuses
 * a wand; Vellum a two-hander, staff, bow, shield (not a holy symbol), medium or heavy armour; Sylla a shield, medium
 * or heavy armour.
 */
const REQ = tiers.rows.requirements.items;
const REQ_ATTR = { might: 'mig', agility: 'agi', vitality: 'vit', focus: 'foc' };
const REQ_NAME = { might: 'Might', agility: 'Agility', vitality: 'Vitality', focus: 'Focus' };
const REQ_WHY = { might: 'strong', agility: 'nimble', vitality: 'hardy', focus: 'focused' };

/**
 * G07, I6: a piece's authored stat minimum at its tier (Worn has none):
 * `all` pieces need every stat listed, `any` pieces one of them. Null when the piece asks nothing.
 */
export function gearRequirement(hero, item) {
  if (!item) return null;
  const { row } = itemRow(item.id), r = REQ[row?.base ?? item.id], t = item.tier ?? 0;
  if (!r || !t) return null;
  const has = s => hero?.attr?.[REQ_ATTR[s]] ?? 0;
  if (r.all) {
    const parts = Object.entries(r.all).map(([s, v]) => [s, v[t]]).filter(([, v]) => v);
    return { stats: parts.map(([s]) => s), text: parts.map(([s, v]) => `${REQ_NAME[s]} ${v}`).join(' and '), met: parts.every(([s, v]) => has(s) >= v) };
  }
  const v = r.tiers[t];
  return { stats: r.any, text: `${r.any.map(s => REQ_NAME[s]).join(' or ')} ${v}`, met: r.any.some(s => has(s) >= v) };
}

/** G07 (1.7 reqBlock): "You are not strong enough to use the <b>Name</b> yet. It needs Might 13." */
export function requirementRefusal(hero, item, name) {
  const r = gearRequirement(hero, item);
  const why = r?.stats.length === 1 ? REQ_WHY[r.stats[0]] : null;
  return `${why ? `You are not ${why} enough to use the` : 'You can\'t use the'} <b>${name}</b> yet. It needs ${r?.text ?? ''}.`;
}

export function gearForbidden(hero, item) {
  const g = hero?.faith?.god && gods.rows[hero.faith.god];
  if (!g || !item) return false;
  const { kind, row } = itemRow(item.id), base = row.base ?? item.id, cd = g.conduct ?? {};
  if (kind === 'weapon' && /^fists/.test(item.id)) return false;
  if (cd.equipOnly) return !(cd.equipOnly.includes(kind) || cd.equipOnly.includes(base));
  if (item.enchant && (g.forbiddenElements ?? []).includes(item.enchant)) return true;
  const shield = kind === 'offhand' && !!row.block && !(cd.allowedShields ?? []).includes(base);
  return (cd.forbiddenItems ?? []).some(f => f === 'shield' ? shield : f === 'two-handed' ? kind === 'weapon' && row.hands === 2
    : f === 'medium-armour' ? kind === 'armour' && row.weight === 'medium' : f === 'heavy-armour' ? kind === 'armour' && row.weight === 'heavy' : f === base);
}

/** CF15 (1.7 gods.js refuseDivine): the line a forbidden piece is refused with. */
export const divineRefusal = hero => `${gods.rows[hero.faith?.god]?.name ?? 'Your god'} will not allow that.`;

/** CF15 (1.7 enforceDivineEquipment, gods.js:282-287): the worn hands, armour and bow the god forbids go to the bag. */
export function stowForbidden(hero) {
  const out = [];
  for (const slot of ['main', 'off', 'armour', 'ranged']) {
    const it = hero.worn?.[slot];
    if (!it || !gearForbidden(hero, it)) continue;
    hero.bag.push(it); hero.worn[slot] = null; out.push(it);
  }
  return out;
}
const bindsNow = it => !!it && (it.cursed || (it.plus ?? 0) < 0) && !(it.kind === 'amulet' && it.known === false);   // I56 (gear-use.js bound)

const BAG = loot.rows.bag.slots;
const twoHanded = it => !!it && itemRow(it.id).kind === 'weapon' && itemRow(it.id).row.hands === 2;

/**
 * CD5 (1.7 inventory.js planEquip :33, :42-44; items.md I28): nothing goes in the off hand while a two-hander is held,
 * and a two-hander taken up puts what the off hand held into the bag; a cursed piece there keeps it out of the hands.
 * Returns {why} (a refusal), {stow} (the off hand's piece that goes to the bag) or {}.
 */
export function twoHands(hero, item, slot, bagMax = BAG) {
  if (slot === 'off' && twoHanded(hero.worn.main)) return { why: 'both-hands' };
  if (slot !== 'main' || !twoHanded(item) || !hero.worn.off) return {};
  if (hero.worn.off.cursed) return { why: 'cursed' };
  if (hero.bag.length + (hero.worn.main ? 1 : 0) > bagMax) return { why: 'bag-full' };
  return { stow: hero.worn.off };
}

/** 1.7 inventory-adapter.js:10, :70: what the hands say when a two-hander is taken up or holds the off hand back. */
export function twoHandNote(hero, bagIndex, to = null, bagMax = BAG) {
  const item = hero.bag[bagIndex];
  if (!item || itemRow(item.id).kind === 'ring' || gearForbidden(hero, item)) return null;
  const { kind, row } = itemRow(item.id), slot = to === 'off' || kind === 'offhand' ? 'off' : kind === 'weapon' && row.slot !== 'ranged' ? 'main' : null;
  const two = twoHands(hero, item, slot, bagMax), name = it => itemRow(it.id).row.name;
  if (two.why === 'both-hands') return `Both hands are on the ${name(hero.worn.main)}.`;
  if (two.stow && !hero.worn.main?.cursed) return `Both hands are on the ${name(item)}, so the ${name(two.stow)} goes into your bag.`;
  return null;
}

/** The slot equip() uses ({slot}) or why there is none ({why}); `to` asks for the off hand or a ring hand. */
export function slotFor(hero, item, to = null) {
  const { kind, row } = itemRow(item.id);
  let slot = row.slot === 'ranged' ? 'ranged' : SLOT_OF[kind];
  if (to === 'off' && kind !== 'offhand') {
    if (row.slot === 'ranged') return { why: 'bow-off-hand' };   // 1.7 inventory.js:30 'bow-offhand'
    if (kind !== 'weapon' || !row.light || row.hands === 2) return { why: 'not-off-hand' };
    slot = 'off';
  }
  if (kind === 'ring') slot = to === 'ring1' || to === 'ring2' ? to : !hero.worn.ring1 ? 'ring1' : !hero.worn.ring2 ? 'ring2' : 'ring1';
  return slot ? { slot } : { why: 'not-wearable' };
}

/**
 * C4 (ui-12, engine-rules-21): every check equip() makes, without wearing anything: {why, binder} (binder: the cursed
 * piece that will not come off) or {slot, stow} (stow: the off hand's piece a two-hander puts in the bag).
 */
export function equipRefusal(hero, bagIndex, to = null, bagMax = BAG) {
  const item = hero.bag[bagIndex];
  if (!item) return { why: 'no-item' };
  const s = slotFor(hero, item, to);
  if (s.why) return s;
  const two = twoHands(hero, item, s.slot, bagMax);
  if (two.why) return { why: two.why, binder: two.why === 'cursed' ? hero.worn.off : null };
  if (bindsNow(hero.worn[s.slot])) return { why: 'cursed', binder: hero.worn[s.slot] };   // I56: "It will not come off."
  if (gearForbidden(hero, item)) return { why: 'forbidden' };   // CF15 (1.7 inventory.js:36 policy.forbidden)
  if (gearRequirement(hero, item)?.met === false) return { why: 'requirements' };   // G07 (1.7 inventory.js:37 policy.meets)
  return { slot: s.slot, stow: two.stow ?? null };
}

/**
 * Wears a bag item in its slot; what was there goes to the bag. Returns a refusal or null. `to: 'off'` puts a light
 * one-handed weapon in the off hand (1.7 offHandWeapon: a second, lighter strike with every melee attack).
 */
export function equip(hero, bagIndex, to = null, bagMax = BAG) {
  const check = equipRefusal(hero, bagIndex, to, bagMax);
  if (check.why) return check.why;
  const item = hero.bag[bagIndex], { slot } = check, stowOff = !!check.stow;
  hero.bag.splice(bagIndex, 1);
  if (hero.worn[slot]) hero.bag.push(hero.worn[slot]);
  hero.worn[slot] = item;
  if (stowOff) { hero.bag.push(hero.worn.off); hero.worn.off = null; }
  // EQ12 (1.7 ui-adapter.js:188-192): the first bow the hero wears puts the bow slot on the bar, once; a slot the
  // player clears later stays clear.
  if (slot === 'ranged' && !hero.bowSlotted && Array.isArray(hero.hotbar)) hero.bowSlotted = withBowSlot(hero.hotbar, item).some(e => e?.kind === 'ranged');
  // EQ2 (1.7 inventory-adapter.js:61-63): an amulet put on takes the first free slot as the amulet slot, when there is none.
  if (slot === 'amulet' && Array.isArray(hero.hotbar) && !hero.hotbar.some(e => e?.kind === 'amulet')) { const free = hero.hotbar.indexOf(null); if (free >= 0) hero.hotbar[free] = { kind: 'amulet', id: 'amulet' }; }
  return null;
}

export function unequip(hero, slot, bagMax) {
  if (!hero.worn[slot]) return 'empty-slot';
  if (bindsNow(hero.worn[slot])) return 'cursed';   // I56
  if (hero.bag.length >= bagMax) return 'bag-full';
  hero.bag.push(hero.worn[slot]); hero.worn[slot] = null;
  // EQ2 (1.7 ui-adapter.js:181): with no amulet worn the amulet slot leaves the bar.
  if (slot === 'amulet' && Array.isArray(hero.hotbar)) hero.hotbar = hero.hotbar.map(e => (e?.kind === 'amulet' ? null : e));
  return null;
}

const CATALOG = { weapon: weapons.rows, armour: armourRows.rows, offhand: offhands.rows, ring: rings.rows, amulet: amulets.rows };
/** I58 (1.7 gear.js transmutationKeys): the keepsakes (the Tourist's camera and shirt) are never a transmutation's result. */
const KEEPSAKE = { offhand: ['camera'], armour: ['shirt'] };

/** Whether `item` could be worn in `slot` as things stand (1.7 sigils.js transmutationFits). */
function fitsSlot(hero, slot, item) {
  if (gearForbidden(hero, item) || gearRequirement(hero, item)?.met === false) return false;
  const { kind, row } = itemRow(item.id), bow = row.slot === 'ranged';
  if (slot === 'main') return kind === 'weapon' && !bow && !(row.hands === 2 && hero.worn.off);
  if (slot === 'ranged') return kind === 'weapon' && bow;
  if (slot === 'off') return !twoHanded(hero.worn.main) && (kind === 'offhand' || (kind === 'weapon' && !bow && !!row.light && row.hands !== 2));
  return true;
}

/**
 * G26, I58 (1.7 gear-adapter.js transmutedGear, gear.js transmute; sigils.js:150-190): the piece becomes a random other
 * item of its kind (weapon, armour, off hand, ring or amulet) and keeps everything it carries: tier, plus, enchant,
 * curse, identification and use count, and an amulet's level, charges and progress. Worn, it stays on when the new
 * piece fits that slot, else it goes into the bag. `r` is a roll in [0, 1). Returns {slot, moved} or {why}.
 */
export function transmute(hero, it, r, bagMax = BAG) {
  const kind = it && CATALOG[itemRow(it.id).kind] ? itemRow(it.id).kind : null;
  if (!kind) return { why: 'no-gear' };
  const slot = Object.keys(hero.worn).find(k => hero.worn[k] === it) ?? null;
  let keys = Object.entries(CATALOG[kind]).filter(([k, row]) => k !== it.id && row && typeof row === 'object' && row.kind !== 'rule' && row.name
    && !/^fists/.test(k) && !(KEEPSAKE[kind] ?? []).includes(k)).map(([k]) => k);
  const fits = k => !slot || fitsSlot(hero, slot, { ...it, id: k });
  // A worn piece that may not fit afterwards needs room in the bag first (1.7 transmutationReady).
  if (slot && hero.bag.length >= bagMax) keys = keys.filter(fits);
  if (!keys.length) return { why: slot && hero.bag.length >= bagMax ? 'bag-full' : 'no-gear' };
  const key = keys[Math.min(keys.length - 1, Math.floor(r * keys.length))], stays = fits(key);
  it.id = key; delete it.look;
  if (slot && !stays) { hero.worn[slot] = null; hero.bag.push(it); }
  return { slot, moved: !!slot && !stays };
}

export function drop(hero, bagIndex) {
  if (!hero.bag[bagIndex]) return 'no-item';
  return { item: hero.bag.splice(bagIndex, 1)[0] };
}
