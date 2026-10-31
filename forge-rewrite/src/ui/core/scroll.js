// The one scroll a phone window may have (plan section 1; window rule 8): contents taller than their area are
// clipped and move with a drag, the wheel or the arrow keys. 1.7's steel scrollbar shows where you are (CSS-28,
// painted-ui.css:950-955, 962-964: an 8 px #8a9099 thumb, radius 4, at least 40 tall, on a #ffffff12 track; Justin
// 10-15: "no scroll bar?") and works as a browser's does (item 268, Justin 2026-10-20: "scroll bars in the ui don't
// work"): its thumb drags, a press on its track pages toward the press. On a laptop only when larger text runs a window
// past its frame (item 164).

import { Container, Graphics } from '../../../../forge-godot/runtime/pixi.js';

/** The bar's width and the gap before it: a window that may scroll lays its contents out this much narrower. */
export const SCROLLBAR = { w: 8, gap: 4 };
const THUMB = 0x8a9099, TRACK = { color: 0xffffff, alpha: 0x12 / 255 };

/**
 * Wraps `content` (already laid out) to `area`; returns the node to place instead. If it fits, returns it as is.
 * The bar sits just right of the area, SCROLLBAR.gap away.
 * @param {Container} content @param {{w:number,h:number}} area
 */
export function scrollable(content, area) {
  const full = content.height;
  if (full <= area.h + 1) return content;
  const root = new Container(), mask = new Graphics().rect(0, 0, area.w + SCROLLBAR.gap, area.h).fill(0xffffff);
  const hit = new Graphics().rect(0, 0, area.w + SCROLLBAR.gap + SCROLLBAR.w, area.h).fill({ color: 0, alpha: 0.001 });
  root.addChild(hit, content, mask);
  content.mask = mask;
  const max = full - area.h, barH = Math.min(area.h, Math.max(40, area.h * area.h / full));
  const track = new Graphics().rect(0, 0, SCROLLBAR.w, area.h).fill(TRACK);
  const bar = new Graphics().roundRect(0, 0, SCROLLBAR.w, barH, 4).fill(THUMB);
  track.x = bar.x = area.w + SCROLLBAR.gap;
  track.label = 'scroll-track'; bar.label = 'scroll-thumb';
  root.addChild(track, bar);
  // 1.7's 'More below' fade: the last rows dim into the window while there is more under them, so a row cut at the
  // edge reads as more to scroll, not as a broken list (sandbox lead on the proof pass, 2026-10-17).
  const fade = new Graphics(), FH = Math.min(28, Math.round(area.h * 0.15));
  for (let k = 0; k < 7; k++) fade.rect(0, area.h - FH + (FH * k) / 7, area.w + SCROLLBAR.gap, FH / 7 + 1).fill({ color: 0x1c1c1e, alpha: 0.12 * (k + 1) });
  fade.eventMode = 'none'; fade.label = 'scroll-fade';
  root.addChild(fade);
  let y = 0;
  const span = Math.max(1, area.h - barH), set = v => { y = Math.max(0, Math.min(max, v)); content.y = -y; bar.y = span * (y / max); fade.visible = y < max - 1; };
  set(0);
  root.eventMode = track.eventMode = bar.eventMode = 'static';
  bar.cursor = 'grab'; track.cursor = 'pointer';
  // A drag moves the content with the pointer (k -1); the thumb's moves it the track's ratio the other way (k max/span).
  let from = null;
  root.on('pointerdown', e => { from = { at: e.global.y, y, k: -1 }; });
  bar.on('pointerdown', e => { e.stopPropagation(); from = { at: e.global.y, y, k: max / span }; });
  track.on('pointerdown', e => { e.stopPropagation(); set(y + (track.toLocal(e.global).y < bar.y ? -1 : 1) * area.h * 0.9); });
  root.on('globalpointermove', e => { if (from) set(from.y + from.k * (e.global.y - from.at) / root.worldTransform.d); });
  const stop = () => { from = null; };
  root.on('pointerup', stop); root.on('pointerupoutside', stop);
  root.on('wheel', e => set(y + e.deltaY));
  root.scrollBy = d => set(y + d);
  root.label = 'scroll';
  return root;
}
