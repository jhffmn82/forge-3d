// Window pieces every screen shares: section headings, label-and-number pairs, and one-line list items
// (icon, name, key number) that carry their details for the hover card or the info line.

import { Container, Graphics } from '../../../../forge-godot/runtime/pixi.js';
import { color, space, CARD } from './widgets.js';
import { icon } from './icons.js';
import { chip } from './chip.js';
import { grid, split } from './layout.js';
import { beginDrag } from './drag.js';

/** A section heading in blackletter, with an optional quiet note after it ("2 to spend"); `fill` for a heading in
 *  another colour than the highlight (the Faith window's in the god's, CSS-19). */
/** A god's (or any titled name's) header: the name in its colour over its title (ui-42: the Faith tab twice, the shrine). */
export const nameplate = (kit, name, title, fill, big = true, width) => [kit.text(name, { size: big ? 26 : 20, font: 'display', fill, wrap: width }), kit.text(title, { size: big ? 16 : 14, fill: color.ash, wrap: width })];

export function heading(kit, words, note, maxW = Infinity, fill = kit.accent) {
  const c = new Container();
  const t = kit.text(words, { size: 20, font: 'display', fill, wrap: Number.isFinite(maxW) ? maxW : undefined });
  c.addChild(t);
  if (note) {
    const n = kit.text(note, { size: 14, fill: color.ash });
    if (t.width + space.betweenRows + n.width <= maxW) n.position.set(t.width + space.betweenRows, Math.round(t.height - n.height - 2));
    else n.position.set(0, t.height);
    c.addChild(n);
  }
  return c;
}

/** One label with its number right-aligned in `w`. Optional value colour and details. */
export function pair(kit, label, value, w, o = {}) {
  const c = new Container();
  const a = kit.text(label, { size: o.size ?? 14, fill: o.labelFill ?? color.ash });
  const b = kit.text(String(value), { size: o.size ?? 14, fill: o.fill ?? color.ink, weight: '600' });
  if (o.tags) b.style.tagStyles = o.tags;   // a part of the value in its own colour (W31: the shield on HP)
  b.x = w - b.width;
  // A label never runs under its number and keeps its size: with no room it wraps to a second line (sandbox lead on the
  // proof pass, 2026-10-17: 'Attack speed122%' at 844x390, labels shrunk smaller than their neighbours).
  const room = b.x - space.betweenRows;
  if (a.width > room) { a.style.wordWrap = true; a.style.wordWrapWidth = Math.max(40, room); }
  c.addChild(new Graphics().rect(0, 0, w, Math.max(a.height, b.height)).fill({ color: 0, alpha: 0.001 }), a, b);
  if (o.detail) kit.details(c, o.detail);
  return c;
}

/** Pairs laid out in `cols` columns across `w`, read down each column then across (as 1.7's sheet did). */
export function pairs(kit, list, w, cols, o = {}) {
  const { w: cw, xs } = split(w, cols, o.gap ?? space.betweenSections + space.betweenRows);
  const per = Math.ceil(list.length / cols), c = new Container(), ps = [];
  list.forEach(([label, value, extra], i) => {
    const p = pair(kit, label, value, cw, { fill: extra?.fill, labelFill: extra?.labelFill, detail: extra?.detail, tags: extra?.tags });
    ps.push(p); c.addChild(p);
  });
  // Row by row, each as tall as its tallest pair (a wrapped label makes its row taller in both columns).
  let y = 0;
  for (let r = 0; r < per; r++) {
    const row = ps.filter((p, i) => i % per === r);
    row.forEach(p => { const col = Math.floor(ps.indexOf(p) / per); p.position.set(xs[col], y); });
    y += Math.max(...row.map(p => p.height)) + (o.rowGap ?? space.inRow);
  }
  return c;
}

/** Keep the chosen text size. Details retain the full name when its single-line label needs an ellipsis. */
function fitLabel(label, width) {
  if (label.width <= width) return;
  const text = label.text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    label.text = text.slice(0, mid).trimEnd() + '…';
    if (label.width <= width) lo = mid; else hi = mid - 1;
  }
  label.text = text.slice(0, lo).trimEnd() + '…';
}

/**
 * A one-line list item: icon, name, optional key number on the right (window rule 1).
 * @param {{icon?:string|null, pic?:(size:number)=>any, tile?:boolean, from?:string, fromFill?:number, words?:string, name:string, num?:string, numFill?:number, fill?:number, lit?:number, detail?:any, act?:()=>void, dim?:boolean, drag?:{kind:string,id:string}}} it
 */
export function line(kit, it, w) {
  const c = new Container();
  // Ability and prayer icons sit in a square tile drawn the way the hotbar draws its slots (Justin 10-16).
  // `it.pic(size)`: a picture of its own (a creature's still in the Bestiary, W19), 1.7's 48 px.
  const iconSize = it.iconSize ?? (it.tile ? (kit.stage.kind === 'P' ? 48 : 56) : it.pic ? (kit.stage.kind === 'P' ? 40 : 48) : kit.size(16) + space.betweenRows * 2);
  const h = Math.max(iconSize, kit.stage.touch && (it.act || it.detail || it.focus) ? kit.target : 0);
  c.addChild(new Graphics().rect(0, 0, w, h).fill({ color: 0, alpha: 0.001 }));
  let x = 0;
  const top = Math.round((h - iconSize) / 2);
  // Tiles are 1.7's hotbar chips: the well, a rim and glow in the icon's family colour (core/chip.js).
  const pic = it.tile ? chip(it.icon, iconSize, { dim: it.dim }) : it.pic ? it.pic(iconSize) : icon(it.icon, iconSize);
  if (pic) { pic.y += top; c.addChild(pic); }
  if (pic || it.tile) x = iconSize + space.betweenRows + (it.tile ? space.inRow : 0);
  const name = kit.text(it.name, { size: 16, fill: it.fill ?? (it.dim ? color.dim : color.ink) });
  // A long name keeps its size without running under the number.
  // The number's own width (plus a gap), not a guess: 'Consecrate10 favor' ran together at 844x390 (sandbox lead, 10-17).
  const numW = it.num !== undefined && it.num !== null ? kit.text(String(it.num), { size: 14, weight: '600' }) : null;
  const room = w - x - (numW ? numW.width + space.betweenRows : 0) - (it.side ? 32 : 0);
  numW?.destroy();
  fitLabel(name, Math.max(1, room));
  // Where it came from, under its name (Justin 10-16): the class, the element and rank, the god, the race, the gear.
  // W30 (1.7 sheets.js:135-141, :163, :172): an element's or a god's line in that element's or god's colour (`fromFill`).
  const from = it.from ? kit.text(it.from, { size: 12, fill: it.fromFill ?? color.dim }) : null;
  if (from) fitLabel(from, Math.max(1, room));
  // CSS-18 (1.7 faith .ab-words, painted-ui.css:1143-1144): what it does, in small ash under the name, when there is room.
  const words = it.words ? kit.text(it.words, { size: 14, fill: color.ash, wrap: Math.max(40, w - x) }) : null;
  const block = name.height + (from ? from.height : 0) + (words ? words.height + 2 : 0);
  if (block > h) c.getChildAt(0).clear().rect(0, 0, w, block).fill({ color: 0, alpha: 0.001 });
  name.position.set(x, words ? 0 : Math.max(0, Math.round((h - block) / 2)));
  c.addChild(name);
  if (from) { from.position.set(x, name.y + name.height - 2); c.addChild(from); }
  if (words) { words.position.set(x, (from ? from.y + from.height : name.y + name.height) + 2); c.addChild(words); }
  // `it.side`: a small word that acts, at the right under the number (CSS-31, 1.7's Run report under each run).
  const side = it.side ? kit.button(it.side.words, it.side.act, { size: 14, font: 'body', tight: true, primary: true }) : null;
  if (it.num !== undefined && it.num !== null) {
    const n = kit.text(String(it.num), { size: 14, fill: it.numFill ?? color.ash, weight: '600' });
    n.position.set(w - n.width, words || side ? Math.round((name.height - n.height) / 2) : Math.round((h - n.height) / 2));
    c.addChild(n);
  }
  if (side) {
    // The word's right edge lines up with the number's; the row grows to hold it.
    side.label = it.side.label ?? 'side';
    side.position.set(w - side.width + space.betweenRows, Math.max(name.y + name.height - 2, (from ? from.y : 0)));
    const foot = side.y + side.height;
    if (foot > c.getChildAt(0).height) c.getChildAt(0).clear().rect(0, 0, w, foot).fill({ color: 0, alpha: 0.001 });
    c.addChild(side);
  }
  // `it.progress` (0 to 1): 1.7's 2 px achievement bar (forge-skin.css:358-361), the done part in the highlight on a faint
  // track, under the words; none once earned.
  if (it.progress !== undefined && it.progress !== null) {
    const y = Math.round(c.height + 3), bw = w - x, g = new Graphics().rect(x, y, bw, 2).fill({ color: 0xffffff, alpha: 0.12 });
    if (it.progress > 0) g.rect(x, y, Math.max(1, Math.round(bw * Math.min(1, it.progress))), 2).fill(kit.accent);
    g.label = 'progress';
    c.addChild(g);
  }
  if (it.detail) kit.details(c, it.detail);
  if (it.act) kit.control(c, it.act);
  // W38 (1.7 wireChar, sheets.js:194-195): `it.focus`: a tile that only explains itself still takes keyboard and gamepad
  // focus, and its card shows while it holds it (confirm shows it again).
  else if (it.focus && it.detail) {
    c.setFocus = on => (on ? kit.hooks.show?.(c, it.detail) : kit.hooks.hide?.(c));
    kit.hooks.controls.push({ node: c, act: () => kit.hooks.show?.(c, it.detail), group: 0 });
  }
  // `it.lit`: the name's colour under the pointer (CSS-17, 1.7 painted-ui.css:733 the sheet's names light on hover).
  if (it.lit !== undefined) {
    const rest = name.style.fill;
    c.eventMode = 'static';
    c.on('pointerover', e => { if (e.pointerType === 'mouse' && !name.destroyed) name.style.fill = it.lit; });
    c.on('pointerout', () => { if (!name.destroyed) name.style.fill = rest; });
  }
  // Drag onto the hotbar (the HUD's drag.js): a move or a long press turns the press into a drag; a tap stays a tap.
  // CSS-27 (painted-ui.css:645, 868): a row that drags onto the hotbar shows the grab cursor.
  if (it.drag) { c.eventMode = 'static'; if (!it.act) c.cursor = 'grab'; c.on('pointerdown', e => beginDrag(e, it.drag, it.icon)); }
  return c;
}

/** One-line items as a grid of `cols` across `w`. */
export function lines(kit, items, w, cols) {
  const gap = space.betweenSections;
  const cw = Math.floor((w - gap * (cols - 1)) / cols);
  const cells = items.map(it => line(kit, it, cw));
  // Each row takes only the height its own items need.
  const c = new Container();
  let y = 0;
  for (let at = 0; at < cells.length; at += cols) {
    const row = cells.slice(at, at + cols);
    row.forEach((cell, i) => { cell.position.set(i * (cw + gap), y); c.addChild(cell); });
    y += Math.max(...row.map(cell => cell.height)) + space.inRow;
  }
  return c;
}

/** A quiet word where a list is empty ("None yet"). */
export const none = (kit, words = 'None yet', width) => kit.text(words, { size: 14, fill: color.dim, wrap: width });

/**
 * A collection as one-line items in `cols` columns, paged to fit `h` (no scroll on a laptop, window rule 8). The page
 * words sit under the grid; `at` is the page shown, `go(n)` changes it. Phones get every item (their one scroll).
 */
export function paged(kit, items, w, h, cols, at, go) {
  const gap = space.betweenSections, cw = Math.floor((w - gap * (cols - 1)) / cols);
  const cells = items.map(it => line(kit, it, cw));
  if (!cells.length) return none(kit);
  const ch = Math.max(...cells.map(c => c.height)) + space.inRow;
  if (kit.stage.kind === 'P') return grid(cells, cols, cw, ch - space.inRow, gap, space.inRow);
  const rows = Math.max(1, Math.floor((h - kit.target - space.betweenRows) / ch)), per = rows * cols;
  const pages = Math.max(1, Math.ceil(cells.length / per)), page = Math.min(at, pages - 1);
  const shown = cells.slice(page * per, page * per + per);
  cells.filter(c => !shown.includes(c)).forEach(c => c.destroy({ children: true }));
  const g = grid(shown, cols, cw, ch - space.inRow, gap, space.inRow);
  if (pages === 1) return g;
  const nav = new Container();
  const prev = kit.button('‹', () => go(Math.max(0, page - 1)), { size: 26, font: 'body', dim: page === 0 });
  const where = kit.text(`${page + 1} / ${pages}`, { size: 14, fill: color.ash });
  const next = kit.button('›', () => go(Math.min(pages - 1, page + 1)), { size: 26, font: 'body', dim: page === pages - 1 });
  prev.label = 'page-prev'; next.label = 'page-next';
  where.position.set(prev.width + space.betweenRows, Math.round((prev.height - where.height) / 2));
  next.x = where.x + where.width + space.betweenRows;
  nav.addChild(prev, where, next);
  nav.position.set(Math.round((w - nav.width) / 2), rows * ch + space.inRow);
  const c = new Container();
  c.addChild(g, nav);
  return c;
}

export const PANEL_PAD = 14;

/** A group in its own dark panel, its heading inside (Options, the merchant: Justin 10-16 "visual breaks"). */
export function panel(kit, title, w, inner) {
  const c = new Container();
  const head = heading(kit, title, null, w - PANEL_PAD * 2);
  inner.position.set(PANEL_PAD, PANEL_PAD + head.height + space.betweenRows);
  head.position.set(PANEL_PAD, PANEL_PAD - 2);
  const h = inner.y + inner.height + PANEL_PAD;
  c.addChild(new Graphics().roundRect(0, 0, w, h, 6).fill({ color: 0x000000, alpha: 0.28 }), head, inner);
  return c;
}
