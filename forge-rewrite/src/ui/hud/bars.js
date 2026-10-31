// The readouts beside the portrait, as 1.7 draws them: HP and Mana in their gradients on a dark track with a
// bronze edge, the shields (Guard, Ice Armor, wards) as blue stripes on HP's end, the thin gold XP line under them
// (opens Character), the piety line in the god's colour under that when sworn (no words; opens Faith), then hunger
// ("Full" and its meter, opens Inventory) and the chips: favor ('\u2726 n') and essence with keys. Motes live in the
// Inventory, not here (1.7 responsive-hud.css:948). The bars start under the portrait; their words start past it.

import { Container, Graphics } from '../../../../forge-godot/runtime/pixi.js';
import { hungerView, xpView, pietyView, walletView, shieldsOf } from '../model/hud-model.js';
import { tone, words, gradient } from '../core/look.js';
import { toNum } from '../core/colour.js';

// [word ink, meter fill]: 1.7 responsive-hud.css:954-956 and responsive-hud.js:463 (CH-28).
const HUNGER_TONE = { Full: [tone.full, tone.fullFill], Hungry: [tone.hungryInk, tone.hungry], Starving: [tone.starvingInk, tone.starving] };

/** Details for a readout with a mouse only (a tap on a readout opens its window instead). */
export function hoverCard(kit, node, detail) {
  node.eventMode = 'static';
  node.on('pointerover', e => { if (e.pointerType === 'mouse') kit.hooks.show?.(node, typeof detail === 'function' ? detail() : detail); });
  node.on('pointerout', () => kit.hooks.hide?.(node));
  // A tap on a readout must not walk the hero toward the map tile under it.
  node.on('pointertap', e => e.stopPropagation());
  return node;
}

/** A tappable readout: a tap, a click or the confirm key opens its window. */
function tappable(kit, node, act, label) {
  node.label = label;
  // Measured at the tap, since a readout is filled after it is made; a little margin round a thin bar.
  node.hitArea = { contains: (x, y) => { const b = node.getLocalBounds(), grow = 6; return x >= b.x && x <= b.x + b.width && y >= b.y - grow && y <= b.y + b.height + grow; } };
  return kit.control(node, act);
}

/**
 * One 1.7 bar: dark track, gradient fill, name and numbers. With o.shield, 1.7's shield (ui.js bars()): striped
 * points straight after the HP fill, the fill giving up room when HP and shield pass the bar, the number "+N" after HP's.
 * `inset`: where the words start (past the portrait that covers the bar's left end).
 */
function meter(kit, w, h, fill, o = {}) {
  const c = new Container(), g = new Graphics(), stripes = new Graphics(), clip = new Graphics();
  const px = o.px ?? 13.33;
  const left = o.name ? words(kit, o.name, px, { fill: tone.barLabel }) : null;
  const right = o.numbers === false ? null : words(kit, '', px, { fill: tone.barNumber, weight: '600' });
  stripes.mask = clip;
  c.addChild(g, stripes, clip, ...[left, right].filter(Boolean));
  if (left) { left.anchor.set(0, 0.5); left.position.set(o.inset ?? 8, h / 2); }
  const rightAt = o.insetRight ?? 6;
  if (right) right.anchor.set(1, 0.5);
  c.set = (now, max, shield = 0, text = null) => {
    const m = Math.max(1, max), sh = o.shield ? Math.max(0, shield) : 0;
    let frac = Math.max(0, Math.min(1, now / m)), shFrac = Math.min(1 - frac, sh / m);
    if (sh > 0 && frac + sh / m > 1) { frac = Math.max(0, now / (now + sh)); shFrac = 1 - frac; }
    g.clear().rect(0, 0, w, h).fill(tone.track);
    const fw = Math.round(w * frac);
    if (fw > 0) {
      g.rect(0, 0, fw, h).fill(typeof fill === 'function' ? fill() : fill);
      if (o.shine) g.rect(0, 0, fw, 1).fill({ color: o.shine, alpha: 0.22 });
    }
    stripes.clear(); clip.clear();
    const sw = sh > 0 ? Math.round(w * shFrac) : 0;
    if (sw > 0) {
      // 1.7: repeating-linear-gradient(135deg, light 0 4px, dark 4px 8px), so each band is 4 px across, 4 * sqrt 2 along the bar.
      const b = 4 * Math.SQRT2;
      for (let x = fw - h - 2 * b; x < fw + sw + h; x += 2 * b) {
        stripes.poly([x, h, x + h, 0, x + h + b, 0, x + b, h]).fill({ color: tone.shieldA, alpha: 0.85 });
        stripes.poly([x + b, h, x + h + b, 0, x + h + 2 * b, 0, x + 2 * b, h]).fill({ color: tone.shieldB, alpha: 0.85 });
      }
      clip.rect(fw, 0, sw, h).fill(0xffffff);
    }
    if (right) { right.text = text ?? `${Math.round(now)}/${max}${sh > 0 ? ` +${Math.round(sh)}` : ''}`; right.position.set(w - rightAt, h / 2); }
  };
  return c;
}

/**
 * @param {ReturnType<import('../core/widgets.js').createKit>} kit
 * @param {typeof import('../core/look.js').geo.L} G 1.7's geometry for this stage
 * @param {number} inset where words start inside the bars (the portrait covers the left end)
 * @param {{open:(name:string)=>void}} acts
 * @param {number} chipsW the room the chips have from where they start; a chip that would pass it starts a new line
 * @param {{mirror?:boolean}} [look] mirror: the portrait covers the bars' right end (Options Status position Right), so
 *   the words keep clear of that end instead (1.7 study-pad-right #bars .bar span padding)
 */
export function buildBars(kit, G, inset, acts, chipsW = Infinity, look = {}) {
  const root = new Container(), w = G.barW, mirror = !!look.mirror;
  const ins = mirror ? { inset: 6, insetRight: inset } : { inset };
  const hp = meter(kit, w, G.hpH, gradient(tone.hpTop, tone.hpBottom), { name: 'HP', shield: true, px: G.barText, ...ins, shine: 0xda8974 });
  const mana = meter(kit, w, G.manaH, gradient(tone.manaTop, tone.manaBottom), { name: 'Mana', px: G.barText, ...ins, shine: 0xa0ccdd });
  const xp = meter(kit, w, G.xpH, tone.xp, { numbers: false });
  let pietyFill = tone.gold;
  // CH-22: 1.7's #studyPietyBar, a progress line as tall as XP's straight under it, its words hidden (responsive-hud.css:925, 1004).
  const pietyBar = meter(kit, w, G.xpH, () => pietyFill, { numbers: false });
  hp.label = 'hud-hp'; mana.label = 'hud-mana';
  // 1.7's bronze edge round the HP, Mana and XP block, rounded on the right.
  const edge = new Graphics();
  edge.eventMode = 'none';
  root.addChild(hp, mana, xp, pietyBar, edge);
  mana.y = G.hpH;
  xp.y = mana.y + G.manaH;
  pietyBar.y = xp.y + G.xpH;

  let view = null;
  // 1.7 ui.js hp card: HP, the shield's total, then its sources.
  hoverCard(kit, hp, () => { const sh = shieldsOf(view.p); return { title: 'Health', rows: [['HP', `${view.p.hp} / ${view.p.maxhp}`], ...(sh.total ? [['Shield', sh.total]] : [])], lines: sh.total ? [sh.parts.map(p => p.words ?? `${p.name} ${p.n}`).join(', ') + '. Shields absorb damage before HP.'] : [] }; });
  hoverCard(kit, mana, () => ({ title: 'Mana', rows: [['Mana', `${view.p.mana} / ${view.p.maxmana}`]] }));
  tappable(kit, xp, () => acts.open('Character'), 'hud-xp');
  // H32 (1.7 ui.js:297-336 hudResourceCard): each readout's card names it, gives its numbers and says what it is for.
  hoverCard(kit, xp, () => {
    const x = xpView(view.h);
    return { title: 'Experience', rows: [['Level', x.level], ['XP', x.next ? `${x.xp} / ${x.next}` : x.xp]],
      lines: [x.next ? `${Math.max(0, x.next - x.xp)} XP to the next level.` : 'Maximum level reached. Further XP still counts toward your run total.'] };
  });
  tappable(kit, pietyBar, () => acts.open('Faith'), 'hud-piety');
  hoverCard(kit, pietyBar, () => {
    const f = pietyView(view.h.faith);
    return { title: 'Piety', sub: f.name, rows: [['God rank', `${f.rank} / ${f.top}`], ['Piety', f.next ? `${f.piety} / ${f.next}` : f.piety]],
      lines: [f.next ? `${Math.max(0, f.next - f.piety)} more piety to reach rank ${f.rank + 1}.` : 'Maximum god rank reached.'] };
  });

  // Hunger: "Full" in green and a thin meter, from the portrait's edge toward the bars' end (1.7).
  const hunger = new Container();
  const hWord = words(kit, 'Full', G.hunger, { fill: tone.full });
  const hTrack = new Graphics();
  hunger.addChild(hWord, hTrack);
  root.addChild(hunger);
  tappable(kit, hunger, () => acts.open('Inventory'), 'hud-hunger');
  hoverCard(kit, hunger, () => { const v = hungerView(view.h.hunger); return { title: `Hunger: ${v.word}`, rows: [['Hunger', `${v.now} / ${v.max}`]], lines: ['Eat food from your bag to restore hunger.'] }; });

  // Chips under hunger: favor, then essence and keys (1.7 #hud2 in the joined HUD). Each opens its window.
  const chips = new Container();
  root.addChild(chips);
  // The thin XP bar sits over hunger's margin, so a tap on it is the XP bar's.
  root.addChild(xp);
  const num = n => words(kit, String(n), G.stock, { fill: tone.stock });
  function chip(parts, act, label, detail) {
    const c = new Container(), gaps = parts.map(p => p.x);
    c.addChild(...parts);
    c.layout = () => {
      let x = 0;
      const h = Math.max(...parts.filter(p => p.visible).map(p => p.height));
      parts.forEach((p, i) => { if (p.visible) { x += gaps[i]; p.position.set(x, Math.round((h - p.height) / 2)); x += p.width + 3; } });
    };
    tappable(kit, c, act, label);
    hoverCard(kit, c, detail);
    return c;
  }
  const mark = G.stock * 0.62;
  const diamond = fill => new Graphics().poly([mark / 2, 0, mark, mark / 2, mark / 2, mark, 0, mark / 2]).fill(fill);
  const essence = num(0), keys = num(0), key = words(kit, '\u{1F5DD}', G.stock + 1, { fill: tone.stock, font: 'body' });
  key.x = 4;
  const stock = chip([diamond(tone.stock), essence, key, keys], () => acts.open('Inventory'), 'hud-essence', () => {
    const wl = walletView(view.h);
    return { title: 'Essence & keys', rows: [['Essence', wl.essence], ['Keys', wl.keys]],
      lines: ['Essence pays for crafting and upgrades at a forge. Keys open locked doors on the floor where you find them.'] };
  });
  chips.addChild(stock);
  let favor = null, favorWords = null, chipKey = '';

  function drawChips() {
    const wl = walletView(view.h), f = pietyView(view.h.faith);
    // Geometry and text settings belong to this HUD build; only these values change its chip layout.
    const next = JSON.stringify([wl.essence, wl.keys, f?.god, f?.favor, f?.colour]);
    if (next === chipKey) return;
    chipKey = next;
    // CH-24: favor reads '\u2726 n' (1.7 responsive-hud.js:499); the rank is on the portrait. Item 184 (Justin 2026-10-19: "favor
    // needs to be visually distinct from essense via color ... the same font size"): in the god's colour, as the piety line
    // and the Faith window draw it, at the essence chip's size.
    if (f && !favor) {
      favorWords = words(kit, '', G.stock);
      favor = chip([favorWords], () => acts.open('Faith'), 'hud-faith-chip', () => {
        const now = pietyView(view.h.faith);
        return { title: 'Favor', rows: [['Favor', `${now.favor} / ${now.favorCap}`]], lines: ['Spent on divine abilities that cost Favor. It is earned alongside piety.'] };
      });
      chips.addChildAt(favor, 0);
    }
    if (favor) favor.visible = !!f;
    if (f) { favorWords.text = `\u2726 ${f.favor}`; favorWords.style.fill = toNum(f.colour); }
    essence.text = String(wl.essence);
    // CH-27: keys as 1.7's key glyph at 13 px and the count (responsive-hud.js:508, css:55).
    key.visible = keys.visible = !!wl.keys;
    keys.text = String(wl.keys);
    // A narrow screen wraps a chip that would pass the room, never runs it off.
    let x = 3, y = 0;
    for (const c of chips.children) {
      if (!c.visible) continue;
      c.layout();
      if (x > 3 && x + c.width > chipsW) { x = 3; y += c.height + 2; }
      c.position.set(x, y); x += c.width + 12;
    }
  }

  return {
    root,
    /** RB28: HP and Mana as each blow, heal or cast plays (1.7 updateTurnUI at each pause); set() puts the turn's end. */
    vitals(now, mp) {
      if (!view?.p) return;
      hp.set(Math.max(0, Math.min(view.p.maxhp, now)), view.p.maxhp, shieldsOf(view.p).total);
      mana.set(Math.max(0, Math.min(view.p.maxmana ?? 0, mp)), view.p.maxmana);
    },
    /** @param {any} state */
    set(state) {
      const p = state.actors[state.playerId], h = state.hero ?? {};
      view = { p, h };
      hp.set(p.hp, p.maxhp, shieldsOf(p).total);   // Guard, Ice Armor and wards as one striped end (1.7 playerShield)
      mana.set(p.mana, p.maxmana);
      const x = xpView(h);
      xp.set(x.next ? x.xp : 1, x.next ?? 1);
      const f = pietyView(h.faith);
      pietyBar.visible = !!f;
      if (f) { pietyFill = toNum(f.colour); pietyBar.set(f.next ? f.frac : 1, 1); }
      const bottom = f ? pietyBar.y + G.xpH : xp.y + G.xpH;
      edge.clear().roundRect(-0.5, -0.5, w + 1, bottom + 1, 3).stroke({ color: tone.bronze, width: 1 });
      const v = hungerView(h.hunger), [ink, fillTone] = HUNGER_TONE[v.word];
      hWord.text = v.word; hWord.style.fill = ink;
      hunger.x = mirror ? 0 : inset - 1;
      hunger.y = bottom + 3;
      // 1.7: the meter runs to the bars' end (the portrait's edge when mirrored), in a faint bronze line.
      const trackX = hWord.width + 5, trackW = w - (mirror ? inset : 0) - hunger.x - trackX;
      hTrack.clear().rect(trackX, 0, trackW, 5).fill({ color: tone.track, alpha: 0.9 }).rect(trackX, 0, Math.round(trackW * v.frac), 5).fill(fillTone)
        .rect(trackX - 0.5, -0.5, trackW + 1, 6).stroke({ color: tone.bronze, width: 1, alpha: 0.7 });
      hTrack.y = Math.round(hWord.height / 2 + 1);
      drawChips();
      chips.x = mirror ? 0 : inset - 1;
      chips.y = hunger.y + hWord.height + 1;
    },
  };
}
