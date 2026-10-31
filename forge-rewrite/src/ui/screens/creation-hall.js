// The creator's hall comes alive (Justin 2026-10-20: "Do the animated overlay: flickering flames, embers, dust in the
// sunbeam, a shimmer on the pool"): the sconces and the fire pit flicker and glow, embers rise off the fire, glints play
// on the pool; a sunbeam falls on the picked figure (sunbeam below). The stage says where (creation-stage.js). Every
// piece is worked out from the clock, not kept state, so a redraw (each tap rebuilds the screen) carries straight on.
// Still under reduced motion.

import { Container, Sprite, Texture, Ticker } from '../../../../forge-godot/runtime/pixi.js';
import ui from '../../../data/ui.json' with { type: 'json' };

let glowTex = null;
/** A soft white disc fading to clear at its edge. */
function glow() {
  if (!glowTex) {
    const N = 128, c = Object.assign(document.createElement('canvas'), { width: N, height: N }), g = c.getContext('2d');
    const r = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, N, N);
    glowTex = Texture.from({ resource: c, scaleMode: 'linear' });
  }
  return glowTex;
}
const dot = (tex, tint, blend = 'add') => { const s = new Sprite(tex); s.anchor.set(0.5); s.tint = tint; s.blendMode = blend; s.eventMode = 'none'; return s; };
// A steady pseudo-random number for piece i.
const rnd = (i, k) => { const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v); };
// Firelight's flicker: three sines out of step, 0 to 1.
const flicker = (t, i) => 0.5 + 0.22 * Math.sin(t * 9.1 + i * 2) + 0.16 * Math.sin(t * 15.7 + i * 5) + 0.12 * Math.sin(t * 23.3 + i);

/**
 * The hall's life, placed by the stage (creation-stage.js): `flames` [{x, y, r, core}] (the sconces on the wall, the
 * fire pit on the floor), `fire` {x, y, unit} where embers rise (unit: a tile on screen there), `water` [{x, y, unit}]
 * points on the pool for its glints.
 */
export function hallLife(kit, { flames, fire, water }) {
  const root = new Container();
  root.eventMode = 'none'; root.label = 'hall-life';
  const parts = [];
  // The flames: a wide warm light that breathes on the wall or the floor, and a bright core that flickers.
  flames.forEach((f, i) => {
    const light = dot(glow(), 0xff9a40), core = dot(glow(), 0xffe2a0);
    light.position.set(f.x, f.y); core.position.set(f.x, f.y - f.core * 0.2);
    root.addChild(light, core);
    parts.push(t => { const v = flicker(t, i); light.width = light.height = f.r * 2 * (0.92 + 0.12 * v); light.alpha = 0.22 + 0.2 * v; core.width = f.core * 2 * (0.8 + 0.4 * v); core.height = f.core * 2.6 * (0.8 + 0.4 * v); core.alpha = 0.35 + 0.4 * v; });
  });
  // Embers off the fire pit: each rises, drifts and fades over its own life, then starts again.
  for (let i = 0; fire && i < 22; i++) {
    const u = fire.unit / 128, e = dot(Texture.WHITE, rnd(i, 1) < 0.5 ? 0xffb04a : 0xff7a2a), life = 1.4 + rnd(i, 2) * 1.4, rise = (130 + rnd(i, 3) * 150) * u, side = (rnd(i, 4) - 0.5) * 70 * u;
    e.width = e.height = Math.max(1.5, (3 + Math.round(rnd(i, 5) * 3)) * u);
    root.addChild(e);
    parts.push(t => {
      const p = ((t / life) + rnd(i, 6)) % 1;
      e.position.set(fire.x + (rnd(i, 7) - 0.5) * 40 * u + side * p + Math.sin(t * 2 + i) * 9 * u * p, fire.y - rise * p);
      e.alpha = p < 0.1 ? p * 10 : (1 - p) ** 1.5;
    });
  }
  // Glints on the pool: short bright strokes that swell and fade on their own beat.
  water.forEach((w, i) => {
    const g = dot(Texture.WHITE, 0xcfeaff), beat = 1.6 + rnd(i, 15) * 1.8, u = w.unit / 128;
    g.height = Math.max(1, 2 * u); g.position.set(w.x, w.y);
    root.addChild(g);
    parts.push(t => { const s = Math.max(0, Math.sin((t / beat + rnd(i, 16)) * Math.PI * 2)); g.width = (6 + 18 * s) * u; g.alpha = 0.55 * s * s; g.x = w.x + Math.sin(t * 0.6 + i) * 6 * u; });
  });
  const tick = () => { if (root.destroyed) return Ticker.shared.remove(tick); const t = performance.now() / 1000; for (const p of parts) p(t); };
  tick();
  if (!kit.reduced) { Ticker.shared.add(tick); root.on('destroyed', () => Ticker.shared.remove(tick)); }
  return root;
}

let shaftTex = null;
/** A beam's body: clear at the top, brightest at the foot, soft at both sides. */
function shaft() {
  if (!shaftTex) {
    const W = 64, H = 256, c = Object.assign(document.createElement('canvas'), { width: W, height: H }), g = c.getContext('2d');
    const v = g.createLinearGradient(0, 0, 0, H);
    v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.55, 'rgba(255,255,255,0.45)'); v.addColorStop(1, 'rgba(255,255,255,0.9)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'destination-in';
    const h = g.createLinearGradient(0, 0, W, 0);
    h.addColorStop(0, 'rgba(0,0,0,0)'); h.addColorStop(0.3, 'rgba(0,0,0,1)'); h.addColorStop(0.7, 'rgba(0,0,0,1)'); h.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = h; g.fillRect(0, 0, W, H);
    shaftTex = Texture.from({ resource: c, scaleMode: 'linear' });
  }
  return shaftTex;
}

/**
 * Justin 2026-10-20: "some sort of light effect highlighting which character is selected" ("the sunbeam in different
 * locations to indicate which caracter is selected"): a shaft of daylight slanting down from the upper left onto the
 * picked figure, a pool of light at its feet (in the court's colour on the Fae step), dust drifting in it. When the pick
 * changes it glides across from where it stood, 420 ms; `glide` ({from, start}) is kept by the caller across redraws, so
 * a redraw mid-glide (a painting landing) carries the same glide on.
 * @param {{reduced?: boolean}} kit @param {{from:number|null, start:number}} glide @param {number} x @param {number} feet
 * @param {number} h the figure's height @param {number} w the room it stands in @param {number} [tint] the pool's colour
 */
export function sunbeam(kit, glide, x, feet, h, w, tint = 0xfff0cc) {
  const root = new Container(), body = new Container();
  root.label = 'sunbeam'; root.eventMode = 'none';
  const top = feet - h * 2.4, lean = h * 0.55;
  const beam = dot(shaft(), 0xfff2d6), pool = dot(glow(), tint), halo = dot(glow(), 0xfff2d6);
  beam.anchor.set(0.5, 1); beam.width = w * 1.25; beam.height = feet - top; beam.skew.x = -Math.atan2(lean, feet - top);
  pool.position.set(0, -h * 0.02); pool.width = w * 1.5; pool.height = h * 0.28;
  halo.position.set(0, -h * 0.55); halo.width = w * 1.3; halo.height = h * 1.25;
  body.addChild(beam, pool, halo);
  root.addChild(body);
  // The dust in it is the game's own sunbeam dust (render/air-motes.js; Justin 2026-10-20: "can we get those sunbeam dust
  // particles from in game animated into that beam"): 18 square motes a tile/32 or two across, #FFF3D6 added, drifting
  // a tile in 12 s or so, at ui.json airMotes.opacity, fading in and out at the beam's edge and breathing on 900 ms.
  const tile = h / 2, px = Math.max(1, Math.round(tile / 32)), motes = [];
  for (let i = 0; i < 18; i++) {
    const m = dot(Texture.WHITE, 0xfff3d6); m.width = m.height = px * (rnd(i, 20) < 0.5 ? 2 : 1);
    body.addChild(m); motes.push({ m, u: rnd(i, 21), v: rnd(i, 22), vx: (rnd(i, 23) - 0.5) * 0.16, vy: (rnd(i, 24) - 0.35) * 0.12, ph: rnd(i, 25) * 6.3 });
  }
  const from = glide.from != null && !kit.reduced ? { x: glide.from } : null, start = glide.start;
  const tick = () => {
    if (root.destroyed) return Ticker.shared.remove(tick);
    const now = performance.now(), t = now / 1000, e = from ? Math.min(1, (now - start) / 420) : 1, ease = 1 - (1 - e) ** 3;
    body.position.set(from ? from.x + (x - from.x) * ease : x, feet);
    const breathe = kit.reduced ? 1 : 0.9 + 0.1 * Math.sin(t * 1.3);
    beam.alpha = 0.42 * breathe; pool.alpha = 0.55 * breathe; halo.alpha = 0.22 * breathe;
    for (const d of motes) {
      // Its place in the beam: across (u) and up (v, 0 the feet), wrapping round as it drifts; the lean as the beam leans.
      const u = ((d.u + d.vx * t * tile / w) % 1 + 1) % 1, v = ((d.v - d.vy * t * tile / (feet - top)) % 1 + 1) % 1;
      const y = -v * (feet - top) * 0.85, edge = Math.min(1, Math.min(u, 1 - u) * 5, Math.min(v, 1 - v) * 5);
      d.m.position.set(Math.round((u - 0.5) * w * 0.9 - lean * (-y / (feet - top))), Math.round(y));
      d.m.alpha = ui.airMotes.opacity * edge * (0.6 + 0.3 * Math.sin(now / 900 + d.ph));
    }
  };
  tick();
  if (!kit.reduced || from) { Ticker.shared.add(tick); root.on('destroyed', () => Ticker.shared.remove(tick)); }
  return root;
}

/** Where a beam gliding as `glide` toward `x` stands now (for a new glide starting from it). */
export const beamNow = (g, x) => (g.from == null ? x : g.from + (x - g.from) * (1 - (1 - Math.min(1, (performance.now() - g.start) / 420)) ** 3));
