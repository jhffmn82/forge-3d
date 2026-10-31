// The lighting passes' pictures that are not light (lighting.js): typed arrays as textures, the halo and glow sprites'
// gradients, the vignette, the forge bowl's mask, sized render targets, and the Pixi target fix the passes need.

import { BufferImageSource, Rectangle, RenderTexture, Texture } from '../../../forge-godot/runtime/pixi.js';

/** A texture over a typed array we refill (nearest for bit and kind pictures, linear for fields). */
export function dataTexture(nearest) {
  return { tex: null, w: 0, h: 0, nearest };
}
/** Puts bytes (RGBA8, w x h) into a data texture, making it again only when its size changes; returns its source. */
export function upload(dt, w, h, bytes) {
  if (!dt.tex || dt.w !== w || dt.h !== h) {
    const old = dt.tex;
    dt.tex = new Texture({ source: new BufferImageSource({ resource: bytes, width: w, height: h, format: 'rgba8unorm', alphaMode: 'no-premultiply-alpha', scaleMode: dt.nearest ? 'nearest' : 'linear' }) });
    dt.w = w; dt.h = h; dt.bytes = bytes;
    old?.destroy(true);
  } else {
    if (dt.tex.source.resource !== bytes) dt.tex.source.resource = bytes;
    dt.tex.source.update();
  }
  return dt.tex.source;
}

/** A render target of this size, the old one kept while it still fits. */
export function sizedTarget(rt, sw, sh, res) {
  const key = sw + 'x' + sh + '@' + res;
  if (!rt || rt.key !== key) { rt?.destroy(true); rt = RenderTexture.create({ width: sw, height: sh, resolution: res }); rt.key = key; }
  return rt;
}

const radial = (size, from) => {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), h = size / 2, grad = g.createRadialGradient(h, h, from * h, h, h, h);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  return Texture.from({ resource: c, scaleMode: 'linear' });
};
const halos = new Map();
let glowTex = null;
/** 1.7's halo picture for a reach of r tiles (render.js:1376-1377): full to a fifth of a tile out, fading to the edge. */
export const haloTexture = r => { let t = halos.get(r); if (!t) { t = radial(128, Math.min(0.9, 0.2 / r)); halos.set(r, t); } return t; };
/** A soft round glow (a shot's trail, a landing flash). */
export const glowTexture = () => (glowTex ??= radial(64, 0));

/** The vignette over a screen this size (1.7 render.js:2437-2440), at a quarter resolution. */
export function vignetteTexture(sw, sh, V) {
  const c = document.createElement('canvas'), k = 0.25; c.width = Math.ceil(sw * k); c.height = Math.ceil(sh * k);
  const g = c.getContext('2d'), gr = g.createRadialGradient(c.width / 2, c.height / 2, Math.min(c.width, c.height) * V.inner, c.width / 2, c.height / 2, Math.max(c.width, c.height) * V.outer);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${V.alpha})`);
  g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
  return Texture.from({ resource: c, scaleMode: 'linear' });
}

/**
 * A piece's own normal cut to its art (item 258, Justin 2026-10-20: "the transparent part of this sprite seems to be
 * pooping on the relief"): the props' maps are RGB, so a frame's clear margin wrote its flat normal into the relief
 * band over the floor, and into the card pass's normals over whatever stands in it. Pixels: the normal's colour with
 * the art's alpha, its tilt across (red) turned for a mirrored sprite. In place on the normal's RGBA; returns it.
 */
export function cutPixels(normal, art, mirror = false) {
  for (let o = 0; o < normal.length; o += 4) {
    normal[o + 3] = art[o + 3];
    if (mirror && art[o + 3]) normal[o] = Math.min(255, 256 - normal[o]);
  }
  return normal;
}
/** cutPixels on a sprite's normal frame (nt) and its art (art, drawn at the normal's size); kept per normal frame and
 *  mirroring, null while either picture cannot be read. allow.left, if given: how many may still be made this frame
 *  (each is canvas work); past that, undefined, and the sprite waits a frame. */
const cuts = new WeakMap();
export function cutNormal(nt, art, mirror = false, allow = null) {
  const have = cuts.get(nt) ?? {}, k = mirror ? 'm' : 'n';
  if (k in have) return have[k];
  if (allow) { if (allow.left <= 0) return undefined; allow.left--; }
  const ns = nt.source, nr = ns.resolution ?? 1, nf = nt.frame, w = Math.max(1, Math.round(nf.width * nr)), h = Math.max(1, Math.round(nf.height * nr));
  const as = art.source, ar = as.resolution ?? 1, af = art.frame, img = as.resource;
  let m = null;
  if (ns.resource && img && (img.width || img.naturalWidth)) {
    try {
      const read = (src, x, y, sw, sh) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(src, x, y, sw, sh, 0, 0, w, h); return [cv, g, g.getImageData(0, 0, w, h)]; };
      const [cv, g, n] = read(ns.resource, nf.x * nr, nf.y * nr, w, h), [, , a] = read(img, af.x * ar, af.y * ar, af.width * ar, af.height * ar);
      cutPixels(n.data, a.data, mirror); g.putImageData(n, 0, 0);
      const base = Texture.from({ resource: cv, scaleMode: 'linear', resolution: nr });
      // Keep the diffuse frame's transparent margins: the pass copies its anchor and transform.
      const sx = base.width / af.width, sy = base.height / af.height;
      const scaled = r => new Rectangle(r.x * sx, r.y * sy, r.width * sx, r.height * sy);
      m = new Texture({ source: base.source, orig: scaled(art.orig), trim: art.trim ? scaled(art.trim) : undefined });
    } catch { m = null; }
  }
  have[k] = m; cuts.set(nt, have);
  return m;
}

/** A frame's silhouette in white (its alpha kept), so a tint sets its colour exactly; kept per frame, null for a
 *  texture with no picture to read. allow.left: how many may still be made this frame (each is canvas work); past
 *  that, undefined, and the sprite waits a frame. */
const whites = new WeakMap();
export function whiteSilhouette(tex, allow) {
  if (whites.has(tex)) return whites.get(tex);
  if (allow.left <= 0) return undefined;
  allow.left--;
  let m = null;
  const src = tex.source, img = src.resource, res = src.resolution ?? 1, fr = tex.frame, w = Math.max(1, Math.round(fr.width * res)), h = Math.max(1, Math.round(fr.height * res));
  if (img && (img.width || img.naturalWidth)) {
    try {
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const g = cv.getContext('2d');
      g.drawImage(img, fr.x * res, fr.y * res, w, h, 0, 0, w, h);
      g.globalCompositeOperation = 'source-in'; g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
      const base = Texture.from({ resource: cv, scaleMode: 'linear', resolution: res });
      m = new Texture({ source: base.source, orig: tex.orig.clone(), trim: tex.trim?.clone() });
    } catch { m = null; }
  }
  whites.set(tex, m);
  return m;
}

/** A grey tint for an emission strength 0-1. */
export const grey = v => { const g = Math.round(Math.max(0, Math.min(1, v)) * 255); return (g << 16) | (g << 8) | g; };

/** The lit forge's bowl of coals, cut from its art (the hot orange in the bowl's band), for the emission picture. */
const forgeMasks = new WeakMap();
export function forgeMask(tex) {
  let m = forgeMasks.get(tex);
  if (m) return m;
  const src = tex.source, res = src.resolution ?? 1, fr = tex.frame, w = Math.round(fr.width * res), h = Math.round(fr.height * res);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(src.resource, fr.x * res, fr.y * res, w, h, 0, 0, w, h);
  const im = g.getImageData(0, 0, w, h), d = im.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; if (!(y >= h * 0.42 && y < h * 0.59 && x >= w * 0.13 && x < w * 0.9 && d[o] > 135 && d[o + 1] > 90 && d[o] > d[o + 2] * 1.65)) d[o + 3] = 0; }
  g.putImageData(im, 0, 0);
  m = Texture.from({ resource: cv, scaleMode: 'linear' });
  forgeMasks.set(tex, m);
  return m;
}

/** Item 93: Pixi refreshes a cached chunk mid-frame and pops back to the wrong target inside a filter; after a refresh
 *  the target bound before it is bound again, as it was. */
export function keepTargetAfterCache(r) {
  const pipe = r?.renderPipes?.renderGroup, rts = r?.renderTarget;
  if (!pipe?._executeCacheAsTexture || !rts?._bindState || pipe.keepsTarget) return;
  const run = pipe._executeCacheAsTexture.bind(pipe);
  pipe._executeCacheAsTexture = group => {
    if (!group.textureNeedsUpdate) return run(group);
    const b = rts._bindState, was = { target: b.target, frame: b.frame?.clone(), mipLevel: b.mipLevel, layer: b.layer, flipY: b.flipY };
    run(group);
    if (was.target && rts._bindState.target !== was.target) rts.bind({ ...was, clear: false });
  };
  pipe.keepsTarget = true;
}
