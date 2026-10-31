// What the map draws over the floor for the player (M10, render-28: moved out of map-view.js): the key holder's key
// (D11), the stairs pointer at the screen's edge (RC29), and aim mode's marks. No chevron over a lever (item 263, Justin
// 2026-10-20: "let's get rid of the arrow over the lever").

import { Container, Graphics, Sprite, Text } from '../../../forge-godot/runtime/pixi.js';
import ui from '../../data/ui.json' with { type: 'json' };
import { objArt } from './art.js';
import { T } from '../data/tiles.js';

/** Installs its part of the map view on k (map-view.js createMapView: the view, its layers and shared state). */
export function createOverlays(k) {
  const { view, clock, inner, root, aim, marks, sprites } = k;
  // D11 (Justin 2026-10-16): readable keys. A key floats over the key holder while it is in sight. Nothing here touches
  // the state.
  const keyMarks = new Map();
  const keyIcon = () => {
    // A dark badge with a gold rim, the key on it, so it reads as a mark and not as a key lying on the floor.
    const tex = objArt('items', 'item-key-iron'), c = new Container(), r = view.tile * 0.2;
    c.addChild(new Graphics().circle(0, -r, r).fill({ color: 0x1a140c, alpha: 0.82 }).stroke({ color: 0xf2c85b, width: Math.max(1.5, view.tile / 28) }));
    if (tex) { const sp = new Sprite(tex); sp.anchor.set(0.5); sp.position.set(0, -r); const k = (r * 1.5) / Math.max(tex.width, tex.height); sp.scale.set(k); c.addChild(sp); }
    return c;
  };
  const updateMarks = now => {
    marks.visible = view.marks !== false;   // view.marks = false hides them (before/after pictures)
    if (!inner.markOf || !marks.visible) return;
    const bob = clock.reduced ? 0 : Math.sin(now / 320) * view.tile * 0.05;
    for (const [id, m] of keyMarks) if (!sprites.has(id)) { m.destroy({ children: true }); keyMarks.delete(id); }
    for (const [id, s] of sprites) {
      const a = inner.markOf.actors?.[id], on = !!a?.key && a.hp > 0 && s.root.visible;
      let m = keyMarks.get(id);
      if (!on) { if (m) m.visible = false; continue; }
      if (!m) { m = keyIcon(); keyMarks.set(id, m); marks.addChild(m); }
      m.visible = true;
      m.position.set(s.root.x, s.root.y - view.tile * 1.02 + bob);
    }
  };

  /**
   * RC29 (1.7 render.js drawStairsPointer): while the nearest found stairs down (or the open exit) is off screen, a pale
   * blue arrow at the screen's edge points to it, bobbing along its line, with a '>' behind it. view.pointerBand
   * {top, bottom} (screen px, set by the HUD) keeps it between the HUD's top block and the hotbar.
   */
  let pointer = null;
  function stairsPointer(now) {
    const g = inner.stairsOf, f = g?.floor, h = g?.hero;
    if (pointer) pointer.visible = false;
    if (!f || !h || h.hp <= 0 || view.marks === false) return;
    let best = null, bd = Infinity;
    for (let i = 0; i < f.tiles.length; i++) {
      const t = f.tiles[i];
      if (!(t === T.STAIRS || (t === T.EXIT && f.exitOpen)) || !g.seen?.[i]) continue;
      const x = i % f.w, y = (i / f.w) | 0, d = Math.abs(x - h.x) + Math.abs(y - h.y);
      if (d < bd) { bd = d; best = { x, y }; }
    }
    if (!best) return;
    const TS = view.tile * view.scale, W = view.screenW, H = view.screenH;
    const sx = root.x + (best.x + 0.5) * TS, sy = root.y + (best.y + 0.5) * TS;
    const top = Math.max(0, view.pointerBand?.top ?? 0), bottom = Math.min(H, view.pointerBand?.bottom ?? H);
    if (sx > TS * 0.3 && sx < W - TS * 0.3 && sy > top + TS * 0.3 && sy < bottom - TS * 0.3) return;
    const cx = W / 2, cy = (top + bottom) / 2, dx = sx - cx, dy = sy - cy, m = TS * 0.6;
    const k = Math.min((W / 2 - m) / Math.max(1e-3, Math.abs(dx)), (Math.max(m, (bottom - top) / 2 - m)) / Math.max(1e-3, Math.abs(dy)));
    const ax = cx + dx * k, ay = cy + dy * k, ang = Math.atan2(dy, dx), bob = clock.reduced ? 0 : Math.sin(now / 300) * 3, z = Math.max(8, TS * 0.28);
    if (!pointer || pointer.TS !== TS) {
      pointer?.destroy({ children: true });
      pointer = new Container(); pointer.eventMode = 'none'; pointer.TS = TS;
      const arrow = new Graphics().poly([z, 0, -z * 0.7, -z * 0.7, -z * 0.35, 0, -z * 0.7, z * 0.7]).fill({ color: 0x9fd8ff }).stroke({ color: 0x000000, alpha: 0.7, width: 2, join: 'round' });
      const glyph = new Text({ text: '>', style: { fontFamily: ui.fonts.mono, fontWeight: '700', fontSize: Math.max(10, TS * 0.26 | 0), fill: 0x9fd8ff, stroke: { color: 0x000000, alpha: 0.8, width: 3, join: 'round' } }, resolution: view.resolution });
      glyph.anchor.set(0.5);
      arrow.alpha = 0.9;
      pointer.addChild(arrow, glyph); pointer.arrow = arrow; pointer.glyph = glyph;
      root.addChild(pointer);
    }
    pointer.visible = true;
    pointer.scale.set(1 / view.scale);
    pointer.position.set((ax - Math.cos(ang) * bob - root.x) / view.scale, (ay - Math.sin(ang) * bob - root.y) / view.scale);
    pointer.arrow.rotation = ang;
    // The '>' two arrow lengths back along the line, not moving with the bob (1.7 drew it from the edge point).
    pointer.glyph.position.set(-Math.cos(ang) * z * 2 + Math.cos(ang) * bob, -Math.sin(ang) * z * 2 + Math.sin(ang) * bob);
  }

  /**
   * Aim mode's target square under the pointer (1.7 targeting-cues.js drawTargetingCues): gold on a tile in range, red
   * out of range, grey on remembered ground; a faint fill and a thin line. rect {x, y, w} in tiles (around a body's
   * whole picture, RB33, else the tile); null clears. path: a bolt's flight in 3 px gold dots at .35 (RB35 previewPath).
   */
  let hoverMark = null;
  const dots = (g, path, alpha) => {
    const T = view.tile, d = Math.max(2, T * 3 / 48);
    for (const c of path) g.rect((c.x + 0.5) * T - d / 2, (c.y + 0.5) * T - d / 2, d, d).fill({ color: 0xe8b44a, alpha });
  };
  view.markHover = (rect, ok, lit, path = []) => {
    if (!hoverMark) { hoverMark = new Graphics(); hoverMark.eventMode = 'none'; root.addChildAt(hoverMark, root.getChildIndex(aim) + 1); }
    hoverMark.clear();
    if (!rect) return;
    const T = view.tile, x = rect.x * T, y = rect.y * T, s = (rect.w ?? 1) * T;
    hoverMark.rect(x + 1, y + 1, s - 2, s - 2).fill({ color: ok ? 0xe8b44a : 0xb8453a, alpha: 0.16 });
    dots(hoverMark, path, 0.35);
    hoverMark.rect(x + 1, y + 1, s - 2, s - 2).stroke({ color: !lit ? 0xd8d0bf : ok ? 0xf0c76f : 0xd66d5e, width: Math.max(1.25, Math.min(2, T * 0.055)), alignment: 0.5 });
  };

  /** 1.7's aim brackets (autoaim.js, rangedslot.js): four thin corners around a body's whole picture, rect in tiles. */
  const brackets = (g, rect, colour) => {
    const T = view.tile, x0 = rect.x * T + 2, y0 = rect.y * T + 2, S = T * rect.w - 4, c = Math.max(3, T * 0.13);
    g.moveTo(x0, y0 + c).lineTo(x0, y0).lineTo(x0 + c, y0)
      .moveTo(x0 + S - c, y0).lineTo(x0 + S, y0).lineTo(x0 + S, y0 + c)
      .moveTo(x0, y0 + S - c).lineTo(x0, y0 + S).lineTo(x0 + c, y0 + S)
      .moveTo(x0 + S - c, y0 + S).lineTo(x0 + S, y0 + S).lineTo(x0 + S, y0 + S - c)
      .stroke({ color: colour, width: Math.max(1.25, T * 1.25 / 48), alpha: 0.85, cap: 'round', join: 'round' });
  };

  /**
   * Aim mode (magic.md D3): the reach wash, 1.7's faint ember on tiles in sight and a paler grey on remembered ground
   * Umbral Passage reaches (RB34, targeting-cues.js); the tiles the spell would strike; the picked foe in gold brackets
   * around its picture (RB33) with a bolt's flight to it in dots (RB35, autoaim.js). mark {x, y, w} in tiles; null clears.
   */
  view.markTarget = (mark, inRange = [], area = [], path = []) => {
    aim.clear();
    if (!mark && !inRange.length) hoverMark?.clear();
    const T = view.tile;
    for (const c of inRange) aim.rect(c.x * T, c.y * T, T, T).fill(c.remembered ? { color: 0xc3bcab, alpha: 0.07 } : { color: 0xe2622b, alpha: 0.10 });
    // Sandbox E3: the tiles the spell would strike, over the range wash. RB36 (1.7 targeting-cues.js:51-61): each filled
    // and outlined by its look: amber in a gold edge; Upheaval's rocks brown; Glacial Tomb's body pale blue in a white
    // edge and its burst blue.
    const w = Math.max(1, T / 48);
    for (const c of area) {
      const [f, fa, s, sa] = AREA_LOOK[c.look] ?? AREA_LOOK.area;
      aim.rect(c.x * T, c.y * T, T, T).fill({ color: f, alpha: fa }).rect(c.x * T + 1, c.y * T + 1, T - 2, T - 2).stroke({ color: s, alpha: sa, width: w, alignment: 0.5 });
    }
    dots(aim, path, 0.45);
    if (mark) brackets(aim, { w: 1, ...mark }, 0xe8b44a);
  };

  /** RB36: an area tile's [fill, alpha, edge, alpha] by look (1.7 targeting-cues.js:57-58). */
  const AREA_LOOK = { area: [0xf0af46, 0.2, 0xffcd6e, 0.8], wall: [0xb18d52, 0.55, 0xffcd6e, 0.8], tomb: [0xa5e1ff, 0.55, 0xe1faff, 0.95], ice: [0x73c3f5, 0.2, 0x96dcff, 0.8] };

  /** EQ12 (1.7 rangedslot.js drawBowAimOverlay): the bow slot's target in pale blue brackets; null clears. */
  let bowMark = null;
  view.markBow = rect => {
    if (!bowMark) { bowMark = new Graphics(); bowMark.eventMode = 'none'; root.addChildAt(bowMark, root.getChildIndex(aim) + 1); }
    bowMark.clear();
    if (rect) brackets(bowMark, rect, 0x9fd8ff);
  };
  return { keyMarks, updateMarks, stairsPointer };
}
