// The hero's portrait: 1.7's painted head in a round frame, with the 'LV n  R n' badge (the rank in the god's colour
// once sworn) and the stat-points tab on the frame's left edge. It plays the body's clips as 1.7 does: quiet twice, then turn, and hurt when the hero
// takes damage. Reduced motion shows the still. The sheets are the body-<body> load group (assets/README.md).

import { Container, Graphics, Sprite, Assets, Ticker } from '../../../../forge-godot/runtime/pixi.js';
import { hasSheet, sheet, loadGroup } from '../core/art.js';   // C17: render through ui/core
import { tone, words } from '../core/look.js';
import { elementColour, toCss } from '../core/colour.js';

const CLIPS = ['quiet', 'turn', 'hurt'];

// 1.7 responsive-hud.js blockRaceColors, and AFF_COL (game.js:41) for a Fae's court.
const BLOCK_RACE = { human: '#F2E8DC', elf: '#7FD08A', dwarf: '#E8B44A', gloomling: '#B58BFF' };
/** The block portrait's '@' colour for a hero; courtLook: the court's element ('fire'). */
export function blockColour(hero, courtLook = null) {
  const court = hero?.race === 'fae' ? elementColour(courtLook, 'enchant') : null;   // 1.7 AFF_COL (ui.json elementPalettes.enchant)
  return (court !== null ? toCss(court) : BLOCK_RACE[hero?.race]) ?? '#F2E8DC';
}

/** The frames of one clip with each frame's time, or null when the sheet is not loaded. */
function clip(body, name) {
  const key = `images/portraits/${body}-${name}`;
  if (!hasSheet(key)) return null;
  const s = sheet(key), meta = s.data.meta ?? {};
  const frames = s.animations?.[name] ?? Object.keys(s.textures).sort((a, b) => Number(a.split('-').pop()) - Number(b.split('-').pop())).map(k => s.textures[k]);
  const delays = meta.frameDelays ?? frames.map(() => meta.delay ?? 160);
  return { frames, delays, total: delays.reduce((a, b) => a + b, 0) };
}

/** The frame to show `t` ms into a clip. */
function at(c, t) {
  let left = t;
  for (let i = 0; i < c.frames.length; i++) { if (left < c.delays[i]) return c.frames[i]; left -= c.delays[i]; }
  return c.frames[c.frames.length - 1];
}

/**
 * @param {ReturnType<import('../core/widgets.js').createKit>} kit
 * @param {number} size diameter in logical px
 * @param {string|null} body portrait body key ('dwarf-m')
 * @param {{reduced:()=>boolean, onTap:()=>void, onPoints:()=>void, levelPx:number}} o
 */
export function buildPortrait(kit, size, body, o) {
  const root = new Container();
  root.label = 'hud-portrait';
  const r = size / 2;
  // CH-29 (1.7 responsive-hud.css:911-914): a near-black #101012 disc in a 1 px muted #756443 ring, the painting
  // inset by the ring, over a soft shadow (box-shadow 0 1px 3px #0008): rings fading out from the edge, 1 px down.
  const shadow = new Graphics();
  for (let i = 3; i >= 1; i--) shadow.circle(r, r + 1, r + i - 0.5).fill({ color: 0x000000, alpha: 0.53 * (4 - i) / 6 });
  shadow.eventMode = 'none';
  const disc = new Graphics().circle(r, r, r - 0.5).fill({ color: tone.frame, alpha: 1 });
  const ring = new Graphics().circle(r, r, r - 0.5).stroke({ color: tone.frameRing, width: 1 });
  ring.eventMode = 'none';
  const art = new Sprite();
  const mask = new Graphics().circle(r, r, r - 1).fill(0xffffff);
  art.mask = mask;
  root.addChild(shadow, disc, art, mask, ring);

  let clips = body ? Object.fromEntries(CLIPS.map(n => [n, clip(body, n)])) : {};
  let still = body ? Assets.get(`assets/images/portraits/${body}.webp`) ?? clips.quiet?.frames[0] ?? null : null;
  const fit = tex => {
    if (!tex || art.texture === tex) return;
    art.texture = tex;
    const k = size / Math.max(tex.width, tex.height);
    art.scale.set(k);
    art.position.set((size - tex.width * k) / 2, (size - tex.height * k) / 2);
  };
  fit(clips.quiet?.frames[0] ?? still);

  // 1.7's cycle: quiet, quiet, turn; hurt cuts in and the cycle starts again after it.
  let t = 0, hurtAt = null;
  let cycle = (clips.quiet?.total ?? 0) * 2 + (clips.turn?.total ?? 0);
  function tick(tk) {
    if (o.reduced() || !clips.quiet) { fit(still ?? clips.quiet?.frames[0]); return; }
    t += Math.min(tk.deltaMS, 64);
    if (hurtAt !== null && clips.hurt) {
      const h = t - hurtAt;
      if (h < clips.hurt.total) return fit(at(clips.hurt, h));
      hurtAt = null; t = 0;
    }
    const q = clips.quiet.total, e = t % cycle;
    fit(e < q * 2 ? at(clips.quiet, e % q) : at(clips.turn ?? clips.quiet, e - q * 2));
  }
  Ticker.shared.add(tick);
  root.on('destroyed', () => Ticker.shared.remove(tick));
  // Under load at a phone's start the body-<body> group can still be on its way, and the frame stayed empty until someone
  // else loaded it: the portrait asks for its own group and redraws when it lands (proof pass, assets).
  if (body && !clips.quiet && !still) loadGroup('body-' + body).then(() => {
    if (root.destroyed) return;
    clips = Object.fromEntries(CLIPS.map(n => [n, clip(body, n)]));
    still = Assets.get(`assets/images/portraits/${body}.webp`) ?? clips.quiet?.frames[0] ?? null;
    cycle = (clips.quiet?.total ?? 0) * 2 + (clips.turn?.total ?? 0);
    fit(clips.quiet?.frames[0] ?? still);
  }).catch(() => { /* the frame stays empty; the asset check reports a missing group */ });

  // The round frame answers a tap (the stat-points button below it is its own control).
  disc.eventMode = 'static'; disc.cursor = 'pointer';
  disc.hitArea = { contains: (x, y) => (x - r) ** 2 + (y - r) ** 2 <= r * r };
  disc.on('pointertap', e => { e.stopPropagation(); o.onTap(); });
  art.eventMode = 'none'; mask.eventMode = 'none';
  // Map art Blocks (1.7 responsive-hud.js paintPortrait, study-block-portrait): no painting, an '@' in the hero's
  // race colour (a Fae's in its court's) on #101012, 68% of the frame, bold mono (CH-09).
  if (o.block) {
    disc.clear().circle(r, r, r - 0.5).fill({ color: 0x101012, alpha: 1 });
    const at = kit.text('@', { font: 'mono', weight: '700', fill: o.block.color });
    at.style.fontSize = Math.round(size * 0.68); at.style.lineHeight = Math.round(size * 0.68 * 1.2);
    at.anchor.set(0.5); at.position.set(r, r - size * 0.02); at.eventMode = 'none';
    root.addChildAt(at, root.getChildIndex(ring));
  }

  // CH-24 (1.7 responsive-hud.css:915-921, responsive-hud.js:469-473, 490-492): the badge on the frame's foot,
  // 'LV n' in #e6ddce and, once sworn, 'R n' in the god's colour, each a small 'LV'/'R' before the number, on a
  // #15120de8 tab with no edge.
  const badges = new Container();
  badges.eventMode = 'none';
  root.addChild(badges);
  function part(tag, n, fill) {
    const c = new Container();
    const t = words(kit, tag, o.levelPx * 0.85, { fill, weight: '600', shadow: false });
    const v = words(kit, String(n), o.levelPx, { fill, weight: '600', shadow: false });
    t.y = Math.round((v.height - t.height) / 2 + 1); v.x = Math.round(t.width + o.levelPx * 0.3);
    c.addChild(t, v);
    return c;
  }
  function badge(level, rank) {
    const c = new Container(), lv = part('LV', level, tone.badgeInk);
    const parts = [lv];
    // 1.7 #studyRank: gap 5 px, then 6 px more before it (its border-left names an unset colour, so no line shows).
    if (rank) { const rk = part('R', rank.n, rank.colour); rk.x = Math.round(lv.width + 11); rk.label = 'hud-rank'; parts.push(rk); }
    const inner = Math.max(...parts.map(p => p.x + p.width)), ih = Math.max(...parts.map(p => p.height));
    const w = Math.round(inner + 8), h = Math.round(ih + 3);
    c.addChild(new Graphics().roundRect(0, 0, w, h, 3).fill({ color: tone.badge, alpha: 0.91 }));
    for (const p of parts) { p.position.set(p.x + 4, 1.5); c.addChild(p); }
    return c;
  }

  // CH-25 (1.7 responsive-hud.css:958-962): the stat-points tab, '+2' in gold on a #292114 face with a #9c7841 edge,
  // radius 7, on the frame's left edge 65% of the way down (the right edge when mirrored); opens Character.
  const points = new Container();
  points.label = 'hud-points';
  points.visible = false;
  const pointsFace = new Graphics(), pointsText = words(kit, '+0', 12, { fill: tone.gold, weight: '600', shadow: false });
  points.addChild(pointsFace, pointsText);
  points.hitArea = { contains: (x, y) => x >= -4 && y >= -4 && x <= points.width + 4 && y <= points.height + 4 };
  kit.control(points, () => o.onPoints());
  root.addChild(points);

  return {
    root, disc, points,
    /** rank: { n, colour } once sworn to a god, else null. */
    set(level, pts, rank = null) {
      badges.removeChildren().forEach(c => c.destroy({ children: true }));
      const lv = badge(level, rank);
      // 1.7: bottom -1 px, centred.
      lv.position.set(Math.round((size - lv.width) / 2), Math.round(size - lv.height + 1));
      badges.addChild(lv);
      points.visible = pts > 0;
      if (pts > 0) {
        pointsText.text = `+${pts}`;
        const w = Math.max(23, Math.round(pointsText.width + 8)), h = 21;
        pointsText.position.set(Math.round((w - pointsText.width) / 2), Math.round((h - pointsText.height) / 2));
        pointsFace.clear().roundRect(0.5, 0.5, w - 1, h - 1, 7).fill({ color: tone.pointsFace, alpha: 0.94 }).stroke({ color: tone.pointsEdge, width: 1 });
        points.position.set(o.mirror ? size + 4 - w : -4, Math.round(size * 0.65));
      }
    },
    hurt() { if (clips.hurt && !o.reduced()) hurtAt = t; },
  };
}
