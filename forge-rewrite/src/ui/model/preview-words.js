// Sandbox E2 (Justin 2026-10-16): the real numbers an enchant or the next affinity point gives this hero, from
// src/rules/preview.js, as short comparisons for the Forge and Character windows. Numbers first, no sentences.

import { enchantCurve, previewAffinity } from '../../engine/reads.js';
import elements from '../../../data/elements.json' with { type: 'json' };
import upgrades from '../../../data/upgrades.json' with { type: 'json' };
import { say } from './words.js';

const RESIST_WORDS = { fire: 'Fire', ice: 'Frost', lightning: 'Lightning', poison: 'Poison', dark: 'Shadow', light: 'Light' };
const num = v => (Math.round(v * 100) / 100).toString();

/** One changed stat: "Fire resist 10% to 15%". */
function statWords(s) {
  const pct = s.label.endsWith(' %') || s.key === 'move';
  const label = s.key.startsWith('resist:') ? `${RESIST_WORDS[s.key.slice(7)] ?? s.label} resist` : s.label.replace(/ %$/, '').replace('Armour', 'Armor');
  const u = pct ? '%' : '';
  return say('preview.stat-change', { label, before: num(s.before), after: num(s.after), unit: u });
}

// An enchant's proc and effect values at the hero's affinity (upgrades.json values).
const VALUE_WORDS = {
  extraRatio: (v, el) => `+${num(v * 100)}% damage as ${el}`, throwRatio: v => `${num(v * 100)}% thrown back`,
  burnPct: v => `Burn ${num(v)}%`, chillPct: v => `Chill ${num(v)}%`, repeatPct: v => `Strike again ${num(v)}%`,
  rootPct: v => `Root ${num(v)}%`, procPct: v => `Triggers ${num(v)}%`, stunPct: v => `Stun ${num(v)}%`,
  corruptPct: v => `Corrupt ${num(v)}%`, deflectPct: v => `Deflect ${num(v)}%`, stealthPct: v => `Stealth +${num(v)}%`,
  hpRegenPct: v => `HP regen +${num(v)}%`, mpRegenPct: v => `Mana regen +${num(v)}%`, heal: v => `Heal ${num(v)} on hit`,
  blockCapPct: v => `Block cap ${num(v)}%`, critMult: v => `Crit damage +${num(v)}`, castTimeMult: v => `Casts ${num(v)}% faster`,
  actionTimeMult: v => `Actions ${num(v)}% faster`, damageMult: v => `Divine damage +${num(v)}%`, reducePct: v => `Damage taken −${num(v)}%`,
  healPct: v => `Healing +${num(v)}%`, shieldPct: v => `Shield ${num(v)}% of max HP`, killHealPct: v => `Heal ${num(v)}% on kill`,
};

const safe = fn => { try { return fn(); } catch { return null; } };

/** The next point of `el`: the stat changes, or [] when none (spells and powers are named by the Forge already). */
export function affinityWords(hero, el) {
  const p = hero && safe(() => previewAffinity(hero, el));
  return p ? p.stats.map(statWords) : [];
}

/** The next point of `el` with its unlocks, for the Character sheet's card: "Fire 4: Fireball, Fire resist 10% to 15%". */
export function affinityLine(hero, el, name) {
  const p = hero && safe(() => previewAffinity(hero, el));
  if (!p || p.rank > 6) return null;
  // A rank with no new spell or power adds a point of the element's damage (elements.json, the Forge's own words).
  const gain = p.spells.length || p.powers.length ? [...p.spells, ...p.powers] : [`+1 ${elements.rows[el]?.damageType ?? el} damage`];
  return `${name} ${p.rank}: ${[...gain, ...p.stats.map(statWords)].join(', ')}`;
}

// Stat-valued enchant effects, in words for an item's own card (it may sit in the bag).
const STAT_VALUE_WORDS = {
  resistPct: (v, el) => `${RESIST_WORDS[elements.rows[el]?.damageType] ?? el} resist +${num(-v)}%`, evasion: v => `Evasion +${num(v)}`,
  armour: v => `Armor +${num(v)}`, maxHpPct: v => `Max HP +${num(v)}%`, critPct: v => `Crit +${num(v)}%`, blockPct: v => `Block +${num(v)}%`,
  mana: v => `Mana +${num(v)}`, iceArmour: v => `Ice Armor ${num(v)}`, spellPct: v => `Spell damage +${num(v)}%`,
};

/**
 * 1.7 enchantLive (enchtext.js:11-17): what an enchant on an item does at the hero's affinity now, as one line
 * ("+16% damage as fire, Burn 10%"). `slot` is the enchant slot: weapon, armour, shield, orb, tome or holy.
 */
export function enchantLive(hero, slot, el) {
  const row = upgrades.rows[`enchant-${slot}-${el}`];
  if (!row) return '';
  const out = [];
  for (const [k, cv] of Object.entries(row.values ?? {})) {
    const v = enchantCurve(cv, hero ?? {}, el, { asMult: false });   // the rules' curve, Vellum and Anvil bonus included (C4, ui-42)
    if (k === 'blockCapPct' || !v) continue;
    const w = VALUE_WORDS[k] ?? STAT_VALUE_WORDS[k];
    if (w) out.push(w(v, el));
  }
  return out.join(', ');
}

/** The turns of the first status of this id the row puts on (its effect list, nested). */
function statusTurns(list, id) {
  for (const e of list ?? []) {
    if (!e || typeof e !== 'object') continue;
    if (e.verb === 'apply-status' && e.status === id && e.turns) return e.turns;
    const t = statusTurns(e.effects, id) ?? statusTurns(e.then, id);
    if (t) return t;
  }
  return null;
}
const DAMAGE_WORD = { fire: 'fire', water: 'frost', air: 'lightning', earth: 'poison', light: 'light', shadow: 'shadow' };

/**
 * W22 (1.7 enchantments.js formulaField): one enchant value as its formula per point of the element, "10% (+3% per
 * Fire point)", "5% per Shadow point (at least 5%)". `factor` turns a ratio into a percent; `sign` flips a resist.
 */
function formulaOf(cv, el, factor = 1, unit = '', sign = 1) {
  if (typeof cv === 'number') return `${num(cv * factor * sign)}${unit}`;
  const base = (cv.base ?? 0) * factor * sign, per = (cv.perAffinity ?? 0) * factor * sign;
  const each = per ? `${num(per)}${unit} per ${el[0].toUpperCase() + el.slice(1)} point` : '';
  let text = base ? `${num(base)}${unit}${each ? ` (+${each})` : ''}` : each || `0${unit}`;
  if (cv.min !== undefined) text += ` (at least ${num(cv.min * factor * sign)}${unit})`;
  return text;
}

/**
 * G31 (1.7 enchantments.js describe, :90-144 @3c8b312): what an enchant does, in one sentence, at the hero's affinity in
 * its element: the Enchant tab's words above the numbers. `slot` is the enchant family: weapon, armour, shield, orb, tome, holy.
 * o.formula gives 1.7's formula form instead (the Journal's Enchantments: "+10% (+3% per Fire point) of each hit as fire").
 */
export function enchantSentence(hero, slot, el, o = {}) {
  const row = upgrades.rows[`enchant-${slot}-${el}`];
  if (!row) return '';
  const F = o.formula, cv = k => row.values?.[k] ?? 0;
  const V = k => (F ? formulaOf(cv(k), el) : enchantCurve(cv(k), hero ?? {}, el, { asMult: false })), p = k => (F ? formulaOf(cv(k), el, 1, '%') : `${Math.round(V(k))}%`);
  const r = k => (F ? formulaOf(cv(k), el, 100, '%') : `${Math.round(V(k) * 100)}%`), neg = k => (F ? formulaOf(cv(k), el, 1, '%', -1) : `${Math.round(-V(k))}%`);
  const t = id => statusTurns(row.effects, id) ?? 0;
  const S = {
    weapon: { fire: () => `+${r('extraRatio')} of each hit as fire; ${p('burnPct')} chance to inflict Burning for ${t('burn')} turns.`, water: () => `${p('chillPct')} chance to Chill.`,
      air: () => `${p('repeatPct')} chance to strike twice.`, earth: () => `${p('rootPct')} chance to Root for ${t('root')} turns.`,
      light: () => `Hallowed Edge: each hit with this weapon heals you ${F ? '1 HP per Light point (at least 1)' : `${V('heal')} HP`}.`,
      shadow: () => `${p('procPct')} chance of +${r('extraRatio')} shadow damage and Corrupt for ${t('corrupt')} turns; +2 damage to Corrupted targets.` },
    armour: { fire: () => `+${p('maxHpPct')} max HP.`, water: () => `+${V('evasion')} evasion.`, air: () => `${p('deflectPct')} chance to deflect ranged attacks.`,
      earth: () => `+${V('armour')} armor.`, light: () => `+${p('hpRegenPct')} HP regeneration.`, shadow: () => `+${p('stealthPct')} stealth.` },
    shield: { fire: () => `Blocking burns the attacker for ${r('throwRatio')} of the blow; ${p('burnPct')} chance to inflict Burning for ${t('burn')} turns.`,
      water: () => `${p('chillPct')} chance to Chill a blocked attacker.`, air: () => `${p('stunPct')} chance to knock a blocked attacker back 1 tile and stun for ${t('stun')} turn.`,
      earth: () => `+${p('blockPct')} block chance.`, light: () => `Each block mends ${V('heal')} HP.`, shadow: () => `${p('corruptPct')} chance to Corrupt a blocked attacker for ${t('corrupt')} turns.` },
    orb: { fire: () => `Critical hits ignite the target tile and inflict Burning for ${t('burn')} turns (damage grows with each Fire point).`,
      water: () => `Critical hits restore ${V('iceArmour')} Ice Armor, up to your maximum.`, air: () => `Critical hits stun for ${t('stun')} turn.`,
      earth: () => `+${p('critPct')} crit chance against Rooted targets.`, light: () => `Critical hits restore ${V('mana')} mana.`, shadow: () => `+${p('critMult')} crit damage.` },
    tome: { fire: () => `+${p('spellPct')} spell power.`, water: () => `+${V('evasion')} evasion.`, air: () => `${p('castTimeMult')} less casting time.`,
      earth: () => `+${neg('resistPct')} all elemental resistances.`, light: () => `${p('shieldPct')} of mana spent becomes a shield (up to ${row.effects?.[0]?.effects?.[0]?.cap?.['pct-of']?.pct ?? 30}% of max HP).`,
      shadow: () => `Spell kills heal ${p('killHealPct')} of max HP.` },
    holy: { fire: () => `+${p('damageMult')} damage.`, water: () => `+${p('mpRegenPct')} mana regeneration.`, air: () => `Actions other than moving take ${p('actionTimeMult')} less time.`,
      earth: () => `${p('reducePct')} less damage taken.`, light: () => `Casting a prayer or invocation heals ${p('healPct')} of max HP.`, shadow: () => `+${p('critPct')} crit chance.` },
  };
  const said = S[slot]?.[el]?.();
  if (!said) return '';
  // Body armour also guards against its element's damage (1.7's prefix).
  return slot === 'armour' ? `+${neg('resistPct')} ${DAMAGE_WORD[el]} resistance; ${said}` : said;
}
