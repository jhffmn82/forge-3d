// The touch controls, drawn as 1.7's: the movement pad (1.7's Options "Movement pad": on by default on tablets,
// off on phones, Justin 10-16 "no off"; left or right), a ring of four large keys and four small corner keys round
// the search lens (a search, step() 'search'); Search alone as 1.7's lens button when the pad is off; Pick up when something lies underfoot
// (1.7's hand: beside the pad, or above Search) and Cancel aim while aiming (1.7's cross, at the lower-left inset).

import { Container, Graphics, GraphicsPath } from '../../../../forge-godot/runtime/pixi.js';
import { glassButton, symbol, PAD } from '../core/look.js';

// Each key: its step and how far it is turned from north, clockwise. The corners are the small keys.
const KEYS = [[0, -1, 0], [1, -1, 45], [1, 0, 90], [1, 1, 135], [0, 1, 180], [-1, 1, 225], [-1, 0, 270], [-1, -1, 315]];

/** One pad key: 1.7's key shape turned to its place, its chevron, and a hit test by angle and distance. */
function padKey(S, [dx, dy, turn], o) {
  const corner = turn % 90 !== 0;
  const c = new Container();
  c.label = `hud-pad-${dx},${dy}`;
  const shape = new Container(), g = new Graphics(), outline = new GraphicsPath(corner ? PAD.northWest : PAD.north);
  const paint = on => {
    const st = on ? PAD.pressed : corner ? PAD.corner : PAD.key;
    g.clear().path(outline).fill({ color: st.fill[0], alpha: st.fill[1] }).stroke({ color: st.edge[0], alpha: st.edge[1], width: st.edge[2] });
  };
  paint(false);
  // The stored corner shape sits at 315 degrees; turn each shape round the pad's centre to its own place.
  shape.addChild(g);
  shape.pivot.set(50, 50); shape.position.set(S / 2, S / 2); shape.scale.set(S / 100);
  shape.rotation = ((corner ? turn - 315 : turn) * Math.PI) / 180;
  const ink = corner ? PAD.cornerInk : PAD.ink, inkSize = ((corner ? PAD.inkCorner : PAD.inkCardinal) * S) / 168;
  const arrow = symbol('arrow', inkSize, ink[0], ink[1]);
  const holder = new Container();
  holder.addChild(arrow);
  arrow.position.set(-inkSize / 2, -inkSize / 2);
  holder.rotation = (turn * Math.PI) / 180;
  // 1.7 centres each chevron on its key: 35 units out for the large keys, 33 for the corners.
  const out = ((corner ? 33 : 35) * S) / 100, a = ((turn - 90) * Math.PI) / 180;
  holder.position.set(S / 2 + Math.cos(a) * out, S / 2 + Math.sin(a) * out);
  c.addChild(shape, holder);
  c.eventMode = 'static'; c.cursor = 'pointer';
  // A key owns its eighth of the ring: within 22.5 degrees of its own angle, between the centre lens and the rim.
  c.hitArea = {
    contains: (x, y) => {
      const ux = ((x - S / 2) * 100) / S, uy = ((y - S / 2) * 100) / S, r = Math.hypot(ux, uy);
      if (r < (PAD.centreD * 50) / 168 || r > 50) return false;
      const deg = ((Math.atan2(uy, ux) * 180) / Math.PI + 90 + 360) % 360, d = Math.abs(((deg - turn + 540) % 360) - 180);
      return d <= 22.5;
    },
  };
  let held = false;
  // Let go anywhere ends the hold, even when a HUD rebuild replaced this button mid-press.
  const release = () => { if (held) o.holdMove?.(null); held = false; };
  const stop = () => { release(); if (!c.destroyed) paint(false); };
  // A press steps at once; holding keeps walking (1.7: "hold it to keep walking"). The game walks the held move again
  // the moment each step's events finish (main.js holdMove, sandbox item 43), so there is no timer to beat against.
  // RB22 (1.7 pacing.js:87-89): a press while aiming cancels the aim once and does not walk, even held.
  c.on('pointerdown', e => { e.stopPropagation(); stop(); if (o.aiming?.()) { o.cancelAim(); return; } paint(true); o.command({ type: 'move', dx, dy }); held = true; o.holdMove?.({ type: 'move', dx, dy }); addEventListener('pointerup', release, { once: true }); addEventListener('pointercancel', release, { once: true }); });
  c.on('pointerup', stop); c.on('pointerupoutside', stop); c.on('pointerleave', stop);
  c.on('pointertap', e => e.stopPropagation());
  return c;
}

/**
 * @param {ReturnType<import('../core/widgets.js').createKit>} kit
 * @param {{pad:boolean, size:number, padSize:number, command:(c:any)=>void, holdMove?:(c:any)=>void, cue:(n:string)=>void, cancelAim:()=>void}} o
 */
export function buildTouch(kit, o) {
  const root = new Container();
  root.label = 'hud-touch';
  let aimingNow = false;
  o = { ...o, aiming: () => aimingNow };
  const sz = o.size;
  let pad = null;

  if (o.pad) {
    const S = o.padSize;
    pad = new Container();
    pad.label = 'hud-pad';
    for (const key of KEYS) pad.addChild(padKey(S, key, o));
    // The centre: 1.7's round lens key, a search (one action, hidden traps within 2 tiles).
    const d = (PAD.centreD * S) / 168, centre = new Container(), face = new Graphics();
    const paint = on => {
      const st = on ? PAD.pressed : PAD.centre;
      face.clear().circle(d / 2, d / 2, d / 2 - 0.5).fill({ color: st.fill[0], alpha: st.fill[1] }).stroke({ color: st.edge[0], alpha: st.edge[1], width: 1 });
    };
    paint(false);
    const lensD = (PAD.lensD * S) / 168, lens = symbol('lens', lensD, PAD.ink[0], PAD.ink[1]);
    lens.position.set((d - lensD) / 2, (d - lensD) / 2);
    centre.addChild(face, lens);
    centre.position.set((S - d) / 2, (S - d) / 2);
    centre.label = 'Search';
    centre.hitArea = { contains: (x, y) => Math.hypot(x - d / 2, y - d / 2) <= d / 2 };
    centre.on('pointerdown', () => paint(true));
    centre.on('pointerup', () => paint(false)); centre.on('pointerupoutside', () => paint(false));
    // P3 (1.7 touchui.js:209 searchAround(false, true)): the pad's wait-and-search is quiet, one faint ring a turn.
    kit.control(centre, () => (aimingNow ? o.cancelAim() : o.command({ type: 'search', quiet: true })));
    pad.addChild(centre);
    root.addChild(pad);
  }
  const search = pad ? null : glassButton(kit, 'search', sz, () => o.command({ type: 'search' }));
  if (search) { search.label = 'Search'; root.addChild(search); }
  // The block that moves the hero: the pad, or Search alone.
  const block = pad ?? search, liveMode = block.eventMode;

  // Where place() puts Cancel aim (the HUD's lower-left inset) and which side of the pad Pick up takes.
  let cancelAt = null, padLeft = true;
  const pickup = glassButton(kit, 'pickup', sz, () => o.command({ type: 'pickup' }));
  pickup.label = 'Pick up';
  const cancel = glassButton(kit, 'cancel', sz, () => { o.cue('ui-click'); o.cancelAim(); });
  cancel.label = 'Cancel aim';
  root.addChild(pickup, cancel);

  return {
    root,
    /** The pad or Search block's size, so the HUD can place the log beside it. */
    get w() { return pad ? o.padSize : sz; },
    get h() { return pad ? o.padSize : sz; },
    get isPad() { return !!pad; },
    /** The size of Pick up and Cancel aim. */
    get size() { return sz; },
    /**
     * cancel: Cancel aim's place in the HUD (1.7 study-phone-targeting #studyCancelAim, fixed at the lower-left inset);
     * padLeft: the pad is on the left, so Pick up stands on its right (1.7 syncPickup). Call once root is placed.
     */
    place(at) {
      cancelAt = at.cancel ?? null; padLeft = at.padLeft !== false;
      if (cancelAt) cancel.position.set(cancelAt.x - root.x, cancelAt.y - root.y);
    },
    /**
     * Shows Pick up and Cancel aim. While aiming, under a window or dead the pad (or Search) takes no
     * taps and hides; a phone keeps it in view while aiming but locked, so a tap on it lands on the map tile beneath
     * and aims there (H33, 1.7 responsive-hud.js:300-304, responsive-hud.css:657, 1211-1216).
     */
    set({ items, aiming, covered = false, dead = false, phone = false }) {
      const off = !!aiming || covered || dead, shown = !off || (phone && !!aiming && !covered && !dead);
      aimingNow = !!aiming;
      if (off && block.eventMode !== 'none') o.holdMove?.(null);   // a held pad key lets go
      block.eventMode = off ? 'none' : liveMode;
      block.visible = shown;
      // CH-21 (1.7 responsive-hud.js:313-327): Pick up while something lies underfoot and no aim or window is up; beside
      // the pad (8 px off its inner side, bottom aligned) or 8 px above a lone Search.
      pickup.visible = items > 0 && !aiming && !covered && !dead;
      if (pad) pickup.position.set(padLeft ? o.padSize + 8 : -sz - 8, o.padSize - sz);
      else pickup.position.set(0, -sz - 8);
      // CH-20: Cancel aim at the lower-left inset (above the block when the HUD has not placed it).
      cancel.visible = !!aiming && !covered && !dead;
      if (!cancelAt) cancel.position.set(0, -sz - 8);
    },
  };
}
