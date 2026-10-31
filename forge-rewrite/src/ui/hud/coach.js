// A tutorial card (hud/tips.js says which card, when, and its words): the screen uniformly dimmed, with no target
// highlights (Justin 2026-10-23: "all of them"). Centred, or beside the thing when it is on the map. Don't show again
// and Next (Got it on the last page); the game waits.

import { Container, Graphics } from '../../../../forge-godot/runtime/pixi.js';
import { color, space } from '../core/widgets.js';
import { cardFrame } from '../core/cards.js';

/**
 * @param {*} kit
 * @param {{page:number, pages:{title:string, words:string[], beside?:{tile:number[], up?:number}, next:string}[],
 *   rect:(t:{tile:number[], up?:number})=>({x:number,y:number,w:number,h:number}|null), dontShow:boolean, next:()=>void,
 *   toggle:()=>void}} o  Map anchors position a card without highlighting the tile.
 */
export function buildCoach(kit, o) {
  const st = kit.stage, root = new Container(), p = o.pages[o.page];
  root.label = 'coach';
  const onStage = r => r && r.x < st.w && r.y < st.h && r.x + r.w > 0 && r.y + r.h > 0;
  const anchor = p.beside ? o.rect(p.beside) : null;
  const full = g => g.rect(-st.ox / st.s, -st.oy / st.s, st.w + 2 * st.ox / st.s, st.h + 2 * st.oy / st.s);
  // The card takes every tap: the map, the HUD and any window wait while it is up.
  const catcher = full(new Graphics()).fill({ color: 0, alpha: 0.001 });
  catcher.label = 'coach-catch'; catcher.eventMode = 'static';
  const dim = full(new Graphics()).fill({ color: color.bg, alpha: 0.6 });
  dim.label = 'coach-dim'; dim.eventMode = 'none';
  root.addChild(catcher, dim);
  // The card: one width for every card, 16 px clear of a phone's edges.
  const w = Math.min(400, st.w - 32), pad = space.betweenRows, inner = w - pad * 2;
  const body = new Container();
  let y = 0;
  const put = n => { n.y = y; body.addChild(n); y += n.height + space.inRow; return n; };
  put(kit.text(p.title, { size: 16, font: 'display', fill: kit.accent, wrap: inner }));
  for (const words of p.words) put(kit.text(words, { size: 14, fill: color.ink, wrap: inner }));
  y += space.inRow;
  // The foot: Don't show again (a tick box), then Next or Got it.
  const tick = new Container();
  const box = new Graphics().rect(0, 0, 16, 16).stroke({ color: color.ash, width: 1.5 });
  if (o.dontShow) box.moveTo(3, 8).lineTo(7, 12).lineTo(13, 4).stroke({ color: kit.accent, width: 2 });
  const tw = kit.text('Don’t show again', { size: 14, fill: color.ash });
  tw.position.set(22, Math.round((16 - tw.height) / 2));
  const tickH = Math.max(36, kit.target), rowH = Math.max(32, kit.target);
  tick.addChild(new Graphics().rect(-4, (16 - tickH) / 2, tw.x + tw.width + 8, tickH).fill({ color: 0, alpha: 0.001 }), box, tw);
  tick.label = 'coach-dont-show';
  kit.control(tick, o.toggle);
  const next = kit.plateButton(p.next, o.next, { h: 32, size: 14, rank: 'prominent' });
  next.label = 'coach-next';
  // Layout uses the hit targets, not the shorter painted plates: the two stay separately tappable.
  const separate = inner - next.width < tick.width + space.inRow, firstH = separate ? tickH : Math.max(rowH, tickH);
  tick.y = (firstH - 16) / 2;
  const rowY = separate ? tickH + space.inRow : 0, rowHeight = separate ? rowH : firstH;
  next.position.set(inner - next.width, rowY + (rowHeight - 32) / 2);
  const foot = new Container();
  foot.addChild(tick, next);
  foot.y = y; body.addChild(foot);
  const h = y + rowY + rowHeight + pad * 2;
  const card = new Container();
  card.label = 'coach-card';
  card.addChild(cardFrame(w, h, { alpha: 0.96, edge: color.edge }));   // the card frame (ui-30)
  body.position.set(pad, pad);
  card.addChild(body);
  // Centred; beside a map thing, in the half of the screen away from it (above or below it where the screen is
  // too narrow for two cards across).
  let x = (st.w - w) / 2, cy = (st.h - h) / 2;
  if (onStage(anchor)) {
    if (st.w >= 2 * w + 48) x = anchor.x + anchor.w / 2 < st.w / 2 ? st.w * 0.75 - w / 2 : st.w * 0.25 - w / 2;
    else cy = anchor.y + anchor.h / 2 < st.h / 2 ? anchor.y + anchor.h + 16 : anchor.y - h - 16;
  }
  card.position.set(Math.round(Math.max(8, Math.min(st.w - w - 8, x))), Math.round(Math.max(8, Math.min(st.h - h - 8, cy))));
  card.eventMode = 'static';
  card.on('pointertap', e => e.stopPropagation());
  root.addChild(card);
  return root;
}
