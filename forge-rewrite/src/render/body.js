// The one body interface (consolidation N1, render-17): every look's body sprite (actor-sprite.js, living-flame.js,
// looks/blocks.js) is made by asBody(own), so the map and playback call any method on any body.
// A method a look has no use for does nothing; a getter reads as a body that is plain, single-tile and not a hero.
// Also the filters a body wears: the hit flash and the echo's ghost (ghostMatrix, moved from actor-sprite.js in N3).

import { ColorMatrixFilter } from '../../../forge-godot/runtime/pixi.js';
import ui from '../../data/ui.json' with { type: 'json' };

const HIT = ui.motion.hit;

const BASE = {
  /** Plays a clip; resolves with its run identity at its end (at once for a look with no clips). */
  play() { return Promise.resolve(); },
  /** An optional run identity lets deferred cleanup leave a replacement clip alone. */
  idle() {},
  /** How long a clip runs once, in ms; null when the look does not know (the caller keeps its own cap). */
  clipMs() { return null; },
  calm() {},
  stir() {},
  wear() {},
  face() {},
  watch() {},
  flash() {},
  ghost() {},
  shadeSummon() {},
  rim() {},
  fade() {},
  rise() {},
  lower() {},
  sleep() {},
  channel() {},
  charge() {},
  get action() { return 'idle'; },
  get animation() { return null; },
  /** Its step's arc (playback's slide): its height in tiles (item 78's one low hop). */
  get step() { return { hop: 0.05 }; },
  /** Whether it fades out its own death (playback then leaves it be). */
  get fadesOwnDeath() { return false; },
  get mirrored() { return false; },
  get size() { return 1; },
  get hero() { return false; },
  get sheet() { return null; },
  get texture() { return null; },
  get destroyed() { return this.root.destroyed; },
};

/** A body: `own` (getters kept as getters) over the no-op defaults. own.root is the body's display root. */
export const asBody = own => Object.create(BASE, Object.getOwnPropertyDescriptors(own));

/**
 * 1.7's hit: a white flash fading from 85% and a sideways shake, both over 220 ms (js/runtime/game.js:270-272
 * @3c8b312), ending by itself. `filtered` wears the flash over base() (the filters it always wears), `shaken` moves.
 * frame(d) advances it by d ms of game time; start() begins it again.
 */
export function hitFlash({ filtered, shaken = filtered, clock, tile, base = () => [] }) {
  const filter = new ColorMatrixFilter();
  let t = -1;
  const frame = d => {
    if (t < 0) return;
    t += d;
    const p = t / HIT.ms;
    if (p >= 1) { t = -1; filtered.filters = base(); shaken.x = 0; return; }
    const k = HIT.flash * (1 - p);
    filter.matrix = whiten(k);
    shaken.x = clock.reduced ? 0 : Math.sin(p * HIT.shakeFreq) * tile * HIT.shakeTiles * (1 - p);
  };
  return {
    filter,
    frame,
    start() { t = 0; filtered.filters = [...base(), filter]; frame(0); },
    /** Whether a hit is running now. */
    get on() { return t >= 0; },
  };
}

/** The colour matrix that lifts every channel k of the way to white. */
export const whiten = k => [1 - k, 0, 0, 0, k, 0, 1 - k, 0, 0, k, 0, 0, 1 - k, 0, k, 0, 0, 0, 1, 0];

/**
 * RC10: 1.7's shadow clone filter, 'grayscale(1) brightness(.78) sepia(.6) hue-rotate(205deg) saturate(1.5)'
 * (render.js:1174), as one colour matrix (the CSS Filter Effects formulas, applied left to right). Pixi's 4x5 layout.
 */
export function ghostMatrix() {
  const mul = (a, b) => a.map((r, i) => r.map((_, j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
  const L = [0.2126, 0.7152, 0.0722], gray = [L, L, L], bright = [[0.78, 0, 0], [0, 0.78, 0], [0, 0, 0.78]];
  const k = 1 - 0.6, sepia = [[0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k], [0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k], [0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k]];
  const c = Math.cos(205 * Math.PI / 180), n = Math.sin(205 * Math.PI / 180);
  const hue = [[0.213 + c * 0.787 - n * 0.213, 0.715 - c * 0.715 - n * 0.715, 0.072 - c * 0.072 + n * 0.928],
    [0.213 - c * 0.213 + n * 0.143, 0.715 + c * 0.285 + n * 0.140, 0.072 - c * 0.072 - n * 0.283],
    [0.213 - c * 0.213 - n * 0.787, 0.715 - c * 0.715 + n * 0.715, 0.072 + c * 0.928 + n * 0.072]];
  const t = 1.5, sat = [[0.213 + 0.787 * t, 0.715 - 0.715 * t, 0.072 - 0.072 * t], [0.213 - 0.213 * t, 0.715 + 0.285 * t, 0.072 - 0.072 * t], [0.213 - 0.213 * t, 0.715 - 0.715 * t, 0.072 + 0.928 * t]];
  const m = [sat, hue, sepia, bright, gray].reduce((acc, x) => mul(acc, x));
  return [...m[0], 0, 0, ...m[1], 0, 0, ...m[2], 0, 0, 0, 0, 0, 1, 0];
}
