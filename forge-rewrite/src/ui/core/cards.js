// Details on demand (window rule 2). With a mouse, a hover card beside the thing; on touch, the window's
// fixed info line at its bottom, so nothing moves. A detail is { title, sub?, lines?: string[], rows?: [label, value][] };
// its title is words, or { text, tags } for a word in its own colour (item 246: an element's name in the Forge).

import { Container, Graphics } from '../../../../forge-godot/runtime/pixi.js';
import { color, space, CARD } from './widgets.js';
import { stack, row, boundsIn } from './layout.js';

// CH-34 (1.7 journal-cards.css): a card up to 340 wide, 15 px copy, values 13 px regular mono, the name 20 px display.
const CARD_W = 340;

/** A card's title: its words, a tagged part in its own colour. */
function titleText(kit, t, style) {
  const x = kit.text(t?.text ?? t, style);
  if (t?.tags) x.style.tagStyles = t.tags;
  return x;
}

/** A card's words (title, sub, rows, lines) laid out at `width`: the hover card's body, and the hotbar hold menu's (T8). */
export function cardBody(kit, d, width) {
  let title = titleText(kit, d.title, { size: 20, font: 'display', weight: '700', fill: d.colour ?? kit.accent, wrap: d.pip !== undefined ? width - 14 : width });
  // 1.7 tierTint: a gear card's name in its quality colour after a small square pip of the same colour.
  if (d.pip !== undefined) {
    const t = new Container(), pip = new Graphics().roundRect(0, 0, 7, 7, 2).fill({ color: d.pip });
    pip.y = Math.round(kit.size(20) * 0.6 - 3.5); title.x = 13; t.addChild(pip, title); title = t;
  }
  const parts = [title];
  if (d.sub) parts.push(kit.text(d.sub, { size: 15, fill: color.dim, wrap: width }));
  for (const [k, v, fill] of d.rows ?? []) {
    const a = kit.text(k, { size: 15, fill: color.ash }), b = kit.text(String(v), { size: 13, font: 'mono', fill: fill ?? color.ink, wrap: Math.max(80, width - a.width - space.betweenRows), align: 'right' });
    const r = new Container(); b.x = width - b.width; b.y = Math.max(0, Math.round((a.height - b.height) / 2)); r.addChild(a, b);
    parts.push(r);
  }
  // A line is words, or { text, fill } for one in its own colour (a curse in red, the unidentified hint in violet).
  for (const l of d.lines ?? []) parts.push(kit.text(typeof l === 'string' ? l : l.text, { size: 15, fill: typeof l === 'string' ? color.ash : l.fill ?? color.ash, wrap: width }));
  return stack(parts, space.inRow);
}

/** The hover card layer. Lives on top of everything in the UI layer. */
/**
 * U7 (ui-30; sandbox lead's ruling 2026-10-18): every card's frame. The card grey (0x141619) and one soft shadow, the
 * card's shape stepped out six times 6 px low (1.7 painted-ui.css:465 box-shadow 0 6px 18px), drawn as stacked rects: no
 * BlurFilter, which cost every frame and blurred the pixel art. `radius` and `edge` (a stroke colour) keep each card's shape.
 */
export function cardFrame(w, h, { radius = 0, alpha = 0.95, edge = null } = {}) {
  const frame = new Container(), shade = new Graphics();
  for (let k = 6; k >= 1; k--) shade.roundRect(-k, 6 - k, w + k * 2, h + k * 2, radius + k).fill({ color: 0, alpha: 0.06 });
  const face = new Graphics().roundRect(edge === null ? 0 : 0.5, edge === null ? 0 : 0.5, edge === null ? w : w - 1, edge === null ? h : h - 1, radius).fill({ color: CARD, alpha });
  if (edge !== null) face.stroke({ color: edge, width: 1 });
  frame.addChild(shade, face);
  frame.eventMode = 'none';
  return frame;
}

export function createCards(kit, stage) {
  const root = new Container();
  root.eventMode = 'none';
  let owner = null, watch = null;
  // A card never outlives the pointer: any move off its item closes it (a rebuilt screen can miss pointerout).
  const off = () => { if (owner && watch) owner.off('globalpointermove', watch); watch = null; };

  return {
    root,
    show(node, d) {
      root.removeChildren().forEach(c => c.destroy({ children: true }));
      off();
      owner = node;
      watch = e => { if (node.destroyed || !node.getBounds().containsPoint(e.global.x, e.global.y)) this.hide(); };
      node.on('globalpointermove', watch);
      const CW = Math.min(CARD_W, stage.w - 20), pad = space.betweenRows + space.inRow, inner = cardBody(kit, d, CW - pad * 2);
      const h = inner.height + pad * 2;
      // 1.7's tooltip (CSS-29): a near-black card, no border, square corners, the soft shadow under it.
      inner.position.set(pad, pad);
      root.addChild(cardFrame(CW, h, { alpha: d.place === 'panel' ? 1 : 0.95 }), inner);
      const nb = boundsIn(node, root.parent), tl = { x: nb.x, y: nb.y }, br = { x: nb.x + nb.w, y: nb.y + nb.h };
      let x = br.x + space.betweenRows, y = tl.y;
      // d.place 'panel': creation's panel lines span the panel and the line-up stands beside it, so the card sits above the
      // panel where there is room (laptop), else over the panel's top (phone), never over the line-up (Justin 10-16, item 47).
      let p = d.place === 'panel' ? node : null;
      while (p && p.label !== 'creation-panel') p = p.parent;
      if (p) {
        const pb = boundsIn(p, root.parent), ptl = { x: pb.x, y: pb.y }, pbr = { x: pb.x + pb.w, y: pb.y + pb.h };
        x = Math.min(stage.w - CW - space.betweenRows, Math.max(space.betweenRows, ptl.x + (pbr.x - ptl.x - CW) / 2));
        // Above the panel, over the line-up, so it never covers the panel's header or the thing tapped (proof pass, 1.7 put
        // it off the panel). A sideways phone has no room above: beside the panel, on the line-up's side.
        y = Math.max(space.betweenRows, ptl.y - h - space.betweenRows);
        if (stage.kind !== 'P' && ptl.y - h - space.betweenRows < space.betweenRows) { x = Math.max(space.betweenRows, ptl.x - CW - space.betweenRows); y = Math.max(space.betweenRows, Math.min(ptl.y, stage.h - h - space.betweenRows)); }
      }
      else if (x + CW > stage.w - space.betweenRows) x = tl.x - CW - space.betweenRows;
      if (!p && x < space.betweenRows) { x = Math.min(stage.w - CW - space.betweenRows, Math.max(space.betweenRows, tl.x)); y = br.y + space.betweenRows; }
      if (!p && y + h > stage.h - space.betweenRows) y = Math.max(space.betweenRows, (x === br.x + space.betweenRows || x < tl.x ? br.y : tl.y) - h);
      root.position.set(Math.round(x), Math.round(y));
    },
    hide(node) {
      if (node && node !== owner) return;
      off();
      owner = null;
      root.removeChildren().forEach(c => c.destroy({ children: true }));
    },
  };
}

/** One fixed line (two at most) at the bottom of a window: where a tap's details go on touch. */
export function createInfoLine(kit, width) {
  const root = new Container();
  root.label = 'info-line';
  const lineH = kit.size(14) * 1.3;
  const height = Math.ceil(lineH * 2);
  root.addChild(new Graphics().rect(0, 0, width, height).fill({ color: 0, alpha: 0.001 }));
  let shown = null;
  return {
    root, height,
    show(node, d) {
      shown?.destroy({ children: true });
      const said = (d.lines ?? []).map(l => (typeof l === 'string' ? l : l.text));
      const tail = [d.sub, ...(d.rows ?? []).map(([k, v]) => `${k} ${v}`), ...said].filter(Boolean).join('. ');
      const name = titleText(kit, d.title, { size: 14, font: 'display', fill: d.colour ?? color.ink });
      const rest = kit.text(tail, { size: 14, fill: color.ash, wrap: width - name.width - space.betweenRows });
      if (rest.height <= height) {
        shown = row([name, rest], space.betweenRows, false);
      } else {
        // Too long for two lines (an attribute's Journal entry): the whole text on a card rising from the line over the
        // window, so nothing is cut (Justin 10-16). A tap on it puts it away.
        rest.destroy();
        const pad = space.betweenRows;
        // One line per part, as the hover card sets them: the sub and numbers on one line, then each line on its own.
        const head = [d.sub, (d.rows ?? []).map(([k, v]) => `${k} ${v}`).join('  ·  ')].filter(Boolean).join('  ·  ');
        const body = stack([name, ...[head, ...said].filter(Boolean).map(l => kit.text(l, { size: 14, fill: color.ash, wrap: width - pad * 2 }))], space.inRow);
        body.position.set(pad, pad);
        shown = new Container();
        const h = body.height + pad * 2;
        shown.addChild(new Graphics().roundRect(0, 0, width, h, 4).fill({ color: CARD, alpha: 1 }).stroke({ color: color.dim, width: 1, alpha: 0.6 }), body);
        shown.y = height - h;
        shown.eventMode = 'static';
        shown.on('pointertap', () => this.hide());
      }
      shown.label = 'info-shown';
      root.addChild(shown);
    },
    hide() { shown?.destroy({ children: true }); shown = null; },
  };
}
