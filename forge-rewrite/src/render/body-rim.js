// Two soft touches 1.7 gave a creature's picture, drawn behind its body in the figure's own cell space so they mirror,
// breathe and keel with it:
//  RC34 (1.7 render.js:1217-1227 whiteCut edge copies): a sheet with meta.edge gets four copies of its silhouette in
//    that colour, half a pixel out each way, at 24%; an older sheet (no facing art, not a chaos sheet) drawn as a foe
//    in sight gets eight white copies a tile/80 out at 7%, a faint pale rim that lifts it off the floor.
//  PT15 (1.7 planeterrain.js:1312-1316 prepareNaturalActor): on a plane or in the Caverns a single-tile body that is not
//    the hero carries a soft violet halo, canvas shadowColor rgba(70,60,96,.35) (a foe .175), blur max(2, tile x .06).
// The silhouettes are made per frame of art, once, a few a frame (as body-shadows.js makes its masks).

import { Container, Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import { readable } from './art-store.js';

export const RIM = {
  violet: 'rgb(70,60,96)', haloAlpha: 0.35, foeHaloAlpha: 0.175, haloBlurTiles: 0.06,
  edgeAlpha: 0.24, edgeUnits: 0.5, paleAlpha: 0.07, paleTiles: 1 / 80,
};

/** Whether a sheet is one of the older ones that wear the pale rim as a foe (1.7 paintedSheet: facing art or a chaos sheet). */
export const paleRimmed = (name, meta) => !meta?.facing && !/^mob-m-chaos-/.test(name ?? '');

/** The four (a coloured edge) or eight (the pale rim) offsets, in cell units. */
export function rimOffsets(coloured, d) {
  const o = [[-d, 0], [d, 0], [0, -d], [0, d]];
  if (!coloured) o.push([-d, -d], [d, -d], [-d, d], [d, d]);
  return o;
}

const made = new WeakMap();   // texture -> Map(key -> {tex, pad})
let budget = 0, budgetAt = -1;
function derive(tex, key, build) {
  let m = made.get(tex);
  if (!m) made.set(tex, m = new Map());
  if (m.has(key)) return m.get(key);
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  if (now - budgetAt > 12) { budget = 4; budgetAt = now; }
  if (budget <= 0 || !readable(tex.source)) return null;   // a parked sheet's picture is coming back; try then
  budget--;
  const src = tex.source, res = src.resolution ?? 1, fr = tex.frame, sw = Math.round(fr.width * res), sh = Math.round(fr.height * res);
  const out = build(src.resource, fr.x * res, fr.y * res, sw, sh);
  const v = { tex: Texture.from({ resource: out.canvas, scaleMode: 'linear', resolution: res }), pad: out.pad / res };
  m.set(key, v);
  return v;
}
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };
/** A frame's silhouette filled with one colour (1.7 whiteCut). */
const silhouette = colour => (img, x, y, w, h) => {
  const c = canvas(w, h), g = c.getContext('2d');
  g.drawImage(img, x, y, w, h, 0, 0, w, h);
  g.globalCompositeOperation = 'source-in'; g.fillStyle = colour; g.fillRect(0, 0, w, h);
  return { canvas: c, pad: 0 };
};
/** A frame's silhouette blurred (a canvas shadowBlur of b is a gaussian of b / 2) and filled violet. */
const halo = (sigma, colour) => (img, x, y, w, h) => {
  const pad = Math.ceil(sigma * 3) + 1, c = canvas(w + pad * 2, h + pad * 2), g = c.getContext('2d');
  g.filter = `blur(${sigma}px)`; g.drawImage(img, x, y, w, h, pad, pad, w, h); g.filter = 'none';
  g.globalCompositeOperation = 'source-in'; g.fillStyle = colour; g.fillRect(0, 0, c.width, c.height);
  return { canvas: c, pad };
};

/**
 * Puts the rim and halo behind `body` in `figure`; returns sync(), to be called after the body's frame is set.
 * o: { tile, scale (world px per cell unit), edge (meta.edge colour or null), pale (the faint white rim), halo (alpha, 0 for none),
 *   haloColour, haloBlurTiles (the plane's violet and 0.06 unless given; A24: the Crypt's pale lilac at 0.07) }
 */
export function attachRim(figure, body, o) {
  const back = new Container();
  figure.addChildAt(back, figure.getChildIndex(body));
  const res = () => body.texture?.source?.resolution ?? 1;
  const haloSprite = o.halo > 0 ? new Sprite() : null;
  if (haloSprite) { haloSprite.alpha = o.halo; back.addChild(haloSprite); }
  const coloured = !!o.edge, ring = coloured || o.pale ? rimOffsets(coloured, coloured ? RIM.edgeUnits : o.tile * RIM.paleTiles / o.scale) : [];
  const edges = ring.map(() => { const s = new Sprite(); s.alpha = coloured ? RIM.edgeAlpha : RIM.paleAlpha; back.addChild(s); return s; });
  const haloColour = o.haloColour ?? RIM.violet, sigmaKey = o.halo > 0 ? Math.max(0.5, Math.round(o.tile * (o.haloBlurTiles ?? RIM.haloBlurTiles) / 2 / o.scale * 4) / 4) : 0;
  let shown = null;
  return function sync() {
    const tex = body.texture;
    if (!tex || tex === Texture.EMPTY) return;
    const x0 = body.x - body.anchor.x * tex.orig.width, y0 = body.y - body.anchor.y * tex.orig.height;
    if (tex !== shown) {
      let done = true;
      if (haloSprite) {
        const h = derive(tex, 'halo:' + haloColour + ':' + sigmaKey * res(), halo(sigmaKey * res(), haloColour));
        haloSprite.visible = !!h;
        if (h) { haloSprite.texture = h.tex; haloSprite.position.set(x0 - h.pad, y0 - h.pad); } else done = false;
      }
      if (edges.length) {
        const e = derive(tex, 'sil:' + (o.edge ?? '#fff'), silhouette(o.edge ?? '#fff'));
        edges.forEach((s, i) => { s.visible = !!e; if (e) { s.texture = e.tex; s.position.set(x0 + ring[i][0], y0 + ring[i][1]); } });
        if (!e) done = false;
      }
      if (done) shown = tex;
    }
  };
}
