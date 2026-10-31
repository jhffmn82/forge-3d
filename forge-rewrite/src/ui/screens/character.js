// Character window: who the hero is, then the numbers (attributes, combat, resistances), then the lists
// (abilities, passives), each in groups by source. Wide screens show three panes; phones keep one continuous sheet.

import { Container, Graphics, Rectangle } from '../../../../forge-godot/runtime/pixi.js';
import { color, space, brighten } from '../core/widgets.js';
import { stack, row, split } from '../core/layout.js';
import { heading, pairs, line, lines, none } from '../core/blocks.js';
import { plusPlate } from '../core/plates.js';
import { abilityLook } from '../core/icons.js';
import { tone } from '../core/colour.js';
import { statShort, actionWords, boonWords } from '../model/words.js';
import { manaCost, aimRange } from '../../engine/reads.js';   // C17: the rules' answers through the engine (PLAN section 2)
import { actionFacts } from '../model/action-facts.js';
import abilities from '../../../data/abilities.json' with { type: 'json' };
import prayers from '../../../data/prayers.json' with { type: 'json' };

/** 1.7's sheet inks (css/journal.css:84-99 @3c8b312): ability names gold, passive names green, HP in the Vitality ink
 * and Mana in the Focus ink. */
export const INK = { ability: 0xefbf70, passive: 0xaed276, might: 0xefb34f, agility: 0x91cf63, vitality: 0xf1816e, focus: 0x71bfee };
const COMBAT_INK = { hp: INK.vitality, mana: INK.focus };
const SHIELD_INK = 0x9fd8ff;   // 1.7's shield blue (#9FD8FF)
const state = { stats: 0, abilities: 0, passives: 0 };
export const characterFresh = () => Object.assign(state, { stats: 0, abilities: 0, passives: 0 });

/**
 * What an ability or prayer does, for its card (1.7 enchtext.js abilityDetails / prayerDetails): the sentence, then
 * the cost, cooldown, range and an instant cast, worked out for this hero. With the game (`state`), the live damage,
 * healing, shield and statuses lead (bosses' shorter turns too), and the cooldown says when it is ready
 * (action-facts.js, 1.7 ABILITY_LIVE and actionCooldown).
 */
export function actionDetail(id, name, sub, hero, state = null) {
  const row = abilities.rows[id] ?? prayers.rows[id];
  const facts = state?.hero ? actionFacts(id, state) : [], live = facts.find(([k]) => k === 'Cooldown');
  const rows = facts.filter(([k]) => k !== 'Cooldown');
  if (row) {
    const mana = hero && row.mana ? manaCost(hero, row) : row.mana ?? 0;
    // CD25 (1.7 ui.js prayerCost): a prayer paid in HP, essence or Amusement says so (Bone Spear: 5 HP).
    rows.push(['Cost', row.health ? `${row.health} HP` : row.favor ? `${row.favor} favor` : row.essence ? `${row.essence} essence` : row.amusement ? `${row.amusement} Amusement` : mana ? `${mana} mana` : 'None']);
    if (row.cooldown) rows.push(live ?? ['Cooldown', `${row.cooldown} turns`]);
    const range = row.aim?.range ? (hero ? aimRange(hero, row) : row.aim.range) : 0;
    if (range > 1) rows.push(['Range', `${range} tiles`]);
    else if (range === 1) rows.push(['Range', 'Adjacent']);
    if (row.instant) rows.push(['Cast', 'Instant']);
    if (row.kind === 'prayer' && row.rank) rows.push(['Requires', `Faith rank ${row.rank}`]);
  }
  const said = actionWords(id, hero);
  return { title: name, sub, rows, lines: said ? [said] : [] };
}

/** The identity line: name, race and class, and level. No meters here (Justin 2026-10-17: "there should not be meters on
the char sheet"): XP, Piety and Favor live elsewhere (the HUD, the Faith tab). */
export function identity(kit, v, w) {
  const c = new Container();
  const name = kit.text(v.name, { size: 20, font: 'display', fill: color.ink });
  const who = kit.text(v.who, { size: 16, fill: color.ash, wrap: w });
  const right = kit.text(`Level ${v.level}`, { size: 16, font: 'display', fill: color.ink });
  const wide = name.width + who.width + space.betweenRows <= w;
  const left = wide ? row([name, who], space.betweenRows, false) : stack([name, who], 0);
  if (wide) who.y = name.height - who.height - 2;
  c.addChild(left);
  // Level shares the top line only when the whole line fits, or when the class has wrapped under the name; otherwise it
  // takes its own line (proof pass item 7: 'Level 1' was drawn over 'Human Cleric of Saint Glimmer' at 390x844).
  if (left.width + right.width + space.betweenSections <= w || (!wide && name.width + right.width + space.betweenSections <= w)) right.position.set(w - right.width, name.height - right.height);
  else right.position.set(0, left.height + space.inRow);
  c.addChild(right);
  return c;
}

function attributes(kit, v, w, spend) {
  // 1.7's + is 18 px, smaller than the number (painted-ui.css:775); a fingertip still gets a target-wide tap around it.
  const plusSize = 18, rowH = kit.stage.touch ? kit.target : v.points ? Math.max(24, kit.target - space.inRow) : 24;
  const { w: cw, xs } = split(w, 2, space.betweenSections + space.betweenRows);
  const cells = v.attr.map((a, i) => {
    const c = new Container();
    const name = kit.text(a.name, { size: 16, fill: color.ash });
    const val = kit.text(String(a.value), { size: 16, fill: color.ink, weight: '600' });
    const h = Math.max(name.height, rowH);
    name.y = Math.round((h - name.height) / 2); val.y = name.y;
    // The + takes room only when there are points to spend; a narrow column (a sideways phone) never runs the name into
    // its number (proof pass item 3: 'Might10').
    const spendable = v.points > 0 && a.value < a.max;
    val.x = cw - (spendable ? plusSize + space.betweenRows : 0) - val.width;
    const room = val.x - space.betweenRows;
    if (name.width > room) { name.style.wordWrap = true; name.style.wordWrapWidth = Math.max(40, room); }
    c.addChild(new Graphics().rect(0, 0, cw, h).fill({ color: 0, alpha: 0.001 }), name, val);
    if (v.points > 0 && a.value < a.max) {
      const plus = new Container();
      plus.addChild(plusPlate(plusSize));
      // 1.7 vertical-align -2px: the + sits on the number's line, a touch low.
      plus.position.set(cw - plusSize, Math.round((h - plusSize) / 2) + 1);
      const hw = Math.max(kit.target, 28), hh = Math.max(kit.target, h + space.inRow);
      plus.hitArea = new Rectangle((plusSize - hw) / 2, (plusSize - hh) / 2, hw, hh);
      plus.label = 'spend-' + a.id;
      // 1.7 hover: brightness 1.25 (painted-ui.css:758).
      plus.setFocus = on => brighten(plus, on ? 1.25 : 1);
      plus.on('pointerover', e => { if (e.pointerType === 'mouse') plus.setFocus(true); });
      plus.on('pointerout', () => plus.setFocus(false));
      kit.control(plus, () => spend(a.id));
      c.addChild(plus);
    }
    kit.details(c, { title: a.name, lines: statShort(a.name) });   // items 150-152: no Now and Most rows (Justin 10-18)
    c.label = 'attr-' + a.id;
    c.position.set(xs[i % 2], Math.floor(i / 2) * (h + space.inRow));
    return c;
  });
  const g = new Container(); cells.forEach(c => g.addChild(c));
  return stack([heading(kit, 'Attributes', v.points ? `${v.points} to spend` : null), g]);
}

// W10 (1.7 sheets.js resHTML): a resistance reads green, a weakness red, and none at all grey.
const RES_INK = { good: 0x7fa05a, bad: tone('bad') };   // 1.7 --moss and #D0605A
export const resistInk = r => (r === 'immune' || r > 0 ? RES_INK.good : r < 0 ? RES_INK.bad : color.dim);
const resistRows = v => v.resist.filter(([, r]) => r !== null).map(([name, r]) => [name, r === 'immune' ? 'immune' : `${r > 0 ? '+' : ''}${r}%`, { fill: resistInk(r) }]);

/** The numbers block: Combat and Resistances. Shared with the Inventory window on wide screens. */
const combatRows = v => v.combat.map(([k, val, ink]) => {
    const o = COMBAT_INK[ink] ? { fill: COMBAT_INK[ink], labelFill: COMBAT_INK[ink] } : undefined;
    // W31 (1.7 sheets.js:120, :232): a shield on top of HP reads in 1.7's light blue after the HP.
    const sh = ink === 'hp' && / \+\d+$/.exec(val);
    return sh ? [k, `${val.slice(0, sh.index)} <sh>${sh[0].trim()}</sh>`, { ...o, tags: { sh: { fill: SHIELD_INK } } }] : [k, val, o];
  });
export function numbers(kit, v, w, cols) {
  const res = resistRows(v), combat = combatRows(v);
  return stack([
    heading(kit, 'Combat'), pairs(kit, combat, w, cols),
    res.length ? heading(kit, 'Resistances') : null, res.length ? pairs(kit, res, w, w >= kit.size(14) * 17 + space.betweenSections ? 2 : 1) : null,
  ], space.betweenRows);
}

// CSS-17 (1.7 painted-ui.css:443, 733, which overrode journal.css:87-88's gold and green): ability and passive names
// in the hero's element highlight, lit to #f4f7fb (--house-accent) under the pointer.
const NAME_LIT = 0xf4f7fb;

/** Item 173 (Justin 2026-10-18: "seperated by category and have a subtle divider between categories"): the entries in
 *  groups by the rules' source for each, in this order, each under a small ash word on a faint rule; none empty. */
const SOURCES = [['class', 'Class'], ['race', 'Race'], ['attribute', 'Attributes'], ['affinity', 'Affinity'], ['god', 'God'], ['gear', 'Gear']];
function sourceHead(kit, key, words, w) {
  const head = new Container(), t = kit.text(words, { size: 12, fill: color.ash }), x = t.width + space.betweenRows;
  head.addChild(t, new Graphics().rect(x, Math.round(t.height / 2), Math.max(0, w - x), 1).fill({ color: color.edge, alpha: 0.6 }));
  head.label = 'source-' + key;
  return head;
}

/** Keep source order down each column, repeating a heading after a column or page break. Native-size rows never
 * shrink to make a late-game build fit. Only overflowing panes get the same previous/next controls as the Journal. */
function collection(kit, groups, w, h, cols, key, go) {
  const { xs } = split(w, cols), entries = groups.filter(g => g.rows.length);
  if (!entries.length) return none(kit);
  const arrange = limit => {
    const pages = [[]]; let page = 0, col = 0, y = 0;
    for (const g of entries) {
      let headed = false;
      for (const node of g.rows) {
        if (y && y + (headed ? 0 : g.hh + space.inRow) + node.height > limit) {
          if (++col === cols) { col = 0; pages.push([]); page++; }
          y = 0; headed = false;
        }
        if (!headed && g.head) { pages[page].push({ head: g.head, x: xs[col], y }); y += g.hh + space.inRow; }
        pages[page].push({ node, x: xs[col], y }); y += node.height + space.inRow; headed = true;
      }
      y += space.inRow;
    }
    return pages;
  };
  let pages = arrange(h);
  const navH = Math.max(kit.target, Math.round(kit.size(26) * 1.3) + space.betweenRows);
  if (pages.length > 1) pages = arrange(Math.max(1, h - navH - space.betweenRows));
  const at = state[key] = Math.min(state[key], pages.length - 1), c = new Container(), shown = new Set();
  for (const p of pages[at]) { const n = p.node ?? p.head(); n.position.set(p.x, p.y); c.addChild(n); if (p.node) shown.add(n); }
  for (const g of entries) for (const n of g.rows) if (!shown.has(n)) n.destroy({ children: true });
  if (pages.length > 1) {
    const prev = kit.button('‹', () => go(key, Math.max(0, at - 1)), { size: 26, font: 'body', dim: at === 0 });
    const next = kit.button('›', () => go(key, Math.min(pages.length - 1, at + 1)), { size: 26, font: 'body', dim: at === pages.length - 1 });
    prev.label = `character-${key}-prev`; next.label = `character-${key}-next`;
    const nav = row([prev, kit.text(`${at + 1} / ${pages.length}`, { size: 14, fill: color.ash }), next], space.betweenRows);
    nav.position.set(Math.max(0, (w - nav.width) / 2), h - nav.height); c.addChild(nav);
  }
  return c;
}

function bySource(kit, items, w, h, cols, key, go) {
  if (!items.length) return none(kit);
  if (h === Infinity) return stack(SOURCES.filter(([source]) => items.some(it => it.source === source)).map(([source, words]) =>
    stack([sourceHead(kit, source, words, w), lines(kit, items.filter(it => it.source === source), w, cols)], space.inRow)), space.betweenRows);
  const { w: cw } = split(w, cols);
  const groups = SOURCES.map(([source, words]) => {
    const head = () => sourceHead(kit, source, words, cw), probe = head(), hh = probe.height;
    probe.destroy({ children: true });
    return { head, hh, rows: items.filter(it => it.source === source).map(it => line(kit, it, cw)) };
  });
  return collection(kit, groups, w, h, cols, key, go);
}

function abilityList(kit, v, w, h, cols, hero, game, go) {
  const items = v.abilities.map(a => { const look = abilityLook(a.id), name = a.icon ? a.name : look.name; return { icon: a.icon ?? look.icon, tile: true, from: a.from, fromFill: a.tint, source: a.source, name, fill: kit.accent, lit: NAME_LIT, focus: true, detail: actionDetail(a.id, name, a.group, hero, game), drag: { kind: a.icon ? 'prayer' : 'ability', id: a.id } }; });
  // W9 (1.7 sheets.js:142-145): the worn amulet is an ability too, with its power and charges on its card; it drags
  // onto the hotbar as the amulet slot.
  const am = v.worn?.find(w => w.slot === 'amulet')?.item;
  if (am) items.push({ icon: am.icon, tile: true, from: 'Amulet', source: 'gear', name: am.name, fill: kit.accent, lit: NAME_LIT, focus: true, detail: am.detail, drag: { kind: 'amulet', id: 'amulet' } });
  items.forEach(it => { it.iconSize = kit.stage.touch ? kit.target : 40; });
  const head = heading(kit, 'Abilities', String(items.length), w);
  return stack([head, bySource(kit, items, w, h - head.height - space.betweenRows, cols, 'abilities', go)]);
}

function passiveList(kit, v, w, h, cols, go) {
  const aff = Object.values(v.affinity.have).reduce((a, b) => a + b, 0);
  const items = v.passives.map(p => ({ name: p.name, from: p.from, fromFill: p.tint, source: p.source, fill: kit.accent, lit: NAME_LIT, focus: true, detail: { title: p.name, sub: p.group, rows: p.rows ?? [], lines: p.text ? [p.text] : p.boon && boonWords(p.boon, v.faith?.rank) ? [boonWords(p.boon, v.faith?.rank)] : [] } }));
  const head = heading(kit, 'Passives', `affinity ${aff} / ${v.affinity.cap}`, w);
  // The next affinity point's real numbers, element by element, on hover or tap (sandbox E2, Justin 10-16).
  if (v.affinityNext?.length) {
    if (kit.stage.touch) head.addChildAt(new Graphics().rect(0, 0, w, kit.target).fill({ color: 0, alpha: 0.001 }), 0);
    kit.details(head, { title: 'Next affinity point', lines: v.affinityNext }); head.label = 'affinity-next';
  }
  return stack([head, bySource(kit, items, w, h - head.height - space.betweenRows, cols, 'passives', go)]);
}

function stats(kit, v, w, h, spend, go) {
  const full = stack([attributes(kit, v, w, spend), numbers(kit, v, w, 2)], space.betweenRows);
  if (full.height <= h) return full;
  full.destroy({ children: true });
  const groups = [{ rows: [attributes(kit, v, w, spend)], hh: 0 }];
  for (const [name, list] of [['Combat', combatRows(v)], ['Resistances', resistRows(v)]]) {
    const head = () => heading(kit, name), probe = head(), hh = probe.height, rows = [];
    probe.destroy({ children: true });
    for (let i = 0; i < list.length; i += 2) rows.push(pairs(kit, list.slice(i, i + 2), w, 2));
    groups.push({ head, hh, rows });
  }
  return collection(kit, groups, w, h, 1, 'stats', go);
}

/**
 * @param {ReturnType<import('../core/widgets.js').createKit>} kit
 * @param {{w:number,h:number}} area @param {ReturnType<import('../model/hero-view.js').heroView>} v
 * @param {{command:(c:any)=>void}} act
 */
export function buildCharacter(kit, area, v, act) {
  const spend = attr => act.command({ type: 'spend-point', attr });
  const sec = space.betweenSections, go = (key, value) => { state[key] = value; act.reopen?.(); };
  const id = identity(kit, v, area.w);
  if (area.w < 980) {
    // Justin's phone choice: full-width sections, in order, in the shell's one vertical scroll. A tablet can use
    // two native-size item columns inside each full-width source group; a phone never splits the reading width.
    const cols = kit.stage.form === 'phone' ? 1 : area.w >= 560 ? 2 : 1;
    const parts = [stack([attributes(kit, v, area.w, spend), numbers(kit, v, area.w, 2)], sec),
      abilityList(kit, v, area.w, Infinity, cols, act.hero, act.game, go), passiveList(kit, v, area.w, Infinity, cols, go)];
    parts.forEach((p, i) => { p.label = ['character-stats', 'character-abilities', 'character-passives'][i]; });
    return stack([id, ...parts], sec);
  }
  const avail = area.w - sec * 4, w1 = Math.max(340, Math.floor(avail * 0.32)), w2 = Math.max(270, Math.floor(avail * 0.26)), w3 = avail - w1 - w2;
  const xs = [0, w1 + sec * 2, w1 + w2 + sec * 4], c = new Container(), h = area.h - id.height - sec;
  const col1 = stats(kit, v, w1, h, spend, go), col2 = abilityList(kit, v, w2, h, 1, act.hero, act.game, go);
  const col3 = passiveList(kit, v, w3, h, w3 >= 380 ? 2 : 1, go);
  const top = id.height + sec;
  [col1, col2, col3].forEach((col, i) => { col.label = ['character-stats', 'character-abilities', 'character-passives'][i]; col.position.set(xs[i], top); c.addChild(col); });
  // Dividers (Justin 10-16, looking at 1.7: "we might need to bring back line dividers"): one under the name line,
  // one between each pair of columns.
  const low = Math.max(col1.height, col2.height, col3.height) + top;
  const rule = new Graphics().rect(0, id.height + sec / 2, area.w, 1).fill({ color: color.rest, alpha: 0.35 });
  for (const x of [xs[1], xs[2]]) rule.rect(x - sec, top, 1, Math.min(low, area.h) - top).fill({ color: color.rest, alpha: 0.35 });
  c.addChild(id, rule);
  return c;
}
