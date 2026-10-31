// The Realm's and the planes' pieces on the map (M10, render-28: moved out of realm-view.js): the material gates, the
// crucible gate, pylons and island doors, and realmStructures, which lays every piece of such a floor.

import { AnimatedSprite, Container, Graphics, Sprite, Text } from '../../../forge-godot/runtime/pixi.js';
import { T } from '../data/tiles.js';
import { objArt, objSprite } from './art.js';
import ui from '../../data/ui.json' with { type: 'json' };
import { warmRealmWorkers } from './realm-bake.js';
import { planeMotion, openMask, poolLayer } from './plane-anim.js';
import { realmFloor } from './realm-view.js';
import { sheet, hasSheet, loadSheet, alsoLoad, wallish, hexN, motionSalt, STATES, reduced, liveState, inSight, memA, footprint, animate } from './realm-kit.js';
import { recolour } from './realm-palette.js';
import { realmProp, PROP_FLAT } from './realm-props.js';
import { glowSprite, portalGlow, voidLife, chaosGlints, current } from './realm-life.js';
import { CHAOS_POOL_FX, hazardBursts, swirl, lava, deepWater, wind, trailLayer } from './realm-hazards.js';

// CH-R17 (chaos-current-render.js:11-14, chaos-campaign.js:11): the gateway's picture loads with the Realm's art, before
// the floor shows (main.js loads the 'chaos' group for the Realm, and fetches it ahead from floor 20, where the treasure
// room is), so it never pops in.
const GATE = 'sheets/map-material-gateway.webp', GATE_KEY = 'map-material-gateway.webp';
alsoLoad('chaos', GATE);
let gateLoading = null;
/** chaos-current-render.js drawGate and gateShimmer: the material gateway, 2.5 tiles tall, and its shimmer. */
function materialGate(floor, x, y, tile) {
  const c = new Container(), cx = (x + 0.5) * tile, cy = (y + 0.06) * tile;
  const put = tex => { const h = tile * 2.5, w = h * tex.width / tex.height, s = new Sprite(tex); s.width = w; s.height = h; s.position.set(cx - w / 2, (y + 0.96) * tile - h); c.addChildAt(s, 0); };
  if (hasSheet(GATE_KEY)) put(sheet(GATE_KEY));
  else {   // only when the group could not bring it (a failed load): it comes in when it arrives
    gateLoading ??= loadSheet(GATE, { retry: true }).catch(() => null).finally(() => { gateLoading = null; });
    gateLoading.then(() => { if (hasSheet(GATE_KEY) && !c.destroyed) put(sheet(GATE_KEY)); });
  }
  const shimmer = new Graphics(), halo = glowSprite(cx, cy, tile * 0.5, tile * 0.75, 0x80e0ff, 0.3);
  c.addChild(halo, shimmer);
  // CH-R9 (chaos-current-render.js:30 gateShimmer): never seen, none; remembered, dimmed (memA .4) and still; reduced, still.
  animate(shimmer, (t, sight) => {
    shimmer.clear();
    const a = sight === 'in' ? 1 : memA(floor, 0.4);
    halo.visible = sight !== 'none'; halo.alpha = 0.3 * a; shimmer.alpha = a;
    if (sight === 'none') return;
    for (let n = 0; n < 10; n++) { const a = n * 2.39 + t * 0.6, r = 0.1 + (n % 4) * 0.09, q = (t * 0.21 + n * 0.173) % 1, size = tile * 0.022; shimmer.rect(cx + Math.cos(a) * tile * r - size, cy + Math.sin(a) * tile * r * 1.6 - size, size * 2, size * 2).fill({ color: n % 3 ? 0xb5eeff : 0xeee0ff, alpha: Math.sin(q * Math.PI) * 0.8 * 0.55 }); }
  }, { floor, cells: footprint(floor, x, y) });
  return c;
}
/** unmaker-preview.js drawGate: one section of a broad gate a tile; open, only its lintel. */
function crucibleGate(gate, rear, open, x, tile) {
  const g = new Graphics(), px = x * tile, py = gate.y * tile, s = tile, section = x - gate.x, last = section === gate.w - 1;
  const box = (color, xx, yy, w, h) => g.rect(px + xx * s, py + yy * s, w * s, h * s).fill({ color: hexN(color) });
  const iron = '#303540', edge = '#929DAA', trim = rear ? '#B4DAE6' : '#DEB87D', seal = rear ? '#91DFFF' : '#FFBE78';
  if (!open) {
    for (let i = 0; i < 3; i++) {
      const bx = (i + 0.5) / 3;
      box('#1C2430', bx - 0.038, 0.15, 0.095, 0.78); box(edge, bx - 0.026, 0.17, 0.025, 0.73);
      g.poly([px + (bx - 0.05) * s, py + 0.88 * s, px + (bx + 0.057) * s, py + 0.88 * s, px + bx * s, py + 0.995 * s]).fill({ color: hexN(iron) });
    }
    box(iron, 0, 0.4, 1.01, 0.1); box(edge, 0, 0.4, 1.01, 0.022); box(iron, 0, 0.77, 1.01, 0.075); box(trim, 0, 0.77, 1.01, 0.019);
  }
  box('#242833', 0, 0.075, 1.01, 0.16); box(trim, 0, 0.075, 1.01, 0.027); box('#626C77', 0, 0.205, 1.01, 0.02);
  if (section === 0 || last) {
    const post = section === 0 ? 0 : 0.84;
    box('#32343D', post, 0.04, 0.16, 0.94); box(trim, post + 0.018, 0.04, 0.033, 0.94); box('#717986', post + 0.063, 0.05, 0.058, 0.91);
    box(trim, post - 0.005, 0.055, 0.175, 0.1); box(trim, post - 0.005, 0.84, 0.175, 0.085);
  }
  if (section === Math.floor(gate.w / 2)) {
    box('#232B38', 0.36, open ? 0.045 : 0.32, 0.28, open ? 0.2 : 0.3);
    const cy = open ? 0.14 : 0.46;
    g.poly([px + 0.5 * s, py + (cy - 0.095) * s, px + 0.58 * s, py + cy * s, px + 0.5 * s, py + (cy + 0.095) * s, px + 0.42 * s, py + cy * s]).stroke({ color: hexN(seal), width: Math.max(1, s * 0.026) });
  }
  return g;
}
/**
 * unmaker-encounter.js drawTelegraphs: a pylon on its ring, its animation, its numeral and its charge bar, shown while
 * its cell is in sight. The bar empties as the beam comes due ((fireAt - now) / 200, CH16, CH-R18) and is redrawn as the
 * world clock moves; the clip follows the warning (charge or idle). Under reduced motion it shows the sheet's still
 * frame (unmaker-pylon-art.js:33-35 staticRow, RB37).
 */
function pylon(floor, p, site, tile, floorNow) {
  const c = new Container(), px = p.x * tile, py = p.y * tile, col = hexN(site.color), i = p.y * floor.w + p.x;
  const ring = new Graphics().ellipse(px + tile * 0.5, py + tile * 0.83, tile * 0.35, tile * 0.13).stroke({ color: col, width: Math.max(1, tile * 0.04) });
  c.addChild(ring);
  let anim = null, clipNow = null, still = null;
  if (hasSheet('unmaker-pylon-animation')) {
    const s = sheet('unmaker-pylon-animation'), m = s.data.meta, box = m.box;
    const clipFrames = clip => Object.keys(s.textures).filter(k => k.startsWith(clip + '-')).sort((a, b) => +a.split('-')[1] - +b.split('-')[1]).map(k => s.textures[k]);
    const sc = tile * 0.98 / Math.max(box[2], box[3]), a = new AnimatedSprite(clipFrames('idle'));
    a.anchor.set(0, 0); a.scale.set(sc); a.position.set(px + tile * 0.5 - (box[0] + box[2] / 2) * sc, py + tile * 0.96 - (box[1] + box[3]) * sc); a.alpha = 0.92;
    c.addChild(a);
    const staticTex = s.textures.static ?? null;
    anim = () => {
      const r = reduced() && !!staticTex, clip = p.warning ? 'charge' : 'idle';
      if (r === still && clip === clipNow) return;
      still = r; clipNow = clip;
      if (r) { a.stop(); a.textures = [staticTex]; a.gotoAndStop(0); return; }
      const frames = clipFrames(clip);
      a.textures = frames; a.animationSpeed = m.clips[clip].fps / 60; a.gotoAndPlay(p.id % frames.length);
    };
    anim();
  } else { const tex = objArt('props', site.art); if (tex) { const s = objSprite(tex, p.x, p.y, tile, { feet: true, fit: 0.98 }); s.alpha = 0.92; c.addChild(s); } }
  const label = new Text({ text: site.label, style: { fontFamily: `${ui.fonts.mono}, monospace`, fontWeight: '700', fontSize: Math.max(11, Math.round(tile * 0.22)), fill: col, stroke: { color: 0x241e35, width: Math.max(3, tile * 0.07) } } });
  label.anchor.set(0.5); label.position.set(px + tile * 0.5, py - tile * 0.25);
  const bar = new Graphics();
  c.addChild(label, bar);
  let barKey = null;
  const watch = new Container();   // the watcher's handle: never hidden, so it runs while the pylon is out of sight
  c.addChild(watch);
  animate(watch, () => {
    const seen = inSight(floor, i);
    for (const k of c.children) if (k !== watch) k.visible = seen;
    anim?.();
    const now = liveState(floor)?.now ?? floorNow, w = p.warning;
    const remaining = w && now !== undefined ? Math.max(0, Math.min(1, (w.fireAt - now) / 200)) : null, key = remaining === null ? 'none' : remaining;
    if (key === barKey) return;
    barKey = key; bar.clear();
    if (remaining === null) return;
    bar.rect(px + tile * 0.13, py - tile * 0.1, tile * 0.74, tile * 0.08).fill({ color: 0x1e192b, alpha: 0.8 });
    if (remaining > 0) bar.rect(px + tile * 0.15, py - tile * 0.08, tile * 0.7 * remaining, tile * 0.04).fill({ color: col });
  });
  return c;
}

/**
 * A closed face-on door on a Chaos island, its art in the island's palette (it fills its tile, as structures.js's do).
 * null for anything else, which structures.js then draws.
 */
function chaosDoor(floor, x, y, tile, pal) {
  const W = floor.w, at = (xx, yy) => (xx < 0 || yy < 0 || xx >= W || yy >= floor.h ? T.WALL : floor.tiles[yy * W + xx]), t = at(x, y);
  if (t !== T.DOOR && t !== T.OPEN_DOOR && t !== T.LOCKED) return null;
  const side = wallish(at(x, y - 1)) && wallish(at(x, y + 1)) && !(wallish(at(x - 1, y)) && wallish(at(x + 1, y)));
  // Open and side-on doors are structures.js's, drawn as 1.7 draws them (doorGraphic: floor under an open door, the wide
  // banded plank side-on; sandbox 65 and 70). Only a closed face-on door keeps the island-coloured art here.
  if (side || t === T.OPEN_DOOR) return null;
  const name = t === T.DOOR ? 'door-wood' : 'door-iron';
  const tex = name && objArt('structures', name);
  return tex ? objSprite(recolour(tex, pal, name), x, y, tile, side ? { fit: 1.02 } : { fit: 1.02, fill: true }) : null;
}

/**
 * Everything this module stands among the bodies on a Realm, treasure room, plane or portal floor: {skip, ownsProps,
 * sprites}, or null for any other floor. skip: cells whose tile object 1.7 does not draw here (a current, a gate, the
 * material gateway); ownsProps: the props are all drawn here.
 */
export function realmStructures(floor, tile, now) {
  const portal = floor.plane ? (floor.portalAt ?? floor.portal) : floor.portal && !floor.treasureRoom && floor.portal.plane ? floor.portal : null;
  if (!realmFloor(floor) && !portal) return null;
  const W = floor.w, out = [], skip = new Set(), ch = floor.chaos;
  const add = (s, z) => { if (s) { s.zIndex = z; out.push(s); } };
  // The plane portal's swirl and its light (spec/planes.md 24): open while unused, always on a plane.
  if (portal) {
    const el = floor.plane ?? portal.plane, open = floor.plane ? true : !portal.used;
    if (!floor.plane && open) warmRealmWorkers();   // the plane's rock will be painted by workers: they warm up now (WT8)
    const arch = floor.tiles[portal.y * W + portal.x] === T.PORTAL && objArt('structures', 'portal-arch');   // renderer.js tileSprite: the arch
    // Sandbox 19 (Justin 2026-10-16: "the portals to the 6 planes are too small ... and should also give off light"):
    // the arch stands 1.7 tiles tall on its cell (its art is 114 x 118, so near 1:1 and crisp), the swirl fills its
    // opening, and its light is stronger and higher.
    if (arch) add(objSprite(arch, portal.x, portal.y, tile, { fit: 1.7, feet: true }), (portal.y + 1) * tile - 1);
    if (open && el) {
      add(swirl(portal.x, portal.y, el, tile), (portal.y + 1) * tile - 0.5);   // its light is born with the floor (world/floor-lights.js)
    }
  }
  if (!realmFloor(floor)) return { skip, ownsProps: false, sprites: out };
  if (floor.treasureRoom) {
    warmRealmWorkers();   // the Realm's rock comes next (WT8)
    const p = floor.portal;
    if (p) {
      skip.add(p.y * W + p.x); add(materialGate(floor, p.x, p.y, tile), (p.y + 1) * tile - 1);
    }
    return { skip, ownsProps: false, sprites: out };
  }
  const palOf = (x, y) => (ch ? ch.regions[ch.regionOf[y * W + x]]?.palette ?? null : null);
  for (const p of floor.props ?? []) {
    if (p.part) continue;
    const s = realmProp(floor, p, tile, palOf(p.x, p.y));
    // footRows: the floor its footprint covers, lit where it lies (item 186, light-passes.js; item 215: the sun dais); prop:
    // WT5, map-view.js heaves it up.
    if (s) { s.footRows = p.h ?? 1; if (p.upheaval) s.prop = p; }
    const flat = !!p.flat || !!PROP_FLAT[p.id];
    add(s, flat ? -1 : ((p.y + (p.h ?? 1)) * tile) - 1);
  }
  if (ch) {
    const pairs = [...new Set(ch.portals.map(q => q.pairId))];
    for (const p of ch.portals) add(portalGlow(floor, { ...p, pairIndex: pairs.indexOf(p.pairId) }, palOf(p.x, p.y), tile), -1);
    const cur = ch.currents ?? {};
    if (cur.up) { skip.add(cur.up.y * W + cur.up.x); add(cur.materialGate ? materialGate(floor, cur.up.x, cur.up.y, tile) : current(floor, cur.up, tile), cur.materialGate ? (cur.up.y + 1) * tile - 1 : -1); }
    if (cur.down) { skip.add(cur.down.y * W + cur.down.x); add(current(floor, cur.down, tile), -1); }
    add(hazardBursts(floor, tile), -1);
    // Doors in their island's palette (chaos-preview-render.js objectArt over the door art): drawn here, not by structures.js.
    for (let i = 0; i < floor.tiles.length; i++) {
      const s = chaosDoor(floor, i % W, (i / W) | 0, tile, palOf(i % W, (i / W) | 0));
      if (s) { skip.add(i); add(s, (((i / W) | 0) + 1) * tile - 1); }
    }
    add(trailLayer(floor, tile), -1);
    add(voidLife(floor, tile), -1);
    add(chaosGlints(floor, tile), -1);
  }
  const c = floor.crucible;
  if (c) {
    const open = { entry: c.phase === 'defeated' || c.phase === 'preview' || !!c.walkthrough, rear: c.phase === 'defeated' || !!c.walkthrough };
    for (const [gate, rear] of [[c.entryGate, false], [c.rearSeal, true]]) for (let x = gate.x; x < gate.x + gate.w; x++) {
      skip.add(gate.y * W + x);
      add(crucibleGate(gate, rear, rear ? open.rear : open.entry, x, tile), (gate.y + 1) * tile - 1);
    }
    const enc = c.encounter;
    if (enc?.status === 'active') for (const p of enc.pylons ?? []) add(pylon(floor, p, c.pylonSites[p.id], tile, now), (p.y + 1) * tile - 1);
  }
  // Liquids never lie on a wall (Justin 2026-10-16): the lava's crust and heat and the deep water's circles are kept to
  // the open floor.
  const keepOff = c => { if (!c) return c; const m = openMask(floor, tile, (x, y) => x < 0 || y < 0 || x >= W || y >= floor.h || wallish(floor.tiles[y * W + x])); const w = new Container(); w.addChild(c, m); c.mask = m; return w; };
  if (floor.plane === 'fire') add(keepOff(lava(floor, tile)), -2);
  if (floor.plane === 'water') add(keepOff(deepWater(floor, tile)), -2);
  if (floor.plane === 'air') add(wind(floor, tile, (floor.hostFloor ?? 1) * 31 + 911), -1);
  if (floor.plane) {   // pools, glints, sparkles, grass, the Night Warden's shroud (plane-anim.js)
    const m = planeMotion(floor, tile, motionSalt(floor), animate, () => STATES.get(floor), reduced);
    if (m) add(m, -1);
  }
  // Rot and Violet pools bubble as 1.7's (chaos-preview-render.js poolFx).
  if (ch?.pools?.length) {
    const cells = [], fxOf = {};
    for (const p of ch.pools) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) {
      const pal = ch.regions[ch.regionOf[y * W + x]]?.palette;
      if (CHAOS_POOL_FX[pal]) (fxOf[pal] ??= []).push({ x, y });
    }
    for (const [pal, list] of Object.entries(fxOf)) add(keepOff(poolLayer(list, CHAOS_POOL_FX[pal], tile, animate)), -1);
  }
  return { skip, ownsProps: true, sprites: out };
}
