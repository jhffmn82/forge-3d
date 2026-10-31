// Two small notices drawn on the canvas over everything, in CSS pixels at the bottom of the screen:
// - the floor notice (1.7 renderer.js:448-456 #floorArtStatus, interface.css:151-153; CSS-35, RB6): "Preparing floor…"
//   while a floor's art loads, or "Some artwork could not load." with a Retry, a flat panel bottom centre;
// - the offline badge (1.7 offline.js:22-35 say; O1): the installed copy's progress in the lower right corner, green
//   when done, gone 6 s later.
// Flat Lantern: the panel colour, no border or rounding; Retry is the loading screen's gold underlined word, at least
// a 44 px target. A touch screen reads 2 px larger (1.7 --ui-mobile-text-add).

import { Container, Graphics, Rectangle, Text } from '../../../../forge-godot/runtime/pixi.js';
import ui from '../../../data/ui.json' with { type: 'json' };
import { color } from '../core/widgets.js';
import { tone } from '../core/look.js';
import { after } from '../core/anim.js';

const MOSS = 0x7fa05a;

/** @param {Container} parent the stage, above the UI layer  @param {() => number} res the text resolution */
export function createNotices(parent, res) {
  const root = new Container();
  root.eventMode = 'passive';
  parent.addChild(root);
  let screenW = 0, screenH = 0, touch = false;
  const font = px => ({ fontFamily: ui.fonts.mono, fontSize: px + (touch ? 2 : 0), fill: color.ink });

  // ---- the floor notice
  const floor = new Container();
  floor.visible = false;
  floor.eventMode = 'static';
  floor.on('pointertap', e => e.stopPropagation());   // a tap on the notice never walks the hero
  floor.on('pointerdown', e => e.stopPropagation());
  root.addChild(floor);
  let floorState = null;   // { text, retry? }

  function drawFloor() {
    floor.removeChildren().forEach(c => c.destroy({ children: true }));
    if (!floorState) { floor.visible = false; return; }
    floor.visible = true;
    const words = new Text({ text: floorState.text, style: { ...font(14), wordWrap: true, wordWrapWidth: Math.max(120, screenW - 64) }, resolution: res() });
    const padX = 16, padY = 12, gap = 10;
    let w = words.width + padX * 2, h = words.height + padY * 2, button = null;
    if (floorState.retry) {
      const label = new Text({ text: 'Retry', style: { ...font(16), fill: tone.gold }, resolution: res() });
      const bw = Math.max(44, label.width + 16), bh = Math.max(44, label.height + 8);
      button = new Container();
      label.position.set(Math.round((bw - label.width) / 2), Math.round((bh - label.height) / 2));
      const line = new Graphics().rect(label.x, label.y + label.height + 1, label.width, 1).fill({ color: tone.gold });
      button.addChild(label, line);
      button.hitArea = new Rectangle(0, 0, bw, bh);
      button.eventMode = 'static'; button.cursor = 'pointer';
      button.label = 'floor-retry';
      const act = floorState.retry;
      button.on('pointertap', e => { e.stopPropagation(); act(); });
      w += gap + bw; h = Math.max(h, bh + 8);
      button.size = [bw, bh];
    }
    w = Math.min(w, screenW - 16);
    floor.addChild(new Graphics().rect(0, 0, w, h).fill({ color: color.panel, alpha: 0.96 }));
    words.position.set(padX, Math.round((h - words.height) / 2));
    floor.addChild(words);
    if (button) { button.position.set(w - padX / 2 - button.size[0], Math.round((h - button.size[1]) / 2)); floor.addChild(button); }
    floor.position.set(Math.round((screenW - w) / 2), Math.round(screenH - 20 - h));
  }

  // ---- the offline badge
  const badge = new Container();
  badge.visible = false;
  root.addChild(badge);
  let badgeState = null, badgeTimer = null;
  function drawBadge() {
    badge.removeChildren().forEach(c => c.destroy({ children: true }));
    if (!badgeState) { badge.visible = false; return; }
    badge.visible = true;
    const words = new Text({ text: badgeState.text, style: { ...font(12), fill: badgeState.done ? MOSS : color.ash, wordWrap: true, wordWrapWidth: Math.max(120, screenW * 0.6 - 20) }, resolution: res() });
    const w = words.width + 20, h = words.height + 12;
    badge.addChild(new Graphics().rect(0, 0, w, h).fill({ color: color.panel, alpha: 0.92 }), words);
    words.position.set(10, 6);
    badge.position.set(Math.round(screenW - 10 - w), Math.round(screenH - 10 - h));
  }

  return {
    root,
    resize(w, h, isTouch) { screenW = w; screenH = h; touch = !!isTouch; drawFloor(); drawBadge(); },
    /** Shows the floor notice: words, and a Retry action when something failed; null hides it. */
    floor(text, retry = null) { floorState = text ? { text, retry } : null; drawFloor(); },
    /** The offline badge (1.7 say): `done` turns it green and takes it away after 6 s (ui.json timing offlineBadgeMs). */
    badge(text, done = false) {
      badgeTimer?.();
      badgeState = text ? { text, done } : null; drawBadge();
      badgeTimer = done ? after(ui.timing.offlineBadgeMs, () => { badgeState = null; drawBadge(); }, root) : null;
    },
    get floorText() { return floorState?.text ?? null; },
  };
}
