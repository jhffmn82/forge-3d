// FX29, FX30: the long buffs seen on the hero for as long as they last (1.7 js/presentation/effects/fx.js:213-219,
// :811-935, FX_AURAS, fxAuraPaint and drawMiasma, 2026-10-12). Each is about twenty soft stamps or fewer at low strength,
// circling the hero, each piece at its own pace, reach and breathing; wisps may rise through them; a breath of light may
// sit under it all. Each eases in and out over about 240 ms; the easing lives here, never on the hero. Looks only: the
// rows read the hero's statuses and write nothing.
//
// fx-kit.js calls paintAuras each frame with its stamp layers (img, lay, stamp), before the timed pieces, as 1.7's drawFX
// did. Positions are map pixels: the hero sprite's root stands at the tile's foot centre, so 1.7's (rp.y + low) * TS is
// root.y - T + low * T.

import gods from '../../data/gods.json' with { type: 'json' };
import { TRAIL, ELEMENT_COLOUR as AFF_COL, DAMAGE_COLOUR as DMG_COL } from '../data/palette.js';
import { hash2 } from '../lib/noise.js';

const GOD = Object.fromEntries(Object.entries(gods.rows).map(([k, v]) => [k, v.color]));
// 1.7 FX_AURA_GAIN: filmed at their written strengths the auras could not be seen against a lit floor; one gain for all.
const GAIN = 2.1;
const has = (a, ...ids) => ids.some(id => !!a.statuses?.[id]);

/** 1.7 FX_AURAS: name, the live test on the hero, and the painter's options (fxAuraPaint o, sizes in tiles). */
export const AURAS = [
  // Mother Murk's Unholy Aura: the miasma, kept exactly as it was. It shows for as long as the aura lasts and does not fade.
  { name: 'aura', when: a => has(a, 'aura'), miasma: true },
  // Storm Form, the epic of Air: wind tears round in long pale streaks, all one way, pulled up off the shoulders; the air
  // about the body is charged and pulses; threads of lightning jump from place to place in bursts and lulls.
  { name: 'stormform', when: a => has(a, 'stormform'), storm: true, o: { cols: [AFF_COL.air, TRAIL.lightning.col[2], TRAIL.lightning.col[0]], n: 9, stamp: 'wisp', reach: 0.72, size: 0.3, pace: 3.2, oneWay: true, alpha: 0.36, glow: true, flat: 0.5, low: 0.55,
    rise: 3, riseCol: TRAIL.lightning.col[2], riseH: 1.2, risePace: 1.1, riseA: 0.3, haze: DMG_COL.lightning, hazeA: 0.2, hazeR: 1.15, hazeTall: 0.8, beat: 3.1 } },
  // Stone Skin: grit and dust turning slowly about the shins, with a dull warmth of raised dust at the feet.
  { name: 'stone', when: a => has(a, 'stone-skin'), o: { cols: TRAIL.earth.col, n: 8, reach: 0.44, size: 0.2, pace: 0.16, alpha: 0.34, flat: 0.42, low: 0.8, haze: TRAIL.earth.col[2], hazeA: 0.1, hazeR: 0.6, hazeTall: 0.45 } },
  // Haste: quick thin streaks of wind whipping round the legs.
  { name: 'haste', when: a => has(a, 'haste'), o: { cols: [AFF_COL.air, DMG_COL.phys], n: 6, stamp: 'wisp', reach: 0.46, size: 0.2, pace: 2.6, oneWay: true, alpha: 0.26, glow: true, flat: 0.36, low: 0.82 } },
  // Iron Body and Iron Hide (one look): a close burnished sheen with a glint off it now and then.
  { name: 'ironbody', when: a => has(a, 'ironbody', 'ironhide'), o: { cols: [DMG_COL.phys, GOD.grom], n: 5, reach: 0.26, size: 0.1, pace: 0.12, wink: true, alpha: 0.5, glow: true, flat: 1.2, low: 0.48, haze: GOD.grom, hazeA: 0.17, hazeR: 0.5, hazeTall: 1.25 } },
  // Rampage: heat off an angry body. A red breath that beats like a pulse, quick wisps climbing from the shoulders, embers.
  { name: 'rampage', when: a => has(a, 'rampage'), o: { cols: [TRAIL.fire.col[1], GOD.grumbok], n: 5, reach: 0.4, size: 0.1, pace: 0.9, wink: true, alpha: 0.5, glow: true, flat: 0.9, low: 0.45,
    rise: 5, riseCol: GOD.grumbok, riseH: 0.8, risePace: 0.8, riseA: 0.4, haze: GOD.grumbok, hazeA: 0.2, hazeR: 0.62, hazeTall: 1.1, beat: 5 } },
  // Last Stand: pale steady light pooled at the feet, and slow banners of it standing up around him.
  { name: 'laststand', when: a => has(a, 'laststand'), o: { cols: [GOD.reginald, DMG_COL.phys], n: 6, reach: 0.56, size: 0.2, pace: 0.14, alpha: 0.2, glow: true, flat: 0.4, low: 0.88,
    rise: 4, riseCol: DMG_COL.phys, riseH: 1.0, risePace: 0.2, riseA: 0.26, haze: GOD.reginald, hazeA: 0.22, hazeR: 0.8, hazeTall: 0.42 } },
  // Lucky Streak: a scatter of bright things that will not hold still. They wink, wander and wink again.
  { name: 'luckystreak', when: a => has(a, 'luckystreak'), o: { cols: [GOD.wobbles, DMG_COL.xp, TRAIL.light.col[0]], n: 9, reach: 0.55, size: 0.1, pace: 0.7, wink: true, alpha: 0.75, glow: true, flat: 1.0, low: 0.42 } },
  // Thorns: a bristle of green barbs standing out from the body, shifting as it breathes.
  { name: 'thorns', when: a => has(a, 'thorns'), o: { cols: [AFF_COL.earth, TRAIL.poison.col[2]], n: 9, stamp: 'shard', reach: 0.3, size: 0.13, pace: 0.1, alpha: 0.5, flat: 0.7, low: 0.56 } },
  // Mana Ward: a shell in Vellum's blue. Soft arcs sliding over a round of faint light, some one way and some the other.
  { name: 'manaward', when: a => has(a, 'manaward'), o: { cols: [GOD.vellum, TRAIL.magic.col[1]], n: 7, stamp: 'wisp', reach: 0.5, size: 0.22, pace: 0.45, alpha: 0.3, glow: true, flat: 0.95, low: 0.5, haze: GOD.vellum, hazeA: 0.16, hazeR: 0.74, hazeTall: 1.05 } },
];

/**
 * The auras' painter, one per pieces layer. paint(hero, now, dt, reduced, k): hero is { actor, x, y } (x, y the sprite
 * root in map pixels) or null when there is no living hero in view; k is { img, lay, stamp, T }.
 */
export function createAuras() {
  const seen = new Map();
  /** 1.7 fxAuraPaint. */
  function paint(k, hx, hy, t, s, o) {
    const { img, lay, stamp, T } = k, cx = hx, cy = hy - T + (o.low || 0.62) * T, flat = o.flat || 0.55, kind = o.stamp || 'puff', reach = T * (o.reach || 0.6);
    if (o.haze) {
      const hr = T * (o.hazeR || 0.9) * (1 + 0.06 * Math.sin(t * 0.8)), tall = o.hazeTall || 0.7;
      img(stamp('puff', o.haze), cx - hr, cy - hr * tall, hr * 2, hr * 2 * tall, Math.min(1, s * GAIN * (o.hazeA || 0.16) * (0.82 + 0.18 * Math.sin(t * (o.beat || 1.1)))), true);
    }
    for (let i = 0; i < (o.n || 0); i++) {
      // slow and uneven; the pieces on the near side of the circle show a little stronger than those behind
      const around = t * (o.pace || 0.3) * (0.7 + 0.6 * hash2(i, 3, 431)) * (o.oneWay || i % 2 ? 1 : -1) + i * 2.4, far = reach * (0.7 + 0.6 * hash2(i, 5, 432)) * (0.94 + 0.06 * Math.sin(t * 0.7 + i));
      const size = T * (o.size || 0.3) * 1.25 * (0.7 + 0.6 * hash2(i, 7, 433)) * (0.92 + 0.1 * Math.sin(t * 0.9 + i * 1.7)), near = 0.72 + 0.28 * Math.sin(around), px = cx + Math.cos(around) * far, py = cy + Math.sin(around) * far * flat, st = stamp(kind, o.cols[i % o.cols.length]);
      const a = Math.min(1, s * GAIN * (o.alpha || 0.22)) * near * (o.wink ? Math.pow(Math.max(0, Math.sin(t * (1.6 + 1.8 * hash2(i, 9, 434)) + i * 1.9)), 2) : 0.82 + 0.18 * Math.sin(t * 0.6 + i * 2.1));
      if (kind === 'wisp') lay(st, px, py, Math.atan2(Math.cos(around) * flat, -Math.sin(around)), size * 3.2 * Math.hypot(Math.sin(around), Math.cos(around) * flat), size * 0.9, false, a, !!o.glow);   // seen short where its path runs toward or away from the eye
      else if (kind === 'shard') lay(st, px, py, Math.atan2(Math.sin(around) * flat, Math.cos(around)), size * 2.6, size * 0.75, true, a, !!o.glow);
      else img(st, px - size, py - size * 0.8, size * 2, size * 1.6, a, !!o.glow);
    }
    if (o.rise) {
      const up = stamp('wisp', o.riseCol || o.cols[0]), ww = T * 0.2;
      for (let w = 0; w < o.rise; w++) {
        const climb = (t * (o.risePace || 0.25) + w / o.rise + hash2(w, 9, 435)) % 1, wx = cx + Math.sin(t * 0.5 + w * 2.2) * reach * 0.6;
        img(up, wx - ww / 2, cy + T * 0.1 - T * (o.riseH || 0.9) * climb - ww * 1.6, ww, ww * 3.2, Math.min(1, s * GAIN * (o.riseA || 0.34)) * Math.sin(climb * Math.PI), true);
      }
    }
  }
  /** Storm Form's threads of lightning: each lives one 110 ms beat; where it lies and whether it strikes change with the beat. */
  function storm(k, hx, hy, t, s) {
    const { lay, img, stamp, T } = k, cx = hx, cy = hy - T * 0.5, beat = t * 1000 / 110, mood = 0.3 + 0.25 * Math.sin(t * 1.7) + 0.12 * Math.sin(t * 4.3);
    const thread = stamp('fork', DMG_COL.lightning), white = stamp('fork', TRAIL.lightning.col[0]), spark = stamp('puff', TRAIL.lightning.col[0]);
    for (let j = 0; j < 3; j++) {
      const tick = Math.floor(beat + j * 0.37), age = (beat + j * 0.37) % 1; if (hash2(tick, j, 436) > mood) continue;
      const ang = hash2(tick, j, 437) * Math.PI * 2, far = T * (0.2 + 0.5 * hash2(tick, j, 438)), len = T * (0.5 + 0.55 * hash2(tick, j, 439)), x = cx + Math.cos(ang) * far, y = cy + Math.sin(ang) * far * 0.75, lie = ang + 1 + hash2(tick, j, 440) * 1.2;
      lay(thread, x, y, lie, len, len * 0.36, false, s * 0.7 * (1 - age), true);
      lay(white, x, y, lie, len, len * 0.36, false, s * 0.85 * (1 - age) * (1 - age), true);
      img(spark, x + Math.cos(lie) * len * 0.45 - T * 0.08, y + Math.sin(lie) * len * 0.45 - T * 0.08, T * 0.16, T * 0.16, s * 0.6 * (1 - age), true);
    }
  }
  /** 1.7 drawMiasma: Mother Murk's violet and sickly green murk circling slow and uneven, a violet breath, pale wisps rising. */
  function miasma(k, hx, hy, t) {
    const { img, stamp, T } = k, cx = hx, cy = hy - T + 0.62 * T;
    const murk = stamp('puff', '#5B4A78'), sick = stamp('puff', '#6E8A4C'), pale = stamp('wisp', '#B9A8D8');
    for (let n = 0; n < 14; n++) {
      const pace = 0.22 + 0.2 * hash2(n, 3, 411), around = t * pace * (n % 2 ? 1 : -1) + n * 0.9, far = T * (0.55 + 0.75 * hash2(n, 5, 412)) * (0.9 + 0.1 * Math.sin(t * 0.7 + n));
      const size = T * (0.5 + 0.45 * hash2(n, 7, 413)) * (0.9 + 0.12 * Math.sin(t * 0.9 + n * 1.7));
      img(n % 3 ? murk : sick, cx + Math.cos(around) * far - size, cy + Math.sin(around) * far * 0.55 - size * 0.8, size * 2, size * 1.6, 0.3 + 0.12 * Math.sin(t * 0.6 + n * 2.1), false);
    }
    // a breath of the god's own violet under it all, so the murk reads on dark stone
    const reach = T * (1.5 + 0.12 * Math.sin(t * 0.8));
    img(stamp('puff', '#8A6FB0'), cx - reach, cy - reach * 0.6, reach * 2, reach * 1.2, 0.26 + 0.06 * Math.sin(t * 1.1), true);
    for (let w = 0; w < 6; w++) {
      const up = (t * 0.22 + w / 6 + hash2(w, 9, 414)) % 1, wx = cx + Math.sin(t * 0.5 + w * 2.2) * T * 0.5, ww = T * 0.22;
      img(pale, wx - ww / 2, cy - T * (0.2 + 0.9 * up) - ww * 1.6, ww, ww * 3.2, 0.42 * Math.sin(up * Math.PI), true);
    }
  }
  return {
    /** The seen strength of each row (0..1), for checks. */
    seen: name => seen.get(name) ?? 0,
    paint(hero, now, dt, reduced, k) {
      if (!hero?.actor || !(hero.actor.hp > 0)) { seen.clear(); return; }
      const t = reduced ? 0 : now / 1000, since = Math.min(250, Math.max(0, dt));
      for (const row of AURAS) {
        const lit = row.when(hero.actor) ? 1 : 0, was = seen.get(row.name) ?? 0;
        const s = reduced ? lit : was + (lit - was) * (1 - Math.exp(-since / 240));
        seen.set(row.name, s);
        if (row.miasma) { if (lit) miasma(k, hero.x, hero.y, t); continue; }
        if (!(lit || s > 0.02)) continue;
        paint(k, hero.x, hero.y, t, s, row.o);
        if (row.storm) storm(k, hero.x, hero.y, t, s);
      }
    },
  };
}
