// Item 210 (Justin 2026-10-19: "the first biome needs to be a little more visually interesting, what are we misising?",
// then "let's do 1-5 we need more variety to bring people into the game"): what moves in the air, over the light with
// the beacons. Dust drifts in a daylight shaft, seen only inside its lit patch. Embers rise and fade off a lit brazier or
// campfire, never the Forge (item 272, Justin 2026-10-20: "let's drop the partical animation on the forge"). A faint low mist drifts over water, off a plane (item 251, Justin 2026-10-20: its rows were the white
// bands over the Shadow pools; a plane's pool keeps its one motion, plane-anim.js). They are drawn, never lights. They
// run on the map's frame clock, only where the tile is in sight and on screen, within a fixed budget. Motion Off or Low
// power (view.lowPower): none.

import { Container, Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import lighting from '../../data/lighting.json' with { type: 'json' };
import props from '../../data/props.json' with { type: 'json' };
import ui from '../../data/ui.json' with { type: 'json' };
import { T } from '../data/tiles.js';
import { hash2 } from '../lib/noise.js';

const DAY = lighting.rows.lights.daylight, LEAN = DAY.shadow?.direction?.[0] ?? 0.28;
const FIRE = /^(brazier-lit|kobold-campfire|campfire|lava-forge|soul-brazier)$/;
const BUDGET = { dust: 18, shafts: 3, embers: 48, mist: 24 };
const SOURCES_MS = 250;   // the shafts, fires and water in sight are looked up again this often, not every frame

/**
 * How far inside a daylight shaft's lit patch (x, y) lies, in tiles: 1 at its heart, 0 at and past its edge. The patch is
 * the beam's core as the light pass draws it (light-glsl.js dayParts: narrowed across by 0.48 and leaning with the light).
 */
export function inShaft(l, x, y) {
  const beam = l.beamRadius ?? DAY.beamRadius, dx = l.x + 0.5 - x, dy = l.y + 0.5 - y;
  const r = Math.hypot((dx - dy * LEAN) / 0.48, dy) / beam;
  return Math.max(0, Math.min(1, (0.7 - r) / 0.5));
}

/** Item 235: whether a sunbeam has dust: about ui.json airMotes.dustShare of them, the same ones always, by their place. */
export const dusty = l => hash2(l.x, l.y, 9151) < ui.airMotes.dustShare;

let soft = null;
/** A soft round puff for the mist, painted once. */
function puff() {
  if (soft) return soft;
  const R = 32, c = document.createElement('canvas'); c.width = c.height = R * 2;
  const g = c.getContext('2d'), gr = g.createRadialGradient(R, R, 0, R, R, R);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, R * 2, R * 2);
  return (soft = Texture.from(c));
}

/** @param {any} view the map view (view.floor(), view.seenTile(), camera, scale, screenW, screenH, tile, lowPower) @param {any} clock */
export function createAirMotes(view, clock) {
  const root = new Container();
  root.label = 'air-motes';
  root.eventMode = 'none';
  const pool = [];
  let used = 0, shafts = [], fires = [], water = [], dust = [], embers = [], mist = [], lookedAt = -Infinity, floorWas = null, emberCarry = 0;

  const sprite = (tex, blend) => {
    const s = pool[used] ?? root.addChild(new Sprite());
    pool[used++] = s;
    s.texture = tex; s.blendMode = blend; s.anchor.set(0.5); s.visible = true;
    return s;
  };
  /** The world's on-screen rectangle in tiles, a tile wider each side. */
  const onScreen = () => {
    const T0 = view.tile, s = view.scale || 1, hw = (view.screenW || 0) / 2 / s, hh = (view.screenH || 0) / 2 / s;
    return { x0: (view.camera.x - hw) / T0 - 1, x1: (view.camera.x + hw) / T0 + 1, y0: (view.camera.y - hh) / T0 - 1, y1: (view.camera.y + hh) / T0 + 1 };
  };
  const shown = (r, x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1 && view.seenTile(Math.floor(x), Math.floor(y));

  /** The shafts, fires and water in sight and on screen, at most each budget. */
  function lookUp(f) {
    const r = onScreen();
    shafts = (f.lights ?? []).filter(l => l.kind === 'daylight' && dusty(l) && shown(r, l.x + 0.5, l.y + 0.5)).slice(0, BUDGET.shafts);
    fires = (f.props ?? []).filter(p => FIRE.test(p.id) && !p.broken && (p.light || props.rows[p.id]?.light) && shown(r, p.x + 0.5, p.y + 0.5))
      .map(p => ({ x: p.x + 0.5, y: p.y + 0.05, c: Number('0x' + String(p.light?.col ?? p.light?.color ?? props.rows[p.id].light.color).slice(1)) }));
    water = [];
    for (let y = Math.max(0, Math.floor(r.y0)); y <= Math.min(f.h - 1, r.y1) && water.length < BUDGET.mist; y++) for (let x = Math.max(0, Math.floor(r.x0)); x <= Math.min(f.w - 1, r.x1) && water.length < BUDGET.mist; x++) {
      if (!f.plane && f.tiles[y * f.w + x] === T.WATER && view.seenTile(x, y)) water.push({ x, y });
    }
    // Each shaft keeps its own dust, each water tile one wisp; a source gone out of sight takes its motes with it.
    dust = shafts.flatMap(l => dust.filter(m => m.l === l).concat(Array.from({ length: Math.max(0, BUDGET.dust - dust.filter(m => m.l === l).length) }, () => mote(l))));
    mist = water.map(w => mist.find(m => m.w.x === w.x && m.w.y === w.y) ?? { w, ph: Math.random() * 6.3, sp: 0.00018 + Math.random() * 0.00012 });
    embers = embers.filter(e => fires.some(q => q.x === e.fx && q.y === e.fy));
  }
  /** A dust mote somewhere in shaft l's lit patch. */
  function mote(l) {
    const beam = l.beamRadius ?? DAY.beamRadius;
    for (let i = 0; i < 12; i++) {
      const x = l.x + 0.5 + (Math.random() - 0.5) * beam * 1.2, y = l.y + 0.5 + (Math.random() - 0.5) * beam * 1.6;
      if (inShaft(l, x, y) > 0.2) return { l, x, y, vx: (Math.random() - 0.5) * 0.00016, vy: (Math.random() - 0.35) * 0.00012, ph: Math.random() * 6.3, size: Math.random() < 0.5 ? 2 : 1 };
    }
    return { l, x: l.x + 0.5, y: l.y + 0.5, vx: 0, vy: 0, ph: 0, size: 1 };
  }

  clock.onFrame((dt, now) => {
    used = 0;
    const f = view.floor?.();
    if (!f || clock.reduced || view.lowPower) { shafts = fires = water = dust = embers = mist = []; floorWas = f; }
    else {
      if (f !== floorWas || now - lookedAt >= SOURCES_MS) { if (f !== floorWas) { dust = []; embers = []; mist = []; } floorWas = f; lookedAt = now; lookUp(f); }
      const T0 = view.tile, px = Math.max(1, Math.round(T0 / 32));
      for (const m of dust) {
        m.x += m.vx * dt; m.y += m.vy * dt;
        const k = inShaft(m.l, m.x, m.y);
        if (k <= 0) { Object.assign(m, mote(m.l)); continue; }
        if (!view.seenTile(Math.floor(m.x), Math.floor(m.y))) continue;
        const s = sprite(Texture.WHITE, 'add');
        s.tint = 0xfff3d6; s.alpha = ui.airMotes.opacity * Math.min(1, k * 1.6) * (0.6 + 0.3 * Math.sin(now / 900 + m.ph));   // item 210: ui.json airMotes
        s.position.set(Math.round(m.x * T0), Math.round(m.y * T0)); s.width = s.height = px * m.size;
      }
      emberCarry = Math.min(400, emberCarry + dt * fires.length);
      for (; emberCarry >= 140 && embers.length < BUDGET.embers; emberCarry -= 140) {
        const q = fires[Math.floor(Math.random() * fires.length)];
        embers.push({ fx: q.x, fy: q.y, x: q.x + (Math.random() - 0.5) * 0.3, y: q.y, vx: (Math.random() - 0.5) * 0.00012, life: 0, max: 1100 + Math.random() * 700, c: q.c, ph: Math.random() * 6.3 });
      }
      embers = embers.filter(e => (e.life += dt) < e.max);
      for (const e of embers) {
        const p = e.life / e.max;
        e.x += e.vx * dt + Math.sin(now / 260 + e.ph) * 0.00008 * dt; e.y -= 0.00055 * dt;
        const s = sprite(Texture.WHITE, 'add');
        s.tint = p < 0.3 ? 0xffd27a : e.c; s.alpha = (1 - p) * 0.9;
        s.position.set(Math.round(e.x * T0), Math.round(e.y * T0)); s.width = s.height = px * (p < 0.5 ? 2 : 1);
      }
      for (const m of mist) {
        const s = sprite(puff(), 'normal'), drift = Math.sin(now * m.sp + m.ph);
        s.tint = 0xcfe3ee; s.alpha = ui.airMotes.opacity * (0.16 + 0.05 * Math.sin(now * m.sp * 1.7 + m.ph));
        s.position.set((m.w.x + 0.5 + drift * 0.35) * T0, (m.w.y + 0.7) * T0); s.width = T0 * 1.7; s.height = T0 * 0.55;
      }
    }
    for (let i = used; i < pool.length; i++) pool[i].visible = false;
  }, { owner: root });

  return { root, get count() { return used; } };
}
