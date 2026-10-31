// The shapes the shadow mask is drawn from (shadows.js): each frame of art's masks (its silhouette, its feet, its cast,
// its outline as rounded sections), 1.7's tip fade, and a solid prop's loft (projected-shadows.js @3c8b312, as output).

import { Geometry, GlProgram, Graphics, Mesh, Shader, Texture } from '../../../forge-godot/runtime/pixi.js';
import data from '../../data/lighting.json' with { type: 'json' };

const SH = data.rows.pipeline.shadow;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** The masks one frame of art casts, built once each (1.7 maskFor and castMask, at 1.7's mask size). allow.left: masks
 *  still allowed this frame (each costs a few ms of canvas work); readable: whether a texture's pixels can be read. */
const masks = new WeakMap();
export function maskFor(tex, readable, allow) {
  let m = masks.get(tex);
  if (m) return m;
  if (allow.left <= 0 || !readable(tex.source)) return null;
  allow.left--;
  const src = tex.source, res = src.resolution ?? 1, fr = tex.frame;
  const sw = fr.width * res, sh = fr.height * res, k = Math.min(1, SH.maskSize / Math.max(sw, sh));
  const w = Math.max(1, Math.ceil(sw * k)), h = Math.max(1, Math.ceil(sh * k)), pad = 18;
  const make = () => { const c = document.createElement('canvas'); c.width = w + pad * 2; c.height = h + pad * 2; return c; };
  const scratch = make(), g = scratch.getContext('2d', { willReadFrequently: true });
  g.drawImage(src.resource, fr.x * res, fr.y * res, sw, sh, pad, pad, w, h);
  const px = g.getImageData(pad, pad, w, h).data;
  let left = w, top = h, right = 0, bottom = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 16) { left = Math.min(left, x); right = Math.max(right, x + 1); top = Math.min(top, y); bottom = Math.max(bottom, y + 1); }
  if (!bottom) { m = { empty: true }; masks.set(tex, m); return m; }
  // The feet: the lowest 32% of the opaque height, their alpha-weighted centre and the 10-90% width of their mass.
  const footTop = Math.max(top, bottom - Math.max(2, Math.ceil((bottom - top) * 0.32)));
  let footLeft = w, footRight = 0, mass = 0, moment = 0;
  const cols = new Float32Array(w);
  for (let y = footTop; y < bottom; y++) for (let x = left; x < right; x++) {
    const a = px[(y * w + x) * 4 + 3];
    if (a > 16) { footLeft = Math.min(footLeft, x); footRight = Math.max(footRight, x + 1); cols[x] += a; mass += a; moment += (x + 0.5) * a; }
  }
  if (footRight <= footLeft) { footLeft = left; footRight = right; }
  let low = footLeft, high = footRight, cum = 0;
  for (let x = footLeft; x < footRight; x++) { cum += cols[x]; if (cum < mass * 0.1) low = x; if (cum < mass * 0.9) high = x + 1; }
  g.globalCompositeOperation = 'source-in'; g.fillStyle = '#000'; g.fillRect(0, 0, scratch.width, scratch.height);
  const sil = make(), sg = sil.getContext('2d');   // a fallen body rests on its own blurred silhouette (1.7 mask.canvas)
  sg.filter = 'blur(2px)'; sg.drawImage(scratch, 0, 0); sg.filter = 'none';
  // The cast: the silhouette softened, fading from the feet to the head as 1.7 fades a cast to its tip.
  const castOf = blur => {
    const c = make(), cg = c.getContext('2d');
    cg.filter = `blur(${blur}px)`; cg.drawImage(scratch, 0, 0); cg.filter = 'none';
    cg.globalCompositeOperation = 'destination-in';
    const fade = cg.createLinearGradient(0, pad + bottom, 0, pad + top);
    for (const [t, a] of SH.fade) fade.addColorStop(t, `rgba(0,0,0,${a})`);
    cg.fillStyle = fade; cg.fillRect(0, 0, c.width, c.height);
    return Texture.from({ resource: c, scaleMode: 'linear' });
  };
  // The contact: the feet, softened under a sharp copy, faded in from their top (1.7's gradient).
  const footW = footRight - footLeft, footH = bottom - footTop, feet = document.createElement('canvas');
  feet.width = footW + pad * 2; feet.height = footH + pad * 2;
  const fg = feet.getContext('2d');
  fg.filter = 'blur(1.4px)'; fg.drawImage(scratch, pad + footLeft, pad + footTop, footW, footH, pad, pad, footW, footH);
  fg.filter = 'none'; fg.drawImage(scratch, pad + footLeft, pad + footTop, footW, footH, pad, pad, footW, footH);
  fg.globalCompositeOperation = 'destination-in';
  const ff = fg.createLinearGradient(0, pad, 0, pad + footH);
  ff.addColorStop(0, 'transparent'); ff.addColorStop(0.3, '#000'); ff.addColorStop(0.82, '#000'); ff.addColorStop(1, 'rgba(0,0,0,.35)');
  fg.fillStyle = ff; fg.fillRect(0, 0, feet.width, feet.height);
  m = {
    unit: k * res, w, h, pad, left, top, right, bottom, footLeft, footTop, footW, footH,
    supportX: mass ? moment / mass : (left + right) / 2, supportWidth: Math.max(1, high - low),
    baseInset: roundedBaseInset(px, w, left, top, right, bottom), volume: volumeProfile(px, w, left, top, right, bottom, coverageOf(px, w, left, top, right, bottom)),
    cast: castOf(4), castDiffuse: castOf(5), feet: Texture.from({ resource: feet, scaleMode: 'linear' }), sil: Texture.from({ resource: sil, scaleMode: 'linear' }),
  };
  masks.set(tex, m);
  return m;
}

/** 1.7 volumeProfile (projected-shadows.js:53-75): the outline as rounded sections, one per height band (at most 24
 *  bands, the two strongest runs in each), linked where they touch the band below; base: the lowest band's sections. */
export function volumeProfile(px, w, left, top, right, bottom, coverage = 0.7) {
  const nodes = [], links = [], step = Math.max(1, Math.ceil((bottom - top) / 24));
  let previous = [], base = [];
  for (let y = top, end; y < bottom; y = end) {
    end = Math.min(bottom, y + step); if (bottom - end < step) end = bottom;
    const columns = new Float32Array(w), runs = [];
    for (let x = left; x < right; x++) for (let row = y; row < end; row++) { const a = px[(row * w + x) * 4 + 3]; if (a > 32) columns[x] += a; }
    let start = -1, mass = 0;
    for (let x = left; x <= right; x++) {
      if (x < right && columns[x] > 0) { if (start < 0) start = x; mass += columns[x]; }
      else if (start >= 0) { runs.push({ left: start, right: x, mass }); start = -1; mass = 0; }
    }
    runs.sort((a, b) => b.mass - a.mass); runs.length = Math.min(runs.length, 2); runs.sort((a, b) => a.left - b.left);
    const current = [];
    for (const run of runs) {
      const i = nodes.length;
      nodes.push({ x: (run.left + run.right) / 2, y: end === bottom ? bottom : y === top ? top : (y + end) / 2, r: (run.right - run.left) / 2 });
      current.push(i);
      for (const q of previous) { const o = nodes[q]; if (run.left <= o.x + o.r + 1 && run.right >= o.x - o.r - 1) links.push([q, i]); }
    }
    previous = current; if (current.length) base = current;
  }
  // Dense, broad art gets squarer sections, sparse art round ones (1.7 sectionTemplate, projected-shadows.js:79-89, 223).
  return { nodes, links, base, power: clamp(1 - (coverage - 0.7) * 2.5, 0.3, 1) };
}

/** The opaque share of the art's box (1.7 coverage: alpha mass over the box, projected-shadows.js:176, 219). */
function coverageOf(px, w, left, top, right, bottom) {
  let mass = 0;
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) { const a = px[(y * w + x) * 4 + 3]; if (a > 16) mass += a / 255; }
  return mass / Math.max(1, (right - left) * (bottom - top));
}
const RING = Array.from({ length: 16 }, (_, i) => [Math.cos(i * Math.PI / 8), Math.sin(i * Math.PI / 8)]);
const templates = new Map();
/** A section's sixteen points: a superellipse, |cos|^p and |sin|^p (power 1 round, lower squarer). */
export const ring = (n, power = 1) => {
  let t = templates.get(power);
  if (!t) { t = RING.map(([c, s]) => [Math.sign(c) * Math.abs(c) ** power, Math.sign(s) * Math.abs(s) ** power]); templates.set(power, t); }
  return t.map(([c, s]) => [n.x + n.r * c, n.y + n.ry * s]);
};
/** 1.7 roundedBaseInset (projected-shadows.js:31-49): how far a curved base's front lip sits below its sides. */
function roundedBaseInset(px, w, left, top, right, bottom) {
  const span = right - left, low = Math.max(top, bottom - Math.ceil((bottom - top) * 0.32));
  const median = (from, to) => {
    const rows = [];
    for (let x = left + Math.ceil(span * from); x < left + Math.floor(span * to); x++) for (let y = bottom - 1; y >= low; y--) if (px[(y * w + x) * 4 + 3] > 128) { rows.push(y + 1); break; }
    if (rows.length < 2) return null;
    rows.sort((a, b) => a - b);
    return (rows[Math.floor((rows.length - 1) / 2)] + rows[Math.ceil((rows.length - 1) / 2)]) / 2;
  };
  const l = median(0.05, 0.15), c = median(0.4, 0.6), r = median(0.85, 0.95);
  if (l === null || c === null || r === null) return 0;
  if (c - Math.max(l, r) < 2 || Math.abs(l - r) > Math.max(2, (bottom - top) * 0.04)) return 0;
  return Math.min((bottom - top) * 0.2, bottom - (l + r) / 2);
}

let hoverTex = null;
export function hoverOval() {
  if (hoverTex) return hoverTex;
  const c = document.createElement('canvas'); c.width = 96; c.height = 48;
  const g = c.getContext('2d'), f = g.createRadialGradient(48, 48, 0, 48, 48, 48);
  f.addColorStop(0, '#000'); f.addColorStop(0.45, 'rgba(0,0,0,.82)'); f.addColorStop(0.8, 'rgba(0,0,0,.28)'); f.addColorStop(1, 'transparent');
  g.setTransform(1, 0, 0, 0.5, 0, 0); g.fillStyle = f; g.fillRect(0, 0, 96, 96);
  return (hoverTex = Texture.from({ resource: c, scaleMode: 'linear' }));
}

/** The body sprite inside an actor sprite (the one showing its frame), and the old ellipse under it. */
export function partsOf(s) {
  let body = null, ellipse = null;
  const walk = c => { for (const ch of c.children ?? []) { if (!body && ch.texture && ch.texture === s.texture) body = ch; walk(ch); } };
  walk(s.root);
  for (const ch of s.root.children) if (ch instanceof Graphics) { ellipse = ch; break; }
  return { body, ellipse };
}

/** A solid prop's loft (1.7 volumeStamp): the base at full; each section slid away from the light by its height,
 *  at the cast's density, fading to nothing over one tail length past the far edge of the footprint (1.7 fadeOrigin,
 *  projected-shadows.js:148-163, :612-622). Each section takes the fade at its centre's place along the tail; max joins
 *  them, so the part over the footprint stays dense. The edge is 1.7's two-ring feather, not a blur
 *  (projected-shadows.js:602-608): the outline stroked 4 feathers wide at 0.12 and 2 wide at 0.38, then filled, so
 *  outside it lie 0.45 for one feather and 0.12 for the next; a feather is 2 mask pixels for the contact, 5 for a cast
 *  and 7 for a broad light's (:499). */
export function loftParts(m, toRoot, foot, sectionScale, depth, supportWidth, bodyHeight) {
  const V = m.volume; if (!V?.nodes.length) return null;
  const aspect = clamp(depth / Math.max(1, supportWidth), 0.1, 0.36);
  const sec = V.nodes.map((n, i) => { const q = toRoot(n.x, n.y); return { dx: q.x - foot.x, z: V.base.includes(i) ? 0 : clamp((foot.y - q.y) / bodyHeight, 0, 1), r: Math.max(0.25, n.r * sectionScale) }; });
  for (const a of sec) a.ry = Math.min(a.r * (aspect + (1 - aspect) * Math.min(1, a.z / 0.25)), bodyHeight * 0.18);
  return { sec, base: V.base, links: V.links, power: V.power ?? 1, feather: n => Math.max(0.75, sectionScale * n) };
}

/** The footprint's far edge along a unit direction: the base sections' farthest reach that way (1.7 fadeOrigin). */
export const edgeAlong = (L, ux, uy) => L.base.reduce((e, i) => { const a = L.sec[i]; return Math.max(e, a.dx * ux + a.r * Math.abs(ux) + a.ry * Math.abs(uy)); }, 0);

// 1.7's two-ring feather (projected-shadows.js:602-608): rings grown by two feathers at .12 and one at .38 over .12
// (.45 together), then the fill.
const LEVELS = feather => [[2 * feather, 0.12], [feather, 1 - 0.88 * 0.62]];

/** The contact: the base sections at the anchor, filled and feathered; drawn once a prop (they never move). */
export function contactShape(g, L, fade) {
  const f = L.feather(SH.feather.contact);
  for (const [grow, a] of [...LEVELS(f), [0, SH.contactFill]]) for (const i of L.base) {
    const q = L.sec[i];
    g.poly(ring({ x: q.dx, y: 0, r: q.r + grow, ry: q.ry + grow }, L.power).flat()).fill({ color: 0, alpha: fade * a });
  }
}

/**
 * A cast as one mesh, made once a prop and light kind: every section's rings and the strips joining linked sections, at
 * the anchor; its shader slides each section away from the light by its height and fades the tail (uniforms per frame:
 * uRay, uLoft), so a moving light rebuilds nothing.
 */
let loftProgram = null;
export function castMesh(L, diffuse) {
  const f = L.feather(diffuse ? SH.feather.diffuse : SH.feather.cast), pos = [], sec = [], lvl = [], idx = [];
  for (const [grow, level] of [...LEVELS(f), [0, SH.castDensity]]) {
    const first = L.sec.map(s => {
      const c = pos.length / 2;
      pos.push(s.dx, 0); sec.push(s.z, s.dx); lvl.push(level);
      for (const [x, y] of ring({ x: s.dx, y: 0, r: s.r + grow, ry: s.ry + grow }, L.power)) { pos.push(x, y); sec.push(s.z, s.dx); lvl.push(level); }
      for (let k = 0; k < 16; k++) idx.push(c, c + 1 + k, c + 1 + (k + 1) % 16);
      return c + 1;
    });
    for (const [a, b] of L.links) for (let k = 0; k < 16; k++) { const k1 = (k + 1) % 16; idx.push(first[a] + k, first[a] + k1, first[b] + k, first[a] + k1, first[b] + k1, first[b] + k); }
  }
  const geometry = new Geometry({ attributes: { aBase: { buffer: new Float32Array(pos), format: 'float32x2' }, aSec: { buffer: new Float32Array(sec), format: 'float32x2' },
    aLevel: { buffer: new Float32Array(lvl), format: 'float32' } }, indexBuffer: new Uint32Array(idx) });
  loftProgram ??= GlProgram.from({ vertex: LOFT_VERTEX, fragment: LOFT_FRAGMENT, name: 'shadow-loft' });
  const F = SH.fade, v4 = a => ({ value: new Float32Array(a), type: 'vec4<f32>' });
  const shader = new Shader({ glProgram: loftProgram, resources: { loft: { uRay: v4([0, 0, 0, 0]), uTip: v4([F[1][0], F[1][1], F[2][0], F[2][1]]), uLoft: v4([0, 0, 0, 0]) } } });
  const mesh = new Mesh({ geometry, shader });
  mesh.blendMode = 'max'; mesh.diffuse = diffuse;
  return mesh;
}

const LOFT_VERTEX = `#version 300 es
precision highp float;
in vec2 aBase;
in vec2 aSec;     // the section's share of the art's height, its offset across from the foot (px)
in float aLevel;  // the ring's alpha: a feather ring's or the fill's
out float vAlpha;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uRay;   // the tail's x, y and length (px), the footprint's far edge along it (px)
uniform vec4 uTip;   // the tip fade's middle stops: t, alpha, t, alpha (1 at 0, 0 at 1)
uniform vec4 uLoft;  // the cast's alpha
float tip(float t) { return t <= uTip.x ? mix(1.0, uTip.y, t / uTip.x) : t <= uTip.z ? mix(uTip.y, uTip.w, (t - uTip.x) / (uTip.z - uTip.x)) : mix(uTip.w, 0.0, (t - uTip.z) / (1.0 - uTip.z)); }
void main() {
  float len = uRay.z, t = len > 0.0 ? clamp((aSec.y * uRay.x / len + len * aSec.x - uRay.w) / len, 0.0, 1.0) : 0.0;
  vAlpha = uLoft.x * aLevel * tip(t);
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aBase + uRay.xy * aSec.x, 1.0)).xy, 0.0, 1.0);
}`;
const LOFT_FRAGMENT = `#version 300 es
precision highp float;
in float vAlpha;
out vec4 finalColor;
void main() { finalColor = vec4(0.0, 0.0, 0.0, vAlpha); }`;
