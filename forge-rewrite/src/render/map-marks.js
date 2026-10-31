// The map's marks and globes (M10, render-28: moved out of structures.js, which places them with the pieces): heart
// and mana globes with their pulse, the loot and mote glows, the coloured warning marks and their pulse each frame.

import { Container, Graphics, Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import tuning from '../../data/tuning.json' with { type: 'json' };
import { sporeWarnTiles, sporeWarnTick } from './fields-view.js';
import { radialTexture } from './stamps.js';
import { trapLeak, drawVines } from './piece-art.js';

const TURN = tuning.rows.clock.unitsPerGameTurn;


/** A heart or mana globe as 1.7 drawGlobe draws it (render.js:1241-1262 @3c8b312; 1.7 has no picture for them): a soft
 *  glow of its colour, a red heart or a blue orb with a pale highlight, a slow pulse and bob (globeTick), and a blink
 *  in its last 8 turns. */
const globeGlow = () => radialTexture('dot-1-128', [[0, 1], [1, 0]], { size: 128 });   // stamps.js (render-13)
export function globeSprite(i, tile, now) {
  const heart = i.item.kind === 'heart', r = tile * 0.13;
  const c = new Container();
  // RC55: 1.7's glow is one smooth radial gradient, 0.45 at the centre to clear at 0.32 of a tile.
  const glow = new Sprite(globeGlow()); glow.anchor.set(0.5); glow.width = glow.height = tile * 0.64; glow.tint = heart ? 0xff5a50 : 0x6ebeff; glow.alpha = 0.45;
  const body = new Graphics();
  if (heart) {
    body.moveTo(0, r * 1.1).bezierCurveTo(-r * 1.9, -r * 0.2, -r * 0.9, -r * 1.6, 0, -r * 0.55)
      .bezierCurveTo(r * 0.9, -r * 1.6, r * 1.9, -r * 0.2, 0, r * 1.1).fill({ color: 0xe0443a });
    body.rect(-r * 0.9, -r * 0.9, Math.max(1, r * 0.35), Math.max(1, r * 0.35)).fill({ color: 0xffdcd2, alpha: 0.8 });
  } else {
    body.circle(0, 0, r).fill({ color: 0x4aa8f0 });
    body.circle(-r * 0.35, -r * 0.35, r * 0.28).fill({ color: 0xdcf0ff, alpha: 0.85 });
  }
  c.addChild(glow, body);
  c.position.set((i.x + 0.5) * tile, (i.y + 0.56) * tile);
  c.zIndex = -1;
  c.globe = { body, x: i.x, y: i.y, y0: c.y, tile, blink: i.until !== undefined && now !== undefined && (i.until - now) / TURN < 8 };
  return c;
}

/** Each frame: the globes' pulse (body only), bob and last-turns blink, as 1.7 (render.js:1243-1245, 2274). */
export function globeTick(sprites, now, reduced) {
  for (const sp of sprites) {
    const g = sp.globe;
    if (!g || sp.destroyed) continue;
    g.body.scale.set(reduced ? 1 : 1 + 0.08 * Math.sin(now / 220 + g.x));
    sp.y = g.y0 + (reduced ? 0 : Math.sin(now / 400 + g.x * 2 + g.y) * g.tile * 0.03);
    sp.alpha = g.blink ? 0.35 + 0.65 * (reduced ? 1 : 0.5 + 0.5 * Math.sin(now / 90)) : 1;
  }
  for (const sp of sprites) {
    if (sp.destroyed) continue;
    if (sp.trapFx && !(now - (sp.trapFx.last ?? -1e9) < 66)) { sp.trapFx.last = now; trapLeak(sp, now, reduced); }
    if (sp.vines && !(now - (sp.vines.last ?? -1e9) < 66)) { sp.vines.last = now; drawVines(sp, now, reduced); }
    if (sp.bell) sp.x = sp.bell.x0 + (reduced ? 0 : Math.sin(now / 1000 * 5) * 0.8 * sp.bell.u);
  }
  // 1.7 js/render.js items pass: loot bobs (RC48); a key's glow breathes and sheds ice glints (RC5); a mote glows (RC18).
  for (const sp of sprites) {
    const l = sp.loot;
    if (!l || sp.destroyed) continue;
    if (l.bob) sp.y = l.y0 + (reduced ? 0 : Math.sin(now / 400 + l.x * 2 + l.y) * l.tile * 0.03);
    if (l.key) {
      sp.alpha = 0.55 * (reduced ? 1 : 0.75 + 0.25 * Math.sin(now / 420 + l.x + l.y));
      for (const g of l.glints) { const a = reduced ? 0 : Math.max(0, Math.sin(now / 260 + g.phase)); g.alpha = a * a * 0.9; }
    }
    if (l.mote) sp.alpha = reduced ? 0 : 0.18 + 0.08 * Math.sin(now / 200 + l.x);
  }
}

// js/render.js: the key's glow, a radial gradient (0.55 at the centre, 0.18 at 0.55, clear at the edge), drawn in white.
let lootGlowTex = null;
export function lootGlow() {
  if (lootGlowTex) return lootGlowTex;
  const R = 64, c = document.createElement('canvas'); c.width = c.height = R * 2;
  const g = c.getContext('2d'), gr = g.createRadialGradient(R, R, R * 0.05 / 0.62, R, R, R);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.327)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, R * 2, R * 2);
  return (lootGlowTex = Texture.from(c));
}
export const MOTE_COL = { fire: 0xE2622B, water: 0x62A8D8, air: 0xE8D27A, earth: 0x7FA05A, light: 0xF6E7B0, shadow: 0x8A6FB0 };   // data/elements.json colours (1.7 AFF_COL)

// 1.7 drawGroundWarning: a radial gradient from 0.05 to 0.75 of a tile, solid to 0.55, painted once in white and tinted.
let warnTex = null;
function warnGradient() {
  if (warnTex) return warnTex;
  const R = 48, c = document.createElement('canvas'); c.width = c.height = R * 2;
  const g = c.getContext('2d'), gr = g.createRadialGradient(R, R, R * 0.05 / 0.75, R, R, R);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.55, '#ffffff'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, R * 2, R * 2);
  return (warnTex = Texture.from(c));
}

/** One marked tile of a coloured warning: the glow in the mark's colour and 1.7's pale centre dot. */
function warnGlow(x, y, colour, tile) {
  const c = new Container();
  const glow = new Sprite(warnGradient());
  glow.anchor.set(0.5); glow.width = glow.height = tile * 1.5; glow.tint = colour;
  const dot = new Graphics().circle(0, 0, tile * 0.12).fill({ color: 0xffffff, alpha: 0.35 });
  c.addChild(glow, dot);
  c.position.set((x + 0.5) * tile, (y + 0.5) * tile);
  c.zIndex = -2;
  c.warn = { glow, dot, x, y };
  return c;
}

/** Each frame: 1.7's pulse (0.45 + 0.3 sin(8t + x + y), 0.6 when motion is reduced), glow at 0.55 of the dot; shown
 *  only on tiles in sight, as 1.7 drew them (sceneVisibility). */
export function markTick(sprites, now, reduced, sight) {
  const t = now / 1000;
  for (const sp of sprites) {
    // RC49 (1.7 render.js items pass): loot shows only while its tile is in sight.
    const at = sp.lootAt ?? sp.item ?? sp.globe;
    if (at && sight && !sp.destroyed) sp.visible = !!sight.vis?.[at.y * sight.w + at.x];
    if (sp.danger && !sp.destroyed) { dangerTick(sp, now, reduced, sight); continue; }
    if (sp.sporeWarn && !sp.destroyed) {
      const w = sp.sporeWarn;
      sp.visible = !sight || !!sight.vis?.[w.y * sight.w + w.x];
      if (sp.visible) sporeWarnTick(sp, now, reduced);
      continue;
    }
    const w = sp.warn;
    if (!w || sp.destroyed) continue;
    sp.visible = !sight || !!sight.vis?.[w.y * sight.w + w.x];
    if (!sp.visible) continue;
    const pulse = reduced ? 0.6 : 0.45 + 0.3 * Math.sin(t * 8 + w.x + w.y);
    w.glow.alpha = pulse * 0.55 * (w.op ?? 1); w.dot.alpha = pulse * (w.op ?? 1);
  }
}

/** RC27: a red mark's pulse (render.js:1572-1581). Urgent (the blow lands within a turn) unless its owner's blow is
 *  further off (boss.js pending.landAt, or the mark's own landAt: the Unmaker's pylons) or it is a second-level mark. */
export function dangerTick(sp, now, reduced, sight) {
  const d = sp.danger, st = sight?.state;
  sp.visible = !sight || !!sight.vis?.[d.y * sight.w + d.x];
  if (!sp.visible) return;
  const owner = st?.actors?.[d.mark.owner], land = d.mark.landAt ?? (owner?.telegraph ?? owner?.pending)?.landAt;   // C10g: telegraph.js marks too   // CH17: a pylon's line carries its own
  const urgent = d.mark.level !== 2 && !(Number.isFinite(land) && Number.isFinite(st.now) && Math.ceil((land - st.now) / TURN) > 1);
  const pulse = reduced ? 0.7 : 0.5 + 0.5 * Math.sin(now / (urgent ? 110 : 220));
  d.fill.alpha = (urgent ? 0.34 : 0.2) + 0.16 * pulse; d.edge.alpha = 0.55 + 0.35 * pulse;
  if (d.arrow) d.arrow.alpha = 0.5 + 0.4 * pulse;
}

/**
 * M37: telegraphed tiles, in the warning colour, until the blow lands. A mark with its own colour (the planes'
 * flares, rocks, embers, surges and gales, the Emberlord's eruption, the Matron's rites) is 1.7's drawGroundWarning
 * glow in that colour (crypt.js:138), pulsing in markTick; the rest keep the red squares. Both map looks draw them.
 */
export function buildMarks(floor, tile) {
  const out = [];
  for (const m of floor.marks ?? []) {
    if (m.colour) {
      // EP30 (1.7 sporecaller.js:160-172): a spore field's warning glows at 0.8 over its roots, mist and sprouts
      const spores = m.warning === 'warn.spore-field';
      if (spores) out.push(...sporeWarnTiles(floor, m.tiles, tile));
      for (const t of m.tiles) { const g = warnGlow(t.x, t.y, m.colour, tile); if (spores) g.warn.op = 0.8; out.push(g); }
      continue;
    }
    // RC27, RC28 (1.7 drawBossDangerTiles and drawBossTelegraphs, render.js:1572-1593): each tile a red square that pulses,
    // every 220 ms, and every 110 ms and redder once the blow is a turn away (a mark at the second level, the Discord
    // Pulse's outer ring CH18, stays at due 2); a charge's lane has an arrow on each tile pointing the way he runs.
    // markTick animates them, on tiles in sight only.
    const lane = m.warning === 'warn.grukk.charge' && m.tiles.length > 1 ? Math.atan2(m.tiles[1].y - m.tiles[0].y, m.tiles[1].x - m.tiles[0].x) : null;
    for (const t of m.tiles) {
      const c = new Container(), fill = new Graphics().rect(1, 1, tile - 2, tile - 2).fill({ color: 0xd2281e });
      const edge = new Graphics().rect(2, 2, tile - 4, tile - 4).stroke({ color: 0xff785a, width: Math.max(1.5, tile * 0.05) });
      c.addChild(fill, edge);
      let arrow = null;
      if (lane !== null) {
        const h = tile / 2, P = (a, r) => [h + Math.cos(a) * tile * r, h + Math.sin(a) * tile * r];
        arrow = new Graphics().poly([...P(lane, 0.25), ...P(lane + 2.4, 0.18), ...P(lane - 2.4, 0.18)]).fill({ color: 0xffd2a0 });
        c.addChild(arrow);
      }
      c.position.set(t.x * tile, t.y * tile); c.zIndex = -2;
      c.danger = { mark: m, x: t.x, y: t.y, fill, edge, arrow };
      out.push(c);
    }
  }
  return out;
}
