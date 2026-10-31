// The HUD's look in one place: 1.7's measured sizes and colours (its page at 1280x800 and 390x844, 2026-10-16),
// its four journal symbols and the search lens, and the drawing helpers every HUD piece uses. Justin, 10-16:
// the HUD goes back to 1.7's look.

import { Container, Graphics, FillGradient } from '../../../../forge-godot/runtime/pixi.js';

const rgb = (r, g, b) => (r << 16) | (g << 8) | b;

/** 1.7's colours. */
export const tone = {
  gold: rgb(232, 180, 74), bronze: rgb(160, 122, 70), ink: rgb(239, 236, 250), badgeInk: rgb(230, 221, 206),
  barLabel: rgb(241, 233, 223), barNumber: rgb(255, 241, 220), track: rgb(23, 22, 23),
  hpTop: rgb(163, 71, 54), hpBottom: rgb(120, 49, 37), manaTop: rgb(80, 119, 136), manaBottom: rgb(52, 85, 100),
  xp: rgb(232, 180, 74), shieldA: rgb(150, 215, 255), shieldB: rgb(90, 160, 220),
  full: rgb(148, 187, 117), fullFill: rgb(104, 123, 62), hungry: rgb(184, 122, 50), starving: rgb(184, 80, 61),
  // 1.7's hunger words (responsive-hud.css:954-956) are lighter than their meter fills.
  hungryInk: rgb(218, 184, 106), starvingInk: rgb(238, 157, 135),
  // 1.7's portrait frame (responsive-hud.css:911-914): #101012 disc, #756443 ring; the badge #15120de8, LV #e6ddce.
  frame: rgb(16, 16, 18), frameRing: rgb(117, 100, 67), badge: rgb(21, 18, 13),
  // The stat-points tab (responsive-hud.css:958-962): #292114ef face, #9c7841 edge.
  pointsFace: rgb(41, 33, 20), pointsEdge: rgb(156, 120, 65), progressTrack: rgb(23, 22, 23),
  stock: rgb(213, 216, 214), glass: rgb(11, 16, 27), edge: rgb(80, 87, 118), slotEdge: rgb(56, 67, 74), slotGlow: rgb(159, 176, 192),
  key: rgb(203, 187, 161), log: rgb(206, 208, 220),
};

/** 1.7's geometry per stage, in logical px (one CSS px at the reference sizes). */
export const geo = {
  L: {
    pad: 16, depth: 24, portrait: 115, portraitY: 48.6, level: 14.66, barX: 104.3, barY: 62.4, barW: 251, hpH: 29.4, manaH: 26.7, xpH: 4,
    barText: 13.33, hunger: 15.66, stock: 12, button: 58.6, buttonStep: 69.3, slot: 69.3, slotH: 69.3, slotGap: 5.3, keyText: 9, icon: 0.885,
    log: 18.66, logLine: 23.9, logW: 298.5,
    // status boxes (statusicons.js: 34 px, icon 26, turns 11, gap 2) at 1.7's interface scale here (1.333); 48 on a large touch screen
    status: 45.33, statusIcon: 34.66, statusNum: 14.66, statusGap: 2.66, statusTouch: 64, statusTouchGap: 4,
  },
  P: {
    pad: 8, depth: 18.3, portrait: 80, portraitY: 34.1, level: 12, barX: 69.9, barY: 43.7, barW: 169.7, hpH: 20.5, manaH: 18.5, xpH: 6,
    barText: 12.5, hunger: 14, stock: 14, button: 55, buttonStep: 59, slot: 90.5, slotH: 56.2, slotGap: 4, keyText: 9, icon: 0.86,
    log: 16, logLine: 20.5, logW: 256,
    // status boxes: 36 px upright on a phone, at its interface scale (390 / 430)
    status: 32.65, statusIcon: 23.58, statusNum: 11.8, statusGap: 1.81,
  },
};

/** Words at 1.7's exact size: made by the kit (for its resolution), then sized in px with 1.7's shadow. */
export function words(kit, text, px, o = {}) {
  const t = kit.text(text, { font: o.font ?? 'mono', fill: o.fill ?? tone.ink, weight: o.weight, wrap: o.wrap, align: o.align });
  px = Math.round(px * (kit.textScale ?? 1));   // Options Text size, as 1.7's readouts (responsive-hud.css:36)
  t.style.fontSize = px;
  t.style.lineHeight = o.lineHeight ?? Math.round(px * 1.15);
  if (o.shadow !== false) t.style.dropShadow = { color: 0x000000, alpha: 1, blur: o.blur ?? 2, distance: 1, angle: Math.PI / 2 };
  return t;
}

/** A vertical two-stop gradient, as 1.7's bar fills. */
export function gradient(top, bottom) {
  return new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: top }, { offset: 1, color: bottom }], textureSpace: 'local' });
}

// 1.7's journal symbols (css/icons/journal/*.svg, 32 x 32) and its search lens (24 x 24): [path, stroke width, filled].
const SYMBOLS = {
  journal: [32, [['M16 8.1C12.9 5.8 9.2 5 5.2 5.6v18c4.1-.6 7.7.3 10.8 2.8 3.1-2.5 6.7-3.4 10.8-2.8v-18C22.8 5 19.1 5.8 16 8.1Z', 1.5],
    ['M16 8.3v17.6M7.8 9.4c1.7-.1 3.5.3 5.4 1.3M7.8 13c1.7-.1 3.5.3 5.4 1.3M7.8 16.6c1.5 0 3 .3 4.3.9M19 17.9c1.7-.9 3.3-1.3 5.3-1.4M19 21.1c1.7-.9 3.3-1.3 5.3-1.4', 1.2],
    ['m20.3 7.2.1 7.1 1.9-1.7 1.7.7V6.1', 1.2]]],
  map: [32, [['m4.8 7.2 7.7-2.6 7 2.8 7.7-2.1v19.5l-7.7 2.6-7-2.8-7.7 2.1Z', 1.5], ['M12.5 4.9v5.5m0 4.5v9.3M19.5 7.8v9.1m0 4.6V27', 1.2],
    ['m7.8 19.7 2.1-2.5m1.8-1.5 3.1-1.9m2.3.2 2 1.6m2.1.4 2.6-2.8', 1.2], ['m21.8 9.2 3.3 3.3m0-3.3-3.3 3.3', 1.5], ['m7.7 21.2 1 1-1 1-1-1Z', 0, true]]],
  satchel: [32, [['M9.2 11.3C8.6 7.4 10.7 4.6 14 4.6c3.5 0 6 2.2 6.6 5.6', 1.5], ['M7.8 11.8 6.1 24.2c-.2 1.3.6 2 2 2l15.9-1.1c1.4-.1 2.1-.9 1.8-2.2l-2.3-13.2Z', 1.5],
    ['m7.8 11.8-.6 4.8 8.8 3.1 8.4-4.3-.9-5.7Z', 1.5], ['m16.3 16.8 3-.2.4 5.6-3 .2Z', 1.2], ['m17.1 19.3 1.7-.1M9 22.3l1.2-.1m1.9-.1 1.2-.1m8.6-.6 1.2-.1', 1.2]]],
  compass: [32, [['M11.3 7a10.1 10.1 0 0 0-4.4 4.8M6.2 20a10.1 10.1 0 0 0 5.4 5.3m8.8 0a10.1 10.1 0 0 0 5.4-5.3m-.7-8.2A10.1 10.1 0 0 0 20.7 7', 1.2],
    ['m16 4.4 2.7 8.9 8.9 2.7-8.9 2.7-2.7 8.9-2.7-8.9L4.4 16l8.9-2.7Z', 1.5], ['M16 4.9V16l-2.7-2.7m14 2.7H16l2.7 2.7M16 27.1V16l-2.7 2.7', 1.2], ['m15.9 15.5.8.5-.8.5-.5-.5Z', 0, true]]],
  search: [24, [['M16 10.5A5.5 5.5 0 1 1 5 10.5A5.5 5.5 0 1 1 16 10.5Z', 1.6], ['m15 15 4 4', 1.6]]],
  pickup: [24, [['M18.5 2.5Q20 2 20.5 3L22 7Q22.5 8 21.5 9L17 13.5Q15.5 14.5 14.5 13Q14 12.5 15 11L16.5 8.8Q17.5 7 16 6.8Q13.5 6.5 12.5 9L11 12.5Q10 14 9 13Q8.5 12.5 9 11L10.2 8.7Q8.7 10.2 8 12.8Q7.5 14.5 6 14Q5 13.8 5.4 12L6.8 8.8Q4.4 11.5 4 15.5Q3.8 17 2.4 16.6Q1.5 16.4 1.7 15Q2.2 8 8 4.5Q12 2.7 18.5 2.5Z', 1.6], ['m12 17 3 3-3 3-3-3z', 0, true]]],
  cancel: [24, [['m6 6 12 12M18 6 6 18', 1.6]]],
  arrow: [24, [['m7 14 5-5 5 5', 2.7]]],
  lens: [24, [['M16 10.5A5.5 5.5 0 1 1 5 10.5A5.5 5.5 0 1 1 16 10.5Z', 2], ['m15 15 4 4', 2]]],
  // Explore's other two faces (1.7 travel.js syncExploreButton): Stop while it runs, the stairs once the floor is done.
  stop: [24, [['M8 7h8q1 0 1 1v8q0 1-1 1H8q-1 0-1-1V8q0-1 1-1Z', 1.6]]],
  stairs: [24, [['M4 18h5v-5h5V8h6M18 3v7m-3-3 3 3 3-3', 1.6]]],
};

/** 1.7's movement pad (#dpad, 100 x 100): the north key and the north-west corner key; the others are these turned. */
export const PAD = {
  north: 'M 38.686 2.324 A 49 49 0 0 1 61.314 2.324 Q 67.560 4.255 65.215 10.362 L 59.870 24.287 Q 57.526 30.395 51.154 29.032 A 21 21 0 0 0 48.846 29.032 Q 42.474 30.395 40.130 24.287 L 34.785 10.362 Q 32.440 4.255 38.686 2.324 Z',
  northWest: 'M 12.971 22.708 A 46 46 0 0 1 22.708 12.971 Q 27.699 9.767 30.576 14.958 L 35.003 22.944 Q 37.880 28.135 33.078 31.598 A 25 25 0 0 0 31.598 33.078 Q 28.135 37.880 22.944 35.003 L 14.958 30.576 Q 9.767 27.699 12.971 22.708 Z',
  // Fills and edges: keys #11171d24 / #eee4ce9c, corners #11171d0d / #e8e3d21f, pressed #322b2159 / #f3c776.
  key: { fill: [0x11171d, 0.14], edge: [0xeee4ce, 0.61, 1.1] }, corner: { fill: [0x11171d, 0.05], edge: [0xe8e3d2, 0.12, 0.5] },
  pressed: { fill: [0x322b21, 0.35], edge: [0xf3c776, 1, 1.2] },
  ink: [0xf2eee4, 0.85], cornerInk: [0xeee8db, 0.61], centre: { fill: [0x11171d, 0.19], edge: [0xead6af, 0.44] },
  size: { P: 168, L: 162.8 }, centreD: 53.8,
  // 1.7's Options "Pad size": Compact 0.8, Normal 1, Large 1.3 (1.2 on a phone).
  scale: { compact: 0.8, normal: 1, large: 1.3, largePhone: 1.2 }, inkCardinal: 20, inkCorner: 18, lensD: 17.2,
};

/** One of 1.7's symbols drawn size x size in a colour. */
export function symbol(name, size, fill = tone.ink, alpha = 1) {
  const [box, paths] = SYMBOLS[name];
  const hex = '#' + fill.toString(16).padStart(6, '0');
  const body = paths.map(([d, w, solid]) => solid ? `<path d="${d}" fill="${hex}"/>` : `<path d="${d}" fill="none" stroke="${hex}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  const g = new Graphics().svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}">${body}</svg>`);
  g.scale.set(size / box);
  g.alpha = alpha;
  return g;
}

/** 1.7's glass button: a dark see-through face, a 1 px edge, a symbol at 64%; round, or square with `radius`. */
export function glassButton(kit, name, size, act, o = {}) {
  const c = new Container();
  const face = new Graphics();
  const paint = on => {
    face.clear();
    if (o.radius !== undefined) face.roundRect(0.5, 0.5, size - 1, size - 1, o.radius); else face.circle(size / 2, size / 2, size / 2 - 0.5);
    face.fill({ color: tone.glass, alpha: on ? 0.55 : 0.25 }).stroke({ color: on ? tone.ink : tone.edge, width: 1, alpha: on ? 0.6 : 1 });
  };
  // Lit (1.7's aria-pressed: Explore while it runs): the symbol in gold. Item 293 (Justin 2026-10-20: "let's get rid of
  // this yellow semi circle at the bottom"): no gold line under it; the gold Stop says it is running.
  let lit = false;
  paint(false);
  let s = symbol(name, size * 0.64);
  s.position.set(size * 0.18, size * 0.18);
  c.addChild(face, s);
  c.setFocus = paint;
  /** Changes the symbol (Explore's compass, Stop and stairs) and whether it is lit. */
  c.setSymbol = (next, on = false) => {
    if (next !== name || on !== lit) {
      name = next; lit = on;
      s.destroy();
      // 1.7 drew these two as its own 24 px icons (32 px on a 58.6 px button), a little smaller than the journal symbols.
      const k = name === 'stop' || name === 'stairs' ? 0.56 : 0.64;
      s = symbol(name, size * k, lit ? tone.gold : tone.ink);
      s.position.set(size * (1 - k) / 2, size * (1 - k) / 2);
      c.addChild(s);
    }
  };
  c.on('pointerover', e => { if (e.pointerType === 'mouse') paint(true); });
  c.on('pointerout', () => paint(false));
  c.hitArea = { contains: (x, y) => x >= 0 && y >= 0 && x <= size && y <= size };
  return kit.control(c, act);
}

