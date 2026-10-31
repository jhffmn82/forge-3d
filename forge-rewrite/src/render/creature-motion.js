// A creature's own motions over its sheet (consolidation N3, render-28, moved from actor-sprite.js): its fit to the
// tile, its contact shadow, and the per-frame poses: the Matron's breath and silk, the Heart's slam, a flier's bob, the
// Maw's rise, a still body's breath.

import { Sprite, Graphics, Texture } from '../../../forge-godot/runtime/pixi.js';
import ui from '../../data/ui.json' with { type: 'json' };
import { whiten } from './body.js';

const SIZE = ui.actorSize;
// FX13: 1.7's fall for a creature with no death clip (fx.js:154-169): it flashes white, keels onto its side in the
// first 45% of 900 ms (eased in) and puffs dust as it lands: opts.fallDust(), the map's kit burst (1.7 fx.js:169
// burst(e.x, e.y, 'earth', 10, 0.03); N2, render-15).
const KEEL = { ms: 900, fall: 0.45, flashUntil: 0.25, flash: 0.8, dustAt: 0.4 };
/** How long a body with no death clip takes to fall (FX13). */
export const FALL_MS = KEEL.ms;
// UD8: the red glow under the channelling Matron (1.7's radial gradient from 0.1 to 1.5 tiles, rgba(220,30,50) to
// rgba(120,0,20,0)), drawn once at full strength; the sprite's alpha carries 1.7's pulsing 0.45 +- 0.15.
let glowTex = null;
function matronGlow() {
  if (glowTex) return glowTex;
  const N = 128, c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(N, N) : Object.assign(document.createElement('canvas'), { width: N, height: N });
  const g = c.getContext('2d'), gr = g.createRadialGradient(N / 2, N / 2, N / 2 * 0.1 / 1.5, N / 2, N / 2, N / 2);
  gr.addColorStop(0, 'rgba(220,30,50,1)'); gr.addColorStop(1, 'rgba(120,0,20,0)');
  g.fillStyle = gr; g.fillRect(0, 0, N, N);
  glowTex = Texture.from({ resource: c, scaleMode: 'linear' });
  return glowTex;
}
// CV12: the Maw rises out of the ground over 500 ms (eased out) from 2.2 tiles down and bobs while up (cavernmobs.js:467-476).
const RISE = { ms: 500, depth: 2.2, bobMs: 260, bob: 0.03 };

/** A creature's figure geometry: its scale and pivot (feet), one tile or across a size-n footprint (1.7 drawLargeCreature). */
export function creatureFit(meta, look, tile, n) {
  const cell = meta.cell, [bx, by, bw, bh] = meta.box ?? [0, 0, cell, cell];
  const scale = n > 1
    ? tile * n * 0.98 * (look.bigScale ?? 1) / Math.max(bh, bw * 0.85)   // planeterrain.js:1216
    : tile * (look.art ?? SIZE.defaultArt) / Math.max(bh, bw * SIZE.creatureWidthWeight);
  return { scale, px: bx + bw / 2, py: by + bh, lift: n > 1 ? tile * n * 0.03 : 0 };   // a big body's feet at 0.97 of its footprint
}
/** The contact shadow under a body (1.7 actorShadowFootprint, render.js:1073-1078): a size-n body's spans its footprint. */
export const contactShadow = (look, tile, n, hero = false) => n > 1
  ? new Graphics().ellipse(0, -tile * 0.1 * n, tile * 0.26 * n * (look.bigScale ?? 1), tile * 0.09 * n).fill({ color: 0x000000, alpha: 0.35 })
  : new Graphics().ellipse(0, -tile * 0.1, tile * (hero ? 0.28 : 0.26 * (look.art ?? 0.9)), tile * (hero ? 0.1 : 0.09)).fill({ color: 0x000000, alpha: 0.35 });   // the hero 0.28 x 0.10, a body 0.26 x art by 0.09, at 0.9 of the tile (audit RC62)

/**
 * The motions of one body (actor-sprite.js createActorSprite's options and parts). live: the body's {action, t, asleep}
 * now; hit: its hitFlash, whose filter the fall's white flash borrows. frame(d) runs each frame after the hit;
 * fall(on) starts or ends the fall of a body with no death row (FX13); rise(), lower(k) and channel(on) are the body's
 * own.
 */
export function creatureMotion({ tile, n, clock, root, place, figure, scale, pose, air, hover, phase, burrower, hero, elemental, scurry, sh, sheetName, hit, fallDust }, live) {
  let keel = null;   // FX13: the fall in progress, {t, dust}
  const keelFrame = d => {
    if (!keel) return;
    keel.t += d;
    const p = Math.min(1, keel.t / KEEL.ms), fall = Math.min(1, p / KEEL.fall), dir = figure.scale.x < 0 ? -1 : 1;
    figure.rotation = dir * fall * fall * Math.PI / 2;
    if (!hit.on) {
      const k = p < KEEL.flashUntil ? (KEEL.flashUntil - p) / KEEL.flashUntil * KEEL.flash : 0;
      hit.filter.matrix = whiten(k);
      figure.filters = k > 0 ? [hit.filter] : [];   // creatures only: no base filters to keep
    }
    if (!keel.dust && p > KEEL.dustAt) { keel.dust = true; fallDust(); }
  };
  // UD8 (1.7 deepmobs.js:630-641 prepareUnderdarkActor): the Matron, one still, breathes and sways about her feet; while
  // she channels she rises on her silk (a pale thread from above) over a pulsing red glow. CV15: lower() sets a drop
  // below the foot line (the Shock Eel under the surface). Both move the footprint's foot, under the hit's shake.
  const placeY = place.y, figureY = figure.y, ph = pose === 'matron' ? ([...String(sheetName)].length % 7) * 0.7 : 0;
  let riseAt = null;
  let lowered = 0, channelling = false, poseG = null;
  // RC15 (1.7 render.js:2350): a flier is drawn up off its shadow (a bat half a tile, any other 0.12) and bobs 0.04 tile
  // on a 180 ms beat. UD9 (1.7 deepmobs.js:643): a hoverer (the Fire Imp, the Thought Eater, the Storm Hawk, the Tempest
  // Djinn) is 0.06 tile higher still and drifts 0.05 tile on a 280 ms beat. Each body keeps its own phase; Reduce
  // motion keeps the lift and drops the bob.
  const airY = () => {
    if (!air && !hover) return 0;
    const ms = performance.now(), still = !!clock.reduced;
    let up = air ? tile * (air + (still ? 0 : 0.04 * Math.sin(ms / 180 + phase))) : 0;
    if (hover) up += tile * (0.06 - (still ? 0 : 0.05 * Math.sin(ms / 280 + phase)));
    return up;
  };
  const poseFrame = () => {
    if (pose === 'heart') return heartFrame();
    if (pose !== 'matron') { place.y = placeY + lowered - airY(); return; }
    const ms = performance.now(), still = !!clock.reduced;
    const breathe = still ? 0 : Math.sin(ms / 520 + ph), sway = still ? 0 : Math.sin(ms / 1300 + ph) * 0.018;
    const lift = channelling ? tile * (0.22 + (still ? 0 : 0.05 * Math.sin(ms / 300))) : 0;
    place.y = placeY + lowered - lift; place.rotation = sway;
    figure.scale.set((figure.scale.x < 0 ? -1 : 1) * scale * (1 + 0.012 * breathe), scale * (1 - 0.018 * breathe));
    if (!channelling) { if (poseG) poseG.glow.visible = poseG.thread.visible = false; return; }
    if (!poseG) {
      const glow = new Sprite(matronGlow()), thread = new Graphics();
      glow.anchor.set(0.5); glow.width = glow.height = tile * 3; glow.position.set(0, -tile * 0.15);   // 1.7: centred 0.85 down her tile, 1.5 tiles out
      root.addChildAt(thread, root.getChildIndex(place)); root.addChildAt(glow, root.getChildIndex(thread));   // under her, over the shadow
      poseG = { glow, thread };
    }
    poseG.glow.visible = poseG.thread.visible = true;
    poseG.glow.alpha = 0.45 + (still ? 0 : 0.15 * Math.sin(ms / 180));
    poseG.thread.clear().moveTo(0, -tile * 4).lineTo(0, -tile * 0.9 - lift).stroke({ color: 0xebe6dc, alpha: 0.55, width: Math.max(1, tile * 0.03) });
  };
  // PL10 (1.7 portals.js:659-670 prepareMountainHeartActor): over its attack's first 540 ms the Heart of the Mountain
  // lifts (to 0.12 tile up, 5% taller), then slams down with a squash (7% wider, 13% shorter) while a dust ring in
  // #C6A26B spreads and fades at its feet, over it. About the footprint's foot (1.7 used its top-left tile's), the ring across it.
  let dust = null;
  const heartFrame = () => {
    place.y = placeY + lowered;
    const p = live.action === 'melee' && !clock.reduced ? live.t / 540 : 1;
    if (p >= 1) { place.scale.set(1); if (dust) dust.visible = false; return; }
    const lift = p < 0.32 ? Math.sin(p / 0.32 * Math.PI / 2) : 0, slam = p >= 0.32 ? Math.sin(Math.min(1, (p - 0.32) / 0.68) * Math.PI) : 0;
    place.y -= tile * 0.12 * lift;
    place.scale.set(1 + 0.07 * slam, 1 + 0.05 * lift - 0.13 * slam);
    if (p < 0.32) { if (dust) dust.visible = false; return; }
    if (!dust) { dust = new Graphics(); dust.position.copyFrom(place.position); root.addChildAt(dust, root.getChildIndex(place) + 1); }   // over the body, as 1.7 stroked it after
    dust.visible = true;
    dust.clear().ellipse(0, 0, tile * n * 0.7 * (0.45 + p * 0.65), tile * n * 0.7 * (0.13 + p * 0.18))
      .stroke({ color: 0xc6a26b, alpha: (1 - p) * 0.6, width: Math.max(1, tile * 0.025) });
  };
  const riseFrame = () => {
    if (!burrower) return;
    const ms = performance.now(), p = riseAt == null ? 1 : Math.min(1, (ms - riseAt) / RISE.ms), ease = 1 - (1 - p) ** 3;
    figure.y = figureY + (1 - ease) * tile * RISE.depth + (clock.reduced ? 0 : Math.sin(ms / RISE.bobMs) * tile * RISE.bob);
  };

  // RC37 (1.7 render.js:1202-1212): an element-tier or still-posed body whose sheet has no motion of its own breathes
  // (1.2% taller and shorter on a 330 ms beat, its own phase) and squashes as it strikes (over 540 ms, 8% shorter and
  // 5% wider at the height of the blow), about its feet. Not asleep, not with Reduce motion.
  // Reviews 2, 9: a scurrier stretches with its step's hop, 4% taller and 3% narrower at the top (playback sets root.hop).
  const unmoving = !hero && elemental && !Object.values(sh.animations).some(a => a.length > 1) && !pose;
  const scaleFrame = () => {
    if (!unmoving && !scurry) return;
    let sx = 1, sy = 1;
    if (!clock.reduced && !live.asleep) {
      if (unmoving) {
        const strike = unmoving && (live.action === 'melee' || live.action === 'attack') && live.t < 540 ? Math.sin(live.t / 540 * Math.PI) : 0;
        sx += strike * 0.05; sy += Math.sin(performance.now() / 330 + phase) * 0.012 - strike * 0.08;
      }
      if (scurry && live.action === 'walk') { const h = Math.min(1, (root.hop ?? 0) / (tile * scurry.hop)); sx -= 0.03 * h; sy += 0.04 * h; }
    }
    place.scale.set(sx, sy);
  };
  return {
    frame(d) { keelFrame(d); riseFrame(); poseFrame(); scaleFrame(); },
    fall(on) { keel = on ? { t: 0, dust: false } : null; },
    /** Falling now, and whether the fall is over (its picture is the still, frame 0). */
    get falling() { return !!keel; },
    get fallen() { return !!keel && keel.t >= KEEL.ms; },
    /** CV12: rises out of the ground now (a burrower; others ignore it). */
    rise() { if (burrower) { riseAt = performance.now(); riseFrame(); } },
    /** CV15: drawn k tiles below its foot line (0 puts it back). */
    lower(k) { lowered = k * tile; },
    /** UD8: the Matron channelling a ritual; others ignore it. */
    channel(on) { channelling = pose === 'matron' && !!on; },
  };
}
