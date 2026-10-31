// Windows that belong to places on the map: the core infusion (after a boss core), the shrine, the merchant, and the
// pick-one-item windows (Field Smelt, the sigils of Ascension, Identify, Transmutation and Rot). Contents and
// buttons are 1.7's (js/equipment/forge.js, js/faith/gods.js:193-223, js/combat/systems.js:287-316, sigils.js).

import { Container, Graphics } from '../../../../forge-godot/runtime/pixi.js';
import { color, space } from '../core/widgets.js';
import { stack, row, split, flow } from '../core/layout.js';
import { lines, heading, none, panel, PANEL_PAD, nameplate } from '../core/blocks.js';
import { shrine } from './creation-art.js';
import { GOD, boonWords } from '../model/words.js';
import { actionDetail } from './character.js';
import { pietyDepth, shrineState, upgradeCost, godRefuses, refusalText, sigilName, recycleValue } from '../../engine/reads.js';   // C17: the rules' answers through the engine (PLAN section 2)
import pietyRows from '../../../data/piety.json' with { type: 'json' };
import { faithView, ruleLine, titleCase } from '../model/hero-view.js';
import { itemView } from '../model/item-view.js';
import { forgeView } from '../model/forge-view.js';
import prayerRows from '../../../data/prayers.json' with { type: 'json' };
import { moteStrip, fuseTab } from './forge.js';
import gods from '../../../data/gods.json' with { type: 'json' };
import sigilRows from '../../../data/sigils.json' with { type: 'json' };
import { toNum } from '../core/colour.js';

/** Plates side by side, wrapping when the width runs out (a phone). */
const plateRow = (kit, plates, w = 9999) => { const c = new Container(), list = plates.filter(Boolean); list.forEach(p => c.addChild(p)); flow(list, w, space.betweenRows, space.betweenRows); return c; };

/** Core claimed: the forge's strip and its Fuse grid, then Keep motes (under the cap) or Continue. */
export function buildCore(kit, area, ctx) {
  const v = forgeView(ctx.game, ctx.deps.magic?.() ?? {});
  const done = kit.plateButton(v.total < v.cap ? 'Keep motes' : 'Continue', () => { ctx.close(); ctx.arg?.onClose?.(); }, { h: Math.max(40, kit.target), size: 18 });
  done.label = 'core-done';
  const body = stack([moteStrip(kit, v, area.w), fuseTab(kit, v, area.w, ctx)], space.betweenSections);
  done.position.set(area.w - done.width, body.height + space.betweenSections);
  body.addChild(done);
  return body;
}

/**
 * Shrine: the god's statue and name in its colour, its rule, what gives piety and what it is worth here, the boons with
 * their words, the prayers and the Cleric ability (details on hover or a tap); then the god's words: Swear (asks
 * first, saying what it costs) for the unsworn, Pray once per floor for the sworn, Tithe for the unsworn, Leave
 * always. A god that refuses the hero says why and offers no Swear (1.7 openShrine, js/faith/gods.js:183-223).
 * ctx.arg = { god, prayed?, tithed? }.
 */
export function buildShrine(kit, area, ctx) {
  // Boon words in full when they fit; on a laptop the window never scrolls, so a long list keeps them on hover.
  let c = composeShrine(kit, area, ctx, true);
  if (kit.stage.kind !== 'P' && c.height > area.h) { c.destroy({ children: true }); c = composeShrine(kit, area, ctx, false); }
  return c;
}
function composeShrine(kit, area, ctx, full) {
  const id = ctx.arg?.god ?? 'anvil', g = gods.rows[id], h = ctx.game?.hero ?? {};
  const sworn = h.faith?.god === id, P = kit.stage.kind === 'P', short = g.name.split(',')[0];
  const own = toNum(g.color);
  // CF50 (1.7 religion.js godRefuses, refusalText): race, class, court, affinity and a Cleric's bond, in the god's words.
  const refused = !sworn && godRefuses(id, h);
  const view = sworn ? faithView(h.faith, ctx.game) : null;
  const boons = (view?.boons ?? g.boons.map(b => ({ id: b.id, rank: b.rank, name: b.name, have: false }))).filter(b => sworn ? b.have : b.rank === 1);
  const allPrayers = view?.prayers ?? [];
  const prayers = allPrayers.filter(p => p.have);
  const say = cmd => ctx.deps.command?.(cmd);
  // CF51 (1.7 gods.js:206): the confirm says what leaving the old god costs, the starting piety and the new god's rule.
  const rule = ruleLine(g), start = pietyRows.rows.shrine.swearStartPiety;
  const oldGod = h.faith?.god && !sworn ? gods.rows[h.faith.god]?.name : null;
  const swearText = `${oldGod ? `Abandoning ${oldGod} brings their wrath for a while. ` : ''}Your piety starts at ${start}.${rule ? ` Rule: ${rule}.` : ''}`;
  const swear = () => ctx.open('Confirm', { question: `Swear to ${g.name}`, text: swearText, yes: 'Swear', onYes: () => say({ type: 'swear', god: id }) });
  // CF53 (1.7 openShrine, gods.js:211-218): Pray is gone once prayed here (a line says so instead); Tithe is gone once
  // tithed and grey without 20 essence; either closes the shrine, as 1.7. The floor's own marks decide, so a reopened shrine is as it stands.
  const here = ctx.game?.floor?.shrine?.god === id ? shrineState(ctx.game) : null;
  const prayed = here ? here.prayed : !!ctx.arg?.prayed, tithed = here ? here.tithed : !!ctx.arg?.tithed;
  const titheCost = pietyRows.rows.shrine.titheEssence, canTithe = (h.essence ?? 0) >= titheCost;
  const words = plateRow(kit, [
    !sworn && !refused ? kit.plateButton(`Swear to ${short}`, swear, { h: Math.max(40, kit.target), size: 16, rank: 'prominent' }) : null,
    sworn && !prayed ? kit.plateButton('Pray', () => { say({ type: 'pray-shrine' }); ctx.close(); }, { h: Math.max(40, kit.target), size: 16, rank: 'prominent' }) : null,
    !sworn && !tithed ? Object.assign(kit.plateButton(`Tithe ${titheCost} essence`, () => { if (canTithe) { say({ type: 'tithe' }); ctx.close(); } }, { h: Math.max(40, kit.target), size: 16 }), canTithe ? {} : { alpha: 0.5 }) : null,
    kit.plateButton('Leave', ctx.close, { h: Math.max(40, kit.target), size: 16 }),
  ], P ? area.w : 9999);
  const prayedLine = sworn && prayed ? kit.text('You have already prayed here.', { size: 14, fill: color.ash, wrap: area.w }) : null;
  // L: the statue on the left, everything else in two columns beside it. P: statue, then one column.
  const { w: cw, xs } = split(area.w, 3, space.betweenSections * 2);
  const textW = P ? area.w : area.w - xs[1];
  const about = GOD[id]?.blurb ?? null;
  // CF52 (1.7 shrine-details): where piety comes from and what it is worth on this floor.
  const depth = ctx.game ? pietyDepth(ctx.game) : 1;
  const gain = GOD[id]?.piety ? `Piety from: ${GOD[id].piety} Worth ×${depth.toFixed(2)} here; favor is not multiplied.` : null;
  const facts = stack([
    ...nameplate(kit, g.name, g.title, own, true, textW),
    about ? kit.text(about, { size: 16, fill: color.ink, wrap: textW }) : null,
    rule ? kit.text(`Rule: ${rule}.`, { size: 16, fill: color.ink, wrap: textW }) : null,
    gain ? kit.text(gain, { size: 14, fill: color.ash, wrap: textW }) : null,
    refused ? kit.text(refusalText(id, h), { size: 16, fill: color.hp, wrap: textW }) : null,
    prayedLine,
  ].filter(Boolean), space.betweenRows);
  const listW = P ? area.w : Math.floor((textW - space.betweenSections * 2) / 2);
  const boonRow = b => {
    const d = boonWords(b.id, sworn ? view?.rank : null), c = new Container();
    const top = lines(kit, [{ name: b.name, num: `rank ${b.rank}`, fill: kit.accent, detail: { title: b.name, sub: `Rank ${b.rank}`, lines: d ? [d] : [] } }], listW, 1);
    c.addChild(top);
    if (full && d) { const t = kit.text(d, { size: 14, fill: color.ink, wrap: listW }); t.y = top.height; c.addChild(t); }
    return c;
  };
  const prayerLine = p => ({ icon: p.icon, tile: true, name: p.name, num: p.favor ? `${p.favor} favor` : 'ready', detail: actionDetail(p.id, p.name, null, h, ctx.game) });
  const inv = g.invoke && prayerRows.rows[g.invoke];
  const invokeLine = inv ? { icon: inv.icon, tile: true, name: inv.name, num: 'Cleric', detail: actionDetail(g.invoke, inv.name, 'Cleric ability', h, ctx.game) } : null;
  // "Grow in piety ..." when boons or prayers are still to come (1.7 shrineGifts).
  const more = boons.length < g.boons.length || prayers.length < (sworn ? allPrayers.length : g.prayers?.length ?? 0);
  const hint = more ? kit.text(sworn ? `Grow in piety to learn what else ${short} grants.` : `Swear yourself and grow in piety to learn what else ${short} grants.`, { size: 14, fill: color.ash, wrap: listW }) : null;
  const boonList = stack([heading(kit, sworn ? 'Your boons' : 'First boon'), stack(boons.map(boonRow), space.betweenRows), hint].filter(Boolean), space.betweenRows);
  const prayerList = stack([
    prayers.length ? heading(kit, 'Your prayers') : null, prayers.length ? lines(kit, prayers.map(prayerLine), listW, 1) : null,
    invokeLine ? heading(kit, 'Cleric ability') : null, invokeLine ? lines(kit, [invokeLine], listW, 1) : null,
  ].filter(Boolean), space.betweenRows);
  const c = new Container();
  const statueH = P ? 120 : 220;
  // The statue's room is held even before its art arrives, so the window's size never jumps.
  c.addChild(new Graphics().rect(0, 0, P ? area.w : cw, statueH).fill({ color: 0, alpha: 0.001 }));
  const statue = shrine(id, statueH, () => ctx.reopen());
  if (statue) { statue.position.set((P ? area.w : cw) / 2, statueH); c.addChild(statue); }
  if (P) {
    const body = stack([facts, boonList, prayerList, words].filter(Boolean), space.betweenSections);
    body.y = statueH + space.betweenSections;
    c.addChild(body);
    return c;
  }
  const lists = new Container();
  lists.addChild(boonList);
  prayerList.x = listW + space.betweenSections * 2; lists.addChild(prayerList);
  const right = stack([facts, lists, words], space.betweenSections);
  right.x = xs[1];
  c.addChild(right);
  return c;
}

/**
 * The merchant: essence on top, then Equipment and jewellery, Elemental motes, Sigils as grids of one-line items,
 * each with its price; tap or click to choose, Buy does it. Each item sells once. deps.shop() gives the stock.
 */
const shopPick = { id: null };
export const shopFresh = () => { shopPick.id = null; };   // a fresh visit picks nothing
/** The cavern merchant's offers (state.floor.merchant.stock, rules/caverns.js) as the window lists them, named as 1.7's
 *  openCavernMerchant names them: rings and amulets unidentified, sigils by their true name, motes by element. */
export function shopView(game) {
  return (game?.floor?.merchant?.stock ?? []).map(o => {
    const it = o.item, base = { id: o.id, price: o.price, sold: !!o.sold };
    if (it.kind === 'mote') return { ...base, kind: 'mote', name: `${titleCase(it.el)} mote`, icon: 'mote-' + it.el };
    const v = itemView(it, game);
    if (it.kind === 'sigil') return { ...base, kind: 'sigil', name: sigilRows.rows[it.id]?.name ?? v?.name, icon: v?.icon };
    const trinket = it.kind === 'ring' || it.kind === 'amulet';
    // Item 145 (Justin 2026-10-18: "grey, white, blue, gold for the 4 tiers"): graded gear is named in its quality colour.
    return { ...base, kind: 'gear', name: trinket ? `Unidentified ${it.kind}` : v?.name ?? it.id, icon: v?.icon, colour: trinket ? null : v?.colour ?? null, rows: trinket ? [] : v?.detail?.rows ?? [] };
  });
}
export function buildShop(kit, area, ctx) {
  const stock = ctx.deps.shop?.() ?? shopView(ctx.game), essence = ctx.game?.hero?.essence ?? 0, P = kit.stage.kind === 'P';
  // WC10: a laptop window never scrolls (window rule 8), so the stall's whole stock and its Buy and Leave fit the frame:
  // two columns where they fit, three when two would run past it (1280x800 holds 13-17 offers only in three), and the
  // buttons beside the essence when even that is too tall. A phone keeps its one scroll.
  const tries = P ? [[area.w >= 560 ? 2 : 1, false]] : [[area.w >= 900 ? 3 : area.w >= 560 ? 2 : 1, false], [area.w >= 720 ? 3 : 2, false], [area.w >= 720 ? 3 : 2, true]];
  let body = null;
  for (const [cols, up] of tries) {
    body?.destroy({ children: true });
    body = composeShop(kit, area, ctx, stock, essence, cols, up);
    if (body.height + space.betweenSections <= area.h) break;
  }
  return body;
}
const headRoom = (width, actions) => width - actions - space.betweenSections >= 240;
function composeShop(kit, area, ctx, stock, essence, cols, up) {
  const group = (name, kind) => {
    const items = stock.filter(s => s.kind === kind).map(s => ({
      icon: s.icon, name: s.name, num: s.sold ? 'Sold' : `${s.price}`, dim: s.sold || s.price > essence,
      act: s.sold ? null : () => { shopPick.id = s.id; ctx.reopen(); }, fill: shopPick.id === s.id ? kit.accent : s.colour ?? undefined,
      detail: { title: s.name, ...(s.colour != null ? { colour: s.colour, pip: s.colour } : {}), rows: [['Price', `${s.price} essence`], ...(s.rows ?? [])] },
    }));
    return items.length ? panel(kit, name, area.w, lines(kit, items, area.w - PANEL_PAD * 2, cols)) : null;
  };
  const chosen = stock.find(s => s.id === shopPick.id && !s.sold);
  const buy = kit.plateButton('Buy', () => chosen && ctx.deps.command?.({ type: 'buy', item: chosen.id }), { h: Math.max(40, kit.target), size: 16, rank: chosen && chosen.price <= essence ? 'prominent' : 'subdued' });
  const leave = kit.plateButton('Leave', ctx.close, { h: Math.max(40, kit.target), size: 16 });
  const actions = plateRow(kit, [buy, leave], area.w);
  const selection = chosen ? stack([kit.text(chosen.name, { size: 16, fill: color.ink, weight: '600', wrap: area.w }), kit.text(`${chosen.price} essence`, { size: 14, fill: chosen.price <= essence ? color.ash : color.hp })], space.inRow) : null;
  const foot = stack([selection, actions], space.betweenRows);
  up = up && !selection && headRoom(area.w, foot.width);
  const head = stack([row([kit.text(String(essence), { size: 16, fill: color.ink, weight: '600' }), kit.text('essence', { size: 14, fill: color.ash })], space.inRow), kit.text('Each item is available once.', { size: 14, fill: color.ash, wrap: up ? area.w - foot.width - space.betweenSections : area.w })], space.inRow);
  const body = stack([head, group('Equipment and jewellery', 'gear'), group('Elemental motes', 'mote'), group('Sigils', 'sigil'), stock.length ? null : none(kit, 'Nothing for sale.')].filter(Boolean), space.betweenSections);
  foot.position.set(area.w - foot.width, up ? Math.max(0, Math.round((head.height - foot.height) / 2)) : body.height + space.betweenSections);
  body.addChild(foot);
  return body;
}

/**
 * Choose one item: Field Smelt and the sigils of Ascension, Identify, Transmutation and Rot. One line per item that
 * qualifies, what it would give on the right; the way out keeps the sigil. ctx.arg = { what, items: [{ item, num,
 * command }], keep }.
 */
export function buildChooseItem(kit, area, ctx) {
  const a = ctx.arg ?? { what: 'Choose one item.', items: [] };
  // a.back: the window to return to either way (the off-hand choice comes back to the Inventory).
  const done = () => (a.back ? ctx.open(a.back) : ctx.close());
  // E50: x.from says where the piece is; x.off greys a piece that cannot be chosen, its card saying why (x.why).
  const list = a.items.map(x => {
    const v = itemView(x.item, ctx.game), detail = v?.detail && x.why ? { ...v.detail, lines: [...(v.detail.lines ?? []), x.why] } : v?.detail;
    return { icon: v?.icon, name: v?.name ?? 'Item', fill: x.off ? undefined : v?.colour ?? undefined, dim: !!x.off, from: x.from, num: x.num, numFill: x.off ? color.dim : undefined, detail,
      act: x.off ? undefined : () => { done(); ctx.deps.command?.(x.command); } };
  });
  const keep = kit.plateButton(a.keep ?? 'Keep the sigil', done, { h: Math.max(40, kit.target), size: 16 });
  return stack([kit.text(a.what, { size: 16, fill: color.ink, wrap: area.w }), list.length ? lines(kit, list, area.w, area.w >= 560 ? 2 : 1) : none(kit, 'Nothing you carry qualifies.'), keep], space.betweenSections);
}

/** 1.7 rotPicker's slots in its order, with the words it gave each. */
const ROT_SLOTS = [['main', 'main hand'], ['off', 'off hand'], ['armour', 'armor'], ['ranged', 'ranged'], ['amulet', 'amulet'], ['ring1', 'ring 1'], ['ring2', 'ring 2']];

const PICK_WHAT = {
  identify: 'Clear water runs over one piece. Choose which to read; a curse shows itself before you put it on.',
  rot: 'Choose a cursed item. It rots away and is gone for good.',
  ascension: 'Choose one piece of gear to raise by +1. A cursed item is cleansed instead.',
  transmutation: 'Choose one item. It becomes a random item of the same kind and keeps its quality, upgrades, enchantment and curse. If you can no longer wear it, it goes into your bag.',
};

/**
 * The Choose window's contents for a picker sigil (the engine's {type:'picker', sigil, bag} event): every worn or
 * carried item that sigil can take, each sending {type:'use', bag, choice}; "Keep the sigil" sends nothing (D47).
 * main.js: on that event, ui.open('Choose', pickerChoice(state, ev)).
 */
export function pickerChoice(state, ev) {
  const h = state.hero, gear = it => it && it.kind !== 'food' && it.kind !== 'sigil';
  // CD1 Field Smelt (a prayer's picker, {type:'picker', prayer}): one carried item to melt for its full value.
  if (ev.prayer) {
    const items = (h.bag ?? []).map((it, j) => [it, j]).filter(([it]) => recycleValue(state, it) > 0)
      .map(([it, j]) => ({ item: it, num: `${recycleValue(state, it)}`, command: { type: 'pray', prayer: ev.prayer, choice: { bag: j } } }));
    return { title: prayerRows.rows[ev.prayer]?.name ?? 'Choose', what: 'Choose one carried item to destroy for its full recycling value.', items, keep: 'Not now' };
  }
  const takes = {
    identify: it => gear(it) && it.known === false,
    rot: it => gear(it) && it.cursed && it.known !== false,
    ascension: it => { if (!gear(it)) return false; try { return upgradeCost(h, it) != null; } catch { return false; } },
    transmutation: gear,
  }[ev.sigil] ?? gear;
  // The Amulet of Echoes repeats a picker sigil with no sigil in the bag (ev.amulet): the choice goes back to the amulet,
  // and nothing is spent until it does (engine fe7994f).
  const send = choice => (ev.amulet ? { type: 'use', amulet: true, choice } : { type: 'use', bag: ev.bag, choice });
  // E50 (1.7 knowPicker, rotPicker, sigilUpgradePicker, transmutationPicker): each piece says where it is under its name
  // and the button's word on the right: Read it, Rot away, Raise or Cleanse, Transmute.
  const verb = it => ({ identify: 'Read it', rot: 'Rot away', transmutation: 'Transmute' }[ev.sigil] ?? (ev.sigil === 'ascension' ? (it.cursed ? 'Cleanse' : 'Raise') : 'Choose'));
  // Rot lists every worn piece, as 1.7 did; one that is not a known curse is greyed with why.
  const worn = ev.sigil === 'rot' ? ROT_SLOTS.filter(([slot]) => h.worn?.[slot]) : Object.keys(h.worn ?? {}).map(s => [s, 'worn']).filter(([s]) => takes(h.worn[s]));
  const items = [
    ...worn.map(([slot, where]) => {
      const it = h.worn[slot];
      if (takes(it)) return { item: it, from: where, num: verb(it), command: send({ slot }) };
      return { item: it, from: where, num: it.known === false ? 'Unidentified' : 'Not cursed', off: true, why: 'Only known cursed items can be rotted away.' };
    }),
    ...(ev.sigil === 'rot' ? [] : (h.bag ?? []).map((it, j) => [it, j]).filter(([it, j]) => (ev.amulet || j !== ev.bag) && takes(it)).map(([it, j]) => ({ item: it, from: 'in your bag', num: verb(it), command: send({ bag: j }) }))),
  ];
  return { title: sigilName(state, ev.sigil), what: PICK_WHAT[ev.sigil] ?? 'Choose one item.', items, keep: ev.amulet ? 'Not now' : 'Keep the sigil' };
}
