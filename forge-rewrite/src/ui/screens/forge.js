import { Container, Graphics } from '../../../../forge-godot/runtime/pixi.js';
import { color, space, AFFINITY_HIGHLIGHT } from '../core/widgets.js';
import { tone } from '../core/colour.js';
import uiData from '../../../data/ui.json' with { type: 'json' };
import { stack, row, grid, flow } from '../core/layout.js';
import { none } from '../core/blocks.js';
import { icon, enchantDot } from '../core/icons.js';
import { plate } from '../core/plates.js';
import { forgeView } from '../model/forge-view.js';
import { titleCase } from '../model/hero-view.js';
import { affinityWords, enchantSentence } from '../model/preview-words.js';
import { itemView } from '../model/item-view.js';
import { say } from '../model/words.js';
import sigils from '../../../data/sigils.json' with { type: 'json' };
import strings from '../../../data/strings.json' with { type: 'json' };
import races from '../../../data/races.json' with { type: 'json' };
import upgrades from '../../../data/upgrades.json' with { type: 'json' };
const TABS = ['Fuse', 'Enchant', 'Upgrade', 'Craft', 'Recycle'];
const BARRED = tone('bad');   // 1.7's refusal red (gear-cards.js #D0605A)
export const ELEMENT_COLOUR = AFFINITY_HIGHLIGHT;   // 1.7 --aff-hi (ui.json elementPalettes.highlight)
/** Why a Fuse is refused, in 1.7's words (js/engine/forge-adapter.js:66-77). */
const WHY = { forbidden: 'Your god forbids this element.', 'no-mote': 'You have no mote of this element.', 'at-cap': 'Affinity cap reached. Pick up a boss core to raise it.',
  'at-max': 'This element is mastered.', 'third-element': 'You already hold two elements.', opposite: 'This is the opposite of an element you hold.', 'passes-primary': 'Your secondary element can never outgrow your primary.' };
export const pick = { tab: 'Fuse', fuse: null, enchantEl: 'fire', enchantSlot: null };
export const forgeFresh = () => { pick.tab = 'Fuse'; }, forgeNewRun = () => { Object.assign(pick, { tab: 'Fuse', fuse: null, enchantEl: 'fire', enchantSlot: null }); said = null; };   // ui-23, as 1.7 openForge: opens on Fuse; picks last the run
/** EQ22 (1.7 forge.js:78-85 forgeTabTip): what each tab does, on hover or a tap of its plate. */
function tabTip(t, hero) {
  const dwarf = (races.rows[hero?.race]?.passive ?? []).find(e => e.verb === 'cost-mod' && e.cost === 'upgrade-essence');
  return {
    Fuse: 'Burn a mote into yourself for a point of affinity. It is permanent. You can hold two elements at most, never opposites; the second can never outgrow the first.',
    Enchant: 'Choose a mote, then the gear to set it into. Most enchantments grow stronger with your affinity in their element.',
    Upgrade: `Spend essence to strengthen gear you wear, up to +${upgrades.rows['gear-costs'].maxPlus + (hero?.faith?.god === 'anvil' && (hero.faith.rank ?? 0) >= 5 ? 1 : 0)}. Fine gear costs twice as much and Masterwork four times as much. Upgrading a cursed item breaks the curse.${dwarf ? ` Dwarven smithing: ${Math.round((1 - dwarf.mult) * 100)}% cheaper.` : ''}`,
    Craft: 'Carve motes into sigils. Crafted sigils are always identified. Each recipe lists its essence and mote cost.',
    Recycle: 'Break gear you carry down into essence. Better and upgraded gear gives more. Unidentified gear is fine.',
  }[t];
}
const SAID_MS = uiData.timing.forgeReceiptMs;
let said = null, saidTimer = 0;
/** The receipt for one game event, or null: 1.7's words. */
export function forgeReceipt(ev, game) {
  const h = game?.hero;
  if (!ev || !h) return null;
  const nameOf = it => (it ? itemView(it, game)?.name : null) ?? 'gear';
  if (ev.type === 'fused') return `The ${titleCase(ev.element)} mote takes root in you: affinity ${ev.affinity}.`;
  if (ev.type === 'enchanted') return `Your ${nameOf(h.worn?.[ev.slot])} takes the ${titleCase(ev.element)} enchantment.`;
  if (ev.type === 'carved') { const r = sigils.rows[ev.id]; return r ? `Carved: ${r.name}. ${strings.rows[r.text] ?? ''}`.trim() : null; }
  if (ev.type === 'hero' && ev.change === 'upgrade' && ev.slot) return ev.cleansed ? `The Forge burns the curse out of your ${nameOf(h.worn?.[ev.slot])}.` : `The Forge hammers your ${nameOf(h.worn?.[ev.slot])} stronger.`;
  if (ev.type === 'recycled') return `Recycled ${ev.count === 1 ? 'one piece' : `${ev.count} pieces`} for ${ev.essence} essence.`;
  return null;
}
/** Shows a receipt at the top of the Forge's window from now. */
export function forgeSay(words, now = Date.now()) { said = words ? { words, until: now + SAID_MS } : null; }
export const forgeSaying = (now = Date.now()) => !!said && now < said.until;
/** 1.7 at 1280x800, in logical px. P keeps the same parts, smaller. */
const M = { L: { mote: 26, motePitch: 56, tabW: 95, tabH: 36, tabGap: 19, fuseH: 50, gap: 10, moteTile: 62, itemH: 70, itemW: 228, craftH: 44 },
  P: { mote: 24, motePitch: 0, tabW: 0, tabH: 34, tabGap: 4, fuseH: 46, gap: 8, moteTile: 48, itemH: 60, itemW: 0, craftH: 44 } };
/** The strip every forge tab shares: each mote's art over its count, then primary, cap and essence. */
export function moteStrip(kit, v, w = 9999) {
  const m = M[kit.stage.kind], P = kit.stage.kind === 'P';
  const motes = v.motes.map(x => {
    const c = new Container(), pic = icon('mote-' + x.el, m.mote), n = kit.text(String(x.n), { size: 14, fill: color.ink, weight: '600' });
    if (pic) { pic.x += 4; c.addChild(pic); }
    n.anchor.set(0.5, 0); n.position.set(m.mote / 2 + 4, m.mote);
    c.addChild(n);
    if (!x.n) c.alpha = 0.5;
    return kit.details(c, { title: named(x.el, '', ' motes'), rows: [['Held', x.n]] });
  });
  const strip = new Container();
  motes.forEach((c, i) => { c.x = i * (P ? 0 : m.motePitch); strip.addChild(c); });
  if (P) flow(motes, 9999, 14, 0);
  const held = v.held?.length ? v.held : v.primary ? [{ el: v.primary, n: v.primaryLevel, primary: true }] : [];
  const aff = held.length ? row(held.map(x => kit.text(`${titleCase(x.el)} ${x.n}${x.primary ? ' (primary)' : ''}`, { size: 14, fill: ELEMENT_COLOUR[x.el] })), space.betweenRows)
    : kit.text('No element yet', { size: 14, fill: color.dim });
  const capRow = kit.details(row([kit.text('Cap', { size: 14, fill: color.ash }), kit.text(`${v.total} / ${v.cap}`, { size: 14, fill: color.ink, weight: '600' })], space.inRow),
    { title: 'Affinity cap', lines: ['It rises when you pick up a boss core.'] });
  capRow.label = 'forge-cap';
  const facts = row([
    aff,
    capRow,
    row([kit.text(String(v.essence), { size: 14, fill: color.ink, weight: '600' }), kit.text('essence', { size: 14, fill: color.ash })], space.inRow),
  ], space.betweenSections);
  if (P) { flow(facts.children.slice(), w, space.betweenSections, space.inRow); return stack([strip, facts], space.betweenRows); }
  facts.position.set(strip.width + 24, Math.round((m.mote - facts.height) / 2) + 6);
  strip.addChild(facts);
  return strip;
}
function elide(text, width) {
  const full = text.text; let end = full.length;
  while (text.width > width && end > 1) text.text = full.slice(0, --end).trimEnd() + '…';
}
function tile(kit, w, h, on) {
  const c = new Container();
  const art = plate(on ? 'prominent' : 'subdued', w, h, Math.round(Math.min(h, 60) * 0.32));
  art.label = 'card';
  c.addChild(art);
  return c;
}
/** Words with an element's name in its colour (W28; items 245, 246: Justin 2026-10-20, "the with air part should have
 *  Air capitalized and the color of its element to match earth" and "same with water here"). */
const named = (el, before, after = '') => ({ text: `${before}<el>${titleCase(el)}</el>${after}`, tags: { el: { fill: ELEMENT_COLOUR[el] } } });
function foot(kit, w, title, lines, action) {
  const c = new Container();
  const beside = !action || w - action.width - space.betweenSections >= 240;
  const room = beside ? w - (action ? action.width + space.betweenSections : 0) : w;
  const words = stack([title ? kit.text(title, { size: 16, fill: color.ink, weight: '600', wrap: room }) : null,
    ...lines.filter(Boolean).map(l => {
      const t = kit.text(l.text ?? l, { size: 14, fill: l.fill ?? color.ash, wrap: room });
      if (l.tags) t.style.tagStyles = l.tags;   // a word in its own colour (W28: the current enchant's element)
      return t;
    })].filter(Boolean), 2);
  c.addChild(words);
  if (action) { action.position.set(w - action.width, beside ? 0 : words.height + space.betweenRows); c.addChild(action); }
  return c;
}
const actPlate = (kit, words, fn, on) => Object.assign(kit.plateButton(words, fn, { h: Math.max(36, kit.target), size: 16, rank: on ? 'prominent' : 'subdued' }), { label: 'forge-act' });
/** Fuse: six element tiles (art, name, points in the element's colour); the picked one's next passive below. */
export function fuseTab(kit, v, w, ctx, label = 'Fuse') {
  const m = M[kit.stage.kind], cols = w >= 600 ? 3 : 2, cw = Math.floor((w - m.gap * (cols - 1)) / cols);
  const compact = cw < 180, fh = Math.max(m.fuseH, kit.target, compact ? kit.size(20) * 1.3 + 38 : 0);
  pick.fuse ??= v.fuse.find(f => f.can)?.el ?? v.primary ?? 'fire';
  const tiles = v.fuse.map(f => {
    const t = tile(kit, cw, fh, pick.fuse === f.el);
    const pic = icon('mote-' + f.el, 26);
    if (pic) { pic.position.x += 14; pic.position.y += compact ? 8 : Math.round((fh - 26) / 2); t.addChild(pic); }
    const name = kit.text(f.name, { size: 20, font: 'display', weight: '700', fill: color.ink });
    const n = kit.text(String(f.have), { size: 20, font: 'display', weight: '700', fill: ELEMENT_COLOUR[f.el] });
    n.position.set(cw - n.width - 14, compact ? 8 : Math.round((fh - n.height) / 2) + 2);
    name.position.set(compact ? Math.round((cw - name.width) / 2) : 52, compact ? fh - name.height - 6 : Math.round((fh - name.height) / 2));
    if (pic && kit.stage.kind === 'P') pic.position.x -= 4;
    t.addChild(name, n);
    t.label = 'fuse-' + f.el;
    kit.control(t, () => { pick.fuse = f.el; ctx.reopen(); });
    if (f.next) kit.details(t, { title: named(f.el, '', ` ${f.have + 1}: ${f.next.name}`), lines: [f.next.text] });
    return t;
  });
  const chosen = v.fuse.find(f => f.el === pick.fuse);
  const capped = v.total >= v.cap;
  return stack([
    capped ? kit.text(`Affinity cap reached (${v.cap}). Pick up a boss core to raise it.`, { size: 14, fill: color.ash, wrap: w }) : null,
    grid(tiles, cols, cw, fh, m.gap, m.gap),
    foot(kit, w, !chosen ? null : chosen.have >= 6 ? `${chosen.name} is mastered` : `${chosen.name} ${chosen.have + 1}${chosen.next ? ': ' + chosen.next.name : ''}`, [chosen?.have < 6 ? chosen?.next?.text : null,
      chosen?.have < 6 ? affinityWords(ctx.game?.hero, chosen.el).join(' · ') || null : null,
      chosen && !chosen.can && chosen.why !== 'at-cap' ? WHY[chosen.why] : null],
      actPlate(kit, label, () => {
        if (!chosen?.can) { ctx.deps.cue?.('ui-error'); return; }
        const back = () => ctx.open('Forge', ctx.arg);
        ctx.open('Confirm', { title: `Permanently gain ${chosen.name} ${chosen.have + 1}?`, text: 'This cannot be undone.', yes: 'Fuse',
          onYes: () => { ctx.deps.command?.({ type: 'fuse', element: chosen.el }); back(); }, onNo: back });
      }, chosen?.can)),
  ].filter(Boolean), space.betweenRows);
}
/** Enchant: a row of mote tiles (art over count), then the gear cards (art, slot, name); the effect below. */
function enchantTab(kit, v, w, ctx) {
  if (!v.enchant.length) return none(kit, 'Nothing worn takes an enchantment.', w);
  const m = M[kit.stage.kind], hero = ctx.game?.hero;
  const usable = x => x.n > 0 && !x.barred;
  if (!v.motes.some(x => x.el === pick.enchantEl && usable(x))) pick.enchantEl = v.motes.find(usable)?.el ?? pick.enchantEl;
  const els = new Container(), mt = Math.max(m.moteTile, kit.target);
  v.motes.forEach((x, i) => {
    const t = tile(kit, mt, mt, usable(x) && pick.enchantEl === x.el);
    const pic = icon('mote-' + x.el, Math.min(24, Math.round(mt * 0.45))), n = kit.text(String(x.n), { size: mt < 56 ? 12 : 14, fill: color.ink, weight: '600' });
    if (pic) { pic.position.x += (mt - 24) / 2; pic.position.y += Math.round(mt * 0.12); t.addChild(pic); }
    n.anchor.set(0.5, 0); n.position.set(mt / 2, Math.round(mt * 0.52));
    t.addChild(n);
    t.label = 'enchant-el-' + x.el;
    if (usable(x)) kit.control(t, () => { pick.enchantEl = x.el; ctx.reopen(); });
    else {
      t.alpha = 0.5;
      kit.details(t, { title: named(x.el, '', ' motes'), lines: [x.barred ? { text: x.barred, fill: BARRED } : 'You have none to set.'] });
    }
    els.addChild(t);
  });
  flow(els.children, w, 8, 8);
  if (!v.motes.some(usable)) return stack([els, kit.text('You have no motes to set.', { size: 14, fill: color.ash, wrap: w })], space.betweenRows);
  const el = pick.enchantEl;
  const slot = v.enchant.find(e => e.slot === pick.enchantSlot) ?? v.enchant[0];
  pick.enchantSlot = slot.slot;
  const takes = e => !e.unknown, same = e => e.current === el;
  const iw = m.itemW || w, ih = Math.max(m.itemH, kit.target, kit.size(14) * 1.3 + kit.size(16) * 1.3 + 20);
  const cards = v.enchant.map(e => {
    const t = tile(kit, iw, ih, e === slot);
    const pic = icon(e.item.icon, 36);
    if (pic) { pic.position.x += 14; pic.position.y += Math.round((ih - 36) / 2); t.addChild(pic); }
    const dot = enchantDot(e.item.enchant, 48);
    if (dot) { dot.position.set(10, Math.round((ih - 48) / 2)); t.addChild(dot); }
    const lab = kit.text(e.label, { size: 14, fill: color.dim }), name = kit.text(e.item.name, { size: 16, fill: color.ink, weight: '600' });
    const room = iw - 62 - 12;
    elide(name, room);
    lab.position.set(62, 8); name.position.set(62, ih - name.height - 8);
    t.addChild(lab, name);
    if (!takes(e) || same(e)) t.alpha = 0.6;
    t.label = 'enchant-' + e.slot;
    kit.control(t, () => { pick.enchantSlot = e.slot; ctx.reopen(); });
    kit.details(t, e.item.detail);
    return t;
  });
  const cols = Math.max(1, Math.min(cards.length, Math.floor((w + m.gap) / (iw + m.gap))));
  const words = e => v.enchantText[`${slot.family}-${e}`] ?? (enchantSentence(hero, slot.family, e) || null);
  const text = words(el), can = takes(slot), on = can && !same(slot);
  const cur = slot.current;
  const now = cur ? named(cur, 'Now ', words(cur) ? `: ${words(cur)}` : '')
    : slot.unknown ? 'Unidentified' : 'Not enchanted';
  const next = !can ? { text: 'The Forge will not work metal you do not know. Identify it first.', fill: color.dim }
    : same(slot) ? named(el, 'Already carries ') : text ? named(el, 'With ', `: ${text}`) : null;
  const P = kit.stage.kind === 'P';
  const what = foot(kit, w, slot.item.name, [now, next],
      actPlate(kit, cur && on ? 'Replace' : 'Enchant', () => {
        if (!on) { ctx.deps.cue?.('ui-error'); return; }
        const send = () => ctx.deps.command?.({ type: 'enchant', slot: slot.slot, element: el });
        if (!cur) return send();
        const back = () => ctx.open('Forge', ctx.arg);
        ctx.open('Confirm', { title: `Replace the ${titleCase(cur)} enchantment?`, text: 'The old enchantment is gone.', yes: 'Replace', onYes: () => { send(); back(); }, onNo: back });
      }, on));
  const cardGrid = grid(cards, cols, iw, ih, m.gap, m.gap);
  return stack(P ? [els, what, cardGrid] : [els, cardGrid, what], space.betweenRows);
}
/** Upgrade: one row per worn item: where it is, its name, its plus, and the cost plate (or Max). */
function upgradeTab(kit, v, w, ctx) {
  if (!v.upgrade.length) return none(kit, 'Nothing to upgrade.', w);
  const P = kit.stage.kind === 'P';
  return stack(v.upgrade.map(u => {
    const c = new Container(), h = Math.max(36, kit.target), cleanse = !!u.item.cursed;
    const cost = u.cost === null ? kit.plateButton('Max', () => {}, { h, size: 16 })
      : kit.plateButton(cleanse ? 'Cleanse ' + u.cost : String(u.cost), () => ctx.deps.command?.({ type: 'upgrade', slot: u.slot }), { h, size: 16, rank: v.essence >= u.cost ? 'prominent' : 'subdued', w: cleanse ? 132 : 92 });
    cost.label = 'upgrade-' + u.slot;
    const label = kit.text(u.label, { size: 14, fill: color.ash });
    const nameX = P ? 0 : 110, room = w - nameX - cost.width - space.betweenSections;
    const below = room < 180, name = kit.text(u.item.name, { size: 16, fill: color.ink, weight: '600', wrap: below ? w : room });
    if (P || below) { name.y = label.height; cost.position.set(w - cost.width, name.y + name.height + space.inRow); }
    else { label.y = (h - label.height) / 2; name.position.set(nameX, Math.max(0, (h - name.height) / 2)); cost.x = w - cost.width; }
    c.addChild(label, name, cost); kit.details(name, u.item.detail); return c;
  }), space.betweenRows);
}
/** A sigil's cost as its tile shows it: one dot per mote in its element's colour, then the essence. */
function costMarks(kit, s) {
  const c = new Container(), cost = kit.text(`${s.cost} essence`, { size: 14, fill: color.ash });
  const r = kit.size(14) * 0.36, mid = cost.height / 2, dots = new Graphics();
  s.elements.forEach((el, i) => dots.circle(r + i * (r * 2 + 4), mid, r).fill(ELEMENT_COLOUR[el]));
  cost.x = s.elements.length * (r * 2 + 4) + 4;
  c.addChild(dots, cost);
  return c;
}
/**
 * Craft: 1.7's grid of sigil tiles: name, one dot per mote in its element's colour, the essence cost. A tile opens a
 * pop-up that asks to craft it (item 301, Justin 2026-10-21: "if you select a sigil, you have to scroll down to craft
 * and it's hidden. A better solution would be if you select a sigil for a pop up to ask if you wish to craft"): its
 * name, words and cost, Craft and Cancel; either answer comes back to this tab. Only one that can be carved asks ("only
 * should do the pop up if you have the materials"); the rest say why on their card.
 */
function craftTab(kit, v, w, ctx) {
  if (!v.sigils.length) return none(kit, say('forge.no-recipes'), w);
  const m = M[kit.stage.kind], ch = Math.max(m.craftH, kit.target, kit.size(16) * 1.3 + kit.size(14) * 1.3 + 12), cols = w >= 900 ? 5 : w >= 600 ? 4 : 2, cw = Math.floor((w - m.gap * (cols - 1)) / cols);
  const tiles = v.sigils.map(s => {
    const t = tile(kit, cw, ch, false);
    const cost = kit.text(String(s.cost), { size: 14, fill: color.ash });
    const name = kit.text(s.name, { size: 16, fill: s.can === false ? color.dim : color.ink, weight: '600' });
    const apart = 5 + name.height <= ch - cost.height - 6;
    const room = cw - 20 - (apart ? 0 : cost.width + 8);
    if (name.width > room) { let t = s.name; while (t.length > 3 && name.width > room) { t = t.slice(0, -1); name.text = t.trimEnd() + '…'; } }
    name.position.set(10, 5); cost.position.set(cw - cost.width - 10, ch - cost.height - 4);
    // Item 244 (Justin 2026-10-20: "the dots representing the crafting cost are too low on the button and too small, they
    // should be vertically aligned with the text and a bit larger"): on the cost's middle, sized with its text.
    const r = kit.size(14) * 0.36, mid = cost.y + cost.height / 2, dots = new Graphics();
    s.elements.forEach((el, i) => dots.circle(10 + r + i * (r * 2 + 4), mid, r).fill(ELEMENT_COLOUR[el]));
    dots.label = 'cost-dots';
    t.addChild(name, cost, dots);
    if (s.can === false) t.alpha = 0.6;
    t.label = 'craft-' + s.id;
    if (s.can) kit.control(t, () => {
      const back = () => ctx.open('Forge', ctx.arg);
      ctx.open('Confirm', { title: `Craft ${s.name}?`, text: s.text ?? undefined, figure: k => costMarks(k, s), yes: 'Craft',
        onYes: () => { ctx.deps.command?.({ type: 'craft', sigil: s.id }); back(); }, onNo: back });
    });
    const why = s.why ? { text: s.why, fill: BARRED } : null;
    kit.details(t, { title: s.name, rows: [['Essence', s.cost], ['Motes', s.elements.map(titleCase).join(', ')]], lines: [s.text, why].filter(Boolean) });
    return t;
  });
  return grid(tiles, cols, cw, ch, m.gap, m.gap);
}
/** Recycle: one row per spare piece (art, name, what it gives, Recycle); then the total and Recycle all. */
function recycleTab(kit, v, w, ctx) {
  if (!v.recycle.length) return none(kit, 'Nothing in your bag to recycle.', w);
  const rows = v.recycle.map(r => {
    const c = new Container(), h = Math.max(36, kit.target), pic = icon(r.item.icon, 26);
    const go = kit.plateButton('Recycle', () => ctx.deps.command?.({ type: 'recycle', bag: r.bag }), { h, size: 14 });
    const gain = kit.text(r.value !== null ? '+' + r.value + ' essence' : '', { size: 14, fill: kit.accent });
    const narrow = w < 560, room = narrow ? w - 36 : w - 36 - go.width - gain.width - space.betweenSections * 2;
    const name = kit.text(r.item.name, { size: 16, fill: color.ink, weight: '600', wrap: room });
    if (pic) { pic.y += 4; c.addChild(pic); }
    name.position.set(36, 0);
    if (narrow) { gain.position.set(36, name.height + space.inRow); go.position.set(w - go.width, name.height + space.inRow); }
    else { go.x = w - go.width; gain.position.set(go.x - gain.width - space.betweenRows, (h - gain.height) / 2); name.y = Math.max(0, (h - name.height) / 2); }
    c.addChild(name, gain, go); kit.details(name, r.item.detail); return c;
  });
  const sum = v.recycle.reduce((a, r) => a + (r.value ?? 0), 0);
  const total = new Container(), words = kit.text(say('forge.recycle-total', { essence: sum }), { size: 14, fill: color.ink, wrap: w });
  const n = v.recycle.length, back = () => ctx.open('Forge', ctx.arg);
  const all = Object.assign(kit.plateButton('Recycle all', () => ctx.open('Confirm', { question: `Melt down ${n} piece${n === 1 ? '' : 's'} of gear from your bag for ${sum} essence?`, yes: 'Recycle',
    onYes: () => { ctx.deps.command?.({ type: 'recycle-all' }); back(); }, onNo: back }), { h: Math.max(40, kit.target), size: 18, rank: 'prominent' }), { label: 'forge-act' });
  if (words.width + all.width + space.betweenRows > w) { all.position.set(w - all.width, words.height + space.betweenRows); }
  else { words.y = (all.height - words.height) / 2; all.x = w - all.width; }
  total.addChild(words, all);
  return stack([...rows, total], space.betweenRows);
}
export function buildForge(kit, area, ctx) {
  const v = forgeView(ctx.game, ctx.deps.magic?.() ?? {});
  const P = kit.stage.kind === 'P', m = M[kit.stage.kind];
  const tw = P ? Math.floor((area.w - m.tabGap * 2) / 3) : m.tabW;
  const plates = TABS.map(t => kit.details(Object.assign(kit.plateButton(t, () => { pick.tab = t; ctx.reopen(); }, { h: Math.max(m.tabH, kit.target), size: P ? 12 : 16, w: tw, rank: pick.tab === t ? 'prominent' : 'subdued' }), { label: 'forge-' + t }),
    { title: t, lines: [tabTip(t, ctx.game?.hero)] }));
  const tabs = new Container();
  plates.forEach(p => tabs.addChild(p));
  flow(plates, area.w, m.tabGap, m.tabGap);
  const body = { Fuse: fuseTab, Enchant: enchantTab, Upgrade: upgradeTab, Craft: craftTab, Recycle: recycleTab }[pick.tab](kit, v, area.w, ctx);
  const head = !P || ['Fuse', 'Craft', 'Recycle'].includes(pick.tab) ? moteStrip(kit, v, area.w)
    : pick.tab === 'Upgrade' ? row([kit.text(String(v.essence), { size: 16, fill: color.ink, weight: '600' }), kit.text('essence', { size: 14, fill: color.ash })], space.inRow) : null;
  clearTimeout(saidTimer);
  const now = Date.now(), banner = forgeSaying(now) ? kit.text(said.words, { size: 14, fill: color.ink, wrap: area.w }) : null;
  if (banner) { banner.label = 'forge-said'; saidTimer = setTimeout(() => { said = null; if (!banner.destroyed) ctx.reopen(); }, said.until - now); }
  return stack([banner, head, tabs, body].filter(Boolean), space.betweenSections);
}
