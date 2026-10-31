// The in-play menu, as 1.7 has it: a small framed panel beside the Menu button (L) or centred (P), where you are
// on top, then the windows as 1.7's icon and word rows with its Sound row after Options; two abreast on a sideways phone.
// A tap outside closes it.

import { Container, Graphics, Ticker } from '../../../../forge-godot/runtime/pixi.js';
import { color, space } from '../core/widgets.js';
import { plate, plateInset } from '../core/plates.js';
import { depthLine } from '../model/hud-model.js';

const ITEMS = [['Character', 'Character'], ['Inventory', 'Inventory'], ['Faith', 'Faith'], ['Options', 'Options'], ['Sound', 'Sound'], ['Log', 'Combat log'], ['Journal', 'Journal'], ['Save', 'Save / Exit']];

/** CH-11: 1.7's line icons for the menu rows (responsive-hud.js:20-22, 408-417; a 24 box at stroke 1.6, drawn 20 px). */
const ICONS = {
  // One element per stroke: Pixi's SVG reader drops some subpaths of a many-part path.
  Character: '<circle cx="12" cy="7" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/>',
  Inventory: '<path d="M8 6V4h8v2"/><path d="M6 7a3 3 0 0 1 3-2h6a3 3 0 0 1 3 2l2 12H4z"/><path d="M8 13h8v5H8z"/>',
  Faith: '<path d="M12 3l3 6 6 3-6 3-3 6-3-6-6-3 6-3z"/>',
  Options: '<path d="M4 6h3"/><path d="M11 6h9"/><path d="M4 12h9"/><path d="M17 12h3"/><path d="M4 18h3"/><path d="M11 18h9"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>',
  Log: '<path d="M5 5h14v14H5z"/><path d="M8 9h8"/><path d="M8 12h8"/><path d="M8 15h5"/>',
  Journal: '<path d="M12 5v15"/><path d="M3 4h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v15h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3z"/>',
  Save: '<path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h9"/>',
};
const ICON_PX = 20;

/** One of 1.7's menu line icons, px square, stroked in `fill`. */
function lineIcon(name, px, fill) {
  const body = ICONS[name];
  if (!body) return null;
  const hex = '#' + fill.toString(16).padStart(6, '0');
  const g = new Graphics().svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body.replace(/<(path|circle)/g, `<$1 fill="none" stroke="${hex}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"`)}</svg>`);
  g.scale.set(px / 24);
  return g;
}

/** 1.7's speaker (responsive-hud.js audioSymbol, a 24 box at stroke 1.6): the cone, then two waves, or a cross when off. */
function speaker(px, on, fill) {
  const k = px / 24, g = new Graphics();
  g.poly([4, 9, 8, 9, 13, 5, 13, 19, 8, 15, 4, 15].map(n => n * k)).stroke({ color: fill, width: 1.6 * k, join: 'round' });
  if (on) {
    g.moveTo(16 * k, 8 * k).bezierCurveTo(18 * k, 10 * k, 18 * k, 14 * k, 16 * k, 16 * k);
    g.moveTo(19 * k, 5 * k).bezierCurveTo(23 * k, 9 * k, 23 * k, 15 * k, 19 * k, 19 * k);
  } else g.moveTo(16 * k, 9 * k).lineTo(22 * k, 15 * k).moveTo(22 * k, 9 * k).lineTo(16 * k, 15 * k);
  g.stroke({ color: fill, width: 1.6 * k, cap: 'round' });
  return g;
}

/** 1.7's unspent-points badge (.study-points, responsive-hud.css:14-16), in the default theme's colours (:344, H30): a
 * small #343733 box with a #70766a edge, its number in #eee9ce, breathing 0.78 to 1 with a faint gold glow every 3.8 s;
 * steady under reduced motion. */
function pointsBadge(kit, n, reduced) {
  const c = new Container();
  const t = kit.text(String(n), { size: 12, font: 'mono', weight: '700', fill: 0xeee9ce });
  const w = Math.max(18, t.width + 6), h = 18;
  const glow = new Graphics().roundRect(-2, -2, w + 4, h + 4, 5).fill({ color: 0xd4a44c, alpha: 0.16 });
  const box = new Graphics().roundRect(0, 0, w, h, 4).fill(0x343733).stroke({ color: 0x70766a, width: 1 });
  t.position.set(Math.round((w - t.width) / 2), Math.round((h - t.height) / 2));
  c.addChild(glow, box, t);
  c.label = 'menu-points';
  if (reduced) return c;
  let ms = 0;
  const tick = tk => { ms = (ms + tk.deltaMS) % 3800; const s = (1 - Math.cos(ms / 3800 * Math.PI * 2)) / 2; c.alpha = 0.78 + 0.22 * s; glow.alpha = s; };
  tick({ deltaMS: 0 });
  Ticker.shared.add(tick);
  c.on('destroyed', () => Ticker.shared.remove(tick));
  return c;
}

/** @param {{open:(w:string)=>void, close:()=>void, options?:{get:(k:string)=>any, set:(k:string, v:any)=>void}, redraw?:()=>void}} acts @param {any} game */
export function buildMenu(kit, acts, game) {
  const st = kit.stage, P = st.kind === 'P', root = new Container();
  const shade = new Graphics().rect(0, 0, st.w, st.h).fill({ color: color.bg, alpha: P ? 0.6 : 0.25 });
  shade.eventMode = 'static';
  shade.on('pointertap', e => { e.stopPropagation(); acts.close(); });
  root.addChild(shade);
  const border = 18, inset = plateInset('plain', border) + space.betweenRows;
  const ids = (typeof __FORGE_PUBLIC__ === 'undefined' || !__FORGE_PUBLIC__) && game?.sandbox ? [['Sandbox', 'Sandbox'], ...ITEMS] : ITEMS;
  // CSS-33 (painted-ui.css:122-123): the icon rests dim and lights with its word under the pointer or focus. Drawn
  // white, tinted.
  const litIcon = (b, icon) => {
    const focus = b.setFocus;
    icon.tint = color.rest;
    b.setFocus = on => { focus(on); icon.tint = on ? kit.accent : color.rest; };
  };
  // One row: 1.7's icon in a 20 px slot, then the word; Sound has its On or Off at the right.
  const rowOf = (id, words, rowW) => {
    if (id === 'Sound') {
      const on = acts.options?.get?.('sound') ?? true;
      const b = kit.button('Sound', () => { acts.options?.set?.('sound', !on); acts.redraw?.(); }, { size: 20, left: true, w: rowW });
      const word = b.children[1], icon = speaker(ICON_PX, on, 0xffffff);
      icon.position.set(space.betweenRows, Math.round((b.height - ICON_PX) / 2));
      litIcon(b, icon);
      word.x += ICON_PX + space.betweenRows;
      const state = kit.text(on ? 'On' : 'Off', { size: 14, font: 'mono', fill: color.ash });
      state.position.set(rowW - state.width - space.betweenRows, Math.round((b.height - state.height) / 2));
      b.addChild(icon, state);
      b.label = 'Sound';
      return b;
    }
    const b = kit.button(words, () => acts.open(id), { size: 20, left: true, w: rowW });
    b.label = id;
    const word = b.children[1], icon = lineIcon(id, ICON_PX, 0xffffff);
    if (icon) {
      icon.position.set(space.betweenRows, Math.round((b.height - ICON_PX) / 2));
      litIcon(b, icon);
      word.x += ICON_PX + space.betweenRows;
      b.addChild(icon);
    }
    const points = id === 'Character' ? game?.hero?.points ?? 0 : 0;
    if (points > 0) {
      const badge = pointsBadge(kit, points, kit.reduced);
      badge.position.set(Math.round(word.x + word.width + space.betweenRows), Math.round((b.height - 18) / 2));
      b.addChild(badge);
    }
    return b;
  };
  // Lays the rows out in `cols` columns across a panel `w` wide; returns the list and its height.
  const layout = (w, cols) => {
    const list = new Container(), gap = space.inRow, rowW = Math.floor((w - inset * 2 - gap * (cols - 1)) / cols);
    let top = 0;
    if (game) {
      // CH-13 (1.7 ui.js:392): the plane's own name while on one (Cinder Reach, Skyvault), as the HUD's depth line has it.
      const where = kit.text(depthLine(game).split(' · Floor')[0], { size: 20, font: 'display', fill: color.ink });
      const floor = kit.text(`Floor ${game.floorNo}   Turn ${game.actions ?? 0}`, { size: 14, fill: color.ash });
      floor.y = where.height; where.x = floor.x = space.betweenRows;
      list.addChild(where, floor);
      top = where.height + floor.height + space.betweenRows;
    }
    const rows = ids.map(([id, words]) => rowOf(id, words, rowW));
    const step = (rows[0]?.height ?? 0) + (P || cols > 1 ? 0 : 2), per = Math.ceil(rows.length / cols);
    // Read across, two abreast (1.7's grid), so the order runs as the one-column list does.
    rows.forEach((b, i) => { b.position.set((i % cols) * (rowW + gap), top + Math.floor(i / cols) * step); list.addChild(b); });
    return { list, h: top + (cols > 1 ? per : rows.length) * step + inset * 2 };
  };
  // 1.7 at 1280x800: 225 wide, its top at y 90, 1.7's right edge 30 in from the screen's.
  const rowNeed = Math.max(...ids.map(([, words]) => { const t = kit.text(words, { size: 20, font: 'display' }), width = t.width; t.destroy(); return width; })) + ICON_PX + space.betweenRows * 4;
  let w = Math.min(st.w - 16, Math.max(P ? 280 : 225, rowNeed + inset * 2)), { list, h } = layout(w, 1);
  // CH-41 (1.7 responsive-hud.css:1204-1207): a sideways phone is too short for the rows stacked, so they sit two
  // abreast in a wider panel at their full height, and Journal and Save stay on screen.
  if (!P && h > st.h - 16) {
    list.destroy({ children: true });
    w = Math.min(Math.max(360, rowNeed * 2 + inset * 2 + space.inRow), st.w - 16);
    ({ list, h } = layout(w, 2));
  }
  const frame = plate('plain', w, h, border);
  frame.eventMode = 'static';
  frame.on('pointertap', e => e.stopPropagation());
  const box = new Container();
  list.position.set(inset - space.betweenRows, inset);
  box.addChild(frame, list);
  // Tied to the Menu button at the top right on every screen (Justin 10-16).
  box.position.set(st.w - w - (P ? 8 : 30), P ? 56 : Math.max(8, Math.min(90, st.h - h - 8)));
  root.addChild(box);
  return root;
}
