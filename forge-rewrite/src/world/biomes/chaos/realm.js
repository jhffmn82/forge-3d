// The Realm of Chaos, floors 21-25 (spec/chaos.md 1-60, 68-77; floors.json chaos-*, unmaker-crucible,
// chaos-treasure-room): the quiet treasure room under floor 20, the composed island floors 21-24 built from 1.7's four
// approved template sets, the currents that join them, the encounters, and floor 25, the Unmaker's Crucible
// (1.7 js/world/chaos/chaos-campaign.js, mixed-chaos-preview.js, chaos-preview.js, cinder/violet/rot-preview.js,
// chaos-encounters.js, chaos-entry-preview.js, unmaker-preview.js @3c8b312).
// Every draw is on its own named stream, as in 1.7, so a floor seed always gives the same floor.

import floors from '../../../../data/floors.json' with { type: 'json' };
import props from '../../../../data/props.json' with { type: 'json' };
import { stream, next, pick, shuffle } from '../../../lib/rng.js';
import { T, G } from '../../../data/tiles.js';
import { chaosBody } from '../../../rules/monsters.js';
import { chaosRegionAt, syncGates } from '../../../rules/chaos-map.js';
import { makeItem } from '../../../rules/items.js';
import { ELEMENTS } from '../../../rules/loot.js'; import { chaosLights, gatewayLight, PALETTE_NAMES } from '../../floor-lights.js'; import { placeGuaranteed } from '../../items.js';
import { cheb, D4 } from '../../../lib/geometry.js';

const F = floors.rows, P = props.rows;
const SETS = ['prism-archives', 'rot-hollows', 'cinder-bastion', 'violet-warrens'];
const PORTAL_ART = { 'prism-archives': 'prism-portal', 'rot-hollows': 'rot-portal', 'cinder-bastion': 'cinder-portal', 'violet-warrens': 'violet-portal' };
const FOCAL_SALT = { 'prism-archives': 0x50726973, 'cinder-bastion': 0x43696e64, 'violet-warrens': 0x56696f6c };
const CHAR = { '#': T.WALL, '.': T.FLOOR, '+': T.DOOR, "'": T.OPEN_DOOR, _: T.CHASM, P: T.PORTAL, '<': T.STAIRS_UP, '>': T.STAIRS, F: T.FORGE, S: T.SEALED };
export const MATERIAL_GATE_NAME = 'Portal to the Material Plane';

/** A 1.7 scenery piece as the rewrite keeps props (spec chaos 35; world/pieces.js): the head carries w, h and the art,
 *  each other covered cell a part pointing at it. */
function scenery(floor, name, x, y, o = {}) {
  const w = o.w ?? 1, h = o.h ?? 1, blocks = o.b !== undefined ? !!o.b : !!P[name]?.blocks;
  const base = { id: name, keep: true, inert: true, breakable: name === 'barrel' || /^barrel-/.test(name), blocks,
    variant: ((floor.seed ?? 0) + x * 17 + y * 31) % 4, label: o.label ?? o.previewLabel ?? null };
  if (o.artName) base.art = o.artName;
  if (o.light) base.light = o.light;
  if (o.focal) base.focal = true;
  if (o.region) base.region = o.region;
  // Relief shadows (lighting): a standing, blocking piece casts once, from its head, half its width wide.
  if (blocks && !o.flat) base.shadow = { width: w / 2, height: h };
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++)
    floor.props.push({ ...base, x: xx, y: yy, ...(w > 1 || h > 1 ? (xx === x && yy === y ? { w, h } : { part: { x, y } }) : {}) });
}

/** One template set (floors.json chaos-preview-<set>) as 1.7 builds it with this seed: only focals and moss move. */
function template(set, seed) {
  const R = F['chaos-preview-' + set], W = R.width, H = R.height;
  const t = { set, seed, w: W, h: H, tiles: new Uint8Array(W * H), region: new Array(W * H).fill(null), moss: new Uint8Array(W * H), props: [], focals: [] };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    t.tiles[y * W + x] = CHAR[R.grid[y][x]] ?? T.CHASM;
    const r = R.regionGrid[y][x];
    t.region[y * W + x] = r === '_' ? null : R.regionLegend[r];
  }
  const focal = R.focals;
  if (set === 'prism-archives') {
    const choose = stream((seed ^ FOCAL_SALT[set]) >>> 0), ch = focal.choices.slice();
    shuffle(choose, ch);
    focal.sites.forEach((s, i) => t.focals.push({ region: s.region, x: s.x, y: s.y, w: s.w, h: s.h, artName: ch[i].artName, label: ch[i].label, b: 1 }));
  } else if (set === 'rot-hollows') {
    for (const s of focal.sites) t.focals.push({ region: s.region, x: s.x, y: s.y, w: s.w, h: s.h, artName: s.artName, label: s.label, b: s.b, hidden: s.artName === 'rot-pool' });
    // Rot moss (chaos 36): cosmetic, from set-wide coordinates and the seed.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (t.tiles[y * W + x] === T.FLOOR && ((Math.floor(x / 3) * 7 + Math.floor(y / 3) * 11 + seed % 17) % 9) < 3) t.moss[y * W + x] = 1;
  } else {
    const choose = stream((seed ^ FOCAL_SALT[set]) >>> 0);
    for (const s of focal.sites) { const pos = pick(choose, s.positions); t.focals.push({ region: s.region, x: pos[0], y: pos[1], w: s.w, h: s.h, artName: s.artName, label: s.label, b: 1 }); }
  }
  t.regions = R.regions; t.portals = R.portals; t.props = R.props; t.rooms = R.rooms; t.landmarks = R.landmarks ?? [];
  t.lights = R.planeLights ?? []; t.pools = R.cosmeticPools ?? []; t.chains = R.chains ?? []; t.filaments = R.filaments ?? []; t.tendrils = R.tendrils ?? [];
  return t;
}

/** An empty 96 x 72 void floor with the Realm's flags (chaos 39, 60). */
function voidFloor(w, h, seed, extra = {}) {
  return {
    w, h, seed, tiles: new Array(w * h).fill(T.CHASM), ground: new Array(w * h).fill(0), props: [], items: [], chests: [], traps: [], rooms: [],
    lights: [], marks: [], notes: [], voidImpassable: true, noSpawns: true, noShrine: true, biome: 'chaos',
    chaos: { regions: [], regionOf: new Array(w * h).fill(-1), portals: [], focals: [], landmarks: [], pools: [], chains: [], filaments: [], tendrils: [] },
    ...extra,
  };
}
const propOn = (floor, x, y) => floor.props.some(p => p.x === x && p.y === y);

/** Island biomes for one floor: 5 draws of floor(r x 4); a biome already holding 3 islands is drawn again (Justin 10-15, Q6). */
function islandOrder(choose) {
  const out = [], n = {};
  while (out.length < 5) { const s = SETS[Math.floor(next(choose) * 4)]; if ((n[s] ?? 0) >= 3) continue; n[s] = (n[s] ?? 0) + 1; out.push(s); }
  return out;
}

/** Chaos 39-46: five islands from the template sets on one void floor, linked by paired portals. */
export function composeRealm(seed) {
  seed = Number.isFinite(seed) ? seed >>> 0 : 92421;
  const choose = stream((seed ^ 0x4d697865) >>> 0), order = islandOrder(choose);
  const C = F['chaos-realm-composer'], slots = C.slots, used = {}, usedFocal = {};
  const floor = voidFloor(C.width, C.height, seed), W = floor.w, ch = floor.chaos;
  const picks = order.map((set, index) => {
    const sourceSeed = Math.floor(next(choose) * 4294967296) >>> 0, src = template(set, sourceSeed);
    const focalOf = id => src.focals.find(f => f.region === id);
    let avail = src.regions.filter(r => focalOf(r.id) && !(used[set] ?? []).includes(r.id) && !(usedFocal[set] ?? []).includes(focalOf(r.id).artName));
    if (!avail.length) { used[set] = []; usedFocal[set] = []; avail = src.regions.filter(r => focalOf(r.id)); }
    const region = pick(choose, avail);
    (used[set] ??= []).push(region.id); (usedFocal[set] ??= []).push(focalOf(region.id).artName);
    if (region.bounds.w > C.slotSize || region.bounds.h > C.slotSize) throw new Error('Approved island exceeds its composition slot.');
    return { set, src, region, id: 'island-' + (index + 1), sourceSeed,
      dx: slots[index].x + Math.floor((C.slotSize - region.bounds.w) / 2) - region.bounds.x,
      dy: slots[index].y + Math.floor((C.slotSize - region.bounds.h) / 2) - region.bounds.y };
  });
  picks.forEach((s, i) => {
    const o = s.region, src = s.src, inR = (x, y) => src.region[y * src.w + x] === o.id;
    ch.regions.push({ id: s.id, name: o.name, biome: s.set, palette: o.palette, height: o.height, sourceRegionId: o.id, sourceSeed: s.sourceSeed,
      bounds: { x: o.bounds.x + s.dx, y: o.bounds.y + s.dy, w: o.bounds.w, h: o.bounds.h }, spawn: { x: o.spawn.x + s.dx, y: o.spawn.y + s.dy } });
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      if (!inR(x, y)) continue;
      const xx = x + s.dx, yy = y + s.dy, k = yy * W + xx;
      if (xx < 0 || yy < 0 || xx >= W || yy >= floor.h || ch.regionOf[k] >= 0) throw new Error('Composed Chaos islands overlap or leave the floor.');
      const t = src.tiles[y * src.w + x];
      floor.tiles[k] = t === T.PORTAL ? T.FLOOR : t; ch.regionOf[k] = i;
      if (src.moss[y * src.w + x]) floor.ground[k] = G.MOSS;
    }
    const mv = v => ({ ...v, x: v.x + s.dx, y: v.y + s.dy, ...(v.toX !== undefined ? { toX: v.toX + s.dx, toY: v.toY + s.dy } : {}), region: s.id, biome: s.set });
    for (const p of src.props) if (inR(p.x, p.y)) scenery(floor, p.name, p.x + s.dx, p.y + s.dy, { ...p, region: s.id });
    for (const f of src.focals.filter(f => f.region === o.id)) {
      const g = mv(f);
      scenery(floor, f.artName, g.x, g.y, { w: f.w, h: f.h, b: f.b, artName: f.artName, label: f.label, focal: true, region: s.id });
      ch.focals.push({ ...g, hidden: !!f.hidden });
    }
    for (const key of ['landmarks', 'pools', 'chains', 'filaments', 'tendrils']) for (const v of src[key]) if (v.regionId === o.id) ch[key].push({ ...mv(v), id: v.id ? s.id + '-' + v.id : undefined });
    for (const r of src.rooms) if (r.regionId === o.id) floor.rooms.push({ x: r.x + s.dx, y: r.y + s.dy, w: r.w, h: r.h, role: null, pocket: false, special: r.special, region: s.id, previewId: s.id + '-' + r.previewId });
    for (const l of src.lights) if (inR(l.x, l.y)) floor.lights.push({ kind: 'beacon', role: 'plane', x: l.x + s.dx, y: l.y + s.dy, colour: l.col, radius: l.r, strength: l.s });
    s.originalGates = src.portals.filter(g => g.regionId === o.id).map(g => ({ x: g.x + s.dx, y: g.y + s.dy, arrival: { x: g.arrival.x + s.dx, y: g.arrival.y + s.dy } }));
  });
  // Chaos 45: gates, the template's own 2x2 patches first, then the farthest clear 2x2 at least 6 away.
  const reserved = new Set();
  const clear = (x, y, i) => x >= 0 && y >= 0 && x < W && y < floor.h && ch.regionOf[y * W + x] === i && floor.tiles[y * W + x] === T.FLOOR && !propOn(floor, x, y) && !reserved.has(y * W + x);
  const candidate = (x, y, i, preferred) => {
    const r = ch.regions[i];
    for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 2; xx++) if (!clear(xx, yy, i) || (xx === r.spawn.x && yy === r.spawn.y)) return null;
    const apron = [];
    for (let ay = y - 1; ay <= y + 2; ay++) for (let ax = x - 1; ax <= x + 2; ax++) {
      const inX = ax >= x && ax < x + 2, inY = ay >= y && ay < y + 2;
      if ((inX && inY) || (!inX && !inY)) continue;
      if (clear(ax, ay, i)) apron.push({ x: ax, y: ay });
    }
    if (!apron.length) return null;
    return { x, y, arrival: (preferred && apron.find(p => p.x === preferred.x && p.y === preferred.y)) || apron[0] };
  };
  picks.forEach((s, i) => {
    const need = i === 0 || i === 4 ? 1 : 2, gates = [], r = ch.regions[i];
    const keep = g => { gates.push(g); for (let yy = g.y; yy < g.y + 2; yy++) for (let xx = g.x; xx < g.x + 2; xx++) reserved.add(yy * W + xx); reserved.add(g.arrival.y * W + g.arrival.x); };
    for (const old of s.originalGates) if (gates.length < need) { const g = candidate(old.x, old.y, i, old.arrival); if (g) keep(g); }
    while (gates.length < need) {
      const opts = [], b = r.bounds;
      for (let y = b.y; y < b.y + b.h - 1; y++) for (let x = b.x; x < b.x + b.w - 1; x++) {
        const g = candidate(x, y, i); if (!g) continue;
        g.d = gates.length ? Math.min(...gates.map(q => Math.abs(q.x - x) + Math.abs(q.y - y))) : Math.abs(r.spawn.x - x) + Math.abs(r.spawn.y - y);
        if (g.d >= 6) opts.push(g);
      }
      opts.sort((a, b2) => b2.d - a.d || a.y - b2.y || a.x - b2.x);
      if (!opts.length) throw new Error('Approved island has no clear second portal landing.');
      delete opts[0].d; keep(opts[0]);
    }
    s.gates = gates;
  });
  // Chaos 46: links island i to island i+1; each end in its own island's portal art.
  for (let l = 0; l < 4; l++) {
    const L = picks[l], R = picks[l + 1], a = L.gates[l === 0 ? 0 : 1], b = R.gates[0], pair = 'chaos-link-' + (l + 1);
    const put = (s, g, id, dest, label) => {
      for (let yy = g.y; yy < g.y + 2; yy++) for (let xx = g.x; xx < g.x + 2; xx++) floor.tiles[yy * W + xx] = T.PORTAL;
      scenery(floor, PORTAL_ART[s.set], g.x, g.y, { w: 2, h: 2, b: 0, artName: PORTAL_ART[s.set], label, region: s.id });
      ch.portals.push({ id, pairId: pair, region: s.id, x: g.x, y: g.y, w: 2, h: 2, arrival: g.arrival, destinationId: dest, label, art: PORTAL_ART[s.set] });
    };
    put(L, a, pair + '-a', pair + '-b', 'To ' + ch.regions[l + 1].name);
    put(R, b, pair + '-b', pair + '-a', 'To ' + ch.regions[l].name);
  }
  ch.order = order;
  paletteRegions(floor);
  return floor;
}

/** floor.palette for the relief: {names, at}, each tile's index into names (lighting.json regions.chaos: prism, cinder,
 *  rot, violet, then the treasure room; the void takes 0). */
const PALETTE_SET = Object.fromEntries(PALETTE_NAMES.map((n, i) => [n, i]));
function paletteRegions(floor) {
  floor.palette = { names: PALETTE_NAMES, at: floor.chaos.regionOf.map(i => (i < 0 ? 0 : PALETTE_SET[floor.chaos.regions[i].palette] ?? 0)) };   // the void is lit by nothing; a plain array, as saves keep
}

/** Chaos 48: a current's landing on an island. */
function landing(floor, i) {
  const r = floor.chaos.regions[i], b = r.bounds, W = floor.w, out = [];
  const clear = (x, y) => x >= 0 && y >= 0 && x < W && y < floor.h && floor.chaos.regionOf[y * W + x] === i && floor.tiles[y * W + x] === T.FLOOR && !propOn(floor, x, y);
  const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
    if (!clear(x, y) || floor.chaos.portals.some(p => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) < 4)) continue;
    let pad = true;
    for (let py = y - 1; py <= y + 1; py++) for (let px = x - 1; px <= x + 1; px++) if (!clear(px, py)) pad = false;
    if (!pad) continue;
    for (const [dx, dy] of dirs) for (let n = 2; n <= 7; n++) {
      const xx = x + dx * n, yy = y + dy * n;
      if (xx >= 0 && yy >= 0 && xx < W && yy < floor.h && floor.tiles[yy * W + xx] === T.CHASM) { out.push({ x, y, dx, dy, n }); break; }
      if (!clear(xx, yy)) break;
    }
  }
  out.sort((a, c) => a.n - c.n || a.y - c.y || a.x - c.x);
  if (!out.length) throw new Error('Chaos island has no clear current landing: ' + r.id);
  const p = out[0]; delete p.n;
  return p;
}

const ROSTERS = F['chaos-21'].encounters.rosters;

/** Chaos 54-58: 12 creatures an island, groups of 3, placed on their own stream; spawned asleep. */
export function planEncounters(floor, seed) {
  const random = stream(((seed >>> 0) ^ 0x4368616F) >>> 0), W = floor.w, ch = floor.chaos, start = floor.arrival, out = [];
  const open = (x, y) => x >= 0 && y >= 0 && x < W && y < floor.h && floor.tiles[y * W + x] === T.FLOOR && !propOn(floor, x, y);
  ch.regions.forEach((r, i) => {
    const base = ROSTERS[r.biome], roster = base.concat(base), safety = [{ ...r.spawn }], cand = [];
    for (const p of ch.portals.filter(q => q.region === r.id)) { safety.push(p.arrival); for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) safety.push({ x, y }); }
    const b = r.bounds;
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      const pt = { x, y };
      if (ch.regionOf[y * W + x] !== i || !open(x, y) || cheb(pt, start) < 6 || safety.some(s => cheb(pt, s) < 4)) continue;
      const nb = D4.filter(([dx, dy]) => open(x + dx, y + dy));
      if (nb.length < 2 || (nb.length === 2 && nb[0][0] + nb[1][0] === 0 && nb[0][1] + nb[1][1] === 0)) continue;
      pt.openN = nb.length; pt.jitter = next(random); cand.push(pt);
    }
    let best = [];
    for (let attempt = 0; attempt < 64 && best.length < roster.length; attempt++) {
      const sep = attempt < 32 ? 2 : 1, chosen = [];
      if (attempt) for (const pt of cand) pt.jitter = next(random);
      for (let n = 0; n < roster.length; n++) {
        const group = Math.floor(n / 3), anchor = chosen[group * 3];
        let pick = null, score = -Infinity;
        for (const pt of cand) {
          if ((roster[n] === 'gorehound' && pt.openN < 3) || chosen.some(c => cheb(pt, c) < sep)) continue;
          const clearance = Math.min(...safety.map(s => cheb(pt, s)));
          let sc = pt.jitter * 2 + Math.min(10, clearance) * 0.15;
          if (anchor) sc -= Math.abs(cheb(pt, anchor) - 3) * 0.7;
          else if (chosen.length) sc += Math.min(12, Math.min(...chosen.map(c => cheb(pt, c)))) * 0.55;
          if (sc > score) { score = sc; pick = pt; }
        }
        if (!pick) break;
        chosen.push({ kind: 'chaos-' + roster[n], x: pick.x, y: pick.y, region: r.id, group });
      }
      if (chosen.length > best.length) best = chosen;
    }
    if (best.length < roster.length) throw new Error('Chaos island has no safe encounter space: ' + r.id);
    out.push(...best);
  });
  return out;
}

/** Chaos 11-15, 39-59: a composed floor 21-24 with its two currents and its 60 creatures. */
export function buildRealmFloor(floorSeed, floorNo, { encounters = true } = {}) {
  const floor = composeRealm(floorSeed), W = floor.w, ch = floor.chaos;
  const up = landing(floor, 0), down = landing(floor, 4);
  floor.tiles[up.y * W + up.x] = floorNo === 21 ? T.PORTAL : T.STAIRS_UP;
  floor.tiles[down.y * W + down.x] = T.STAIRS;
  ch.currents = { up, down, materialGate: floorNo === 21 };
  floor.arrival = { x: up.x, y: up.y }; floor.stairs = { x: down.x, y: down.y };
  floor.notes = F['chaos-21'].notes.slice();
  const creatures = encounters ? planEncounters(floor, floorSeed).map(p => chaosBody(p.kind, p.x, p.y, p.region, { group: p.group })) : [];
  return { floor, creatures, start: { x: up.x, y: up.y } };
}

/** Chaos 68-77: the Unmaker's Crucible, as data (gates in phase ready). */
export function buildCrucible(seed) {
  const R = F['unmaker-crucible'], W = R.width, H = R.height;
  const floor = voidFloor(W, H, seed >>> 0, { boss: true }), ch = floor.chaos;
  const idx = {};
  R.regions.forEach((r, i) => { idx[r.id] = i; ch.regions.push({ id: r.id, name: r.name, biome: r.biome, palette: r.palette, height: r.height, bounds: r.bounds, spawn: r.spawn }); });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    floor.tiles[y * W + x] = CHAR[R.grid[y][x]] ?? T.CHASM;
    const g = R.regionGrid[y][x];
    if (g !== '_') ch.regionOf[y * W + x] = idx[R.regionLegend[g]];
  }
  for (const p of R.props) scenery(floor, p.name, p.x, p.y, { ...p, region: chaosRegionAt(floor, p.x, p.y) });
  for (const f of R.focals) { scenery(floor, f.artName, f.x, f.y, { w: f.w, h: f.h, b: 1, artName: f.artName, label: f.label, focal: true, region: f.regionId }); ch.focals.push({ ...f, region: f.regionId }); }
  for (const l of R.planeLights) floor.lights.push({ kind: 'beacon', role: 'plane', x: l.x, y: l.y, colour: l.col, radius: l.r, strength: l.s });
  ch.landmarks = R.landmarks.slice(); ch.chains = (R.chains ?? []).map(c => ({ ...c, region: c.regionId })); ch.inlays = R.floorInlays ?? [];
  const a = F['chaos-25'].arrival;
  floor.tiles[a.y * W + a.x] = T.STAIRS_UP;
  floor.arrival = { x: a.x, y: a.y }; floor.stairs = null;
  ch.currents = { up: { x: a.x, y: a.y, dx: a.dx, dy: a.dy }, down: null, materialGate: false };
  const k = floor.tiles.indexOf(T.FORGE);
  if (k >= 0) floor.forge = { x: k % W, y: (k / W) | 0 };
  floor.crucible = {
    phase: 'ready', entryGate: R.entryGate, rearSeal: R.rearSeal, trueForge: R.trueForge, bossStart: R.bossStart,
    pylonSites: R.pylonSites, party: R.partyPlacement, encounter: null,
  };
  paletteRegions(floor);
  floor.notes = [R.notes[0], 'crucible-gate', 'void'];
  syncGates(floor);
  return { floor, creatures: [], start: { x: a.x, y: a.y } };
}

/** Chaos 21-28: the treasure room before the portal, on its own stream from the run seed (Justin 10-15, Q7, Q8). */
export function buildTreasureRoom(runSeed) {
  const R = F['chaos-treasure-room'], W = R.width, H = R.height, seed = ((runSeed >>> 0) ^ 0x54726561) >>> 0;
  const floor = { w: W, h: H, seed, tiles: new Array(W * H), ground: new Array(W * H).fill(0), props: [], items: [], chests: [], traps: [], lights: [], marks: [],
    rooms: [{ ...R.room, pocket: false, special: null }], notes: R.notes.slice(), noSpawns: true, noShrine: true, biome: 'underdark', treasureRoom: true };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) floor.tiles[y * W + x] = CHAR[R.grid[y][x]] ?? T.WALL;
  floor.palette = { names: PALETTE_NAMES, at: new Array(W * H).fill(PALETTE_SET.treasure) };   // the treasure room's masonry takes the Dungeon's normals (lighting.json regions.chaos)
  floor.arrival = { x: R.spawn.x, y: R.spawn.y };
  floor.portal = { x: R.portal.x, y: R.portal.y, kind: 'chaos', destination: 21 };
  const k = floor.tiles.indexOf(T.FORGE);
  if (k >= 0) floor.forge = { x: k % W, y: (k / W) | 0 };
  // Chaos 26-27: 23 items on a shuffled list of the loot cells.
  const rng = stream(seed), cells = [];
  for (let y = 14; y <= 19; y++) for (let x = 22; x <= 33; x++) if (x !== 28) cells.push({ x, y });
  shuffle(rng, cells);
  const put = item => { const c = cells.pop(); floor.items.push({ x: c.x, y: c.y, item }); };
  const gear = (pool) => { const id = pick(rng, pool); let it; try { it = makeItem(id, 3, 3); } catch { it = { kind: 'gear', id, tier: 3, plus: 3 }; } it.known = true; it.cursed = false; return it; };
  const L = R.loot.order;
  for (let i = 0; i < 4; i++) put({ kind: 'essence', n: 250, scaled: true });
  put(gear(L[1].pool)); put(gear(L[2].pool)); put(gear(L[3].pool));
  for (const el of ELEMENTS) for (let i = 0; i < 2; i++) put({ kind: 'mote', el });
  for (let i = 0; i < 4; i++) put({ kind: 'food', id: 'ration' });
  gatewayLight(floor); return { floor, creatures: [], start: { x: R.spawn.x, y: R.spawn.y } };   // W3: its gateway's light born with it
}

/** Floors 21-25 (chaos 3): the Crucible on 25, a composed floor otherwise. */
export function buildChaosFloor(floorSeed, floorNo, o = {}) {
  if (!Number.isInteger(floorNo) || floorNo < 21 || floorNo > 25) throw new Error('Chaos campaign floor must be between 21 and 25.');
  const b = floorNo === 25 ? buildCrucible(floorSeed) : buildRealmFloor(floorSeed, floorNo, o);
  b.floor.floorNo = floorNo; chaosLights(b.floor);   // W3: the islands' object lights born with the floor
  placeGuaranteed(b.floor, floorNo, floorSeed, b.start, o.masterworks);   // item 313: floors 21-24 (loot.json floor-guaranteed)
  return b;
}
