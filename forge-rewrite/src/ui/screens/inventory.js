// Inventory, as 1.7 lays it out (review-1.7/rewrite-baseline/windows/*-inventory.png):
// L, wide: the numbers column, the worn slots either side of the paper doll (the hero in its gear, on a dark ground),
//   the bag as 5 x 5, the pouch as chips. L, short (a phone held sideways): worn slots 4+3 beside the bag, pouch below.
// P: worn slots in a grid, the bag, the pouch; the numbers below in the window's one scroll.
// Slots and items are 1.7's chips (core/chip.js). Mouse: click equips or uses, right click drops. Touch: a tap picks the
// item, its details fill the info line, and Equip / Drop show.

import { Container, Graphics, Sprite, Texture } from '../../../../forge-godot/runtime/pixi.js';
import { color, space } from '../core/widgets.js';
import { stack, grid, row, flow } from '../core/layout.js';
import { heading } from '../core/blocks.js';
import { chip } from '../core/chip.js';
import { icon, whenIconBooks, enchantDot } from '../core/icons.js';
import { dollSprite, hasSheet, sheet, heldGear, itemArtName } from '../core/art.js';   // C17: render through ui/core; item 325: the floor's picture names
import { numbers } from './character.js';
import { titleCase } from '../model/hero-view.js';
import { beginDrag, dragging } from '../core/drag.js';
import { sigilGlow } from '../core/pulse.js';
import { tone } from '../core/colour.js';
import { itemView } from '../model/item-view.js';
import { slotFor, equipRefusal } from '../../engine/reads.js';

const SHORT = { main: 'Main', off: 'Off', armour: 'Armor', amulet: 'Neck', ring1: 'Ring', ring2: 'Ring', ranged: 'Range' };
const GROUND = 0x1d1714;
// The cursed slot's #D0605A.
const CURSED_RIM = tone('bad');
// The bag item picked on touch (its Equip and Drop show), or the worn slot picked (T10: its Take off shows).
let picked = null, pickedWorn = null;
/** A fresh open picks nothing (1.7 drew the bag anew each time). */
export const inventoryFresh = () => { picked = null; pickedWorn = null; };
// The bag's cells by label, for the cast pulse's place (feature 136).
const bagCells = new Map();
// T11: where a drag out of this window may land, as the window is drawn now: the worn slots, the paper doll, the bag.
let zones = [];

/** True when the screen point lies on the node (its own bounds; a node a rebuild destroyed is never hit). */
function under(node, p) {
  if (!node || node.destroyed || !node.parent) return false;
  const l = node.toLocal(p), b = node.getLocalBounds();
  return l.x >= b.x && l.y >= b.y && l.x <= b.x + b.width && l.y <= b.y + b.height;
}
/** The window frame holding a node, for "let go outside the window" (shell.js labels it). */
function frameOf(node) {
  for (let n = node; n; n = n.parent) if (n.label === 'window-frame') return n;
  for (let n = node; n?.parent; n = n.parent) { const f = n.parent.children.find(c => c.label === 'window-frame'); if (f) return f; }
  return null;
}
/** A bag piece the rules would put in this worn slot: equip() takes it there (rules/hero.js equipRefusal; C4, ui-12). */
function fitsSlot(hero, slot, bagIndex) {
  if (!hero) return false;
  const r = equipRefusal(hero, bagIndex, slot === 'off' || slot === 'ring1' || slot === 'ring2' ? slot : null);
  return !r.why && r.slot === slot;
}

// A light one-handed weapon may go in the off hand, where it strikes again with each melee attack (rules/hero.js equip
// to 'off', 1.7 offHandSwing; sandbox item 62).
const offHandable = (hero, raw) => !!hero && raw?.kind === 'weapon' && slotFor(hero, raw, 'off').slot === 'off';
const usable = it => !!it && (it.kind === 'food' || it.kind === 'sigil');

/** One chip: the item in its family's rim, its count in the corner; an empty slot is a faint well. */
function cell(kit, it, size, o) {
  const c = new Container();
  // Gear wears its quality on the rim, and a bag piece the hero cannot use yet is faded (1.7 sheets.js:211, :347-348).
  c.addChild(it ? chip(it.icon, size, { rim: it.colour ?? undefined, dim: it.unmet }) : chip(null, size, { empty: true }));
  // W12 (1.7 sheets.js:41-42, :212-213): a worn piece shows its enchant as a dot in the element's colour at the top
  // right, and a known curse as a red rim inside the edge.
  if (it && o.label?.startsWith('worn-')) {
    if (it.cursed) c.addChild(new Graphics().roundRect(3, 3, size - 6, size - 6, 3).stroke({ color: CURSED_RIM, width: 1 }));
    const dot = enchantDot(it.enchant, size); if (dot) c.addChild(dot);
  }
  if (it && !it.icon) { const t = kit.text(it.name.slice(0, 3), { size: 12, fill: color.ash }); t.position.set(4, 4); c.addChild(t); }
  if (it?.count > 1) { const n = kit.text(String(it.count), { size: 12, font: 'mono', fill: color.ink, weight: '600' }); n.position.set(size - n.width - 3, size - n.height - 1); c.addChild(n); }
  if (o.selected) c.addChild(new Graphics().roundRect(0, 0, size, size, 4).stroke({ color: kit.accent, width: 2 }));
  // T11 (1.7 .gslot.over): a worn slot lights while a piece that fits it is dragged over.
  if (o.glow) { const g = new Graphics().roundRect(-2, -2, size + 4, size + 4, 6).fill({ color: kit.accent, alpha: 0.18 }).stroke({ color: kit.accent, width: 2 }); g.visible = false; g.eventMode = 'none'; c.addChild(g); c.glow = g; }
  if (o.label) c.label = o.label;
  if (o.label?.startsWith('bag-')) bagCells.set(o.label, c);
  if (it) kit.details(c, it.detail);
  // `o.drag`: {entry, ...beginDrag options}. Usable bag items, the worn bow (EQ12) and the worn amulet (EQ2) drag onto
  // the hotbar; every bag item and worn piece also drags onto the window's own places (T11, drag.js release).
  if (it && o.drag) { c.eventMode = 'static'; c.on('pointerdown', e => beginDrag(e, o.drag.entry, it.icon, null, o.drag)); }
  // The press that ends a drag never also taps the item it was let go on.
  // `o.click === false` (W34, a worn weapon or armour): a left click does nothing, as 1.7; right click, the confirm key
  // and the gamepad still take it off, so a hand with no drag keeps a way to.
  if (it && o.act) {
    if (o.click !== false) kit.control(c, () => { if (!dragging()) o.act(false); });
    else kit.hooks.controls.push({ node: c, act: () => o.act(false), group: 0 });
    c.on('rightclick', e => { e.stopPropagation(); o.act(true); });
  }
  // An empty slot that offers something (the Off hand: the bag's light weapons) takes a tap or a click too.
  if (!it && o.empty) { if (o.empty.act) kit.control(c, o.empty.act); kit.details(c, o.empty.detail); }
  return c;
}

/**
 * CSS-30 (painted-ui.css:656, 829): the doll's steel ground, radial-gradient(ellipse at 50% 70%, #2a2d31, #141619 70%)
 * in a 6 px rounded box. The ellipse is CSS's farthest-corner one: the closest-side shape (half the width by 30% of the
 * height) grown until it reaches the top corners. Painted once per size at twice the logical size.
 */
const groundTex = new Map();
function ground(w, h) {
  const key = `${w}x${h}`;
  let tex = groundTex.get(key);
  if (!tex && typeof document !== 'undefined') {
    const S = 2, c = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(w * S)), height: Math.max(1, Math.round(h * S)) }), g = c.getContext('2d');
    const k = Math.sqrt(1 + (0.7 / 0.3) ** 2), rx = 0.5 * w * k * S, ry = 0.3 * h * k * S;
    g.beginPath(); g.roundRect(0, 0, c.width, c.height, 6 * S); g.clip();
    g.setTransform(rx, 0, 0, ry, 0.5 * w * S, 0.7 * h * S);
    const r = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    r.addColorStop(0, '#2a2d31'); r.addColorStop(0.7, '#141619'); r.addColorStop(1, '#141619');
    g.fillStyle = r; g.fillRect(-1, -1, 2, 2);
    tex = Texture.from({ resource: c, scaleMode: 'linear' });
    if (groundTex.size > 8) groundTex.clear();
    groundTex.set(key, tex);
  }
  if (!tex) return new Graphics().roundRect(0, 0, w, h, 6).fill(GROUND);
  const s = new Sprite(tex);
  s.width = w; s.height = h; s.eventMode = 'none';
  return s;
}

/**
 * Item 224 (Justin 2026-10-19: "we have a tine sprite in a bog box"): the doll's scale in its box. A whole number n of
 * screen pixels to each sheet pixel, the largest that stands the figure (halfW either side of its feet, height tall)
 * in the box with a margin, so it is drawn crisp, nearest, as held gear is baked; smaller than its sheet only where the
 * box is (a phone), smoothly. density: screen pixels to a logical px. Returns {n, k}: n 0 below one step, k logical.
 */
export function dollStep(w, h, halfW, height, density, margin = 6) {
  const n = Math.floor(Math.min((w / 2 - margin) * density / halfW, (h - margin * 2) * density / height));
  return n >= 1 ? { n, k: n / density } : { n: 0, k: Math.min((w / 2 - margin) / halfW, (h - margin * 2) / height) };
}
/**
 * Where the doll's feet stand in its box, in logical px from its top: off the box's floor by a third of the height the
 * figure leaves free, so a short figure in a tall box stands higher without being centred (Justin 2026-10-19: "it's
 * jaring that she isn't more centered vertically. Not asking for centered, but some movement up here is warranted").
 * tall: the figure's height at its scale.
 */
export const dollFeet = (h, tall, margin = 6) => h - margin - Math.max(0, h - margin * 2 - tall) / 3;
/** How far the doll in its gear reaches, in sheet px from its feet: the body by its pose points, the held gear by its own pictures. */
function dollReach(fig, sh) {
  const m = sh.data.meta, pose = Object.values(sh.data.frames?.static?.pose ?? {}), figure = fig.children[0];
  let halfW = Math.max(m.cell * 0.28, ...pose.map(p => Math.abs(p[0] - m.cell / 2) + 14)), height = m.stand + 4;
  for (const g of figure.children) {
    if (g.texture === sh.textures.static) continue;
    const b = g.getBounds();
    halfW = Math.max(halfW, -b.x, b.x + b.width); height = Math.max(height, -b.y);
  }
  return { halfW, height };
}

/** The paper doll: 1.7's 256 px doll in the hero's gear, standing on its steel ground, in a box outlined as the cards are. */
const asked = new Set();
function doll(kit, v, w, h, ctx) {
  const c = new Container(), edge = new Graphics().roundRect(0.5, 0.5, w - 1, h - 1, 6).stroke({ color: color.edge, width: 1 });
  edge.label = 'doll-box';
  c.addChild(ground(w, h), edge);
  const look = v.look;
  // 1.7's paper doll in its gear (render/actor-sprite.js dollSprite) at one sheet px to a logical px, then grown in
  // whole screen-pixel steps to fill its box (dollStep), centred on its feet, raised where the box has room (dollFeet).
  if (look && hasSheet(look + '-doll')) {
    try {
      const sh = sheet(look + '-doll'), fig = dollSprite(look + '-doll', heldGear(ctx.game.hero), sh.data.meta.stand);
      const r = dollReach(fig, sh), { n, k } = dollStep(w, h, r.halfW, r.height, kit.density ?? 1);
      sh.textureSource.scaleMode = n ? 'nearest' : 'linear';
      const px = q => Math.round(q * (kit.density ?? 1)) / (kit.density ?? 1);
      fig.scale.set(k);
      fig.position.set(px(w / 2), px(dollFeet(h, r.height * k)));
      fig.label = 'doll-figure'; fig.step = n;
      c.addChild(fig);
      return c;
    } catch { /* the held-gear sheet is not loaded yet: the bare still doll stands in */ }
  }
  // Item 183: the doll comes with the hero's look group (look-<look>, loaded before floor 1); a window up before it is
  // in asks for that group and draws again when it arrives.
  const name = look ? look + '-doll' : null;
  if (!name || !hasSheet(name)) { if (look && ctx.loadGroups && !asked.has(look)) { asked.add(look); ctx.loadGroups(['look-' + look.replace(/^cast-/, '')]).then(() => ctx.reopen?.(), () => {}); } return c; }
  const s = new Sprite(sheet(name).textures.static);
  s.anchor.set(0);
  const k = Math.min(w, h) * 0.96 / Math.max(s.texture.width, s.texture.height);
  s.scale.set(k); s.position.set((w - s.width) / 2, (h - s.height) / 2);
  c.addChild(s);
  return c;
}

/**
 * T15 (1.7 sheets.js:210, :246-249 .gslot .ph): an empty worn slot shows a faint mark of what it takes, 1.7's glyphs
 * drawn in code: crossed swords (main hand), a shield with its cross (off hand, armour), an ankh (amulet), a ring, a bow
 * with its arrow (ranged). Fainter than 1.7's (Justin 2026-10-19: "the icon for empty needs to be more faded, i looks
 * like she has a ring equiped").
 */
function slotGlyph(slot, size) {
  const g = new Graphics(), r = size * 0.2, cx = size / 2, cy = size / 2, line = { color: color.dim, width: Math.max(1.5, size / 36), cap: 'round', join: 'round' };
  if (slot === 'main') {
    for (const s of [1, -1]) {
      g.moveTo(cx - s * r, cy + r).lineTo(cx + s * r * 0.95, cy - r * 0.95);
      g.moveTo(cx - s * r * 0.85, cy + r * 0.45).lineTo(cx - s * r * 0.45, cy + r * 0.85);
    }
  } else if (slot === 'off' || slot === 'armour') {
    g.moveTo(cx - r * 0.85, cy - r).lineTo(cx + r * 0.85, cy - r).lineTo(cx + r * 0.85, cy - r * 0.1)
      .quadraticCurveTo(cx + r * 0.8, cy + r * 0.7, cx, cy + r * 1.1).quadraticCurveTo(cx - r * 0.8, cy + r * 0.7, cx - r * 0.85, cy - r * 0.1).closePath();
    g.moveTo(cx, cy - r).lineTo(cx, cy + r * 1.1).moveTo(cx - r * 0.85, cy - r * 0.2).lineTo(cx + r * 0.85, cy - r * 0.2);
  } else if (slot === 'amulet') {
    g.ellipse(cx, cy - r * 0.6, r * 0.38, r * 0.5);
    g.moveTo(cx, cy - r * 0.1).lineTo(cx, cy + r * 1.1).moveTo(cx - r * 0.7, cy + r * 0.15).lineTo(cx + r * 0.7, cy + r * 0.15);
  } else if (slot === 'ring1' || slot === 'ring2') {
    g.circle(cx, cy, r * 0.7);
  } else if (slot === 'ranged') {
    g.moveTo(cx - r * 0.2, cy - r * 1.05).quadraticCurveTo(cx + r * 1.1, cy, cx - r * 0.2, cy + r * 1.05);
    g.moveTo(cx - r * 0.2, cy - r * 1.05).lineTo(cx - r * 0.2, cy + r * 1.05);
    g.moveTo(cx - r * 0.9, cy).lineTo(cx + r * 0.95, cy).moveTo(cx + r * 0.6, cy - r * 0.3).lineTo(cx + r * 0.95, cy).lineTo(cx + r * 0.6, cy + r * 0.3);
  }
  g.stroke(line);
  g.alpha = 0.35; g.label = 'slot-mark'; g.eventMode = 'none';
  return g;
}

/** A worn slot with its name beneath (1.7: Main hand, Off hand...). */
function wornSlot(kit, w, size, small, act, o = {}) {
  const c = new Container();
  const offers = { off: 'Tap or click to put a light weapon here. It strikes again with every melee attack.', ring1: 'Tap or click to put a ring on this hand.', ring2: 'Tap or click to put a ring on this hand.' };
  // W13 (1.7 slotCard): an empty slot's card says what it takes (Both hands under a two-hander); the off hand and the
  // ring hands also offer the bag's pieces on a tap or a click.
  const said = w.empty ?? { title: w.label, lines: [] };
  const empty = w.item ? null : offers[w.slot] && w.label !== 'Both hands' ? { act: () => act({ type: 'unequip', slot: w.slot }), detail: { ...said, lines: [...said.lines, offers[w.slot]] } } : { act: null, detail: said };
  // T10 (1.7 touchui.js:563, :567-574): on touch a tap picks the slot and its Take off shows; a click takes it off.
  const tap = o.pick ? () => o.pick(w.slot) : () => act({ type: 'unequip', slot: w.slot });
  // W34 (1.7 wireEquip, sheets.js:313-319): with a mouse a click takes off only a ring, the amulet or the bow; a worn
  // weapon, off hand or armour comes off by a drag to the bag or a right click, never by a stray click.
  const click = !!o.pick || !['main', 'off', 'armour'].includes(w.slot);
  const n = cell(kit, w.item, size, { label: 'worn-' + w.slot, act: drop => (drop ? act({ type: 'unequip', slot: w.slot }) : tap()), click, empty, glow: true, selected: o.selected, drag: o.drag });
  if (!w.item && w.label !== 'Both hands') n.addChildAt(slotGlyph(w.slot, size), 1);
  zones.push({ node: n, worn: w.slot });
  const name = kit.text(small ? SHORT[w.slot] : w.label, { size: small ? 12 : 14, fill: w.item ? color.ash : color.dim });
  name.anchor.set(0.5, 0); name.position.set(size / 2, size + 2);
  c.addChild(n, name);
  return c;
}

/** A pouch chip: its picture and words on a dark pill (1.7 .mote). */
function pill(kit, pic, words, fill, detail) {
  const t = kit.text(words, { size: 14, fill });
  const r = row([pic, t].filter(Boolean), space.inRow);
  const c = new Container(), h = Math.max(r.height + 8, kit.stage.touch ? kit.target : 0);
  c.addChild(new Graphics().rect(0, 0, r.width + 18, h).fill({ color: 0, alpha: 0.001 })
    .roundRect(0, (h - r.height - 8) / 2, r.width + 18, r.height + 8, (r.height + 8) / 2).fill({ color: 0x000000, alpha: 0.35 }), r);
  r.position.set(9, (h - r.height) / 2);
  return kit.details(c, detail);
}
const strip = (chips, w) => { const s = new Container(); chips.forEach(c => s.addChild(c)); flow(chips, w, space.betweenRows, space.betweenRows); return s; };

// W35 (1.7 equipResourcesHTML, sheets.js:221-226): each key with its painting, only those held; the carried core first.

function pouch(kit, v, w) {
  const motes = v.motes.map(m => pill(kit, icon('mote-' + m.el, 16), `${titleCase(m.el)} ×${m.n}`, m.n ? color.ink : color.ash, { title: `${titleCase(m.el)} motes`, rows: [['Held', m.n]] }));
  // The key's word goes on its card; the chip says "Iron ×2" so the keys keep to one line beside their heading.
  const keys = Object.entries(v.keys).filter(([, n]) => n > 0).map(([k, n]) => pill(kit, icon(itemArtName(null, { kind: 'key', key: k }), 18), `${titleCase(k)} ×${n}`, color.ink, { title: `${titleCase(k)} key`, rows: [['Held', n]] }));
  if (v.core) keys.unshift(pill(kit, icon(itemArtName(null, { kind: 'core', name: v.core }), 18), v.core, color.ink, { title: v.core, lines: ['Bring it to the exit gate.'] }));
  return stack([keys.length ? strip([heading(kit, 'Keys'), ...keys], w) : null, heading(kit, 'Pouch', `${v.essence} essence`), strip(motes, w)], space.betweenRows);
}

// T13 (1.7 touchui.js:556 verb): the card's word says what the tap does: Equip, Wear (armour), Take up (off hand), Eat,
// and Use for everything else, rings and amulets included, as 1.7 said.
export const VERB = { weapon: 'Equip', armour: 'Wear', offhand: 'Take up', food: 'Eat' };

/** T12 (1.7 touchui.js:286-303): on touch, a worn amulet with no hotbar slot (it was taken off the bar) offers one back. */
function amuletRow(kit, ctx) {
  const h = ctx.game?.hero, bar = h?.hotbar;
  if (!kit.stage.touch || !h?.worn?.amulet || !Array.isArray(bar) || bar.some(e => e?.kind === 'amulet')) return null;
  const b = kit.plateButton('Add amulet to hotbar', () => {
    const free = bar.indexOf(null);
    if (free < 0) { ctx.say?.('The hotbar is full. Hold an item slot to remove it first.'); return; }
    const next = bar.map((e, i) => (i === free ? { kind: 'amulet', id: 'amulet' } : e));
    ctx.command?.({ type: 'hotbar', slots: next });
  }, { h: 34, size: 14 });
  b.label = 'amulet-to-hotbar';
  return b;
}

function actionRow(kit, it, bagIndex, act, off, w) {
  const verb = VERB[it.kind] ?? 'Use';
  const name = kit.text(it.name, { size: 16, fill: it.colour ?? color.ink, weight: '600', wrap: w });
  const plates = row([kit.plateButton(verb, () => act({ type: usable(it) ? 'use' : 'equip', bag: bagIndex }), { h: 34, size: 14, rank: 'prominent' }),
    off ? kit.plateButton('Off hand', () => act({ type: 'equip', bag: bagIndex, to: 'off' }), { h: 34, size: 14, rank: 'prominent' }) : null,
    kit.plateButton('Drop', () => act({ type: 'drop', bag: bagIndex }), { h: 34, size: 14 })].filter(Boolean), space.betweenRows);
  // The name above the plates when one line would run past the window (a phone with three plates).
  if (name.width + space.betweenRows + plates.width > w) return stack([name, plates], space.inRow);
  return row([name, plates], space.betweenRows);
}

/** T10: the worn piece picked on touch: its name and Take off (1.7's card button). */
function wornRow(kit, w, act, width) {
  const name = kit.text(w.item.name, { size: 16, fill: w.item.colour ?? color.ink, weight: '600', wrap: width });
  const off = kit.plateButton('Take off', () => act({ type: 'unequip', slot: w.slot }), { h: 34, size: 14, rank: 'prominent' });
  off.label = 'take-off';
  if (name.width + space.betweenRows + off.width > width) return stack([name, off], space.inRow);
  return row([name, off], space.betweenRows);
}

/**
 * @param {ReturnType<import('../core/widgets.js').createKit>} kit
 * @param {{w:number,h:number}} area @param {ReturnType<import('../model/hero-view.js').heroView>} v
 * @param {{command:(c:any)=>void, reopen?:()=>void, clock?:any, game:any}} ctx
 */
export function buildInventory(kit, area, v, ctx) {
  const P = kit.stage.kind === 'P', touch = kit.stage.touch, sec = space.betweenSections;
  whenIconBooks(() => ctx.reopen?.());
  bagCells.clear();
  const act = c => { picked = null; pickedWorn = null; ctx.command?.(c); };
  if (picked !== null && !v.bag[picked]) picked = null;
  if (pickedWorn !== null && !v.worn.find(w => w.slot === pickedWorn)?.item) pickedWorn = null;
  zones = [];
  const short = !P && area.h < 420;
  // A touch cell stays at least 48 CSS px, including the sideways phone's 0.8 stage scale. Collections may scroll;
  // shrinking their hit targets to force the whole bag above the fold makes crowded late-game gear hard to use.
  const minCell = kit.target;
  const cellSize = P ? Math.max(minCell, Math.min(64, Math.floor((area.w - 4 * space.inRow) / 5))) : 67;
  const gap = P ? space.inRow : 1;
  const raw = ctx.game?.hero?.bag ?? [];
  const slots = Object.fromEntries(v.worn.map(w => [w.slot, w]));
  // T11 (1.7 touchui.js:437-531): a bag item let go on a worn slot it fits is worn there, on the paper doll it is
  // equipped or used as a tap would, and outside the window it is dropped; worn gear let go on the bag comes off.
  const zoneAt = p => zones.find(z => under(z.node, p));
  const tapCommand = i => ({ type: usable(v.bag[i]) ? 'use' : 'equip', bag: i });
  const wearCommand = (i, slot) => (slot === 'ring1' || slot === 'ring2' ? { type: 'equip', bag: i, to: slot } : slot === 'off' && v.bag[i].kind !== 'offhand' ? { type: 'equip', bag: i, to: 'off' } : { type: 'equip', bag: i });
  const bagDrag = i => ({
    entry: usable(v.bag[i]) ? { kind: 'item', id: v.bag[i].id } : { kind: 'gear', id: v.bag[i].id },
    bar: usable(v.bag[i]), fade: usable(v.bag[i]) ? undefined : 0.6,
    over: p => { const z = p && zoneAt(p); for (const w of zones) if (w.worn && w.node.glow) w.node.glow.visible = !!z && z === w && fitsSlot(ctx.game?.hero, w.worn, i); },
    release: (p, onBar) => {
      if (onBar) return;   // gear has no hotbar slot
      const z = zoneAt(p);
      if (z?.worn) { if (fitsSlot(ctx.game?.hero, z.worn, i)) act(wearCommand(i, z.worn)); return; }
      if (z?.doll) return bagAct(tapCommand(i));
      const frame = frameOf(zones.find(z => !z.node.destroyed && z.node.parent)?.node);
      if (frame && !under(frame, p)) act({ type: 'drop', bag: i });
    },
  });
  const wornDrag = slot => ({
    entry: slot === 'ranged' ? { kind: 'ranged', id: 'bow' } : slot === 'amulet' ? { kind: 'amulet', id: 'amulet' } : { kind: 'worn', id: slot },
    bar: slot === 'ranged' || slot === 'amulet', fade: slot === 'ranged' || slot === 'amulet' ? undefined : 0.6,
    release: (p, onBar) => { if (!onBar && zoneAt(p)?.bag) act({ type: 'unequip', slot }); },
  });
  /** One bag cell: a click equips or uses, right click drops; on touch a tap picks it first. */
  const bagCell = (it, i, size) => cell(kit, it, size, {
    label: 'bag-' + i, selected: picked === i, drag: it ? bagDrag(i) : null,
    act: drop => {
      if (drop) return act({ type: 'drop', bag: i });
      if (touch && picked !== i) { picked = i; pickedWorn = null; ctx.reopen?.(); return; }
      bagAct(tapCommand(i));
    },
  });
  const bagGrid = (size, cols, g) => { const n = grid(v.bag.map((it, i) => bagCell(it, i, size)), cols, size, size, g); zones.push({ node: n, bag: true }); return n; };
  const used = v.bag.filter(Boolean).length;
  // Made only by the layouts that show it, so a drop never lands on a grid that is not on screen.
  const bagBlock = () => stack([heading(kit, `Bag (${used} / ${v.bag.length})`), bagGrid(cellSize, 5, gap)], space.betweenRows);
  const pick = width => picked !== null && v.bag[picked] ? actionRow(kit, v.bag[picked], picked, c => bagAct(c), offHandable(ctx.game?.hero, raw[picked]), width)
    : pickedWorn !== null && slots[pickedWorn]?.item ? wornRow(kit, slots[pickedWorn], act, width) : amuletRow(kit, ctx);
  /** One worn slot: on touch a tap picks it (T10); every worn piece drags (T11). */
  const wornAt = (k, s, small) => wornSlot(kit, slots[k], s, small, wornAct, {
    pick: touch ? slot => { pickedWorn = pickedWorn === slot ? null : slot; picked = null; ctx.reopen?.(); } : null,
    selected: pickedWorn === k, drag: slots[k]?.item ? wornDrag(k) : null,
  });
  // T14 (1.7 mobile.js:261-263, Justin 10-15 "scroll down on phones and see the combat / paper doll side by side"):
  // held upright, the hero in its gear stands beside the numbers under the pouch.
  const dollBeside = () => {
    const dw = Math.min(240, Math.round(area.w * (area.w >= 560 ? 0.32 : 0.38))), nw = area.w - dw - sec;
    const nums = numbers(kit, v, nw, nw >= 420 ? 2 : 1);
    const d = doll(kit, v, dw, Math.round(Math.max(dw * 1.15, Math.min(nums.height, dw * 1.7))), ctx);
    d.label = 'inventory-doll';
    zones.push({ node: d, doll: true });
    nums.x = dw + sec;
    const c = new Container(); c.addChild(d, nums);
    return c;
  };
  // An empty Off hand slot offers the light weapons in the bag (a tap or a click on it); a filled one takes it off.
  const offChoices = raw.map((it, i) => (offHandable(ctx.game?.hero, it) ? i : -1)).filter(i => i >= 0);
  const openOff = () => { picked = null; ctx.open?.('Choose', { title: 'Off hand', what: 'Choose a light weapon for your off hand. It strikes again with every melee attack.', keep: 'Cancel', back: 'Inventory', items: offChoices.map(i => ({ item: raw[i], command: { type: 'equip', bag: i, to: 'off' } })) }); };
  // An empty ring hand offers the bag's rings for that hand; a ring put on when both hands wear one asks which it replaces
  // (rules/hero.js equip `to: 'ring1' | 'ring2'`, engine 12b191b).
  const rings = raw.map((it, i) => (it?.kind === 'ring' ? i : -1)).filter(i => i >= 0);
  const openRing = hand => { picked = null; ctx.open?.('Choose', { title: slots[hand]?.label ?? 'Ring', what: 'Choose a ring for this hand.', keep: 'Cancel', back: 'Inventory', items: rings.map(i => ({ item: raw[i], command: { type: 'equip', bag: i, to: hand } })) }); };
  const askHand = i => { picked = null; ctx.open?.('Choose', { title: 'Which hand?', what: 'Both hands wear a ring. Choose the ring to take off.', keep: 'Cancel', back: 'Inventory', items: ['ring1', 'ring2'].map(hand => ({ item: ctx.game.hero.worn[hand], num: hand === 'ring1' ? 'Left hand' : 'Right hand', command: { type: 'equip', bag: i, to: hand } })) }); };
  const emptyOffer = c => (c.slot === 'off' ? (offChoices.length ? openOff() : null) : rings.length ? openRing(c.slot) : null);
  const wornAct = c => (c.type === 'unequip' && slots[c.slot] !== undefined && !slots[c.slot]?.item && (c.slot === 'off' || c.slot === 'ring1' || c.slot === 'ring2') ? emptyOffer(c) : act(c));
  const equipAct = c => (c.type === 'equip' && !c.to && raw[c.bag]?.kind === 'ring' && ctx.game?.hero?.worn?.ring1 && ctx.game?.hero?.worn?.ring2 ? askHand(c.bag) : act(c));
  // Feature 136 (Justin 2026-10-17): a sigil read from the bag pulses its slot in the rune's colour and says "You cast
  // Blink" there, so a cast never looks like nothing happened. The slot is measured before the cast rebuilds the window.
  const bagAct = c => {
    const it = c.type === 'use' ? raw[c.bag] : null;
    if (it?.kind !== 'sigil') return equipAct(c);
    const at = bagCells.get('bag-' + c.bag)?.getBounds(), had = it.count ?? 1;
    act(c);
    // Only a cast that took: the sigil's stack went down (a refused cast, 'no free tile in sight', says why in the log
    // and flashes nothing; a picker sigil waits for its choice).
    const left = ctx.game?.hero?.bag?.includes(it) ? it.count ?? 1 : 0;
    if (left >= had) return;
    const seen = itemView(it, ctx.game);
    ctx.ui?.castFlash?.(at, sigilGlow(seen?.icon), seen?.name ?? 'a sigil');
  };

  if (P && area.w >= 560) {
    // A tablet held upright: worn slots two across beside the bag, as a phone held sideways has them (Justin 10-16);
    // then the pouch and the numbers under them.
    const s = 60, worn = new Container();
    ['main', 'off', 'armour', 'amulet', 'ring1', 'ring2', 'ranged'].forEach((k, i) => {
      const n = wornAt(k, s, false); n.position.set((i % 2) * (s + 40), Math.floor(i / 2) * (s + 28)); worn.addChild(n);
    });
    // A label wider than its slot ('Main hand') overhangs it on both sides; the grid starts where the first label does
    // (proof pass item 9: it read 'ain hand' at 768x1024).
    worn.pivot.x = Math.min(0, Math.floor(worn.getLocalBounds().x));
    const left = stack([heading(kit, 'Worn'), worn], space.betweenRows);
    const tc = Math.min(72, Math.floor((area.w - left.width - sec * 2 - 8) / 5));
    const big = stack([heading(kit, `Bag (${used} / ${v.bag.length})`), bagGrid(tc, 5, 2)], space.betweenRows);
    big.x = area.w - big.width;
    const top = new Container(); top.addChild(left, big);
    return stack([top, pick(area.w), pouch(kit, v, area.w), dollBeside()], sec);
  }
  if (P) {
    // Four slots then three: each worn piece keeps a real touch target and its own label.
    const order = ['main', 'off', 'armour', 'amulet', 'ring1', 'ring2', 'ranged'];
    const s = Math.max(minCell, Math.min(56, Math.floor((area.w - 3 * space.betweenRows) / 4)));
    const worn = new Container();
    order.forEach((k, i) => { const n = wornAt(k, s, true); n.position.set((i % 4) * (s + space.betweenRows), Math.floor(i / 4) * (s + kit.size(12) * 1.3 + space.betweenRows)); worn.addChild(n); });
    return stack([stack([heading(kit, 'Worn'), worn], space.betweenRows), pick(area.w), bagBlock(), pouch(kit, v, area.w), dollBeside()], sec);
  }
  if (short) {
    // Sideways phones: worn slots 4+3 beside the bag, with the motes below. The doll remains on taller screens.
    const labelH = kit.size(12) * 1.3, gap = space.inRow, s = Math.max(minCell, 60), gapX = space.betweenRows;
    const worn = new Container();
    [['main', 'off', 'armour', 'ranged'], ['amulet', 'ring1', 'ring2']].forEach((line, r) => line.forEach((k, i) => {
      const n = wornAt(k, s, true); n.position.set(i * (s + gapX), r * (s + labelH + 4)); worn.addChild(n);
    }));
    // Compact mote cells keep the element's painting and count, with full words in the fixed info line.
    const motes = new Container();
    const mw = Math.floor((4 * (s + gapX) - gapX) / 3), mh = Math.max(32, kit.target);
    v.motes.forEach((m, i) => {
      const c = new Container(), pic = icon('mote-' + m.el, 18), n = kit.text(String(m.n), { size: 12, fill: m.n ? color.ink : color.dim, weight: '600' });
      c.addChild(new Graphics().rect(0, 0, mw, mh).fill({ color: 0, alpha: 0.001 }));
      if (pic) c.addChild(pic);
      if (pic) pic.position.set(space.betweenRows, (mh - pic.height) / 2);
      n.position.set(28, (mh - n.height) / 2); c.addChild(n);
      c.position.set((i % 3) * mw, Math.floor(i / 3) * mh);
      motes.addChild(kit.details(c, { title: `${titleCase(m.el)} motes`, rows: [['Held', m.n]] }));
    });
    const essence = row([kit.text(String(v.essence), { size: 12, fill: color.ink, weight: '600' }), kit.text('essence', { size: 12, fill: color.ash })], space.inRow);
    const left = stack([heading(kit, 'Worn'), worn, motes, essence], space.inRow);
    const room = area.w - left.width - sec * 2;
    const cols = Math.max(1, Math.min(9, Math.floor((room + gap) / (minCell + gap))));
    const bc = Math.max(minCell, Math.min(66, Math.floor((room - gap * (cols - 1)) / cols)));
    const bagWide = stack([heading(kit, `Bag (${used} / ${v.bag.length})`), pick(room), bagGrid(bc, cols, gap)], space.betweenRows);
    bagWide.x = left.width + sec * 2;
    const c = new Container(); c.addChild(left, bagWide);
    return c;
  }
  // Laptop and tablet landscape: 1.7's four parts in a row.
  const bag = bagBlock();
  let numW = 200, nums = numbers(kit, v, numW, 1);
  if (nums.height > area.h) { nums.destroy({ children: true }); numW = 340; nums = numbers(kit, v, numW, 2); }
  const slot = 67, pitch = slot + kit.size(14) + 26, dollW = Math.max(120, Math.min(334, area.w - numW - 26 - 2 * (slot + 18) - bag.width - 52)), dollH = Math.min(312, pitch * 3 - 20);
  const worn = new Container();
  ['main', 'armour', 'ring1', 'ranged'].forEach((k, i) => { const n = wornAt(k, slot, false); n.position.set(0, i * pitch); worn.addChild(n); });
  ['off', 'amulet', 'ring2'].forEach((k, i) => { const n = wornAt(k, slot, false); n.position.set(slot + 18 + dollW + 18, i * pitch); worn.addChild(n); });
  const d = doll(kit, v, dollW, dollH, ctx);
  zones.push({ node: d, doll: true });
  d.position.set(slot + 18, -14);
  worn.addChild(d);
  const wornBlock = stack([heading(kit, 'Worn'), worn], space.betweenSections);
  const right = stack([bag, pick(bag.width), pouch(kit, v, bag.width)].filter(Boolean), sec);
  wornBlock.position.set(numW + 26, 0);
  right.position.set(area.w - bag.width, 0);
  const c = new Container();
  c.addChild(nums, wornBlock, right);
  return c;
}
