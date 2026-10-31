// The Caverns on the map: the rock and ground (the GPU surface, cave-surface.js, painted from the shape field) and, over
// it, what 1.7 draws from art on a cave floor (js/presentation/render/cavernrender.js, chasmedges.js @3c8b312):
// - chasms: the delivered lip art (ch-lip-top, ch-lip-side, ch-corner) round every edge, floating debris;
// - rope bridges, planks across the rift;
// - wall features (wf-*) hung on cliff faces, the waterfall (no decals on the floor: item 204);
// - cave pieces (environment-props-cave) at their natural size: standing on their footprint, clusters flat;
// - motion: debris drifting, glowworms breathing, drapery dripping, the waterfall shimmering.
// Every pick is a hash of the cell, so nothing moves between frames or visits.

import { Assets, Container, Graphics, Rectangle, Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import { sheet, hasSheet } from './art-store.js';
import { T } from '../data/tiles.js';
import { hash2, surfaceSalt } from '../lib/noise.js';
import { buildCaveSurface } from './cave-surface.js';
import { trimmed, propFit } from './art.js';
import { CAVE_ROCK } from '../data/rock.js';

const TC = 8;
// The dark beyond the rock: the cave material's void (data/rock.js CAVE_ROCK; it held edge and lip too, unread).
const VOID = (CAVE_ROCK.void[0] << 16) | (CAVE_ROCK.void[1] << 8) | CAVE_ROCK.void[2];
const CAVE = 'environment-props-cave';

/** A cave piece's picture (environment-props-cave, then the older map-cave sheet). */
export function caveArt(name) {
  if (hasSheet(CAVE)) { const t = sheet(CAVE).textures[`cave/${name}`]; if (t) return t; }
  if (hasSheet('map-cave')) { const t = sheet('map-cave').textures[name]; if (t) return t; }
  return null;
}
/**
 * CV3 (1.7 chasmsmooth.js drawCaveChasms): the floating debris a chasm cell (x, y) holds: on 16% of cells, at a random
 * spot, flipped half the time, 0.85; {s, y0, seed}, or null. It bobs by debrisBob. The Realm's void beside its islands
 * holds the same (realm-life.js, item 185).
 */
export function chasmDebris(x, y, tile) {
  const hd = hash2(x, y, 701), d = hd < 0.16 ? caveArt(`ch-floating-debris-${1 + Math.floor(hash2(x, y, 703) * 3)}`) : null;
  if (!d) return null;
  const t = trimmed(d), w = tile * 0.6, h = w * d.frame.height / d.frame.width, s = new Sprite(t);
  s.width = w; s.height = h; s.alpha = 0.85;
  s.position.set(x * tile + tile * (0.25 + 0.5 * hash2(x, y, 704)) - w / 2, y * tile + tile * (0.55 + 0.3 * hash2(x, y, 705)) - h);
  if (hash2(x, y, 706) < 0.5) { s.scale.x *= -1; s.x += w; }
  return { s, y0: s.y, seed: hd * 40 };
}
/** 1.7's bob for a piece of chasm debris at time t (seconds); still under reduced motion. */
export const debrisBob = (m, t, tile, reduced) => { m.s.y = m.y0 + (reduced ? 0 : Math.sin(t * 0.9 + m.seed) * tile * 0.04); };

/** A wall feature or decal at its natural size: the picture and how many of its pixels make a tile (64 on map-cave). */
function caveArtSized(name) {
  if (hasSheet(CAVE)) { const t = sheet(CAVE).textures[`cave/${name}`]; if (t) return { tex: t, ppt: sheet(CAVE).data.meta?.pixelsPerTile ?? 128 }; }
  if (hasSheet('map-cave')) { const t = sheet('map-cave').textures[name]; if (t) return { tex: t, ppt: 64 }; }
  return null;
}
// Rope bridges (1.7 caveBridgeFrames): the recovered painted wood-and-rope master, a long continuous bridge cut into
// four quarter sections so each tile keeps the planks' proportions; until it arrives the drawn bridge stands in.
const BRIDGE_ART = 'assets/sheets/cave-bridge-master.webp';
let bridgeFrames = null, bridgeLoading = null;
function loadBridgeFrames() {
  bridgeLoading ??= Assets.load(BRIDGE_ART).then(t => (bridgeFrames = [0, 1, 2, 3].map(k => new Texture({ source: t.source, frame: new Rectangle(k * 313.5, 504, 313.5, 272) })))).catch(() => null);
  return bridgeLoading;
}

const SIZE = { 'stalagmite-group': [2, 1], 'mushroom-pair': [2, 1], geode: [2, 1], 'mine-support': [2, 1], 'worm-burrow': [2, 2] };
const footprint = id => SIZE[id.replace(/-(\d|closed|open)$/, '')] ?? [1, 1];
/** Is this a cave piece (drawn here, not by structures.js's own fit)? */
export const isCavePiece = id => /^(cl-|wf-|stalagmite-(tall|group)|giant-mushroom|mushroom-pair|geode|pylon-|mine-(cart|support)|worm-burrow|kobold-)/.test(id);
/** The load group a floor's cave pieces draw from (assets/manifest.json 'chasm', loaded on demand): a Dungeon, Crypt or
 *  Underdark camp's kobold campfire and crate stood, blocking, with no picture (item 168). [] with no cave piece. */
export const cavePieceArt = floor => ((floor?.props ?? []).some(p => isCavePiece(p.id)) ? ['chasm'] : []);

/**
 * A cave piece standing on its footprint (bottom centre on the footprint's bottom centre, tall art rising above),
 * a cluster flat in its tile. Returns null when the art is missing.
 */
export function caveSprite(p, tile) {
  if (p.part || /^cl-cave-pearls-[1-4]$/.test(p.id)) return null;
  const tex = caveArt(p.id);
  if (!tex) return null;
  // 1.7 caveArtScale: 64 px of art a tile (the sheet holds 128 px a tile), crystals at half, pylons and big mushrooms
  // smaller (the row's fit.cave, art.js propFit).
  const t = trimmed(tex), [w, h] = footprint(p.id), s = (tile / 128) * propFit(p.id).cave;
  const sp = new Sprite(t);
  sp.width = t.frame.width * s; sp.height = t.frame.height * s;
  const cx = (p.x + w / 2) * tile, flat = p.id.startsWith('cl-') || /^kobold-(bedroll|pickaxe)/.test(p.id);
  // 1.7 drawCaveProp: every piece but a burrow or a mine support flips on hash2(x, y, 5), flat or standing.
  const flip = !/burrow|mine-support/.test(p.id) && hash2(p.x, p.y, 5) < 0.5;
  if (p.id === 'kobold-crate') {
    // 1.7 drawCaveSprite: the crate fits 0.68 x 0.74 of a tile, standing on its tile.
    const cs = Math.min(tile * 0.68 / t.frame.width, tile * 0.74 / t.frame.height);
    sp.width = t.frame.width * cs; sp.height = t.frame.height * cs;
    sp.anchor.set(0.5, 1); sp.position.set(cx, (p.y + 1) * tile - tile * 0.02);
  } else if (flat) {
    // A flat piece (each 1 x 1) centres its whole canvas on the tile, padding and all (1.7: "a half-size crystal must not
    // retain the old full-size half-height and drift toward the tile below it"), so the art keeps its place in it.
    const tr = tex.trim, ow = tex.orig.width * s, oh = tex.orig.height * s, left = (p.x + 0.5) * tile - ow / 2 + (tr?.x ?? 0) * s;
    sp.position.set(flip ? 2 * (p.x + 0.5) * tile - left : left, (p.y + 0.5) * tile - oh / 2 + (tr?.y ?? 0) * s);
  } else { sp.anchor.set(0.5, 1); sp.position.set(cx, (p.y + h) * tile - tile * 0.02); }
  if (flip) sp.scale.x *= -1;
  sp.flat = flat;
  return sp;
}

/**
 * @param {{w:number,h:number,tiles:number[],caveDeco?:any}} floor
 * @returns {Container & {cull:(x0:number,y0:number,x1:number,y1:number)=>void}}
 */
export function buildCaveTerrain(floor, tile, run = {}) {
  const root = new Container(), W = floor.w, H = floor.h;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? T.WALL : floor.tiles[y * W + x]);
  const salt = surfaceSalt(run.seed, run.floorNo ?? 11);
  const chunks = [];
  const chunkOf = (x, y) => {
    const cx = Math.floor(x / TC), cy = Math.floor(y / TC), k = cy * Math.ceil(W / TC) + cx;
    if (!chunks[k]) { const c = new Container(); c.box = [cx * TC * tile, (cy * TC - 1) * tile, (cx + 1) * TC * tile, (cy + 1) * TC * tile + tile]; chunks[k] = c; root.addChild(c); }
    return chunks[k];
  };
  const put = (tex, x, y, px, py, w = tile, h = tile, tint = 0xffffff, alpha = 1) => {
    if (!tex) return null;
    const s = new Sprite(tex); s.position.set(px, py); s.width = w; s.height = h; s.tint = tint; if (alpha < 1) s.alpha = alpha;
    chunkOf(x, y).addChild(s); return s;
  };
  const fill = (x, y, px, py, w, h, color, alpha = 1) => { chunkOf(x, y).addChild(new Graphics().rect(px, py, w, h).fill({ color, alpha })); };
  const hanging = new Container();   // hanging cave stone, over the chunks (each sprite's .hang: its wall cell)
  const motion = [];   // what moves (1.7 cavernrender.js and objanim.js): debris, glowworms, drips, the waterfall, water
  // The rock and the ground: the GPU surface from the shape field (cave-surface.js), under everything drawn here.
  const surface = buildCaveSurface(floor, tile, run);
  root.addChildAt(surface, 0);
  // The ground paint (moss, blood, the chasms' edges and void: ground-paint.js) goes on root.liquids, over the surface and
  // under everything drawn here, as terrain.js lays it: over the chunks it painted the void across the bridges (item 219,
  // Justin 2026-10-19: "idge doesn't show in caverns (bridge)").
  root.liquids = new Container(); root.addChild(root.liquids);
  // Floating debris drifting in the dark of the chasms.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const m = at(x, y) === T.CHASM ? chasmDebris(x, y, tile) : null;
    if (m) { chunkOf(x, y).addChild(m.s); motion.push({ k: 'debris', ...m }); }
  }
  // CV1: the chasm's edges are drawn in code by the ground paint (ground-paint.js chasmRaster, 1.7 chasmsmooth.js); 1.7 retired
  // the stamped lip art (2026-09-19: each piece carried its own patch of ground, the joins showed as squares).
  // Rope bridges (1.7 drawCaveBridge): the painted sections, turned for a north-south span; drawn planks until they load.
  const land = (x, y) => { const t = at(x, y); return t !== T.CHASM && t !== T.BRIDGE && t !== T.WALL && t !== T.SECRET; };
  const bridges = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (at(x, y) !== T.BRIDGE) continue;
    const px = x * tile, py = y * tile, br = (xx, yy) => at(xx, yy) === T.BRIDGE;
    const ew = land(x - 1, y) || br(x - 1, y) || land(x + 1, y) || br(x + 1, y), ns = land(x, y - 1) || br(x, y - 1) || land(x, y + 1) || br(x, y + 1);
    const horiz = ew && !(ns && !(br(x - 1, y) || br(x + 1, y)));
    fill(x, y, px, py, tile, tile, VOID);
    const c = new Container();
    c.position.set(px + tile / 2, py + tile / 2); if (!horiz) c.rotation = Math.PI / 2;
    const b = { c, x, y, horiz, ends: horiz ? [land(x - 1, y), land(x + 1, y)] : [land(x, y - 1), land(x, y + 1)] };
    if (bridgeFrames) paintedBridge(b, tile); else c.addChild(drawnBridge(b, tile));
    chunkOf(x, y).addChild(c); bridges.push(b);
  }
  if (bridges.length && !bridgeFrames) loadBridgeFrames().then(f => { if (!f) return; for (const b of bridges) if (!b.c.destroyed) { b.c.removeChildren().forEach(o => o.destroy()); paintedBridge(b, tile); } });
  // A piece of art at its natural size (1.7 drawCaveWalls). No decals lie on the floor (item 204).
  const natural = (art, left, top, x, y, alpha = 1) => {
    const { tex, ppt } = art, k = tile / ppt, tr = tex.trim;
    return put(trimmed(tex), x, y, left + (tr?.x ?? 0) * k, top + (tr?.y ?? 0) * k, tex.frame.width * k, tex.frame.height * k, 0xffffff, alpha);
  };
  // Wall features hang at their natural size (1.7 drawCaveWalls): stalactite caps raised a third of a tile into the
  // rock overhang, the waterfall on its basin anchor; fossils are dropped (Justin 2026-09-22); a glowworm curtain is
  // drawn as thin bent strands with breathing dots, never its picture.
  const drapeTip = new Map();
  for (const w of floor.caveDeco?.walls ?? []) {
    if (/^wf-fossil/.test(w.n)) continue;
    if (/^wf-glowworm-curtain/.test(w.n)) { glowwormStrands(w, tile, chunkOf(w.x, w.y)); continue; }
    const a = caveArtSized(w.n); if (!a) continue;
    const k = tile / a.ppt, tr = a.tex.trim;
    let s;
    if (w.fall) s = natural(a, w.x * tile, w.y * tile, w.x, w.y);
    else {
      // Hanging stone (drapery, stalactites) stands apart from the rock it hangs on: its own layer, root.hanging, so
      // the light layer can light it as 1.7 does, an upright card facing south (cavernrender.js:189-195, lighting RB6).
      s = new Sprite(trimmed(a.tex)); s.position.set(w.x * tile + (tr?.x ?? 0) * k, w.y * tile - tile * 0.3); s.width = a.tex.frame.width * k; s.height = a.tex.frame.height * k;
      s.hang = { x: w.x, y: w.y }; hanging.addChild(s);
    }
    if (s && !w.fall) drapeTip.set(w, s.y + s.height * 0.92);
  }
  // Motion: glowworm curtains breathing, drops gathering on drapery, the waterfall's shimmer. No marks are drawn on the
  // water (item 203, Justin 2026-10-19: "can we drop these weird marks in the water").
  const dot = (x, y, px, py, w, h, color) => { const s = new Sprite(Texture.WHITE); s.position.set(px, py); s.width = w; s.height = h; s.tint = color; chunkOf(x, y).addChild(s); return s; };
  for (const w of floor.caveDeco?.walls ?? []) {
    const px = w.x * tile, py = w.y * tile;
    if (/^wf-glowworm-curtain/.test(w.n)) for (let k = 0; k < 8; k++) for (let j = 1; j <= 3; j++) {
      const len = tile * (0.25 + hash2(w.x, w.y, 850 + k) * 0.5), bend = tile * (hash2(w.x, w.y, 880 + k) - 0.5) * 0.09, u = Math.max(1, tile * 0.024);
      const s = dot(w.x, w.y, px + tile * (0.14 + k * 0.1) + bend * j / 3 - u / 2, py + tile * 0.12 + len * j / 3, u, u, /-2$/.test(w.n) ? 0xc5b978 : 0x80cbb0);
      motion.push({ k: 'glowworm', s, phase: k * 2 + j });
    }
    if (/^wf-stalactite-drapery/.test(w.n) && drapeTip.has(w)) for (let i = 0; i < 2; i++) {
      const s = dot(w.x, w.y, px + tile * (0.3 + 0.4 * hash2(w.x, w.y, 870 + i)), drapeTip.get(w), Math.max(1, tile / 32), Math.max(2, tile / 16), 0x9fd8ff);
      motion.push({ k: 'drip', s, y0: s.y, period: 2.4 + hash2(i, w.x * 7 + w.y, 3) * 2.5, off: hash2(i, w.x * 7 + w.y, 4) });
    }
    if (w.fall) { const s = dot(w.x, w.y, px + tile * 0.46, py, tile * 0.08, tile * 0.18, 0xbff6ff); s.blendMode = 'add'; motion.push({ k: 'fall', s, y0: py }); }
  }
  root.anims = [(now, reduced) => {
    const t = now / 1000;
    for (const m of motion) {
      if (m.k === 'debris') { debrisBob(m, t, tile, reduced); continue; }
      if (m.k === 'glowworm') { m.s.alpha = reduced ? 1 : 0.8 + 0.2 * Math.sin(now / 750 + m.phase); continue; }
      if (m.k === 'drip') { const ph = reduced ? 1 : (t / m.period + m.off) % 1; m.s.alpha = ph > 0.35 ? 0 : (1 - ph / 0.35 * 0.6) * 0.9; m.s.y = m.y0 + (ph / 0.35) ** 2 * tile * 0.9; continue; }
      if (m.k === 'fall') { m.s.alpha = reduced ? 0 : 0.35; m.s.y = m.y0 + tile * (0.35 + ((t * 1.6) % 1) * 1.1); }
    }
  }];
  for (const m of motion) if (m.k === 'drip') hanging.addChild(m.s);   // drops gather at the drapery's tip, over it
  root.addChild(hanging); root.hanging = hanging;
  root.kindsField = surface.kindsField;   // relief lights from the same outline the surface is painted from
  root.accentField = surface.accentField;   // and the mineral veins give their own light (1.7's accent)
  root.cull = (x0, y0, x1, y1, d) => {
    // d: the screen's density, for the surface's chunk cache (sandbox 55)
    surface.cull(x0, y0, x1, y1, d); for (const c of chunks) if (c) c.visible = c.box[2] > x0 && c.box[0] < x1 && c.box[3] > y0 && c.box[1] < y1;
    for (const h of hanging.children) h.visible = h.x + h.width > x0 && h.x < x1 && h.y + h.height > y0 && h.y < y1; };
  return root;
}


/** 1.7 drawGlowwormCurtain's strands: eight thin threads hanging from the cave roof, each bent a little (the dots that breathe on them are motion). */
function glowwormStrands(w, tile, into) {
  const g = new Graphics(), px = w.x * tile, py = w.y * tile, warm = /-2$/.test(w.n);
  for (let k = 0; k < 8; k++) {
    const x = px + tile * (0.14 + k * 0.1), y = py + tile * 0.12, len = tile * (0.25 + hash2(w.x, w.y, 850 + k) * 0.5), bend = tile * (hash2(w.x, w.y, 880 + k) - 0.5) * 0.09;
    g.moveTo(x, y).quadraticCurveTo(x + bend, y + len * 0.5, x + bend, y + len);
  }
  g.stroke({ color: warm ? 0x706340 : 0x405d50, width: Math.max(0.6, tile / 90) });
  into.addChild(g);
}

/** One painted section of the bridge master a tile (a quarter of the long span, by position along it). */
function paintedBridge(b, tile) {
  const s = new Sprite(bridgeFrames[(((b.horiz ? b.x : b.y) % 4) + 4) % 4]);
  s.position.set(-tile / 2, -tile / 2 + tile * 16 / 128); s.width = tile; s.height = tile * 96 / 128;
  b.c.addChild(s);
}

/** 1.7 drawCaveBridge's drawn fallback, east-west (the container turns it): five sagging planks, lit at the top and
 *  shaded at the end, gaps and grain, curved rope rails, posts where it meets the ground, and the deck's shadow below. */
function drawnBridge(b, TS) {
  const g = new Graphics(), { x, y } = b, u = TS / 24, d0 = TS * 0.17, d1 = TS * 0.83, n = 5, pw = TS / n;
  g.position.set(-TS / 2, -TS / 2);
  g.rect(0, d1, TS, u * 1.5).fill({ color: 0x000000, alpha: 0.55 });
  const woods = [0x7a5634, 0x6b4a2c, 0x845e3a, 0x71502f];
  for (let k = 0; k < n; k++) {
    const hx = hash2(x * 5 + k, y, 811), sag = Math.round((hash2(x, y * 3 + k, 813) - 0.5) * u * 1.4);
    const x0 = Math.round(k * pw) + (k ? 0.5 : 0), x1 = Math.round((k + 1) * pw) - 0.5;
    g.rect(x0, d0 + sag, x1 - x0, d1 - d0).fill({ color: woods[Math.floor(hx * woods.length)] });
    g.rect(x0, d0 + sag, x1 - x0, u * 0.8).fill({ color: 0xffe6be, alpha: 0.18 });
    g.rect(x0, d1 + sag - u * 0.8, x1 - x0, u * 0.8).fill({ color: 0x000000, alpha: 0.35 });
    g.rect(x1, d0 + sag, 1, d1 - d0).fill({ color: 0x000000, alpha: 0.5 });
    if (hash2(x, y, 815 + k) < 0.5) g.rect(x0 + (x1 - x0) * 0.45, d0 + sag + (d1 - d0) * 0.2, 1, (d1 - d0) * 0.5).fill({ color: 0x1e140c, alpha: 0.6 });
  }
  for (const r of [d0 - u * 0.5, d1 + u * 0.5]) {
    g.moveTo(0, r).quadraticCurveTo(TS / 2, r + u * 1.2, TS, r).stroke({ color: 0x3a2a18, width: Math.max(1.5, u * 1.4), cap: 'round' });
    g.moveTo(0, r - u * 0.2).quadraticCurveTo(TS / 2, r + u, TS, r - u * 0.2).stroke({ color: 0xc8a870, width: Math.max(1, u * 0.7), cap: 'round' });
  }
  for (const [on, ex] of [[b.ends[0], 0], [b.ends[1], TS - u * 3]]) {
    if (!on) continue;
    for (const py of [d0 - u * 2.2, d1 - u * 0.6]) { g.rect(ex, py, u * 3, u * 3.2).fill({ color: 0x2a1e12 }); g.rect(ex + u * 0.6, py + u * 0.4, u * 1.6, u * 1.2).fill({ color: 0x8a6a44 }); }
  }
  return g;
}
