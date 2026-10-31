// A hero's held gear drawn into his figure (spec/held-items.md; consolidation N3, render-28, moved from actor-sprite.js):
// each held picture baked crisp at the figure's pixel density, the enchant glow, and the fingers over an orb or tome;
// and the Dwarf tourist's beer in his idle (RC59).

import { Container, Sprite, Graphics, ColorMatrixFilter, Texture, ImageSource } from '../../../forge-godot/runtime/pixi.js';
import held from '../../data/held.json' with { type: 'json' };
import elements from '../../data/elements.json' with { type: 'json' };
import ui from '../../data/ui.json' with { type: 'json' };
import { heldLayers, heldPixels, skinOf, handRuns, wornMatrix, beerStep } from './held.js';
import { sheetPixels, heldArt, bakedOnce } from './art.js';

const GLOW = held.rows['enchant-glow'], MS = ui.motion.clipMs;
// RC59: a key, a click, a touch or the wheel ends the Dwarf male tourist's beer at once (1.7 BEER.input, render.js:960).
let lastInput = 0;
if (typeof window !== 'undefined' && window.addEventListener) {
  for (const n of ['keydown', 'pointerdown', 'touchstart', 'wheel']) window.addEventListener(n, () => { lastInput++; }, { capture: true, passive: true });
}
const hexOf = s => Number('0x' + s.slice(1));

// The doll body is drawn smaller than painted in small windows; mipmaps shrink it smoothly.
export function smoothSheet(s) {
  const src = s.textureSource;
  if (!src.autoGenerateMipmaps) { src.autoGenerateMipmaps = true; src.updateMipmaps(); }
  return s;
}
// H22 (sandbox 100, Justin 2026-10-17: "held items seem blurry, i thought we fixed that?"): a held picture is one
// nearest-sampled texture per item, tier and size (heldPixels): baked down to the figure's pixel density with the Worn
// dulling (H21) in its pixels, so no filter or mipmap pass ever softens it. Drawn at its painted size or more (the
// doll) it keeps its own pixels.
function heldTexture(key, tier, plan) {
  return bakedOnce('held:' + key + ':' + tier + ':' + plan.w + 'x' + plan.h, () => {
    let t;
    const src = heldArt(), f = src.textures['held-' + key].frame, m = wornMatrix(key, tier);
    if (!plan.baked && !m) {
      t = new Texture({ source: crispSource(src), frame: f.clone() });
    } else {
      const c = new OffscreenCanvas(plan.w, plan.h), g = c.getContext('2d', { willReadFrequently: true });
      g.imageSmoothingEnabled = plan.baked; g.imageSmoothingQuality = 'high';
      g.drawImage(src.textureSource.resource, f.x, f.y, f.width, f.height, 0, 0, plan.w, plan.h);
      if (m) {
        const im = g.getImageData(0, 0, plan.w, plan.h), d = im.data;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], gg = d[i + 1], b = d[i + 2];
          d[i] = m[0] * r + m[1] * gg + m[2] * b; d[i + 1] = m[5] * r + m[6] * gg + m[7] * b; d[i + 2] = m[10] * r + m[11] * gg + m[12] * b;
        }
        g.putImageData(im, 0, 0);
      }
      t = Texture.from({ resource: c, scaleMode: plan.scaleMode });
    }
    return { tex: t, source: src.textureSource };   // art.js keeps it while the sheet is in memory (a parked one bakes blank)
  });
}
let crisp = null;
const crispSource = s => (crisp ??= new ImageSource({ resource: s.textureSource.resource, scaleMode: 'nearest' }));
const artSize = key => { const f = heldArt().textures['held-' + key]; if (!f) throw new Error('no held picture held-' + key); return { w: f.frame.width, h: f.frame.height }; };

/**
 * Draws a hero sheet's frame into figure (in the sheet's cell pixels): the body, its held gear and the fingers over it.
 * Returns paint(frameName, gear, at, tint); at is heldLayers' {row, frame, step, off}.
 */
export function gearPainter(sh, figure, body) {
  const cell = sh.data.meta.cell, pool = { items: [], fingers: [] };

  // H17: the sheet's pixels (art.js, read once per sheet), for finding a painted hand over an orb or tome.
  let pixels = null, skin;
  const runs = new Map();
  const pixelAt = name => {
    pixels ??= sheetPixels(body.texture.source);
    const fr = sh.data.frames[name].frame;
    return (x, y) => {
      if (x < 0 || y < 0 || x >= cell || y >= cell) return null;
      const i = ((fr.y + y) * pixels.w + fr.x + x) * 4, d = pixels.data;
      return [d[i], d[i + 1], d[i + 2], d[i + 3]];
    };
  };
  const runsAt = (name, hn, grip) => {
    pixelAt(name);
    const k = name + ':' + hn;
    if (!runs.has(k)) {
      if (skin === undefined) {
        const still = sh.data.frames.static ? 'static' : 'idle-0';
        skin = skinOf(pixelAt(still), sh.data.frames[still].grip, cell);
      }
      runs.set(k, handRuns(pixelAt(name), grip, skin, cell));
    }
    return runs.get(k);
  };

  // One holder per drawn item, by its place in the list: both hands may hold the same picture (two daggers).
  const itemSprite = (i, key) => {
    let s = pool.items[i];
    // Item 218: held, so the card pass lights it as one flat card in every clip (light-passes.js, card-glsl.js).
    if (!s) { const holder = new Container(), pic = new Sprite(); pic.held = true; holder.addChild(pic); s = pool.items[i] = { holder, pic, glow: null, glowEl: null }; }
    s.key = key;
    return s;
  };
  // H23 (1.7 equip.js:495, :518-520): an enchanted handled item glows in its element's colour, as canvas shadowBlur
  // drew it: a soft copy of the picture in that colour under it, blur 0.04 of the standing height on screen, at least
  // 3 px. The softness is made of stamps, copies of the picture set round it at two radii and faded, under one colour
  // filter (a Gaussian's look without a blur pass per frame). The copies follow the picture's texture, anchor, turn and scale.
  const STAMPS = Array.from({ length: 16 }, (_, i) => { const a = (i % 8) / 8 * Math.PI * 2 + (i < 8 ? 0 : Math.PI / 8), r = i < 8 ? 0.45 : 1; return [Math.cos(a) * r, Math.sin(a) * r, i < 8 ? 0.14 : 0.07]; });
  const glowOf = (s, el) => {
    if (!el) { if (s.glow) s.glow.visible = false; return; }
    if (!s.glow) {
      s.glow = new Container();
      for (const [, , a] of STAMPS) { const c = new Sprite(); c.alpha = a; s.glow.addChild(c); }
      s.glow.filters = [new ColorMatrixFilter()];
      s.holder.addChildAt(s.glow, 0);
    }
    const g = s.glow;
    if (s.glowEl !== el) {
      s.glowEl = el;
      const c = hexOf(elements.rows[el]?.colour ?? '#FFFFFF');
      g.filters[0].matrix = [0, 0, 0, 0, (c >> 16 & 255) / 255, 0, 0, 0, 0, (c >> 8 & 255) / 255, 0, 0, 0, 0, (c & 255) / 255, 0, 0, 0, 1, 0];
    }
    // The blur in cell px: 0.04 of the standing height, or 3 screen px where that is more.
    const wt = figure.worldTransform, perCell = Math.hypot(wt.a, wt.b) || 1, stand = sh.data.meta.stand;
    const blur = Math.max(GLOW.minPx / perCell, stand * GLOW.blur);
    g.visible = true;
    g.children.forEach((c, i) => {
      c.texture = s.pic.texture; c.anchor.copyFrom(s.pic.anchor); c.rotation = s.pic.rotation; c.scale.copyFrom(s.pic.scale);
      c.position.set(STAMPS[i][0] * blur, STAMPS[i][1] * blur);
    });
  };
  const fingerSprite = i => {
    let s = pool.fingers[i];
    // Item 218: no twins in the card pass: the body's whole frame under a mask, they would lay the body over the gear.
    if (!s) { const pic = new Sprite(), mask = new Graphics(); pic.mask = mask; pic.twins = false; s = pool.fingers[i] = { pic, mask }; }
    return s;
  };

  return (name, gear, at, tint) => {
    figure.removeChildren();
    if (!gear || (!gear.main && !gear.off && !gear.ranged)) { figure.addChild(body); return; }
    let nf = 0, ni = 0;
    for (const L of heldLayers(sh.data, gear, at, artSize)) {
      if (L.body) { figure.addChild(body); continue; }
      if (L.item) {
        const s = itemSprite(ni++, L.item);
        const px = heldPixels(L, artSize(L.item));
        s.pic.texture = heldTexture(L.item, L.tier, px);
        s.holder.position.set(px.x, px.y); s.holder.scale.set(1, L.flatY);
        s.pic.anchor.set(L.anchorX, L.anchorY); s.pic.rotation = L.rot; s.pic.scale.set(L.mirror ? -px.scale : px.scale, px.scale);
        s.pic.tint = tint;
        glowOf(s, L.enchant);
        figure.addChild(s.holder);
        continue;
      }
      const s = fingerSprite(nf++);
      s.pic.texture = body.texture; s.pic.tint = tint;
      s.mask.clear();
      if (L.runs) { const runs = runsAt(name, L.fingers, L.grip); if (!runs.length) continue; for (const [x, y, w] of runs) s.mask.rect(x, y, w, 1); }
      else s.mask.circle(L.x, L.y, L.r);
      s.mask.fill(0xffffff);
      figure.addChild(s.pic, s.mask);
    }
  };
}

/** RC59: the beer for a hero whose sheet has one (meta.clips.beer.play), else null. live: the body's {t, row} now. */
export function beerIdle(meta, clock, live) {
  const beer = meta.clips.beer?.play ? meta.clips.beer : null;
  if (!beer) return null;
  // RC59 (1.7 render.js:940-994; Justin 2026-10-08: 'the dwarf idle needs like 10 regular idles into the beer', 'he only
  // does it when his off hand is free'): the Dwarf male tourist's sheet has a beer row with its play order. After
  // clips.beer.after ordinary idle loops in a row while the hero is calm (map-view.js: alive, no foe in sight, the off
  // hand empty or the Camera), the row plays once; then the idle starts again from its first frame and the count from
  // nothing. Any input, a turn passing (stir), a clip or a step ends it at once. A picture only: it holds no turn.
  let calm = false, calmFrom = 0, beerAt = null, idleBase = 0, inputSeen = lastInput;
  const settle = () => { if (beerAt !== null) { beerAt = null; idleBase = live.t; } calmFrom = live.t; };
  const frame = () => {
    const t = live.t, id = meta.clips[live.row], L = id.frames * MS.idle;
    if (!calm || clock.reduced || inputSeen !== lastInput) settle();
    inputSeen = lastInput;
    if (beerAt === null && calm && !clock.reduced) {
      const due = idleBase + (Math.max(0, Math.ceil((calmFrom - idleBase) / L)) + (beer.after ?? 10)) * L;
      if (t >= due) beerAt = due;
    }
    if (beerAt !== null) {
      const b = beerStep(beer.play, t - beerAt);
      if (b.frame !== undefined) return { frame: b.frame, row: 'beer', done: false };
      idleBase = t - b.after; beerAt = null; calmFrom = idleBase;
    }
    return { frame: Math.floor((t - idleBase) / MS.idle) % id.frames, done: false };
  };
  return {
    frame,
    settle,
    /** A clip or a step: the beer ends and the count starts again. */
    reset() { calmFrom = idleBase = 0; beerAt = null; },
    calm(ok) { calm = !!ok; },
  };
}
