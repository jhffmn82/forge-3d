// Character creation as fixed screens that never scroll: race, court (Fae), class, god (Cleric), name.
// Tapping a figure previews it; the Confirm plate keeps it and moves on; a finished step's word reopens it.
// Sizes and places are 1.7's, measured from its captures (LAYOUT). L: line-up left, six-gem panel right. P: line-up on top.

import { Assets, ColorMatrixFilter, Container, Graphics, Sprite, Texture, Ticker } from '../../../../forge-godot/runtime/pixi.js';
import { color, space, CARD } from '../core/widgets.js';
import { sixGemFrame, sixGemInset } from '../core/plates.js';
import { editText } from '../core/text-entry.js';
import { scrollable } from '../core/scroll.js';
import { plaque } from './title.js';
import { figure, shrine, paintingsIn } from './creation-art.js';
import { creationPanel, courtColour, classTag } from './creation-panel.js';
import { hallLife, sunbeam, beamNow } from './creation-hall.js';
import { buildStage } from './creation-stage.js';
import { chip } from '../core/chip.js';
import godsData from '../../../data/gods.json' with { type: 'json' };
import classes from '../../../data/classes.json' with { type: 'json' };
import { steps, options, optionName, pick, lookOf, refusal, randomChoice, randomName, randomGod, newChoice, pickSex } from '../model/creation-model.js';
import { STEP_TITLE } from '../model/words.js';
import { whenLoaded } from '../core/loaded.js';
import { toNum } from '../core/colour.js';

export { newChoice };

/**
 * A tone on a figure: brightness `b` after saturate `s`. An unpicked figure stands at half brightness, half its colour,
 * so the picked one plainly leads (Justin 2026-10-20: "when selecting race have the non selected dimmed"; 1.7's .78 read
 * as no change); a side shrine saturate .6 brightness .75, a refusing god grayscale brightness .6 (forge-skin.css:642,
 * 655). Null for no change.
 */
function tone(b, s) {
  if (b === 1 && s === 1) return null;
  const f = new ColorMatrixFilter({ resolution: 'inherit' });
  const m = [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s];
  f.matrix = [m[0] * b, m[1] * b, m[2] * b, 0, 0, m[3] * b, m[4] * b, m[5] * b, 0, 0, m[6] * b, m[7] * b, m[8] * b, 0, 0, 0, 0, 0, 1, 0];
  return [f];
}
const DIM = [0.5, 0.5], SIDE = [0.75, 0.6], REFUSED = [0.6, 0];

/**
 * The soft shadow under a figure's feet, `w` px wide, centred on its feet. 'blur': 1.7's line-up oval, a 40 x 8 #0009
 * ellipse blurred 3 px (forge-skin.css:568); 'fade': the big hero's floor, a radial #0009 to clear (forge-skin.css:577).
 */
const shadowTex = {};
function footShadow(kind, w) {
  if (!shadowTex[kind]) {
    const W = 128, H = 32, c = Object.assign(document.createElement('canvas'), { width: W, height: H }), g = c.getContext('2d');
    const gr = g.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
    if (kind === 'blur') { gr.addColorStop(0, 'rgba(0,0,0,.6)'); gr.addColorStop(0.62, 'rgba(0,0,0,.55)'); gr.addColorStop(0.8, 'rgba(0,0,0,.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); }
    else { gr.addColorStop(0, 'rgba(0,0,0,.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); }
    g.setTransform(1, 0, 0, H / W, 0, 0); g.fillStyle = gr; g.fillRect(0, 0, W, W);
    shadowTex[kind] = Texture.from({ resource: c, scaleMode: 'linear' });
  }
  const s = new Sprite(shadowTex[kind]);
  // The blurred oval keeps 1.7's 40 x 8 plus its 3 px blur; the floor shadow is 30% x 5% of the 180 x 174 stage.
  s.anchor.set(0.5); s.width = w; s.height = Math.round(w * (kind === 'blur' ? 0.3 : 0.16));
  s.eventMode = 'none';
  return s;
}

/** The look a line-up figure shows for option `id` at `step`. */
function lookFor(c, step, id) {
  // Before the class step (race and court) the figures wear no class's gear (sandbox 87, Justin 10-17: "it equips them
  // with sword and shield at the ember court selection instead of their unequiped sprites").
  if (step === 'race' || step === 'court') {
    // CF40 (1.7 paintCreationCastHires, create.js:330-338): going back to the races keeps the outfit a class gives, a
    // Tourist's and a Chad Cleric's; any other class shows the starting outfit.
    const cls = c.cls === 'tourist' ? 'tourist' : c.cls === 'cleric' && c.god === 'grom' ? 'cleric' : 'fighter';
    const look = lookOf(pick({ ...c, cls, god: cls === 'cleric' ? 'grom' : null }, step, id, () => 0));
    return cls === 'fighter' ? look.replace(/-fighter$/, '-base') : look;
  }
  // A preview never draws a god at random, so the figures hold still between redraws.
  return lookOf(pick(c, step, id, () => 0));
}

/**
 * Where everything sits, measured from 1.7's creation captures (review-1.7/rewrite-baseline/guide, 1280x800 and
 * 390x844) in logical px at the reference stage. y values scale with the stage height; x anchors to the edges.
 */
const LAYOUT = {
  // Figures, sexes and the god carousel sit 40 lower than 1.7, the panel lower too (Justin 10-16: room to move both down).
  L: { margin: 77, topY: 53, topH: 37, headY: 41, headW: 437, chevY: 203, chevH: 45, figH: 160, feetY: 540, nameSize: 20,
    sexY: 632, sexH: 31, sexW: 93, tutY: 728, panelW: 510, panelY: 190, panelBottom: 763, frame: 40, godH: 187, arrowDX: 270, arrowY: 430, countY: 626, refH: 800 },
  P: { margin: 10, topY: 9, topH: 33, headY: 54, headW: 358, chevY: 127, chevH: 46, figH: 93, feetY: 327, nameSize: 14,
    sexY: 376, sexH: 32, sexW: 91, tutY: 796, panelW: 363, panelY: 420, panelBottom: 784, frame: 24, godH: 110, arrowDX: 160, arrowY: 260, countY: 368, refH: 844 },
};

function lineup(kit, create, M, ky, cx, w, acts) {
  const c = create.choice, step = steps(c)[create.step], root = new Container();
  if (step === 'god') return godCarousel(kit, create, M, ky, cx, acts);
  if (step === 'cls') return classStep(kit, create, M, ky, cx, w, acts);
  const list = options(step), cell = Math.min(w / list.length, M.figH * 0.75 + 4), figH = Math.round(M.figH * ky);
  const x0 = cx - (cell * list.length) / 2, feet = Math.round(M.feetY * ky);
  list.forEach((id, i) => {
    const on = c[step] === id;
    const slot = new Container();
    // CF35 (1.7 create.js:540): a court's name in its element's colour.
    const name = kit.text(optionName(step, id), { size: M.nameSize, font: 'display', fill: step === 'court' ? courtColour(id) : on ? kit.accent : color.rest, shadow: 'halo' });
    name.anchor.set(0.5, 0); name.position.set(cell / 2, figH + space.betweenRows);
    slot.addChild(new Graphics().rect(0, 0, cell, figH + space.betweenRows + name.height).fill({ color: 0, alpha: 0.001 }));
    const fig = figure(lookFor(c, step, id), figH);
    if (fig) {
      // 1.7's 40 px oval under a 140 px port, scaled with the figure.
      const sh = footShadow('blur', Math.round(52 * figH / 140));
      sh.position.set(cell / 2, figH - 2);
      fig.position.set(cell / 2, figH);
      // An unpicked figure stands solid and dimmed, not see-through; a mouse over it lifts it (1.7 brightness 1.1).
      const rest = on ? null : tone(...DIM), lit = tone(1.1, 1);
      fig.filters = rest;
      slot.on('pointerover', e => { if (e.pointerType === 'mouse') fig.filters = lit; });
      slot.on('pointerout', () => { fig.filters = rest; });
      slot.addChild(sh, fig);
    }
    slot.addChild(name);
    slot.label = 'pick-' + id;
    slot.position.set(x0 + i * cell, feet - figH);
    kit.control(slot, () => { acts.cue('ui-click'); create.choice = pick(c, step, id); acts.redraw(); });
    root.addChild(slot);
  });
  return root;
}

/** The class step, as 1.7 had it: the hero in the picked class's outfit alone in the middle, the classes as icons with
 * their names in a row beneath (Justin 10-16: not five figures). */
function classStep(kit, create, M, ky, cx, w, acts) {
  // The hero stands where the race line-up stood, so moving between steps does not shift it; the class row sits lower,
  // where the sex plates were (Justin 10-16: "move those options lower ... to prevent crowding and shifting").
  const c = create.choice, root = new Container(), figH = Math.round(M.figH * ky * 1.15), feet = Math.round(M.feetY * ky);
  // No god is sworn on the class step, so a Cleric wears the default Cleric outfit, not a god's (Justin 10-16, item 49).
  const fig = figure(lookOf({ ...c, god: null }), figH);
  if (fig) { const sh = footShadow('fade', Math.round(figH * 0.62)); sh.position.set(cx, feet - Math.round(figH * 0.04)); fig.position.set(cx, feet); root.addChild(sh, fig); }
  const list = options('cls'), size = kit.stage.kind === 'P' ? 44 : 56, cell = Math.min(w / list.length, 110);
  const short = kit.stage.short;
  // Item 312: a class's kind under its name, where it fits on one line in its cell (a phone's narrow cells leave the
  // Tourist's "Challenge Class" to the panel).
  const one = t => t && t.width <= cell && t.height < kit.size(14) * 1.6 ? t : (t?.destroy(), null);
  const tags = Object.fromEntries(list.map(id => [id, one(classTag(kit, id, cell, 14, 'halo'))]));
  const tagH = Math.max(0, ...Object.values(tags).map(t => t?.height ?? 0));
  // The row ends at least a section's space above the Tutorial plate (proof pass item 5: 8 px at 1280x800).
  const nameH = kit.size(M.nameSize) * 1.3, clear = Math.round(M.tutY * ky) - space.betweenSections - (size + space.inRow + nameH + tagH);
  const x0 = cx - (cell * list.length) / 2, y = short ? feet + space.inRow : Math.min(clear, Math.max(feet + space.betweenRows, Math.round(M.sexY * ky)));
  list.forEach((id, i) => {
    const on = c.cls === id, slot = new Container();
    const name = kit.text(optionName('cls', id), { size: M.nameSize, font: 'display', fill: on ? kit.accent : color.rest, shadow: 'halo' });
    name.anchor.set(0.5, 0); name.position.set(cell / 2, size + space.inRow);
    const tag = tags[id];
    if (tag) { tag.y = name.y + name.height; tag.label = 'class-tag-row'; }
    slot.addChild(new Graphics().rect(0, 0, cell, size + space.inRow + name.height + (tag?.height ?? 0)).fill({ color: 0, alpha: 0.001 }));
    // Each class in a chip like the ability icons, in full colour; the picked one lit and named in the highlight (1.7, 10-16, item 5).
    const ch = chip(classes.rows[id].icon, size);
    ch.x = Math.round((cell - size) / 2);
    slot.addChild(ch);
    if (on) slot.addChild(new Graphics().roundRect(ch.x, 0, size, size, 4).stroke({ color: kit.accent, width: 2 }));
    slot.addChild(name, ...(tag ? [tag] : []));
    slot.label = 'pick-' + id;
    slot.position.set(x0 + i * cell, y);
    kit.control(slot, () => { acts.cue('ui-click'); create.choice = pick(c, 'cls', id); acts.redraw(); });
    root.addChild(slot);
  });
  return root;
}

function godCarousel(kit, create, M, ky, cx, acts) {
  const c = create.choice, gods = options('god'), root = new Container(), P = kit.stage.kind === 'P';
  const at = gods.indexOf(c.god), figH = Math.round(M.godH * ky), feet = Math.round((M.feetY + 10) * ky);
  const go = d => { acts.cue('ui-click'); create.godTurn = { dir: d, to: (at + d + gods.length) % gods.length }; create.choice = { ...c, god: gods[create.godTurn.to] }; acts.redraw(); };
  const dx = Math.min(M.arrowDX, cx - M.margin - 20), stepX = dx * 0.52;
  // A turn slides and scales the statues from where they stood, the leaving one fading (1.7 animateCreationGods, 380 ms).
  const turn = create.godTurn?.to === at && !kit.reduced ? create.godTurn.dir : 0;
  create.godTurn = null;
  const moving = [];
  // 1.7: a side shrine at .42 opacity and its name at .58 (forge-skin.css:642-643); a refusing god grey, not faded.
  const SMALL = 0.62, figA = big => big ? 1 : 0.42, nameA = (big, no) => big ? (no ? 0.5 : 1) : 0.58;
  let bigBottom = 0;
  const statue = (id, d) => {
    const no = refusal(id, c), big = d === 0, slot = new Container();
    const fig = shrine(id, big ? figH : Math.round(figH * SMALL), acts.redraw);
    if (fig) { fig.position.set(0, feet); fig.alpha = figA(big); fig.filters = no ? tone(...REFUSED) : big ? null : tone(...SIDE); slot.addChild(fig); }
    const own = toNum(godsData.rows[id].color);
    const name = kit.text(optionName('god', id).split(',')[0], { size: M.nameSize, font: 'display', fill: own, align: 'center', wrap: stepX * 1.1, shadow: 'halo' });
    name.alpha = nameA(big, no);
    name.anchor.set(0.5, 0); name.position.set(0, feet + space.betweenRows);
    if (big || !P) slot.addChild(name);
    if (big) bigBottom = name.y + name.height;
    slot.pivot.y = feet; slot.position.set(cx + d * stepX, feet);
    return { slot, fig, name, no, big };
  };
  [-1, 0, 1].forEach(d => {
    const { slot, fig, name, no, big } = statue(gods[(at + d + gods.length) % gods.length], d);
    if (!big) { slot.addChildAt(new Graphics().rect(-stepX / 2, feet - figH, stepX, figH).fill({ color: 0, alpha: 0.001 }), 0); kit.control(slot, () => go(d)); }
    if (turn) {
      // It stood one place over before the turn; the one coming in rises from beyond the edge, small and unseen.
      const was = d + turn, seen = Math.abs(was) <= 1, wasBig = was === 0;
      moving.push({ node: slot, x0: cx + was * stepX, x1: slot.x, y0: seen ? 0 : -20, s0: seen ? (wasBig ? 1 : SMALL) / (big ? 1 : SMALL) : 0.65,
        parts: [[fig, seen ? figA(wasBig) : 0, fig?.alpha], [name, seen ? nameA(wasBig, no) : 0, name.alpha]] });
    }
    root.addChild(slot);
  });
  if (turn) {
    // The statue that stood on the far side walks off it and fades.
    const gone = statue(gods[(at - 2 * turn + 2 * gods.length) % gods.length], -turn);
    moving.push({ node: gone.slot, x0: gone.slot.x, x1: cx - 2 * turn * stepX, y0: 0, y1: -24, s0: 1, s1: 0.65, parts: [[gone.fig, gone.fig?.alpha, 0], [gone.name, gone.name.alpha, 0]] });
    root.addChildAt(gone.slot, 0);
    const start = performance.now();
    const ease = t => 1 - (1 - t) ** 3;
    const step = () => {
      if (root.destroyed) return Ticker.shared.remove(step);
      const t = Math.min(1, (performance.now() - start) / 380), e = ease(t);
      for (const m of moving) {
        m.node.x = m.x0 + (m.x1 - m.x0) * e;
        m.node.y = feet + (m.y0 + ((m.y1 ?? 0) - m.y0) * e);
        m.node.scale.set(m.s0 + ((m.s1 ?? 1) - m.s0) * e);
        for (const [n, a0, a1] of m.parts) if (n && a0 != null && a1 != null) n.alpha = a0 + (a1 - a0) * e;
      }
      if (t >= 1) { Ticker.shared.remove(step); if (!gone.slot.destroyed) gone.slot.visible = false; }
    };
    step();
    Ticker.shared.add(step);
    root.on('destroyed', () => Ticker.shared.remove(step));
  }
  // CF36 (1.7 creationCarousel, create.js:412-413): a god who will not take this character is marked Unavailable.
  const count = kit.text(`${at + 1} / ${gods.length}${refusal(c.god, c) ? ' · Unavailable' : ''}`, { size: 14, fill: color.ash });
  count.anchor.set(0.5, 0); count.position.set(cx, Math.max(Math.round(M.countY * ky), bigBottom + space.inRow));
  // Lit arrows, as 1.7's white ones: they are the way to browse (proof pass item 15: they read faint grey).
  const left = kit.button('‹', () => go(-1), { size: 40, font: 'body', primary: true }), right = kit.button('›', () => go(1), { size: 40, font: 'body', primary: true });
  left.position.set(cx - dx - left.width / 2, Math.round(M.arrowY * ky) - left.height / 2);
  right.position.set(cx + dx - right.width / 2, Math.round(M.arrowY * ky) - right.height / 2);
  left.label = 'god-prev'; right.label = 'god-next';
  root.addChild(count, left, right);
  return root;
}

/** A finished step's word on its chevron: 'Stone' for Stone Court, 'Chad' for Chad the Unclad (five must fit one row). */
function shortName(step, id) {
  const n = optionName(step, id);
  if (step === 'court') return n.replace(/ Court$/, '');
  if (step === 'god') return n.split(/,| the /)[0];
  return n;
}

function strip(kit, create, acts, w, h, textSize = null) {
  const c = create.choice, list = steps(c), root = new Container(), size = textSize ?? (kit.stage.kind === 'P' ? 16 : 20);
  const plateH = kit.stage.kind === 'L' && !kit.stage.short && !kit.stage.touch ? 50 : h;
  const words = list.slice(0, create.step).map((s, i) => kit.chevron(s === 'name' ? c.name : shortName(s, c[s]), () => { create.step = i; acts.redraw(); }, { size, h, plateH, start: i === 0 }));
  const last = create.step === list.length - 1;
  const confirm = kit.chevron(last ? 'Enter' : 'Confirm', () => {
    if (last) return acts.start({ ...c, name: c.name || randomName(c) });
    if (list[create.step] === 'god' && refusal(c.god, c)) { acts.cue('ui-error'); return; }
    acts.cue('ui-click'); create.step += 1;
    // The god carousel opens on a random god who takes the character, the first time it opens (1.7 create.js:656-658).
    if (list[create.step] === 'god' && !c.godDrawn) create.choice = { ...c, god: randomGod(c) ?? c.god, godDrawn: true };
    acts.redraw();
  }, { rank: 'prominent', h, plateH, size, start: words.length === 0, glow: true });
  // Chevrons nest: each tucks its notch under the point before it; a full row wraps (phones, long names).
  let x = 0, y = 0;
  for (const n of [...words, confirm]) {
    if (x > 0 && x + n.width > w) { x = 0; y += Math.max(h, kit.target) + space.inRow; n.startRow(); }
    n.position.set(x, y);
    x += n.width - n.tuck;
  }
  [...words, confirm].forEach(n => root.addChild(n));
  return root;
}

/** The last step: the hero, the name under it (tap to type), Random name beneath. */
function nameStage(kit, create, M, ky, cx, acts) {
  const c = create.choice, root = new Container(), figH = Math.round(M.figH * ky * 1.15), feet = Math.round(M.feetY * ky);
  // The god is sworn by now, so a Cleric stands in that god's outfit (1.7 creationCastLook).
  const fig = figure(lookOf(c), figH);
  if (fig) { const sh = footShadow('fade', Math.round(figH * 0.62)); sh.position.set(cx, feet - Math.round(figH * 0.04)); fig.position.set(cx, feet); root.addChild(sh, fig); }
  const fw =Math.min(M.panelW * 0.6, 260), fieldH = Math.max(kit.target, 40);
  const field = new Container();
  field.addChild(new Graphics().rect(0, 0, fw, fieldH).fill({ color: 0, alpha: 0.001 }));
  field.position.set(Math.round(cx - fw / 2), feet + space.betweenRows);
  const shown = kit.text(c.name || 'Type a name', { size: 20, font: 'display', fill: c.name ? kit.accent : color.rest });
  shown.anchor.set(0.5); shown.position.set(fw / 2, fieldH / 2);
  field.addChild(shown);
  // 1.7's input line under the name, so it reads as a field (proof pass item 16).
  field.addChild(new Graphics().rect(Math.round(fw * 0.12), fieldH - 3, Math.round(fw * 0.76), 1).fill({ color: color.rest, alpha: 0.7 }));
  field.label = 'name-field';
  root.addChild(field);
  kit.control(field, () => {
    const g = field.getGlobalPosition(), st = kit.stage;
    const at = { x: (g.x - st.ox) / st.s, y: (g.y - st.oy) / st.s, w: fw, h: fieldH };
    // A name the player did not type (a random one) clears on the tap, so typing replaces it (proof pass item 16: the
    // tour got 'MallowTess').
    editText(st, at, c.named ? c.name : '', { onInput: v => { c.name = v; shown.text = v + '|'; }, onDone: v => { create.choice = { ...c, name: v, named: !!v.trim() }; acts.redraw(); } });
    shown.text = (c.named ? c.name : '') + '|';
  });
  const roll = kit.button('Random name', () => { acts.cue('ui-click'); create.choice = { ...c, name: randomName(c), named: false }; acts.redraw(); }, { size: 16, font: 'body' });
  roll.position.set(Math.round(cx - roll.width / 2), field.y + fieldH);
  root.addChild(roll);
  if (create.rolled && kit.stage.kind === 'P') {
    const said = rollLine(kit, create.rolled, kit.stage.w - 32);
    said.position.set(Math.round(cx - said.width / 2), roll.y + roll.height);
    root.addChild(said);
  }
  return root;
}

/** CH-35: the random character's brass result line (1.7 #creationRollResult: 16 px mono, journal brass). */
function rollLine(kit, words, room) {
  const said = kit.text(words, { size: 16, font: 'mono', fill: 0xe3bb6a, shadow: 'halo' });
  if (said.width > room) said.scale.set(room / said.width);
  said.label = 'roll-result';
  return said;
}

/**
 * The stage darkens at the top and a little at the foot: #080604 at 25% fading out by 35% of the way down, then rising
 * to 30% at the foot (1.7's CSS-22 rose to 72%; Justin 2026-10-20: "brighten the bottom so the camp and pool read").
 * Drawn once and stretched over the whole screen.
 */
let hallShadeTex = null;
function hallShade(kit) {
  const st = kit.stage, x0 = -st.ox / st.s, y0 = -st.oy / st.s;
  if (!hallShadeTex) {
    const H = 256, cv = Object.assign(document.createElement('canvas'), { width: 4, height: H }), g = cv.getContext('2d');
    const lg = g.createLinearGradient(0, 0, 0, H);
    lg.addColorStop(0, 'rgba(8,6,4,0.25)'); lg.addColorStop(0.35, 'rgba(8,6,4,0)'); lg.addColorStop(1, 'rgba(8,6,4,0.3)');
    g.fillStyle = lg; g.fillRect(0, 0, 4, H);
    hallShadeTex = Texture.from({ resource: cv, scaleMode: 'linear' });
  }
  const s = new Sprite(hallShadeTex);
  s.position.set(x0, y0); s.width = st.w - x0 * 2; s.height = st.h - y0 * 2; s.eventMode = 'none';
  return s;
}

/**
 * @param {ReturnType<import('../core/widgets.js').createKit>} kit
 * @param {{choice:any, step:number}} create
 * @param {{back:()=>void, redraw:()=>void, cue:(n:string)=>void, start:(c:any)=>void}} acts
 */
export function buildCreation(kit, create, acts) {
  const st = kit.stage, P = st.kind === 'P', root = new Container(), ky = st.h / LAYOUT[st.kind].refH;
  // A phone held sideways: a narrower panel and smaller names, so the line-up keeps its room (Justin 10-16).
  const M = st.short ? { ...LAYOUT.L, margin: 30, panelW: 400, nameSize: 16, frame: 24 } : LAYOUT[st.kind];
  const c = create.choice, step = steps(c)[create.step];
  whenLoaded('assets/sheets/map-icons.json', acts.redraw);
  const box = { x: -st.ox / st.s, y: -st.oy / st.s, w: st.w + (2 * st.ox) / st.s, h: st.h + (2 * st.oy) / st.s };
  root.addChild(new Graphics().rect(box.x, box.y, box.w, box.h).fill(color.bg));
  const Y = v => Math.round(v * ky);

  // A tablet held upright draws the chrome at 1.7's tablet size: the plates, the banner and the chevrons were about 0.7
  // of 1.7's (proof pass item 14; sandbox lead's ruling 10-17).
  const T = P && st.form === 'tablet' ? 1.4 : 1;
  const plate = (words, fn, o = {}) => kit.plateButton(words, fn, { h: Math.round(M.topH * T), size: P ? (T > 1 ? 20 : 16) : 20, ...o });
  const back = plate('Back to title', acts.back);
  const rand = plate('Random character', () => {
    const r = { ...randomChoice(), tutorial: c.tutorial };
    create.choice = r; create.step = steps(r).length - 1;
    // CH-35 (1.7 create.js:632, journal-menus.css:17-21): a brass line names what was rolled.
    create.rolled = `${r.name}: ${optionName('race', r.race)} ${optionName('cls', r.cls)}${r.race === 'fae' && r.court ? ` · ${optionName('court', r.court)}` : ''}${r.cls === 'cleric' && r.god ? ` of ${optionName('god', r.god).split(/,| the /)[0]}` : ''}`;
    create.rolledFor = JSON.stringify(r);
    acts.redraw();
  });
  // The line stands until a choice changes (1.7 clears it on a reroll); it shows on the step the roll lands on.
  if (create.rolled && create.rolledFor !== JSON.stringify(c)) create.rolled = null;
  back.position.set(M.margin, Y(M.topY));
  rand.position.set(st.w - M.margin - rand.width, Y(M.topY));
  const headW = Math.min(Math.round(M.headW * T), st.w - M.margin * 2);
  // Each step's banner says what is being chosen (Justin 2026-10-16, item 48; 1.7's step labels).
  const head = plaque(kit, headW, STEP_TITLE[step] ?? 'Choose your adventurer', P ? (T > 1 ? 26 : 20) : 26, 'bar');
  head.position.set(Math.round((st.w - headW) / 2), Y(M.headY));
  root.addChild(head, back, rand);
  // Under the Random character plate, its right edge on the plate's (a phone has it under Random name: nameStage).
  if (create.rolled && step === 'name' && !P) {
    const said = rollLine(kit, create.rolled, st.w - M.margin * 2);
    said.position.set(Math.round(rand.x + rand.width - said.width), rand.y + rand.height + space.inRow);
    root.addChild(said);
  }

  const panelW = P ? st.w - 20 : M.panelW, frameW = M.frame, inset = sixGemInset(frameW) + (P || st.short ? space.betweenRows : space.betweenSections);
  const panelX = P ? 10 : st.w - M.margin - panelW;
  const cx = P ? Math.round(st.w / 2) : Math.round((M.margin + panelX) / 2);
  const leftW = P ? st.w - M.margin * 2 : panelX - M.margin * 2;

  const short = st.short;
  // On a laptop or tablet the chevrons run the full width above the panel (Justin 10-16), so all five fit with Enter.
  // Bigger chevrons on a laptop or PC, where they have the full width (Justin 10-16, round 4).
  const bar = strip(kit, create, acts, P || short ? leftW : st.w - M.margin * 2, P || short ? Math.round(M.chevH * T) : 58, P && T > 1 ? 20 : P || short ? null : 26);
  bar.position.set(P || short ? Math.max(M.margin, Math.round(cx - bar.width / 2)) : M.margin, Y(M.chevY));
  const chevBottom = bar.y + bar.height;

  let panelBody = creationPanel(kit, c, step, panelW - inset * 2, P && st.form === 'phone' && step === 'cls');
  // A phone's panel grows upward to hold its words at full size (Justin 10-16: 1.7's summary, not shrunk text), keeping
  // room above it for a figure, its name and what sits under it.
  const below = step === 'race' ? M.sexH + space.betweenRows : step === 'cls' ? 70 : step === 'name' ? 96 : 0;
  // Only the one-figure steps (class, name) give room to the panel; a line-up keeps its height.
  // It always leaves the hero at least 60% of the line-up's height above what sits under it (the name step on a phone,
  // with five chevrons wrapping, used to leave no room at all and the hero vanished).
  const minTop = step === 'cls' || step === 'name' ? chevBottom + kit.size(20) * 1.4 + below + 16 + Math.round(M.figH * ky * 0.6 * 1.15) : Y(M.panelY);
  // Still too long at full size (a small phone): names on the face, their lines in tap cards (Justin 10-16: "make sure it
  // isn't too much to fit in the windows on mobile").
  // A sideways phone too (proof pass item 2): 1.7 kept the text full size with compact entries there.
  if (panelBody.height + inset * 2 > Y(M.panelBottom) - (P ? minTop : short ? Y(M.panelY) : Math.max(Y(M.panelY), chevBottom + space.betweenSections))) { panelBody.destroy({ children: true }); panelBody = creationPanel(kit, c, step, panelW - inset * 2, true); }
  // The hero's room is a floor the panel never climbs past (proof pass item 1: at 360x640 the old min() let the panel
  // take it, and the hero shrank to 20 px); a panel never starts lower than 140 above the foot.
  const phoneTop = () => Math.min(Y(M.panelBottom) - 140, Math.max(minTop, Math.min(Y(M.panelY), Y(M.panelBottom) - panelBody.height - inset * 2)));
  const panelY = P ? phoneTop() : short ? Y(M.panelY) : Math.max(Y(M.panelY), chevBottom + space.betweenSections), room = Y(M.panelBottom) - panelY;
  const panelH = Math.min(room, Math.max(P ? 0 : Math.round(room * 0.45), panelBody.height + inset * 2));
  // Still too long: it scrolls at full size, as 1.7's ('More below'), never shrunk to fit (proof pass items 1 and 2).
  if (panelBody.height > panelH - inset * 2 + 1) panelBody = scrollable(panelBody, { w: panelW - inset * 2, h: panelH - inset * 2 });
  let py;
  if (P) py = Y(M.panelBottom) - panelH;   // a phone keeps the panel at the foot, the figures spread over the room above
  else { const mid = Y((M.chevY + M.feetY) / 2 + 30); py = Math.max(panelY, Math.min(Y(M.panelBottom) - panelH, Math.round(mid - panelH / 2))); }

  // On a phone the line-up (figures, names, and the sex plates on the race step) centres in the room between the
  // chevrons and the panel (Justin 10-16: "lots of crowding vertically on phones").
  let L = M;
  if (P) {
    const grow = step === 'name' || step === 'cls' ? 1.15 : 1, nameH = kit.size(20) * 1.4;
    const under = nameH + below;
    // A small phone shrinks the figures to the room left, rather than letting the panel cover what lies under them.
    // A tablet's line-up at 1.7's tablet size too (proof pass 14), as far as the room allows.
    const figBase = Math.min(Math.round(M.figH * ky * T), Math.floor((py - chevBottom - under - 16) / grow));
    const figH = figBase * grow, block = figH + under;
    const feet = Math.round(chevBottom + Math.max(8, (py - chevBottom - block) / 2) + figH);
    L = { ...M, figH: figBase / ky, nameSize: T > 1 ? 20 : M.nameSize, godH: Math.min(M.godH * T, figBase * 1.2 / ky), feetY: feet / ky, sexY: (feet + nameH + space.inRow) / ky, countY: (feet + nameH) / ky, arrowY: (feet - figH / 2) / ky };
  }
  // The figures first, so the chevrons stay on top of them when a narrow screen wraps the strip.
  // Item 228: the paintings this step shows are asked for together and drawn once all are in; till then a quiet word
  // stands where the figures will.
  const shown = step === 'god' ? [] : step === 'name' ? [lookOf(c)] : step === 'cls' ? [lookOf({ ...c, god: null })] : options(step).map(id => lookFor(c, step, id));
  const figuresIn = paintingsIn(shown, acts.redraw, step === 'race' || step === 'court' ? lookOf({ ...c, god: null }) : null);
  const line = step === 'name' ? nameStage(kit, create, L, ky, cx, acts) : lineup(kit, create, L, ky, cx, leftW, acts);
  root.addChild(line);
  // The stage the figures stand in (creation-stage.js): what lies behind their feet under them, what lies nearer over.
  const stage = buildStage(kit, box, Math.round(L.feetY * ky), acts.redraw, P ? { portrait: { uc: 7, sb: 0.062, sf: 0.16, yb: 0.29, yf: 0.64 } } : {});
  root.addChildAt(stage.behind, 1);
  root.addChildAt(hallShade(kit), 2);
  if (stage.life) root.addChildAt(hallLife(kit, stage.life), 3);
  // What lies nearer stands over the line-up's figures but under their names; on the later steps (class icons, the
  // name field, the statues' arrows) under the whole line, so nothing there is ever hidden.
  if (step === 'race' || step === 'court') {
    root.addChildAt(stage.front, root.getChildIndex(line) + 1);
    const names = new Container();
    for (const slot of line.children.filter(n => n.label?.startsWith('pick-'))) {
      const t = slot.children.at(-1); t.position.set(slot.x + t.x, slot.y + t.y); names.addChild(t);
    }
    root.addChildAt(names, root.getChildIndex(stage.front) + 1);
  } else root.addChildAt(stage.front, root.getChildIndex(line));
  // The sunbeam on the picked figure (race, court), or on the one hero or statue the later steps show.
  const slot = (step === 'race' || step === 'court') && line.children.find(n => n.label === 'pick-' + c[step]);
  const beamAt = slot ? { x: slot.x + slot.children[0].width / 2, feet: slot.y + Math.round(L.figH * ky), h: Math.round(L.figH * ky), w: slot.children[0].width }
    : step === 'god' ? { x: cx, feet: Math.round((L.feetY + 10) * ky), h: Math.round(L.godH * ky), w: Math.round(L.godH * ky * 0.6) }
      : { x: cx, feet: Math.round(L.feetY * ky), h: Math.round(L.figH * ky * 1.15), w: Math.round(L.figH * ky * 0.7) };
  // A new target starts a glide from wherever the beam stands now; a redraw toward the same target carries it on.
  const b = create.beam;
  if (!b || b.x !== beamAt.x) create.beam = { x: beamAt.x, from: b ? beamNow(b, b.x) : null, start: performance.now() };
  if (figuresIn || step === 'god') root.addChildAt(sunbeam(kit, create.beam, beamAt.x, beamAt.feet, beamAt.h, beamAt.w, step === 'court' ? courtColour(c.court) : undefined), root.getChildIndex(line));
  if (step !== 'god' && !figuresIn) {
    const wait = kit.text('Loading…', { size: L.nameSize, font: 'display', fill: color.dim, shadow: 'halo' });
    wait.anchor.set(0.5); wait.position.set(cx, Math.round((L.feetY - L.figH / 2) * ky)); wait.label = 'figures-loading';
    root.addChild(wait);
  }
  root.addChild(bar);

  // Justin 2026-10-20: "the buttons fem / masc and tutorial need to make it clearer which is selected". A picked plate
  // stands lit with its words in the highlight and a ring round it; an unpicked one sits dark with dim words.
  const picked = on => on ? { rank: 'prominent', tone: { rest: 1.35, hover: 1.35 }, ink: kit.accent } : { tone: { rest: 0.55, hover: 1 }, ink: color.dim };
  const ring = (node, on) => {
    if (!on) return node;
    const w = node.width, h = node.height, r = new Graphics().roundRect(-3, -3, w + 6, h + 6, 6).stroke({ color: kit.accent, width: 2 });
    r.label = 'picked'; r.eventMode = 'none';
    node.addChild(r);
    return node;
  };
  const tut = ring(plate(`Tutorial ${c.tutorial ? 'on' : 'off'}`, () => { create.choice = { ...c, tutorial: !c.tutorial }; acts.redraw(); }, picked(c.tutorial)), c.tutorial);
  tut.position.set(M.margin, Math.min(Y(M.tutY), st.h - tut.height - Math.max(0, (kit.target - tut.height) / 2)));
  root.addChild(tut);

  if (step === 'race') {
    const sexes = [['m', 'Masculine'], ['f', 'Feminine']].map(([k, words]) => ring(plate(words, () => { acts.cue('ui-click'); create.choice = pickSex(c, k); acts.redraw(); }, { h: M.sexH, size: 14, w: M.sexW, ...picked(c.sex === k) }), c.sex === k));
    const total = sexes[0].width + sexes[1].width + space.betweenSections;
    sexes[0].position.set(Math.round(cx - total / 2), Y(L.sexY));
    sexes[1].position.set(sexes[0].x + sexes[0].width + space.betweenSections, Y(L.sexY));
    root.addChild(...sexes);
  }

  const panel = new Container();
  panel.label = 'creation-panel';
  panel.addChild(sixGemFrame(panelW, panelH, frameW));
  panelBody.position.set(inset, inset);
  panel.addChild(panelBody);
  panel.position.set(panelX, py);
  root.addChild(panel);
  return root;
}
