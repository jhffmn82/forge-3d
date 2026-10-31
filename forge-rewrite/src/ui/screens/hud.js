// The in-play HUD, placed as 1.7 places it (measured from 1.7's page at 1280x800 and 390x844; src/ui/hud/look.js).
// L: gold depth, portrait in its bronze ring with the bars tucked under it, hunger and chips, statuses beside the
//    bars, boss bar top centre; the journal, map and compass buttons down the right edge; the hotbar of 8 at the
//    bottom centre with the satchel beside it; the log lower right above the bar; on touch the pad or Search lower left.
// P: the same top block, the four buttons (journal, map, compass, satchel) down the right edge, statuses and boss
//    bar under the readouts, the hotbar 4 x 2 at the bottom (one row with the satchel on an upright tablet), the
//    info line over it, Search or the pad above it on the pad's side, the log beside that.
// The pieces live in src/ui/hud/; this file only places them.

import { CanvasTextMetrics, Container, Graphics, Ticker } from '../../../../forge-godot/runtime/pixi.js';
import { color } from '../core/widgets.js';
import { boundsIn } from '../core/layout.js';
import { buildPortrait, blockColour } from '../hud/portrait.js';
import courts from '../../../data/courts.json' with { type: 'json' };
import loot from '../../../data/loot.json' with { type: 'json' };
import uiData from '../../../data/ui.json' with { type: 'json' };
import { toNum } from '../core/colour.js';
import { buildBars, hoverCard } from '../hud/bars.js';
import { optionOf } from './options-list.js';
import { buildHotbar } from '../hud/hotbar.js';
import { buildStatuses, buildBossBar } from '../hud/status.js';
import { buildTouch } from '../hud/touch.js';
import { bodyKey, depthLine, itemsHere, barOf, slotCommand, pietyView } from '../model/hud-model.js';
import { aimFor, markRect, boltDots, bowNextTarget, bowCanHit } from '../hud/aim.js';
import { mapIntent, cursorFor } from '../hud/map-hover.js';
import { buildMapTip } from '../hud/map-tip.js';
import { buildRestZ } from '../hud/rest-z.js';
import { geo, tone, words, glassButton, PAD } from '../core/look.js';
import { markedWords } from '../core/marked-words.js';
import { whoLine } from '../model/hero-view.js';
import { floorIntro } from './log-text.js';
import { createRecentLog } from '../hud/recent-log.js';
import { keyTable, keyLabel } from '../../input/input.js';
import { litAt, seenAt, aimArea } from '../../engine/reads.js';
import { cheb, covers } from '../../lib/geometry.js';

const BAG_MAX = loot.rows.bag.slots;


/** The geometry with the portrait, the bars and the status boxes grown by k (Options Status size), the bars still starting under the portrait. */
function sizedGeo(G, k) {
  if (k === 1) return G;
  const out = { ...G };
  for (const key of ['portrait', 'level', 'barW', 'hpH', 'manaH', 'xpH', 'barText', 'hunger', 'stock', 'status', 'statusIcon', 'statusNum', 'statusGap', 'statusTouch', 'statusTouchGap']) if (key in G) out[key] = G[key] * k;
  out.barX = G.pad + (G.barX - G.pad) * k;
  out.barY = G.portraitY + (G.barY - G.portraitY) * k;
  return out;
}

/** A bar the player made that the engine cannot keep yet (no hotbar command): kept per hero, for this visit. */
const unsaved = new WeakMap();
/** RB53: the recent log's lines on 1.7's clock (hud/recent-log.js), kept across HUD rebuilds. */
const recent = createRecentLog();
// 1.7's warning lines (c-danger, c-warning) never merge: the HP red, the blood and the boss bar's warning ink.
const WARN = new Set([0xc8382e, 0xff5a6a, color.hp]);
/** The log's begin and end of a command (main.js play), for the batch rules. */
export const recentLog = { begin: () => recent.begin(), end: () => recent.end(), clear: () => recent.clear() };

/**
 * @param {ReturnType<import('../core/widgets.js').createKit>} kit
 * @param {import('../core/stage.js').Stage} stage
 * @param {{openMenu:()=>void, openMap:()=>void, explore:()=>void, hotbar?:(i:number)=>void, open?:(name:string)=>void,
 *   deps?:any, say?:(w:string, f?:number)=>void}} acts
 */
export function buildHud(kit, stage, acts) {
  const root = new Container();
  root.label = 'hud';
  const P = stage.kind === 'P', pad = geo[stage.kind].pad;
  const deps = acts.deps ?? {};
  const opt = k => optionOf(deps.options, k, stage);   // unset: the option's default for this device (U5, ui-20)
  // 1.7's Options Status size (options.js:120, --ui-status-scale 1, 1.3, 1.6; the HUD was measured at Normal) grows the
  // portrait, the bars and the status boxes together (responsive-hud.css --joined-size-scale).
  // CH-23: the XP and piety lines are 4 px, 6 px on a touch screen (1.7 --joined-progress-height, responsive-hud.css:900, 938).
  const G = { ...sizedGeo(geo[stage.kind], { compact: 1 / 1.3, large: 1.6 / 1.3 }[opt('statusSize')] ?? 1), xpH: stage.touch ? 6 : 4 };
  // 1.7 adds 2 px to every HUD word on a touch screen (--ui-mobile-text-add). geo.L was measured on a laptop, so a touch screen
  // held wide adds it here (proof item 6: 'Mana', 'Full' and the essence count were 7 to 8 px on a sideways phone); geo.P was
  // measured on a touch phone and has it already.
  if (stage.touch && stage.kind === 'L') for (const k of ['depth', 'level', 'barText', 'hunger', 'stock', 'keyText', 'log', 'logLine', 'statusNum']) if (k in G) G[k] += 2 / stage.s;
  // 1.7's Options Status position Right mirrors the HUD (study-pad-right): portrait on the right edge, the bars and
  // statuses toward the middle, the round buttons and the hotbar rail on the left. An upright phone keeps its one layout.
  const mirror = opt('statusSide') === 'right' && !(stage.touch && P);
  // A touch phone: its short side under 600 CSS px (1.7 study-small-touch; stage.js formOf).
  const phone = stage.form === 'phone';
  const open = name => (name === 'Menu' ? acts.openMenu() : acts.open ? acts.open(name) : acts.openMenu());
  const cue = n => deps.cue?.(n);
  const reduced = () => kit.reduced;
  let game = null, aiming = false;

  // Top left: the gold depth line, the portrait, the bars starting under the portrait's right side.
  const depth = words(kit, 'Dungeon · Floor 1', G.depth, { font: 'display', fill: tone.gold, weight: '600', blur: 3 });
  depth.label = 'hud-depth';
  const placeDepth = () => depth.position.set(mirror ? Math.round(stage.w - pad - depth.width) : pad, pad);
  placeDepth();
  let portrait = makePortrait();
  const inset = pad + G.portrait - G.barX + 5;
  // The chips may run to the round buttons on P, and to the bars' end on L (statuses sit past it).
  const buttonsX = stage.w - pad - G.button;
  const chipsW = (P ? buttonsX - 8 - G.barX : G.barW) - (inset - 1);
  const bars = buildBars(kit, G, inset, { open }, chipsW, { mirror });
  bars.root.position.set(mirror ? stage.w - G.barX - G.barW : G.barX, G.barY);
  root.addChild(depth, bars.root, portrait.root);

  // H32 (1.7 ui.js:301-303 hudResourceCard): the portrait's, the stat-points tab's and the Inventory button's cards.
  function inventoryCard() { return { title: 'Inventory', rows: [['Bag', `${(game?.hero?.bag ?? []).filter(Boolean).length} / ${BAG_MAX}`]], lines: ['Open equipment, items and motes.'] }; }
  function characterCard() {
    const h = game?.hero ?? {}, f = pietyView(h.faith), pts = Math.max(0, Math.round(h.points ?? 0));
    return { title: 'Character', rows: [['Level', h.level ?? 1], ...(f ? [[f.name, `Rank ${f.rank}`]] : []), ...(pts ? [['Unspent points', pts]] : [])], lines: ['Open attributes and passives.'] };
  }
  function pointsCard() { return { title: 'Attribute points', rows: [['Unspent', Math.max(0, Math.round(game?.hero?.points ?? 0))]], lines: ['Open Character to spend them.'] }; }
  function makePortrait() {
    // Map art Blocks: the '@' portrait in the hero's colour (CH-09).
    const block = opt('mapArt') === 'blocks' ? { color: blockColour(game?.hero, courts.rows[game?.hero?.court]?.look) } : null;
    const p = buildPortrait(kit, G.portrait, block ? null : bodyKey(game?.hero), { reduced, levelPx: G.level, onTap: () => open('Character'), onPoints: () => open('Character'), block, mirror });
    p.root.position.set(mirror ? stage.w - pad - G.portrait : pad, G.portraitY);
    if (p.disc) hoverCard(kit, p.disc, characterCard);
    if (p.points) hoverCard(kit, p.points, pointsCard);
    return p;
  }
  // The portrait's sheets are the body-<body> group: load it once, then draw the portrait again with them.
  function loadBody() {
    const body = bodyKey(game?.hero);
    if (!body || !deps.loadGroups) return;
    deps.loadGroups(['body-' + body]).then(() => {
      if (root.destroyed || !game) return;
      const old = portrait;
      portrait = makePortrait();
      root.addChildAt(portrait.root, root.getChildIndex(old.root));
      old.root.destroy({ children: true });
      setPortrait();
    }).catch(() => { /* the round frame stays empty; the asset check reports a missing group */ });
  }
  const setPortrait = () => { const f = pietyView(game.hero?.faith); portrait.set(game.hero?.level ?? 1, game.hero?.points ?? 0, f ? { n: f.rank, colour: toNum(f.colour) } : null); };

  // The hotbar: one row of 8 (L, and P when it is wide enough for 1.7's laptop slots and the satchel), else 4 x 2.
  // Options Hotbar layout Vertical (L only: 1.7 keeps an upright phone's bar along the bottom) stands the 8 slots down
  // the screen edge, the round buttons in a row above them; a sideways phone makes it 1.7's 2 x 4 rail.
  const vertical = !P && opt('hotbar') === 'vertical';
  const rail = vertical && phone;
  const oneRow = !vertical && (!P || stage.w - pad * 2 >= 9 * geo.L.slot + 8 * geo.L.slotGap + 8);
  const H = oneRow || vertical ? geo.L : G;
  const cols = vertical ? (rail ? 2 : 1) : oneRow ? 8 : 4;
  const gap = rail ? 4 : oneRow || vertical ? H.slotGap : G.slotGap;
  // 1.7: the column fits 9 slots and the button row in the height (the satchel sits on top of it); the rail fits 4
  // rows under two rows of buttons.
  const railSlot = rail ? Math.max(Math.round(48 / stage.s), Math.floor((stage.h - pad * 2 - G.button * 2 - 8 - 4 - gap * 3) / 4)) : 0;
  const colSlot = vertical && !rail ? Math.min(geo.L.slot, Math.floor((stage.h - pad * 2 - G.button - 8 - gap * 8) / 9)) : 0;
  const slotW = rail ? railSlot : vertical ? colSlot : oneRow ? H.slot : Math.floor((stage.w - pad * 2 - G.slotGap * 3) / 4);
  const slotH = vertical ? slotW : oneRow ? H.slot : G.slotH;
  const barWidth = cols * slotW + (cols - 1) * gap;
  const edgeLeft = vertical && mirror;   // the bar's edge: the right one, the left when mirrored

  // The round glass buttons down the right edge (the left when mirrored); the satchel joins them when the bar has no
  // room beside it. Beside a vertical bar they run in a row along the top (a 2 x 2 block over the phone rail).
  const buttons = new Container();
  const list = [['journal', 'Menu', () => open('Menu')], ['map', 'Map', () => acts.openMap()], ['compass', 'Explore', () => acts.explore()]];
  if (!oneRow && (!vertical || rail)) list.push(['satchel', 'hud-inventory', () => open('Inventory')]);
  const step = G.buttonStep - G.button;
  list.forEach(([sym, label, act], i) => {
    const b = glassButton(kit, sym, G.button, act);
    b.label = label;
    // 1.7 #bMap.on: the Map button in gold while the map is up; its card says what a press does.
    if (sym === 'map') {
      if (acts.mapOn) { b.children.at(-1).tint = tone.gold; b.addChild(new Graphics().circle(G.button / 2, G.button / 2, G.button / 2 - 0.5).stroke({ color: tone.gold, width: 1 })); }
      if (!stage.touch) kit.details(b, { title: 'Map', lines: [acts.mapOn ? 'Hide the map overlay.' : 'Show the explored dungeon.'] });
    }
    // H32 (1.7 ui.js:303, :305 hudResourceCard): the Menu and Inventory buttons have their cards too.
    if (sym === 'journal') hoverCard(kit, b, { title: 'Menu', lines: ['Character, Inventory, Faith, Options, combat log and Journal.'] });
    if (sym === 'satchel') hoverCard(kit, b, inventoryCard);
    if (rail) b.position.set((i % 2) * (slotW + gap) + Math.round((slotW - G.button) / 2), Math.floor(i / 2) * (G.button + 8));
    else if (vertical) b.position.set(i * G.buttonStep, 0);
    else b.position.set(0, i * G.buttonStep);
    buttons.addChild(b);
  });
  const buttonsW = rail ? barWidth : vertical ? list.length * G.button + (list.length - 1) * step : G.button;
  buttons.position.set(mirror ? pad : stage.w - pad - buttonsW, pad);
  root.addChild(buttons);
  const exploreButton = buttons.children.find(b => b.label === 'Explore');
  // T6 (1.7 syncExploreButton keyLabel(bindKey('explore'))): the key in force, Options may have moved it.
  const exploreKey = () => { const keys = opt('keys'), k = (keyTable(keys && Object.keys(keys).length ? keys : null).explore ?? [])[0]; return k ? `Key ${keyLabel(k)}` : null; };
  hoverCard(kit, exploreButton, () => {
    const ex = deps.explore?.state?.() ?? {};
    return ex.active ? { title: 'Stop exploring', lines: ['Stop travelling.'] } : ex.stairs ? { title: 'Next floor', lines: ['Walk to the stairs and descend.'] } : { title: 'Explore', sub: stage.touch ? null : exploreKey(), lines: ['Walk through unexplored areas.'] };
  });
  // 1.7 syncExploreButton: the compass; Stop, lit gold, while it runs; the stairs once the floor is done.
  const setExplore = () => { const ex = deps.explore?.state?.() ?? {}; exploreButton.setSymbol(ex.active ? 'stop' : ex.stairs ? 'stairs' : 'compass', !!ex.active); };

  // Statuses beside the bars on L (toward the middle), under the readouts on P; the boss bar top centre on L, under them on P.
  const statusW = P ? (mirror ? stage.w - buttons.x - G.button - pad * 2 : buttons.x - pad * 2) : Math.round(Math.min(stage.w * 0.65, stage.w - (G.barX + G.barW + 16) - pad));   // 1.7 #statusbar max-width 65%: one row on a laptop
  const statuses = buildStatuses(kit, statusW, { G, mirror: mirror && !P, open });
  const bossW = P ? buttons.x - pad * 2 : 420;
  const boss = buildBossBar(kit, bossW);
  root.addChild(statuses.root, boss.root);

  const lift = (on, k) => acts.lift?.(on, k);   // flow fades its window layer (ui-40: no layer found by its place)
  const menuLayer = new Container();
  // Beside a vertical bar the touch info line lies along its inner side, as wide as a horizontal bar's would be.
  const infoW = vertical ? Math.min(8 * geo.L.slot + 7 * geo.L.slotGap, stage.w - barWidth - pad * 2 - 16) : barWidth;
  const hotbar = buildHotbar(kit, { w: slotW, h: slotH, cols, gap, iconK: H.icon, keyPx: H.keyText }, {
    command: c => deps.command?.(c), press, setBar, cue, lift, menuLayer, infoW, phone,
    infoAt: vertical ? { x: edgeLeft ? barWidth + 12 : -infoW - 12, y: 0 } : null,
  });
  const satchel = oneRow || (vertical && !rail) ? glassButton(kit, 'satchel', slotW, () => open('Inventory'), { radius: 7 }) : null;
  if (satchel) hoverCard(kit, satchel, inventoryCard);
  const rowW = barWidth + (satchel && oneRow ? 8 + slotW : 0);
  if (vertical) {
    // 1.7: the column centred down the edge, clear of the button row and the satchel on top of it; the rail under the buttons.
    const barH = hotbar.h, x = edgeLeft ? pad : stage.w - pad - barWidth;
    const top = rail ? pad + G.button * 2 + 8 + 4 : Math.max(Math.round((stage.h - barH) / 2), pad + G.button + 8 + slotW + gap);
    hotbar.root.position.set(x, Math.min(top, stage.h - pad - barH));
  } else {
    // 1.7 centres the eight slots; the satchel hangs off the right end.
    hotbar.root.position.set(Math.round(oneRow ? (stage.w - barWidth) / 2 : pad), stage.h - pad - hotbar.h);
    if (oneRow && hotbar.root.x + rowW > stage.w - pad) hotbar.root.x = stage.w - pad - rowW;
  }
  root.addChild(hotbar.root);
  const slotsTop = hotbar.root.y;
  if (satchel) {
    satchel.label = 'hud-inventory';
    satchel.position.set(vertical ? hotbar.root.x : hotbar.root.x + barWidth + 8, vertical ? slotsTop - slotW - gap : slotsTop);
    root.addChild(satchel);
  }
  // What a vertical bar takes from the bottom corner on its side (the log and a pad there stand clear of it).
  const railReserve = vertical ? barWidth + 12 : 0;

  // Touch: the pad (an Options choice) or Search, on the pad's side, above the hotbar on P, lower left on L.
  const wantPad = opt('pad');
  const padRight = deps.options?.get?.('padSide') === 'right';
  // The pad's size in CSS px as 1.7's, times the Pad size option, in logical px for this stage.
  function padPx() {
    const phone = stage.narrow, pick = deps.options?.get?.('padSize') ?? 'normal';
    const k = pick === 'large' && phone ? PAD.scale.largePhone : PAD.scale[pick] ?? 1;
    return ((phone ? PAD.size.P : PAD.size.L) * k) / stage.s;
  }
  const touch = stage.touch || wantPad ? buildTouch(kit, { pad: !!wantPad, size: P ? G.button : geo.P.button / stage.s, padSize: padPx(), command: c => deps.command?.(c), holdMove: c => deps.holdMove?.(c), cue, cancelAim: () => endAim() }) : null;
  // 1.7: a lone Search stays opposite a mirrored rail (responsive-hud.css:1204), under the log there.
  const searchRight = !!touch && !touch.isPad && edgeLeft;
  const bottomOfLog = vertical ? stage.h - pad - (searchRight ? touch.h + 16 : 0) : (P ? hotbar.root.y : slotsTop) - (P ? 8 : 16);
  if (touch) {
    const side = padRight || searchRight ? stage.w - pad - touch.w - (edgeLeft ? 0 : railReserve) : pad + (edgeLeft ? railReserve : 0);
    touch.root.position.set(side, P ? hotbar.root.y - (touch.isPad ? 12 : 8) - touch.h : stage.h - pad - touch.h);
    if (!P && !vertical && touch.root.x + touch.w > hotbar.root.x - 8) touch.root.y = slotsTop - 16 - touch.h;
    root.addChild(touch.root);
    // CH-20, CH-21 (1.7 responsive-hud.css:1217, responsive-hud.js:313-327): Cancel aim at the lower-left inset; Pick up
    // beside the pad on the side toward the middle, bottom aligned, or above a lone Search.
    // 1.7 pins it to the inset only on a phone (study-phone-targeting); on a tablet held upright (study-tablet) it sits in the
    // control column, so here it stands above the hotbar's left end instead of over slot 1 (proof item 3).
    const tablet = P && !stage.narrow, cancelY = tablet ? hotbar.root.y - touch.size - 8 : stage.h - pad - touch.size;
    touch.place({ cancel: { x: tablet ? hotbar.root.x : pad, y: cancelY }, padLeft: !padRight });
  }

  // The log: 1.7's Spectral lines, lower right on L, beside Search or the pad on P.
  // 1.7 keeps the log 63 px clear of the lone Search button and 20 px clear of the pad.
  const beside = touch && P ? touch.w + (touch.isPad ? 20 : 63) : 0;
  const logW = P ? Math.min(G.logW + (stage.w - 390), stage.w - pad * 2 - beside) : G.logW;
  const log = new Container();
  log.label = 'hud-log';
  log.eventMode = 'none';
  log.x = P ? (padRight ? pad : stage.w - pad - logW) : edgeLeft || !vertical ? stage.w - pad - logW : stage.w - pad - logW - railReserve;
  root.addChild(log, menuLayer);
  const lines = [];
  const maxLines = P ? 5 : 7;
  const drawnLines = new Map();
  // Item 326: the last three message-producing commands stay, with the existing line cap; a repeated line reads xN.
  function drawLog() {
    const show = recent.lines().slice(-maxLines);
    const ids = new Set(show.map(l => l.id));
    for (const [id, old] of drawnLines) if (!ids.has(id)) { old.node.destroy({ children: true }); drawnLines.delete(id); }
    let y = 0;
    for (const [i, l] of show.entries()) {
      // A repeated or gathered line keeps its id while its words change; marked ink can change independently.
      const key = JSON.stringify([l.words, l.fill, l.marks?.map(m => [m.from, m.to, m.fill, !!m.bold])]);
      let row = drawnLines.get(l.id);
      if (!row || row.key !== key) {
        row?.node.destroy({ children: true });
        const o = { font: 'body', fill: l.fill, wrap: logW, lineHeight: G.logLine, blur: 3 };
        const node = l.marks?.length ? markedWords(kit, l.words, G.log, o, l.marks) : words(kit, l.words, G.log, o);
        row = { key, node }; drawnLines.set(l.id, row); log.addChildAt(node, i);
      }
      const t = row.node;
      t.y = y; y += t.height + 2;
      t.alpha = l.alpha;
    }
    log.y = bottomOfLog - y;
  }

  function setBar(next) {
    if (!game?.hero) return;
    hotbar.show(next);
    if (Array.isArray(game.hero.hotbar)) deps.command?.({ type: 'hotbar', slots: next });
    else unsaved.set(game.hero, next);
  }
  // Aim mode (aim.js): `aim` is { slot, entry, view } while a targeted ability waits for its target.
  let aim = null;
  function press(i, entry) {
    if (!game) return false;
    if (entry?.kind === 'ranged') { bowPress(i); return true; }
    if (bow) dropBow();
    if (aim && aim.slot === i) {
      // The second press casts at the picked foe; with none picked it ends the aim (1.7).
      if (aim.view.target) castAt(aim.view.target); else endAim();
      return true;
    }
    const view = aimFor(game, entry);
    if (!view) { endAim(); return false; }
    aim = { slot: i, entry, view };
    aiming = true;
    hotbar.armed(i);
    deps.markTarget?.(view.mark, view.tiles, view.area, view.path);
    // AA1: 1.7 names the aim only when nothing is picked; E51 (casting-adapter.js:235): "Esc cancels." on a keyboard.
    if (view.hint) acts.say?.(stage.touch ? view.hint : `${view.hint} Esc cancels.`, color.ash);
    refreshTouch();
    return true;
  }
  function castAt(at) {
    const a = aim;
    endAim();
    deps.command?.({ ...slotCommand(a.entry), at: { x: at.x, y: at.y } });
  }
  function endAim() {
    const was = !!aim;
    aim = null; aiming = false;
    hotbar.armed(-1);
    deps.markTarget?.(null);
    refreshTouch();
    return was;
  }
  root.on('destroyed', () => { if (aim) deps.markTarget?.(null); if (bow) deps.markBow?.(null); });

  // EQ12 (1.7 rangedslot.js bowSlotPress): the bow slot's first press draws on the nearest foe it can hit and marks it
  // in pale blue; a press with that foe still in reach looses the arrow, and aiming costs no turn. A turn passing makes
  // the mark stale. `bow` is { slot, id, now } while drawn.
  let bow = null;
  function dropBow() { bow = null; hotbar.armed(aim ? aim.slot : -1); deps.markBow?.(null); }
  function showBow() {
    const a = game.actors[bow.id];
    hotbar.armed(bow.slot);
    deps.markBow?.(markRect(a));
  }
  function bowPress(i) {
    const p = game.actors[game.playerId];
    if (!p?.bow) { endAim(); if (bow) dropBow(); acts.say?.('No bow equipped.', color.ash); return; }
    if (aim) endAim();
    const live = bow && bow.now === game.now && bowCanHit(game, game.actors[bow.id]) ? bow.id : null;
    if (live) { dropBow(); deps.command?.({ type: 'shoot', id: live }); return; }
    const e = bowNextTarget(game, bow?.id ?? null);
    // Item 287: with only a foe beside the hero, the bow slot says why it will not draw.
    const close = (game.order ?? []).some(id => { const a = game.actors[id]; return a?.side === 'foe' && a.hp > 0 && !a.hidden && cheb(p, a) === 1; });
    if (!e) { if (bow) dropBow(); acts.say?.(close ? 'Too close to shoot.' : 'No bow target in range.', color.ash); return; }
    bow = { slot: i, id: e.id, now: game.now };
    showBow();
  }

  // CH-18, CH-19 (1.7 responsive-hud.js syncTouchControls, responsive-hud.css study-phone-targeting): while aiming,
  // under a window or dead the pad and Search take no taps and hide (a phone keeps them in view while aiming); on a
  // phone the rest of the HUD lets an aiming tap through to the map, all but the armed slot.
  const passNodes = () => [depth, portrait.root, bars.root, statuses.root, boss.root, buttons, satchel].filter(Boolean);
  const kept = new WeakMap();
  function passThrough(on) {
    for (const n of passNodes()) {
      if (on) { if (!kept.has(n)) kept.set(n, n.eventMode); n.eventMode = 'none'; }
      else if (kept.has(n)) { n.eventMode = kept.get(n); kept.delete(n); }
    }
    hotbar.passThrough(on ? aim?.slot ?? -1 : null);
  }
  function refreshTouch() {
    const p = game?.actors?.[game.playerId], dead = !!game && (!p || p.hp <= 0 || !!game.over);
    touch?.set({ items: game && !dead ? itemsHere(game) : 0, aiming, covered: !!acts.covered, dead, phone });
    if (phone) passThrough(aiming && !acts.covered);
  }

  function set(state) {
    game = state;
    depth.text = depthLine(state);
    placeDepth();
    setExplore();
    bars.set(state);
    setPortrait();
    statuses.set(state);
    boss.set(state);
    const shown = !Array.isArray(state.hero?.hotbar) && unsaved.get(state.hero);
    hotbar.set(shown ? { ...state, hero: { ...state.hero, hotbar: shown } } : state);
    refreshTouch();
    // While aiming, the world may have moved (a step, a foe's turn): pick again and redraw the mark.
    if (aim) { aim.view = aimFor(state, aim.entry) ?? aim.view; aim.hoverKey = null; hotbar.armed(aim.slot); deps.markTarget?.(aim.view.mark, aim.view.tiles, aim.view.area, aim.view.path); }
    if (bow) { if (bow.now !== state.now || !bowCanHit(state, state.actors[bow.id])) dropBow(); else showBow(); }
    const readBottom = bars.root.y + bars.root.height;
    if (P) {
      statuses.root.position.set(pad, Math.max(portrait.root.y + portrait.root.height, readBottom) + 8);
      boss.root.position.set(pad, statuses.root.y + statuses.root.height + (statuses.root.height ? 8 : 0));
    } else {
      // Mirrored, the row ends 16 px short of the bars and fills toward the middle (1.7 justify-content: flex-end).
      statuses.root.position.set(mirror ? bars.root.x - 16 - statusW : G.barX + G.barW + 16, G.barY);
      boss.root.position.set(Math.round((stage.w - bossW) / 2), pad);
    }
    // RC29: the stairs arrow keeps to the screen between the HUD's top block (upright) or the boss bar and the hotbar.
    const b = P ? band() : { top: boss.root.visible ? boss.root.y + boss.root.height + 8 : 0, bottom: hotbar.root.y - 8 };
    deps.pointerBand?.({ top: root.toGlobal({ x: 0, y: b.top }).y, bottom: root.toGlobal({ x: 0, y: b.bottom }).y });
  }

  // 1.7's map hover (travel.js cursor, game.js tooltip) and its touch long press (mobile.js): sandbox items 57 and 63.
  const tip = buildMapTip(kit);
  root.addChild(tip.root);
  let held = false, closedAt = 0, longPress = null, tipKey = '', resting = false, restDone = 0, restSince = 0, restEnd = 0;
  // Items 79, 177 and 309 (Justin 2026-10-21: "it doesn't work when you press R to rest"): the sleepers' 'z' rises over
  // the hero while a hold on its tile builds toward Rest, and stays for as long as any rest runs (R, the hero, the bar or
  // the menu: deps.resting, the play loop's walker), fading as it ends (hud/rest-z.js).
  const restZ = buildRestZ(kit);
  root.addChild(restZ.root);
  function endHold() { if (longPress) { clearTimeout(longPress.timer); longPress = null; } restZ.clear(); }
  const restTick = () => {
    if (root.destroyed) { Ticker.shared.remove(restTick); return; }
    const now = performance.now(), holding = !!longPress?.rest, running = !!deps.resting?.();
    if (running && !restSince) restSince = now - (now - restDone < 300 ? LONG_MS : 0);   // a hold's z's are up already
    if (!running && restSince) { restSince = 0; restEnd = now; }
    const gone = Math.max(restDone, restEnd), fading = !holding && !running && now - gone < 300;   // they fade as it ends
    if (!holding && !running && !fading) { if (gone) { restZ.clear(); restDone = restEnd = 0; } return; }
    const h = deps.heroOnScreen?.(), fade = fading ? 1 - (now - gone) / 300 : 1;
    const k = holding ? Math.min(1, (now - longPress.born) / LONG_MS) : running ? Math.min(1, (now - restSince) / LONG_MS) : 1;
    if (!h) return;
    const at = root.toLocal(h), s = root.worldTransform.a;
    restZ.draw(k, fade, { x: at.x, y: at.y, tile: h.tile / s }, s * (globalThis.devicePixelRatio || 1));
  };
  Ticker.shared.add(restTick);
  const { mapHoldMs: LONG_MS, mapSlopPx: SLOP, tapSwallowMs: SWALLOW_MS, buzzMs: BUZZ } = uiData.input;   // T42 (ui.json input)
  /** Held upright on touch the card spans the band between the HUD's top block and the hotbar (1.7 placeMapTip). */
  function band() {
    const top = Math.max(portrait.root.y + portrait.root.height, bars.root.y + bars.root.height, statuses.root.y + statuses.root.height, boss.root.visible ? boss.root.y + boss.root.height : 0, buttons.y + buttons.height) + 8;   // the round buttons down the right edge too (1.7 counted its rail)
    const tb = touch?.root ? boundsIn(touch.root, root) : null, ty = tb && tb.h ? tb.y : Infinity;
    return { top, bottom: Math.min(hotbar.root.y, ty) - 8 };
  }
  function showAt(g, t, local, isTouch) {
    const card = t ? tip.cardAt(g, t.x, t.y, { touch: !!stage.touch }) : null;
    if (!card) { tip.hide(); tipKey = ''; return false; }
    const key = [t.x, t.y, g.now ?? 0, g.actions ?? 0].join(',');
    if (key === tipKey && !isTouch && tip.shown) { tip.root.position.set(Math.round(Math.max(6, Math.min(local.x + 14, stage.w - tip.root.width - 8))), Math.round(Math.max(6, Math.min(local.y + 14, stage.h - tip.root.height - 8)))); return true; }
    tipKey = key;
    tip.show(card, local, { touch: isTouch, upright: isTouch && P, w: stage.w, h: stage.h, ...(isTouch && P ? band() : {}) });
    return true;
  }

  const hud = {
    root,
    set(state) {
      const first = !game;
      set(state);
      if (first) {
        loadBody();
        // 1.7 opens a run with who enters in gold, then the floor's intro (floorIntro, as every floor after it).
        if (!lines.length && state.hero) {
          acts.say?.(`${state.hero.name}, ${whoLine(state.hero)}, enters the Dungeon.`, tone.gold);
          for (const l of floorIntro(state)) acts.say?.(l.words, l.fill);
        }
      }
    },
    say(text, fill = color.ash, o = {}) {
      // CB33, CB34: a stand-here hint said again on its spot goes to the journal only (log-text.js cued); CB52: a hit's
      // numbers keep their damage colours (marks).
      if (!o?.quiet) recent.add(text, fill, { warning: WARN.has(fill), marks: o?.marks });
      lines.push({ words: text, fill }); if (lines.length > 40) lines.shift(); drawLog();
    },
    // A rebuilt HUD keeps the run's lines (the first-entry line checks them); what shows is the recent log's.
    restore(old) { if (old) { lines.push(...old); drawLog(); } },
    get lines() { return lines; },
    /** Keys the HUD answers in play: hotbar-1 to hotbar-8. */
    action(a) {
      const m = /^hotbar-(\d)$/.exec(a);
      if (!m || !game) return false;
      hotbar.use(Number(m[1]) - 1);
      return true;
    },
    /** True while a targeted ability waits for its target (main.js sends map taps to mapTap then). */
    get aiming() { return !!aim; },
    /** FX34: the portrait flinches as the hero's 'damaged' event plays, not after the turn (1.7 damageApplied). */
    flinch() { portrait.hurt(); },
    /** RB28: the bars as the turn plays (bars.vitals). */
    vitals(hp, mana) { bars.vitals(hp, mana); },
    /** A map tap while aiming casts at that tile. */
    mapTap(t) { if (!aim) return false; castAt(t); return true; },
    /**
     * While aiming, the target square follows the mouse (1.7 targeting-cues.js): in range or not, lit or remembered;
     * on a body in sight it stands over the body's whole footprint. Remembered ground never shows a body.
     */
    aimHover(t) {
      if (!aim || !game || !t) return deps.markHover?.(null);
      const f = game.floor, p = game.actors[game.playerId], k = t.y * f.w + t.x, lit = litAt(game, t.x, t.y);
      if (!(lit || seenAt(game, t.x, t.y))) return deps.markHover?.(null);
      // Umbral Passage reaches any explored ground (1.7 inRange 'umbral'); the rest reach their range in sight.
      const ok = (t.x !== p.x || t.y !== p.y) && (aim.view.explored || lit && cheb(t, p) <= aim.view.range);
      const body = lit ? game.order.map(id => game.actors[id]).find(a => a.hp > 0 && !a.hidden && covers(a, t.x, t.y)) : null;
      // RB33: on a body in sight the square stands around its whole picture; RB35: a bolt's flight shows in dots.
      deps.markHover?.(body ? markRect(body, body.id === game.playerId) : { x: t.x, y: t.y, w: 1 }, ok, lit, aim.view.bolt && ok && lit ? boltDots(game, t) : []);
      // Sandbox E3 with AA1: a spell that picks no foe (Fireball, Frost Cone, Upheaval) shows its struck tiles where the
      // pointer aims it; off reach, the area at the picked foe, if any. Redrawn only when the pointer changes tile.
      const key = ok && lit ? k : -1;
      if (key !== aim.hoverKey) { aim.hoverKey = key; deps.markTarget?.(aim.view.mark, aim.view.tiles, key >= 0 ? aimArea(game, aim.view.id, t) : aim.view.area, aim.view.path); }
    },
    /** Esc or Cancel aim: ends aiming; true when there was one. */
    cancelAim() { return endAim(); },
    /**
     * Map pointer events from map-input.js: kind is the Pixi event name, pick() the tile under the pointer after 1.7's
     * lifted-sprite rule (null while a window is up), canvas the game's canvas for the cursor.
     */
    mapPointer(kind, e, pick, g, canvas) {
      const local = root.toLocal(e.global), onMap = !e.target?.parent;   // over a HUD control or a window, not the map (1.7: its UI was not the canvas)
      if (!onMap) pick = null;
      if (kind === 'globalpointermove') {
        // A hold that wanders off its spot is not a hold (1.7 mobile.js: 12 px).
        if (longPress && Math.hypot(e.global.x - longPress.at.x, e.global.y - longPress.at.y) > SLOP) endHold();
        if (e.pointerType !== 'mouse') return;
        const t = !aim && g ? pick?.() ?? null : null;
        if (canvas) canvas.style.cursor = t ? cursorFor(mapIntent(g, t.x, t.y)) ?? (mapIntent(g, t.x, t.y) ? 'pointer' : '') : '';
        if (!t) { tip.hide(); tipKey = ''; return; }
        showAt(g, t, local, false);
        return;
      }
      if (kind === 'pointerdown') {
        let on = e.target;
        while (on && on !== tip.root) on = on.parent;
        if (on) return;   // a finger on a tall card scrolls it (1.7 mobile.js: #tip is left alone)
        if (held) { held = false; tip.hide(); tipKey = ''; closedAt = performance.now(); return; }   // a tap after a long press only closes it
        endHold();
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const t = g && !aim ? pick?.() ?? null : null;
        if (!t) return;
        const p = g.actors[g.playerId];
        // Item 79 (Justin 2026-10-17: "holding down on your position should rest"): a hold on the hero's own tile, mouse or
        // finger, raises the sleepers' z over the hero (item 177), then rests. A tap there stays a one-turn wait.
        if (p && t.x === p.x && t.y === p.y) {
          longPress = { at: { x: e.global.x, y: e.global.y }, rest: true, born: performance.now(), timer: setTimeout(() => {
            longPress = null; restDone = performance.now(); resting = true;
            try { navigator.vibrate?.(BUZZ); } catch { /* not allowed */ }
            deps.rest?.();
          }, LONG_MS) };
          return;
        }
        if (e.pointerType === 'mouse') return;   // a mouse has the hover card; only a finger needs the long press
        longPress = { at: { x: e.global.x, y: e.global.y }, timer: setTimeout(() => {
          longPress = null;
          if (showAt(g, t, local, true)) { held = true; try { navigator.vibrate?.(BUZZ); } catch { /* not allowed */ } }
        }, LONG_MS) };
        return;
      }
      // pointerup or pointerupoutside: an unfinished hold is dropped; a finished rest hold swallows this press's tap.
      endHold();
      if (resting) { resting = false; closedAt = performance.now(); }
    },
    /** True while a long-press card is up, a rest hold has fired, or one just ended: that press's tap must not also act on the map. */
    mapHeld() { return held || resting || performance.now() - closedAt < SWALLOW_MS; },
    get bar() { const u = game && !Array.isArray(game.hero?.hotbar) && unsaved.get(game.hero); return u || (game ? barOf(game) : []); },
  };
  return hud;
}
