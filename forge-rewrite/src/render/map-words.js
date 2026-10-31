// The map's floating words and shots (M10, render-28: moved out of map-view.js): numbers and words rising over a body
// or a tile (CB22), a bolt's streak from one body to another, the Hook's grappling hook (item 262) and a flash of light at
// a tile (SB1).

import { Container, Graphics, Sprite, Text } from '../../../forge-godot/runtime/pixi.js';
import { sheet, hasSheet } from './art-store.js';
import ui from '../../data/ui.json' with { type: 'json' };
import { T } from '../data/tiles.js';

/** Installs its part of the map view on k (map-view.js createMapView: the view, its layers and shared state). */
export function createWords(k) {
  const { view, clock, root, floaters, light, sprites, centre, actors, pieces } = k;
  /** A number that rises and fades above a body (or, given `at`, above a tile: the ritual cage's -2, WC13). */
  // CB22 (1.7 game.js:119-132 floatText, fx.js:569-587): a floating word rises 0.9 tile over 760 ms and fades in its
  // last quarter, popping in from 70%; a third of a tile tall (a crit's or a boss blow's, big, 0.43), no taller than at a
  // 64 px screen tile, at least 9 px (14, big 16, on a phone held upright), squeezed to 1.8 tiles wide. Words over one
  // body or tile at once take the next free row below (0.46 tile apart), so a hit, its procs and a heal stay legible.
  // Each is nudged up to 0.2 tile aside (Math.random, never the rules' stream: spec/combat.md 240) unless o.jitter is false.
  const floating = new Map();
  view.float = (id, words, color, at = null, big = false, o = {}) => {
    const s = at ? { root: centre(at.x, at.y) } : sprites.get(id); if (!s) return;
    const key = at ? at.x + ',' + at.y : id, T = view.tile, k = view.scale || 1, TS = T * k;
    const upright = view.touch && view.screenH > view.screenW, least = upright ? (big ? 16 : 14) : 9;
    let fs = Math.max(least, Math.round(Math.min(TS, 64) * (big ? 0.43 : 0.33)));
    const style = { fontFamily: ui.fonts.mono, fontSize: fs / k, fontWeight: '500', fill: color, stroke: { color: 0x000000, alpha: 0.8, width: Math.max(0.8, Math.min(1.5, TS * 0.02)) / k, join: 'round' } };
    const t = new Text({ text: words, style, resolution: view.resolution * k });
    if (t.width > T * 1.8) { fs = Math.max(least, Math.floor(fs * T * 1.8 / t.width)); t.style.fontSize = fs / k; }
    const live = (floating.get(key) ?? []).filter(f => f.p < 1);
    let offset = 0;
    for (const y of live.map(f => f.off - 0.9 * f.p).sort((a, b) => a - b)) if (Math.abs(offset - y) < 0.46) offset = y + 0.46;
    const me = { off: offset, p: 0 };
    live.push(me); floating.set(key, live);
    const x0 = s.root.x + (o.jitter === false ? 0 : (Math.random() - 0.5) * 0.4 * T), y0 = s.root.y - T * 0.55 + offset * T;
    t.anchor.set(0.5); t.position.set(x0, y0); t.scale.set(0.7);
    floaters.addChild(t);
    words_.push({ t, me, key, x0, y0, age: 0 });
  };
  // Words keep their 760 ms under Reduce motion too (a tween there would end at once): their own clock, at game speed.
  const words_ = [];
  clock.onFrame(dt => {
    for (let i = words_.length - 1; i >= 0; i--) {
      const w = words_[i], T = view.tile;
      w.age += dt * (clock.speed || 1);
      const p = Math.min(1, w.age / 760);
      w.me.p = p;
      if (p >= 1 || w.t.destroyed) {
        words_.splice(i, 1); w.me.p = 1; if (!w.t.destroyed) w.t.destroy();
        const l = floating.get(w.key); if (l && !l.some(f => f.p < 1)) floating.delete(w.key);
        continue;
      }
      w.t.y = w.y0 - T * 0.9 * p; w.t.alpha = p < 0.75 ? 1 : (1 - p) / 0.25; w.t.scale.set(p < 0.12 ? 0.7 + p * 2.5 : 1);
    }
  });

  /** A shot flying from one body to another (an arrow, a firebolt): a short streak, then gone. */
  view.bolt = (fromId, toId, color = 0xe8dcc0) => {
    const a = sprites.get(fromId), b = sprites.get(toId);
    if (!a || !b) return Promise.resolve();
    const y = view.tile * 0.5, g = new Graphics().moveTo(-view.tile * 0.18, 0).lineTo(view.tile * 0.18, 0).stroke({ color, width: Math.max(1.5, view.tile * 0.05), alpha: 0.95 });
    g.rotation = Math.atan2(b.root.y - a.root.y, b.root.x - a.root.x);
    floaters.addChild(g);
    const x0 = a.root.x, y0 = a.root.y - y, x1 = b.root.x, y1 = b.root.y - y;
    const ms = Math.min(260, 40 + Math.hypot(x1 - x0, y1 - y0) / view.tile * 35);
    const glow = light.trail(color);   // SB1: the shot carries its light along, and flashes where it lands (lighting.js)
    return clock.tween(ms, p => { g.position.set(x0 + (x1 - x0) * p, y0 + (y1 - y0) * p); glow.move(g.x, g.y); }).then(() => { g.destroy(); glow.end(); light.flash(x1, y1, color); });
  };

  // Item 262 (Justin 2026-10-20: "can we change the hook animation to be like a metal grapplling hook instead of a beam of
  // light?"): the Hook amulet's throw. Its iron hook (fx-hook, drawn in PixelLab) flies out from the wearer's hand turning
  // over, the chain paying out slack behind it; at `bite` ms it bites with a spark (onBite: its clink), then rides the body
  // it caught (to.id) or holds its anchor (to.at, the wearer hauled across) while the chain reels in taut, and lets go once
  // the body it brings has landed. Among the bodies, so the card pass lights the iron as it lights them.
  const IRON = 0x2b2a2e, LINK = 0x8e8c93, EDGE = 0xc2c0c6;
  /** The chain along a quadratic from a to b through c: a dark core and links laid flat and edge-on by turns. */
  const chain = (g, a, c, b, T) => {
    const pts = [];
    for (let i = 0; i <= 24; i++) { const u = i / 24, v = 1 - u; pts.push({ x: v * v * a.x + 2 * u * v * c.x + u * u * b.x, y: v * v * a.y + 2 * u * v * c.y + u * u * b.y }); }
    g.moveTo(pts[0].x, pts[0].y); for (const q of pts) g.lineTo(q.x, q.y); g.stroke({ color: IRON, width: T * 0.05, cap: 'round', join: 'round' });
    const step = T * 0.1; let left = step / 2, n = 0;
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1], p1 = pts[i], seg = Math.hypot(p1.x - p0.x, p1.y - p0.y), ux = (p1.x - p0.x) / (seg || 1), uy = (p1.y - p0.y) / (seg || 1);
      for (let d = left; d < seg; d += step, n++) {
        const x = p0.x + ux * d, y = p0.y + uy * d, r = step * 0.55;
        if (n % 2) g.moveTo(x - ux * r, y - uy * r).lineTo(x + ux * r, y + uy * r).stroke({ color: EDGE, width: T * 0.018 });
        else {
          const ring = [];
          for (let j = 0; j < 8; j++) { const th = j * Math.PI / 4, ex = Math.cos(th) * r, ey = Math.sin(th) * r * 0.5; ring.push(x + ex * ux - ey * uy, y + ex * uy + ey * ux); }
          g.poly(ring, true).stroke({ color: LINK, width: T * 0.016 });
        }
      }
      left = (left - seg % step + step) % step || step;
    }
  };
  view.grapple = (fromId, to, { bite = 240, onBite = () => {} } = {}) => {
    const me = sprites.get(fromId), held = to.id ? sprites.get(to.id) : null, anchor = to.at ? centre(to.at.x, to.at.y) : null;
    if (clock.instant || !me?.root || (!held?.root && !anchor) || !hasSheet('fx-hook')) return;
    const T = view.tile, s = clock.speed || 1, t0 = clock.now, at = ms => t0 + ms / s;
    const g = new Container(), line = new Graphics(), hook = new Sprite(sheet('fx-hook').textures.hook);
    const k = T * 0.46 / Math.max(hook.texture.width, hook.texture.height);
    hook.anchor.set(0.5, 0.25); hook.scale.set(k); g.zIndex = 1e7; g.eventMode = 'none'; g.addChild(line, hook); actors.addChild(g);
    const hand = () => ({ x: me.root.x, y: me.root.y - T * 0.45 });
    let last = null;
    const mark = () => (last = held?.root && !held.root.destroyed ? { x: held.root.x, y: held.root.y - T * 0.42 } : anchor ? { x: anchor.x, y: anchor.y - T * 0.4 } : last);
    const brought = held ?? me, fly = at(bite - 170), bit = at(bite), cap = at(bite + 900);
    const landed = () => { const sl = clock.slideOf(brought); return !!sl && sl.t0 >= bit - 60 / s && clock.frac(brought) >= 1; };
    let bitten = false, gone = 0;
    const off = clock.onFrame((dt, now) => {
      if (me.root.destroyed || g.destroyed) { off(); if (!g.destroyed) g.destroy({ children: true }); return; }
      const a = hand(), b = mark(), dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, taut = Math.atan2(-dx, dy);
      line.clear();
      if (now < fly) { g.visible = false; return; }
      g.visible = true;
      if (now < bit) {
        // out: an arc up and over, turning end over end, the chain slack beneath it
        const p = (now - fly) / (bit - fly), e = 1 - (1 - p) * (1 - p), lift = Math.sin(Math.PI * p) * T * 0.35;
        hook.position.set(a.x + dx * e, a.y + dy * e - lift); hook.rotation = taut + (1 - e) * Math.PI * 3;
        chain(line, a, { x: (a.x + hook.x) / 2, y: (a.y + hook.y) / 2 + T * 0.3 * (1 - p) }, hook, T);
        return;
      }
      if (!bitten) { bitten = true; pieces.sparkle?.(b.x / T - 0.5, b.y / T - 0.5, 'phys', 8); onBite(); }
      // in: taut, a twang as it bites, reeled until the body it brings has landed, then let go
      if (!gone && (now >= cap || (now >= at(bite + 120) && landed()))) gone = now;
      const fade = gone ? Math.min(1, (now - gone) / (160 / s)) : 0, twang = Math.max(0, 1 - (now - bit) / (90 / s)) * Math.sin((now - bit) * s / 9) * T * 0.04;
      hook.position.set(b.x, b.y); hook.rotation = taut; g.alpha = 1 - fade;
      chain(line, a, { x: (a.x + b.x) / 2 - dy / len * twang, y: (a.y + b.y) / 2 + dx / len * twang }, b, T);
      if (fade >= 1) { off(); g.destroy({ children: true }); }
    });
  };

  /** SB1: a flash of light at a tile (a spell going off, a blast): any painter may call it. Colour 0xRRGGBB. */
  view.flash = (x, y, colour, radius, strength, ms) => light.flash((x + 0.5) * view.tile, (y + 0.5) * view.tile, colour, radius, strength, ms);
}
