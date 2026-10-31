// The 3D build's look, set on the Sandbox window's View page (Justin 2026-10-27: "make sure it's the sandbox mode so i
// can jump through the levels and we can adjust graphics"). The 2D game's View page (src/ui/screens/sandbox.js: Art,
// Motion, Lighting, Zoom and its colour grade) sets how its own renderer draws, which the 3D build has none of; here the
// same page sets the 3D picture instead (scripts/main.gd apply_gfx), live as a slider moves, kept with the options.

import * as P from './pixi.js';
import { color, space } from '../../forge-rewrite/src/ui/core/widgets.js';
import { stack, split } from '../../forge-rewrite/src/ui/core/layout.js';
import { panel, PANEL_PAD } from '../../forge-rewrite/src/ui/core/blocks.js';
import { slider } from '../../forge-rewrite/src/ui/screens/options.js';

const ON = [[true, 'On'], [false, 'Off']];
// The camera's angles down to choose from, here and in Options (optionsWithCamera; Justin 2026-10-29: "can i see some
// different angle options? maybe put them in options").
const ANGLES = [30, 35, 40, 45, 50, 55, 60].map(a => [a, String(a)]);
/**
 * The settings by panel: [key, label, a slider's [low, high] (its middle the look as built) or choices [value, words],
 * 'pc' when only the PC build draws it (the browser's renderer has no haze, lens, bounced light, occlusion or
 * reflections)].
 */
const SECTIONS = [
  ['Light', [
    ['exposure', 'Brightness', [0, 2]],
    ['contrast', 'Contrast', [0.5, 1.5]],
    ['saturation', 'Colour', [0, 2]],
    ['ambient', 'Shade', [0, 2]],
    ['torches', 'Torches', [0, 2]],
    ['hero', "Hero's light", [0, 2]],
    ['bloom', 'Bloom', [0, 2]],
  ]],
  ['Air and lens', [
    ['haze', 'Haze', [0, 2], 'pc'],
    ['blur', 'Lens blur', [0, 2], 'pc'],
    ['vignette', 'Vignette', [0, 2]],
    ['particles', 'Dust and embers', ON],
    ['flicker', 'Torch flicker', ON],
  ]],
  ['Camera', [
    ['pitch', 'Angle', ANGLES],
    ['zoom', 'Zoom', [[1.25, 'Far'], [1, 'Normal'], [0.8, 'Close'], [0.65, 'Closest']]],
  ]],
  ['Quality', [
    ['shadows', 'Shadows', [['all', 'All'], ['nearest', 'Nearest 6'], ['hero', 'Hero only'], ['off', 'Off']]],
    ['aa', 'Antialiasing', [[4, '4x'], [2, '2x'], [0, 'Off']]],
    ['bounce', 'Bounced light', ON, 'pc'],
    ['ao', 'Occlusion', ON, 'pc'],
    ['reflections', 'Reflections', ON, 'pc'],
    ['scale', 'Resolution', [[0.5, '50%'], [0.75, '75%'], [1, '100%']]],
  ]],
];
const isSlider = spec => typeof spec[0] === 'number';

/** The look as built: every slider at its middle, every switch on, the game camera's 30 degrees. */
export const GFX_DEFAULTS = {
  ...Object.fromEntries(SECTIONS.flatMap(([, rows]) => rows.map(([k, , spec]) => [k, isSlider(spec) ? 1 : spec[0][0]]))),
  pitch: 55, zoom: 1, shadows: 'all', scale: 1, aa: 4,
};
/**
 * The browser build's look as built: its renderer draws a torch's shadow as six views of the room, so every torch
 * casting one held it to a few frames a second (Justin 2026-10-28: "lots of lag"); only the hero's light casts them,
 * and its edges are smoothed less. (Her lamp's shadows too, tried 2026-10-28: they brought some 140 more shaders to build
 * as she walked, and frames of a quarter second.)
 */
export const GFX_WEB = { ...GFX_DEFAULTS, shadows: 'off', aa: 2 };
const LABELS = Object.fromEntries(SECTIONS.flatMap(([, rows]) => rows.map(([k, label]) => [k, label])));
const PAGES = ['World', 'Hero', 'Creatures', 'Items', 'Rooms', 'Run', 'View'];

/** What differs from the look as built, in words (so the numbers can be read back and kept as the new look). */
export function gfxChanged(g, base = GFX_DEFAULTS) {
  const out = Object.entries(base).filter(([k, v]) => g[k] !== v).map(([k]) => `${LABELS[k].toLowerCase()} ${typeof g[k] === 'number' ? +g[k].toFixed(2) : g[k] === true ? 'on' : g[k] === false ? 'off' : g[k]}`);
  return out.length ? `Changed: ${out.join(', ')}.` : 'The look as built.';
}

/**
 * The Sandbox window, its View page this one: the 2D window is built as it is, and when its View tab is the one picked
 * (the tab words are buttons marked selected), its page is swapped for the 3D look's.
 * @param {{values:any, base:any, set:(k:string, v:any)=>void, reset:()=>void, pc:boolean}} g
 */
export function sandboxWithGraphics(build2d, kit, area, ctx, g) {
  let page = null;
  const button = kit.button;
  kit.button = (words, act, o = {}) => { if (!page && o.selected && PAGES.includes(words)) page = words; return button(words, act, o); };
  let root;
  try { root = build2d(kit, area, ctx); } finally { kit.button = button; }
  if (page !== 'View' || root.children.length < 2) return root;
  const old = root.children[1], body = buildGraphics(kit, area.w, g, ctx.reopen);
  body.position.set(old.x, old.y);
  root.removeChild(old);
  old.destroy({ children: true });
  root.addChild(body);
  return root;
}

/**
 * The Options window with a Camera panel at the foot of its shortest column: the camera's angle down (the View page's
 * Angle), a choice rebuilding the floor at it (main.gd apply_gfx).
 */
export function optionsWithCamera(build2d, kit, area, ctx, g) {
  const root = build2d(kit, area, ctx);
  const col = root.children.reduce((a, c) => (!a || c.height < a.height ? c : a), null);
  if (!col) return root;
  const sec = space.betweenSections, { w: cw } = split(area.w, area.w >= 900 ? 3 : area.w >= 600 ? 2 : 1, sec);
  // Its label, then its angles on one line, as the window's own rows (options.js optionRow); the one picked lit.
  const label = kit.text('Angle', { size: 16, fill: color.ink });
  kit.details(label, { title: 'Camera angle', lines: ['Degrees down from level: lower sees the rooms more from the side.', 'Keys: PgUp and PgDn (or ] and [) step it; = and - zoom in and out.'] });
  const row = new P.Container();
  let x = label.width + space.betweenRows * 2;
  for (const [v, words] of ANGLES) {
    const on = g.values.pitch === v;
    const b = kit.button(words, () => { g.set('pitch', v); ctx.deps?.cue?.('ui-click'); ctx.reopen(); }, { size: 16, font: 'body', selected: on, tight: !kit.stage.touch });
    if (on) {
      b.children.at(-1).style.fontWeight = '700';
      b.addChildAt(new P.Graphics().roundRect(2, 3, b.width - 4, b.height - 6, 4).fill({ color: kit.accent, alpha: 0.16 }), 0);
    }
    b.label = `opt-pitch-${v}`;
    b.x = x; x += b.width + 2;
    row.addChild(b);
  }
  label.y = Math.round(((row.children[0]?.height ?? label.height) - label.height) / 2);
  row.addChild(label);
  const cam = panel(kit, 'Camera', cw, row);
  cam.y = col.height + sec;
  col.addChild(cam);
  return root;
}

function buildGraphics(kit, w, g, reopen) {
  const sec = space.betweenSections, { w: cw, xs } = split(w, 2, sec), inner = cw - PANEL_PAD * 2;
  const widest = labels => { const ts = labels.map(t => kit.text(t, { size: 14 })), n = Math.max(...ts.map(t => t.width)); ts.forEach(t => t.destroy()); return n; };
  const lw = widest(SECTIONS.flatMap(([, rows]) => rows.map(r => r[1]))) + space.betweenRows;
  const note = kit.text(gfxChanged(g.values, g.base), { size: 14, fill: color.dim, wrap: cw });
  const change = (k, v, again) => { g.set(k, v); note.text = gfxChanged(g.values, g.base); if (again) reopen(); };

  const line = ([k, label, spec]) => {
    const c = new P.Container(), t = kit.text(label, { size: 14 });
    if (isSlider(spec)) {
      const [lo, hi] = spec, val = kit.text(g.values[k].toFixed(2), { size: 14, font: 'mono', fill: color.ash });
      const sw = Math.max(100, inner - lw - val.width - space.betweenRows * 2);
      const s = slider(kit, { key: 'gfx-' + k }, (g.values[k] - lo) / (hi - lo) * 100, sw, (_, n) => { const v = +(lo + (hi - lo) * n / 100).toFixed(2); val.text = v.toFixed(2); change(k, v, false); });
      s.x = lw; val.x = lw + sw + space.betweenRows;
      t.y = Math.round((s.height - t.height) / 2); val.y = t.y;
      c.addChild(t, s, val);
      return c;
    }
    let x = lw;
    const bs = spec.map(([v, words]) => {
      const b = kit.button(words, () => change(k, v, true), { size: 14, font: 'body', tight: true, selected: g.values[k] === v });
      b.label = `gfx-${k}-${words}`;
      b.x = x; x += b.width + space.betweenRows;
      return b;
    });
    t.y = Math.round((bs[0].height - t.height) / 2);
    c.addChild(t, ...bs);
    return c;
  };
  const panelOf = ([title, rows]) => panel(kit, title, cw, stack(rows.filter(r => g.pc || r[3] !== 'pc').map(line), 2));
  const [light, air, camera, quality] = SECTIONS.map(panelOf);
  const reset = kit.button('Reset to the look as built', () => { g.reset(); reopen(); }, { size: 16, font: 'body', tight: true });
  reset.label = 'gfx-reset';
  // Two columns of about the same height: the light and the camera; the air, the quality, and what has changed.
  const a = stack([light, camera], sec), b = stack([air, quality, stack([note, reset], space.betweenRows)], sec);
  b.x = xs[1];
  const cols = new P.Container();
  cols.addChild(a, b);
  return cols;
}
