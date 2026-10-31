// The stage: which reference layout a screen gets, and how big it is in logical pixels.
// One rule for every device (docs/PLAN.md section 1). Nothing else in the game reads the window size.

import ui from '../../../data/ui.json' with { type: 'json' };

/** @typedef {{kind:'L'|'P', s:number, w:number, h:number, ox:number, oy:number, touch:boolean, textBump:number, form:'phone'|'tablet'|'desktop', short:boolean, narrow:boolean}} Stage */

const { L, P, phoneBelow, shortBelow, narrowBelow } = ui.stage;

/**
 * U5 (ui-20): what kind of device a stage is, decided here only. A touch screen whose short side is under phoneBelow CSS
 * px is a phone (1.7 study-small-touch), any other touch screen a tablet; a pointer screen is a desktop.
 * @param {{touch?:boolean, w:number, h:number, s?:number}} st
 */
export const formOf = st => (!st?.touch ? 'desktop' : Math.min(st.w, st.h) * (st.s ?? 1) < phoneBelow ? 'phone' : 'tablet');

/** The system's reduced-motion wish (the title film reads only this: CSS-13, 1.7 titleFilmPaused). */
export const systemReduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** U5 (ui-09): Options Motion, Off holding still, On moving, Auto (unset) following the system. */
export const reducedMotion = motion => motion === false || (motion !== true && systemReduced());

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * @param {number} cssW screen width in CSS pixels
 * @param {number} cssH screen height in CSS pixels
 * @param {boolean} touch the device's main input is a finger
 * @returns {Stage}
 */
export function computeStage(cssW, cssH, touch) {
  let kind, s, w, h;
  if (cssW >= cssH) {
    kind = 'L';
    s = Math.min(cssW / L.w, cssH / L.h);
    if (touch) s = Math.max(s, L.touchFloor);
    w = clamp(cssW / s, L.minW, L.maxW);
    h = clamp(cssH / s, L.minH, L.maxH);
  } else {
    kind = 'P';
    s = cssW > P.maxW ? cssW / P.maxW : cssW < P.minW ? cssW / P.minW : 1;
    w = clamp(cssW / s, P.minW, P.maxW);
    h = clamp(cssH / s, P.minH, P.maxH);
  }
  w = Math.floor(w);
  h = Math.floor(h);
  return {
    kind, s, w, h,
    ox: Math.round((cssW - w * s) / 2),
    oy: Math.round((cssH - h * s) / 2),
    touch,
    textBump: touch ? ui.stage.touchTextBump : 0,
    form: formOf({ touch, w, h, s }),
    short: kind === 'L' && h < shortBelow,   // a short laptop window (logical px)
    narrow: kind === 'P' && w < narrowBelow,   // an upright screen too narrow for the wide layouts (logical px)
  };
}

export { mapTilePx } from '../../render/map-tile.js';   // C17: the map's tile size is render's

/** True when the device's main pointer is a finger. */
export function isTouchDevice() {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/**
 * Watches the window and the device pixel ratio; calls back with the new stage.
 * The only resize listener in the game.
 * @param {(stage: Stage, cssW: number, cssH: number) => void} onChange
 */
export function watchStage(onChange) {
  const fire = () => {
    const cssW = window.innerWidth, cssH = window.innerHeight;
    onChange(computeStage(cssW, cssH, isTouchDevice()), cssW, cssH);
  };
  let pending = 0;
  const later = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(fire); };
  window.addEventListener('resize', later);
  const watchDpr = () => {
    matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', () => { later(); watchDpr(); }, { once: true });
  };
  watchDpr();
  // The media event does not always come (a page booted in a background tab, some screen moves), so the density
  // is also checked when the page shows again and once a second: one number compared, nothing drawn.
  let dpr = window.devicePixelRatio;
  const check = () => { if (window.devicePixelRatio !== dpr) { dpr = window.devicePixelRatio; later(); } };
  document.addEventListener('visibilitychange', check);
  setInterval(check, 1000);
  fire();
}
