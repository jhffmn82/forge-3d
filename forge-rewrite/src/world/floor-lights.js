// Lights born with the floor (consolidation W3; lighting's L1 input contract): the plane portal's light, the treasure
// room's gateway and the Realm of Chaos islands' object lights, built with the floor so render and the light map only
// read floor.lights (render-02). The numbers are the ones render used to write at draw time: Sandbox 19's portal
// (radius 5.5, strength 1.4, height 1.4, 1.7 portals.js:45 pulse) and 1.7's chaos-preview-render.js / chaos-current-render.js
// addLights tables, with Chaos improvement 1's way-on column (way: true).

import planes from '../../data/planes.json' with { type: 'json' };
import { G } from '../data/tiles.js';

/** The Realm's relief palette (floor.palette.names; the order of lighting.json regions.chaos), the void at 0. */
export const PALETTE_NAMES = ['prism', 'cinder', 'rot', 'violet', 'treasure'];

/**
 * W8 (save.js's version 6 migration): a floor saved before every light was a floor.lights entry. The Caverns'
 * sceneLights and the Underdark's lavaLights and glowLights become scene, lava and glow entries (the record the
 * builders write now), and a Realm floor's relief palette moves out of floor.region into floor.palette.
 */
export function lightsAsEntries(f) {
  f.lights ??= [];
  for (const l of f.sceneLights ?? []) f.lights.push({ kind: 'scene', x: l.x, y: l.y, colour: l.col, radius: l.r, strength: l.s });
  for (const l of f.lavaLights ?? []) f.lights.push({ kind: 'lava', x: l.x, y: l.y, phase: l.phase });
  for (const l of f.glowLights ?? []) f.lights.push({ kind: 'glow', plant: l.kind, x: l.x, y: l.y, colour: l.color ?? l.colour, radius: l.radius, strength: l.strength, ...(l.kind === 'gloomgrass' ? { needsGround: G.GRASS } : {}) });
  delete f.sceneLights; delete f.lavaLights; delete f.glowLights;
  if ((f.chaos || f.treasureRoom) && f.region && !f.palette) { f.palette = { names: PALETTE_NAMES, at: Array.from(f.region) }; delete f.region; }
  return f;
}

/** Each plane's colour (planes.json portalColour; 1.7 portals.js PLANE_COLORS). */
const PLANE_COL = Object.fromEntries(['light', 'shadow', 'earth', 'fire', 'water', 'air'].map(e => [e, planes.rows['plane-' + e].portalColour]));

/**
 * The plane portal's light (spec/planes.md 24): on a plane its way home, always open; on a host floor while the portal is
 * unused (engine/realm.js takes it away when the portal is used). Entries keep their portalLight flag for saves.
 */
export function portalLight(floor) {
  const portal = floor.plane ? (floor.portalAt ?? floor.portal) : floor.portal?.plane && !floor.treasureRoom ? floor.portal : null;
  const el = floor.plane ?? portal?.plane;
  floor.lights = (floor.lights ?? []).filter(l => !l.portalLight);
  if (!portal || !el || (!floor.plane && portal.used)) return;
  floor.lights.push({ kind: 'beacon', portalLight: true, x: portal.x, y: portal.y, colour: PLANE_COL[el], radius: 5.5, strength: 1.4, height: 1.4, pulse: 300, pulseAmp: 0.1 });
}

/** The treasure room's material gateway, at the height of its card (chaos-current-render.js addLights). */
export function gatewayLight(floor) {
  const p = floor.portal;
  floor.lights = (floor.lights ?? []).filter(l => !l.realmLight);
  if (p) floor.lights.push({ kind: 'beacon', realmLight: true, x: p.x, y: p.y, colour: '#9DEEFF', radius: 3.2, strength: 0.85, height: 1.1 });
}

// The object lights 1.7 adds on the islands (chaos-preview-render.js addRotLights / addCinderLights / addVioletLights /
// addThemeLights, FOCAL_LIGHTS, ROT_LIGHTS, CINDER_LIGHTS, VIOLET_LIGHTS; chaos-current-render.js addLights): each focal
// lights its own pocket, each portal glows in its link's colour, each current at 3.2. A template light inside a piece's
// footprint wins (addObjectLight).
const FOCAL_LIGHT = {
  'prism-lens': ['#6CCEFF', 4.4, 1.02], 'prism-astrolabe': ['#F5D69B', 3.8, 0.88], 'prism-lectern': ['#9FDFFF', 3.8, 0.94], 'prism-tree': ['#A58AFF', 4.5, 1.06],
  'rot-canopy': ['#FFD076', 5, 1.07], 'rot-puffballs': ['#CBEE83', 4.2, 0.98], 'rot-pool': ['#80E4BE', 4.5, 0.96],
  'cinder-furnace': ['#FFAD59', 5.5, 1.2], 'cinder-anvil': ['#FFC16F', 4.5, 1.02], 'cinder-shields': ['#FF9F4E', 4, 0.94],
  'violet-pavilion': ['#E9CAF8', 5, 1.02], 'violet-eggs': ['#F8DCEB', 4.3, 1.04], 'violet-loom': ['#C7D7FF', 4.6, 0.98],
};
const PAIR_COL = { rot: '#D7EC88', cinder: '#FFBC70', violet: '#C7DFFF' };
const WALL_S = { prism: 0.58, rot: 0.78, cinder: 0.72, violet: 0.74 };

/** The Realm islands' lights (floor.chaos): focal pieces, island scenery, violet pools, portals and the currents. */
export function chaosLights(floor) {
  const ch = floor.chaos, W = floor.w;
  if (!ch) return;
  const pairs = [...new Set((ch.portals ?? []).map(q => q.pairId))];
  floor.lights = (floor.lights ?? []).filter(l => !l.realmLight);
  const own = floor.lights.slice();
  const inside = (x, y, w, h) => own.some(l => l.x >= x && l.x < x + w && l.y >= y && l.y < y + h);
  // addObjectLight: at the piece's centre (the light map wants a whole cell), set against rock (wall: true) with wr, ws.
  const put = (role, x, y, colour, radius, strength, ws, wr = radius) => floor.lights.push({ kind: 'beacon', role, realmLight: true, x: Math.round(x), y: Math.round(y), colour, radius, strength, wallRadius: wr, wallStrength: ws });
  const palAt = (x, y) => ch.regions[ch.regionOf[y * W + x]]?.palette;
  for (const p of floor.props) {
    if (p.part) continue;
    const pal = palAt(p.x, p.y), w = p.w ?? 1, h = p.h ?? 1, cx = p.x + (w - 1) / 2, cy = p.y + (h - 1) / 2;
    if (inside(p.x, p.y, w, h)) continue;   // a template light in the footprint wins
    const F = p.art && FOCAL_LIGHT[p.art];
    if (F) { put('chaos-focal', cx, cy, ...F, WALL_S[pal] ?? 0.58); continue; }
    // 1.7 lights the islands' scenery in each island's colours; a piece's own light (p.light) wins. The props table's
    // cave light (props.json, the Caverns' warm mushrooms) still burns under it in the light map.
    if (p.art || p.light) continue;
    const n = p.id;
    if (pal === 'rot' && /mushroom|glow-moss/.test(n)) put('chaos-decor', cx, cy, /(?:small-mushrooms-3|giant-mushroom-3|mushroom-pair-1)$/.test(n) ? '#EDC475' : '#C5E777', 3, 0.58, 0.78);
    else if (pal === 'cinder' && n === 'table-candle') put('chaos-decor', cx, cy, '#FFC680', 3, 0.6, 0.72);
    else if (pal === 'violet' && /crystal/.test(n)) put('chaos-decor', cx, cy, /water|blue/.test(n) ? '#B9DDFF' : '#DCABF5', 3.1, 0.65, 0.74);
    else if (pal === 'violet' && /mushroom/.test(n)) put('chaos-decor', cx, cy, '#F1D6E9', 2.7, 0.52, 0.74);
    else if (pal === 'prism' && n === 'crystal-water-small') put('chaos-decor', cx, cy, '#40BAFF', 3.2, 1, 0.5, 2.2);
    else if (pal === 'prism' && n === 'crystal-gold-small') put('chaos-decor', cx, cy, '#FFC04D', 3.2, 1, 0.5, 2.2);
  }
  // Violet's cosmetic pools glow faintly (addVioletLights).
  for (const p of ch.pools ?? []) if (palAt(p.x, p.y) === 'violet') put('chaos-pool', p.x + (p.w - 1) / 2, p.y + (p.h - 1) / 2, '#C9DEF5', 2.6, 0.54, 0.34);
  for (const p of ch.portals ?? []) {
    const pal = palAt(p.x, p.y);
    const col = PAIR_COL[pal] ?? (pairs.indexOf(p.pairId) % 2 ? '#E5BA68' : '#78D5F1');
    if (pal === 'prism') put('chaos-portal', p.x + 0.5, p.y + 0.5, col, 4, 0.96, 0.5);
    else if (pal === 'violet') put('chaos-portal', p.x + 0.5, p.y + 0.5, col, 4.3, 0.98, 0.72);
    else put('chaos-portal', p.x + 0.5, p.y + 0.5, col, 4.2, 0.98, pal === 'cinder' ? 0.65 : 0.72);
    // Justin's pick (sandbox, 2026-10-16, Chaos improvement 1): an island's way on (the portal to the next island) sends up
    // the way-out column once seen, as the stairs do (beacons.js), so the exit reads from across the island.
    const dest = ch.portals.find(q => q.id === p.destinationId), here = ch.regions.findIndex(r => r.id === p.region);
    if (dest && ch.regions.findIndex(r => r.id === dest.region) > here) floor.lights[floor.lights.length - 1].way = true;
  }
  for (const c of [ch.currents?.up, ch.currents?.down]) if (c) floor.lights.push({ kind: 'beacon', role: 'chaos-current', realmLight: true, x: c.x, y: c.y, colour: '#9DEEFF', radius: 3.2, strength: 0.85, height: 1.1, way: c === ch.currents.down });   // island 5's way on
}
