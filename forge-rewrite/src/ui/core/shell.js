// The window shell, the same everywhere (window rule 7), at 1.7's measured geometry (review-1.7/rewrite-baseline/
// windows, 1280x800 and 390x844): the plain plate frame clear of the hotbar, 1.7's steel tabs tucked behind the
// frame's top edge, the drawn close X inside the top-right corner, contents at 1.7's insets, and on touch the
// fixed info line at the bottom. Small windows (Save, Load, About) are centred at the size they ask for.
// Closes by X, Esc, the backdrop or the window's own key (the flow handles the keys).

import { Container, Graphics, Rectangle } from '../../../../forge-godot/runtime/pixi.js';
import { color, space, brighten } from './widgets.js';
import { plate, plateInset, closePlate, tabPlate, sixGemFrame, sixGemInset, sixGemInnerEdges } from './plates.js';
import { createInfoLine } from './cards.js';

/** 1.7's sheet in logical px: sides, top (below the tabs), room left for the hotbar, the cap on a wide PC. */
const GEO = {
  L: { side: 45, top: 55, bottom: 110, maxW: 1190, border: 26, tabH: 37, tabSize: 20, tabX: 25, closeSize: 32, closeIn: 23, padX: 42, padTop: 60 },
  P: { side: 10, top: 52, bottom: 144, maxW: 720, border: 16, tabH: 35, tabSize: 14, tabX: 8, closeSize: 32, closeIn: 12, padX: 22, padTop: 42 },
};

/**
 * @param {ReturnType<import('./widgets.js').createKit>} kit
 * @param {{tabs?:string[], tab?:string, onTab?:(t:string)=>void, onClose:()=>void, w?:number, h?:number, title?:string, six?:boolean, fit?:boolean, bottom?:number, right?:number}} o
 *   six: 1.7's six-gem forge frame (Forge, core, end screen family); fit: keep the asked size on phones too (popups).
 * @returns {{root:Container, content:Container, area:{w:number,h:number}, info:ReturnType<typeof createInfoLine>|null}}
 */
export function buildShell(kit, o) {
  const stage = kit.stage, P = stage.kind === 'P';
  // A phone held sideways has no height to spare: the window runs from just under its tabs to the screen's foot
  // (Justin 10-16: "bring the top of it to the top of the screen").
  const short = stage.short;
  const base = short ? { ...GEO.L, top: GEO.L.tabH + 2, padTop: 40, padX: 30 } : GEO[stage.kind];
  // Phones (upright or sideways): the window covers the hotbar unless it is one you drag to the hotbar from, which
  // stops above it (o.bottom); untabbed windows start at the top (Justin 10-16).
  const G = P || short ? { ...base, bottom: o.bottom ?? 4, top: o.tabs?.length ? base.top : 8 } : base;
  const root = new Container();
  // o.right: room kept clear at the right edge (a sideways phone's hotbar column beside a window you drag to it from).
  const across = stage.w - (o.right ?? 0);
  let w, h, x, y;
  if (o.w) {
    w = P && !o.fit ? across - G.side * 2 : Math.min(o.w, across - G.side * 2); h = Math.min(o.h ?? 480, stage.h - G.top - G.bottom);
    x = Math.round((across - w) / 2); y = Math.round(G.top + (stage.h - G.top - G.bottom - h) / 2);
    if (o.tabs?.length) y = Math.max(y, G.top);
  } else {
    w = Math.min(G.maxW, across - G.side * 2); h = stage.h - G.top - G.bottom;
    x = Math.round((across - w) / 2); y = G.top;
  }

  const backdrop = new Graphics().rect(0, 0, stage.w, stage.h).fill({ color: color.bg, alpha: 0.55 });
  backdrop.eventMode = 'static';
  backdrop.on('pointertap', e => {
    e.stopPropagation();
    const p = root.toLocal(e.global);
    if (p.x < x || p.x > x + w || p.y < y || p.y > y + h) o.onClose();
  });
  root.addChild(backdrop);

  // Tabs sit on the frame's top edge, drawn before it so the frame overlaps their foot.
  if (o.tabs?.length) {
    let tx = x + G.tabX;
    const gap = P ? 2 : space.inRow, room = w - G.tabX * 2;
    const words = o.tabs.map(t => kit.text(t, { size: G.tabSize, font: 'display', weight: '700', fill: t === o.tab ? kit.accent : color.ink, shadow: 'lift' }));
    const natural = words.reduce((a, t) => a + t.width + 28, 0);
    const squeeze = natural + gap * (words.length - 1) > room ? (room - gap * (words.length - 1)) / natural : 1;
    o.tabs.forEach((t, i) => {
      const label = words[i], on = t === o.tab, tw = Math.round((label.width + 28) * squeeze);
      const tab = new Container();
      const art = tabPlate(tw, G.tabH + 6);
      // CSS-26 (painted-ui.css:680-682): an unopened tab is darkened, not see-through: .62 at rest, .85 under the
      // pointer; the open one 1.1. CSS-25: the hover brightens the steel, the word keeps its colour.
      const shade = lit => brighten(art, on ? 1.1 : lit ? 0.85 : 0.62);
      shade(false);
      label.anchor.set(0.5); label.position.set(tw / 2, G.tabH / 2 + 1);
      if (squeeze < 1) label.scale.set(Math.min(1, (tw - 14) / label.width));
      tab.addChild(art, label);
      tab.position.set(tx, y - G.tabH + (on ? 0 : 3));
      tab.label = t; tab.isTab = true;
      tab.setFocus = shade;
      tab.on('pointerover', e => { if (e.pointerType === 'mouse') shade(true); });
      tab.on('pointerout', () => shade(false));
      kit.control(tab, () => o.onTab?.(t), { group: 'tabs' });
      if (stage.touch) tab.hitArea = new Rectangle(0, Math.max(-tab.y, (G.tabH - kit.target) / 2), tw, kit.target);
      root.addChild(tab);
      tx += tw + gap;
    });
  }

  const fw = P ? 36 : 48;
  const padX = o.six ? (P ? sixGemInset(fw) + space.betweenSections : 55) : G.padX;
  const frame = o.six ? sixGemFrame(w, h, fw) : plate('plain', w, h, G.border);
  frame.position.set(x, y);
  frame.label = 'window-frame';
  frame.eventMode = 'none';
  frame.on('pointertap', e => e.stopPropagation());
  root.addChild(frame);

  const close = new Container();
  close.addChild(closePlate(G.closeSize));
  close.label = 'X';
  kit.control(close, o.onClose);
  if (G.closeSize < kit.target) close.hitArea = new Rectangle((G.closeSize - kit.target) / 2, (G.closeSize - kit.target) / 2, kit.target, kit.target);
  // CSS-25 (painted-ui.css:679): the X brightens 1.25 under the pointer or focus, at full strength otherwise.
  const xArt = close.children[0];
  close.setFocus = on => brighten(xArt, on ? 1.25 : 1);
  close.on('pointerover', e => { if (e.pointerType === 'mouse') close.setFocus(true); });
  close.on('pointerout', () => close.setFocus(false));
  const closeGap = G.closeIn - plateInset('plain', G.border), innerEdge = sixGemInnerEdges(fw);
  const closeX = o.six ? innerEdge.side + closeGap : G.closeIn, closeY = o.six ? innerEdge.top + closeGap : G.closeIn;
  close.position.set(x + w - closeX - G.closeSize, y + closeY);
  root.addChild(close);

  const left = x + padX, innerW = w - padX * 2;
  let top = y + (o.six ? padX : G.padTop);
  if (!o.tabs?.length && o.title) {
    const t = kit.text(o.title, { size: o.six ? 26 : 20, font: 'display', fill: o.six ? kit.accent : color.ink, shadow: 'lift' });
    const room = innerW - G.closeSize - space.betweenRows;
    if (t.width > room) t.scale.set(room / t.width);
    t.position.set(left, o.six ? y + padX - 6 : y + G.closeIn + Math.round((G.closeSize - t.height) / 2));
    root.addChild(t);
    top = Math.max(top, t.y + t.height + space.betweenSections);
  }

  const info = stage.touch ? createInfoLine(kit, innerW) : null;
  const bottom = y + h - Math.round(padX * 0.75);
  const content = new Container();
  content.position.set(left, top);
  root.addChild(content);
  // Above the content, so a long entry can rise over it.
  if (info) { info.root.position.set(left, bottom - info.height); root.addChild(info.root); }
  const area = { w: innerW, h: (info ? bottom - info.height - space.betweenRows : bottom) - top };
  return { root, content, area, info };
}
