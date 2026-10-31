// Options window: each group in its own dark panel (Justin 10-16: "needs visual breaks"), labels in ink, the picked
// choice lit in the highlight and bold, the others grey. Every setting and the keys on one page; columns follow the
// width. Keys rebind: click a key, press the new one (Esc cancels); Reset keys puts data/bindings.json back.
// The chosen keys are stored as options 'keys' = { action: [key] }; input reads them (UI-HOOKS.md).

import { Container, Graphics, Rectangle } from '../../../../forge-godot/runtime/pixi.js';
import { color, space } from '../core/widgets.js';
import { stack, split, flow } from '../core/layout.js';
import { heading, panel, PANEL_PAD } from '../core/blocks.js';
import { keyTable, bindingKey, keyLabel } from '../../input/input.js';
import { SECTIONS, ACTION_NAMES, defaultOf, isPhone } from './options-list.js';

const PAD = PANEL_PAD;
let listening = null;
// A tablet's keys sit under 1.7's collapsed 'Keyboard controls' until tapped open (sandbox lead's ruling 2026-10-18).
let keysOpen = false;

/** 1.7's disclosure line: a triangle (right when shut, down when open) and the words; a tap toggles it. */
function disclosure(kit, words, open, onTap) {
  const c = new Container(), t = kit.text(words, { size: 16, font: 'display', fill: kit.accent }), s = Math.round(t.height * 0.3);
  const tri = new Graphics().poly(open ? [0, 0, s * 2, 0, s, s * 1.4] : [0, 0, s * 1.4, s, 0, s * 2]).fill({ color: kit.accent });
  tri.y = Math.round(t.height / 2 - (open ? s * 0.7 : s)); t.x = s * 2 + space.betweenRows;
  c.addChild(new Graphics().rect(0, 0, t.x + t.width, Math.max(t.height, kit.target ?? 0)).fill({ color: 0, alpha: 0.001 }), tri, t);
  kit.control(c, onTap);
  c.label = 'keys-disclosure';
  return c;
}

/**
 * One option: its label, then its choices on one line (Justin 10-16: "all options for an item should be in one line").
 * Beside the label when they fit, else on their own line under it. The picked choice sits on a filled block.
 */
function optionRow(kit, o, value, w, set, labelW, live) {
  const c = new Container();
  const phone = isPhone(kit.stage);
  const label = kit.text(phone && o.phoneLabel ? o.phoneLabel : o.label, { size: 16, fill: color.ink, wrap: w });
  // W40: 1.7's note for the row, as its card on hover or tap.
  const notes = [o.hint, phone ? o.phoneHint : null].filter(Boolean);
  if (notes.length) { kit.details(label, { title: label.text, lines: notes }); label.label = `hint-${o.key}`; }
  // Item 164: beside its label only while a gap is left after it (labelW is capped at half the panel).
  const roomy = label.width + space.betweenRows <= labelW;
  if (o.slider) {
    const room = roomy && labelW + 120 <= w ? w - labelW : w, s = slider(kit, o, value, Math.min(280, room), live);
    if (room === w) s.y = label.height; else { s.x = labelW; label.y = Math.round((s.height - label.height) / 2); }
    c.addChild(label, s);
    return c;
  }
  const words = o.choices.map(([v, words]) => {
    const on = v === value;
    const b = kit.button(words, () => set(o.key, v), { size: 16, font: 'body', selected: on, tight: !kit.stage.touch });
    if (on) {
      b.children.at(-1).style.fontWeight = '700';
      b.addChildAt(new Graphics().roundRect(2, 3, b.width - 4, b.height - 6, 4).fill({ color: kit.accent, alpha: 0.16 }), 0);
    }
    b.label = `opt-${o.key}-${v}`;
    return b;
  });
  const box = new Container();
  let x = 0;
  for (const b of words) { b.x = x; x += b.width + 2; box.addChild(b); }
  const beside = roomy && labelW + box.width <= w + space.betweenRows;
  if (beside) { box.x = labelW - space.betweenRows; label.y = Math.round((words[0].height - label.height) / 2); }
  else { flow(words, w + space.betweenRows, 2, space.inRow); box.position.set(-space.betweenRows, label.height); }
  c.addChild(label, box);
  return c;
}

/**
 * CSS-32 (forge-skin.css:428-430, painted-ui.css:451-452): 1.7's volume slider, 0 to 100: a 2 px track in the edge
 * colour, an 11 px diamond thumb in the highlight, the full 44 px row a target on touch. Dragging sets the volume as it
 * goes (`live`, no rebuild); the click sounds when it is let go. Keyboard and gamepad confirm step it by 10, round to 0.
 */
export function slider(kit, o, value, w, live) {
  const c = new Container(), h = kit.stage.touch ? kit.target : 28, pad = 8, run = w - pad * 2;
  const hit = new Graphics().rect(0, 0, w, h).fill({ color: 0, alpha: 0.001 });
  const track = new Graphics().rect(pad, Math.round(h / 2) - 1, run, 2).fill(color.edge);
  const thumb = new Graphics().rect(-5.5, -5.5, 11, 11).fill(0xffffff);
  thumb.rotation = Math.PI / 4; thumb.tint = kit.accent; thumb.y = Math.round(h / 2);
  c.addChild(hit, track, thumb);
  let v = Math.max(0, Math.min(100, Number(value) || 0)), held = false;
  const place = () => { thumb.x = pad + run * v / 100; };
  const to = n => { n = Math.max(0, Math.min(100, Math.round(n))); if (n !== v) { v = n; place(); live(o.key, v); } };
  place();
  c.eventMode = 'static'; c.cursor = 'pointer'; c.hitArea = new Rectangle(0, 0, w, h);
  const at = e => to((c.toLocal(e.global).x - pad) / run * 100);
  c.on('pointerdown', e => { e.stopPropagation(); held = true; at(e); });
  c.on('globalpointermove', e => { if (held) at(e); });
  const end = () => { if (held) { held = false; kit.tap(); } };
  c.on('pointerup', end); c.on('pointerupoutside', end);
  c.on('pointertap', e => e.stopPropagation());
  c.setFocus = on => { thumb.scale.set(on ? 1.3 : 1); };
  kit.hooks.controls.push({ node: c, act: () => { to(v >= 100 ? 0 : Math.floor(v / 10) * 10 + 10); kit.tap(); } });
  c.label = `opt-${o.key}`;
  return c;
}

function group(kit, s, w, get, set, live) {
  const widthOf = words => { const t = kit.text(words, { size: 16 }), n = t.width; t.destroy(); return n; };
  const inner = w - PAD * 2;
  const phone = isPhone(kit.stage);
  const labelW = Math.min(Math.round(inner * 0.5), Math.max(...s.options.map(o => widthOf(phone && o.phoneLabel ? o.phoneLabel : o.label))) + space.betweenSections);
  return panel(kit, s.name, w, stack(s.options.map(o => optionRow(kit, o, get(o), inner, set, labelW, live)), 2));
}

/** Waits for the next key and stores it for `action` (capture phase, so the game never sees it). */
function listen(action, ctx) {
  listening = action;
  const done = e => {
    e.preventDefault(); e.stopImmediatePropagation();
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;   // a modifier alone waits for its key (1.7)
    window.removeEventListener('keydown', done, true);
    listening = null;
    if (e.key !== 'Escape') {
      const all = { ...(ctx.deps.options?.get('keys') ?? {}) };
      // A shifted letter keeps its capital (Shift+C closes doors while C moves down-right, 1.7 BINDS).
      // W17, K4: a digit on the main row keeps its code (Digit1), as the hotbar keys are kept; K3: a keypad key its own name.
      all[action] = [bindingKey(e)];
      ctx.deps.options?.set('keys', all);
      ctx.deps.cue?.('ui-click');
    }
    ctx.reopen();
  };
  window.addEventListener('keydown', done, true);
  ctx.reopen();
}

function keys(kit, w, ctx, collapsible = false) {
  const toggle = () => { keysOpen = !keysOpen; ctx.deps.cue?.('ui-click'); ctx.reopen(); };
  if (collapsible && !keysOpen) return disclosure(kit, 'Keyboard controls', false, toggle);
  const mine = ctx.deps.options?.get('keys') ?? {};
  const table = keyTable(Object.keys(mine).length ? mine : null);
  const inner = w - PAD * 2, gap = space.betweenSections;
  const rows = ACTION_NAMES.map(([a, name]) => {
    const label = kit.text(name, { size: 14, fill: color.ink });
    // The merged table input uses: a key moved to another action leaves this one (input.js keyTable).
    const now = (table[a] ?? []).slice(0, 2).map(keyLabel).join('  ') || 'none';
    const key = kit.button(listening === a ? 'press a key' : now, () => listen(a, ctx), { size: 14, font: 'mono', tight: !kit.stage.touch, selected: listening === a || !!mine[a] });
    key.label = 'key-' + a;
    // W40 (1.7 options.js:199): how a binding changes, on the key's card.
    kit.details(key, { title: name, lines: ['Select a binding, then press a key. Esc cancels.'] });
    return [label, key];
  });
  // Item 164: each column is as wide as its own widest label and widest key at this text size, at least 8 between
  // them; two columns when both fit, else one. The room left is shared out. A key keeps to its column's right edge,
  // its button's padding past it, so its words start 8 in from its own left.
  const need = list => Math.max(...list.map(([l]) => l.width)) + Math.max(...list.map(([, k]) => k.width)) - space.betweenRows;
  const half = Math.ceil(rows.length / 2), halves = [rows.slice(0, half), rows.slice(half)];
  const groups = need(halves[0]) + need(halves[1]) + gap <= inner ? halves : [rows];
  const spare = Math.floor((inner - gap * (groups.length - 1) - groups.reduce((n, g) => n + need(g), 0)) / groups.length);
  const grid = new Container();
  let x = 0;
  for (const g of groups) {
    const cw = need(g) + spare;
    g.forEach(([label, key], i) => {
      const c = new Container();
      key.x = cw - key.width + space.betweenRows;
      label.y = Math.round((key.height - label.height) / 2);
      c.addChild(label, key);
      c.position.set(x, i * (c.height + (kit.stage.touch ? space.inRow : -6)));
      grid.addChild(c);
    });
    x += cw + gap;
  }
  const hot = kit.text('Arrow keys always move. Esc closes windows.', { size: 14, fill: color.ash, wrap: inner });
  const reset = kit.plateButton('Reset keys', () => { ctx.deps.options?.set('keys', null); ctx.deps.cue?.('ui-click'); ctx.reopen(); }, { h: Math.max(30, kit.target), size: 14 });
  const body = panel(kit, 'Keys', w, stack([grid, hot, reset], space.betweenRows));
  return collapsible ? stack([disclosure(kit, 'Keyboard controls', true, toggle), body], space.betweenRows) : body;
}

/**
 * @param {ReturnType<import('../core/widgets.js').createKit>} kit
 * @param {{w:number,h:number}} area
 * @param {{deps:any, reopen:()=>void}} ctx
 */
export function buildOptions(kit, area, ctx) {
  const touch = kit.stage.touch, sec = space.betweenSections;
  const store = ctx.deps.options;
  const get = o => { const v = store?.get(o.key); return v === undefined || v === null ? defaultOf(o, touch, kit.stage) : o.read ? o.read(v) : v; };
  const set = (key, v) => { store?.set(key, v); ctx.deps.cue?.('ui-click'); ctx.reopen(); };
  // A slider's value as it moves: stored and applied at once, the window left as it is.
  const live = (key, v) => store?.set(key, v);
  const [inter, map, controls, audio] = SECTIONS;
  const ncols = area.w >= 900 ? 3 : area.w >= 600 ? 2 : 1;
  // T17 (1.7 touchui.js:178-179): on touch there is no keyboard to bind, so the keys panel goes and Audio and the map
  // settings sit higher.
  // A tablet keeps it, as 1.7's tablet Options had 'Keyboard controls' (proof pass item 22; sandbox lead's ruling 10-17).
  const st = kit.stage, tablet = st.form === 'tablet';
  const plan = touch && !tablet ? (ncols === 3 ? [[inter], [map], [controls, audio]] : ncols === 2 ? [[inter, controls], [map, audio]] : [[inter, map, controls, audio]])
    : ncols === 3 ? [[inter, audio], [map, controls], ['keys']] : ncols === 2 ? [[inter, controls, audio], [map, 'keys']] : [[inter, map, controls, audio, 'keys']];
  const { w: cw, xs } = split(area.w, ncols, sec);
  const body = new Container();
  // W16 (1.7 options.js:202, :257-264): How to play replays the first-play guide; the window steps aside for it and
  // comes back when it ends.
  const guide = ctx.ui?.tour ? kit.plateButton('How to play', () => ctx.ui.tour(), { h: Math.max(34, kit.target), size: 14, rank: 'prominent' }) : null;
  if (guide) { guide.label = 'how-to-play'; kit.details(guide, { title: 'How to play', lines: ['Movement, turns, items and character growth.'] }); }
  // A tablet's 'Keyboard controls' sits at the foot, under every section, as 1.7's (sandbox lead 2026-10-18).
  plan.forEach((list, i) => {
    const col = stack([i === 0 ? guide : null, ...list.filter(s => !(tablet && s === 'keys')).map(s => s === 'keys' ? keys(kit, cw, ctx) : group(kit, s, cw, get, set, live))].filter(Boolean), sec);
    col.x = xs[i];
    body.addChild(col);
  });
  if (!touch && ncols >= 3 && body.height > area.h) {
    // Large text keeps every setting readable; the keyboard list opens at full window width.
    body.destroy({ children: true });
    if (keysOpen) return keys(kit, area.w, ctx, true);
    const compact = new Container(), groups = [[inter], [map, controls], [audio]];
    groups.forEach((list, i) => {
      const col = stack([...list.map(s => group(kit, s, cw, get, set, live)), i === 2 ? keys(kit, cw, ctx, true) : null], sec);
      col.x = xs[i]; compact.addChild(col);
    });
    if (guide) { const again = kit.plateButton('How to play', () => ctx.ui.tour(), { h: Math.max(34, kit.target), size: 14, rank: 'prominent' }); again.label = 'how-to-play'; again.y = compact.children[0].height + sec; compact.children[0].addChild(again); }
    return compact;
  }
  if (tablet) { const foot = keys(kit, cw, ctx, true); foot.y = body.height + sec; body.addChild(foot); }
  return body;
}
