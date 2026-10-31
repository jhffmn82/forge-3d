// Status icons with the turns left (1.7's status row beside the bars) and the boss bar (name, telegraph words,
// HP) at the top centre on the laptop, under the readouts on the phone.

import { Container, Graphics, FillGradient } from '../../../../forge-godot/runtime/pixi.js';
import { color, space } from '../core/widgets.js';
import { icon, statusIcon } from '../core/icons.js';
import { statusList, statusCard, bossOf, bossWarning } from '../model/hud-model.js';
import strings from '../../../data/strings.json' with { type: 'json' };
import { hoverCard } from './bars.js';
import { words, geo, gradient, tone } from '../core/look.js';

/**
 * Wobbles' Amusement as 1.7 drew it (responsive-hud.css:73-76, responsive-hud.js paintAmusement): first in the row, a
 * status box in purple whose fill rises with the amusement, the god's dice over it and the percent in its corner.
 */
function amusementBox(kit, sz, G, pct, open) {
  const c = new Container();
  c.label = 'hud-amusement';
  const fillH = Math.round((sz - 2) * pct / 100);
  const g = new Graphics().roundRect(0.5, 0.5, sz - 1, sz - 1, 2).fill(0x211826);
  if (fillH > 0) g.rect(1, sz - 1 - fillH, sz - 2, fillH).fill(gradient(0xa872b9, 0x634277)).rect(1, sz - 1 - fillH, sz - 2, 1).fill(0xd5a1e9);
  g.roundRect(0.5, 0.5, sz - 1, sz - 1, 2).stroke({ color: 0xae88bd, width: 1 });
  c.addChild(g);
  const pic = icon('pr-rolldice2', G.statusIcon);
  if (pic) { pic.position.x += (sz - G.statusIcon) / 2; pic.position.y += (sz - G.statusIcon) / 2; c.addChild(pic); }
  const n = words(kit, `${pct}%`, G.statusNum, { fill: 0xffffff, weight: '700' });
  n.anchor.set(1, 1); n.position.set(sz - 1, sz);
  c.addChild(n);
  c.hitArea = { contains: (x, y) => x >= 0 && y >= 0 && x <= sz && y <= sz };
  // H22 (1.7 ui.js:324-327): the card names the Amusement and says Wobbles' passive (enchtext.js wobblesPassiveDetails).
  hoverCard(kit, c, { title: `Amusement ${pct}%`, lines: [strings.rows['god.wobbles.passive']] });
  if (open) c.on('pointertap', () => open('Faith'));
  return c;
}

/**
 * @param {ReturnType<import('../core/widgets.js').createKit>} kit
 * @param {number} maxW the room the row may take before it wraps
 * @param {{G?:any, mirror?:boolean, open?:(name:string)=>void}} [o] G: the geometry sized by Options Status size;
 *   mirror: the row fills from its right end (Status position Right); open: Amusement opens Faith
 */
export function buildStatuses(kit, maxW, o = {}) {
  const root = new Container();
  root.label = 'hud-statuses';
  // 1.7 statusicons.js and responsive-hud.css, at 1.7's interface scale (look.js geo): a large touch screen held wide has bigger boxes.
  const st0 = kit.stage, G = o.G ?? geo[st0.kind], big = st0.kind === 'L' && st0.touch && st0.w >= 960 && st0.h >= 600;
  const sz = big ? G.statusTouch : G.status, gap = big ? G.statusTouchGap : G.statusGap, pic0 = G.statusIcon;   // the icon is the same size in every box
  return {
    root,
    set(state) {
      root.removeChildren().forEach(c => c.destroy({ children: true }));
      const hero = state.actors[state.playerId], list = statusList(hero, state);
      const per = Math.max(1, Math.floor((maxW + gap) / (sz + gap)));
      const at = i => ({ x: o.mirror ? maxW - sz - (i % per) * (sz + gap) : (i % per) * (sz + gap), y: Math.floor(i / per) * (sz + gap) });
      const faith = state.hero?.faith;
      const lead = faith?.god === 'wobbles' ? 1 : 0;
      if (lead) {
        const box = amusementBox(kit, sz, G, Math.max(0, Math.min(100, Math.round(faith.amusement ?? 0))), o.open);
        box.position.set(at(0).x, at(0).y);
        root.addChild(box);
      }
      list.forEach((st, k) => {
        const i = k + lead;
        const c = new Container();
        c.label = `hud-status-${st.id}`;
        // A dark box, radius 2, its 1 px rim green, or red for a harmful status.
        c.addChild(new Graphics().roundRect(0.5, 0.5, sz - 1, sz - 1, 2).fill({ color: 0x151510, alpha: 0xde / 255 }).stroke({ color: st.harmful ? 0xa04a3a : 0x6b8a5a, width: 1 }));
        const pic = statusIcon(st.icon, pic0, true);
        if (pic) { pic.position.x += (sz - pic0) / 2; pic.position.y += (sz - pic0) / 2; c.addChild(pic); }
        else { const t = kit.text(st.name.slice(0, 3), { size: 12, font: 'mono', fill: color.ink }); t.position.set(2, 2); c.addChild(t); }
        if (st.turns !== null && st.turns !== undefined && st.turns < 999) {
          const n = words(kit, String(st.turns), G.statusNum, { fill: 0xffffff, weight: '700' });   // white, bold, 2 px from the right, on the bottom
          n.anchor.set(1, 1); n.position.set(sz - G.statusGap, sz);
          c.addChild(n);
        }
        // H20 (1.7 statusicons.js:137, :168-170): stacks as a gold '×n' on a dark tab at the top left (12 px bold where
        // the turns are 11, radius 3, padding 0 2 px, rgba(18,15,13,.85)).
        if (st.stacks > 0) {
          const t = words(kit, `×${st.stacks}`, G.statusNum * 12 / 11, { fill: tone.gold, weight: '700' });
          const tab = new Graphics().roundRect(1, 0, Math.ceil(t.width) + 4, Math.ceil(t.height * 0.86), 3).fill({ color: 0x120f0d, alpha: 0.85 });
          t.position.set(3, Math.round((t.height * 0.86 - t.height) / 2));
          tab.label = 'hud-status-stacks';
          c.addChild(tab, t);
        }
        c.position.set(at(i).x, at(i).y);
        c.hitArea = { contains: (x, y) => x >= 0 && y >= 0 && x <= sz && y <= sz };
        hoverCard(kit, c, () => statusCard(state, hero, st));   // H19: what it does, with live numbers
        root.addChild(c);
      });
    },
  };
}

// The boss bar fill, made once (a gradient in local space fits any width).
let bossGrad = null;
const bossFill = () => (bossGrad ??= new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, colorStops: [{ offset: 0, color: 0x8e2f27 }, { offset: 1, color: 0xe2622b }], textureSpace: 'local' }));

/**
 * The boss bar: hidden until a boss is in sight. H17 (1.7 ui.js .bossbar): the name in the display face in 1.7's gold
 * (#E8B44A) with a soft black shadow, over a 9 px bar with a 1 px #5A2E18 edge on #1A0E0A, radius 4, filled left to
 * right from #8E2F27 to #E2622B; sizes at 1.7's interface scale (look.js geo).
 */
export function buildBossBar(kit, w) {
  const root = new Container();
  root.label = 'hud-boss';
  root.visible = false;
  const k = kit.stage.kind === 'P' ? 390 / 430 : 4 / 3, barH = Math.round(9 * k);
  const name = words(kit, '', 15 * k, { font: 'display', fill: tone.gold, blur: 3 });
  const tele = kit.text('', { size: 14, fill: color.ink, wrap: w, align: 'center' });
  const g = new Graphics();
  name.anchor.set(0.5, 0); tele.anchor.set(0.5, 0);
  root.addChild(name, g, tele);
  return {
    root,
    set(state) {
      const b = bossOf(state);
      root.visible = !!b;
      if (!b) return;
      name.text = b.name; name.position.set(w / 2, 0);
      const y = Math.round(name.height + 3 * k), frac = Math.max(0, Math.min(1, b.hp / Math.max(1, b.maxhp))), fw = Math.round((w - 2) * frac);
      g.clear().roundRect(0.5, y + 0.5, w - 1, barH - 1, 4).fill(0x1a0e0a);
      if (fw > 0) g.roundRect(1, y + 1, fw, barH - 2, 3).fill(bossFill());
      g.roundRect(0.5, y + 0.5, w - 1, barH - 1, 4).stroke({ color: 0x5a2e18, width: 1 });
      const warn = bossWarning(state, b);
      tele.text = warn?.text ?? '';
      if (warn) tele.style.fill = warn.colour;
      tele.visible = !!warn;
      tele.position.set(w / 2, y + barH + space.inRow);
    },
  };
}
