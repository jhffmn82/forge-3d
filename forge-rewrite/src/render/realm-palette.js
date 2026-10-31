// The Chaos islands' palettes for borrowed art (M10, render-28: moved out of realm-view.js): which support a prop
// stands on per island, and the regrade of a picture into an island's palette, made once per picture.

import { Rectangle, Texture } from '../../../forge-godot/runtime/pixi.js';

// The palette maps 1.7 lays over shared prop art on each island (chaos-preview-render.js objectArt, rotObjectArt,
// cinderObjectArt, violetObjectArt): each kind maps luminance onto its own low-high ramp.
const PRISM_SUPPORTS = { 'grave-pillar': 'pillar', statue: 'statue', 'statue-broken': 'statue', 'table-candle': 'table', 'portal-arch': 'arch', archway: 'arch',
  'door-wood': 'door', 'door-wood-side': 'door', 'door-wood-open': 'door', 'door-iron': 'door', 'door-iron-side': 'door' };
const CINDER_SUPPORTS = { 'grave-pillar': 'stone', 'weapon-rack': 'iron', 'banner-stand': 'banner', 'brazier-unlit': 'iron', 'table-candle': 'table', chains: 'iron', rubble: 'stone', barrel: 'wood', cage: 'iron',
  'door-wood': 'wood', 'door-wood-side': 'wood', 'door-wood-open': 'wood', 'door-iron': 'iron', 'door-iron-side': 'iron' };
function mapper(pal, name) {
  const ramp = (lo, hi, t) => [lo, hi, t];
  if (pal === 'rot') {
    const kind = /mushroom/.test(name) ? 'fungus' : /root|vine/.test(name) ? 'root' : /moss|fern/.test(name) ? 'moss' : /boulder|rubble|stalagmit|stepping-stone/.test(name) ? 'rock' : null;
    if (!kind) return null;
    const amber = /(?:small-mushrooms-3|giant-mushroom-3|mushroom-pair-1)$/.test(name);
    return (r, g, b, lum) => {
      const t = Math.pow(Math.max(0, Math.min(1, (lum - 14) / 219)), 0.82);
      if (kind === 'moss' || (kind === 'rock' && g > r * 1.07)) return ramp([37, 58, 21], [184, 212, 87], t);
      if (kind === 'root') return ramp([51, 35, 18], [225, 209, 165], t);
      if (kind === 'fungus') { const colored = Math.max(r, g, b) - Math.min(r, g, b) > 25; return ramp(colored ? (amber ? [93, 39, 11] : [57, 77, 18]) : [67, 55, 31], colored ? (amber ? [255, 198, 75] : [207, 236, 112]) : [246, 231, 183], t); }
      return ramp([64, 49, 28], [228, 205, 156], t);
    };
  }
  if (pal === 'violet') {
    const kind = /^violet-/.test(name) ? null : /crystal/.test(name) ? 'crystal' : /mushroom|cave-pearls/.test(name) ? 'pearl' : /web|silk|root|vine/.test(name) ? 'silk' : /boulder|rubble|stalagmit|stepping-stone/.test(name) ? 'rock' : /moss|fern/.test(name) ? 'foliage' : /pillar|statue|door|table-candle/.test(name) ? 'silver' : null;
    if (!kind) return null;
    return (r, g, b, lum) => {
      const t = Math.pow(Math.max(0, Math.min(1, (lum - 14) / 219)), 0.8);
      if (kind === 'crystal') return ramp([59, 31, 101], /water|blue/.test(name) ? [174, 219, 250] : [224, 175, 254], t);
      if (kind === 'pearl') { const colored = Math.max(r, g, b) - Math.min(r, g, b) > 25; return ramp(colored ? [71, 37, 91] : [89, 72, 103], colored ? [221, 170, 226] : [247, 226, 245], t); }
      if (kind === 'silk' || kind === 'silver') return ramp([66, 58, 87], [232, 223, 246], t);
      if (kind === 'foliage') return ramp([54, 38, 74], [177, 133, 189], t);
      return ramp([62, 43, 86], [205, 173, 227], t);
    };
  }
  if (pal === 'cinder') {
    const kind = CINDER_SUPPORTS[name]; if (!kind) return null;
    return (r, g, b, lum, y) => {
      if (kind === 'table' && y < 0.31 && lum > 90) return null;
      const warm = r > b * 1.2 && r - g > 9, t = Math.pow(Math.max(0, Math.min(1, (lum - 16) / 220)), 0.82);
      if (kind === 'banner' && Math.max(r, g, b) - Math.min(r, g, b) > 30) return ramp([60, 14, 22], [211, 66, 45], t);
      if (warm && kind !== 'stone' && kind !== 'wood') return ramp([66, 42, 24], [239, 185, 96], t);
      if (kind === 'stone' || kind === 'wood' || kind === 'table') return ramp([61, 34, 30], [207, 150, 116], t);
      return ramp([31, 32, 35], [173, 167, 155], t);
    };
  }
  if (pal === 'prism') {
    const kind = PRISM_SUPPORTS[name]; if (!kind) return null;
    return (r, g, b, lum, y) => {
      const warm = r > b * 1.2 && r - g > 7, neutral = Math.max(r, g, b) - Math.min(r, g, b) < 34;
      if (kind === 'table' && y < 0.31 && lum > 90) return null;
      let m = 'cobalt';
      if (kind === 'table') { if (y >= 0.3 && y < 0.49 && warm) m = 'gold'; }
      else if (kind === 'door') m = warm ? (lum > 155 ? 'gold' : 'cobalt') : 'porcelain';
      else if (kind === 'arch') m = warm ? 'gold' : lum > 110 ? 'porcelain' : 'cobalt';
      else if (kind === 'statue') m = warm ? 'gold' : y > 0.8 ? 'cobalt' : 'porcelain';
      else m = warm ? 'gold' : g > r * 1.2 ? 'teal' : neutral && lum > 75 ? 'porcelain' : 'cobalt';
      const t = Math.pow(Math.max(0, Math.min(1, (lum - 18) / 210)), 0.78);
      return m === 'gold' ? ramp([61, 43, 20], [255, 225, 135], t) : m === 'porcelain' ? ramp([30, 55, 93], [236, 247, 255], t) : m === 'teal' ? ramp([13, 47, 83], [104, 231, 240], t) : ramp([8, 25, 67], [55, 143, 230], t);
    };
  }
  return null;
}
const recoloured = new Map();
export function recolour(tex, pal, name) {
  const fn = tex && pal && mapper(pal, name);
  if (!fn || typeof document === 'undefined') return tex;
  const key = `${pal}:${name}:${tex.uid}`;
  if (recoloured.has(key)) return recoloured.get(key);
  const f = tex.frame, c = document.createElement('canvas'); c.width = Math.max(1, Math.round(f.width)); c.height = Math.max(1, Math.round(f.height));
  const g = c.getContext('2d', { willReadFrequently: true });
  let out = tex;
  try {
    g.drawImage(tex.source.resource, f.x, f.y, f.width, f.height, 0, 0, c.width, c.height);
    const im = g.getImageData(0, 0, c.width, c.height), p = im.data;
    for (let i = 0; i < p.length; i += 4) {
      if (!p[i + 3]) continue;
      const r = p[i], gg = p[i + 1], b = p[i + 2], lum = 0.24 * r + 0.65 * gg + 0.11 * b, y = Math.floor(i / 4 / c.width) / c.height, m = fn(r, gg, b, lum, y);
      if (!m) continue;
      const [lo, hi, t] = m; for (let k = 0; k < 3; k++) p[i + k] = Math.round(lo[k] + (hi[k] - lo[k]) * t);
    }
    g.putImageData(im, 0, 0);
    const base = Texture.from(c);
    out = new Texture({ source: base.source, frame: new Rectangle(0, 0, c.width, c.height), orig: tex.orig.clone(), trim: tex.trim ? tex.trim.clone() : undefined, label: tex.label });
  } catch { out = tex; }
  recoloured.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------------------------- the pieces
