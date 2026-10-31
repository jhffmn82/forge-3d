// The lights on a floor right now (lighting-design.md S1). Pure: reads the game state and data, returns a list; the
// passes in lighting.js draw it. Positions are in tiles with a tile's corner on whole numbers (its centre at +0.5),
// the same numbering as the map's sprites, so nothing is shifted half a tile anywhere.
//
// Each light: { kind, x, y, tx, ty (the tile its lines of light start from), c [r, g, b], r, s, falloff, z (height),
// flicker, pulse, pulseAmp, daylight, beam, lean, spill, wr, ws (light set into rock), diffuse, halo, follow (the body
// it moves with, or null), owner (the caster it never shadows, or null), shadow (a fixed cast rule, daylight) }.

import data from '../../data/lighting.json' with { type: 'json' };
import props from '../../data/props.json' with { type: 'json' };
import runes from '../../data/runes.json' with { type: 'json' };
import monsters from '../../data/monsters.json' with { type: 'json' };

/** The Maw opens its exit after floor generation, so it needs the stairs-down beacon added live. */
export function floorLights(floor) {
  const lights = floor.lights ?? [], exit = floor.caveExit;
  if (!exit) return lights;
  return [...lights.filter(l => l.kind !== 'beacon' || l.x !== exit.x || l.y !== exit.y),
    { kind: 'beacon', ...exit, way: true, colour: '#9FD8FF', radius: 4.4, strength: 1.35, height: 0.6 }];
}
import elements from '../../data/elements.json' with { type: 'json' };
import planes from '../../data/planes.json' with { type: 'json' };
import tuning from '../../data/tuning.json' with { type: 'json' };
import { T } from '../data/tiles.js';
import { hash2 } from '../lib/noise.js';
import { doorSpill } from './light-extras.js';
import { sealedTreasure } from '../engine/reads.js';

const L = data.rows.lights, P = data.rows.pipeline, TURN = tuning.rows.clock.unitsPerGameTurn;
export const hex = c => (Array.isArray(c) ? c : [parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255]);
const haloOf = (pr, own = null) => (pr.dim || own?.dim ? P.halo.dim : P.halo.lamp);
const actorKey = id => 'actor:' + id, propKey = pr => 'prop:' + pr.x + ',' + pr.y;
/** A light source's own row by its kind (lights.sources, item 271), or null. */
const SOURCES = Object.values(L.sources.rows).map(r => [new RegExp(r.of), r]);
const sourceOf = kind => SOURCES.find(([re]) => re.test(kind))?.[1] ?? null;

/** A live interactive prop's beacon colour, or null (1.7 mapBeaconProp, render.js:2043-2064). */
export function beaconPropColour(state, pr, BP = L['beacon-prop']) {
  const C = BP.colours;
  if (pr.used) return null;
  if (pr.cleansingShrine) return C.cleansing;
  if (pr.id === 'lever-up' && pr.portcullis) return C.event;
  if (pr.id === 'silk-wrapped-traveler') return C.event;
  if (pr.id === 'altar-spikes') return (pr.passes ?? 0) < 7 ? C.altar : null;
  if (pr.id === 'cage') return pr.prisoner && (!pr.ritual || pr.captiveHp > 0) ? C.prisoner : null;
  if (pr.id === 'elemental-lock') return pr.opened ? null : elements.rows[pr.element]?.colour ?? C.lockFallback;
  if (pr.id === 'lever-up' && pr.lever) return C.lever;
  return null;
}

/** The Crypt's violet among its green (Justin 2026-10-16): one in three of its candles and torches, staggered evenly. */
function violetHere(state, x, y, id) {
  const V3 = L.crypt?.violet;
  if (!V3 || state.floor.biome !== 'crypt' || !V3.kinds.some(k => new RegExp(k).test(id))) return null;
  return ((x * 5 + y * 3 + (state.floorNo ?? 0)) % V3.every + V3.every) % V3.every === 0 ? V3.colour : null;
}

/** A plane's pools, one light each at the cell nearest its middle, radius by area (1.7 ptPlaneLightSources). Cached. */
const POOLS = new WeakMap();
function planePools(f, PP) {
  const key = f.poolField.length + ':' + f.poolField[0] + ':' + f.poolField[f.poolField.length - 1];
  const hit = POOLS.get(f);
  if (hit && hit.key === key) return hit.lights;
  const set = new Set([...f.poolField].sort((a, b) => a - b)), lights = [];
  while (set.size) {
    const first = set.values().next().value; set.delete(first);
    const q = [first]; let sx = 0, sy = 0;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % f.w, y = (i / f.w) | 0; sx += x; sy += y;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) { const ni = ny * f.w + nx; if (nx >= 0 && ny >= 0 && nx < f.w && ny < f.h && set.delete(ni)) q.push(ni); }
    }
    const n = q.length, mx = sx / n, my = sy / n;
    let best = first, bd = Infinity;
    for (const i of q) { const dd = (i % f.w - mx) ** 2 + (((i / f.w) | 0) - my) ** 2; if (dd < bd) { bd = dd; best = i; } }
    const bx = best % f.w, by = (best / f.w) | 0;
    lights.push(make({ kind: 'plane-pool', x: bx + 0.5, y: by + 0.5, tx: bx, ty: by, c: hex(PP.colours[f.plane] ?? PP.colours.light),
      r: Math.min(5.5, Math.max(3, 2 + Math.sqrt(n) * 0.45)), s: PP.strength[f.plane] ?? PP.strength.default, falloff: PP.falloff, z: PP.height, diffuse: true }));
  }
  POOLS.set(f, { key, lights });
  return lights;
}

/** One light with every field present (the passes read them without checks). */
function make(o) {
  return { falloff: P.falloff, z: P.lightHeight, flicker: false, pulse: 0, pulseAmp: 0, daylight: false, beam: 0, lean: 0.28, spill: 0, wr: 0, ws: 0,
    diffuse: false, halo: null, follow: null, owner: null, shadow: null, hero: false, realm: false, role: null, ...o };
}

/**
 * The lights on this floor now (steady values: flicker and gliding are per frame, in lighting.js).
 * @param {object} state the game state
 * @param {{look?: 'relief'|'classic', extra?: object[]}} [o] extra: lights another painter owns (the planes' veins and
 *   cliff crystals, lighting.js), added last as they are, after the area rules.
 */
export function gatherLights(state, o = {}) {
  const look = o.look ?? 'relief', relief = look === 'relief', f = state.floor, W = f.w;
  const p = state.actors[state.playerId], aff = state.hero?.affinity ?? {}, out = [];
  const inSight = (x, y) => !state.vis || !!state.vis[y * W + x], wasSeen = (x, y) => !state.seen || !!state.seen[y * W + x];
  // A wall tile is seen once sight has reached it (sight.js marks the walls it stops at).
  const wallSeen = (x, y) => { const k = state.seen ?? state.vis; return !k || !!k[y * W + x]; };
  const blind = !!p.statuses?.blind, PP = L['prop-profiles'].rows, D = state.where === 'dungeon' && state.floorNo <= 5 && (f.biome ?? 'dungeon') === 'dungeon' ? L.dungeon.kinds : {};
  const footprintSeen = pr => { for (let y = pr.y; y < pr.y + (pr.h ?? 1); y++) for (let x = pr.x; x < pr.x + (pr.w ?? 1); x++) if (inSight(x, y)) return true; return false; };

  // The hero's lamp (1.7 render.js:1507-1514): relief carries the dimensional lamp, steady; classic the warm torch,
  // flickering. On the Realm of Chaos, classic only, the island tints it and adds a fill (chaos-preview-render.js:798-803).
  const H = relief ? { ...L.hero, ...L.hero.relief } : L.hero, ch = f.chaos;
  const B0 = L.hero.byBiome?.[f.biome], pal = ch?.regions ? (ch.regions[ch.regionOf?.[p.y * W + p.x]] ?? ch.regions[0])?.palette : null;
  const HB = B0 && !(relief && B0.classicOnly) ? (B0.byPalette?.[pal] ?? B0) : null;
  const heroLamp = { x: p.x + 0.5, y: p.y + 0.5, tx: p.x, ty: p.y, z: P.heroLightHeight, hero: true, follow: state.playerId, owner: actorKey(state.playerId) };
  out.push(make({ ...heroLamp, kind: 'hero', c: hex(HB?.colour ?? H.colour), r: H.radius + (aff.light > 0 ? H.radiusPerAffinity.light : 0) + (aff.fire > 0 ? H.radiusPerAffinity.fire : 0),
    s: H.strength * (HB?.scale ?? 1), falloff: H.falloff ?? P.falloff, flicker: !relief }));
  if (HB?.fill) { const F = HB.fill; out.push(make({ ...heroLamp, kind: 'hero-fill', c: hex(F.colour), r: F.radius, s: F.strength, falloff: F.falloff ?? P.falloff, wr: F.wallRadius, ws: F.wallStrength })); }
  // A floor may carry its lights already worked out (the same-scene harness hands over 1.7's own list): they stand in
  // for every light below.
  if (Array.isArray(f.fixedLights)) { for (const l of f.fixedLights) out.push(make(l)); return out; }

  // Props: crystal-like pieces shed their own steady colour while a cell of them is in sight (1.7 crystalLightProfile);
  // a lamp prop flickers (render.js:1538-1544); a live interactive prop glows softly (mapBeaconProp). A lamp never
  // shadows its own prop (projected-shadows.js:278).
  for (const pr of f.props ?? []) {
    if (pr.part) continue;
    const prof = PP[pr.art ?? pr.id];
    if (prof) {
      if (blind || !footprintSeen(pr)) continue;
      out.push(make({ kind: pr.id, x: pr.x + (pr.w ?? 1) / 2, y: pr.y + (pr.h ?? 1) / 2, tx: pr.x, ty: pr.y, c: hex(prof.colour), r: prof.radius, s: prof.strength, z: prof.height,
        diffuse: pr.id === 'glow-mushrooms', owner: propKey(pr) }));
      continue;
    }
    const cinderLamp = ch?.regions?.[ch.regionOf?.[pr.y * W + pr.x]]?.palette === 'cinder' && /^(grave-pillar|brazier-unlit)$/.test(pr.id);
    const own = pr.light, row = props.rows[cinderLamp ? (pr.id === 'grave-pillar' ? 'torch-stand' : 'brazier-lit') : pr.id]?.light, K = D[props.rows[pr.id]?.lightFamily];
    if (!own && !row) {
      const BP = L['beacon-prop'], bc = beaconPropColour(state, pr, BP);
      if (bc && !blind && footprintSeen(pr)) out.push(make({ kind: 'beacon-prop', x: pr.x + 0.5, y: pr.y + 0.5, tx: pr.x, ty: pr.y, c: hex(bc), r: BP.radius, s: BP.strength, z: BP.height, owner: propKey(pr) }));
      continue;
    }
    const c = violetHere(state, pr.x, pr.y, pr.id) ?? own?.col ?? own?.color ?? K?.colour ?? row?.color, at = own?.at ?? { x: pr.x, y: pr.y };
    const r = own?.r ?? (own?.col && !own.r ? (pr.dim || own.dim ? 2.8 : 4.8) : row?.radius ?? 4.8);
    const st = (own?.s ?? (own?.col && !own.s ? (pr.dim || own.dim ? 0.55 : 1) : row?.strength ?? 1)) * (pr.id === 'wall-plaque' ? 0.5 : 1);
    const diffuse = /^(glow-mushrooms|giant-mushroom-|mushroom-pair-|cl-small-mushrooms-|cl-glow-moss-|basalt-embers-)/.test(pr.id);
    out.push(make({ kind: pr.id, x: at.x + 0.5, y: at.y + 0.5, tx: pr.x, ty: pr.y, c: hex(c), r, s: st, z: row?.height ?? P.lightHeight, flicker: true, diffuse, halo: haloOf(pr, own), owner: propKey(pr) }));
  }

  // Floor lights (packet G places them): one row per kind; an entry may carry its own colour, radius, strength, height.
  for (let l of floorLights(f)) {
    const row = L[l.kind];
    if (!row) throw new Error('unknown light ' + l.kind);
    if (l.exit && l.open && f.exitOpen) l = { ...l, ...l.open };   // a sealed exit's beacon opens with the guardian's fall
    // On a plane a light out of sight is dark (1.7 portals.js:42-54); in relief its saved crystal and pool lights give way
    // to the clusters and grouped pools below (ptPlaneLightSource, ptPlaneLightSources).
    if (f.plane || l.portalLight) {
      if (blind || !inSight(Math.floor(l.x), Math.floor(l.y))) continue;
      if (relief && l.kind === 'beacon' && (l.role === 'crystal' || (f.poolField?.length && (['spring', 'pool', 'lava', 'deep'].includes(l.role) || (f.plane === 'shadow' && l.role === 'centre'))))) continue;
    }
    if (l.kind === 'beacon' && (f.chests ?? []).some(c => c.open && c.x === l.x && c.y === l.y)) continue;   // an opened gold chest
    // 1.7 lights a wall torch only once its wall has been seen, a beacon only while its tile is in sight (render.js:1524,
    // :1529); daylight shines before its patch is seen (:1518).
    if (l.kind === 'wall-torch' && !wallSeen(Math.floor(l.x), Math.floor(l.y))) continue;
    if (l.kind === 'beacon' && !f.plane && !l.portalLight && !inSight(Math.floor(l.x), Math.floor(l.y))) continue;
    // A torch on a side wall hangs at that wall's inner edge and looks out from the floor beside it; one on a north wall
    // hangs offsetY down its face and looks out from the tile below (1.7 render.js:1527: y + 0.75 from the tile centre).
    const side = l.side === 'w' ? 1 : l.side === 'e' ? -1 : 0, tx = side ? l.x + side : Math.floor(l.x), ty = side ? l.y : Math.floor(l.y) + (row.offsetY ? 1 : 0);
    // A plant's light is dark out of sight, and goes out once its ground is trampled away (1.7 deepPlantLighting).
    if (row.inSight && (blind || !inSight(tx, ty))) continue;
    if (l.needsGround != null && f.ground && f.ground[ty * W + tx] !== l.needsGround) continue;
    // The Dungeon's own colour for its kind (item 209), a beacon's by the tile it stands on, wins over the entry's.
    const biomeRow = row.byBiome?.[f.biome] ?? {}, K = D[l.kind === 'beacon' && f.tiles[ty * W + tx] === T.FORGE ? 'forge' : l.kind];
    const colour = K?.colour ?? l.colour ?? violetHere(state, l.x, l.y, l.kind) ?? biomeRow.colour ?? row.colour;
    // Daylight is a fixed break in the ceiling (item 165): one lean and one colour on every turn, its cast along the lean.
    const beam = row.daylight ? (l.beamRadius ?? row.beamRadius) : 0;
    out.push(make({ kind: l.kind, x: side ? l.x + (side > 0 ? 0.92 : 0.08) : l.x + 0.5, y: side ? l.y + 0.5 : l.y + (row.offsetY ?? 0.5), tx, ty, c: hex(colour),
      r: l.radius ?? (beam ? beam * 2 : row.radius), s: l.strength ?? biomeRow.strength ?? row.strength, falloff: row.falloff ?? P.falloff, z: l.height ?? row.height ?? P.lightHeight,
      flicker: !!(l.flicker ?? row.flicker), pulse: l.pulse ?? row.pulse ?? 0, pulseAmp: l.pulseAmp ?? row.pulseAmp ?? 0, daylight: !!row.daylight, beam, spill: row.spill ?? 0, diffuse: row.diffuse ?? !!row.daylight,
      shadow: row.daylight ? row.shadow ?? null : null, wr: l.wallRadius ?? row.wallRadius ?? 0, ws: l.wallStrength ?? row.wallStrength ?? 0, realm: !!l.realmLight, role: l.role ?? null }));
    // The Cinder island's furnace, anvil, shields, candles and portals breathe their light, 3.5% (audit CH-R13).
    const CB = L['chaos-breathe'], here = out[out.length - 1];
    if (l.realmLight && /^chaos-(focal|decor|portal)$/.test(l.role ?? '') && CB.palettes.includes(ch?.regions?.[ch.regionOf?.[l.y * W + l.x]]?.palette)) { here.pulse = CB.periodMs; here.pulseAmp = CB.amp; }
  }
  // SB8, from the room lights above (not the terrain's own: scenery, lava, plants; 1.7 adds those after the rooms').
  for (const l of doorSpill(state, out.filter(q => !L[q.kind]?.terrain), L['door-spill'])) out.push(make(l));
  // A plane's clusters and outcrop shed their crystal's light by size; stalagmites stay dark (audit PT5). Relief only.
  const PC = L['plane-crystal'], kit = f.plane ? planes.rows['plane-' + f.plane]?.kit?.clusterArt : null;
  if (relief && kit) for (const pr of f.props ?? []) {
    if (pr.part || (pr.id !== 'pt-cluster' && pr.id !== 'pt-outcrop') || pr.light) continue;
    const big = pr.id === 'pt-outcrop', size = pr.size || 1;
    const art = big ? kit[0] : size < 1 ? kit[1] : hash2(pr.seed || 0, pr.x, 67) < 0.45 ? kit[2] : kit[0];
    const m = /^crystal-(gold|violet|amber|fire|water|air)(-small)?$/.exec(art), col = m ? PC.colours[m[1]] : art === 'stalagmite-light' ? PC.colours.gold : null;
    if (!col || blind || !inSight(pr.x, pr.y)) continue;
    const cx = pr.x + ((pr.w ?? 1) - 1) / 2, cy = pr.y + ((pr.h ?? 1) - 1) / 2, row = big ? PC.outcrop : size >= 1 ? { ...PC.big, height: Math.max(0.35, size * 0.8) } : size > 0.5 ? PC.small : PC.smaller;
    out.push(make({ kind: 'plane-crystal', x: cx + 0.5, y: cy + 0.5, tx: Math.floor(cx), ty: Math.floor(cy), c: hex(col), r: row.radius, s: row.strength, falloff: PC.falloff, z: row.height, owner: propKey(pr) }));
  }
  if (relief && f.plane && f.poolField?.length) for (const pool of planePools(f, L['plane-pool'])) if (!blind && inSight(pool.tx, pool.ty)) out.push(pool);

  // A sigil lying in sight gives off its rune's soft light (1.7 runes.js:132-140), with its 8% breath.
  const RL = runes.rows.look, rare = runes.rows.assignment.rare;
  for (const i of f.items ?? []) {
    if (i.item?.kind !== 'sigil' || !inSight(i.x, i.y)) continue;
    out.push(make({ kind: 'sigil', x: i.x + 0.5, y: i.y + 0.5, tx: i.x, ty: i.y, c: hex(rare.includes(i.item.id) ? RL.glow.bind : RL.glow.futhark), r: RL.lightRadius, s: RL.lightStrength, z: P.lightHeight * 0.4, pulse: 400, pulseAmp: 0.08 }));
  }
  // Keys glow blue once their tile is seen, motes in their element's colour while in sight; both flicker (render.js:1553-1554).
  // Item 290: a mote inside a crystal vault's crystal gives no light away (Justin: "you shouldnt see what it;s the crystal").
  const FK = L['floor-key'], FM = L['floor-mote'];
  for (const i of f.items ?? []) {
    const k = sealedTreasure(f, i) ? null : i.item?.kind;
    if (k === 'key' && (blind ? inSight : wasSeen)(i.x, i.y)) out.push(make({ kind: 'floor-key', x: i.x + 0.5, y: i.y + 0.5, tx: i.x, ty: i.y, c: hex(i.item.key === 'crystal' ? FK.colourCrystal : FK.colour), r: FK.radius, s: FK.strength, flicker: true }));
    if (k === 'mote' && inSight(i.x, i.y)) out.push(make({ kind: 'floor-mote', x: i.x + 0.5, y: i.y + 0.5, tx: i.x, ty: i.y, c: hex(elements.rows[i.item.el]?.colour ?? FM.fallback), r: FM.radius, s: FM.strength, flicker: true }));
  }
  // Creatures that glow move with their bodies and never shadow themselves (1.7 actorGlowColor, render.js:1555-1559).
  const CG = L['creature-glow'];
  for (const id of state.order ?? []) {
    const a = state.actors[id];
    if (!a || id === state.playerId || a.hp <= 0 || a.hidden || a.limbOf || CG.skip.includes(a.kind) || !inSight(a.x, a.y)) continue;
    const colour = Object.keys(CG.families).find(c => CG.families[c].includes(a.kind)) ?? monsters.rows?.[a.kind]?.look?.glow;
    if (!colour) continue;
    const own = CG.byKind[a.kind] ?? {}, flying = (a.flags ?? []).includes('flying');
    out.push(make({ kind: 'creature-glow', x: a.x + 0.5, y: a.y + 0.5, tx: a.x, ty: a.y, c: hex(colour), r: own.radius ?? CG.radius, s: own.strength ?? CG.strength, z: flying ? CG.heightFlying : CG.height, follow: id, owner: actorKey(id) }));
  }
  // The true forge glows once the Unmaker falls (1.7 mapBeaconProp final-forge).
  const tf = f.crucible?.trueForge;
  if (tf && f.crucible.phase === 'defeated' && !blind && footprintSeen(tf)) { const BP = L['beacon-prop']; out.push(make({ kind: 'beacon-prop', x: tf.x + (tf.w ?? 1) / 2, y: tf.y + (tf.h ?? 1) / 2, tx: tf.x, ty: tf.y, c: hex(BP.colours.forge), r: BP.radius, s: BP.strength, z: BP.height })); }
  // The up stairs glow pale blue once seen (1.7 floors.js:132-136).
  const SU = L['stairs-up'];
  for (let i = 0; i < f.tiles.length; i++) if (f.tiles[i] === T.STAIRS_UP) {
    const x = i % W, y = Math.floor(i / W);
    if (wasSeen(x, y)) out.push(make({ kind: 'stairs-up', x: x + 0.5, y: y + 0.5, tx: x, ty: y, c: hex(SU.colour), r: SU.radius, s: SU.strength }));
  }
  // In the Caverns every light so far but the hero's, its scenery lights among them, burns lower and shorter.
  const CV = L.caverns;
  if (f.biome === 'caverns') for (const q of out) if (!q.hero) { q.s *= CV.scale; q.r *= CV.reach; }
  // Dawn's light lingers, stepping down over its first turns (1.7 spellLight, audit FX31): broad, so it casts weakly.
  const DW = L['spell-dawn'], dawn = p.statuses?.dawn;
  if (dawn && dawn.born != null) {
    const left = Math.max(0, Math.min(1, (DW.turns - ((state.now ?? 0) - dawn.born) / TURN) / DW.turns));
    if (left > 0) out.push(make({ kind: 'spell-dawn', x: p.x + 0.5, y: p.y + 0.5, tx: p.x, ty: p.y, c: hex(DW.colour), r: DW.radius * (0.7 + 0.3 * left), s: DW.strength * 0.8 * left, falloff: DW.falloff, z: DW.height, diffuse: true, follow: state.playerId, owner: actorKey(state.playerId) }));
  }
  // Glowcap Stew: a wide cool light round the hero while it lasts (1.7 foods.js:50-53); it moves with him, never shadows him.
  if (p.statuses?.stormward) { const SW = L.stormward; out.push(make({ kind: 'stormward', x: p.x + 0.5, y: p.y + 0.5, tx: p.x, ty: p.y, c: hex(SW.colour), r: SW.radius, s: SW.strength, follow: state.playerId, owner: actorKey(state.playerId) })); }
  // The Crypt turns every warm light green at 85% (1.7 crypt.js:64-67); its sconces carry that in their own row.
  if (f.biome === 'crypt') {
    const CW = L['crypt-warm'], green = hex(CW.colour);
    for (const q of out) { const c = q.c; if (!q.hero && q.kind !== 'wall-torch' && c[0] > 0.9 && c[1] > 0.5 && c[1] < 0.75 && c[2] < 0.4) { q.c = green; q.s *= CW.strengthMul; } }
  }
  // Burning ground: a small warm flicker that dies with the fire over its last turns.
  const B = L['burning-tile'];
  for (const k of Object.keys(f.burning ?? {})) {
    const i = +k, x = i % W, y = Math.floor(i / W), dying = Math.min(1, (f.burning[k]?.n ?? B.fadeTurns) / B.fadeTurns);
    out.push(make({ kind: 'burning-tile', x: x + 0.5, y: y + 0.5, tx: x, ty: y, c: hex(B.colour), r: B.radius * (0.6 + 0.4 * dying), s: B.strength * dying, z: B.height ?? 0.4, flicker: true, halo: P.halo.burning }));
  }
  // A burning creature lights its neighbours, moves with it, flickers, and never shadows itself.
  const BC = L['burning-body'];
  for (const id of Object.keys(state.actors ?? {})) {
    const a = state.actors[id], st = a?.statuses?.burn;
    if (!st || a.hp <= 0 || a.x == null) continue;
    const dying = Math.min(1, (st.n ?? BC.fadeTurns) / BC.fadeTurns);
    out.push(make({ kind: 'burning-body', x: a.x + 0.5, y: a.y + 0.5, tx: a.x, ty: a.y, c: hex(BC.colour), r: BC.radius * (0.6 + 0.4 * dying), s: BC.strength * dying, z: BC.height, flicker: true, follow: id, owner: actorKey(id) }));
  }
  // The Underdark burns its lights low: all but the hero's at 75%, basalt embers wider, lower and brighter; its lava and
  // plants keep their own (rows marked unscaled: 1.7 adds them after, deeprender.js:510-515).
  if (f.biome === 'underdark') {
    const U = L.underdark;
    for (const q of out) if (!q.hero && !L[q.kind]?.unscaled) {
      q.s *= U.scale;
      if (/^basalt-embers-[1-4]$/.test(q.kind)) { q.r = U.basaltEmbers.radius; q.s *= U.basaltEmbers.strengthMul; q.z = U.basaltEmbers.height; q.flicker = true; }
    }
  }
  // The Crypt's own glows (spec/world.md 52-54): gas clouds, mushroom beds, ooze.
  const C = L.crypt, add = (i, row) => {
    const x = i % W, y = Math.floor(i / W);
    out.push(make({ kind: row.kind, x: x + 0.5, y: y + 0.5, tx: x, ty: y, c: hex(row.colour), r: row.radius, s: row.strength, z: row.height ?? P.lightHeight, falloff: row.falloff ?? P.falloff, flicker: !!row.flicker, pulse: row.pulse ?? 0, diffuse: true }));
  };
  for (const fl of f.fields ?? []) {
    if (fl.kind !== 'gas' || !fl.cells?.length) continue;
    let sx = 0, sy = 0;
    for (const i of fl.cells) { sx += i % W; sy += Math.floor(i / W); }
    const mx = sx / fl.cells.length, my = sy / fl.cells.length;
    add(fl.cells.reduce((b, i) => (Math.hypot(i % W - mx, Math.floor(i / W) - my) < Math.hypot(b % W - mx, Math.floor(b / W) - my) ? i : b)), C.gas);
  }
  if (f.biome === 'crypt') {
    const g = f.ground ?? [];
    for (let i = 0; i < g.length; i++) if (g[i] === 1 && hash2(i % W, Math.floor(i / W), 77) <= 0.4) add(i, C.mushroom);
    const chosen = [];
    for (const i of [...(f.ooze ?? [])].sort((a, b) => hash2(a % W, Math.floor(a / W), 718) - hash2(b % W, Math.floor(b / W), 718))) {
      const x = i % W, y = Math.floor(i / W);
      if (chosen.some(j => Math.hypot(j % W - x, Math.floor(j / W) - y) < C.ooze.apart)) continue;
      chosen.push(i); add(i, C.ooze);
    }
  }
  // The placed lights burn lower and pool on the Dungeon's and the Crypt's floors (item 247): every light there but the
  // hero's, daylight, and what moves with a body or is a thing's own glow (lights.placed.except), at a share of its
  // strength and reach and falling off faster, so overlapping lights no longer fill a room to the limit.
  const PL = L.placed;
  if (PL.biomes.includes(f.biome ?? 'dungeon') && !f.plane) for (const q of out) if (!q.hero && !q.daylight && !q.follow && !PL.except.includes(q.kind)) { q.s *= PL.scale; q.r *= PL.reach; q.falloff = PL.falloff; }
  // Each light source by its own row on every floor but a plane (item 271), whatever its biome's share above.
  if (!f.plane) for (const q of out) { const row = !q.hero && !q.daylight && !q.follow && sourceOf(q.kind); if (row) { q.s = row.strength; q.r = row.radius; q.falloff = PL.falloff; } }
  // The Realm of Chaos: an island's light is dark while no cell near its source is in sight, every Realm light is dark
  // while Blind, and any other light out of sight is dropped (1.7 chaos-preview-render.js:733-752, :792).
  if (ch) for (let k = out.length - 1; k >= 0; k--) {
    const q = out[k];
    if (q.hero) continue;
    if (q.realm) {
      let near = null;
      if (!blind) for (let y = q.ty - 1; y <= q.ty && !near; y++) for (let x = q.tx - 1; x <= q.tx; x++) if (x >= 0 && y >= 0 && inSight(x, y)) { near = [x, y]; break; }
      if (!near) { out.splice(k, 1); continue; }
      if (!inSight(q.tx, q.ty)) { q.tx = near[0]; q.ty = near[1]; }
    } else if (!inSight(q.tx, q.ty)) out.splice(k, 1);
  }
  for (const e of o.extra ?? []) out.push(make(e));
  return out;
}
