// Character creation's choices, read from packets A and E: the steps (race, court for a Fae, class, god for a
// Cleric, name), the starting attributes, which gods refuse the character, and which painting shows each look.

import races from '../../../data/races.json' with { type: 'json' };
import courts from '../../../data/courts.json' with { type: 'json' };
import classes from '../../../data/classes.json' with { type: 'json' };
import gods from '../../../data/gods.json' with { type: 'json' };
import progression from '../../../data/progression.json' with { type: 'json' };
import { godRefusal } from '../../engine/reads.js';

export const RACES = Object.keys(races.rows), COURTS = Object.keys(courts.rows);
export const CLASSES = Object.keys(classes.rows), GODS = Object.keys(gods.rows);
const ATTR = progression.rows.attributes;

/** The default choice, 1.7's: a masculine Dwarve Fighter, arriving already named in a Dwarve's voice. `named` is set
 * once the player types a name, so changing race or sex no longer rerolls it (1.7 create.js:507, :641, :675). */
export function newChoice(rng = Math.random) {
  const c = { race: 'dwarf', sex: 'm', court: null, cls: 'fighter', god: null, name: '', named: false, tutorial: true };
  return { ...c, name: randomName(c, rng) };
}

/** The choice with its sex set, a name the player did not type rerolled to suit. */
export function pickSex(c, sex, rng = Math.random) {
  const next = { ...c, sex };
  return c.named || sex === c.sex ? next : { ...next, name: randomName({ ...next, name: '' }, rng) };
}

/** The steps this choice walks through, in order. */
export function steps(c) {
  return ['race', c.race === 'fae' && 'court', 'cls', c.cls === 'cleric' && 'god', 'name'].filter(Boolean);
}

/** What each step offers, in order. */
export function options(step) {
  return { race: RACES, court: COURTS, cls: CLASSES, god: GODS, name: [] }[step];
}

/** Display name of an option at a step. */
export function optionName(step, id) {
  const book = { race: races, court: courts, cls: classes, god: gods }[step];
  return book?.rows[id]?.name ?? id;
}

/** Might, Agility, Vitality, Focus at the start: the base plus race and class (packet A). */
export function startAttributes(c) {
  const r = races.rows[c.race]?.mods ?? {}, k = classes.rows[c.cls]?.mods ?? {};
  return ATTR.ids.map(id => ({ id, name: ATTR.names[id], value: ATTR.base + (r[id] ?? 0) + (k[id] ?? 0) }));
}

/** The elements the character holds at the start. */
export function startAffinity(c) {
  const r = races.rows[c.race];
  if (r?.startingAffinityFrom === 'court') return Object.keys(courts.rows[c.court ?? 'ember']?.startingAffinity ?? {});
  return Object.keys(r?.startingAffinity ?? {});
}

/** Why a god refuses this character, as creation's short tag, or null (F10; the reason is the rules', C4 ui-36). */
export function refusal(godId, c) {
  const start = startAffinity(c), why = godRefusal(godId, { ...c, court: c.race === 'fae' ? c.court : null, affinity: Object.fromEntries(start.map(e => [e, 1])) });
  if (why === 'race') return `No ${races.rows[c.race].name}s`;
  if (why === 'class') return `No ${classes.rows[c.cls].name}s`;
  if (why === 'court') return `No ${courts.rows[c.court].name}`;
  if (why === 'affinity') return `No ${start.find(e => gods.rows[godId].refuses.affinities.includes(e))} affinity`;
  if (why === 'light-room') return 'No room for Light';
  return null;   // 'cleric' is a convert's bond; creation is choosing the Cleric's own god
}

/** The painting body for a race, sex and court: 'dwarf-m', 'fae-fire-f'. */
export function bodyOf(race, sex, court) {
  const key = races.rows[race].sexes[sex];
  return key.replace('%court', courts.rows[court ?? 'ember'].look);
}

/** The look key inside a body's painting sheet. */
export function lookOf(c) {
  const body = bodyOf(c.race, c.sex, c.court);
  if (c.cls === 'cleric') return `${body}-cleric-${c.god ?? 'grumbok'}`;
  return `${body}-${c.cls}`;
}

/** The choice with one step set to `id`, the later picks kept where still legal. */
export function pick(c, step, id, rng = Math.random) {
  const next = { ...c, [step]: id };
  if (step === 'race' && id !== c.race && !c.named) next.name = randomName({ ...next, name: '' }, rng);
  if (step === 'race') next.court = id === 'fae' ? (c.court ?? 'ember') : null;
  if (step === 'cls' && id !== 'cleric') next.god = null;
  // A Cleric left without a god, or with one who now refuses, gets a random god who takes them (1.7 create.js:644).
  if (next.cls === 'cleric' && (!next.god || refusal(next.god, next))) next.god = randomGod(next, rng);
  return next;
}

/** A god who would take this character, drawn at random (1.7 creationRandom over the accepting gods), or null. */
export function randomGod(c, rng = Math.random) {
  const ok = GODS.filter(g => !refusal(g, { ...c, cls: 'cleric' }));
  return ok.length ? ok[Math.floor(rng() * ok.length)] : null;
}

/** The current pick at a step. */
export const current = (c, step) => c[step];

/** A name built from the race's syllables (1.7 buildName): 'Borin', 'Laeriel', always in that people's voice. */
export function buildName(race, sex, rng = Math.random) {
  const B = races.rows[race]?.nameBank ?? races.rows.human.nameBank, any = l => l[Math.floor(rng() * l.length)];
  let n = any(B.a) + any(B.b);
  if (rng() < 0.35 && n.length <= 6) { const extra = any(B.b); if (n.slice(-extra.length) !== extra) n += extra; }
  const ends = sex === 'f' ? B.f : B.m, vowelEnd = /[aeiouy]$/.test(n);
  let tail = any(ends);
  // A consonant seam takes a vowel-led ending (Borrikth, Osinr: no); a vowel seam drops the doubled vowel.
  if (!vowelEnd && /^[^aeiouy]/.test(tail)) { const v = ends.filter(e => e === '' || /^[aeiouy]/.test(e)); tail = v.length ? any(v) : ''; }
  if (vowelEnd && /^[aeiouy]/.test(tail)) n = n.replace(/[aeiouy]$/, '');
  if ((n + tail).length > 10) tail = '';
  // Three of a letter fold to two, a doubled vowel to one (what 1.7 meant; its copy had lost the backreferences).
  n = (n + tail).toLowerCase().replace(/([a-z])\1\1+/g, '$1$1').replace(/([aeiouy])\1/g, '$1');
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/** A new name for this race and sex, never the one already given (1.7 rollName): a curated name three times in five,
 * a built one otherwise, so the button has thousands behind it. */
export function randomName(c, rng = Math.random) {
  const r = races.rows[c.race], list = r?.names?.[c.sex] ?? r?.names?.m ?? ['Adventurer'];
  if (r?.nameBank && rng() < 0.4) { const built = buildName(c.race, c.sex, rng); if (built !== c.name && built.length >= 3) return built; }
  const other = list.filter(n => n !== c.name), from = other.length ? other : list;
  return from[Math.floor(rng() * from.length)];
}

/** A whole random character the gods accept; a Cleric swears to a random god who takes them (1.7 create.js:105). */
export function randomChoice(rng = Math.random) {
  const any = list => list[Math.floor(rng() * list.length)];
  let c = { ...newChoice(rng), race: any(RACES), sex: any(['m', 'f']), cls: any(CLASSES) };
  c = pick(c, 'race', c.race, rng);
  if (c.race === 'fae') c.court = any(COURTS);
  c = pick(c, 'cls', c.cls, rng);
  if (c.cls === 'cleric' && !c.god) c = pick(c, 'cls', 'fighter', rng);
  return { ...c, name: randomName(c, rng), named: false };
}

const STAT_WORDS = { 'max-mp': 'Max mana', 'xp-gain': 'XP gain', 'piety-gain': 'Piety gain', 'max-hp': 'Max HP' };

/** A class passive's numbers for its hover card, read from classes.json (strings with packet H). */
export function passiveRows(clsId) {
  const k = classes.rows[clsId], rows = [];
  for (const e of k?.passive ?? []) {
    if (e.verb === 'modify-stat') rows.push([STAT_WORDS[e.stat] ?? e.stat, `+${e.pct}%`]);
    if (e.verb === 'shield') rows.push(['Guard', `${e.amount?.scaled?.base?.['pct-of']?.pct ?? '?'}% of max HP`]);
  }
  if (k?.startingPiety) rows.push(['Starting piety', k.startingPiety]);
  if (k?.startingFavor) rows.push(['Starting favor', k.startingFavor]);
  if (k?.surpriseMult) rows.push(['Surprise hits', `×${k.surpriseMult}`]);
  if (k?.stealthBonusPct) rows.push(['Stealth', `+${k.stealthBonusPct}%`]);
  if (k?.noticeMult) rows.push(['Noticed', `×${k.noticeMult}`]);
  if (k?.startingEssence) rows.push(['Starting essence', k.startingEssence]);
  if (k?.statPointEvery) rows.push(['Stat point every', `${k.statPointEvery} levels`]);
  return rows;
}

export { races, courts, classes, gods };
