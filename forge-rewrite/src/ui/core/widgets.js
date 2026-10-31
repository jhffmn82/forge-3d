// The UI's building blocks, drawn flat: words as buttons, colour for selection, a filled block for focus.
// Sizes are logical pixels; the UI layer is scaled by the stage, and text is rasterised at the final scale.
// Plate buttons (drawn 1.7 art) are only for the title menu and a real confirm.

import { Container, Graphics, Rectangle, Text, BlurFilter, ColorMatrixFilter, Ticker } from '../../../../forge-godot/runtime/pixi.js';
import ui from '../../../data/ui.json' with { type: 'json' };
import { plate, plateInset, chevronPlate } from './plates.js';
import { reducedMotion as motionReduced } from './stage.js';
import { elementPalette } from './colour.js';

/**
 * 1.7's call-to-action glow on the word itself, not the plate (painted-ui.css:887-893 forgeWordGlow, Justin 10-15: "a
 * glowing blue highlight to the actual text"): the letters #eaf4ff on a 1 px black edge, a 6 px #6fb6ff halo and a 14 px
 * #3a8ad6 one at 70%, breathing every 1.8 s to 10 px #8cc8ff and 24 px #3a8ad6 at full; steady under reduced motion.
 * Two blurred copies of the word lie under it.
 */
function callGlow(c, label, reduced) {
  // The plate's own paint keeps this fill on hover and focus.
  label.callFill = 0xeaf4ff;
  label.style.fill = label.callFill;
  label.style.dropShadow = { color: 0x000000, alpha: 1, blur: 0, distance: 1, angle: Math.PI / 2 };
  const copy = (tint, alpha) => {
    const t = new Text({ text: label.text, resolution: label.resolution, style: label.style.clone() });
    t.style.fill = 0xffffff; t.style.dropShadow = false;
    t.tint = tint; t.alpha = alpha; t.eventMode = 'none';
    t.anchor.copyFrom(label.anchor); t.position.copyFrom(label.position);
    t.filters = [new BlurFilter({ strength: 1, quality: 3 })];
    return t;
  };
  const inner = copy(0x6fb6ff, 1), outer = copy(0x3a8ad6, 0.7);
  c.addChildAt(outer, c.getChildIndex(label));
  c.addChildAt(inner, c.getChildIndex(label));
  const set = s => {
    inner.filters[0].strength = 3 + 2 * s; outer.filters[0].strength = 7 + 5 * s;
    const mix = (a, b) => [16, 8, 0].reduce((n, k) => n | Math.round(((a >> k) & 255) + (((b >> k) & 255) - ((a >> k) & 255)) * s) << k, 0);
    inner.tint = mix(0x6fb6ff, 0x8cc8ff); outer.alpha = 0.7 + 0.3 * s;
  };
  set(0);
  if (reduced) return;
  let ms = 0;
  const tick = tk => { ms = (ms + tk.deltaMS) % 1800; set((1 - Math.cos(ms / 1800 * Math.PI * 2)) / 2); };
  Ticker.shared.add(tick);
  c.on('destroyed', () => Ticker.shared.remove(tick));
}

const theme = ui.theme.obsidian;
export const color = Object.fromEntries(Object.entries(theme).map(([k, v]) => [k, Number('0x' + v.slice(1))]));
export const space = ui.space;
/** Selected, hovered and primary words are silver; words at rest are grey (Justin 10-14, data/ui.json accent and rest). */
const REST = color.rest ?? color.ash;
/** 1.7's highlight follows the hero's element (painted-ui.css --aff-hi @3c8b312): white with none. */
export const AFFINITY_HIGHLIGHT = elementPalette('highlight');
/** 1.7's neutral card grey (#141619) for every fill behind UI: the obsidian blues are gone (Justin 10-16). */
export const CARD = color.card ?? 0x141619;
/** Options Text size: 1.7's --ui-text-scale. */
export const TEXT_SCALE = { small: 0.9, standard: 1, large: 1.12 };

/**
 * 1.7's dark edges under lettering on drawn art (one canvas shadow each, nearest to 1.7's text-shadow stacks):
 * edge, the plates' (1.7's "0 1px 0 #000 ... 0 2px 3px #000", painted-ui.css:299, as its hard first line: item 195, Justin
 * 2026-10-19: "text on these buttons is really blurry, i think it's the shading maybe?"); lift, window titles' "0 2px 0 #000"
 * (painted-ui.css:77, forge-skin.css:539); halo, creation names and the strip's "0 1px 0 #000, 0 0 6px #000"
 * (forge-skin.css:560, 882); plaque, the title's "0 3px 5px #000" (title-screen.css:10).
 */
export const SHADOW = {
  edge: { color: 0x000000, alpha: 1, blur: 0, distance: 1, angle: Math.PI / 2 },
  lift: { color: 0x000000, alpha: 1, blur: 0, distance: 2, angle: Math.PI / 2 },
  halo: { color: 0x000000, alpha: 1, blur: 5, distance: 1, angle: Math.PI / 2 },
  plaque: { color: 0x000000, alpha: 1, blur: 5, distance: 3, angle: Math.PI / 2 },
};

/** 1.7's hover on a drawn plate (painted-ui.css:246, 248, 303): the plate itself brightens, its lettering stays. */
export function brighten(node, k) {
  if (k === 1) { node.filters = null; return; }
  // At the screen's own density, so the drawn plate stays as sharp as it is at rest.
  const f = new ColorMatrixFilter({ resolution: 'inherit' });
  f.brightness(k, false);
  node.filters = [f];
}

/**
 * Per-build context: the stage decides text resolution, the touch bump and target size.
 * `hooks` lets the screen around a control show its details (hover card, or the info line on touch)
 * and lets the focus model know every control that can act.
 */
export function createKit(stage, resolution, affinity = null, o = {}) {
  /** The highlight: names, headings, the picked tab and word, hovered words. */
  const LIT = AFFINITY_HIGHLIGHT[affinity] ?? color.accent;
  const textRes = resolution * stage.s;
  const target = stage.touch ? Math.ceil(ui.touchTarget.touch / Math.min(1, stage.s)) : ui.touchTarget.mouse;
  // Every size snaps to the nearest of the eight text sizes (plan section 1), so no word can fall off the scale.
  const SIZES = Object.values(ui.text);
  // Options Text size (1.7 options.js:121 --ui-text-scale .9, 1, 1.12) scales the step before the touch bump is added.
  const scale = TEXT_SCALE[o.textSize] ?? 1;
  const size = n => Math.round((ui.text[n] ?? SIZES.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a))) * scale) + stage.textBump;
  const hooks = { show: null, hide: null, controls: [] };
  // A7 (1.7 audio.js:221-225): every control, tapped, clicked or confirmed by key, gives a quiet click (`o.tap`).
  const tap = typeof o.tap === 'function' ? o.tap : () => {};
  // Options Motion (`o.motion`; Auto or unset follows the system's wish): calls to action hold still (U5, ui-09).
  const reducedMotion = motionReduced(o.motion);

  /** @param {string} words @param {{size?:number, font?:'display'|'body'|'mono', fill?:number, weight?:string, italic?:boolean, wrap?:number, align?:string, shadow?:keyof SHADOW}} o */
  function text(words, o = {}) {
    const px = size(o.size ?? 16);
    const t = new Text({
      text: words,
      resolution: textRes,
      style: {
        fontFamily: ui.fonts[o.font ?? 'body'], fontSize: px, fill: o.fill ?? color.ink, align: o.align ?? 'left',
        fontWeight: o.weight ?? '400', fontStyle: o.italic ? 'italic' : 'normal', wordWrap: !!o.wrap, wordWrapWidth: o.wrap ?? 0, lineHeight: Math.round(px * 1.3),
        ...(o.shadow && SHADOW[o.shadow] ? { dropShadow: { ...SHADOW[o.shadow] } } : {}),
      },
    });
    // Words never take a tap themselves: a word lying over a control must not swallow it (Pixi 8 stops at any hit).
    t.eventMode = 'none';
    // Item 193 ("text on the tool tips looks fuzzy"): every word lands on whole device pixels, wherever its layout puts it.
    t.roundPixels = true;
    return t;
  }

  /** Details on demand for any node: a hover card with a mouse, the window's info line on touch. */
  /** Words take no taps, so a control is hit by its own box: what it holds when it is made. */
  const box = node => { if (!node.hitArea) { const b = node.getLocalBounds(); node.hitArea = new Rectangle(b.x, b.y, b.width, b.height); } };

  function details(node, d) {
    if (!d) return node;
    node.eventMode = 'static';
    box(node);
    node.detail = d;
    // CSS-27 (painted-ui.css:644, 867, 913): a tile that only explains itself shows the help cursor; a control keeps its pointer.
    if (!node.cursor || node.cursor === 'auto' || node.cursor === 'default') node.cursor = 'help';
    node.on('pointerover', e => { if (e.pointerType === 'mouse') hooks.show?.(node, d); });
    node.on('pointerout', e => { if (e.pointerType === 'mouse') hooks.hide?.(node); });
    node.on('pointertap', e => { if (e.pointerType !== 'mouse') hooks.show?.(node, d); });
    return node;
  }

  /** Registers a control with the focus model; `act` runs on a tap, a click or the confirm key. */
  function control(node, act, o = {}) {
    node.eventMode = 'static'; node.cursor = 'pointer';
    box(node);
    // The click comes after the act, so a window's own open or close sound is the one heard (the interface's sounds
    // are one group over 70 ms).
    const run = () => { act(); tap(); };
    node.on('pointertap', e => { e.stopPropagation(); run(); });
    hooks.controls.push({ node, act: run, group: o.group ?? 0 });
    return node;
  }

  /** A word that acts. Hover and focus fill a block behind it; `selected` lights it. */
  function button(words, onTap, o = {}) {
    const c = new Container();
    const label = text(words, { size: o.size ?? 20, font: o.font ?? 'display', fill: o.selected || o.primary ? LIT : REST });
    const w = Math.max(o.w ?? 0, o.tight ? 0 : target, label.width + (o.tight ? space.betweenRows * 2 : space.betweenSections)), h = o.tight ? label.height + space.betweenRows : Math.max(target, label.height + space.betweenRows);
    const hit = new Graphics().rect(0, 0, w, h).fill({ color: 0, alpha: 0.001 });
    label.anchor.set(o.left ? 0 : 0.5, 0.5); label.position.set(o.left ? space.betweenRows : w / 2, h / 2);
    c.addChild(hit, label);
    let selected = !!o.selected, on = false;
    // Hover and focus light the word only (Justin 10-16: no highlight block behind it).
    const paint = () => { label.style.fill = selected || on || o.primary ? LIT : o.dim ? color.dim : REST; };
    c.setFocus = f => { on = f; paint(); };
    c.setSelected = s => { selected = s; paint(); };
    c.isSelected = () => selected;
    c.on('pointerover', e => { if (e.pointerType === 'mouse') c.setFocus(true); });
    c.on('pointerout', () => c.setFocus(false));
    c.label = words;
    paint();
    control(c, onTap, o);
    // A tight word is drawn short but still takes a fingertip-sized tap around it.
    if (h < target) c.hitArea = new Rectangle(0, (h - target) / 2, w, target);
    return c;
  }

  /** A drawn plate with blackletter words: the title menu, Enter and other real confirms. */
  function plateButton(words, onTap, o = {}) {
    const c = new Container();
    const rank = o.rank ?? 'subdued', h = o.h ?? Math.max(target, 52), border = Math.round(h * 0.42);
    // `o.ink`: the word's colour at rest, when it is not the rank's (creation's Tutorial plate, CSS-24).
    // A plate's words at rest are 1.7's bright off-white, not the grey of a word button; a plate never reads as disabled
    // (proof pass, routed by Sandbox UI fixes 2026-10-17: Load Game, Settings, Back to title read greyed out).
    const inkAtRest = o.ink ?? (rank === 'prominent' ? LIT : color.ink);
    const label = text(words, { size: o.size ?? 20, font: 'display', weight: '700', fill: inkAtRest, shadow: 'edge' });
    const w = Math.max(o.w ?? 0, label.width + plateInset(rank, border) * 2 + space.betweenSections * 2);
    const art = plate(rank, w, h, border);
    // The plate brightens under the pointer or focus: 1.3 prominent, 1.35 subdued; the title menu sets its own (`tone`).
    const tone = { rest: 1, hover: rank === 'prominent' ? 1.3 : 1.35, ...o.tone };
    // A darker plate at rest is a tint (no filter); a brighter one a colour matrix while it is lit.
    const rest = Math.round(255 * Math.min(1, tone.rest));
    art.tint = (rest << 16) | (rest << 8) | rest;
    label.anchor.set(0.5); label.position.set(w / 2, h / 2 - 1);
    c.addChild(art, label);
    // `o.sub`: a second line inside the plate under the word (1.7 #tContinue .sub, painted-ui.css:531-534): Spectral
    // 600 small, light, on the plate's hard dark edge so it reads on the bright plate.
    if (o.sub) {
      const sub = text(o.sub, { size: 14, font: 'body', weight: '600', fill: 0xf4f7fb, shadow: 'edge' });
      const room = w - plateInset(rank, border) * 2;
      if (sub.width > room) sub.scale.set(room / sub.width);
      const both = label.height * 0.86 + 1 + sub.height;
      label.y = Math.round(h / 2 - both / 2 + label.height * 0.43);
      sub.anchor.set(0.5, 0); sub.position.set(w / 2, Math.round(label.y + label.height * 0.43 + 1));
      sub.label = 'plate-sub';
      c.addChild(sub);
    }
    // A plate lit at rest (tone.rest above 1: a toggle that is on) keeps its colour matrix while the pointer is away.
    const paint = on => {
      art.tint = on ? 0xffffff : (rest << 16) | (rest << 8) | rest;
      brighten(art, on ? tone.hover : Math.max(1, tone.rest));
      label.style.fill = label.callFill ?? (on ? LIT : inkAtRest);
    };
    if (tone.rest > 1) brighten(art, tone.rest);
    c.setFocus = paint;
    c.on('pointerover', e => { if (e.pointerType === 'mouse') paint(true); });
    c.on('pointerout', () => paint(false));
    c.label = words;
    if (o.glow) callGlow(c, label, reducedMotion);
    control(c, onTap, o);
    // A plate drawn smaller than a fingertip still answers a fingertip-sized tap around it.
    if (h < target) c.hitArea = new Rectangle(0, (h - target) / 2, w, target);
    return c;
  }

  /** A chevron plate with blackletter words: one step of a strip. `o.start` for the first, `o.rank` prominent for the live one. */
  function chevron(words, onTap, o = {}) {
    const c = new Container();
    const rank = o.rank ?? 'subdued', h = Math.max(target, o.h ?? 52);
    const plateH = Math.min(h, Math.max(target, o.plateH ?? h));
    const label = text(words, { size: o.size ?? 20, font: 'display', weight: '700', fill: rank === 'prominent' ? color.accent : color.ink, shadow: 'halo' });
    // Keep the existing word allowance so removing the soft halo does not squeeze the plates.
    const wordWidth = label.width;
    label.style.dropShadow = { ...SHADOW.lift, distance: 1 };
    const hit = new Graphics(), lettering = new Container();
    let art, start = !!o.start;
    label.anchor.set(0.5);
    lettering.addChild(label);
    c.addChild(hit, lettering);
    const layout = () => {
      const probe = chevronPlate(rank, start, 1, plateH);
      const w = wordWidth + probe.left + probe.right + space.betweenSections;
      probe.sprite.destroy({ children: true });
      art?.sprite.destroy({ children: true });
      art = chevronPlate(rank, start, w, plateH);
      art.sprite.y = (h - plateH) / 2;
      c.addChildAt(art.sprite, 1);
      hit.clear().rect(0, 0, w, h).fill({ color: 0, alpha: 0.001 });
      c.hitArea = new Rectangle(0, 0, w, h);
      lettering.position.set(art.left + (w - art.left - art.right) / 2 + space.inRow, h / 2 - 1);
      c.tuck = art.tuck;
    };
    layout();
    // Wrapping changes the left edge without replacing the control or registering another focus handler.
    c.startRow = () => { if (!start) { start = true; layout(); } };
    // A chevron is a plate too: it brightens 1.25 as 1.7's creation-step chevrons did on hover (painted-ui.css:371).
    const paint = on => { brighten(art.sprite, on ? 1.25 : 1); label.style.fill = label.callFill ?? (on || rank === 'prominent' ? color.accent : color.ink); };
    c.setFocus = paint;
    c.on('pointerover', e => { if (e.pointerType === 'mouse') paint(true); });
    c.on('pointerout', () => paint(false));
    c.label = words;
    if (o.glow) callGlow(lettering, label, reducedMotion);
    return control(c, onTap, o);
  }

  /** A resource bar: fill, the name on the left, the numbers on the right. */
  function bar(name, fill, w, h) {
    const c = new Container(), bg = new Graphics(), fg = new Graphics();
    const left = text(name, { size: 14, font: 'mono', fill: color.ink }), right = text('', { size: 14, font: 'mono', fill: color.ink, weight: '600' });
    left.anchor.set(0, 0.5); right.anchor.set(1, 0.5);
    left.position.set(space.betweenRows, h / 2); right.position.set(w - space.betweenRows, h / 2);
    c.addChild(bg, fg, left, right);
    c.set = (now, max) => {
      bg.clear().rect(0, 0, w, h).fill({ color: color.panel, alpha: 0.85 });
      fg.clear().rect(0, 0, Math.round(w * Math.max(0, now) / Math.max(1, max)), h).fill(fill);
      right.text = `${now}/${max}`;
    };
    return c;
  }

  /** A square slot (hotbar, bag, worn): a faint fill, an optional number in the corner. */
  function slot(n, sz, onTap) {
    const c = new Container();
    const bg = new Graphics().rect(0, 0, sz, sz).fill({ color: CARD, alpha: 0.85 });
    c.addChild(bg);
    if (n !== null && n !== undefined && n !== '') {
      const num = text(String(n), { size: 10, font: 'mono', fill: color.dim });
      num.position.set(space.inRow, 2);
      c.addChild(num);
    }
    c.eventMode = 'static';
    if (onTap) { c.cursor = 'pointer'; c.on('pointertap', e => { e.stopPropagation(); onTap(); }); }
    return c;
  }

  /** A flat sheet: one fill, no outline, no shadow. */
  function sheet(w, h, fill = CARD, alpha = 0.97) {
    const g = new Graphics().rect(0, 0, w, h).fill({ color: fill, alpha });
    g.eventMode = 'static';
    return g;
  }

  // density: screen pixels to a logical px (pixel art drawn at a whole number of them stays crisp, inventory.js's doll).
  return { text, button, plateButton, chevron, bar, slot, sheet, details, control, target, size, hooks, stage, accent: LIT, textScale: scale, tap, reduced: reducedMotion, density: textRes };
}
