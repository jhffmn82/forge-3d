// The Realm's and the planes' moving life (M10, render-28: moved out of realm-view.js): vents, glows and portal
// light, the void's drifting life and the islands' glints, and the currents with their ribbons and boarding pools.

import { Container, Graphics, MeshRope, Point, Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import { hash2 } from '../lib/noise.js';
import { ROCK } from '../data/rock.js';
import { veinAt } from './realm-raster.js';
import { radialTexture } from './stamps.js';
import { wallish, hexN, motionSalt, reduced, inSight, known, memA, footprint, animate, noise } from './realm-kit.js';
import { chasmDebris, debrisBob } from './cave-terrain.js';
/** Air emerging directly from the floor: drifting mist and open spirals, with no stone patch or hole. */
export function vent(floor, x, y, tile) {
  const c = new Container(), cx = (x + 0.5) * tile, cy = (y + 0.5) * tile, phase = hash2(x, y, 711) * Math.PI * 2;
  const mist = Array.from({ length: 8 }, () => {
    const s = new Sprite(radialTexture('air-vent-mist', [[0, 1], [0.45, 0.3], [1, 0]]));
    s.anchor.set(0.5); s.tint = 0xB7C8D6; s.width = tile * 0.42; s.height = tile * 0.18;
    c.addChild(s); return s;
  });
  const ribbons = new Graphics(); c.addChild(ribbons);
  animate(ribbons, t => {
    for (let i = 0; i < mist.length; i++) {
      const p = (t * 0.22 + i / mist.length) % 1, a = phase + t * 0.55 + i * 2.4;
      mist[i].position.set(cx + Math.cos(a) * tile * 0.3, cy + Math.sin(a) * tile * 0.13 - p * tile * 0.4);
      mist[i].alpha = Math.sin(p * Math.PI) * 0.16;
    }
    ribbons.clear();
    for (let i = 0; i < 3; i++) {
      const p = (t * 0.25 + i / 3) % 1, alpha = Math.sin(p * Math.PI), a = phase + t * 0.45 + i * 2.1;
      for (const [color, width, opacity] of [[0x748C9E, 0.168, 0.3], [0xF2F7FA, 0.084, 0.85]]) {
        for (let k = 0; k <= 20; k++) {
          const u = k / 20, angle = a + u * 3.8, radius = tile * (0.09 + u * 0.28);
          const px = cx + Math.cos(angle) * radius, py = cy + Math.sin(angle) * radius * 0.45 - p * tile * 0.5 - u * tile * 0.08;
          if (!k) ribbons.moveTo(px, py); else ribbons.lineTo(px, py);
        }
        ribbons.stroke({ color, width: Math.max(0.6, tile * width), alpha: alpha * opacity });
      }
    }
  }, { floor, cells: [y * floor.w + x] });
  return c;
}

// ---------------------------------------------------------------------------------------------- live overlays

/** One soft radial glow, tinted per use (the canvas gradients 1.7 paints each frame; stamps.js, render-13). */
const glow = () => radialTexture('glow-45', [[0, 1], [0.45, 0.45], [1, 0]]);
export function glowSprite(cx, cy, rx, ry, color, alpha) {
  const s = new Sprite(glow()); s.anchor.set(0.5); s.position.set(cx, cy); s.width = rx * 2; s.height = ry * 2; s.tint = color; s.alpha = alpha; return s;
}
/**
 * The portals' living glow, by palette (drawRotPortals, drawCinderPortals, drawVioletPortals, drawThemePortals). As 1.7
 * (chaos-preview-render.js:390, :483, :585, :764-766): a Rot, Cinder or Violet glow shows only while the portal is in
 * sight; a Prism one stays in memory, dimmed (memA .45) and still. Its motion holds under reduced motion.
 */
export function portalGlow(floor, p, pal, tile) {
  const c = new Container(), dots = new Graphics(), w = p.w ?? 2, h = p.h ?? 2;
  const where = { floor, cells: footprint(floor, p.x, p.y, w, h) }, onlyInSight = pal === 'rot' || pal === 'cinder' || pal === 'violet';
  const shown = sight => { c.visible = onlyInSight ? sight === 'in' : sight !== 'none'; c.alpha = sight === 'in' ? 1 : memA(floor, 0.45); dots.clear(); return c.visible; };
  if (pal === 'rot') {
    const x = (p.x + w * 0.5) * tile, y = (p.y + h * 0.42) * tile, r = tile * w * 0.52;
    c.addChild(glowSprite(x, y, r, r, 0xd8f2a8, 0.28), dots);
    animate(dots, (t, sight) => { if (!shown(sight)) return; for (let j = 0; j < 5; j++) { const a = t * 0.3 + j * Math.PI * 2 / 5; dots.ellipse(x + Math.cos(a) * tile * w * 0.22, y + Math.sin(a) * tile * h * 0.3, Math.max(0.8, tile * 0.021), Math.max(0.8, tile * 0.025)).fill({ color: j % 2 ? 0xd7ec88 : 0xf3e6b1, alpha: 0.75 * (0.35 + 0.14 * Math.sin(a + t)) }); } }, where);
  } else if (pal === 'cinder') {
    const x = (p.x + 1) * tile, y = (p.y + 0.9) * tile, r = tile * 0.85;
    c.addChild(glowSprite(x, y, r, r, 0xffb070, 0.25), dots);
    animate(dots, (t, sight) => { if (!shown(sight)) return; for (let j = 0; j < 4; j++) { const ph = (t * 0.16 + j * 0.25) % 1; dots.ellipse(x + (j % 2 ? 1 : -1) * tile * 0.66, y + tile * (0.45 - ph * 0.9), Math.max(0.7, tile * 0.018), Math.max(0.9, tile * 0.025)).fill({ color: 0xffd188, alpha: 0.28 * Math.sin(ph * Math.PI) }); } }, where);
  } else if (pal === 'violet') {
    const x = (p.x + 1) * tile, y = (p.y + 0.86) * tile, r = tile * 0.82;
    c.addChild(glowSprite(x, y, r, r, 0xd0c8ff, 0.22), dots);
    animate(dots, (t, sight) => { if (!shown(sight)) return; for (let n = 0; n < 4; n++) { const a = n * Math.PI * 0.5 + t * 0.22; dots.ellipse(x + Math.cos(a) * tile * 0.49, y + Math.sin(a) * tile * 0.57, Math.max(0.65, tile * 0.014), Math.max(0.7, tile * 0.02)).fill({ color: n % 2 ? 0xf8e9fc : 0xcbeaff, alpha: 0.27 + 0.08 * Math.sin(a + t) }); } }, where);
  } else {
    // Prism: a ring, its floor ellipse and paired marks in the link's colour, seven motes circling.
    const col = hexN(p.pairIndex % 2 ? '#E5BA68' : '#78D5F1'), x = (p.x + w * 0.5) * tile, y = (p.y + h * 0.43) * tile, rad = tile * Math.min(w, h) * 0.6;
    const ring = new Graphics();
    ring.ellipse(x, y, tile * w * 0.21, tile * h * 0.29).fill({ color: col, alpha: 0.2 });
    ring.ellipse(x, y, tile * w * 0.22, tile * h * 0.3).stroke({ color: col, width: Math.max(1, tile * 0.027) });
    ring.ellipse(x, (p.y + h * 0.93) * tile, tile * w * 0.49, tile * h * 0.085).stroke({ color: col, width: Math.max(1, tile * 0.027), alpha: 0.86 });
    for (const side of [-1, 1]) { const rx = x + side * tile * w * 0.53, ry = (p.y + h * 0.92) * tile; ring.poly([rx, ry - tile * 0.07, rx + tile * 0.04, ry, rx, ry + tile * 0.07, rx - tile * 0.04, ry]).fill({ color: col }); }
    c.addChild(glowSprite(x, y, rad, rad, 0xdbf8ff, 0.42), ring, dots);
    animate(dots, (t, sight) => { if (!shown(sight)) return; for (let j = 0; j < 7; j++) { const a = t * 0.48 + j * Math.PI * 2 / 7; dots.circle(x + Math.cos(a) * tile * w * 0.19, y + Math.sin(a) * tile * h * 0.26, Math.max(0.7, tile * 0.023)).fill({ color: j % 3 ? 0xf4e4be : col, alpha: 0.5 + 0.3 * Math.sin(a + t) }); } }, where);
  }
  return c;
}
/** chaos-preview-render.js drawVoid and drawRotFumes: what moves over a mixed Realm floor. Rot islands shed spores into
 *  the void near them and breathe low fumes over their ground; Cinder focals send up embers. Shared clock, still positions. */
export function voidLife(floor, tile) {
  const ch = floor.chaos, W = floor.w, H = floor.h, seed = floor.seed ?? 0, c = new Container(), g = new Graphics();
  const land = (x, y) => x >= 0 && y >= 0 && x < W && y < H && ch.regionOf[y * W + x] >= 0;
  const puffs = [], embers = [], spores = [], rotCells = [];
  ch.regions.forEach((r, i) => {
    if (r.palette === 'rot') for (let k = 0; k < W * H; k++) if (ch.regionOf[k] === i && !wallish(floor.tiles[k])) rotCells.push(k);
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let k = 0; k < W * H; k++) if (ch.regionOf[k] === i) { const x = k % W, y = (k / W) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const mb = { x: Math.max(0, x0 - 4), y: Math.max(0, y0 - 3), r: Math.min(W, x1 + 5), b: Math.min(H, y1 + 7) };
    if (r.palette === 'rot') {
      for (let n = 0; n < 45; n++) { const wx = noise(n, 41, seed) * W, wy = noise(n, 42, seed) * H; if (wx >= mb.x && wx < mb.r && wy >= mb.y && wy < mb.b && !land(Math.floor(wx), Math.floor(wy))) spores.push({ wx, wy, n }); }
      const rotGround = (x, y) => land(x, y) && ch.regionOf[y * W + x] === i && !wallish(floor.tiles[y * W + x]);
      const spots = [];
      for (const p of ch.pools ?? []) if (p.region === r.id) spots.push([p.x + p.w * 0.5, p.y + p.h * 0.5, 1.25], [p.x + p.w * 0.2, p.y + p.h * 0.85, 0.85]);
      for (let n = 0; n < 12; n++) spots.push([x0 + noise(n, 61, seed) * (x1 - x0 + 1), y0 + noise(n, 62, seed) * (y1 - y0 + 1), 0.8]);
      for (const sp of spots) if (rotGround(Math.floor(sp[0]), Math.floor(sp[1]))) { const s = glowSprite(0, 0, 1, 1, 0xa8cc58, 0.2); puffs.push({ s, sp, k: puffs.length }); }
    }
    if (r.palette === 'cinder') for (const p of floor.props) if (!p.part && p.region === r.id && /^cinder-(furnace|anvil|shields)$/.test(p.art ?? '')) embers.push(p);
  });
  // CH-R8 (chaos-preview-render.js:363-386): the fumes lie only on Rot ground in sight. The puffs sit under a mask of
  // the visible open Rot cells, rebuilt when the sight changes, and a puff whose own cell is out of sight is not drawn.
  const fumes = new Container(), fumeMask = new Graphics();
  // A floor with no Rot island has no puffs, and Pixi's addChild() with nothing to add throws.
  if (puffs.length) { fumes.addChild(...puffs.map(p => p.s), fumeMask); fumes.mask = fumeMask; }
  // Item 185 (Justin 2026-10-19: "we did chasms better in the caverns"): the Caverns' floating debris in the void within
  // two of the land, by their rule (cave-terrain.js chasmDebris), bobbing as theirs do.
  const debris = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let near = false;
    for (let oy = -2; oy <= 2 && !near && !land(x, y); oy++) for (let ox = -2; ox <= 2; ox++) if (land(x + ox, y + oy)) { near = true; break; }
    const m = near ? chasmDebris(x, y, tile) : null;
    if (m) { c.addChild(m.s); debris.push(m); }
  }
  c.addChild(fumes, g);
  let sightKey = -1;
  const see = i => inSight(floor, i);
  // CH-R9: under reduced motion the fumes hold still (t = 0), the spores and embers are not drawn (1.7 returns early).
  return animate(c, now => {
    const still = reduced(), t = still ? 0 : now;
    for (const m of debris) debrisBob(m, now, tile, still);
    if (puffs.length) {
      let key = rotCells.length;
      for (const i of rotCells) if (see(i)) key = (Math.imul(key, 31) + i + 1) | 0;
      if (key !== sightKey) {
        sightKey = key; fumeMask.clear();
        let any = false;
        for (const i of rotCells) if (see(i)) { fumeMask.rect((i % W) * tile, ((i / W) | 0) * tile, tile, tile); any = true; }
        if (any) fumeMask.fill({ color: 0xffffff });
        fumes.visible = any;
      }
    }
    for (const { s, sp, k } of puffs) {
      s.visible = see(Math.floor(sp[1]) * W + Math.floor(sp[0]));
      if (!s.visible) continue;
      const x = sp[0] + Math.sin(t * 0.07 + k * 1.9) * 0.45, y = sp[1] + Math.cos(t * 0.05 + k * 1.3) * 0.28, w = tile * (2.1 + 0.5 * Math.sin(t * 0.11 + k)) * sp[2];
      s.position.set(x * tile, y * tile); s.width = w; s.height = w * 0.62; s.alpha = (0.2 + 0.08 * Math.sin(t * 0.13 + k * 2.1)) * sp[2];
    }
    g.clear();
    if (still) return;
    for (const { wx, wy, n } of spores) if (see(Math.floor(wy) * W + Math.floor(wx))) g.ellipse(wx * tile + Math.sin(t * 0.15 + n) * tile * 0.05, wy * tile - Math.sin(t * 0.2 + n) * tile * 0.12, Math.max(0.65, tile * 0.019), Math.max(0.65, tile * 0.023)).fill({ color: n % 3 ? 0xc4e9a9 : 0xf3d98f, alpha: 0.16 + 0.1 * Math.sin(t * 0.4 + n) });
    for (const p of embers) if (footprint(floor, p.x, p.y, p.w ?? 1, p.h ?? 1).some(see)) for (let n = 0; n < 4; n++) {
      const ph = (t * 0.18 + n * 0.27 + noise(p.x, n, seed)) % 1;
      g.ellipse((p.x + (p.w ?? 1) * 0.5) * tile + (noise(n, p.y, seed) - 0.5) * tile, (p.y + 0.45 - ph * 0.8) * tile, Math.max(0.7, tile * 0.016), Math.max(0.9, tile * 0.023)).fill({ color: n % 2 ? 0xffe0a0 : 0xff9b49, alpha: Math.sin(ph * Math.PI) * 0.48 });
    }
  });
}
/**
 * planeterrain.js drawVeinGlints on mixed Chaos terrain (:1136-1140, PT14): brief catches of light on the veins of the
 * Rot and Violet islands' rock within 2 of their open floor, each in its island's vein colours (veinHot to vein), on
 * remembered cells, added light. The raster's salt, so they sit on the veins it painted. None under reduced motion.
 */
export function chaosGlints(floor, tile) {
  const ch = floor.chaos, W = floor.w, H = floor.h, salt = motionSalt(floor);
  const mat = (x, y) => { const p = ch.regions[ch.regionOf[y * W + x]]?.palette; return p === 'rot' || p === 'violet' ? ROCK[p] : null; };
  const wall = (x, y) => x < 0 || y < 0 || x >= W || y >= H || wallish(floor.tiles[y * W + x]) || ch.regionOf[y * W + x] < 0;
  const near = (x, y) => { for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) if (!wall(x + ox, y + oy)) return true; return false; };
  const glints = [], rgb = a => (a[0] << 16) | (a[1] << 8) | a[2];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const M = wallish(floor.tiles[y * W + x]) ? mat(x, y) : null;
    if (!M || !near(x, y) || !veinAt(x, y, salt)) continue;
    glints.push({ i: y * W + x, x: x + 0.2 + hash2(x, y, salt + 62) * 0.6, y: y + 0.25 + hash2(x, y, salt + 63) * 0.5, ph: hash2(x, y, salt + 64), sp: 0.07 + hash2(x, y, salt + 65) * 0.1, hot: rgb(M.veinHot), vein: rgb(M.vein) });
  }
  if (!glints.length) return null;
  const g = new Graphics(); g.blendMode = 'add';
  return animate(g, t => {
    g.clear();
    if (reduced()) return;
    for (const q of glints) {
      const ph = (t * q.sp + q.ph) % 1;
      if (ph > 0.16 || !known(floor, q.i)) continue;   // a brief catch of light, then dark for a while
      const k = Math.sin(ph / 0.16 * Math.PI), px = q.x * tile, py = q.y * tile;
      g.circle(px, py, tile * 0.16).fill({ color: q.vein, alpha: 0.12 * k });
      g.circle(px, py, tile * 0.08).fill({ color: q.hot, alpha: 0.3 * k });
      g.rect(px - 0.5, py - 0.5, Math.max(1, tile * 0.04), Math.max(1, tile * 0.04)).fill({ color: 0xfffcf0, alpha: 0.45 * k });
    }
  });
}
const ribbons = [];
/** A strand's fade along its length (chaos-current-render.js:56): the wide layer 0.16, 0.09 at 0.56, gone at the end;
 *  the fine layer 0.95, 0.72, gone. White, tinted per strand. */
function ribbonTexture(layer) {
  if (ribbons[layer]) return ribbons[layer];
  const c = document.createElement('canvas'); c.width = 128; c.height = 8;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 128, 0), [a0, a1] = layer ? [0.95, 0.72] : [0.16, 0.09];
  gr.addColorStop(0, `rgba(255,255,255,${a0})`); gr.addColorStop(0.56, `rgba(255,255,255,${a1})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 1, 128, 6);
  g.globalAlpha = 0.5; g.fillRect(0, 0, 128, 1); g.fillRect(0, 7, 128, 1);   // a soft edge across, as the canvas stroke's
  return (ribbons[layer] = Texture.from({ resource: c, scaleMode: 'linear' }));
}
let poolTex = null;
/** CH-R7 (chaos-current-render.js:49-51): the boarding square's shallow pool, 1.7's round gradient from a pale white cyan
 *  (207,255,255 at .72) through cyan (89,215,242 at .26, two fifths out) to a deep clear blue, cut to its flat ellipse. */
function boardingPool() {
  if (poolTex) return poolTex;
  const U = 100, c = document.createElement('canvas'); c.width = 1.64 * U; c.height = 0.98 * U;
  const g = c.getContext('2d'), cx = c.width / 2, cy = c.height / 2, r = g.createRadialGradient(cx, cy, 0.04 * U, cx, cy, 0.8 * U);
  r.addColorStop(0, 'rgba(207,255,255,.72)'); r.addColorStop(0.4, 'rgba(89,215,242,.26)'); r.addColorStop(1, 'rgba(107,150,246,0)');
  g.fillStyle = r; g.beginPath(); g.ellipse(cx, cy, 0.82 * U, 0.49 * U, 0, 0, Math.PI * 2); g.fill();
  return (poolTex = Texture.from(c));
}
/** chaos-current-render.js draw: a pool of light on the boarding square and long ribbons away through the void. */
export function current(floor, cur, tile) {
  const dx = Number.isFinite(cur.dx) ? cur.dx : 1, dy = Number.isFinite(cur.dy) ? cur.dy : 0, cx = (cur.x + 0.5) * tile, cy = (cur.y + 0.58) * tile;
  const c = new Container(), g = new Graphics();
  const pool = new Sprite(boardingPool()); pool.anchor.set(0.5); pool.position.set(cx, cy); pool.width = tile * 1.64; pool.height = tile * 0.98;
  c.addChild(pool, g);
  const RGB = [0xbc9aff, 0x61dff8, 0xdafcff];
  const point = (q, strand, t) => { const sway = Math.sin(q * 5.5 - t * 1.6 + strand * 0.65) * (0.07 + q * 0.18), spread = (strand - 3) * 0.055; return [cx + tile * (dx * q * 3.7 - dy * (sway + spread)), cy + tile * (dy * q * 3.7 + dx * (sway + spread) - q * q * 0.6)]; };
  // CH-R6 (chaos-current-render.js:54-60): each strand is one smooth ribbon fading along its length (1.7 strokes one
  // gradient path), drawn as a rope over the strand's 29 points with the fade in its picture; the wide soft layer under
  // the fine bright one.
  const ropes = [];
  for (let layer = 0; layer < 2; layer++) for (let strand = 0; strand < 7; strand++) {
    const pts = Array.from({ length: 29 }, () => new Point()), rope = new MeshRope({ texture: ribbonTexture(layer), points: pts });
    const width = tile * (layer ? 0.025 : 0.11), geo = rope.geometry;
    rope.onRender = () => { geo._width = width; geo.update(); };   // its thickness in map pixels, not the picture's height
    rope.tint = RGB[strand % 3];
    c.addChildAt(rope, c.children.length - 1); ropes.push({ pts, strand });
  }
  // CH-R9 (chaos-current-render.js:40): out of sight or under reduced motion the ribbons hold still (t = 0).
  animate(g, t => {
    g.clear();
    for (const r of ropes) r.pts.forEach((p, n) => { const [x, y] = point(n / 28, r.strand, t); p.set(x, y); });
    for (let i = 0; i < 15; i++) {
      const q = (i * 0.173 + t * 0.3) % 1, p = point(q, i % 7, t), size = tile * (0.025 + 0.018 * Math.sin(q * Math.PI));
      g.poly([p[0], p[1] - size * 1.8, p[0] + size, p[1], p[0], p[1] + size * 1.8, p[0] - size, p[1]]).fill({ color: i % 3 === 0 ? 0xd6bcff : 0xe5ffff, alpha: Math.sin(q * Math.PI) * 0.9 });
    }
  }, { floor, cells: footprint(floor, cur.x, cur.y) });
  return c;
}
