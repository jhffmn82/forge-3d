// What a hotbar slot shows, read from the state (consolidation H6, ui-24: out of hotbar.js): an entry's icon, name, line,
// readiness and card rows; its inner glow; a sigil's cast pulse; the sentence its card opens with. No Pixi here.

import { toNum, tone as uiTone, elementColour } from '../core/colour.js';
import { abilityLook } from '../core/icons.js';
import { sigilGlow } from '../core/pulse.js';
import { itemView } from '../model/item-view.js';
import { actionFacts } from '../model/action-facts.js';
import strings from '../../../data/strings.json' with { type: 'json' };
import abilities from '../../../data/abilities.json' with { type: 'json' };
import gods from '../../../data/gods.json' with { type: 'json' };
import sigils from '../../../data/sigils.json' with { type: 'json' };
import { prayerRowFor, itemCount } from '../model/hud-model.js';
import { manaCost, capacity, killsNeeded, CLICK_SPELLS, itemRow as itemRowOf } from '../../engine/reads.js';   // C17: the rules' answers through the engine (PLAN section 2)

const prayerIdOf = h => gods.rows[h.faith?.god ?? h.god]?.invoke;

/** CD17: what a slot's ability or prayer does, the sentence 1.7's hotbar card opened with (enchtext.js abilityDetails /
 * prayerDetails, ABILITY_LIVE and PRAYER_LIVE summaries); the Cleric's invoke says its god's. Items have none here. */
export function slotSentence(state, entry) {
  if (!entry || entry.kind === 'item') return null;
  const id = entry.kind === 'ability' && entry.id === 'invoke' ? prayerIdOf(state?.hero ?? {}) : entry.id;
  return (id && strings.rows['action.' + id]) || null;
}

/**
 * The bag's own copy of a slot's item, or a stand-in when none is left (the last one used, Feature 136 shots): a sigil id
 * stands in as a sigil, so the slot keeps the sigil's name and rune, never the raw id ('levitate').
 */
export const bagItem = (h, id) => (h?.bag ?? []).find(i => i?.id === id) ?? (sigils.rows[id]?.name ? { kind: 'sigil', id } : { id });
// CH-16 (1.7 hud.js hotbarIconPresentation): the slot's inner glow takes the colour of its icon's family. Elements in
// 1.7's damage colours (data.js DMG_COL: water ice, air lightning, earth poison, shadow dark), martial steel, a god's
// colour for its invoke and prayers, provisions bronze, rings and amulets lilac, sigils blue, other gear steel; a few
// icons keep 1.7's fixed rim (ICON_BG_FIXED).
const FIXED_GLOW = { 'pr-the-brood': '#4A2A6E', 'ic-into-the-dark': '#4A2A6E', 'pr-venom-burst': '#2F5A2A', 'ic-heal': '#8A6A20', 'pr-consecrate': '#8A6A20', 'pr-sanctuary': '#8A6A20' };
export function slotTint(state, entry, view = entryView(state, entry)) {
  if (!entry || !view) return null;
  const h = state?.hero ?? {}, fixed = FIXED_GLOW[view.icon];
  if (fixed) return toNum(fixed);
  if (entry.kind === 'item' || entry.kind === 'ranged' || entry.kind === 'amulet') {
    const kind = entry.kind === 'ranged' ? 'weapon' : entry.kind === 'amulet' ? 'amulet' : itemView(bagItem(h, entry.id), state)?.kind;
    return uiTone(kind === 'food' ? 'food' : kind === 'ring' || kind === 'amulet' ? 'trinket' : kind === 'sigil' ? 'sigilRim' : 'martial');
  }
  const god = gods.rows[h.faith?.god ?? h.god];
  if (entry.kind === 'prayer' || entry.id === 'invoke') return toNum(god?.color ?? '#E8B44A');
  const el = abilities.rows[entry.id]?.element;
  return (el && elementColour(el, 'glow')) ?? uiTone('martial');
}

/** What one entry looks like on the bar: icon, name, the small line, and whether it can be used now. */
/** Feature 136: a slot holding a sigil pulses in its rune's glow when cast (core/pulse.js sigilGlow); null for anything else. */
export function sigilPulse(state, entry, view = entryView(state, entry)) {
  if (entry?.kind !== 'item' || !view) return null;
  const it = bagItem(state?.hero, entry.id);
  return it.kind === 'sigil' || itemView(it, state)?.kind === 'sigil' ? sigilGlow(view.icon) : null;
}

export function entryView(state, entry) {
  if (!entry) return null;
  const h = state.hero ?? {}, faith = h.faith ?? {};
  if (entry.kind === 'item') {
    const v = itemView(bagItem(h, entry.id), state), n = itemCount(h, entry.id);
    return { icon: v?.icon, name: v?.name ?? entry.id, line: n > 1 ? `×${n}` : '', ready: n > 0, left: 0, rows: [['In the bag', n]], card: v?.detail ?? null };   // H26: the full item card (1.7 bagCard)
  }
  if (entry.kind === 'ranged') {
    // EQ12 (1.7 ui.js:514, hud.js:79): the bow slot wears the worn bow; grey with none.
    const rw = h.worn?.ranged, v = rw ? itemView(rw, state) : null, bow = state.actors?.[state.playerId]?.bow;
    return { icon: v?.icon, name: v?.name ?? 'No bow', line: '', ready: !!bow, left: 0, bow: true,
      rows: bow ? [['Range', bow.range], ...(bow.dmg ? [['Damage', `${bow.dmg[0]}-${bow.dmg[1]}`]] : [])] : [] };
  }
  if (entry.kind === 'amulet') {
    // EQ2 (1.7 ui.js:511-513, ui-adapter.js:69-71): the amulet slot wears the worn amulet and its charges; grey with none left.
    const it = h.worn?.amulet, v = it ? itemView(it, state) : null, ch = it?.charges ?? 0, cap = it ? capacity(it) : 0;
    return { icon: v?.icon, name: v?.name ?? 'No amulet', line: it ? `${ch}/${cap}` : '', ready: ch > 0, left: 0, amulet: true, aims: !!(it && itemRowOf(it.id).row.aim),
      rows: it ? [['Charges', `${ch}/${cap}`], ...(ch < cap ? [['Kills to the next', Math.max(0, killsNeeded(it) - (it.progress ?? 0))]] : [])] : [] };
  }
  const pr = prayerRowFor(entry, h);
  if (pr) {
    // The Cleric's invoke keeps its cooldown with the hero's under the god's prayer id (8eb40a0); prayers keep theirs in faith.
    const id = entry.kind === 'prayer' ? entry.id : prayerIdOf(h);
    const left = Math.ceil((entry.kind === 'prayer' ? faith.cooldowns?.[id] : h.cooldowns?.[id]) ?? 0), favor = pr.favor ?? 0;
    // Item 298 (Justin 2026-10-21: "for cost, invokes show favor cost ( 0 ) instead of the mana costs"): an invoke costs
    // mana (prayers.json mana), shown and readied as a class ability's (the rules' manaCost).
    const p = state.actors?.[state.playerId], mana = pr.mana && state.hero ? manaCost(state.hero, pr) : 0;
    return { icon: pr.icon, name: pr.name, line: pr.health ? `${pr.health} HP` : mana ? `${mana}` : favor ? `${favor}` : '', left,
      ready: !left && (faith.favor ?? 0) >= favor && (p?.mana ?? 0) >= mana && (!pr.health || (p?.hp ?? 0) > pr.health),
      // The live damage, statuses and cooldown with its ready-in (1.7 prayerDetails), then what it costs.
      // H26 (1.7 ui.js prayerCost): HP, essence, Amusement or mana where the prayer costs that, else its favor.
      rows: [...actionFacts(id, state), pr.health ? ['Cost', `${pr.health} HP`] : pr.essence ? ['Cost', `${pr.essence} essence`] : pr.amusement ? ['Cost', `${pr.amusement} Amusement`] : mana ? ['Cost', `${mana} mana`] : ['Favor', favor]] };
  }
  // A class ability (abilities.json): its mana as 1.7's slot line, grey while the hero lacks the mana or it cools down.
  const row = abilities.rows[entry.id], left = Math.ceil(h.cooldowns?.[entry.id] ?? 0);
  const p = state.actors?.[state.playerId], mana = row && state.hero ? manaCost(state.hero, row) : 0, facts = actionFacts(entry.id, state);
  return {
    icon: row?.icon ?? abilityLook(entry.id).icon, name: row?.name ?? abilityLook(entry.id).name, line: mana ? `${mana}` : '',
    ready: !left && (p?.mana ?? 0) >= mana, left,
    // T7: one of 1.7's click spells, and whether it is the one a tap on a foe casts now.
    clickable: CLICK_SPELLS.includes(entry.id), click: !!h.clickSpell && h.clickSpell === entry.id,
    // The live damage and statuses, the cost, the cooldown with its ready-in (1.7 abilityDetails), the range.
    rows: [...facts.filter(([k]) => k !== 'Cooldown'), ...(mana ? [['Mana', mana]] : []), ...facts.filter(([k]) => k === 'Cooldown'), ...(row?.aim?.range ? [['Range', row.aim.range]] : [])],
  };
}
