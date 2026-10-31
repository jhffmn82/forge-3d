// The Dungeon's floor and walls as 1.7 draws them today (js/presentation/render/surface.js masonry tiles and wall
// edges, js/world/terrain/environment-terrain.js sample and MASONRY_RELAY, render.js drawTerrainPass @3c8b312):
// - floor: environment-terrain-dungeon-floor, its stone courses re-laid so joints never stack (Justin, 2026-10-12);
//   a door that is not side-on sits in the wall face, so its tile shows the face art;
// - walls: the face where the tile below is open (and not a side door), else the top; capstone rims and pillar caps
//   by one rule (wallTrim, item 182); the face's art ends in its own thin floor rim (item 189: wall-face-base);
// - wall faces carry a sconce where a wall torch hangs (floor.lights), else now and then a banner or a crack;
// - bare floor gets the stone surface's grit by the walls, a rare drain, a rare crack (surface.js drawStoneSurface).
// An Underdark floor (floor.region) takes each tile's set from its region: temple, underdark or volcanic (1.7
// deeprender.js region surfaces); lava draws from environment-terrain-lava-flow; drains only on temple stone.
// Every pick is a hash of the cell (and the run seed and floor), so nothing moves between frames or visits.
// Drawn in 8 x 8 tile chunks, each cached as a small texture while it is near the camera (cull); the rest are
// neither drawn nor held. No whole-floor texture: the old one was 8192 x 4096 (about 134 MB of GPU memory).

import { Container, Graphics, Sprite, Texture, Rectangle } from '../../../forge-godot/runtime/pixi.js';
import { sheet, hasSheet, onRelease, readable } from './art-store.js';
import { T, isWallTile, WEAR } from '../data/tiles.js';
import { hash2, surfaceSalt } from '../lib/noise.js';
import { buildUnderdarkRaster, emberFloor } from './underdark-raster.js';
import { cryptSconce } from './crypt-look.js';
import { chunkCache } from './chunks.js';
import { wallDecor, RIM } from './wall-decor.js';

export const CHUNK = 16;   // the ground paint's chunk (ground-paint.js)
const TC = 8;              // the terrain's chunk: each is cached as one small texture while it is near the camera
const P = 12;   // SURF_P: cells per repeat of the surfaces' offsets
const DOORISH = new Set([T.DOOR, T.LOCKED, T.TOLL, T.ICE_DOOR, T.THORNS, T.SEALED]);
// environment-terrain.js MASONRY_RELAY: each course [first row, last row + 1, offset, dropped run start, end].
const RELAY = {
  'dungeon-floor': { width: 1792, height: 896, courses: [[52, 168, 0], [168, 278, 1216, 1777.5, 1805.5], [278, 392, 392], [392, 503, 1224], [503, 612, 616], [612, 724, 552], [724, 840, 568], [840, 948, 1784]] },
  // WT1: the Crypt's floor, 8 courses, one sliver dropped (environment-terrain.js:202).
  'crypt-floor': { width: 2048, height: 1024, courses: [[2, 124, 0], [124, 256, 1672], [256, 381, 1800, 2031, 2064], [381, 512, 688], [512, 639, 1640], [639, 764, 1240], [764, 891, 648], [891, 1026, 664]] },
};

/**
 * A seen wall tile's look and capstone trim, as one rule (item 182, Justin 2026-10-19: "i think we need some art at the
 * end of the wall"; "more places where that pilar would help"). A wall shows its face where the tile below is open, else
 * its top. Capstone rims run along each side where it meets open ground, and along a top's side
 * where it meets a face (the wall turns there). Pillar caps sit where rims meet or turn (1.7 surface.js:134-153, its
 * rims on open sides only). A face under a wall top takes the north rim over its art's own coping, so one stone runs
 * along the ledge (Justin 2026-10-19: "can we paint over this with the north facing wall lip?"); a wall one tile thick
 * keeps its coping ("with the stand alone walls it's fine not to do that"). Wherever the next tile is not another face
 * (open ground: a run end or a gap; a wall top: the wall turns, an outer or inner corner, item 194: "these corners
 * should have a join") it ends in a textured stone edge, `end` left, right or both (item
 * 191, Justin 2026-10-19: "it should be joined along the top of the wall and have a textured wall edge"; "we need a
 * block with both sides edge, one with a left edge and one with a right edge"), the ledge wrapping the top. A door is
 * part of its wall (Justin 2026-10-19: "the background of the door frame here needs to blend in"; "the frame should look
 * natural in the wall"): the tile above a front door is a top and the faces beside it run on into its arch; the walls
 * either side of a side door take no ledge or caps against it (its own lintels and caps frame it, buildTerrain).
 * at(x, y): the tile, wall off the map. Returns { face, n, w, e, end, caps: [[right, bottom], ...] }.
 */
export function wallTrim(at, x, y) {
  const wall = (xx, yy) => isWallTile(at(xx, yy)) || DOORISH.has(at(xx, yy)) || at(xx, yy) === T.OPEN_DOOR, open = (xx, yy) => !wall(xx, yy);
  const faces = (xx, yy) => wall(xx, yy) && !wall(xx, yy + 1);
  const face = faces(x, y), oW = open(x - 1, y), oE = open(x + 1, y);
  const n = face ? wall(x, y - 1) : open(x, y - 1), w = !face && (oW || faces(x - 1, y)), e = !face && (oE || faces(x + 1, y)), faceS = faces(x, y + 1), caps = [];
  const endW = face && !faces(x - 1, y), endE = face && !faces(x + 1, y), end = endW && endE ? 'both' : endW ? 'left' : endE ? 'right' : null;
  // A top's caps: where its rims meet or turn (1.7), and wherever a side rim meets a face, at the face's coping beside it
  // (the wall turns) and at its own foot over the face below (carrying on or ending), so the rim reads as one piece
  // round the room (Justin 2026-10-19: "we need one of those square caps over the intersection here"; "this edge needs
  // to be rounded").
  if (!face) {
    if ((n && w) || (!n && !w && open(x - 1, y - 1)) || (w && faces(x - 1, y))) caps.push([0, 0]);
    if ((n && e) || (!n && !e && open(x + 1, y - 1)) || (e && faces(x + 1, y))) caps.push([1, 0]);
    if (w && faceS) caps.push([0, 1]);
    if (e && faceS) caps.push([1, 1]);
    if (!w && !e && faceS && (open(x - 1, y + 1) || open(x + 1, y + 1))) caps.push([open(x - 1, y + 1) ? 0 : 1, 1]);
  }
  // A door's frame takes the corners on its side (buildTerrain; item 196), so none of this wall's caps stands there.
  const door = (xx, yy) => DOORISH.has(at(xx, yy)) || at(xx, yy) === T.OPEN_DOOR;
  return { face, n, w, e, end, caps: caps.filter(([, b]) => !door(x, b ? y + 1 : y - 1)) };
}

const relaid = new WeakMap();   // by picture: a released terrain sheet (assets.js, WT18) takes its re-laid copy with it
onRelease((name, src) => { const t = src && relaid.get(src); if (t) { relaid.delete(src); t.destroy(true); } });   // its canvas and GPU copy too
/** The floor master re-laid course by course (environment-terrain.js relay), once per picture. */
export function relay(tex, key) {
  const table = RELAY[key], src = tex.source;
  if (!table || typeof document === 'undefined' || !readable(src)) return null;   // Never cache a parked texture's blank placeholder.
  const img = src.resource;
  if (src.pixelWidth !== table.width || src.pixelHeight !== table.height) return null;
  if (relaid.has(src)) return relaid.get(src);
  const W = table.width, H = table.height, out = document.createElement('canvas');
  out.width = W; out.height = H;
  const g = out.getContext('2d');
  for (const c of table.courses) {
    const rows = c[1] <= H ? [[c[0], c[1]]] : [[c[0], H], [0, c[1] - H]], cutRun = c.length > 3;
    const start = cutRun ? c[4] % W : 0, length = cutRun ? W - (c[4] - c[3]) : W, scale = W / length;
    g.imageSmoothingEnabled = cutRun; g.imageSmoothingQuality = 'high';
    for (const r of rows) {
      const h = r[1] - r[0];
      [[start, Math.min(W, start + length)], [0, Math.max(0, start + length - W)]].forEach((piece, index) => {
        const w = piece[1] - piece[0]; if (w <= 0) return;
        const x = c[2] + (index ? (W - start) * scale : 0), dw = w * scale;
        g.drawImage(img, piece[0], r[0], w, h, x % W, r[0], dw, h);
        g.drawImage(img, piece[0], r[0], w, h, x % W - W, r[0], dw, h);
      });
    }
  }
  const t = Texture.from(out);
  relaid.set(src, t);
  return t;
}

const DECO_ROW = { prism: 'light', cinder: 'volcanic', violet: 'shadow' };
/** A biome's terrain pieces: cell(key, x, y) -> {tex, dim}, sampled by world position (environment-terrain.js sample). */
function pieces(biome) {
  const S = n => (hasSheet(`environment-terrain-${biome}-${n}`) ? sheet(`environment-terrain-${biome}-${n}`) : null);
  const sets = {};
  for (const n of ['floor', 'face', 'top', 'rim-n', 'rim-v']) {
    const sh = S(n); if (!sh) continue;
    const key = `${biome}-${n}`, k = sh.data.meta.keys[key], any = sh.textures[`${key}/0-0`];
    const base = n === 'floor' ? relay(any, key) ?? (key === 'temple-floor' ? emberFloor(any) : null) : null, cells = new Map();   // the temple's grout glows like cooling lava
    sets[n] = { k, cell(cx, cy) {
      cx = ((cx % k.columns) + k.columns) % k.columns; cy = ((cy % k.rows) + k.rows) % k.rows;
      const id = cy * k.columns + cx;
      if (!cells.has(id)) cells.set(id, base ? new Texture({ source: base.source, frame: new Rectangle(cx * k.cellW, cy * k.cellH, k.cellW, k.cellH) }) : sh.textures[`${key}/${cx}-${cy}`]);
      return { tex: cells.get(id), dim: k.dim ?? 0 };
    } };
  }
  const deco = hasSheet('environment-deco') ? sheet('environment-deco') : null, caps = new Map();
  // WT11 (environment-deco.js palette): the Prism and Cinder islands take the Light and Volcanic rows of the decal sheet.
  const row = DECO_ROW[biome] ?? biome;
  const dress = hasSheet('environment-wall-dressing') ? sheet('environment-wall-dressing') : null;   // items 208, 231: the walls' dressing (wall-decor.js)
  const decal = name => deco?.textures[`${row}/${name}`] ?? deco?.textures[`dungeon/${name}`] ?? dress?.textures[`wall/${name}`] ?? null;
  const cap = () => {
    if (!deco) return null;
    if (!caps.has(biome)) { const c = decal('cap'), m = deco.data.meta.cap; caps.set(biome, c ? new Texture({ source: c.source, frame: new Rectangle(c.frame.x + m.x, c.frame.y + m.y, m.w, m.h) }) : null); }
    return caps.get(biome);
  };
  return { sets, decal, cap };
}

/**
 * @param {{w:number,h:number,tiles:number[],ground?:number[],props?:any[],lights?:any[]}} floor
 * @param {string} biome terrain key prefix, for example 'dungeon'
 * @param {number} tile logical tile size
 * @param {{seed?:number, floorNo?:number}} [run] the run seed and floor number, for the surface's hash picks
 * @returns {Container & {cull:(x0:number,y0:number,x1:number,y1:number)=>void}}
 */
// The open arch each door material shows (structures.js and door-view.js draw it; its opening is measured here): wood's
// and iron's painted open doors, else the art packet's arch (item 176), measured as the bare archway it matches.
const OPEN_ART = { wood: 'door-wood-open', spiked: 'archway', thorns: 'archway', iron: 'door-iron-open', ice: 'archway', crystal: 'archway', crypt: 'archway' };
const apertures = new Map();
/** 1.7 render.js openDoorAperture: each row's clear run between the arch's jambs, in the art's pixels (cached per picture). */
function apertureRows(name) {
  if (apertures.has(name)) return apertures.get(name);
  let rows = null;
  try {
    const tex = hasSheet('environment-props-structures') ? sheet('environment-props-structures').textures[`structures/${name}`] : null;
    if (tex && typeof document !== 'undefined') {
      const f = tex.frame, w = f.width | 0, h = f.height | 0, c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(tex.source.resource, f.x, f.y, w, h, 0, 0, w, h);
      const px = g.getImageData(0, 0, w, h).data, clear = (x, y) => px[(y * w + x) * 4 + 3] < 32, mid = w >> 1;
      rows = { w, h, runs: [] };
      for (let y = 0; y < h; y++) {
        if (!clear(mid, y)) continue;
        let l = mid, r = mid;
        while (l >= 0 && clear(l, y)) l--;
        while (r < w && clear(r, y)) r++;
        if (l >= 0 && r < w) rows.runs.push([y, l + 1, r]);
      }
    }
  } catch { rows = null; }
  apertures.set(name, rows);
  return rows;
}
/** The opening's rows over a tile, [x0, y0, x1, y1], the arch filling its tile as structures.js draws it (fill, on the tile's foot). */
function apertureRects(name, px, py, tile) {
  const a = apertureRows(name); if (!a?.runs.length) return [];
  const s = Math.max(tile / a.w, tile / a.h), ox = px + (tile - a.w * s) / 2, oy = py + tile - a.h * s;
  const rects = a.runs.map(([y, l, r]) => [Math.max(px, ox + l * s), Math.max(py, oy + y * s), Math.min(px + tile, ox + r * s), Math.min(py + tile, oy + (y + 1) * s)])
    .filter(([x0, y0, x1, y1]) => x1 > x0 && y1 > y0);
  // The opening runs down to the floor: the jambs' feet stop short of the foot, where the face's dark foot showed
  // through (Justin 2026-10-19: "now we have a black line at the door opening").
  if (rects.length) rects[rects.length - 1][3] = py + tile;
  return rects;
}
/** The opening as a mask over a tile. */
function doorAperture(name, px, py, tile) {
  const rects = apertureRects(name, px, py, tile); if (!rects.length) return null;
  const g = new Graphics();
  for (const [x0, y0, x1, y1] of rects) g.rect(x0, y0, x1 - x0, y1 - y0);
  return g.fill({ color: 0xffffff });
}

export function buildTerrain(floor, biome, tile, run = {}) {
  const root = new Container();
  const W = floor.w, H = floor.h;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? T.WALL : floor.tiles[y * W + x]);
  const wallish = isWallTile;
  const open = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !wallish(at(x, y));
  const sideDoor = (x, y) => wallish(at(x, y - 1)) && wallish(at(x, y + 1)) && !wallish(at(x - 1, y)) && !wallish(at(x + 1, y));
  const salt = surfaceSalt(run.seed, run.floorNo ?? 1);
  const off = k => Math.floor(hash2(salt, k, 77) * P), smod = v => ((v % P) + P) % P;
  const torch = new Set((floor.lights ?? []).filter(l => l.kind === 'wall-torch' && !l.side).map(l => l.y * W + l.x));
  // D12: a side-wall torch hangs on the wall's inner edge, facing into the room (improve.js sideTorches).
  const sideTorch = new Map((floor.lights ?? []).filter(l => l.kind === 'wall-torch' && l.side).map(l => [l.y * W + l.x, l.side]));
  // Retained break debris keeps its cell occupied, so rebuilding cannot add grit beneath it.
  const props = new Set([...(floor.props ?? []), ...(floor.debris ?? [])].map(p => p.y * W + p.x));
  const REGIONS = ['temple', 'underdark', 'volcanic'], arts = new Map();
  const artOf = key => { if (!arts.has(key)) arts.set(key, pieces(key)); return arts.get(key); };
  const regionAt = (x, y) => (floor.region ? REGIONS[floor.region[Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))]] ?? biome : biome);
  let art = artOf(biome);
  const ENDS = biome === 'dungeon' && !floor.region && hasSheet('environment-terrain-dungeon-face-ends') ? sheet('environment-terrain-dungeon-face-ends').textures : null;   // item 191
  const lava = hasSheet('environment-terrain-lava-flow') ? sheet('environment-terrain-lava-flow') : null;
  const ud = buildUnderdarkRaster(floor, tile, run);   // the Underdark's caves per pixel and its moving lava (underdark-raster.js)
  // Five layers, bottom up: the floor, the liquids and ground marks (root.liquids: ground-paint.js goes there), the
  // walls, the walls' trim (root.trim: capstone rims and posts, pillar caps, door frames), which the lighting lights
  // flat (item 188, Justin 2026-10-19: "relief map is bleeding on to the wall breaks here"), and what hangs on the walls
  // (root.hung: sconces and banners) over the trim, lit as the wall under it (item 198: "wall torches and flags should
  // be drawn over the lip"). Walls are painted after the liquids, so no liquid or splash ever sits on a wall (Justin, 2026-10-16).
  const layers = [new Container(), new Container(), new Container(), new Container()], chunks = [], CWT = Math.ceil(W / TC), NT = CWT * Math.ceil(H / TC);
  const FLOOR = 0, WALLS = 1, TRIM = 2, HUNG = 3;
  root.liquids = new Container(); root.trim = layers[TRIM]; root.hung = layers[HUNG];
  root.addChild(layers[FLOOR], root.liquids, layers[WALLS], root.trim, root.hung);
  let layer = FLOOR;
  // Each chunk holds an invisible rectangle over its whole box, so its cached picture always spans the box (sandbox 55).
  const chunkOf = (x, y) => {
    const cx = Math.floor(x / TC), cy = Math.floor(y / TC), k = cy * CWT + cx + layer * NT;
    if (!chunks[k]) { const c = new Container(); c.box = [cx * TC * tile, cy * TC * tile, (cx + 1) * TC * tile, (cy + 1) * TC * tile]; c.visible = false; c.addChild(new Graphics().rect(c.box[0], c.box[1], TC * tile, TC * tile).fill({ color: 0, alpha: 0 })); chunks[k] = c; layers[layer].addChild(c); }
    return chunks[k];
  };
  const put = (c, x, y, px, py, w = tile, h = tile, alpha = 1) => {
    if (!c?.tex) return null;
    // Drawn in its box whatever its frame's anchor (item 260: the wall dressing's niches carry 0.5, 0.5 and its hung
    // pieces 0.5, 0, which drew each half its size up and left of its box: niches over the rim, banners on a cell's edge).
    const s = new Sprite(c.tex);
    s.anchor.set(0); s.position.set(px, py); s.width = w; s.height = h;
    if (c.dim) s.tint = Math.round(255 * (1 - c.dim)) * 0x010101;
    if (alpha < 1) s.alpha = alpha;
    chunkOf(x, y).addChild(s);
    return s;
  };
  const crypt = biome === 'crypt';
  const decal = (name, x, y, o = {}) => {
    let tex = art.decal(name); if (!tex) return;
    // WT2: the Crypt's sconce burns soul-green (crypt-look.js cryptSconce; its fire glows among the bodies).
    if (crypt && name === 'sconce') tex = cryptSconce(tex)?.paint ?? tex;
    const w = tile * (o.s ?? 1);
    const s = put({ tex }, x, y, Math.round(x * tile + (o.dx ?? 0) * tile + (tile - w) / 2), Math.round(y * tile + (o.dy ?? 0) * tile + (tile - w) / 2), Math.round(w), Math.round(w), o.a ?? 1);
    if (s && o.flip) { s.scale.x *= -1; s.x += s.width; }   // mirrored, in the same cell
  };
  const hang = (name, x, y, o) => { const was = layer; layer = HUNG; decal(name, x, y, o); layer = was; };   // on root.hung
  // Item 208: the walls' dressing, chosen once for the floor (wall-decor.js): banners, chains and ivy hung, niches laid in.
  const dress = wallDecor(floor, { face: (x, y) => wallTrim(at, x, y).face, end: (x, y) => wallTrim(at, x, y).end, torch: (x, y) => torch.has(y * W + x) || sideTorch.has(y * W + x), salt, biome });
  const rw = Math.max(4, Math.round(tile * RIM)), cs = Math.round(rw * 1.45), d = Math.round((cs - rw) / 2), caps = [], frames = [];
  const doorCells = new Map(), openArt = mat => OPEN_ART[mat ?? 'wood'] ?? 'door-wood-open';
  // Sandbox 98 (1.7 render.js drawOpenDoorFloor): an open face-on door keeps the wall face round its arch and shows the
  // floor only through the arch's opening (the art's clear pixels between its jambs), masked to that shape.
  const showDoor = (k, t, mat) => {
    const d = doorCells.get(k); if (!d) return false;
    const open = t === T.OPEN_DOOR, x = k % W, y = (k / W) | 0;
    const mask = open && d.face && d.floor ? doorAperture(openArt(mat), x * tile, y * tile, tile) : null;
    if (d.floor?.mask && d.floor.mask !== mask) { const m = d.floor.mask; d.floor.mask = null; m.destroy(); }
    if (mask) { d.chunk.addChild(mask); d.floor.mask = mask; }
    if (d.face) d.face.visible = !open || !!mask || !d.floor;
    if (d.floor) d.floor.visible = open || !d.face;
    d.open = open;
    return true;
  };
  // A door opened or closed in play: its cell redrawn, and its chunk cached again from scratch on the next frame.
  root.syncDoors = f => {
    for (const [k, d] of doorCells) {
      if (d.open === (f.tiles[k] === T.OPEN_DOOR)) continue;
      showDoor(k, f.tiles[k], f.doorMaterials?.[k]);
      if (d.chunk.cached) { d.chunk.cacheAsTexture(false); d.chunk.cached = false; }
    }
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = at(x, y), px = x * tile, py = y * tile;
    if (ud?.covers(x, y)) continue;
    if (floor.region) art = artOf(regionAt(x, y));
    const { floor: fl, face, top, 'rim-n': rimN, 'rim-v': rimV } = art.sets;
    layer = FLOOR;
    if (!wallish(t)) {
      if (t === T.CHASM) continue;   // the dark below (ground-view)
      if (t === T.LAVA && lava && !ud) { const k = lava.data.meta.keys['lava-flow']; put({ tex: lava.textures[`lava-flow/${((x % k.columns) + k.columns) % k.columns}-${((y % k.rows) + k.rows) % k.rows}`], dim: 0 }, x, y, px, py); continue; }
      // 1.7 terrain.js floorCell: a closed door set in an east-west wall sits in the wall's face; an open one is floor
      // (sandbox 65, Justin 2026-10-16: "open door shows a wall when open instead of floor"). Both are laid under a
      // face-on door, and syncDoors shows the one its state wants when it opens or closes.
      if ((t === T.OPEN_DOOR || DOORISH.has(t)) && !sideDoor(x, y)) {
        const k = y * W + x, chunk = chunkOf(x, y);
        doorCells.set(k, { chunk, face: put(face?.cell(x, 0), x, y, px, py), floor: put(fl?.cell(x, y), x, y, px, py) });
        showDoor(k, t, floor.doorMaterials?.[k]);
        // The rim over the face's lip runs on across the door, round its arch but never into its opening, which it keeps
        // clear of across the rim's depth (Justin 2026-10-19: "draw the lip into the door opening, but not enough to show
        // through the door frame").
        if (wallTrim(at, x, y).n && rimN?.cell) {
          layer = TRIM;
          const rim = put(rimN.cell(smod(x + off(5)), 0), x, y, px, py, tile, rw), gap = apertureRects(openArt(floor.doorMaterials?.[k]), px, py, tile).filter(r => r[1] < py + rw);
          if (rim && gap.length) {
            const x0 = Math.min(...gap.map(r => r[0])), x1 = Math.max(...gap.map(r => r[2]));
            rim.mask = new Graphics().rect(px, py, x0 - px, rw).rect(x1, py, px + tile - x1, rw).fill({ color: 0xffffff });
            chunkOf(x, y).addChild(rim.mask);
          }
          layer = FLOOR;
        }
      } else put(fl?.cell(x, y), x, y, px, py);
      // A side door's frame (1.7 surface.js drawMasonryDoor; item 190, Justin 2026-10-19: "the door frames look fucked"):
      // the wall's own capstone lintel and caps, on the trim layer, across the foot of the wall north of the doorway and
      // the head of the wall south of it, so the doorway is the whole tile and its leaf (door-view.js) fills it (item 196:
      // "the frame should extend onto the neighboring blocks"). Its caps sit flush with the wall's sides and the doorway,
      // nothing out over the floor, and it is drawn last, over the wall's rims and caps ("the frame and the wall lip
      // should be aligned here and not come into the walk way"; "the door frame should write over the lip").
      if ((t === T.OPEN_DOOR || DOORISH.has(t)) && sideDoor(x, y) && rimN?.cell) {
        for (const [k, ly, cy] of [[8, py - rw, py - cs], [9, py + tile, py + tile]]) {
          frames.push([rimN.cell(smod(x + off(k)), 0), x, y, px, ly, tile, rw]);
          for (const cx of [px, px + tile - cs]) frames.push([{ tex: art.cap() }, x, y, cx, cy, cs, cs]);
        }
      }
      // The stone surface: grit against a wall, a rare drain or crack on bare floor (surface.js:264-283).
      if (t !== T.FLOOR || floor.ground?.[y * W + x] || props.has(y * W + x)) continue;
      const wn = wallish(at(x, y - 1)), ws = wallish(at(x, y + 1)), ww = wallish(at(x - 1, y)), we = wallish(at(x + 1, y));
      const near = wn || ws || ww || we, h = hash2(x, y, salt + 70);
      // Item 207: an old Dungeon room cracks in its floor's patches (floor.wear), never a crack at random; no holes
      // (Justin 2026-10-19: "these holes can go too").
      const c = floor.wear?.[y * W + x] === WEAR.CRACKED ? hash2(x, y, salt + 72) : -1;
      if (c >= 0.2 && c < 0.62) decal(`crack-${1 + Math.floor((c - 0.2) / 0.14)}`, x, y, { a: 0.85 });
      // Grit at a wall's foot at 1.7's size, a whole tile's picture (Justin 2026-10-19: "stones were strunk too many times").
      else if (near && h < 0.08) decal(`pebble-${1 + Math.floor(hash2(x, y, salt + 71) * 3)}`, x, y, { dx: ww ? -0.22 : we ? 0.22 : 0, dy: wn ? -0.2 : ws ? 0.24 : 0 });
      // RL20: no drains in the Crypt (1.7 renderer.js:172 drawDeco, cryptRoomsOn).
      else if (!near && h < 0.012 && (!floor.region || regionAt(x, y) === 'temple')) { if (!crypt) decal('drain', x, y, { s: 0.9 }); }
      else if (!near && !floor.wear && h > 0.975) decal(`crack-${1 + Math.floor(hash2(x, y, salt + 72) * 3)}`, x, y, { a: 0.6 });
      continue;
    }
    // A wall. Its pieces go on the wall layer. Solid rock that no open ground touches (diagonals too) takes the plain top
    // only, as 1.7 masonryWallTile draws every seen wall (proof item 5: a revealed map showed the rock between rooms
    // flat black); in play it is never seen, so the fog keeps it black. Cave regions are the raster's (underdark-raster.js).
    layer = WALLS;
    let seen = false;
    for (let dy = -1; dy <= 1 && !seen; dy++) for (let dx = -1; dx <= 1; dx++) if (open(x + dx, y + dy)) { seen = true; break; }
    if (!seen) { if (!floor.region) put(top?.cell(x, y), x, y, px, py); continue; }
    const trim = wallTrim(at, x, y);
    if (trim.face) {
      // Item 191: a face's end is its own block (the art packet wall-face-ends: E1 left, E2 right, E3 both, two of each):
      // the ledge wraps its top corner and the bricks end in a rough return. Each was built on one face cell and keeps
      // its joining edge, so the one built on this column's cell is taken where there is one. It and that tile's decals
      // lie on the trim layer, lit flat, until the lighting reads the blocks' own relief map (normals/normal-face-ends.png).
      const ends = trim.end && ENDS ? Object.keys(ENDS).filter(k => k.startsWith(`face-ends/${trim.end}-`)) : [];
      const cols = face?.k.columns ?? 6, col = ((x % cols) + cols) % cols;
      const end = ends.length ? ENDS[ends.find(k => k.endsWith(`-${col}`)) ?? ends[Math.floor(hash2(x, y, salt + 91) * ends.length)]] : null;
      if (end) layer = TRIM;
      put(end ? { tex: end, dim: face?.cell(x, 0).dim ?? 0 } : face?.cell(x, 0), x, y, px, py);
      // A secret wall keeps its tell: a straight seam down through the courses (surface.js:121).
      if (t === T.SECRET) put({ tex: Texture.WHITE, dim: 0 }, x, y, px + Math.round(tile * 0.47), py + Math.round(tile * 0.12), Math.max(1, Math.round(tile * 0.04)), Math.round(tile * 0.76), 0.7).tint = 0x14161c;
      else if (torch.has(y * W + x)) hang('sconce', x, y, { dy: -0.02 });
      else if (dress.has(y * W + x)) { const p = dress.get(y * W + x); if (p.hung) hang(p.name, x, y, { flip: p.flip }); else decal(p.name, x, y, p); }
    } else {
      put(top?.cell(x, y), x, y, px, py);
      if (floor.region && regionAt(x, y) !== 'temple') continue;   // cave rock: no capstone rims or caps (1.7 rasters these caves)
    }
    layer = TRIM;
    if (trim.n) put(rimN?.cell(smod(x + off(5)), 0), x, y, px, py, tile, rw);
    if (trim.w) put(rimV?.cell(0, smod(y + off(6))), x, y, px, py, rw, tile);
    if (trim.e) put(rimV?.cell(0, smod(y + off(7))), x, y, px + tile - rw, py, rw, tile);
    // Each cap sits where the rim turns into a face's lip (the face art's rows 0..31), over the lip's corner: a face beside
    // at this tile's top, the face below at its foot (Justin 2026-10-19: "that cap should be much lower and cover the
    // corner of the bottom upper lip").
    for (const [cxk, cyk] of trim.caps) caps.push([{ tex: art.cap() }, x, y, px + (cxk ? tile - cs + d : -d), py + (cyk ? tile : 0) - d, cs, cs]);
    if (!trim.face && sideTorch.has(y * W + x)) hang('sconce', x, y, { dx: sideTorch.get(y * W + x) === 'w' ? 0.36 : -0.36, dy: 0.06, s: 0.78 });
  }
  // The caps last, over the rims and the faces' end blocks they join, and the side doors' frames over them.
  layer = TRIM;
  for (const p of [...caps, ...frames]) put(...p);
  // On screen (with the margin map-view gives): drawn, from its cached texture. A chunk more than a chunk off screen
  // gives its texture back. Pixi then draws a handful of textures a frame instead of thousands of tile sprites.
  const far = TC * tile;
  root.cull = chunkCache(chunks, TC * tile, far);   // cached at the screen's density while near (Sandbox 55; chunks.js)
  // The raster in two: its ground under everything (terrain skips the cells it covers), its rock over the liquids layer,
  // so no liquid is ever painted on a wall (Justin, 2026-10-16).
  if (ud) { root.addChildAt(ud, 0); root.addChild(ud.over); const cull = root.cull; root.cull = (...box) => { cull(...box); ud.cull(...box); }; root.anims = ud.anims; root.kindsField = ud.kindsField; root.accentField = ud.accentField; root.ready = ud.ready; }   // WT9: map-view.js prepareFloor waits on the caves over the view
  return root;
}
