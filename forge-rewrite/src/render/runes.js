// Sigil runes, as 1.7 draws them (js/elements/runes.js:47-98 runeAtlas, :128 sigilArtName): each sigil kind wears its
// run's rune (rules/sigils.js runeOf), a glyph of light on the faintest wash, blue for an Elder Futhark rune and violet
// for a bind-rune. All of them are drawn once into one canvas atlas, so the floor, the bag and the hotbar share it.
// The cell is 128 px (1.7's was 64) so a rune stays sharp in a large hotbar slot on a dense screen; every length
// scales with the cell, as 1.7's did.

import { Rectangle, Texture } from '../../../forge-godot/runtime/pixi.js';
import runes from '../../data/runes.json' with { type: 'json' };
import { runeOf } from '../engine/reads.js';   // C17: the rules' answers through the engine (PLAN section 2)

const R = runes.rows, CELL = 128;
const NAMES = [...Object.keys(R).filter(k => R[k].kind === 'futhark'), ...Object.keys(R).filter(k => R[k].kind === 'bind-rune')];
let atlas = null;
const frames = new Map();

/** The atlas canvas and each rune's x (1.7 runeAtlas). Browser only. */
function build() {
  const C = CELL, cv = document.createElement('canvas');
  cv.width = C * NAMES.length; cv.height = C;
  const g = cv.getContext('2d'), pos = {};
  NAMES.forEach((n, i) => {
    const ox = i * C, dark = R[n].kind === 'bind-rune';
    const w = C * 0.62, hh = C * 0.78, x0 = ox + (C - w) / 2, y0 = (C - hh) / 2 + C / 64;
    // No tablet: the sigil is a glyph of light, so only the faintest wash sits behind it for contrast.
    const wash = g.createRadialGradient(x0 + w / 2, y0 + hh / 2, 1, x0 + w / 2, y0 + hh / 2, Math.max(w, hh) * 0.6);
    wash.addColorStop(0, dark ? 'rgba(40,30,60,0.32)' : 'rgba(24,40,58,0.26)');
    wash.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = wash; g.fillRect(x0, y0, w, hh);
    // The rune on its 10 x 14 grid, in three passes: a wide soft haze, the body of the glyph, then a bright core.
    const gx = x0 + w * 0.18, gy = y0 + hh * 0.12, sx = (w * 0.64) / 10, sy = (hh * 0.76) / 14;
    const stroke = () => { for (const line of R[n].glyph) { g.beginPath(); line.forEach(([px, py], j) => (j ? g.lineTo(gx + px * sx, gy + py * sy) : g.moveTo(gx + px * sx, gy + py * sy))); g.stroke(); } };
    g.save(); g.lineCap = 'round'; g.lineJoin = 'round'; g.globalCompositeOperation = 'lighter';
    g.shadowColor = dark ? RUNE_GLOW.bind : RUNE_GLOW.rune; g.shadowBlur = C * 0.34;
    g.globalAlpha = 0.38; g.strokeStyle = dark ? '#7A5CD8' : '#3D8FD8'; g.lineWidth = C * 0.1; stroke();
    g.shadowBlur = C * 0.18; g.globalAlpha = 0.8; g.strokeStyle = dark ? '#C9B8FF' : '#8FD6FF'; g.lineWidth = C * 0.05; stroke();
    g.shadowBlur = C * 0.06; g.globalAlpha = 0.95; g.strokeStyle = dark ? 'rgba(248,244,255,0.95)' : 'rgba(232,250,255,0.95)'; g.lineWidth = C * 0.018; stroke();
    g.restore();
    pos[n] = ox;
  });
  return { tex: Texture.from(cv), pos };
}

/** True for a rune art name ('rune-fehu'); 'rune-stone-light' and the other rune stones are props, not sigils. */
/** A rune's glow: blue for a rune, violet for a bind-rune (the sigil cast pulse takes it too, ui/core/pulse.js). */
export const RUNE_GLOW = { rune: '#6FC4FF', bind: '#B9A2FF' };
export const isRuneArt = name => typeof name === 'string' && name.startsWith('rune-') && R[name.slice(5)]?.glyph != null;

/** True for a bind-rune art name (the rare sigils' violet runes). */
export const isBindRune = name => isRuneArt(name) && R[name.slice(5)].kind === 'bind-rune';

/** The texture for 'rune-<name>' (1.7 runeObjectArt's crop of the atlas cell), or null for any other name. */
export function runeTexture(name) {
  if (!isRuneArt(name) || typeof document === 'undefined') return null;
  if (!frames.has(name)) {
    atlas ??= build();
    const x = atlas.pos[name.slice(5)];
    frames.set(name, new Texture({ source: atlas.tex.source, frame: new Rectangle(x + CELL * 0.16, CELL * 0.08, CELL * 0.68, CELL * 0.84) }));
  }
  return frames.get(name);
}

/** The art a sigil kind wears this run (1.7 sigilArtName): its rune, or the plain sigil before the run gives one. */
export function sigilArtName(state, id) {
  const look = state ? runeOf(state, id) : null;
  return look && R[look]?.glyph ? 'rune-' + look : 'item-sigil';
}
