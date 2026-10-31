// Sandbox window: 1.7's Sandbox tab and Map mode for the rewrite (src/engine/sandbox.js has the commands). Four pages
// picked by words across the top: World (floors, planes, reveal, teleport), Hero (god mode, heal, levels, stats,
// essence, motes), Creatures (spawn by biome, kill all, sleep all), Items (gear, food, sigils by kind, tier and plus),
// Rooms (a floor built with one special, rare, hidden or puzzle room: 1.7's room preview), Run (1.7's Build presets,
// Seed, Number scale and Lethality: a new sandbox run from a build or seed, the two scales live), View (1.7's Art, Motion,
// Lighting and Zoom switches: the Options window's own settings). Every button sends {type:'sandbox', action, ...}
// through deps.command; the window rebuilds after it lands. Item 166 (Justin 2026-10-18): 1.7's options it lacked.

import { Container, Graphics } from '../../../../forge-godot/runtime/pixi.js';
import { color, space } from '../core/widgets.js';
import { stack, flow, split } from '../core/layout.js';
import { panel, paged, PANEL_PAD } from '../core/blocks.js';
import { sandboxCatalog, SCALES, TRAVEL } from '../../engine/sandbox.js';
import { editText } from '../core/text-entry.js';
import { ATTR_NAME as ATTR_NAMES } from '../model/words.js';
import { SECTIONS, optionOf } from './options-list.js';
import { slider } from './options.js';
import lighting from '../../../data/lighting.json' with { type: 'json' };

const PAGES = ['World', 'Hero', 'Creatures', 'Items', 'Rooms', 'Run', 'View'];
/** Item 166: 1.7's Sandbox Art, Motion, Lighting and Zoom (index.html #mSand), as the Options window's settings. */
const VIEW_OPTIONS = [['mapArt', 'Art'], ['motion', 'Motion'], ['lighting', 'Lighting'], ['zoom', 'Zoom']];
/** CH-39: 1.7's Sandbox Build presets (index.html #preset), each a fresh sandbox run. */
const BUILDS = [
  ['Dwarf Fighter', { race: 'dwarf', cls: 'fighter' }], ['Elf Mage', { race: 'elf', cls: 'mage' }], ['Human Scoundrel', { race: 'human', cls: 'scoundrel' }],
  ['Ember Fae Scoundrel', { race: 'fae', court: 'ember', cls: 'scoundrel' }], ['Tide Fae Scoundrel', { race: 'fae', court: 'tide', cls: 'scoundrel' }],
  ['Gloomling Cleric of Murk', { race: 'gloomling', cls: 'cleric', god: 'murk' }],
];
const ROOM_GROUPS = { special: 'Special', rare: 'Rare', hidden: 'Hidden', puzzle: 'Puzzles' };
const BIOME_IDS = ['dungeon', 'crypt', 'caverns', 'underdark', 'chaos'];
const KIND_NAMES = { weapon: 'Weapons', armour: 'Armour', offhand: 'Off-hand', ring: 'Rings', amulet: 'Amulets', food: 'Food', sigil: 'Sigils' };
// What the window shows, kept between rebuilds (a command rebuilds the window).
const VIEW = { page: 'World', group: 'dungeon', kind: 'weapon', tier: 1, plus: 0, n: 1, at: 0, rooms: 'special' };
const view = { ...VIEW };
export const sandboxNewRun = () => { Object.assign(view, VIEW); };   // each run's dev tools start at World
let catalog = null;

/** Words that act, wrapped to the width. */
function words(kit, list, w, o = {}) {
  const c = new Container();
  const nodes = list.map(([label, act, on]) => {
    const b = kit.button(label, act, { size: o.size ?? 16, font: 'body', tight: true, selected: !!on });
    b.label = 'sb-' + label;
    return b;
  });
  nodes.forEach(n => c.addChild(n));
  flow(nodes, w, space.betweenRows, 0);
  return c;
}

/** A label, then its choices on the same line when they fit. */
function choiceRow(kit, label, list, w, labelW = 0) {
  const l = kit.text(label, { size: 14, fill: color.ash });
  const lw = Math.max(l.width, labelW);
  const box = words(kit, list, Infinity);
  const c = new Container();
  if (lw + space.betweenRows + box.width <= w) { box.x = lw + space.betweenRows; l.y = Math.round((box.height - l.height) / 2) - 4; }
  else { flow(box.children.slice(), w, space.betweenRows, 0); box.y = l.height; }   // too long beside its label: under it
  c.addChild(l, box);
  return c;
}

/**
 * @param {ReturnType<import('../core/widgets.js').createKit>} kit
 * @param {{w:number,h:number}} area
 * @param {{game:any, deps:any, reopen:()=>void}} ctx
 */
/**
 * Item 254: the world's colour grade for this floor's area, live: the slider writes lighting.json's areas.<area>.grade
 * (pipeline.grade where the area has no row), which the lit passes read every frame. Not saved: the numbers shown are
 * the ones to copy into the row.
 */
function gradeRows(kit, g, w, lw) {
  const R = lighting.rows, name = g?.floor?.plane ?? g?.plane ?? g?.floor?.biome ?? 'dungeon', area = R.areas[name];
  const row = area ? (area.grade ??= { vibrance: R.pipeline.grade.vibrance, contrast: R.pipeline.grade.contrast }) : R.pipeline.grade;
  const note = kit.text('', { size: 14, fill: color.dim, wrap: w });
  const say = () => { note.text = `${area ? 'areas.' + name : 'pipeline'}.grade: vibrance ${row.vibrance.toFixed(2)}, contrast ${row.contrast.toFixed(2)} (live, not saved)`; };
  const line = (label, key) => {
    const c = new Container(), t = kit.text(label, { size: 14 }), s = slider(kit, { key: `grade-${key}` }, row[key] * 100, Math.max(120, Math.min(280, w - lw - space.betweenRows)), (k, v) => { row[key] = v / 100; say(); });
    s.x = lw + space.betweenRows; t.y = Math.round((s.height - t.height) / 2); c.addChild(t, s);
    return c;
  };
  say();
  return stack([line('Vibrance', 'vibrance'), line('Contrast', 'contrast'), note], space.inRow);
}

export function buildSandbox(kit, area, ctx) {
  catalog ??= sandboxCatalog();
  const g = ctx.game, h = g?.hero, p = g?.actors?.[g.playerId], sb = g?.sandbox ?? {};
  // A jump to another floor shuts the window first, so the floor loads under the plain HUD, as the stairs do (TRAVEL).
  const send = c => { ctx.deps.cue?.('ui-click'); if (TRAVEL.has(c.action)) ctx.close?.(); ctx.deps.command({ type: 'sandbox', ...c }); };
  const set = o => { Object.assign(view, o); ctx.deps.cue?.('ui-click'); ctx.reopen(); };
  const P = kit.stage.kind === 'P', sec = space.betweenSections, inner = w => w - PANEL_PAD * 2;
  // Rows of one panel line their choices up under one another: the label column is the widest label.
  const widest = labels => { const ts = labels.map(t => kit.text(t, { size: 14 })), n = Math.max(...ts.map(t => t.width)); ts.forEach(t => t.destroy()); return n; };

  const tabs = words(kit, PAGES.map(t => [t, () => set({ page: t, at: 0 }), view.page === t]), area.w, { size: 20 });
  const where = kit.text(g ? `Floor ${g.floorNo}${g.floor?.plane ? `, plane of ${g.floor.plane}` : ''}   Level ${h.level}   HP ${p.hp}/${p.maxhp}   Essence ${h.essence}${sb.god ? '   God mode' : ''}` : '', { size: 14, fill: color.ash, wrap: area.w });
  const head = stack([tabs, where], space.inRow);
  const room = { w: area.w, h: area.h - head.height - sec };
  let body;

  if (view.page === 'World') {
    const cols = P ? 1 : 2, { w: cw, xs } = split(area.w, cols, sec);
    const floors = catalog.floors.map(f => [String(f.n), () => send({ action: 'floor', floor: f.n }), g?.floorNo === f.n && !g.floor?.plane]);
    // A phone puts every row's numbers under its biome, so the five rows read alike.
    const names = ['dungeon', 'crypt', 'caverns', 'underdark', 'chaos'], lw = P ? inner(cw) : widest(names.map(b => catalog.biomeNames[b]));
    const biomes = names.map((b, i) => choiceRow(kit, catalog.biomeNames[b], floors.slice(i * 5, i * 5 + 5), inner(cw), lw));
    const jump = panel(kit, 'Floor', cw, stack([...biomes, words(kit, [['Reroll this floor', () => send({ action: 'reroll' })]], inner(cw))], space.inRow));
    // One tap to each biome's first floor, and the next floor down (sandbox item 102, Justin 2026-10-17).
    const here = g ? BIOME_IDS[Math.min(4, Math.floor((g.floorNo - 1) / 5))] : null;
    const go = panel(kit, 'Go to', area.w, stack([
      words(kit, [...BIOME_IDS.map(b => [catalog.biomeNames[b], () => send({ action: 'biome', biome: b }), here === b && !g.floor?.plane]), ['Next floor', () => send({ action: 'next' })]], inner(area.w), { size: 20 }),
      words(kit, catalog.planes.map(el => ['Plane of ' + el[0].toUpperCase() + el.slice(1), () => send({ action: 'plane', plane: el }), g?.floor?.plane === el]), inner(area.w), { size: 20 }),
      kit.text('A plane opens from the floor you stand on; its portal leads back there.', { size: 14, fill: color.dim, wrap: inner(area.w) }),
    ], space.inRow));
    const lookW = widest(['Reveal map', 'Map mode', 'Chaos encounters']), shown = !!g?.floor?.unrevealed;
    const look = panel(kit, 'Look around', cw, stack([
      words(kit, [['To the stairs', () => send({ action: 'teleport', to: 'stairs' })], ['To the arrival', () => send({ action: 'teleport', to: 'arrival' })]], inner(cw)),
      // Item 166 (1.7 bReveal): the whole floor shown until it is turned off again.
      choiceRow(kit, 'Reveal map', [['On', () => send({ action: 'reveal', on: true }), shown], ['Off', () => send({ action: 'reveal', on: false }), !shown]], inner(cw), lookW),
      // H33 (1.7 mapview.js Map mode): creatures still, no harm, fog off, a click on a tile goes there.
      choiceRow(kit, 'Map mode', [['On', () => send({ action: 'map-mode', on: true }), !!sb.mapMode], ['Off', () => send({ action: 'map-mode', on: false }), !sb.mapMode]], inner(cw), lookW),
      choiceRow(kit, 'Chaos encounters', [['On', () => send({ action: 'encounters', on: true }), sb.encounters !== false], ['Off', () => send({ action: 'encounters', on: false }), sb.encounters === false]], inner(cw), lookW),
      // CH33: floor 25's gates raised without the fight (1.7 setWalkthrough); shown on the Crucible only.
      ...(g?.floor?.crucible ? [choiceRow(kit, 'Crucible gates', [['Raised', () => send({ action: 'walkthrough', on: true }), !!g.floor.crucible.walkthrough], ['Locked', () => send({ action: 'walkthrough', on: false }), !g.floor.crucible.walkthrough]], inner(cw))] : []),
    ], space.inRow));
    const a = stack(P ? [jump, look] : [jump], sec), b = P ? null : stack([look], sec);
    const cols2 = new Container(); a.x = xs[0]; cols2.addChild(a);
    if (b) { b.x = xs[1]; cols2.addChild(b); }
    body = stack([go, cols2], sec);
  } else if (view.page === 'Hero') {
    const cols = P ? 1 : 2, { w: cw, xs } = split(area.w, cols, sec);
    const life = panel(kit, 'Life', cw, stack([
      choiceRow(kit, 'God mode', [['On', () => send({ action: 'god', on: true }), sb.god], ['Off', () => send({ action: 'god', on: false }), !sb.god]], inner(cw)),
      words(kit, [['Heal and feed', () => send({ action: 'heal' })], ['Iron key', () => send({ action: 'key' })]], inner(cw)),
    ], space.inRow));
    const grow = panel(kit, 'Level', cw, stack([
      words(kit, [['+1 level', () => send({ action: 'level', n: 1 })], ['+5 points', () => send({ action: 'points', n: 5 })]], inner(cw)),
      // Item 180: straight to a level through every level-up on the way (play never lowers one).
      choiceRow(kit, 'To level', [5, 10, 15, 20].map(n => [String(n), () => send({ action: 'level', to: n }), h?.level === n]), inner(cw)),
      ...catalog.attrs.map((a, i, all) => choiceRow(kit, `${ATTR_NAMES[a] ?? a} ${h?.attr?.[a] ?? ''}`, [['-1', () => send({ action: 'stat', attr: a, value: (h.attr[a] ?? 0) - 1 })], ['+1', () => send({ action: 'stat', attr: a, value: (h.attr[a] ?? 0) + 1 })], ['+5', () => send({ action: 'stat', attr: a, value: (h.attr[a] ?? 0) + 5 })]], inner(cw), widest(all.map(x => `${ATTR_NAMES[x] ?? x} 99`)))),
    ], space.inRow));
    const els = catalog.elements;
    const wealth = panel(kit, 'Essence and motes', cw, stack([
      words(kit, [['+100 essence', () => send({ action: 'essence', n: 100 })], ['+1000 essence', () => send({ action: 'essence', n: 1000 })], ['One of each mote', () => send({ action: 'motes' })]], inner(cw)),
      choiceRow(kit, 'Mote', els.map(el => [el[0].toUpperCase() + el.slice(1), () => send({ action: 'motes', element: el })]), inner(cw)),
    ], space.inRow));
    const affW = widest(els.map(el => `${el[0].toUpperCase() + el.slice(1)} 99`));
    // Two elements to a row on a wide window, so the Faith panel fits under them (item 180).
    const half = P ? inner(cw) : Math.floor(inner(cw) / 2), affRow = el => choiceRow(kit, `${el[0].toUpperCase() + el.slice(1)} ${h?.affinity?.[el] ?? 0}`, [['-1', () => send({ action: 'affinity', element: el, n: -1 })], ['+1', () => send({ action: 'affinity', element: el, n: 1 })]], half, affW);
    const affBody = P ? stack(els.map(affRow), 0) : new Container();
    if (!P) for (const [i, col] of [els.filter((_, k) => k % 2 === 0), els.filter((_, k) => k % 2 === 1)].entries()) affBody.addChild(Object.assign(stack(col.map(affRow), 0), { x: i * half }));
    const aff = panel(kit, 'Affinity', cw, affBody);
    // Item 180: any god as patron through the shrine's own vows, and rank 1-5 with the piety to match.
    const f = h?.faith, faithW = widest(['Patron', 'Rank']);
    const faith = panel(kit, 'Faith', cw, stack([
      choiceRow(kit, 'Patron', catalog.gods.map(o => [o.name, () => send({ action: 'pledge', god: o.id }), f?.god === o.id]), inner(cw), faithW),
      choiceRow(kit, 'Rank', [1, 2, 3, 4, 5].map(n => [String(n), () => send({ action: 'rank', to: n }), f?.rank === n]), inner(cw), faithW),
    ], space.inRow));
    const a = stack(P ? [life, grow, faith, wealth, aff] : [life, grow], sec), b = P ? null : stack([wealth, aff, faith], sec);
    body = new Container(); a.x = xs[0]; body.addChild(a);
    if (b) { b.x = xs[1]; body.addChild(b); }
  } else if (view.page === 'Creatures') {
    const groups = Object.keys(catalog.creatures);
    if (!groups.includes(view.group)) view.group = groups[0];
    const top = stack([
      words(kit, groups.map(k => [catalog.biomeNames[k] ?? k, () => set({ group: k, at: 0 }), view.group === k]), area.w),
      choiceRow(kit, 'How many', [1, 3, 5].map(n => [String(n), () => set({ n }), view.n === n]), area.w),
      // Item 166 (1.7 bSpawn, Spawn nearby): one of this floor's own creatures, hunting.
      words(kit, [['Spawn nearby', () => send({ action: 'spawn-random', n: view.n })], ['Kill all', () => send({ action: 'kill-all' })], ['Sleep all', () => send({ action: 'sleep-all' })]], area.w),
    ], space.inRow);
    const list = catalog.creatures[view.group].map(m => ({ name: m.name, fill: m.boss ? kit.accent : undefined, act: () => send({ action: 'spawn', kind: m.id, n: view.n }) }));
    const grid = paged(kit, list, area.w, room.h - top.height - sec, P ? 1 : 3, view.at, at => set({ at }));
    body = stack([top, grid], sec);
  } else if (view.page === 'Rooms') {
    const top = words(kit, Object.entries(ROOM_GROUPS).map(([k, name]) => [name, () => set({ rooms: k, at: 0 }), view.rooms === k]), area.w);
    const list = catalog.rooms[view.rooms].map(r => ({ name: r.name, act: () => send({ action: 'room', room: r.type, kind: r.kind }) }));
    const grid = paged(kit, list, area.w, room.h - top.height - sec, P ? 1 : 3, view.at, at => set({ at }));
    body = stack([top, grid], sec);
  } else if (view.page === 'Run') {
    // CH-39 (1.7 index.html:305-341): a Build or a Seed starts a fresh sandbox run (1.7 newRun preview); the scales act now.
    const cols = P ? 1 : 2, { w: cw, xs } = split(area.w, cols, sec);
    const sc = sb.scale ?? { numbers: 1, lethality: 1 };
    const choiceOf = (b = {}) => ({ name: h?.name ?? 'Guide', sex: h?.sex ?? 'm', race: h?.race, court: h?.court ?? null, cls: h?.cls, god: h?.god ?? null, ...b, tutorial: false, ...(b.race && b.race !== 'fae' ? { court: null } : {}), ...(b.cls && b.cls !== 'cleric' ? { god: null } : {}) });
    const restart = o => { ctx.deps.cue?.('ui-click'); ctx.deps.newRun?.(choiceOf(o.build), { sandbox: true, seed: o.seed ?? g?.seed, scale: sc }); };
    const same = b => h && Object.entries(b).every(([k, v]) => h[k] === v) && (b.race === 'fae' || !h.court);
    // Item 166 (1.7 boot.js bCreate): New character opens creation for a new sandbox run.
    const build = panel(kit, 'Build', cw, words(kit, [...BUILDS.map(([name, b]) => [name, () => restart({ build: b }), same(b)]), ['New character', () => { ctx.deps.cue?.('ui-click'); ctx.ui?.sandboxCreate?.(); }]], inner(cw)));
    // The seed: tap to type a number (an underline marks the field), then New run starts this build from it.
    const field = new Container(), fw = Math.min(160, inner(cw) - 120), fh = Math.max(kit.target, 40);
    const box = new Container();
    const shown = kit.text(String(view.seed ?? g?.seed ?? ''), { size: 16, font: 'mono', fill: color.ink });
    shown.position.set(space.inRow, Math.round((fh - shown.height) / 2));
    box.addChild(new Graphics().rect(0, 0, fw, fh).fill({ color: 0, alpha: 0.001 }).rect(0, fh - 6, fw, 1).fill({ color: color.rest, alpha: 0.6 }), shown);
    box.label = 'sb-seed';
    field.addChild(box);
    kit.control(box, () => {
      const gp = box.getGlobalPosition(), st = kit.stage;
      editText(st, { x: (gp.x - st.ox) / st.s, y: (gp.y - st.oy) / st.s, w: fw, h: fh }, shown.text, { max: 9, onInput: v => { shown.text = v.replace(/\D/g, '') + '|'; }, onDone: v => { const n = parseInt(v.replace(/\D/g, ''), 10); view.seed = Number.isFinite(n) ? n : undefined; ctx.reopen(); } });
      shown.text += '|';
    });
    const go = words(kit, [['New run', () => restart({ seed: view.seed ?? g?.seed })]], Infinity);
    go.position.set(box.x + fw + space.betweenRows, Math.round((fh - go.height) / 2));
    field.addChild(go);
    const seed = panel(kit, 'Seed', cw, field);
    const scales = panel(kit, 'Scale', cw, stack([
      choiceRow(kit, 'Number scale', SCALES.numbers.map(([name, v]) => [name, () => send({ action: 'scale', numbers: v }), sc.numbers === v]), inner(cw), widest(['Number scale', 'Lethality'])),
      choiceRow(kit, 'Lethality', SCALES.lethality.map(([name, v]) => [name, () => send({ action: 'scale', lethality: v }), sc.lethality === v]), inner(cw), widest(['Number scale', 'Lethality'])),
    ], space.inRow));
    const a = stack(P ? [build, seed, scales] : [build], sec), b = P ? null : stack([seed, scales], sec);
    body = new Container(); a.x = xs[0]; body.addChild(a);
    if (b) { b.x = xs[1]; body.addChild(b); }
  } else if (view.page === 'View') {
    const rows = SECTIONS.flatMap(s => s.options), lw = widest(VIEW_OPTIONS.map(([, label]) => label)), vw = P ? area.w : Math.min(area.w, 560);
    const setOption = (k, v) => { ctx.deps.options?.set?.(k, v); ctx.deps.cue?.('ui-click'); ctx.reopen(); };
    const row = ([k, label]) => { const now = optionOf(ctx.deps.options, k, kit.stage); return choiceRow(kit, label, rows.find(o => o.key === k).choices.map(([v, name]) => [name, () => setOption(k, v), now === v]), inner(vw), lw); };
    body = stack([panel(kit, 'View', vw, stack([...VIEW_OPTIONS.map(row), kit.text('The same settings as the Options window.', { size: 14, fill: color.dim, wrap: inner(vw) })], space.inRow)),
      panel(kit, 'Colour grade', vw, gradeRows(kit, g, inner(vw), Math.max(lw, widest(['Vibrance', 'Contrast']))))], sec);
  } else {
    const kinds = Object.keys(catalog.items);
    const gear = !['food', 'sigil'].includes(view.kind);
    const top = stack([
      words(kit, kinds.map(k => [KIND_NAMES[k] ?? k, () => set({ kind: k, at: 0 }), view.kind === k]), area.w),
      // Item 166 (1.7 bGive, Item to bag): a piece of gear as this floor drops it.
      words(kit, [['Random item to bag', () => send({ action: 'item-random' })]], area.w),
      gear ? choiceRow(kit, 'Quality', [[`Plain`, () => set({ tier: 1 }), view.tier === 1], ['Fine', () => set({ tier: 2 }), view.tier === 2], ['Masterwork', () => set({ tier: 3 }), view.tier === 3]], area.w) : null,
      gear ? choiceRow(kit, 'Plus', [-2, 0, 1, 2, 3].map(n => [n > 0 ? `+${n}` : String(n), () => set({ plus: n }), view.plus === n]), area.w) : null,
    ].filter(Boolean), space.inRow);
    const list = catalog.items[view.kind].map(it => ({ name: it.name, act: () => send({ action: 'item', id: it.id, kind: view.kind === 'sigil' ? 'sigil' : undefined, tier: gear ? view.tier : 0, plus: gear ? view.plus : 0 }) }));
    const grid = paged(kit, list, area.w, room.h - top.height - sec, P ? 1 : 3, view.at, at => set({ at }));
    body = stack([top, grid], sec);
  }
  return stack([head, body], sec);
}
