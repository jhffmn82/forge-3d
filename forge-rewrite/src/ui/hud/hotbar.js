// The hotbar of 8, as 1.7's: icons with their key number, a tap, a click or the number key uses a slot, a
// right-click or a long press opens the slot's menu (Use, Cast on tap, Clear), and dragging assigns, swaps and clears
// (drag.js). Details show as a hover card with a mouse and in the info line above the bar on touch.
// What a slot does is sent as a command; the engine refuses it as not built yet until packet D lands.

import { Container, Graphics, Sprite } from '../../../../forge-godot/runtime/pixi.js';
import { color, space } from '../core/widgets.js';
import { icon, iconTexture } from '../core/icons.js';
import uiTimes from '../../../data/ui.json' with { type: 'json' };
import { createInfoLine } from '../core/cards.js';
import { slotMenu } from './slot-menu.js';
import { barOf, withSlot, swapSlots, slotCommand, SLOTS } from '../model/hud-model.js';
import { entryView, slotTint, sigilPulse, slotSentence } from './hotbar-model.js';
import { EXPOSURE, grey, lifted, sweepPoints, readyRing, cooldownFracs } from './slot-face.js';

import { beginDrag, registerDropTarget, dragging } from '../core/drag.js';
import { tone, words } from '../core/look.js';
import { pulseAt } from '../core/pulse.js';
import { animate, after } from '../core/anim.js';

const { hotbarHoldMs: HOLD_MS, buzzMs: BUZZ } = uiTimes.input, { hotbarInfoMs: INFO_MS, readyFlashMs: FLASH_MS } = uiTimes.timing;   // ui.json


// H23 (1.7 hud.js #hotbar .slot:hover): a slot under the mouse takes 1.7's ember edge (--ember #E2622B).
const EMBER = 0xe2622b;
/**
 * @param {ReturnType<import('../core/widgets.js').createKit>} kit
 * @param {{w:number, h:number, cols:number, gap:number, iconK:number, keyPx:number}} geo
 * @param {{command:(c:any)=>void, press?:(i:number, entry:any)=>boolean, setBar:(bar:any[])=>void, cue:(n:string)=>void, lift:(on:boolean)=>void, menuLayer:Container, infoW:number, infoAt?:{x:number, y:number}|null, phone?:boolean}} o
 *   infoAt: where the touch info line lies (beside a vertical bar); above the bar when not given
 */
export function buildHotbar(kit, geo, o) {
  const root = new Container();
  root.label = 'hud-hotbar';
  const touch = kit.stage.touch, { w: sw, h: sh, cols, gap } = geo;
  let state = null, bar = [], views = [], tints = [], menu = null, lastUsed = -1, cdFrac = [];
  const reducedMotion = kit.reduced;   // Options Motion (U5, ui-09)
  // CH-17: the slot held down, aimed, under a drag, or just used by key: each sinks.
  let pressed = -1, armedAt = -1, overAt = -1, flashAt = -1, liftedAt = -1;
  const slots = [];
  // 1.7 responsive-hud.css:1188 and options.js:99, 131: every slot's face is the control background, the log colour at
  // 25% so the map shows through, clear on a touch phone; the icons keep their full strength.
  const faceAlpha = o.phone ? 0 : 0.25;

  // The info line on touch: one fixed strip just above the bar, where a long press (or a tap on an empty slot)
  // writes the slot's details. It lies over the log on a dark backing while it shows, so the bar keeps 1.7's place.
  const info = touch ? createInfoLine(kit, o.infoW) : null;
  const infoBack = new Graphics();
  if (info) {
    info.root.label = 'hud-info';
    info.root.position.set(o.infoAt?.x ?? 0, o.infoAt?.y ?? -info.height - 6);
    infoBack.rect(info.root.x - 4, info.root.y - 4, o.infoW + 8, info.height + 8).fill({ color: tone.glass, alpha: 0.88 });
    infoBack.visible = false; info.root.visible = false;
    root.addChild(infoBack, info.root);
  }
  const showInfo = i => { if (!info) return; info.show(slots[i].node, detailOf(i)); infoBack.visible = info.root.visible = true; };
  const hideInfo = () => { if (!info) return; info.hide(); infoBack.visible = info.root.visible = false; };
  const top = 0;

  for (let i = 0; i < SLOTS; i++) {
    const s = new Container();
    s.label = `hud-slot-${i + 1}`;
    s.position.set((i % cols) * (sw + gap), top + Math.floor(i / cols) * (sh + gap));
    const bg = new Graphics(), body = new Container(), lit = new Graphics(), ready = new Graphics();
    ready.eventMode = 'none'; ready.visible = false;
    s.addChild(bg, body, lit, ready);
    s.eventMode = 'static'; s.cursor = 'pointer';
    s.hitArea = { contains: (x, y) => x >= 0 && y >= 0 && x <= sw && y <= sh };
    let held = null, menuOpened = false;
    // CH-17: the slot sinks while it is pressed (1.7 .slot:active).
    s.on('pointerdown', () => { if (views[i]) { pressed = i; paintSlot(i); } });
    const unpress = () => { if (pressed === i) { pressed = -1; paintSlot(i); } };
    s.on('pointerup', unpress); s.on('pointerupoutside', unpress); s.on('pointerleave', unpress);
    s.on('pointerdown', e => {
      menuOpened = false;
      // A held finger lifts a filled slot; let go without moving and its menu opens (drag.js `still`).
      if (bar[i]) beginDrag(e, bar[i], views[i]?.icon ?? null, i, { still: () => { menuOpened = true; openMenu(i); } });
      else if (e.pointerType !== 'mouse') held = setTimeout(() => { held = null; menuOpened = true; openMenu(i); }, HOLD_MS);
    });
    const letGo = () => { clearTimeout(held); held = null; };
    s.on('pointerup', letGo); s.on('pointerupoutside', letGo); s.on('pointerleave', letGo);
    s.on('pointertap', e => {
      e.stopPropagation();
      if (dragging() || menuOpened || e.button === 2) return;
      use(i);
      kit.tap?.();   // A7: a slot gives the interface's click, as 1.7's #hotbar did
    });
    // T7 (1.7 ui-adapter.js binding.context): a right-click on a click-spell slot sets or clears it; any other opens the menu.
    s.on('rightclick', e => { e.stopPropagation(); if (views[i]?.clickable) toggleClick(i); else openMenu(i); });
    s.on('pointerover', e => { if (e.pointerType === 'mouse') { paintSlot(i, true); if (views[i]) kit.hooks.show?.(s, detailOf(i)); } });
    s.on('pointerout', () => { paintSlot(i, false); kit.hooks.hide?.(s); });
    slots.push({ node: s, bg, body, lit, ready, flash: null });
    root.addChild(s);
  }

  slots.forEach((_, i) => paintSlot(i));

  function detailOf(i) {
    const v = views[i];
    if (!v) return { title: 'Empty', lines: ['Drag an ability, a prayer or an item here from Character, Inventory or Faith.'] };
    if (v.bow) return { title: v.name, sub: touch ? null : `Key ${i + 1}`, rows: v.rows, lines: [v.ready ? 'Press to aim; press again to fire.' : 'Equip a bow to shoot.'] };
    // H26 (1.7 hud.js buildHotbarCard): a bag item shows its whole card, then how many are in the bag and the key.
    if (v.card) return { ...v.card, sub: touch ? v.card.sub ?? null : v.card.sub ? `${v.card.sub} · Key ${i + 1}` : `Key ${i + 1}`, rows: [...(v.card.rows ?? []), ...v.rows] };
    if (v.amulet) return { title: v.name, sub: touch ? null : `Key ${i + 1}`, rows: v.rows, lines: [v.ready ? (v.aims ? 'Press to aim; press again to use.' : 'Press to use.') : 'Kills recharge it.'] };
    const said = slotSentence(state, bar[i]);
    // T7 (1.7 ui-adapter.js hotbarCard): how to make it the click spell, or that it is.
    const how = touch ? 'Hold' : 'Right-click', click = !v.clickable ? [] : v.click ? [`Your click ability. ${how} to turn it off.`] : [`${how} to cast this whenever you ${touch ? 'tap' : 'click'} an enemy.`];
    return { title: v.name, sub: touch ? null : `Key ${i + 1}`, rows: v.rows, lines: [...(said ? [said] : []), ...(v.ready ? [] : [v.left ? `Ready in ${v.left} turns.` : 'Not enough mana or favor yet.']), ...click] };
  }

  function paintSlot(i, hover = false) {
    const { bg, body } = slots[i], v = views[i];
    // 1.7: see-through glass with a 6 px corner; a filled slot has a steel line and a soft inner glow in its icon's
    // colour (CH-16); an empty one is a faint outline at a quarter strength.
    bg.clear();
    if (v) {
      const glow = tints[i] ?? tone.slotGlow;
      // CH-17 (1.7 responsive-hud.css:190-195, .slot:active / .armed / .over): pressed, armed or a drop over it, the
      // slot sinks: a warm dark face (#21180f), a shadow under its top edge, a gold ring (#d9a34c), the glow kept.
      const sunk = i === pressed || i === armedAt || i === overAt || i === flashAt;
      bg.roundRect(0, 0, sw, sh, 6).fill(sunk ? { color: 0x21180f, alpha: Math.max(0.85, faceAlpha) } : { color: tone.glass, alpha: hover ? Math.max(0.45, faceAlpha) : faceAlpha });
      if (sunk) for (let k = 0; k < 3; k++) bg.roundRect(1, 1 + k, sw - 2, sh - 2 - k, 6).stroke({ color: 0x000000, width: 1, alpha: [0.8, 0.5, 0.22][k] });
      for (let k = 0; k < 4; k++) bg.roundRect(1 + k * 2, 1 + k * 2, sw - 2 - k * 4, sh - 2 - k * 4, 6).stroke({ color: glow, width: 2, alpha: 0.34 - k * 0.08 });
      bg.roundRect(0.5, 0.5, sw - 1, sh - 1, 6).stroke(sunk ? { color: 0xd9a34c, width: 1 } : { color: hover ? EMBER : tone.slotEdge, width: 1 });
    } else {
      bg.roundRect(0.5, 0.5, sw - 1, sh - 1, 6).fill({ color: tone.glass, alpha: faceAlpha }).stroke({ color: tone.edge, width: 1, alpha: hover ? 0.9 : 0.55 });
    }
    // T9 (1.7 touchui.js .slot.over): the slot under a drag lights gold, its edge and a 2 px ring inside it at .5.
    if (i === overAt) bg.roundRect(0.5, 0.5, sw - 1, sh - 1, 6).stroke({ color: 0xe8b44a, width: 1 }).roundRect(2, 2, sw - 4, sh - 4, 5).stroke({ color: 0xe8b44a, width: 2, alpha: 0.5 });
    // T9 (.slot.lifted): the slot being dragged shrinks to .92 about its centre and fades to .45.
    const node = slots[i].node, k = i === liftedAt ? 0.92 : 1;
    node.scale.set(k);
    node.position.set((i % cols) * (sw + gap) + (sw * (1 - k)) / 2, top + Math.floor(i / cols) * (sh + gap) + (sh * (1 - k)) / 2);
    node.alpha = i === liftedAt ? 0.45 : v || hover || i === overAt ? 1 : 0.25;
  }

  const drawn = [];   // what each slot last drew (set() skips a slot whose key is the same)
  function drawSlot(i) {
    const { body } = slots[i], v = views[i];
    body.removeChildren().forEach(c => c.destroy({ children: true }));
    paintSlot(i);
    if (v) {
      const isz = Math.round(Math.min(sw, sh) * geo.iconK), pic = icon(v.icon, isz);
      if (pic) {
        pic.position.x += Math.round((sw - isz) / 2); pic.position.y += Math.round((sh - isz) / 2);
        const exp = EXPOSURE[v.icon] ?? 1;
        if (pic.texture && !v.left) {   // H24: drop-shadow(0 1px 1px #0005) under the icon
          const sh0 = new Sprite(pic.texture);
          // the icon's own anchor (0): a sheet texture's default anchor threw this copy half an icon up and left, onto the
          // floor, where it read as the icon casting a shadow (sandbox, Justin 2026-10-17: "icons cast shadows")
          sh0.anchor.copyFrom(pic.anchor); sh0.scale.copyFrom(pic.scale); sh0.position.set(pic.x, pic.y + 1); sh0.tint = 0x000000; sh0.alpha = 0.33 * (v.ready ? 1 : 0.4);
          sh0.label = 'hud-icon-shadow'; body.addChild(sh0);
        }
        if (v.left) pic.filters = [grey(exp)]; else { pic.alpha = v.ready ? 1 : 0.4; if (exp !== 1) pic.filters = [lifted(exp)]; }   // RB37: grey on cooldown, faint short of mana
        body.addChild(pic);
      }
      else body.addChild(Object.assign(kit.text(v.name, { size: 12, fill: color.ash, wrap: sw - 8, align: 'center' }), { x: 4, y: 4 }));
      if (v.left && cdFrac[i] > 0) {
        const sweep = new Graphics().poly(sweepPoints(sw, sh, Math.min(1, cdFrac[i]))).fill({ color: 0x000000, alpha: 0.62 });
        sweep.label = 'hud-cd-sweep'; body.addChild(sweep);
      }
      if (v.left) {
        const cd = kit.text(String(v.left), { size: 20, font: 'mono', fill: color.ink, weight: '600' });
        cd.anchor.set(0.5); cd.position.set(sw / 2, sh / 2); body.addChild(cd);
      }
      if (v.line) {
        const ln = kit.text(v.line, { size: 12, font: 'mono', fill: color.ink, weight: '600' });
        ln.anchor.set(1, 1); ln.position.set(sw - space.inRow, sh - 1); body.addChild(ln);
      }
      // T7 (1.7 travel.js .clickmark): the click spell's slot wears a small pale blue bullseye low on its left, glowing.
      if (v.click) {
        const m = new Graphics(), r = Math.max(3.5, Math.min(sw, sh) * 0.07), cx = 3 + r + 1, cy = sh - 2 - r - 1;
        m.circle(cx, cy, r + 2.5).fill({ color: 0x3a8fd0, alpha: 0.28 });
        m.circle(cx, cy, r).stroke({ color: 0x9fd8ff, width: 1.25 }).circle(cx, cy, r * 0.4).fill({ color: 0x9fd8ff });
        m.label = 'hud-click-mark'; body.addChild(m);
      }
    }
    // Number keys mean nothing without a keyboard (1.7 hides them on touch).
    if (!touch) { const k = words(kit, String(i + 1), geo.keyPx, { fill: tone.key }); k.position.set(4, 2); body.addChild(k); }
  }

  function use(i) {
    closeMenu();
    const entry = bar[i];
    o.cue('ui-click');
    if (!entry) { showInfo(i); after(INFO_MS, hideInfo, root); return; }
    // The slot sinks for a moment (CH-17, 1.7's :active face), so a use by key shows it was heard even when refused.
    lastUsed = i; flashAt = i; paintSlot(i);
    after(FLASH_MS, () => { if (flashAt === i) flashAt = -1; paintSlot(i); }, root);
    // A targeted ability aims first (aim.js); the HUD says when the press was taken that way.
    if (o.press?.(i, entry)) return;
    // Feature 136 (Justin 2026-10-17: "some sort of glow or pulse animation colored the same as the sigils ... to make the
    // casting of a sigil visually distinct"): the slot pulses in its sigil's glow, measured before the cast and drawn on
    // the HUD's layer so the slot's redraw cannot cut it short. No card here; the cast card is the Inventory's.
    const glow = sigilPulse(state, entry, views[i]);
    if (glow !== null && root.parent) {
      const b = slots[i].node.getBounds(), tl = root.parent.toLocal({ x: b.x, y: b.y }), br = root.parent.toLocal({ x: b.x + b.width, y: b.y + b.height });
      pulseAt(root.parent, { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }, glow);
    }
    o.command(slotCommand(entry));
  }

  // RB37: the ready flash, 1.7's cdready keyframes: from the gold ring and warm glow to nothing over 0.7 s, ease out.
  function stopFlash(i) {
    const sl = slots[i];
    if (sl.flash) { sl.flash(); sl.flash = null; }
    if (!sl.ready.destroyed) sl.ready.visible = false;
  }
  function flashReady(i) {
    stopFlash(i);
    if (reducedMotion) return;
    const sl = slots[i], g = readyRing(sl.ready, sw, sh);
    sl.flash = animate(700, t => { g.alpha = 1 - (1 - (1 - t) ** 2); }, { node: g, done: () => stopFlash(i) });   // ease-out
  }
  /** RB37: each cooled slot's share still to run, from the longest time left seen for its cooldown; a slot whose cooldown ends flashes. */
  function trackCooldowns() {
    const r = cooldownFracs(state?.hero, bar, views);
    cdFrac = r.fracs;
    for (const i of r.quiet) stopFlash(i);
    for (const i of r.ended) flashReady(i);
  }

  // The slot being aimed stays sunk with its gold ring, as 1.7's armed slot (CH-17).
  function drawArmed() { for (let k = 0; k < SLOTS; k++) paintSlot(k); }

  // T7 (1.7 toggleClickSpell): make this slot's spell the one a tap on a foe casts, or stop.
  function toggleClick(i) {
    closeMenu();
    const v = views[i];
    if (!v?.clickable) return;
    o.cue('ui-click');
    o.command({ type: 'click-spell', id: v.click ? null : bar[i].id });
  }

  function closeMenu() { if (menu) hideInfo(); menu?.destroy({ children: true }); menu = null; }

  // T8: the hold menu (slot-menu.js), with the slot's card and its buttons.
  function openMenu(i) {
    closeMenu();
    o.cue('ui-click');
    if (touch) try { navigator.vibrate?.(BUZZ); } catch { /* not allowed */ }   // T6: the short buzz as the hold takes (1.7 openHM)
    const v = views[i];
    // T7 (1.7 touchui.js openHM): a click spell's menu sets or clears it.
    menu = slotMenu(kit, { detail: detailOf(i), bar: root, layer: o.menuLayer, close: closeMenu, buttons: [v && ['Use', () => use(i)],
      v?.clickable && [v.click ? 'Stop casting on tap' : 'Cast on tap', () => toggleClick(i), !!v.click], v && ['Clear', () => { closeMenu(); o.setBar(withSlot(bar, i, null)); }], ['Close', closeMenu]].filter(Boolean) });
    kit.hooks.hide?.(slots[i].node);
  }

  const unregister = registerDropTarget({
    root,
    slotAt(p) {
      for (let i = 0; i < SLOTS; i++) { const l = slots[i].node.toLocal(p); if (l.x >= 0 && l.y >= 0 && l.x <= sw && l.y <= sh) return i; }
      return -1;
    },
    // CH-17 (1.7 .slot.over): the slot a drag is over sinks; an empty one shows at full strength.
    hover(i) { if (overAt === i) return; const was = overAt; overAt = i; for (const k of [was, i]) if (k >= 0) paintSlot(k); },
    lift: (on, k) => o.lift(on, k),
    // T9: the slot a drag came from, while it is held (-1 when let go); the ghost takes the slots' size.
    lifted(i) { const was = liftedAt; liftedAt = i; for (const k of [was, i]) if (k >= 0) paintSlot(k); },
    slotSize: { w: sw, h: sh },
    drop(i, entry, from) {
      if (i < 0) { if (from !== null) o.setBar(withSlot(bar, from, null)); return; }
      if (from !== null) { if (from !== i) o.setBar(swapSlots(bar, from, i)); return; }
      o.setBar(withSlot(bar, i, entry));
      o.cue('ui-click');
    },
  });
  root.on('destroyed', () => { unregister(); closeMenu(); for (const sl of slots) sl.flash?.(); });

  return {
    root,
    set(s) {
      state = s;
      bar = barOf(s);
      views = bar.map(e => entryView(state, e));
      tints = bar.map((e, k) => slotTint(state, e, views[k]));
      trackCooldowns();
      // Movement rebuild (feel spec 2.5, cause 4): a slot is rebuilt only when what it shows changed, not on every step
      // (its icon's art arriving counts as a change).
      for (let i = 0; i < SLOTS; i++) { const v = views[i], key = [bar[i]?.kind, bar[i]?.id, v?.icon, v?.name, v?.ready, v?.left, v?.line, v?.click, v?.left ? cdFrac[i] : 0, tints[i], sw, sh, touch, !!(v?.icon && iconTexture(v.icon))].join('|'); if (drawn[i] !== key) { drawn[i] = key; drawSlot(i); } }
    },
    /** Shows the bar the player just made before the engine answers (the next set() draws the engine's). */
    show(next) { bar = next; views = bar.map(e => entryView(state, e)); tints = bar.map((e, k) => slotTint(state, e, views[k])); drawn.length = 0; for (let i = 0; i < SLOTS; i++) drawSlot(i); },
    use,
    /** Marks the slot being aimed (-1 for none). */
    armed(i) { armedAt = i; drawArmed(); },
    /** Phone aiming (1.7 study-phone-targeting): every slot but `keep` lets taps through to the map; null restores them. */
    passThrough(keep) { slots.forEach((s, k) => { s.node.eventMode = keep === null || k === keep ? 'static' : 'none'; }); if (keep !== null) closeMenu(); },
    /** The slots' height (the info line lies above it and takes no room). */
    get h() { const rows = Math.ceil(SLOTS / cols); return rows * sh + (rows - 1) * gap; },
    get lastUsed() { return lastUsed; },
  };
}
