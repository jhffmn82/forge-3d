// The Underdark caves' rock and the fire plane's ground, as colours per world point (M10, render-28: moved out of
// underdark-bake.js, which bakes them). Pure, so it runs on the main thread and in the 'deep' worker lane alike.

import { hash2, noise as ptVal, voronoi as ptVor } from '../lib/noise.js';
import { mixRgb as mix } from '../lib/colour.js';
import { ROCK, DEEP_ROCK } from '../data/rock.js';

// ---- cave rock colours by region (deeprender.js DEEP_ROCK, data/rock.js; the temple's caves borrow the spider rock)
// enhanceKernel palRow for the deep pass: tops graded .72, faces .58, faces rising to 85% of the lip.
export const GRADE = {};
for (const r of [0, 1, 2]) {
  const M = DEEP_ROCK[r], g = { topLow: [], topSpan: [], faceLow: [], faceSpan: [] };
  for (let k = 0; k < 3; k++) { const tl = M.topLo[k] * 0.72, fl = M.faceLo[k] * 0.58; g.topLow.push(tl); g.topSpan.push(M.topHi[k] * 0.72 - tl); g.faceLow.push(fl); g.faceSpan.push(M.lip[k] * 0.85 * 0.58 - fl); }
  GRADE[r] = g;
}
/** deepRockCol: the rock's own colour (its seams survive the master's grading as the kernel's energy). */
export function rockCol(rgn, wx, wy, salt, face, depth, lip) {
  const M = DEEP_ROCK[rgn] ?? DEEP_ROCK[1];
  if (face) {
    if (lip) return M.lip;
    const cf = ptVor(wx * 2.2, wy * 0.55, 0.55, salt + 21), shade = 0.86 + 0.2 * hash2(cf.ix, cf.iy, salt + 22);
    let col = mix(M.face, M.faceLo, Math.min(1, depth * 1.25)); col = [col[0] * shade, col[1] * shade, col[2] * shade];
    if (cf.d2 - cf.d1 < 0.03) col = mix(col, M.faceLo, 0.35);
    const fv = ptVor(wx * 1.6, wy * 0.9, 0.9, salt + 23), mk = ptVal(wx * 0.3, wy * 0.3, salt + 20);
    if (mk > (M.soft ? 0.62 : 0.45) && fv.d2 - fv.d1 < (M.soft ? 0.012 : 0.024)) col = mix(col, M.seamHot && fv.d2 - fv.d1 < 0.008 ? M.seamHot : M.seam, M.soft ? 0.5 : 1);
    return col;
  }
  const f = ptVor(wx, wy, M.soft ? 1.9 : 1.4, salt + 11), ang = Math.atan2(wy - f.sy, wx - f.sx), turn = hash2(f.ix, f.iy, salt + 13) * 6.28;
  const facet = Math.floor((((ang + turn) % 6.2832) + 6.2832) % 6.2832 / 1.2566), fa = facet * 1.2566 - turn + 0.628, lit = -(Math.cos(fa) * 0.7 + Math.sin(fa) * 0.7);
  let col = M.soft ? mix(M.topLo, M.topHi, 0.5 + lit * 0.35) : (lit > 0.35 ? M.topHi : lit > -0.35 ? M.top : M.topLo);
  const mot = (ptVal(wx * 3.2, wy * 3.2, salt + 15) - 0.5) * 9 + (ptVal(wx * 7.5, wy * 7.5, salt + 16) - 0.5) * 5;
  col = [col[0] + mot, col[1] + mot, col[2] + mot * 1.05];
  if (f.d2 - f.d1 < 0.03) {
    if (M.seamOn === 'both' && ptVal(wx * 0.4, wy * 0.4, salt + 24) > 0.42) col = mix(col, f.d2 - f.d1 < 0.008 ? (M.seamHot ?? M.seam) : M.seam, 0.62 * (1 - (f.d2 - f.d1) / 0.03));
    else col = mix(col, M.topLo, 0.55);
  }
  return col;
}

// ---- the fire plane's ground (planeterrain.js ptFloorColor with PT_MAT.fire): open volcanic rock, veined with lava
export function fireFloor(wx, wy, salt) {
  const M = ROCK.fire, tone = ptVal(wx * 1.8, wy * 1.8, salt + 32);
  let col = mix(M.floor, M.floorLav, 0.3 * ptVal(wx * 0.16, wy * 0.16, salt + 33) + 0.12 * tone);
  const lum = 1 + (tone - 0.5) * 0.035 + (hash2(Math.floor(wx * 128), Math.floor(wy * 128), salt + 34) - 0.5) * M.grain * 2;
  col = [col[0] * lum, col[1] * lum, col[2] * lum];
  const cool = ptVal(wx * 0.11, wy * 0.11, salt + 36);
  if (cool > 0.52) col = mix(col, M.mineralCool, Math.min(0.45, (cool - 0.52) * 2.4));
  const pearl = ptVal(wx * 0.19 + 7, wy * 0.19, salt + 37); if (pearl > 0.66) col = mix(col, M.pearl, Math.min(0.5, (pearl - 0.66) * 3));
  const bandR = ptVal(wx * 0.07, wy * 0.07, salt + 38);
  if (bandR > 0.64) { const bs = Math.sin((wx * 0.8 + wy * 0.45) * 4.2 + ptVal(wx * 0.5, wy * 0.5, salt + 39) * 2.5); if (bs > 0.82) col = mix(col, M.band, Math.min(0.55, (bandR - 0.64) * 4)); }
  const ribbon = wx * 0.57 + wy * 0.34 + (ptVal(wx * 0.31, wy * 0.31, salt + 40) - 0.5) * 3.1 + (ptVal(wx * 1.2, wy * 0.8, salt + 41) - 0.5) * 0.48;
  const distance = Math.abs(Math.sin(ribbon * 2.8)), width = 0.025 + 0.16 * ptVal(wx * 0.7, wy * 0.9, salt + 42), deposit = ptVal(wx * 0.45, wy * 0.64, salt + 43);
  if (deposit > 0.5 && distance < width) col = mix(col, distance < width * 0.17 ? M.veinHot : M.vein, Math.min(1, (deposit - 0.5) * 5) * Math.pow(1 - distance / width, 0.7) * 0.7);
  return col;
}

/** The top-left of cell (cx, cy) of a terrain sheet in its picture (wrapping as terrain.js picks it). */
