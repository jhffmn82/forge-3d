// The fields the light reads off the Underdark's per-pixel caves (M10, render-28: moved out of underdark-raster.js):
// the relief light's kinds (relief.js setFineKinds) and 1.7's accent light from hot ground and lava seams (lightmap.js).

import { T } from '../data/tiles.js';
import { ROCK, DEEP_ROCK } from '../data/rock.js';
import { STYLE, S, texel } from './underdark-bake.js';
import { rockCol, fireFloor } from './underdark-rock.js';
import { outlineBelow, rockKind } from './fine-kinds.js';

/** The kinds and accent fields of a floor's caves (F: caveField; mat: the regions' floor, face and top pixels), each worked out the first time it is asked. */
export function caveLight(floor, F, mat) {
  const { W, H, R, wall, ptSalt, salt, need, pixReg, solid } = F;

  // The relief light's per-pixel kinds inside the raster cells (relief.js setFineKinds, L21), at KS samples a tile:
  // R 1 floor, 2 face, 3 top; G the rock's height above its outline (fine-kinds.js rockKind); B the region; A 255 inside.
  let kinds = null;
  const KS = 8;
  const kindsField = () => {
    if (kinds) return kinds;
    const w = W * KS, h = H * KS, data = new Uint8Array(w * h * 4);
    const rockAt = (wx, wy) => solid(wx, wy, STYLE[pixReg(wx, wy)]), solidAt = (gu, gv) => rockAt((gu + 0.5) / KS, (gv + 0.5) / KS);
    const below = outlineBelow(KS, solidAt, rockAt, 1.25);   // item 211: a face is a tile tall
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!need[y * W + x]) continue;
      for (let v = 0; v < KS; v++) for (let u = 0; u < KS; u++) {
        const gu = x * KS + u, gv = y * KS + v, q = (gv * w + gu) * 4, wx = (gu + 0.5) / KS, wy = (gv + 0.5) / KS;
        let k = 1, up = 0;
        if (solidAt(gu, gv)) ({ k, up } = rockKind(below(gu, gv), 1));
        data[q] = k; data[q + 1] = up; data[q + 2] = pixReg(wx, wy); data[q + 3] = 255;
      }
    }
    return (kinds = { S: KS, w, h, data });
  };
  // 1.7's accent light (environment-terrain.js accentProfile, accentPixels): open ground whose paint is hot gives a
  // little light of its own: the temple's still-glowing grout (gain 9, levelled to 0.27) and the lava veins of the
  // volcanic ground (the fire palette's vein axis, gain 18, levelled to 0.24). Four by four bins a tile, each the
  // average of its pixels' strength times the profile's colour; lava gives none, rock only through its seams. For the light map
  // (lightmap.js), which spills each bin half a tile and levels it as 1.7's accentFrame does.
  let accent = null;
  const AS = 16;   // samples a tile along each side (four a bin)
  const veinAxis = (() => {
    const V = ROCK.fire.vein, mean = (V[0] + V[1] + V[2]) / 3, ax = V.map(c => c - mean), len = Math.hypot(...ax), axis = ax.map(c => c / len);
    const proj = c => c[0] * axis[0] + c[1] * axis[1] + c[2] * axis[2];
    const edge = Math.max(...[ROCK.fire.floor, ROCK.fire.floorLav, ROCK.fire.mineralCool, ROCK.fire.pearl, ROCK.fire.band, ROCK.fire.top, ROCK.fire.topHi, ROCK.fire.topLo, ROCK.fire.face, ROCK.fire.lip].map(proj)), peak = Math.max(...V);
    return { axis, edge, span: Math.max(12, proj(V) - edge), color: V.map(c => c / peak) };
  })();
  const TEMPLE = { color: [1, 0.19, 0.045], ceiling: 0.27, gain: 9 }, VEIN = { ceiling: 0.24, gain: 18 };
  // Justin 2026-10-16: the caves' mineral veins give a weak diffuse light too. In the Underdark those are the lava seams
  // in the volcanic rock (deepRockCol's seams, the pixels the kernel keeps hot); the spider rock has none (its seams are
  // pale web strands). Only rock beside open ground is sampled: deeper rock lights nothing.
  const SEAM = { color: DEEP_ROCK[2].seam.map(c => c / 255), ceiling: 0.24, gain: 18 };
  const seamHeat = (wx, wy) => {
    let best = 0;
    for (const face of [false, true]) {
      const c = rockCol(2, wx, wy, salt, face, 0.5, false);
      if (c[0] > 130 && c[0] > c[1] * 1.45) best = Math.max(best, (c[0] - 130) / 125);
    }
    return best;
  };
  const accentField = () => {
    if (accent) return accent;
    const bins = new Float32Array(W * 4 * H * 4 * 3), level = new Float32Array(W * H * 2);
    let any = false;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, t = floor.tiles[i];
      if (t === T.LAVA || t === T.CHASM || t === T.WATER) continue;
      const raster = need[i] !== 0;
      if (wall[i] && !(need[i] === 1 && R[i] === 2)) continue;   // rock: only volcanic rock at a cave's edge has seams to light
      if (!raster && R[i] !== 0) continue;   // drawn by terrain.js from the spider sheet: no glow
      for (let v = 0; v < AS; v++) for (let u = 0; u < AS; u++) {
        const wx = x + (u + 0.5) / AS, wy = y + (v + 0.5) / AS;
        const rg = raster ? pixReg(wx, wy) : R[i];
        let col, str, prof;
        if (raster && solid(wx, wy, STYLE[rg])) {
          if (rg !== 2) continue;
          str = seamHeat(wx, wy); prof = SEAM;
        } else if (rg === 0) {
          col = texel(mat[0].floor, x, y, Math.floor(u * S / AS), Math.floor(v * S / AS));
          str = col[0] > col[1] * 1.25 && col[0] > col[2] * 1.5 ? Math.max(0, (col[0] - 120) / 90) : 0; prof = TEMPLE;
        } else if (rg === 2) {
          col = fireFloor(wx, wy, ptSalt);
          str = (col[0] * veinAxis.axis[0] + col[1] * veinAxis.axis[1] + col[2] * veinAxis.axis[2] - veinAxis.edge) / veinAxis.span; prof = veinAxis;
        } else continue;
        if (str <= 0.08) continue;
        str = Math.min(1, str) / (AS * AS / 16);
        const b = ((y * 4 + Math.floor(v * 4 / AS)) * W * 4 + x * 4 + Math.floor(u * 4 / AS)) * 3;
        for (let k = 0; k < 3; k++) bins[b + k] += prof.color[k] * str;
        const lv = prof === TEMPLE ? TEMPLE : prof === SEAM ? SEAM : VEIN; level[i * 2] = lv.ceiling; level[i * 2 + 1] = lv.gain;
        any = true;
      }
    }
    return (accent = any ? { bins, level, w: W * 4, h: H * 4, perTile: 4 } : null);
  };
  return { kindsField, accentField };
}
