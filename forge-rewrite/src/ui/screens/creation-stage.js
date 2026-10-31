// The creator's stage, 2.5D (Justin 2026-10-20: "draw the background stretched and angled, then draw all the map art up
// right, and draw the grass and stuff vertically on top of it scaled by how close to the camera it is, then we can use
// existing in game animations, then you can just draw the characters on it too so that are in the map and not on it";
// "so you get kind of a 2.5D approach"). The game's own floor, baked lit (images/title/creation-floor), lies tilted
// back on a perspective mesh; the room's back wall (images/title/creation-wall) stands upright on its far edge; every
// tuft, plant and piece stands upright on the floor at its tile, scaled by its depth, swaying in the game's wind. The
// figures stand in it: what lies nearer than their feet draws over them.

import { AnimatedSprite, Container, Matrix, PerspectiveMesh, Rectangle, Sprite, Texture, Ticker } from '../../../../forge-godot/runtime/pixi.js';
import { whenLoaded } from '../core/loaded.js';
import { sheet, hasSheet, loadSheet, propSprite } from '../core/art.js';

const FLOOR = 'assets/images/title/creation-floor.webp', WALL = 'assets/images/title/creation-wall.webp';
// The camp's fire pit, drawn for the stage by PixelLab (Justin 2026-10-20: "have pixel lab make us a higher pixel animated
// firepit"): a strip of square frames, the flames looping.
const FIREPIT = 'assets/images/title/creation-firepit.webp', FIREPIT_MS = 110, FIREPIT_TILES = 1.45;   // 85% of 1.7 (Justin 2026-10-20: "maybe 85% size")
// The room the floor picture holds, in tiles, and what stands in it, room-relative (tools/assets/vendor/creation-stage
// builds the floor's bake from the same scene).
const ROOM = { w: 17, h: 9 };
const PIECES = [['fire-pit', 8, 7.35], ['sacks', 10.35, 5.7], ['reeds-and-rubble', 12, 6], ['reeds-and-rubble', 16, 7], ['fern', 11, 8], ['fern', 16, 6], ['barrel', 0, 1], ['sacks', 1, 0], ['crate', 15, 1], ['barrel', 16, 2], ['bush', 0, 0], ['bush', 16, 0], ['fern', 2, 0], ['fern', 13, 0], ['fern', 0, 4]];
const SHEETS = ['environment-vegetation', 'environment-props-props', 'environment-props-dungeon'];
export const CREATION_STAGE_ART = [FLOOR, WALL, FIREPIT].map(p => p.slice('assets/'.length)).concat(SHEETS.map(n => 'sheets/' + n + '.json'));
const VEG = 'environment-vegetation', DUNGEON_TINT = 0x9ea08f, GRASS_ALPHA = 0.78;
// The grass tiles [u, v, tall] (tall grass gets its front tuft too).
const GRASS = [[3,2,0],[4,2,0],[5,2,0],[6,2,0],[7,2,0],[9,2,0],[2,3,0],[3,3,0],[4,3,0],[5,3,1],[6,3,1],[7,3,1],[8,3,1],[9,3,0],[1,4,0],[2,4,1],[3,4,1],[4,4,1],[5,4,1],[6,4,1],[7,4,1],[8,4,1],[9,4,1],[10,4,0],[1,5,0],[2,5,1],[3,5,1],[4,5,1],[5,5,1],[6,5,1],[7,5,1],[8,5,1],[9,5,1],[10,5,0],[1,6,0],[2,6,1],[3,6,1],[4,6,1],[5,6,1],[6,6,1],[7,6,1],[8,6,1],[9,6,1],[10,6,0],[11,6,0],[1,7,0],[2,7,0],[3,7,0],[4,7,0],[5,7,0],[6,7,0],[9,7,0]];
// The bed mats laid on the floor at the front tiles' size: [u, v, w, h, turn] (Justin 2026-10-20: "the bed maps and fire
// will need to be increased in size to match the tiles there up front").
const MATS = [[9.75,6.6,1.7,0.95,0.08]];
// The pool's water tiles, and the sconces' flames on the wall picture (its pixels).
const WATER = [[12,7],[13,7],[14,7],[15,7],[12,8],[13,8],[14,8],[15,8],[16,8],[13,6],[14,6],[15,6]];
const SCONCES = [[856, 248], [1308, 248]];
const FIRE = [8.5,7.97];   // the campfire's flame, on the floor
// The floor's light per tile, 0 to 9 (make-stage.py, from the bake): what each standing piece is lit by.
const LIGHT = '11223698969632211/12223577777533221/22223345666543222/22223456876543222/22223458997654332/22223357996656532/22222358996445722/22222349996424742/12222336764312641';
const lightAt = (u, v) => { const r = LIGHT.split('/')[Math.max(0, Math.min(ROOM.h - 1, Math.floor(v)))]; const d = r ? Number(r[Math.max(0, Math.min(ROOM.w - 1, Math.floor(u)))]) : 9; return 0.3 + 0.75 * d / 9; };
const shade = (tint, f) => [16, 8, 0].reduce((c, sh) => c | (Math.min(255, Math.round(((tint >> sh) & 255) * f)) << sh), 0);

// The wind (ground-view.js sway: a slow wave across the map plus a flutter).
const sway = (x, y, t) => (Math.sin(t * 0.9 + x * 0.45 + y * 0.2) * 0.5 + Math.sin(t * 2.3 + x * 1.3 + y * 0.7) * 0.18) * 0.16;
const hash = (x, y, s) => { const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };

/** The projective map taking the floor's corners (0,0) (w,0) (w,h) (0,h) to the four screen points `q`. */
function homography(w, h, q) {
  const src = [[0, 0], [w, 0], [w, h], [0, h]], A = [], b = [];
  src.forEach(([x, y], i) => { const [X, Y] = q[i]; A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]); b.push(X); A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]); b.push(Y); });
  for (let c = 0; c < 8; c++) {   // Gauss-Jordan
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  const m = b.map((v, i) => v / A[i][i]);
  return (x, y) => { const d = m[6] * x + m[7] * y + 1; return { x: (m[0] * x + m[1] * y + m[2]) / d, y: (m[3] * x + m[4] * y + m[5]) / d }; };
}

/** The floor and wall pictures once in (else null), and whether the pieces' sheets are; asks for what is missing,
 *  `redraw` when it lands. The floor and wall show first; the pieces join them when their sheets are in. */
// Each sheet is asked for once while it is out; one that fails is not asked again in a loop (the stage draws without it).
const asked = new Set();
function ready(redraw) {
  const pics = [whenLoaded(FLOOR, redraw), whenLoaded(WALL, redraw)], pit = whenLoaded(FIREPIT, redraw);
  const missing = SHEETS.filter(n => !hasSheet(n)), ask = missing.filter(n => !asked.has(n));
  for (const n of SHEETS) if (hasSheet(n)) asked.delete(n);
  if (ask.length) {
    ask.forEach(n => asked.add(n));
    const one = n => { try { return loadSheet('sheets/' + n + '.json').catch(() => null); } catch { return null; } };   // no loader: drawn without
    Promise.all(ask.map(one)).then(() => { if (ask.some(hasSheet)) redraw(); });
  }
  return { pics: pics.every(Boolean) ? [...pics, pit] : null, sheets: !missing.length };
}

/**
 * The stage for the screen `box` (stage units: x, y, w, h of the real screen), its far edge `far` of the way down and
 * `back` of the screen wide. Returns the floor and wall (behind), the pieces split at the figures' feet line `feetY`
 * (behind them, in front of them), and where the hall's life goes (life, once the pictures are in).
 */
export function buildStage(kit, box, feetY, redraw, { far = 0.377, back = 0.585, spread = 1.3, portrait = null } = {}) {
  const behind = new Container(), front = new Container();
  behind.label = 'stage-behind'; front.label = 'stage-front'; behind.eventMode = front.eventMode = 'none';
  const { pics, sheets } = ready(redraw);
  const yb = box.y + box.h * far, wb = box.w * back, wf = box.w * spread, cx = box.x + box.w / 2;
  // A phone held upright (Justin 2026-10-20: "we gotta do better for the portrait background"): the floor's far edge
  // just over the line-up, its meadow under all five figures, the door near the middle behind them and the camp in the
  // gap the panel leaves. `portrait`: uc the tile under the screen's middle, sb and sf a tile's share of the width at
  // the far and near edges, yb and yf their heights.
  const P = portrait, q = P
    ? [[cx + (0 - P.uc) * P.sb * box.w, box.y + P.yb * box.h], [cx + (ROOM.w - P.uc) * P.sb * box.w, box.y + P.yb * box.h],
      [cx + (ROOM.w - P.uc) * P.sf * box.w, box.y + P.yf * box.h], [cx + (0 - P.uc) * P.sf * box.w, box.y + P.yf * box.h]]
    : [[cx - wb / 2, yb], [cx + wb / 2, yb], [cx + wf / 2, box.y + box.h], [cx - wf / 2, box.y + box.h]];
  const at = homography(ROOM.w, ROOM.h, q);
  // One tile's width on screen at (u, v): the depth scale.
  const tileAt = (u, v) => at(u + 0.5, v).x - at(u - 0.5, v).x;
  // The floor row under the figures' feet.
  let lo = 0, hi = ROOM.h; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (at(ROOM.w / 2, m).y < feetY) lo = m; else hi = m; }
  const feetV = (lo + hi) / 2;
  const out = { behind, front };
  if (!pics) return out;
  const [floorTex, wallTex, pitTex] = pics;
  const floor = new PerspectiveMesh({ texture: /** @type {Texture} */ (floorTex), verticesX: 20, verticesY: 20,
    x0: q[0][0], y0: q[0][1], x1: q[1][0], y1: q[1][1], x2: q[2][0], y2: q[2][1], x3: q[3][0], y3: q[3][1] });
  floor.label = 'stage-floor';
  const wall = new Sprite(/** @type {Texture} */ (wallTex));
  wall.label = 'stage-wall';
  const farL = q[0][0], farR = q[1][0], farY = q[0][1];
  wall.anchor.set(0.5, 1); wall.position.set((farL + farR) / 2, farY); wall.scale.set((farR - farL) / wall.texture.width);
  behind.addChild(floor, wall);
  // Where the hall's life goes (creation-hall.js): the flames on the wall and the fire, the glints on the pool.
  const ws = wall.scale.x, fireAt = at(...FIRE), unit = tileAt(...FIRE);
  out.life = {
    flames: [...SCONCES.map(([x, y]) => ({ x: wall.x + (x - wall.texture.width / 2) * ws, y: farY - (wall.texture.height - y) * ws, r: 120 * ws, core: 22 * ws })),
      { x: fireAt.x, y: fireAt.y, r: unit * 1.6, core: unit * 0.28 }],
    fire: { x: fireAt.x, y: fireAt.y - unit * 0.15, unit },
    water: WATER.flatMap(([u, v]) => [0, 1].map(j => { const p = at(u + 0.2 + 0.6 * hash(u, v, 40 + j), v + 0.2 + 0.6 * hash(u, v, 50 + j)); return { x: p.x, y: p.y, unit: tileAt(u, v) }; })),
  };
  if (!sheets) return out;

  // The standing pieces, each built at tile T as the map builds it, then stood on its tile's foot, scaled to its depth.
  const T = 128, veg = sheet(VEG), vres = veg?.data.meta.res ?? 1, swaying = [], pieces = [];
  const stand = (node, u, v, foot = 0.96) => {
    const c = new Container(); c.addChild(node); c.pivot.set(T / 2, T * foot);
    const p = at(u + 0.5, v + foot); c.position.set(p.x, p.y); c.scale.set(tileAt(u, v + foot) / T); c.depth = v + foot;
    pieces.push(c); return c;
  };
  // A plant (a tuft, a bush, a fern) as the map draws it, bottom centre on its own foot point, sorted by it.
  const plant = (name, u, v, du, dv, scale, swayK, alpha, flip) => {
    const tex = veg?.textures['veg-' + name]; if (!tex) return;
    const fu = u + du, fv = v + dv, s = new Sprite(tex), c = new Container();
    // Nothing grows out of a bed mat (Justin 2026-10-20: "grass shouldn't be growing out of the bed mat").
    if (MATS.some(([mu, mv, mw, mh]) => fu > mu - 0.2 && fu < mu + mw + 0.2 && fv > mv - 0.1 && fv < mv + mh + 0.35)) return;
    s.anchor.set(0.5, 1); s.scale.set((flip ? -1 : 1) * (T / 64) * scale / vres, (T / 64) * scale / vres);
    s.alpha = alpha; s.tint = shade(DUNGEON_TINT, lightAt(fu, fv));
    const p = at(fu, fv); c.addChild(s); c.position.set(p.x, p.y); c.scale.set(tileAt(fu, fv) / T); c.depth = fv;
    pieces.push(c); swaying.push({ s, u: fu, v: fv, k: swayK });
  };
  // The bed mats lie flat: the picture mapped onto its patch of floor (three of its corners through the floor's
  // projection; a mat is small enough that the patch is near enough a parallelogram). Under everything standing.
  const mat = sheet('environment-props-dungeon')?.textures['props/bedroll'];
  for (const [u, v, w, h, turn] of MATS) if (mat) {
    const s = new Sprite(mat), c = Math.cos(turn), n = Math.sin(turn), cu = u + w / 2, cv = v + h / 2;
    const pt = (x, y) => at(cu + x * c - y * n, cv + x * n + y * c);
    const p0 = pt(-w / 2, -h / 2), p1 = pt(w / 2, -h / 2), p3 = pt(-w / 2, h / 2), fw = mat.frame.width, fh = mat.frame.height;
    s.setFromMatrix(new Matrix((p1.x - p0.x) / fw, (p1.y - p0.y) / fw, (p3.x - p0.x) / fh, (p3.y - p0.y) / fh, p0.x, p0.y));
    s.tint = shade(0xffffff, lightAt(cu, cv)); s.eventMode = 'none';
    behind.addChild(s);
  }
  for (const [id, u, v] of PIECES) {
    if (id === 'bush' || id === 'fern') { plant(`earth-${id}-${1 + Math.floor(hash(u, v, 91) * 3)}`, u, v, 0.5, 0.97, id === 'bush' ? 1 : 0.85, id === 'bush' ? 0.3 : 0.8, 1, hash(u, v, 92) < 0.5); continue; }
    if (id === 'fire-pit') {
      if (!pitTex) continue;   // the fire pit: its frames cut from the strip, its foot on the tile's
      const src = /** @type {Texture} */ (pitTex).source, n = Math.round(src.width / src.height), S = src.height;
      const a = new AnimatedSprite(Array.from({ length: n }, (_, i) => new Texture({ source: src, frame: new Rectangle(i * S, 0, S, S) })));
      a.anchor.set(0.5, 120 / 128); a.scale.set(T * FIREPIT_TILES / (S * 104 / 128)); a.position.set(T / 2, T * 0.96);
      a.animationSpeed = 1000 / FIREPIT_MS / 60; if (!kit.reduced) a.play();
      const c = new Container(); c.addChild(a); stand(c, u, v); continue;
    }
    const sp = propSprite({ id, x: 0, y: 0 }, T);
    if (sp) { sp.tint = shade(0xffffff, lightAt(u + 0.5, v + 0.9)); stand(sp, u, v); }
  }
  // Grass: the map's tufts (ground-view.js grassAt), back ones and front ones over each grass tile.
  for (const [u, v, tall] of GRASS) {
    const pick = (kind, s) => `dungeon-grass-${kind}-${1 + Math.floor(hash(u, v, s) * 3)}`, fl = hash(u, v, 51) < 0.5;
    plant(pick('back', 55), u, v, 0.1 + 0.8 * hash(u, v, 56), 0.62, 0.9, 0.9, GRASS_ALPHA * 0.95, !fl);
    plant(pick('back', 57), u, v, 0.05 + 0.9 * hash(u, v, 58), 0.82, 1.05, 1, GRASS_ALPHA, fl);
    if (tall) plant(pick('front', 52), u, v, 0.3 + 0.4 * hash(u, v, 53), 1.02, 1, 1.1, GRASS_ALPHA, fl);
    plant(pick('front', 61), u, v, 0.1 + 0.8 * hash(u, v, 62), 0.72 + 0.2 * hash(u, v, 63), 1.1, 0.8, GRASS_ALPHA, hash(u, v, 64) < 0.5);
  }
  pieces.sort((a, b) => a.depth - b.depth);
  for (const c of pieces) (c.depth < feetV ? behind : front).addChild(c);
  // The wind, as in play; still under reduced motion.
  if (!kit.reduced && swaying.length) {
    const tick = () => { if (behind.destroyed) return Ticker.shared.remove(tick); const t = performance.now() / 1000; for (const w of swaying) w.s.skew.x = -sway(w.u, w.v, t) * w.k; };
    tick(); Ticker.shared.add(tick); behind.on('destroyed', () => Ticker.shared.remove(tick));
  }
  return out;
}
