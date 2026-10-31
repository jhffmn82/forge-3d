// Layout helpers: rows, stacks and grids on the 4/8/16 spacing. Screens declare what they show; these place it.

import { Container } from '../../../../forge-godot/runtime/pixi.js';
import { space } from './widgets.js';

/** Lays children out left to right, wrapping into rows; returns the height used. */
export function flow(children, width, gapX, gapY) {
  let x = 0, y = 0, rowH = 0;
  for (const c of children) {
    if (x > 0 && x + c.width > width) { x = 0; y += rowH + gapY; rowH = 0; }
    c.position.set(x, y);
    x += c.width + gapX; rowH = Math.max(rowH, c.height);
  }
  return y + rowH;
}

/** Columns that fit the width, each at least minCell wide (window rule 6). */
export function columns(width, minCell, gap) {
  return Math.max(1, Math.floor((width + gap) / (minCell + gap)));
}

/** Stacks nodes top to bottom in a new container, `gap` apart. Each keeps its own x (an indent or a centring). */
export function stack(nodes, gap = space.betweenRows) {
  const c = new Container();
  let y = 0;
  for (const n of nodes.filter(Boolean)) { n.y = y; c.addChild(n); y += n.height + gap; }
  return c;
}

/** Places nodes side by side in a new container, `gap` apart, centred on the tallest. */
export function row(nodes, gap = space.inRow, middle = true) {
  const c = new Container();
  const list = nodes.filter(Boolean), h = Math.max(0, ...list.map(n => n.height));
  let x = 0;
  for (const n of list) { n.x = x; n.y = middle ? Math.round((h - n.height) / 2) : 0; c.addChild(n); x += n.width + gap; }
  return c;
}

/**
 * A grid of equal cells: `cols` across, each cell w x h, gaps apart, filled in reading order.
 * @param {Container[]} cells
 */
export function grid(cells, cols, w, h, gapX = space.betweenRows, gapY = gapX) {
  const c = new Container();
  cells.forEach((n, i) => { n.position.set((i % cols) * (w + gapX), Math.floor(i / cols) * (h + gapY)); c.addChild(n); });
  return c;
}

/** Splits `total` width into n columns `gap` apart; returns each column's x and the column width. */
/** A node's bounds (or a global rectangle's) in `layer`'s space, as {x, y, w, h} (ui-32: the one bounds-to-layer conversion). */
export function boundsIn(node, layer) {
  const b = node.getBounds ? node.getBounds() : node, tl = layer.toLocal({ x: b.x, y: b.y }), br = layer.toLocal({ x: b.x + b.width, y: b.y + b.height });
  return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
}

/** The first live node under `root` labelled `label`, depth first, or null (ui-32). */
export const findLabel = (root, label) => (root.label === label && !root.destroyed ? root : root.children?.map(c => findLabel(c, label)).find(Boolean) ?? null);

export function split(total, n, gap = space.betweenSections) {
  const w = Math.floor((total - gap * (n - 1)) / n);
  return { w, xs: Array.from({ length: n }, (_, i) => i * (w + gap)) };
}
