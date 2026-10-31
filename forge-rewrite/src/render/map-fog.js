// The map's fog and its High contrast filter (M10, render-28: moved out of map-view.js): the fog painter, 4 pixels a
// tile, feathered on its darker side and repainted only where sight changed, and the clarity filter the bodies share.

import { Filter, GlProgram } from '../../../forge-godot/runtime/pixi.js';
import { opaque, isWallTile } from '../data/tiles.js';

// RC32, 1.7 render.js:1097 CLARITY_FILTER 'brightness(1.2) drop-shadow(0px 0px 0.45px rgba(23,18,15,.55))': the body
// brightened, then a dark copy of its outline blurred by a 0.45 px Gaussian laid under it, so bodies and loot carry a
// faint dark keyline. The blur is in screen (CSS) pixels as the canvas filter's was: uRim.x is 0.45 times the
// renderer resolution, in texels. Premultiplied in and out.
const CLARITY_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 uRim;
void main() {
  vec4 c = texture(uTexture, vTextureCoord);
  vec3 rgb = c.a > 0.0 ? min(c.rgb / c.a * 1.2, vec3(1.0)) * c.a : vec3(0.0);
  float sd = max(uRim.x, 0.05), sum = 0.0, a = 0.0;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    vec2 o = vec2(float(x), float(y));
    float w = exp(-dot(o, o) / (2.0 * sd * sd));
    a += w * texture(uTexture, clamp(vTextureCoord + o * uInputSize.zw, uInputClamp.xy, uInputClamp.zw)).a;
    sum += w;
  }
  float sa = a / sum * 0.55;
  finalColor = vec4(rgb, c.a) + (1.0 - c.a) * vec4(vec3(23.0, 18.0, 15.0) / 255.0 * sa, sa);
}`;
const CLARITY_VERTEX = `#version 300 es
precision highp float;
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main() {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}`;
/** The High contrast filter (RC32): one per map view, shared by every body. setResolution keeps the rim 0.45 CSS px. */
export function clarityFilter() {
  const f = new Filter({
    glProgram: GlProgram.from({ vertex: CLARITY_VERTEX, fragment: CLARITY_FRAGMENT, name: 'clarity' }),
    resources: { clarity: { uRim: { value: new Float32Array([0.45, 0, 0, 0]), type: 'vec4<f32>' } } },
    padding: 3,
    resolution: 'inherit',   // the renderer's density: Filter's default of 1 would soften every body on a dense screen
  });
  f.setResolution = r => { f.resources.clarity.uniforms.uRim[0] = 0.45 * (r || 1); };
  return f;
}

/**
 * The fog's picture (spec/sight.md V11; sandbox: soft edges, a room keeps its wall row), kept across steps (movement
 * spec step 5: the fog rebuilt every step allocated 1.3 MB and ran in the step's gap). Per floor size it keeps the cells'
 * shade, the last step's and the pixels; each update recomputes the cells, repaints only the box of cells that changed
 * and one round it (a cell fades into its neighbours), and says which pixels changed. A cell is 0 in sight, `memory`
 * remembered and 1 never seen; a wall touching a floor cell in sight is in sight, one touching a remembered floor is
 * remembered. The fade lies on the darker side, as 1.7 (the sandbox lead's harness, 2026-10-18: ours dimmed the edge
 * tiles in sight to 0.45-0.65 of 1.7): a tile in sight stays clear to its edge, and a darker cell lightens toward a
 * brighter, see-through neighbour over `fade` of a tile inside itself (item 105: soft, not stepped). Nothing fades in
 * past a wall, a closed door or tall grass (Sandbox 92: never seen behind a wall stays black). Pixels: `fp` a tile,
 * alpha only. On natural rock (`rock`: the raster terrain of the Caverns, the planes, the Underdark) a rock cell is
 * in sight not by the square but by its distance from the see-through ground round it: clear to `rock[0]` of a tile
 * (1: the rock beside that ground, its face, as on built ground) and black by `rock[1]`, so the edge of sight rounds
 * the cave's own outline instead of stepping round its tiles (item 211, Justin 2026-10-19: "very jagged in plane of
 * light"). Ground behind the rock still never fades in.
 */
export function createFogPainter(fp = 4, fade = 0.5, rock = null) {
  let w = 0, h = 0, cellA = null, prev = null, open = null, prevOpen = null, stone = null, data = null, full = true;
  const ease = q => q * q * (3 - 2 * q), wallish = isWallTile;
  const known = (f, k, arr) => {
    if (arr[k]) return true;
    if (!wallish(f.tiles[k])) return false;
    const cx = k % f.w, cy = (k / f.w) | 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const nx = cx + ox, ny = cy + oy, j = ny * f.w + nx;
      if ((ox || oy) && nx >= 0 && ny >= 0 && nx < f.w && ny < f.h && arr[j] && !wallish(f.tiles[j])) return true;
    }
    return false;
  };
  const lighter = (cx, cy, own) => {
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const nx = cx + ox, ny = cy + oy, j = ny * w + nx; if ((ox || oy) && nx >= 0 && ny >= 0 && nx < w && ny < h && open[j] && cellA[j] < own) return true; }
    return false;
  };
  const reach = rock ? 2 : 1;   // how many cells round it a cell's paint reads
  const paintCell = (cx, cy) => {
    const c = cy * w + cx, byRock = rock && stone[c], own = byRock ? 1 : cellA[c], row = w * fp, edge = own > 0 && (byRock || lighter(cx, cy, own)), R = byRock ? 2 : 1;
    for (let v = 0; v < fp; v++) for (let u = 0; u < fp; u++) {
      let a = own;
      if (edge) {
        const px = (u + 0.5) / fp, py = (v + 0.5) / fp;
        for (let oy = -R; oy <= R; oy++) for (let ox = -R; ox <= R; ox++) {
          const nx = cx + ox, ny = cy + oy, j = ny * w + nx; if ((!ox && !oy) || nx < 0 || ny < 0 || nx >= w || ny >= h || !open[j]) continue;
          const na = cellA[j]; if (na >= a) continue;
          if ((ox * ox > 1 || oy * oy > 1) && !stone[(cy + oy - Math.sign(oy) * (oy * oy > 1)) * w + cx + ox - Math.sign(ox) * (ox * ox > 1)]) continue;   // two away: round the rock, never across unseen ground
          const dx = ox < 0 ? px - ox - 1 : ox > 0 ? ox - px : 0, dy = oy < 0 ? py - oy - 1 : oy > 0 ? oy - py : 0, d = Math.hypot(dx, dy);
          a = Math.min(a, na + (own - na) * ease(byRock ? Math.min(1, Math.max(0, d - rock[0]) / (rock[1] - rock[0])) : Math.min(1, d / fade)));
        }
      }
      data[((cy * fp + v) * row + cx * fp + u) * 4 + 3] = Math.round(a * 255);
    }
  };
  return {
    fp,
    /** The fog for floor `f` padded by `pad` cells: { w, h, data } (the same buffer every step of one floor size) and
     *  `dirty`, the changed pixels [x, y, w, h], or null when nothing changed. */
    update(f, vis, seen, memory, pad) {
      const W = f.w + pad * 2, H = f.h + pad * 2;
      if (W !== w || H !== h) { w = W; h = H; cellA = new Float32Array(w * h); prev = new Float32Array(w * h); open = new Uint8Array(w * h); prevOpen = new Uint8Array(w * h); stone = new Uint8Array(w * h); data = new Uint8ClampedArray(w * fp * h * fp * 4); full = true; }
      cellA.fill(1); open.fill(0); stone.fill(1);
      for (let fy = 0; fy < f.h; fy++) for (let fx = 0; fx < f.w; fx++) {
        const i = fy * f.w + fx, c = (fy + pad) * w + fx + pad;
        cellA[c] = known(f, i, vis) ? 0 : known(f, i, seen) ? memory : 1;
        open[c] = opaque(f, fx, fy) ? 0 : 1;   // the fade crosses from a see-through cell only
        stone[c] = wallish(f.tiles[i]) ? 1 : 0;
      }
      let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
      if (!full) {
        x0 = w; y0 = h; x1 = -1; y1 = -1;
        for (let i = 0; i < cellA.length; i++) if (cellA[i] !== prev[i] || open[i] !== prevOpen[i]) { const x = i % w, y = (i / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        if (x1 < 0) return { w: w * fp, h: h * fp, data, dirty: null };
        x0 = Math.max(0, x0 - reach); y0 = Math.max(0, y0 - reach); x1 = Math.min(w - 1, x1 + reach); y1 = Math.min(h - 1, y1 + reach);
      }
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) paintCell(cx, cy);
      prev.set(cellA); prevOpen.set(open); full = false;
      return { w: w * fp, h: h * fp, data, dirty: [x0 * fp, y0 * fp, (x1 - x0 + 1) * fp, (y1 - y0 + 1) * fp] };
    },
    /** The next update repaints everything (a new canvas). */
    reset() { full = true; },
  };
}
