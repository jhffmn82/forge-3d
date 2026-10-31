// Colours for the UI, read from data once (consolidation U7; audit ui-17, ui-18, ui-33): one parser, the theme's tones,
// and each element's colour by the role it plays.

import ui from '../../../data/ui.json' with { type: 'json' };
import elements from '../../../data/elements.json' with { type: 'json' };

/** '#D0605A' (or 'D0605A', or a number) as 0xd0605a. */
export const toNum = c => (typeof c === 'number' ? c : Number('0x' + String(c).replace('#', '')));
/** 0xd0605a as '#d0605a'. */
export const toCss = n => '#' + toNum(n).toString(16).padStart(6, '0').toUpperCase();

/** A named UI tone (data/ui.json tones): bad, good, unid, food, trinket, martial, sigilRim, bindRim, invokeRim. */
export const tone = name => toNum(ui.tones[name]);

const EL = elements.rows, PAL = ui.elementPalettes;
/**
 * An element's colour in a role (ui-17): glow (its damage colour, ui.json damageColours: chips and hotbar rims),
 * affinity (elements.json colour), highlight (1.7's --aff-hi words), enchant (1.7 AFF_COL: enchant dots, court names
 * and the portrait block), end (1.7's end-screen dots). The air and light of `enchant` differ from elements.json; which
 * wins is held for Justin (plan 5a #7), so both stay as they are.
 */
export function elementColour(el, role = 'affinity') {
  if (role === 'glow') { const t = EL[el]?.damageType; return t && ui.damageColours[t] ? toNum(ui.damageColours[t]) : null; }
  if (role === 'affinity') return EL[el]?.colour ? toNum(EL[el].colour) : null;
  const c = PAL[role]?.[el];
  return c ? toNum(c) : null;
}
/** The elements whose `role` colour is set, as { el: 0xRRGGBB }. */
export const elementPalette = role => Object.fromEntries(Object.keys(EL).filter(id => EL[id]?.kind === 'element').map(id => [id, elementColour(id, role)]));
/** An icon's element where its row names none (ui.json iconElement: the Flame Step picture is fire). */
export const iconElement = key => ui.iconElement?.[key] ?? null;
