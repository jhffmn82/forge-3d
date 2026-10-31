// The map's tile size on the screen (consolidation C17, moved from ui/core/stage.js so the map reads its own layer).

import ui from '../../data/ui.json' with { type: 'json' };

const { phoneBelow } = ui.stage;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * RB36 (1.7 game.js resize, mobile.js applyZoom): how big a map tile stands on screen, in CSS px. 1.7 aimed at a tile
 * count across and down: 20 by 12 on a PC; on touch 15 by 15 on an upright phone, 20 by 20 on an upright tablet, 20
 * by 12 lying down. Map zoom (mul: Far 18/12, Normal 14/12, Close 1, Closest 10/12) scales the count, less one tile
 * each side; lying down the rows decide, upright the tighter of the two, between 15 and 72 px.
 * @param {number} cssW @param {number} cssH @param {boolean} touch @param {number} mul
 */
export function mapTilePx(cssW, cssH, touch, mul = 1) {
  const upright = cssH > cssW;
  const z = !touch ? [20, 12] : upright ? (cssW < phoneBelow ? [15, 15] : [20, 20]) : [20, 12];
  const across = Math.max(7, Math.round(z[0] * mul) - 2), down = Math.max(6, Math.round(z[1] * mul) - 2);
  return !upright ? Math.max(15, Math.floor(cssH / down)) : clamp(Math.floor(Math.min(cssW / across, cssH / down)), 15, 72);
}
