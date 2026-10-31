// The Crypt's living ground (M10, render-28: moved out of crypt-look.js): mushroom grass and its halos, the ooze's
// bubbles, soul smoke and wisps, wall fungus, laid out per floor by cryptGroundLife; fallen Shamblers on any floor (lyingCorpses).

import { Container, Graphics, Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import { hash2 } from '../lib/noise.js';
import monsters from '../../data/monsters.json' with { type: 'json' };
import ui from '../../data/ui.json' with { type: 'json' };
import { VEG, SPREADS, sheetOf, tex, VEG_DIM, vegBaked, cluster, footSprite } from './crypt-art.js';
import { cryptOoze, cryptGrime } from './crypt-grime.js';
import { propFit } from './art.js';


const SQUASHED_W = 28 / 128;   // a trampled shroom's width in tiles: a standing mushroom's (item 240)
// Stem feet and cap widths in the five 128px mushroom-spread frames.
const SHROOM_FEET = [
  [[30, 50, 30], [91, 70, 38], [49, 108, 28]],
  [[35, 65, 38], [87, 104, 31]],
  [[25, 48, 26], [84, 47, 30], [44, 86, 32], [97, 111, 24]],
  [[34, 40, 31], [83, 72, 37], [33, 108, 25]],
  [[28, 42, 23], [89, 41, 25], [57, 74, 29], [25, 106, 24], [97, 109, 27]],
];

/** Crypt mushroom grass (ground 1, trampled 2; 1.7 drawMushroomGrass / drawMushroomGroundDecal): one of five crypt
 *  mushroom clusters on the tile over its violet halo (added, 1.5 tiles from a quarter tile up and left; `glows` takes
 *  it for shroomGlowAnim); trampled, a squashed shroom. Still (item 239, Justin 2026-10-20: "mushrooms don't need to be
 *  animated"). */
export function cryptShroom(x, y, g, tile, under, over, glows = null) {
  if (g === 2) {
    const veg = sheetOf(VEG) ? sheetOf(VEG).textures : null, t = veg?.[`veg-crypt-shroom-squashed-${1 + Math.floor(hash2(x, y, 307) * 3)}`];
    if (!t) return;
    // Item 240 (Justin 2026-10-20: "the trampled mushrooms are much bigger than the others"): as wide as one standing
    // mushroom in the spread pictures beside it (16 to 39 px of a 128 px tile, most 26 to 30), whichever squash it is.
    const k = tile * SQUASHED_W / t.frame.width, s = new Sprite(t);
    s.anchor.set(0.5, 1); s.position.set((x + 0.5) * tile, (y + 0.8) * tile);
    s.scale.set((hash2(x, y, 308) < 0.5 ? -1 : 1) * k, k);
    s.alpha = 0.9;
    under.addChild(s);
    return;
  }
  const halo = shroomGlow();
  if (halo) {
    const h = new Sprite(halo), ph = hash2(x, y, 5) * 6.28;
    h.blendMode = 'add'; h.position.set((x - 0.25) * tile, (y - 0.25) * tile); h.width = h.height = tile * 1.5;
    h.alpha = 0.4 * (0.65 + 0.35 * Math.sin(ph));
    under.addChild(h);
    glows?.push({ s: h, ph });
  }
  // WT4: 1.7 sceneryClusterArt maps mushroom-crypt to the spread-out groups (environment-vegetation.js:36-41), row 3,
  // baked toward the Crypt's shadow (vegart.js vegBaked, VEG_DIM crypt) and drawn a tile square on its foot.
  const v = Math.floor(hash2(x, y, 301) * 5), flip = hash2(x, y, 306) < 0.5;
  const spread = tex(SPREADS, `props/mushroom-spread-3-${v}`);
  const s = spread ? footSprite(vegBaked(spread, 'crypt'), x, y, tile, flip) : cluster(`mushroom-crypt-${v}`, x, y, tile, flip);
  if (s && spread) {
    const shadow = new Graphics(), k = tile / 128;
    shadow.label = 'crypt-mushroom-contact-shadows';
    for (const [fx, fy, w] of SHROOM_FEET[v]) {
      const px = (x * 128 + (flip ? 128 - fx : fx)) * k, py = (y * 128 + fy) * k;
      shadow.ellipse(px + 2 * k, py, w * 0.4 * k, w * 0.14 * k).fill({ color: 0x100d18, alpha: 0.08 });
      shadow.ellipse(px + k, py, w * 0.28 * k, w * 0.09 * k).fill({ color: 0x100d18, alpha: 0.12 });
      shadow.ellipse(px, py, w * 0.13 * k, w * 0.05 * k).fill({ color: 0x100d18, alpha: 0.22 });
    }
    under.addChild(shadow);
  }
  if (s) { s.zIndex = (y + 1) * tile - 3; over.push(s); }
}

/** The bubbles and the drifting sheen over the ooze (1.7 drawOoze): redrawn each frame from the time, on the pools in
 *  sight (map-view's sight: { vis }). */
export function oozeLife(floor, tile) {
  const g = new Graphics(), W = floor.w, set = new Set(floor.ooze ?? []);
  const cells = [...set].map(k => ({ x: k % W, y: (k / W) | 0 }));
  return { node: g, anim: (t, reduced, sight = null) => {
    g.clear();
    if (reduced) return;
    for (const { x, y } of cells) {
      // CR21: only on pools in sight; a remembered pool lies still (1.7 drawOoze, cryptset.js:152, alpha === 1).
      if (!sight?.vis?.[y * W + x]) continue;
      // a slow sheen drifting over the surface
      const sh = (t * 0.12 + hash2(x, y, 41)) % 1;
      if (set.has(y * W + x + 1) || sh < 0.6) g.ellipse((x + sh) * tile, (y + 0.3 + 0.2 * hash2(x, y, 43)) * tile, tile * 0.22, tile * 0.05).fill({ color: 0xcff0b8, alpha: 0.14 * Math.sin(sh * Math.PI) });
      // bubbles swell and pop
      for (let b = 0; b < 2; b++) {
        const ph = (t * 0.55 + hash2(x, y, 31 + b) * 7) % 1, r = tile * 0.07 * Math.sin(ph * Math.PI);
        if (r < 0.8) continue;
        const bx = (x + 0.2 + 0.6 * hash2(x, y, 11 + b)) * tile, by = (y + 0.2 + 0.6 * hash2(x, y, 21 + b)) * tile;
        g.circle(bx, by, r).fill({ color: 0x78d250, alpha: 0.55 }).stroke({ color: 0xc8ffa0, alpha: 0.85, width: Math.max(1, tile / 64) });
        g.rect(bx - r * 0.45, by - r * 0.55, Math.max(1, r * 0.4), Math.max(1, r * 0.4)).fill({ color: 0xf0ffdc, alpha: 0.95 });
      }
    }
  } };
}

/** Green soul smoke rising from a soul urn (1.7 drawSoulSmoke): six small motes drifting up and fading. */
function smokeLife(p, tile) {
  // Placed at its urn (the ground layer culls by position) and drawn about that point.
  const g = new Graphics();
  g.position.set((p.x + 0.5) * tile, (p.y + 0.3) * tile);
  g.zIndex = (p.y + 1) * tile + 1;
  return { node: g, anim: (t, reduced) => {
    g.clear();
    const tt = reduced ? 0 : t, cx = 0, base = 0;
    for (let k = 0; k < 6; k++) {
      const ph = (tt * 0.35 + k / 6 + hash2(p.x, p.y, k)) % 1, y = base - ph * tile * 1.6, x = cx + Math.sin(tt * 2.2 + ph * 9 + k) * tile * 0.14 * ph;
      const sz = Math.max(2, tile * 0.09 * (1 - ph * 0.4));
      g.rect(x - sz / 2, y - sz / 2, sz, sz).fill({ color: k % 2 ? 0x9cff8a : 0x4fd86a, alpha: (1 - ph) * 0.55 });
    }
  } };
}

/** Shelf fungus and hanging roots on a wall face (1.7 drawCryptWallPlantProp): hanging from the face, the roots swaying a little.
 *  1.7's foot is at 0.92 of the face; each is shrunk by its props.json fit about the point `anchor` of a tile down, as
 *  objSprite shrinks: the roots at 1.7's 0.9 about that foot, the shelf fungus at half round the middle it had at 1.7's
 *  full size (item 238, Justin 2026-10-20: "these are too big and need reduced 50%"), so it still hangs mid-face. */
function wallPlant(p, tile) {
  const veg = sheetOf(VEG) ? sheetOf(VEG) : null, t = veg?.textures[`veg-${p.id}`];
  if (!t) return null;
  const res = veg.data.meta.res ?? 1, f = propFit(p.id, { flat: true }), k = f.scale, s = new Sprite(t), ay = (p.y + f.anchor) * tile;
  s.anchor.set(0.5, 1);
  s.position.set((p.x + 0.5 + 0.12 * (hash2(p.x, p.y, 311) - 0.5)) * tile, ay + ((p.y + 0.92) * tile - ay) * k);
  s.scale.set((hash2(p.x, p.y, 312) < 0.5 ? -1 : 1) * (tile / 64) * k / res, (tile / 64) * k / res);
  s.zIndex = (p.y + 1) * tile - 2;
  return s;
}

/** A soft radial puff painted once (64 px, linear): `stops` are [offset, r, g, b, alpha share]; a sprite's alpha
 *  scales the whole of it, as 1.7's gradients scale every stop by the puff's alpha. */
const SOFT = new Map();
function softTex(key, stops) {
  if (SOFT.has(key)) return SOFT.get(key);
  let t = null;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    for (const [o, r, gg, b, a] of stops) gr.addColorStop(o, `rgba(${r},${gg},${b},${a})`);
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    t = Texture.from({ resource: c, scaleMode: 'linear' });
  }
  SOFT.set(key, t);
  return t;
}
// 1.7 drawSoulWisps (cryptset.js:369-384): each puff a gradient from pale green through green to clear, the mouth glow
// a pale green to clear.
const wispPuff = () => softTex('wisp', [[0, 170, 255, 160, 1], [0.5, 90, 230, 120, 0.6], [1, 40, 160, 80, 0]]);
const wispMouth = () => softTex('wisp-mouth', [[0, 150, 255, 150, 1], [1, 60, 200, 100, 0]]);

/** Soul wisps curling up out of a grave post (1.7 drawSoulWisps): three ribbons of soft green puffs, and a glow at
 *  the post's mouth, added over the scene. */
function wispLife(p, tile) {
  const g = new Container(), puff = wispPuff(), mouthTex = wispMouth();
  g.position.set((p.x + 0.5) * tile, p.y * tile + tile * 0.02);   // at its post: the ground layer culls by position
  g.zIndex = (p.y + 1) * tile;
  const puffs = [];
  if (puff) for (let i = 0; i < 27; i++) { const s = new Sprite(puff); s.anchor.set(0.5); s.blendMode = 'add'; g.addChild(s); puffs.push(s); }
  const mouth = mouthTex ? new Sprite(mouthTex) : null;
  if (mouth) { mouth.anchor.set(0.5); mouth.blendMode = 'add'; mouth.position.set(0, tile * 0.05); mouth.width = mouth.height = tile * 0.6; g.addChild(mouth); }
  return { node: g, anim: (t, reduced) => {
    const tt = reduced ? 0 : t;
    for (let k = 0; k < 3 && puffs.length; k++) {
      const off = hash2(p.x, p.y, k + 11), speed = 0.22 + off * 0.12;
      for (let s = 0; s < 9; s++) {
        const ph = ((tt * speed + k / 3 + off - s * 0.018) % 1 + 1) % 1;
        const y = -ph * tile * 1.5, sway = Math.sin(tt * 1.6 + ph * 7 + k * 2.1) * tile * (0.05 + ph * 0.22);
        const r = tile * (0.09 + ph * 0.2), a = (1 - ph) * (ph < 0.12 ? ph / 0.12 : 1) * 0.42 * (1 - s / 12);
        const sp = puffs[k * 9 + s];
        sp.position.set(sway, y); sp.width = sp.height = r * 2; sp.alpha = a;
      }
    }
    if (mouth) mouth.alpha = 0.6 * (0.75 + 0.25 * Math.sin(tt * 2.3 + p.x));
  } };
}

// 1.7 shroomGlowRaster (cryptset.js:441-446): a violet halo, centred a little low (16, 18 of 32), radius 15 of 32.
let shroomGlowTex;
function shroomGlow() {
  if (shroomGlowTex !== undefined) return shroomGlowTex;
  shroomGlowTex = null;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); g.scale(4, 4);
  const gr = g.createRadialGradient(16, 18, 1, 16, 18, 15);
  gr.addColorStop(0, 'rgba(190,110,255,0.55)'); gr.addColorStop(0.5, 'rgba(140,60,230,0.22)'); gr.addColorStop(1, 'rgba(90,30,180,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  return (shroomGlowTex = Texture.from({ resource: c, scaleMode: 'linear' }));
}

/** CR11: each frame, the mushrooms' halos breathe, at half their original opacity. */
export function shroomGlowAnim(glows) {
  return (t, reduced) => { const tt = reduced ? 0 : t; for (const g of glows) g.s.alpha = 0.4 * (0.65 + 0.35 * Math.sin(tt * 1.8 + g.ph)); };
}

/** A Shambler's corpse lying where it fell (1.7 drawLyingCorpse): the last frame of its death clip, until it rises. */
function corpseSprite(c, tile) {
  const row = monsters.rows[c.kind], name = 'mob-' + row?.look?.sheet;
  if (!row || !sheetOf(name)) return null;
  const sh = sheetOf(name), frames = sh.animations?.death;
  if (!frames?.length) return null;
  const meta = sh.data.meta, cell = meta.cell ?? 128, [bx, by, bw, bh] = meta.box ?? [0, 0, cell, cell];
  const s = new Sprite(frames[frames.length - 1]);
  s.anchor.set(0);   // Position by the foot pivot only, as the living body does.
  const scale = tile * (row.look.art ?? ui.actorSize.defaultArt) / Math.max(bh, bw * ui.actorSize.creatureWidthWeight);
  s.pivot.set(bx + bw / 2, by + bh);
  s.scale.set((c.flip ? -1 : 1) * scale, scale);
  s.position.set((c.x + 0.5) * tile, (c.y + 1) * tile - tile * 0.04);
  s.alpha = 0.92;
  s.zIndex = (c.y + 1) * tile - 4;
  return s;
}

/**
 * The Crypt's living ground for one floor: ooze pools (under the growth) with their bubbles, soul wisps over the
 * grave posts, wall plants. Returns the frame functions (time in seconds, reduced motion).
 */
export function cryptGroundLife(floor, tile, under, over, swaying = null) {
  const anims = [];
  // Grime under everything (salt from the floor's own layout: the same floor always stains the same way).
  if (typeof document !== 'undefined') under.addChildAt(cryptGrime(floor, tile, ((floor.stairs?.x ?? 0) * 131 + (floor.stairs?.y ?? 0) * 17 + 19) % 9973), 0);
  const pool = cryptOoze(floor, tile);
  if (pool) {
    const life = oozeLife(floor, tile), holder = new Container();
    holder.addChild(pool, life.node);
    under.addChildAt(holder, 1);   // over the grime
    anims.push(life.anim);
  }
  for (const p of floor.props ?? []) {
    if (p.part) continue;
    if (p.id === 'grave-post' && p.wisps) { const w = wispLife(p, tile); over.push(w.node); anims.push(w.anim); }
    if (p.soulSmoke) { const w = smokeLife(p, tile); over.push(w.node); anims.push(w.anim); }
    if (/^crypt-(roots|shelf-fungus)-\d$/.test(p.id)) { const s = wallPlant(p, tile); if (s) { over.push(s); if (/roots/.test(p.id)) swaying?.push({ s, x: p.x, y: p.y, k: 0.35, v: null }); } }   // the fungus still (item 239)
  }
  return anims;
}

/**
 * Shamblers' corpses lying in wait, on whatever floor they fell (item 241), each hidden while its body still dies.
 * Returns the frame functions.
 */
export function lyingCorpses(floor, tile, over, hide = null) {
  const anims = [];
  for (const c of floor.corpses ?? []) {
    if (hide?.has(c.id)) continue;   // CR13 (1.7 crypt.js:384): not while its body still plays its death clip
    const s = corpseSprite(c, tile);
    if (!s) continue;
    over.push(s);
    // About to rise: the body shakes (sin(now / 55) x 2% of a tile) and a gold "!" stands over it (1.7 drawLyingCorpse).
    if (c.twitch) {
      const x0 = s.x, mark = new Graphics(), u = tile / 64;
      mark.roundRect(-2.5 * u, -9 * u, 5 * u, 11 * u, 2 * u).fill({ color: 0xffd24a }).circle(0, 6 * u, 2.6 * u).fill({ color: 0xffd24a });
      mark.position.set((c.x + 0.78) * tile, (c.y + 0.22) * tile); mark.zIndex = (c.y + 1) * tile + 2;
      over.push(mark);
      anims.push((t, reduced) => { s.x = reduced ? x0 : x0 + Math.sin(t * 1000 / 55) * tile * 0.02; });
    }
  }
  return anims;
}
