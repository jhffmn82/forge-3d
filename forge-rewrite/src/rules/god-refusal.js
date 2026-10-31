// Which gods refuse a character and why (spec/faith.md F10, CF50; consolidation C4: moved from world/runplan.js, ui-36,
// world-19). The run plan, the shrine, the Faith window and creation all ask here.

import gods from '../../data/gods.json' with { type: 'json' };
import races from '../../data/races.json' with { type: 'json' };
import classes from '../../data/classes.json' with { type: 'json' };

/**
 * F10: why this god refuses the character, as a reason code, or null: 'race', 'class' or 'court' (its refuses lists),
 * 'affinity' (an element it will not take), 'light-room' (Glimmer needs room for Light), 'cleric' (a Cleric never
 * converts). Creation and the shrine put their own words to it (C4, ui-36).
 */
export function godRefusal(id, c) {
  const r = gods.rows[id].refuses ?? {}, aff = Object.keys(c.affinity ?? {}).filter(k => c.affinity[k] > 0);
  if (r.races?.includes(c.race)) return 'race';
  if (r.classes?.includes(c.cls)) return 'class';
  if (c.court && r.courts?.includes(c.court)) return 'court';
  if (r.affinities?.some(a => aff.includes(a))) return 'affinity';
  if (r.needsRoomFor === 'light' && !(aff.includes('light') || (aff.length < 2 && !aff.includes('shadow')))) return 'light-room';
  return c.cls === 'cleric' ? 'cleric' : null;
}

/** F10: does this god refuse the character? */
export const godRefuses = (id, c) => godRefusal(id, c) !== null;

/**
 * CF50 (1.7 religion.js refusalText): why a god refuses the hero, in the god's words, checked in 1.7's order: Sylla
 * and fire, a Cleric's bond, race, Sir Reginald and a Scoundrel, class, court, then affinity.
 */
export function refusalText(id, c) {
  const g = gods.rows[id], r = g.refuses ?? {}, short = g.name.split(',')[0], aff = c.affinity ?? {};
  if (id === 'sylla' && (aff.fire ?? 0) > 0) return 'Sylla will not take fire into her brood.';
  if (c.cls === 'cleric') return 'Clerics are bound to their chosen god and cannot convert.';
  if (r.races?.includes(c.race)) return `${g.name} will not accept a ${races.rows[c.race]?.name ?? c.race}.`;
  if (id === 'reginald' && c.cls === 'scoundrel') return 'Sir Reginald will not take a sneak-thief into his service.';
  if (r.classes?.includes(c.cls)) return `${short} will not take a ${classes.rows[c.cls]?.name ?? c.cls}.`;
  if (c.court && r.courts?.includes(c.court)) return id === 'sylla' ? 'Sylla will not take fire into her brood.' : `${g.name} refuses you.`;
  if (id === 'reginald' && (aff.shadow ?? 0) > 0) return 'Sir Reginald wants nothing to do with shadow.';
  if (id === 'glimmer' && (aff.shadow ?? 0) > 0) return 'Saint Glimmer will not touch shadow.';
  if (r.needsRoomFor === 'light' && godRefuses(id, { ...c, cls: null })) return "Saint Glimmer's light needs room: you already hold two elements, and neither is Light.";
  if (id === 'murk' && (aff.light ?? 0) > 0) return 'Mother Murk will not accept Light affinity.';
  return `${g.name} refuses you.`;
}
