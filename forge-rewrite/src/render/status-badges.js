// What 1.7 drew over bodies for their state (presentation/render/render.js, drawPlayer and the creature loop), ported as
// it was (Justin 2026-10-16, sandbox items 33-35: "i want it done how 1.7 did it. it already did that well"):
//  - creatures: a row of status chips over the tile (each icon on a round chip of its own colour with a dark rim,
//    Justin 2026-09-20), a thin HP bar once hurt (never for a boss: the boss bar has it), a flame while burning;
//  - an ally: 1.7's green ring at its feet (render.js:2364); a sleeper: the pale blue 'z' bobbing beside its head (:2382);
//  - the hero: the pale shield bubble while a shield holds, Stillness's dashed ring, the float ring. The hero's own
//    statuses are the HUD's row (src/ui/hud/status.js), as in 1.7.
// Positions are 1.7's, from the tile's top left (1.7's px0, py0 after its actor lift: corner() below, from map-view's posOf).
// map-view.js owns one: update(state) after each turn, tick(now, reduced) each frame.

import { Container, Graphics, Sprite, Text, Texture } from '../../../forge-godot/runtime/pixi.js';
import statusData from '../../data/statuses.json' with { type: 'json' };
import ui from '../../data/ui.json' with { type: 'json' };
import { statusIcon } from './icons.js';
import { shieldPools } from '../engine/reads.js';

// 1.7 STATUS_CHIP; a status without a colour gets 1.7's #C8C0B4.
const CHIP = { challenged: 0xe8b44a, coward: 0xe8b44a, burn: 0xffc27a, chill: 0xbfe4f0, frozen: 0xdcf2ff, root: 0xc8e0a0, stun: 0xffe9a8, fear: 0xc8b4e0,
  blind: 0xffffff, poison: 0xc6e39a, web: 0xe4dcf0, slow: 0xe4dcf0, bleed: 0xf0b0b0 };
const OTHER = 0xc8c0b4;
const ROWS = statusData.rows;
/** 1.7 statusList(e): every status the body bears, in the order it took them, immunities aside. */
const shown = a => Object.keys(a.statuses ?? {}).filter(k => !k.startsWith('imm-') && ROWS[k]?.icon);
const seedOf = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h % 1000); };

// 1.7's shield bubble gradient, painted once by the same canvas calls (radius 0.62 tile = 64 px here).
let bubbleTex = null;
function bubble() {
  if (bubbleTex) return bubbleTex;
  const R = 64, c = document.createElement('canvas'); c.width = c.height = R * 2;
  const g = c.getContext('2d'), k = R / 0.62, gr = g.createRadialGradient(R, R, 0.35 * k, R, R, R);
  gr.addColorStop(0, 'rgba(150,215,255,0)'); gr.addColorStop(0.48, 'rgba(150,215,255,0.1)'); gr.addColorStop(0.76, 'rgba(160,220,250,0.55)'); gr.addColorStop(1, 'rgba(160,220,250,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(R, R, R, 0, 7); g.fill();
  return (bubbleTex = Texture.from(c));
}

/** 1.7 drawBurningFlame: three flame layers, swaying, at the body's feet. */
export function flame(g, bx, by, height, t, seed, alpha, reduced) {
  const tt = reduced ? 0 : t / 240 + seed, sway = reduced ? 0 : Math.sin(tt) * 1.3, stretch = reduced ? 1 : 1 + 0.07 * Math.sin(tt * 1.7);
  const a = alpha * (reduced ? 1 : 0.92 + 0.08 * Math.sin(tt * 0.8)), sx = height / 23, sy = height / 23 * stretch;
  const pts = [-7, 0, -9, -6, -6 + sway * 0.3, -12, -5, -8, -2 + sway, -21, 2, -14, 5 - sway * 0.6, -18, 5, -9, 8, -12, 9, -5, 6, 0];
  for (const [col, s] of [[0xcc421c, 1], [0xff9b32, 0.78], [0xffe49b, 0.48]]) g.poly(pts.map((v, i) => (i % 2 ? by + v * s * sy : bx + v * s * sx))).fill({ color: col, alpha: a });
}

/** 1.7 render.js mark(): a mark over a body in mono 600 at 0.36 tile; by default a sleeper's pale blue 'z' (RC14), which the HUD's rest hold raises over the hero too (item 177). */
export function markText(tile, resolution, ch = 'z', fill = 0xcfe0ff) {
  const t = new Text({ text: ch, style: { fontFamily: ui.fonts.mono, fontWeight: '600', fontSize: Math.max(8, Math.round(tile * 0.36)), fill }, resolution });
  t.anchor.set(0, 0.5);
  return t;
}

export function createStatusBadges(view) {
  /** 1.7's px0, py0: a body's tile corner, raised by the body lift (RB33), mid-slide as drawn (map-view posOf, M2). */
  const corner = s => { const p = view.posOf(s); return { x: p.x * view.tile, y: p.y * view.tile - view.lift() }; };
  const root = new Container(), rows = new Map(), fx = new Graphics();
  let hero = new Sprite(bubble());
  hero.anchor.set(0.5); hero.visible = false;
  root.addChild(fx, hero);
  root.eventMode = 'none';
  let game = null;
  const zs = new Map();   // RC14: a sleeper's 'z', one Text each, kept while it sleeps
  const zText = (ch, fill) => { const T = view.tile, t = root.addChild(markText(T, view.resolution * view.scale, ch, fill)); return { t, tile: T }; };
  // RC40, RC41 (1.7 render.js:2380-2381 mark): a trader's '?' over its head; a '!' beside a foe that has just noticed
  // the hero, while its surprise opening lasts (caughtOff this action, rules/hit.js). Both #FFD24A, the 'z' mark's face.
  const flags = new Map();
  // CH-R2: the Prism Seer's element glyph, 1.7's mark() (600 weight, 0.36 tile) in the element's damage colour.
  const glyphs = new Map();
  const glyphText = el => {
    const T = view.tile, t = root.addChild(markText(T, view.resolution * view.scale, { fire: '♨', ice: '❄', lightning: 'ϟ' }[el] ?? '◆', ui.damageColours[el] ?? '#EEE1B7'));
    return { t, tile: T, el };
  };

  /** The chip row, built at 0,0 = the tile's top left. */
  function build(ids) {
    const T = view.tile, c = new Container(), rr = T * 0.115;
    ids.forEach((k, i) => {
      const cx = T * 0.02 + i * T * 0.24 + T * 0.1, cy = -T * 0.3 + T * 0.15;
      c.addChild(new Graphics().circle(cx, cy, rr * 1.25).fill({ color: 0x0a0806, alpha: 0.85 }).circle(cx, cy, rr).fill(CHIP[k] ?? OTHER));
      const size = Math.round(T * 0.26), pic = statusIcon(ROWS[k].icon, size);
      if (pic) { pic.position.set(pic.x + cx - size / 2, pic.y + cy - size / 2); c.addChild(pic); }
      else {
        const t = new Text({ text: k.charAt(0).toUpperCase(), style: { fontFamily: ui.fonts.mono, fontWeight: '600', fontSize: Math.max(7, Math.round(T * 0.2)), fill: 0x120f0d }, resolution: view.resolution * view.scale });
        t.anchor.set(0.5); t.position.set(cx, cy); c.addChild(t);
      }
    });
    root.addChild(c);
    return c;
  }

  return {
    root,
    update(state) { game = state; this.refresh(); },
    /** A chip row for every living creature with a status; rebuilt only when its set changes. */
    refresh() {
      const state = game;
      if (!state?.actors) return;
      const seen = new Set();
      for (const id of state.order ?? []) {
        const a = state.actors[id];
        if (!a || a.hp <= 0 || id === state.playerId) continue;
        const ids = shown(a);
        if (!ids.length) continue;
        const key = ids.join(',') + '@' + view.tile;
        seen.add(id);
        const row = rows.get(id);
        if (row?.key === key) continue;
        row?.c.destroy({ children: true });
        rows.set(id, { c: build(ids), key });
      }
      for (const [id, row] of rows) if (!seen.has(id)) { row.c.destroy({ children: true }); rows.delete(id); }
    },
    tick(now, reduced) {
      this.refresh();
      const T = view.tile;
      if (hero.destroyed) { hero = new Sprite(bubble()); hero.anchor.set(0.5); }   // a floor rebuild empties the bodies layer it rides in
      fx.clear(); hero.visible = false;
      for (const [id, row] of rows) {
        const s = view.sprite(id);
        row.c.visible = !!s && s.root.visible;
        if (s) { const at = corner(s); row.c.position.set(at.x, at.y); }
      }
      if (!game?.actors) { for (const z of [...zs.values(), ...glyphs.values(), ...flags.values()]) z.t.visible = false; return; }
      const asleep = new Set(), seers = new Set(), flagged = new Set();
      for (const id of game.order ?? []) {
        const a = game.actors[id], s = view.sprite(id);
        if (!a || a.hp <= 0 || !s || !s.root.visible) continue;
        const { x: px0, y: py0 } = corner(s);
        // RC12 (1.7 render.js:2364): an ally stands in a green ring at its feet, drawn over the body as 1.7 stroked it.
        if (a.side === 'ally') fx.ellipse(px0 + T / 2, py0 + T * 0.9, T * 0.34, T * 0.12).stroke({ color: 0x7fd08a, width: 2 * T / 64 });
        // RC14 (1.7 render.js:2382 mark('z')): a sleeper's 'z' beside its head, bobbing on sin(now / 400).
        if (a.asleep && id !== game.playerId) {
          asleep.add(id);
          let z = zs.get(id);
          if (z && z.tile !== T) { z.t.destroy(); z = null; }
          if (!z) { z = zText(); zs.set(id, z); }
          z.t.visible = true;
          z.t.position.set(px0 + T * 0.78, py0 + T * 0.08 + (reduced ? 0 : Math.sin(now / 400 + seedOf(id)) * T / 24));
        }
        const flag = id === game.playerId ? null : a.merchant && a.side !== 'foe' ? ['?', 0.39, -0.16]
          : a.side === 'foe' && a.hunting && !a.asleep && !a.boss && !a.flags?.includes('boss') && a.caughtOff === game.actions ? ['!', 0.78, 0.02] : null;
        if (flag) {
          flagged.add(id);
          let m = flags.get(id);
          if (m && (m.tile !== T || m.ch !== flag[0])) { m.t.destroy(); m = null; }
          if (!m) { m = { ...zText(flag[0], 0xffd24a), ch: flag[0] }; flags.set(id, m); }
          m.t.visible = true;
          m.t.position.set(px0 + T * flag[1], py0 + T * flag[2]);
        }
        if (a.statuses?.burn) flame(fx, px0 + T * 0.5, py0 + T * 0.88, T * 0.56, now, seedOf(id), 0.44, reduced);
        if (id === game.playerId) {
          const shp = shieldPools(a).reduce((n, q) => n + Math.floor(q.n), 0);   // the HP bar's shield (whole points)
          if (shp > 0) {
            const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(now / 400);
            // Item 116: 1.7 painted the bubble in the bodies' pass, right after the hero (render.js:2333-2338), so the
            // scene's light darkened it and what was drawn in front covered it. Over the light layer it was an unlit pale
            // haze on dark shelves and walls; it rides with the hero's own depth among the bodies now.
            const layer = s.root.parent;
            if (layer && hero.parent !== layer) layer.addChild(hero);
            hero.zIndex = s.root.zIndex + 0.001;
            hero.visible = true;
            hero.alpha = 0.14 + 0.06 * pulse + Math.min(0.12, shp / Math.max(1, a.maxhp) * 0.24);
            hero.position.set(px0 + T / 2, py0 + T * 0.55);
            hero.scale.set(0.8 * T * 0.62 / 64, T * 0.62 / 64);
          }
          if (a.statuses?.stillness) {   // 3 px dashes on a pale blue ring at the feet
            const cx = px0 + T / 2, cy = py0 + T * 0.9, rx = T * 0.36, ry = T * 0.12, n = Math.max(12, Math.round(Math.PI * (rx + ry) / 6));
            for (let i = 0; i < n; i++) { const a0 = i / n * Math.PI * 2, a1 = (i + 0.5) / n * Math.PI * 2; fx.moveTo(cx + Math.cos(a0) * rx, cy + Math.sin(a0) * ry).lineTo(cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry); }
            fx.stroke({ color: 0x9fd8ff, width: 1, alpha: 0.5 });
          }
          if (a.statuses?.levitate) fx.ellipse(px0 + T / 2, py0 + T * 0.92, T * 0.3, T * 0.09).stroke({ color: 0xe8d27a, width: 1, alpha: 0.35 });
          continue;
        }
        // CH-R2 (1.7 chaos-enemy-art.js:51 mark): the Prism Seer's next ray, its glyph in the damage colour at its top left.
        if (a.kind === 'chaos-prism-seer' && a.chaosElement) {
          seers.add(id);
          let g = glyphs.get(id);
          if (g && (g.tile !== T || g.el !== a.chaosElement)) { g.t.destroy(); g = null; }
          if (!g) { g = glyphText(a.chaosElement); glyphs.set(id, g); }
          g.t.visible = true;
          g.t.position.set(px0 + T * 0.13, py0 - T * 0.12);
        }
        // CH-R3 (1.7 chaos-enemy-art.js:52-57): a Lens-shielded body wears a pale blue ring at .65, and a dashed tether at
        // .45 runs from it to the living Lens Bearer while the Bearer is in sight.
        const lens = a.statuses?.chaoslens;
        if (lens?.n > 0) {
          const w = Math.max(1, T * 0.035);
          fx.ellipse(px0 + T / 2, py0 + T / 2, T * 0.43, T * 0.52).stroke({ color: 0x9cdeff, width: w, alpha: 0.65 });
          const src = lens.source && game.actors[lens.source], ss = src?.hp > 0 && view.sprite(lens.source);
          if (ss && ss.root.visible) {
            const x0 = px0 + T / 2, y0 = py0 + T * 0.55, x1 = ss.root.x, y1 = ss.root.y - T * 0.45, len = Math.hypot(x1 - x0, y1 - y0);
            const on = T * 0.08, gap = T * 0.07;
            for (let d = 0; d < len; d += on + gap) {
              const e = Math.min(len, d + on);
              fx.moveTo(x0 + (x1 - x0) * d / len, y0 + (y1 - y0) * d / len).lineTo(x0 + (x1 - x0) * e / len, y0 + (y1 - y0) * e / len);
            }
            fx.stroke({ color: 0x9cdeff, width: w, alpha: 0.45 });
          }
        }
        // CH-R4 (1.7 chaos-enemy-art.js:58): Iron Brace, a gold arc under the Ironbound from .12 to .88 of a half turn.
        if (a.statuses?.chaosbrace) {
          const cx = px0 + T / 2, cy = py0 + T * 0.55, r = T * 0.44, a0 = Math.PI * 0.12;
          fx.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r).arc(cx, cy, r, a0, Math.PI * 0.88).stroke({ color: 0xffe1a1, width: Math.max(2, T * 0.06) });
        }
        // EP32 (1.7 sporecaller.js:173-181): a Sporecoat is four pale green motes circling the body, a turn every 2.4 s.
        if (a.statuses?.sporecoat) {
          const ph = reduced ? 0 : now / 600, d = 2 * Math.max(1, Math.round(T / 32));
          for (let n = 0; n < 4; n++) { const q = ph + n * Math.PI / 2; fx.rect(Math.round(px0 + T * (0.5 + Math.cos(q) * 0.37)), Math.round(py0 + T * (0.52 + Math.sin(q) * 0.34)), d, d).fill({ color: 0xb3d39c, alpha: 0.85 }); }
        }
        // The HP bar once hurt, never for a boss. A big or tall creature has it over what is drawn, across its footprint.
        if (a.hp < a.maxhp && !a.boss) {
          const bigN = a.size ?? 1, bScale = a.look?.bigScale ?? a.bigScale ?? 1, artH = a.look?.art ?? 0.9;
          const lift = Math.max(bigN * bScale > 1 ? T * (bigN * 0.98 * bScale - bigN) : 0, artH > 1 ? T * (artH - 1) : 0);
          const bw = T * 0.76 * bigN, bx = px0 + T * 0.12 * bigN, by = py0 - T * 0.02 - lift, bh = 3 * T / 64, f = Math.max(0, Math.min(1, a.hp / a.maxhp));
          fx.rect(bx, by, bw, bh).fill({ color: 0x000000, alpha: 0.7 });
          fx.rect(bx, by, bw * f, bh).fill(a.side === 'ally' || a.side === 'player' ? 0x7fd08a : f > 0.5 ? 0xc7b04f : 0xc7503f);
        }
      }
      // RC42 (1.7 render.js:2256 mark('!')): a cage with a prisoner in sight shows a #E8B44A '!' at its top right.
      const fl = game.floor, vis = game.vis;
      for (const pr of fl?.props ?? []) {
        if (!pr.prisoner || pr.part || !vis?.[pr.y * fl.w + pr.x]) continue;
        const key = 'cage:' + pr.x + ',' + pr.y;
        flagged.add(key);
        let m = flags.get(key);
        if (m && m.tile !== T) { m.t.destroy(); m = null; }
        if (!m) { m = { ...zText('!', 0xe8b44a), ch: '!' }; flags.set(key, m); }
        m.t.visible = true;
        m.t.position.set(pr.x * T + T * 0.72, pr.y * T + T * 0.2);
      }
      for (const [id, z] of zs) if (!asleep.has(id)) { z.t.destroy(); zs.delete(id); }
      for (const [id, g] of glyphs) if (!seers.has(id)) { g.t.destroy(); glyphs.delete(id); }
      for (const [id, m] of flags) if (!flagged.has(id)) { m.t.destroy(); flags.delete(id); }
    },
  };
}
