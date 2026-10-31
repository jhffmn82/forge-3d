// Bone Ward on the map (the Crypt; Justin 2026-10-16, suggestion 3 "sure"): a pale shell of bone round each warded
// creature, following its sprite, that cracks and falls apart when a blow breaks it. 1.7 only floated "ward".
// Also the Shade's shimmer (C11): a Shade hidden inside a wall (rules/crypt.js M49, a.hidden) shows only as a faint
// wavering of the wall where it is.
// map-view.js owns one: update(state) after each turn, tick(now, reduced) each frame.

import { Container, Graphics } from '../../../forge-godot/runtime/pixi.js';

const SHARDS = 9, CRACK_MS = 520;

/** One shimmer stroke: a short pale-violet wave, rising. */
function g2(g, x, y, tile, alpha) {
  g.moveTo(x, y).bezierCurveTo(x + tile * 0.05, y - tile * 0.06, x - tile * 0.05, y - tile * 0.12, x, y - tile * 0.18)
    .stroke({ color: 0xc8b8e8, width: Math.max(1.5, tile * 0.035), alpha });
}

export function createWardShells(view) {
  const root = new Container(), shells = new Map(), cracks = [], shimmer = new Graphics();
  root.addChild(shimmer);
  let game = null;   // the live game state (the same object every turn): re-read each frame, so a ward breaks on the blow

  function shell() {
    const g = new Graphics();
    g.blendMode = 'add';
    root.addChild(g);
    return g;
  }

  /** The bone shell: an oval of short plates round the body, brighter on the upper left. */
  function drawShell(g, t, tile, reduced) {
    g.clear();
    const rx = tile * 0.42, ry = tile * 0.52, pulse = reduced ? 1 : 0.85 + 0.15 * Math.sin(t / 380);
    for (let k = 0; k < 14; k++) {
      const a0 = (k / 14) * Math.PI * 2, a1 = a0 + (Math.PI * 2) / 14 * 0.7;
      const lit = 0.55 + 0.45 * Math.max(0, -Math.cos(a0 + Math.PI / 4));
      g.moveTo(Math.cos(a0) * rx, Math.sin(a0) * ry).lineTo(Math.cos(a1) * rx, Math.sin(a1) * ry)
        .stroke({ color: 0xe8e0c8, width: Math.max(1.5, tile * 0.045), alpha: 0.55 * lit * pulse });
    }
    g.ellipse(0, 0, rx * 0.96, ry * 0.96).fill({ color: 0xd8d0b8, alpha: 0.06 * pulse });
  }

  return {
    root,
    /** The game to watch (map-view passes it on each sight change). */
    update(state) { game = state; this.refresh(); },
    /** Shells for every warded, living creature; a crack for each ward that broke. */
    refresh() {
      const state = game;
      if (!state?.actors) return;
      const now = new Set();
      for (const id of state.order ?? []) {
        const a = state.actors[id];
        if (a?.hp > 0 && a.statuses?.boneward) now.add(id);
      }
      for (const [id, g] of shells) if (!now.has(id)) {
        const s = view.sprite(id);
        if (s && state.actors[id]?.hp > 0) cracks.push({ x: s.root.x, y: s.root.y - view.tile * 0.5, born: performance.now(), seed: id.length });
        g.destroy(); shells.delete(id);
      }
      for (const id of now) if (!shells.has(id)) shells.set(id, shell());
    },
    /** Each frame: shells follow their bodies (and their sight); cracks fly apart and fade. */
    tick(t, reduced) {
      this.refresh();
      const tile = view.tile;
      for (const [id, g] of shells) {
        const s = view.sprite(id);
        if (!s) { g.visible = false; continue; }
        g.visible = s.root.visible;
        g.position.set(s.root.x, s.root.y - tile * 0.5);
        drawShell(g, t, tile, reduced);
      }
      // C11: a faint wavering over the wall tile a hidden Shade stands in (only where the hero can see the wall).
      shimmer.clear();
      if (game?.actors) for (const id of game.order ?? []) {
        const a = game.actors[id];
        if (a?.kind !== 'shade' || a.hp <= 0 || !a.hidden || !a.inWall || !game.vis?.[a.y * game.floor.w + a.x]) continue;
        for (let k = 0; k < 4; k++) {
          const ph = reduced ? 0.5 : (t / 900 + k / 4 + (a.x * 7 + a.y * 3) * 0.13) % 1, x = (a.x + 0.2 + 0.6 * ((k * 0.37 + 0.11) % 1)) * tile;
          const y = (a.y + 0.95 - ph * 0.8) * tile, wob = reduced ? 0 : Math.sin(t / 160 + k * 2.1) * tile * 0.04;
          g2(shimmer, x + wob, y, tile, Math.sin(ph * Math.PI) * 0.22);
        }
      }
      for (let i = cracks.length - 1; i >= 0; i--) {
        const c = cracks[i], p = (t - c.born) / CRACK_MS;
        if (!c.g) { c.g = new Graphics(); c.g.position.set(c.x, c.y); root.addChild(c.g); }
        if (p >= 1) { c.g.destroy(); cracks.splice(i, 1); continue; }
        c.g.clear();
        for (let k = 0; k < SHARDS; k++) {
          const a = (k / SHARDS) * Math.PI * 2 + c.seed, d = tile * (0.45 + p * 0.5), drop = p * p * tile * 0.6;
          const x = Math.cos(a) * d, y = Math.sin(a) * d * 1.2 + drop;
          c.g.moveTo(x, y).lineTo(x + Math.cos(a + 1.3) * tile * 0.1, y + Math.sin(a + 1.3) * tile * 0.1)
            .stroke({ color: 0xe8e0c8, width: Math.max(1.5, tile * 0.04), alpha: 1 - p });
        }
      }
    },
  };
}
