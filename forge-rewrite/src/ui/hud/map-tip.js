// 1.7's map card (#tip: index.html, mobile.js, touchui.js @3c8b312), drawn on the canvas from a map-hover.js card.
// Laptop: beside the pointer (+14 px), kept 8 px inside the screen, at most 270 px wide. Touch: a long press shows it;
// held upright it spans the screen (340 px) between the HUD and the hotbar, on the half away from the finger; held wide
// it sits in the bottom left corner. Words 2 px larger on touch (--ui-mobile-text-add).

import { Container, Graphics } from '../../../../forge-godot/runtime/pixi.js';
import { color } from '../core/widgets.js';
import { words } from '../core/look.js';
import { tone } from '../core/colour.js';
import { statusIcon } from '../core/icons.js';
import { cardFrame } from '../core/cards.js';
import { mapInspect } from './map-cards.js';

const BAD = tone('bad');

/** @param {ReturnType<import('../core/widgets.js').createKit>} kit */
export function buildMapTip(kit) {
  const root = new Container();
  root.label = 'map-tip';
  root.eventMode = 'none';
  root.visible = false;
  let shown = null;

  /**
   * The card's body at width w (inner), from top to bottom like 1.7's HTML. Item 170 (Justin 2026-10-18: "it should use
   * the UI's color theme (i am playing water fae)"): the windows' card roles (core/cards.js cardBody) at 1.7's #tip sizes.
   * The name is in the display face in the hero's highlight (kit.accent: blue for the Tide Court) unless it has its own
   * colour, the copy in the body face, the numbers in mono; the frame's edge and the odds' numbers in the highlight too.
   */
  function body(card, w, touch) {
    const add = touch ? 2 : 0, px = {
      body: 14 + add, nm: (touch ? 18 : 16) + add, row: (touch ? 14.5 : 13) + add, odds: (touch ? 15 : 13) + add, stat: 13 + add };
    const c = new Container();
    let y = 0;
    const put = (n, gap = 0) => { n.y = y + gap; c.addChild(n); y = n.y + n.height; return n; };
    const copy = (s, size, fill, o = {}) => words(kit, s, size, { font: 'body', fill, shadow: false, ...o });
    put(words(kit, card.title, px.nm, { font: 'display', fill: card.colour ?? kit.accent, weight: '700', wrap: w, lineHeight: Math.round(px.nm * 1.25), shadow: false }));
    if (card.lore) put(copy(card.lore, px.body, color.ink, { wrap: w, lineHeight: Math.round(px.body * 1.4) }), 0);
    const row = ([k, v], gap = 0) => {
      const a = copy(k, px.row, color.ash, { lineHeight: Math.round(px.row * 1.4) });
      const b = words(kit, String(v), px.row, { font: 'mono', fill: color.ink, lineHeight: Math.round(px.row * 1.4), shadow: false });
      const r = new Container(); b.x = w >= 4096 ? a.width + 16 : w - b.width; r.addChild(a, b);   // the width probe measures the pair, not 4096
      put(r, gap);
    };
    for (const r of card.rows ?? []) row(r);
    for (const st of card.statuses ?? []) {   // 1.7 .tipstat: an 18 px icon, the name (red when harmful), the turns in grey
      const r = new Container(), pic = statusIcon(st.icon, 18);
      const name = copy(st.name, px.stat, st.bad ? BAD : color.ink, { weight: '600' });
      const turns = st.turns > 0 ? copy(`${st.turns} turn${st.turns === 1 ? '' : 's'}`, px.stat, color.dim) : null;
      let x = 0;
      if (pic) { pic.y += Math.max(0, (name.height - 18) / 2); r.addChild(pic); x = 24; }
      name.x = x; r.addChild(name); x += name.width + 6;
      if (turns) { turns.x = x; r.addChild(turns); }
      put(r, 4);
    }
    for (const h of card.hints ?? []) put(copy(h, px.body, color.ink, { wrap: w, lineHeight: Math.round(px.body * 1.4) }), 4);
    card.tail?.forEach((r, i) => row(r, i ? 0 : 4));   // rows after the hints (a tile's In sight or From memory, 1.7 inspectTileHTML)
    if (card.odds) {
      const o = card.odds, t = copy(`You hit <em>${o.hit}%</em> for ${o.lo}-${o.hi}. It hits you <em>${o.back}%</em>.`, px.odds, color.ink, { wrap: w, lineHeight: Math.round(px.odds * 1.4) });
      t.style.tagStyles = { em: { fill: kit.accent, fontWeight: '600' } };
      put(t, 4);
    }
    return c;
  }

  return {
    root,
    get shown() { return shown; },
    /**
     * @param {object|null} card from map-hover.js mapInspect
     * @param {{x:number,y:number}} at the pointer (or finger), in the HUD's logical px
     * @param {{touch:boolean, upright:boolean, w:number, h:number, top?:number, bottom?:number}} place the screen and, held upright on touch, the free band
     */
    /** The card for map tile (x, y), or null (map-cards.js mapInspect; the HUD reads it through the tip, H6). */
    cardAt: (s, x, y, o) => mapInspect(s, x, y, o),
    show(card, at, place) {
      root.removeChildren().forEach(c => c.destroy({ children: true }));
      root.removeAllListeners();
      shown = card;
      root.visible = !!card;
      if (!card) return;
      const touch = place.touch, padX = touch ? 12 : 9, padY = touch ? 10 : 7, gap = 8;
      const maxW = touch && place.upright ? Math.min(340, place.w - gap * 2) : Math.min(270, place.w - 16);
      // Laptop: as wide as its words need, up to 270 (1.7 max-width); touch held upright: always the band's width.
      let inner = maxW - padX * 2;
      if (!(touch && place.upright)) {
        const probe = body(card, 4096, touch);
        inner = Math.min(inner, Math.ceil(probe.width));
        probe.destroy({ children: true });
      }
      const b = body(card, inner, touch), w = inner + padX * 2, full = Math.ceil(b.height) + padY * 2;
      // Held upright, a card taller than the band between the HUD and the hotbar keeps to the band and scrolls under a
      // finger, as 1.7's (touchui.js placeMapTip: max-height the band, overflow-y auto), so Search and the log stay clear.
      const band = touch && place.upright ? (place.bottom ?? place.h - gap) - (place.top ?? gap) : Infinity, h = Math.min(full, Math.max(60, band));
      root.addChild(cardFrame(w, h, { radius: 5, alpha: 0.97, edge: kit.accent }));   // the card frame (ui-30; 1.7 box-shadow 0 6px 20px), edged in the highlight (item 170)
      b.position.set(padX, padY);
      root.addChild(b);
      root.eventMode = 'none';
      if (full > h) {
        const clip = new Graphics().rect(0, 1, w, h - 2).fill(0xffffff);
        root.addChild(clip); b.mask = clip;
        let from = null;
        const most = full - h;
        root.eventMode = 'static';
        root.hitArea = { contains: (x, y) => x >= 0 && y >= 0 && x <= w && y <= h };
        root.on('pointerdown', e => { from = { y: e.global.y, top: padY - b.y }; });
        root.on('globalpointermove', e => { if (from) b.y = padY - Math.max(0, Math.min(most, from.top + (from.y - e.global.y) / root.worldTransform.d)); });
        root.on('pointerup', () => { from = null; }); root.on('pointerupoutside', () => { from = null; });
      }
      let x, y;
      if (!touch) {
        x = Math.max(6, Math.min(at.x + 14, place.w - w - 8));
        y = Math.max(6, Math.min(at.y + 14, place.h - h - 8));
      } else if (place.upright) {
        const top = place.top ?? gap, bottom = place.bottom ?? place.h - gap;
        x = Math.round((place.w - w) / 2);
        y = at.y < (top + bottom) / 2 ? bottom - h : top;
        y = Math.max(top, y);
      } else { x = 8; y = place.h - h - 8; }
      root.position.set(Math.round(x), Math.round(y));
    },
    hide() { root.removeChildren().forEach(c => c.destroy({ children: true })); root.removeAllListeners(); root.eventMode = 'none'; root.visible = false; shown = null; },
  };
}
