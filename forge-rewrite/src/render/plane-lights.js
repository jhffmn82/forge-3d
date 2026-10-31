// The planes' rock veins and cliff crystals (plane-anim.js) as faint, wide lights in their own colours (L28), handed to
// gatherLights as its extra lights (lighting.js).

import data from '../../data/lighting.json' with { type: 'json' };
import { hex } from './lights.js';
import { planeVeinSources } from './plane-anim.js';
import { planeSalt } from './realm-view.js';

const VL = data.rows.lights.vein;
const spots = new WeakMap();

/** The vein and crystal lights of a plane floor now (a crystal only while its rock cell is in sight); [] elsewhere. */
export function planeVeinLights(state, relief) {
  const floor = state.floor;
  if (!floor.plane) return [];
  if (!spots.has(floor)) {
    spots.set(floor, planeVeinSources(floor, planeSalt(floor)).map(v => {
      const row = VL[v.kind] ?? VL.vein, crystal = v.kind === 'crystal', cy = Math.floor(v.y), cx = Math.floor(v.x);
      // A cliff crystal (1.7 planeterrain.js:665-675): hangs 0.8 down its face, looks out from the floor below, violet on
      // the Shadow plane in relief, lit only while its rock cell is in sight.
      return crystal
        ? { kind: 'vein-crystal', x: v.x, y: cy + 1.3, tx: cx, ty: cy + 1, cell: cy * floor.w + cx, colour: v.colour, shadowRelief: row.shadowRelief, r: row.radius, s: row.strength, z: row.height, wr: row.wallRadius, ws: row.wallStrength }
        : { kind: 'vein', x: v.x, y: v.y, tx: cx, ty: cy, c: hex(v.colour), r: row.radius, s: row.strength, z: row.height, wr: row.wallRadius, ws: row.wallStrength, pulse: row.pulse ?? 0 };
    }));
  }
  return spots.get(floor).flatMap(L => {
    if (L.kind !== 'vein-crystal') return [L];
    if (!state.vis?.[L.cell]) return [];
    return [{ ...L, c: hex(relief && floor.plane === 'shadow' && L.shadowRelief ? L.shadowRelief : L.colour) }];
  });
}
