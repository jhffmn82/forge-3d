// The rewrite's own light extra that Justin picked on 2026-10-16 and held until the light matched 1.7 (P5), turned on
// once it did (the sandbox lead, 2026-10-18), a data row in lighting.json. Pure: lights.js adds what these return.

import { T } from '../data/tiles.js';

/**
 * SB8: an open door spills its room's light: a soft light just inside the doorway, its colour the room's own lights
 * mixed by strength, so sight through the opening shapes it into a wedge across the corridor. own: the room's lights
 * so far (gatherLights' list). Returns plain light fields for gatherLights to complete.
 */
export function doorSpill(state, own, D) {
  const f = state.floor, rooms = f.rooms ?? [], out = [];
  if (!D?.on || !rooms.length) return out;
  const inRoom = (r, x, y) => (r.cells ? r.cells.includes(y * f.w + x) : x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  const lit = rooms.map(r => own.filter(l => !l.hero && inRoom(r, l.tx, l.ty)));
  for (let i = 0; i < f.tiles.length; i++) {
    if (f.tiles[i] !== T.OPEN_DOOR) continue;
    const x = i % f.w, y = Math.floor(i / f.w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = rooms.findIndex(r => inRoom(r, x + dx, y + dy) && !inRoom(r, x - dx, y - dy));
      if (k < 0 || !lit[k].length) continue;
      let sum = 0; const c = [0, 0, 0];
      for (const l of lit[k]) { sum += l.s; for (let j = 0; j < 3; j++) c[j] += l.c[j] * l.s; }
      out.push({ kind: 'door-spill', x: x + 0.5 + dx * D.inset, y: y + 0.5 + dy * D.inset, tx: x + dx, ty: y + dy, c: c.map(v => v / sum),
        r: D.radius, s: Math.min(D.cap, sum * D.share), falloff: D.falloff, z: D.height });
      break;
    }
  }
  return out;
}
