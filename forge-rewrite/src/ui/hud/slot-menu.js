// The hotbar slot's hold menu (consolidation H6, ui-24: out of hotbar.js). T8 (1.7 touchui.js openHM, #hmenu): the slot's
// whole card above its buttons, on the card frame (the edge line, 12 px corners, a soft shadow) 8 px in from the screen's
// sides, at most 520 wide, 8 px above the bar (beside a vertical bar). The card drops its how-to hints, which the
// buttons now say. A tap anywhere else closes it.

import { Container, Graphics } from '../../../../forge-godot/runtime/pixi.js';
import { cardBody, cardFrame } from '../core/cards.js';
import { boundsIn } from '../core/layout.js';
import { tone } from '../core/look.js';

const HINT = /(^Hold|Hold to|Right-click|^Drag |Key \d)/;

/**
 * Builds the menu into `layer` and returns it. detail: the slot's card; buttons: [words, act, selected?][]; bar: the
 * hotbar's root (the menu stands above it, or beside it when it stands upright); close: what a tap outside does.
 */
export function slotMenu(kit, { detail: d, buttons, bar, layer, close }) {
  const menu = new Container();
  menu.label = 'hud-slot-menu';
  const stage = kit.stage;
  const catcher = new Graphics().rect(0, 0, stage.w, stage.h).fill({ color: 0, alpha: 0.001 });
  catcher.eventMode = 'static';
  catcher.on('pointertap', e => { e.stopPropagation(); close(); });
  catcher.on('rightclick', e => { e.stopPropagation(); close(); });
  menu.addChild(catcher);
  const items = buttons.map(([words, act, on = false]) => kit.button(words, act, { size: 15, selected: on }));
  const pad = 12, gap = 10, w = Math.min(520, stage.w - 16);
  const card = cardBody(kit, { ...d, sub: d.sub && !HINT.test(d.sub) ? d.sub : null, lines: (d.lines ?? []).filter(l => !HINT.test(typeof l === 'string' ? l : l.text)) }, w - pad * 2);
  const box = new Container(), sheet = new Container();
  box.label = 'hud-slot-menu-box';
  box.addChild(sheet, card);
  card.position.set(pad, pad);
  // The buttons wrap in rows as 1.7's flex row, 8 px apart.
  let bx = pad, by = pad + card.height + gap, rowH = 0;
  for (const b of items) {
    if (bx > pad && bx + b.width > w - pad) { bx = pad; by += rowH + 8; rowH = 0; }
    b.position.set(bx, by); box.addChild(b); bx += b.width + 8; rowH = Math.max(rowH, b.height);
  }
  const h = by + rowH + pad;
  sheet.addChild(cardFrame(w, h, { radius: 12, alpha: 0.97, edge: tone.edge }));   // the card frame (ui-30)
  // Above the bar, or beside it when the bar stands upright (the HUD's Vertical layout).
  const r = boundsIn(bar, layer);
  let x = Math.round((stage.w - w) / 2), y;
  if (r.h > r.w) {
    y = 8;
    x = r.x > stage.w - (r.x + r.w) ? Math.max(8, Math.round(r.x - 8 - w)) : Math.min(stage.w - w - 8, Math.round(r.x + r.w + 8));
  } else y = r.y > stage.h * 0.4 ? r.y - 8 - h : r.y + r.h + 8;
  box.position.set(x, Math.round(Math.max(8, Math.min(stage.h - h - 8, y))));
  menu.addChild(box);
  layer.addChild(menu);
  // Over the whole HUD (the log, the pad), and no hover card beside it.
  const up = layer.parent;
  if (up) up.setChildIndex(layer, up.children.length - 1);
  return menu;
}
