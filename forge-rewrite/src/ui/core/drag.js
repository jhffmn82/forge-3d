// Dragging onto the hotbar: from the Character, Inventory and Faith windows, and from one slot to another or off
// the bar. A window calls beginDrag on pointerdown; nothing happens on a plain tap or click. A mouse drag starts
// after a 6 px move; a finger must hold 350 ms first (a quick swipe stays the window's scroll).
// While a drag runs the window fades so the hotbar shows through, and the icon follows the pointer.

import { Container, Graphics } from '../../../../forge-godot/runtime/pixi.js';
import { icon } from './icons.js';
import { tone } from './look.js';
import ui from '../../../data/ui.json' with { type: 'json' };

const { dragMouseStartPx: MOUSE_START, dragHoldMs: HOLD_MS, dragSlopPx: FINGER_SLOP, buzzMs: BUZZ } = ui.input, GHOST = 56;

/** The hotbar, while one is on screen: { root, slotAt(global), drop(i, entry, from), hover(i), lift(on) }. */
let target = null;
let live = null, recent = false;

/** The hotbar registers itself here; the returned function unregisters it. */
export function registerDropTarget(t) {
  target = t;
  return () => { if (target === t) { live?.end(false); target = null; } };
}

/** True while something is being dragged (the hotbar ignores its own taps then). */
export const dragging = () => !!live?.on || recent;

/**
 * Starts watching a press that may become a drag.
 * @param {any} e Pixi's pointerdown event
 * @param {{kind:'ability'|'prayer'|'item', id:string}} entry
 * @param {string|null} iconName the icon frame to carry
 * @param {number|null} from the hotbar slot it comes from, if any
 * @param {{still?:()=>void, bar?:boolean, release?:(p:any, onBar:boolean)=>void, over?:(p:any|null)=>void, fade?:number}} o
 *   `still`: a finger held and let go without moving (the hotbar opens its slot menu). T11 (1.7 touchui.js:437-531):
 *   `release` takes a drop that is not the hotbar's (a worn slot, the paper doll, the bag, outside the window);
 *   `bar: false` keeps the entry off the hotbar (worn armour, a sword); `over` follows the pointer for the window's own
 *   highlights; `fade` is how far the window fades while the drag runs (the hotbar's drags fade it most).
 */
export function beginDrag(e, entry, iconName, from = null, o = {}) {
  if (!target || live || !entry) return;
  if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
  let top = target.root;
  while (top.parent) top = top.parent;
  const finger = e.pointerType !== 'mouse', start = { x: e.global.x, y: e.global.y };
  const t = target;
  const d = { on: false };
  live = d;
  let ghost = null;
  const hold = finger ? setTimeout(() => lift(), HOLD_MS) : null;
  let moved = false;

  function lift() {
    if (d.on || live !== d) return;
    d.on = true;
    t.lift(true, o.fade);
    if (from !== null) t.lifted?.(from);   // T9: the slot it came from shrinks and fades
    // T6 (1.7 touchui.js:387): a short buzz as a finger's hold lifts it.
    if (finger) try { navigator.vibrate?.(BUZZ); } catch { /* not allowed */ }
    // T9 (1.7 #hotGhost): a copy of the slot, 1.12 times its size at .95, its icon at 86%, a soft shadow 8 px below.
    const gw = t.slotSize?.w ?? GHOST, gh = t.slotSize?.h ?? GHOST;
    ghost = new Container();
    ghost.eventMode = 'none';
    const shade = new Graphics();
    for (let k = 1; k <= 8; k++) shade.roundRect(-k * 1.5, 8 - k * 1.5, gw + k * 3, gh + k * 3, 6 + k * 1.5).fill({ color: 0, alpha: 0.075 });
    ghost.addChild(shade, new Graphics().roundRect(0, 0, gw, gh, 6).fill({ color: tone.glass, alpha: 0.6 }).stroke({ color: tone.slotEdge, width: 1 }));
    const isz = Math.round(Math.min(gw, gh) * 0.86), s = icon(iconName, isz);
    if (s) { s.position.x += Math.round((gw - isz) / 2); s.position.y += Math.round((gh - isz) / 2); ghost.addChild(s); }
    ghost.pivot.set(gw / 2, gh / 2);
    ghost.alpha = 0.95;
    top.addChild(ghost);
    place(start);
  }
  function place(p) {
    if (!ghost) return;
    const k = ghost.parent.worldTransform.a || 1;
    ghost.scale.set((t.root.worldTransform.a / k) * 1.12);
    const at = ghost.parent.toLocal(p);
    ghost.position.set(at.x, at.y);
    t.hover(o.bar === false ? -1 : t.slotAt(p));
    o.over?.(p);
  }
  function move(ev) {
    const p = ev.global, far = Math.hypot(p.x - start.x, p.y - start.y);
    if (!d.on) {
      if (!finger && far > MOUSE_START) lift();
      else if (finger && far > FINGER_SLOP) return end(false);
      if (!d.on) return;
    }
    if (far > FINGER_SLOP) moved = true;
    place(p);
  }
  function up(ev) {
    const still = finger && d.on && !moved;
    end(d.on && !still, ev.global);
    if (still) o.still?.();
  }
  function end(drop, p) {
    clearTimeout(hold);
    top.off('globalpointermove', move); top.off('pointerup', up); top.off('pointerupoutside', up);
    if (live === d) live = null;
    if (!d.on) return;
    ghost?.destroy({ children: true });
    t.hover(-1); t.lift(false); t.lifted?.(-1); o.over?.(null);
    if (drop && p) {
      const i = t.slotAt(p);
      if (o.release && (i < 0 || o.bar === false)) o.release(p, i >= 0);
      else t.drop(i, entry, from);
    }
    // The press that ends a drag must not also tap whatever it was released on.
    recent = true;
    setTimeout(() => { recent = false; }, 0);
  }
  d.end = end;
  top.on('globalpointermove', move); top.on('pointerup', up); top.on('pointerupoutside', up);
}
