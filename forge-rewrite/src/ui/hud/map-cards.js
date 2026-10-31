// The map card under the pointer (consolidation H6, ui-24: out of map-hover.js). 1.7 ui.js inspectHTML: a creature, a floor
// item, a prop worth a card, a found trap, a poison trail, or a tile you can use. Read-only; never reveals or identifies
// anything. No Pixi here, so it runs in Node tests.

import { T, tileAt } from '../../data/tiles.js';
import monsters from '../../../data/monsters.json' with { type: 'json' };
import props from '../../../data/props.json' with { type: 'json' };
import traps from '../../../data/traps.json' with { type: 'json' };
import bosses from '../../../data/bosses.json' with { type: 'json' };
import statuses from '../../../data/statuses.json' with { type: 'json' };
import strings from '../../../data/strings.json' with { type: 'json' };
import tuning from '../../../data/tuning.json' with { type: 'json' };
import { previewBlow, trueForgeAt, blowChance, isSurprise, evasionOf, WALK_TILES, chaosWay, tileTitle, itemTitle, sealedTreasure } from '../../engine/reads.js';
import { inRect } from '../../lib/geometry.js';
import { itemView } from '../model/item-view.js';
import { known, inSight, bodyAt, propAt, propRow, itemsAt, cap } from './map-hover.js';

const S = strings.rows;

/* ---------------------------------------------------------------- the card (1.7 ui.js inspectHTML) */
// A card is { title, colour? (item 145: graded gear), lore?, rows?: [label, value][], statuses?: {name, icon, turns, bad}[], hints?: string[], tail?: [label, value][], odds?: {hit, lo, hi, back} }.
// A tile's words are strings.json tile.<T name>.hint (H5, ui-16), and its variants tile.CHEST.* and tile.EXIT.*.
const T_NAME = Object.fromEntries(Object.entries(T).map(([k, v]) => [v, k]));
const CORE_NAMES = ['Dungeon Core', 'Crypt Core', 'Cavern Core', 'Ruin Core', 'Abyss Core'];

const lore = a => S[monsters.rows[a.kind]?.text?.lore] ?? S['monster.unknown.lore'];
const hintOf = a => S[monsters.rows[a.kind]?.text?.hint] ?? null;
const STATE = { hunt: 'hunting', wander: 'wandering' };

/** 1.7 statusList(e) for the card: every status, immunities aside, with its icon and turns. */
function statusRows(a) {
  return Object.entries(a.statuses ?? {}).filter(([k]) => !k.startsWith('imm-') && statuses.rows[k]).map(([k, st]) => {
    const row = statuses.rows[k];
    return { id: k, name: row.name ?? cap(k), icon: row.icon ?? null, turns: st?.n ?? 0, bad: (row.tags ?? []).includes('harmful') };
  });
}

// CB16 (1.7 combat.js:190-201 shadeAbilityHint): a Shade's card says what the body it rose from still does.
const SHADE_MOVES = { 'storm-charge': 'Chains lightning through enemies.', 'spark-bolt': 'Chains lightning through enemies.', 'root-spit': 'Spits roots at enemies.', firebolt: 'Casts firebolts at enemies.' };
export function shadeHint(e) {
  if (!e?.shade) return null;
  const parts = [], split = (e.passives ?? []).find(x => x?.verb === 'split');
  if (split?.whenHitAtFullHp) parts.push('Heals 2 HP per turn. Splits when hit at full health. Two-Shade limit.');
  else if (split) parts.push('Splits when wounded. Two-Shade limit.');
  for (const m of e.moves ?? []) {
    const w = SHADE_MOVES[m.id] ?? (m.id === 'earth-root' ? `Casts ${m.name} at enemies.` : null);
    if (w && !parts.includes(w)) parts.push(w);
  }
  if ((e.range ?? 1) > 1) parts.push(e.params?.reloadAfterRanged ? 'Pins enemies, then reloads.' : 'Keeps its ranged attack.');
  return parts.join(' ') || null;
}

/** 1.7 inspectActorHTML: name, lore, HP, armour and evasion, element, state, statuses, hint, then the odds. */
function actorCard(s, e) {
  const p = s.actors[s.playerId], tiny = (e.flags ?? []).includes('tiny') ? 'Tiny: does not block ranged targeting.' : null;
  const hp = ['HP', `${Math.max(0, Math.round(e.hp))} / ${Math.round(e.maxhp)}`];
  // H07 (1.7 inspectActorHTML): the Myconid trader, the hungry spider and an ally have cards of their own.
  if (e.merchant && e.side !== 'foe') return { title: e.name, hints: ['A traveling Myconid trader. Offers rare sigils, elemental motes and Masterwork equipment for essence.', 'Click or approach to browse the stock.'] };
  if (e.hungrySpider && e.side === 'neutral') return { title: e.name, hints: ['Hungry... everything dead.', 'It watches you without attacking.'] };
  if (e.side === 'player' || e.side === 'ally' || e.ally) return { title: e.name, rows: [hp], lore: lore(e), hints: [tiny, 'Fights for you.', shadeHint(e)].filter(Boolean) };
  // The odds are the roll's own chances (hit.js blowChance): the floor's accuracy bonus, Keen Aim, Blur and Lady Luck in.
  const pct = c => Math.round(c * 100 + 1e-9);   // whole percent; a float's last bit does not tip 55.5 down to 55
  const ch = pct(blowChance(s, p, e, { surprise: isSurprise(s, p, e) })), back = pct(blowChance(s, e, p));
  // ui-06: the blow's range as the rules strike it, every multiplier and the armour rule, without a roll (attack.js previewBlow).
  const blow = previewBlow(s, p, e);
  const state = e.statuses?.stun ? 'stunned' : e.statuses?.frozen ? 'frozen' : e.throne ? 'on his throne' : e.asleep ? 'asleep' : e.hunting ? 'hunting' : STATE[e.state] ?? 'wandering';
  const rows = [hp, ['Armor · Evasion', `${e.armour ?? 0} · ${evasionOf(e)}`]];
  if (e.element) rows.push(['Element', cap(e.element)]);
  rows.push(['State', e.kind === 'matron' ? state.replace('on his throne', 'on her throne') : state]);
  if (e.keyholder) rows.push(['Carries', 'an iron key']);
  const h = hintOf(e);
  return { title: e.name, lore: lore(e), element: e.element ?? null, rows, statuses: statusRows(e), hints: [tiny, h && h !== lore(e) ? h : null].filter(Boolean), odds: { hit: ch, lo: blow.lo, hi: blow.hi, back } };
}

/**
 * Item 170 (Justin 2026-10-18: "mouse overs of items on the ground show too much information should just show Holy
 * Symbol?"): a floor item's card is its floor name only, the rules' (inspect.js itemTitle: "?" while unidentified, a heart's
 * and a globe's percentages from loot.json), graded gear in its quality colour (item 145: "grey, white, blue, gold for the 4
 * tiers"). H08: a crystal vault's treasure names only its kind and keeps its warning, since taking one shatters the rest.
 */
function itemCard(s, it, entry) {
  // Item 290 (Justin: "the hover text should only tell you what kind of item it is"): a sealed treasure's card is its crystal's.
  if (sealedTreasure(s.floor, entry)) return { title: 'Sealed crystal', rows: [['Inside', itemTitle(s, it, entry)]], hints: ['Choose one treasure; the others shatter.'] };
  const colour = itemView(it, s)?.colour;
  return { title: itemTitle(s, it, entry), ...(colour != null ? { colour } : {}) };
}

/** The puzzle room (floor.puzzles) a cell lies in, or null. */
const puzzleAt = (s, x, y) => (s.floor.puzzles ?? []).find(r => inRect(r, x, y)) ?? null;
/**
 * H09, 1.7 inspectTargetHTML's prop part: shrines, bowls, event rooms, levers, guardians, then what a prop does; scenery
 * you cannot do anything with gets no card. The cards are props.json's, in order (H5, ui-16): the first whose `when` holds
 * (a flag on the prop, `row.` a flag of its row) names it and says its hint, or its usedHint once `used`; a `live` entry
 * is drawn here, with its live numbers or the control's word (LIVE: a whole card, or a hint under the prop's name).
 */
const flag = (pr, row, path) => (path.startsWith('row.') ? row[path.slice(4)] : path.split('.').reduce((o, k) => o?.[k], pr));
const LIVE = {
  lever(s, pr, touch, used) {
    if (!/^lever/.test(pr.id)) return null;
    // 1.7 leverDetails: the guardian shutoff lever names what it does; spent once its room is shut off.
    const room = pr.puzzleSwitch && pr.roomDoor ? (s.floor.puzzles ?? []).find(r => r.door?.x === pr.roomDoor.x && r.door?.y === pr.roomDoor.y) : null;
    const done = used || !!room?.disabled, guard = !!pr.puzzleSwitch;
    return { title: guard ? 'Guardian shutoff lever' : 'Lever', rows: [['State', done ? 'Already pulled' : 'Ready to pull']],
      hints: [done ? (guard ? 'The guardians are shut off.' : 'Its work is done.') : `${touch ? 'Tap' : 'Click'} or bump this lever to ${guard ? "shut off the room's guardians" : 'pull it'}.`] };
  },
  guardian(s, pr) {
    if (!(pr.sentry || pr.sentinel || pr.guardianStatue)) return null;
    const room = puzzleAt(s, pr.x, pr.y), quiet = !!room?.solved, sentry = !!pr.sentry || room?.kind === 'sentries';
    return { title: sentry ? 'Stone Sentry' : 'Stone Sentinel', hints: [quiet ? 'Dormant guardian.' : sentry ? 'Fires at visible targets. Pillars block its bolts; concealment, Shadow mastery or the lever lets you pass.' : 'Awakens on entry. Stoneskin or Earth mastery lets you pass; the lever disables it.'] };
  },
  ritual: (s, pr) => (pr.ritual && pr.prisoner ? `Captive: ${pr.captiveHp}/${pr.captiveMaxhp} HP. The ritual drains 2 HP per round. Free them or interrupt the priestess.` : null),
  lock(s, pr) { const cost = pr.moteCost || 1; return pr.id !== 'elemental-lock' ? null : pr.opened ? 'Its seal has dissolved.' : `Wants ${cost} ${pr.element} mote${cost === 1 ? '' : 's'}.`; },
};
function propCard(s, pr, touch) {
  const row = propRow(pr), used = !!pr.used || pr.id === 'lever-down', named = () => cap(row.name ?? pr.id.replace(/-\d+$/, '').replace(/-/g, ' '));
  for (const c of props.cards) {
    if (c.live) { const r = LIVE[c.live](s, pr, touch, used); if (r) return typeof r === 'string' ? { title: named(), hints: [r] } : r; continue; }
    if (flag(pr, row, c.when) && !(c.unless && flag(pr, row, c.unless))) return { title: c.title ?? named(), hints: [c.used && (c.used === 'used' ? used : flag(pr, row, c.used)) ? c.usedHint : c.hint] };   // a pulled lever is used
  }
  return null;
}

/** 1.7 inspectTileHTML: cards belong to things you can inspect or use, not terrain. */
function tileCard(s, x, y) {
  const f = s.floor, t = tileAt(f, x, y), chaos = chaosWay(s, x, y, t);
  // H10: 1.7 inspectTileHTML closes every card with where it is and whether you see it now.
  const where = [inSight(s, x, y) ? 'In sight' : 'From memory', `${x},${y}`];
  if (chaos) return { title: chaos.title, hints: [chaos.hint], tail: [where] };
  if (!WALK_TILES.includes(t)) return null;
  const title = tileTitle(s, x, y);
  let hint = S[`tile.${T_NAME[t]}.hint`];
  const chest = t === T.CHEST ? (f.chests ?? []).find(c => c.x === x && c.y === y) : null;
  if (chest?.table === 'chest-enhanced' || chest?.enhanced) hint = S['tile.CHEST.enhanced'];
  if (chest && chest.greedy !== undefined) hint = S['tile.CHEST.greedy'];
  if (t === T.EXIT) {
    const boss = Object.values(bosses.rows).find(b => b.floor === Math.ceil((s.floorNo ?? 1) / 5) * 5)?.name ?? 'this floor\'s guardian';
    hint = f.exitOpen ? S['tile.EXIT.open'] : S['tile.EXIT.sealed'].replace('{boss}', boss.replace(/^The /, 'the ')).replace('{core}', CORE_NAMES[Math.min(4, Math.floor(((s.floorNo ?? 1) - 1) / 5))]);
  }
  return { title, hints: hint ? [hint] : [], tail: [where] };
}

/** The map card for (x, y), or null: what 1.7 showed when the pointer rested there. touch: a touch device (1.7 body.touch). */
export function mapInspect(s, x, y, { touch = false } = {}) {
  if (!s?.floor || !known(s, x, y)) return null;
  const p = s.actors[s.playerId];
  if (p?.statuses?.blind && !inSight(s, x, y)) return null;
  const e = bodyAt(s, x, y);
  if (e && inSight(s, x, y)) return actorCard(s, e.parent ? s.actors[e.parent] ?? e : e);
  const it = itemsAt(s, x, y)[0];
  if (it) return itemCard(s, it.item, it);
  // The Forge of the Elements past the Unmaker (1.7 FoteUnmakerEncounter.forgeInfo).
  if (trueForgeAt(s.floor, x, y)) return { title: 'Forge of the Elements', hints: [s.floor.crucible.phase === 'defeated' ? 'Stand beside the Forge and click or tap it. You can restore balance and retire, or keep exploring.' : 'It will not wake until the Unmaker falls.'] };
  const pr = propAt(s, x, y);
  // CH22: a portal's or gate's drawn piece stands on its first tile; with nothing of its own to say, the way's card shows.
  if (pr) { const c = propCard(s, pr, touch); if (c || !chaosWay(s, x, y, tileAt(s.floor, x, y))) return c ?? (e ? null : cocoonCard(s, x, y)); }
  const tr = (s.floor.traps ?? []).find(q => q.x === x && q.y === y && q.found);
  if (tr) return { title: `${traps.rows[tr.kind]?.name ?? cap(tr.kind)} trap`, hints: ['Walk around it.'] };
  const trail = trailAt(s, x, y);
  if (trail) return { title: trail.name, hints: [`${trail.damage} poison damage per turn. ${trail.turns} turn${trail.turns === 1 ? '' : 's'} left.${trail.side === 'foe' ? ' Harms you and your allies.' : ''} Levitation avoids it.`] };
  return tileCard(s, x, y) ?? (e ? null : cocoonCard(s, x, y));
}

/** H09 (1.7 inspectHTML): an unhatched cocoon or egg sac, over any cell of it. */
function cocoonCard(s, x, y) {
  const props = s.floor.props ?? [];
  const head = props.find(q => q.hatch && !q.hatched && !q.part && inRect({ x: q.x, y: q.y, w: q.w ?? 1, h: q.h ?? 1 }, x, y))
    ?? props.find(q => q.part && q.x === x && q.y === y && props.some(h => h.hatch && !h.hatched && !h.part && h.x === q.part.x && h.y === q.part.y && h.id === q.id));
  return head ? { title: 'Cocoon', hints: ['Something twitches inside. It will burst if you come close.'] } : null;
}

/**
 * EP36 (1.7 green-slime.js trailAt, ui.js:701): the poison trail field on (x, y), in sight or once seen, while it lasts:
 * the Green Slime's (neutral ground) or the Plague Bloat's (a foe's). The stronger one answers.
 */
const TRAILS = { 'slime-trail': 'all', 'plague-trail': 'foe' };
export function trailAt(s, x, y) {
  const f = s?.floor, k = y * (f?.w ?? 0) + x, now = s?.now ?? 0, TURN = tuning.rows.clock.unitsPerGameTurn;
  const live = (f?.fields ?? []).filter(r => TRAILS[r.kind] && r.cells.includes(k) && r.until > now && (inSight(s, x, y) || r.known))
    .sort((a, b) => Number(TRAILS[b.kind] === 'foe') - Number(TRAILS[a.kind] === 'foe') || b.strength - a.strength);
  if (!live.length) return null;
  const r = live[0];
  return { name: r.tell, damage: r.strength, turns: Math.ceil((r.until - now) / TURN), side: TRAILS[r.kind] };
}
