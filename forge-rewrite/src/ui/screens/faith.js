// Faith window: the god (statue, name, title), then the numbers (rank, piety, favor, rule), then the lists
// (boons by rank, prayers with their favor cost). L: god on the left, lists on the right. P: one column.

import { Container, Graphics } from '../../../../forge-godot/runtime/pixi.js';
import { color, space } from '../core/widgets.js';
import { stack } from '../core/layout.js';
import { heading, pairs, lines, nameplate } from '../core/blocks.js';
import { shrine } from './creation-art.js';
import gods from '../../../data/gods.json' with { type: 'json' };
import { boonWords, GOD, ACTION, cap } from '../model/words.js';
import { actionDetail } from './character.js';
import { planFor } from '../../engine/reads.js';   // C17: the rules' answers through the engine (PLAN section 2)
import { toNum } from '../core/colour.js';

/**
 * CF49 (1.7 faithHTML and shrineFound, js/faith/gods.js:227-242): where this biome's shrine is. Its floor is named only
 * once the hero has seen the shrine itself, on this floor or on one left behind (a plane keeps its home floor).
 */
export function shrineNote(state) {
  const no = state?.floorNo ?? 1, b0 = Math.floor((no - 1) / 5) * 5;
  let at = null;
  for (let n = b0 + 1; n <= b0 + 5 && at === null; n++) if (planFor(state?.run, n).shrine) at = n;
  if (at === null) return 'The first four biomes each hold one shrine to a random god. There is no shrine in this biome.';
  const kept = at === no ? (state.floor?.plane ? state.stored?.plane : { floor: state.floor, seen: state.seen }) : state.stored?.[at];
  const s = kept?.floor?.shrine, w = kept?.floor?.w;
  const found = !!(s && w && kept.seen?.[s.y * w + s.x]);
  return 'Each biome holds one shrine to a random god. ' + (!found ? "You have not found this biome's shrine." : at >= no ? `This biome's shrine is on floor ${at}.` : `This biome's shrine was on floor ${at}.`);
}

/**
 * @param {ReturnType<import('../core/widgets.js').createKit>} kit
 * @param {{w:number,h:number}} area @param {ReturnType<import('../model/hero-view.js').heroView>} v
 * @param {{reopen?:()=>void}} deps
 */

export function buildFaith(kit, area, v, deps) {
  let body = composeFaith(kit, area, v, deps, true);
  if (kit.stage.kind !== 'P' && body.height > area.h) { body.destroy({ children: true }); body = composeFaith(kit, area, v, deps, false); }
  return body;
}
function composeFaith(kit, area, v, deps, full) {
  const f = v.faith, P = kit.stage.kind === 'P', sec = space.betweenSections;
  if (!f) {
    // Unsworn: say so; after a betrayal, the old god's wrath and the turns it has left (1.7's Faith tab).
    const w = deps.wrath;
    return stack([kit.text('You are not sworn to any god.', { size: 16, fill: color.ink, wrap: area.w }),
      w ? kit.text(`${gods.rows[w.god]?.name.split(',')[0]}'s wrath: ${w.turns} turns`, { size: 16, fill: color.hp }) : null,
      kit.text(shrineNote(deps.game), { size: 14, fill: color.ash, wrap: area.w })].filter(Boolean), space.betweenRows);
  }
  const redraw = () => deps.reopen?.();
  // CSS-19 (1.7 painted-ui.css:490, 869, 878 --god-col): the section headings and the rank marks in the god's colour.
  const god = toNum(f.colour), godHead = words => heading(kit, words, null, Infinity, god);
  const nums = [...(f.amusement !== null && f.amusement !== undefined ? [['Amusement', `${f.amusement} / 100`]] : []), ['Rank', `${f.rank} / ${f.maxRank}`], ['Piety', f.next !== null ? `${f.piety} / ${f.next}` : String(f.piety)], ['Favor', `${f.favor} / ${f.favorCap}`],
    // CF46 (1.7 pietyDepthText, gods.js:181): the floor's worth as a number, its sentence on hover or a tap.
    ...(f.depth ? [['Depth', `×${f.depth.toFixed(2)}`, { detail: { title: 'Depth', lines: [`Piety earned here is worth ×${f.depth.toFixed(2)}. Favor is not multiplied.`] } }]] : [])];
  const gain = f.gain ? `Piety from: ${f.gain}` : null;
  const who = w => stack(nameplate(kit, f.name, cap(f.title), god, false, w), space.inRow);
  // Item 330: the Faith tab lists only rewards unlocked at the hero's current rank.
  const boonList = w => stack(f.boons.filter(b => b.have).map(b => {
    const c = new Container();
    const rank = kit.text(`rank ${b.rank}`, { size: 14, fill: god, weight: '600' });
    const name = kit.text(b.name, { size: 16, fill: kit.accent, wrap: w - rank.width - space.betweenRows });
    rank.position.set(w - rank.width, Math.round((name.height - rank.height) / 2));
    c.addChild(name, rank);
    const said = boonWords(b.id, f.rank);
    const words = said ? kit.text(said, { size: 14, fill: color.ink, wrap: w }) : null;
    if (words) { words.y = name.height; c.addChild(words); }
    c.addChildAt(new Graphics().rect(0, 0, w, Math.max(c.height, kit.stage.touch ? kit.target : 0)).fill({ color: 0, alpha: 0.001 }), 0);
    kit.details(c, { title: b.name, sub: `Rank ${b.rank}`, lines: said ? [said] : [] });
    c.label = 'boon-' + b.id;
    return c;
  }), space.betweenRows);
  // CSS-18 (1.7 painted-ui.css:1143-1144): on a wide screen (900 by 600 CSS px) each prayer says what it does under
  // its name. No Pray plate: 1.7 dropped it ("abilities are cast from the hotbar", Justin 2026-10-15, gods.js:261).
  const st = kit.stage, roomy = st.kind === 'L' && st.w * st.s >= 900 && st.h * st.s >= 600;
  const prs = f.prayers.filter(p => p.have).map(p => ({
    icon: p.icon, tile: true, name: p.name, words: full && roomy ? ACTION[p.id] : undefined, drag: { kind: 'prayer', id: p.id },
    // RB41 (1.7 renderFaithPane): a tap prays; one that needs a tile chosen (Blink) is aimed from the hotbar.
    act: p.kind === 'prayer' && p.aim !== 'tile' ? () => { deps.command?.({ type: 'pray', prayer: p.id }); deps.reopen?.(); } : undefined,
    num: p.left ? `${p.left} turns` : p.health ? `${p.health} HP` : p.favor ? `${p.favor} favor` : 'ready',
    detail: actionDetail(p.id, p.name, p.left ? `Ready in ${p.left} turns` : null, deps.hero, deps.game),
  }));
  if (P) {
    const w = area.w;
    const about = deps.text?.(`god.${f.id}.summary`) ?? GOD[f.id]?.blurb;
    // CF48 (1.7 renderFaithPane's faith-art, gods.js:249): the god's statue on a phone too, beside the name and title.
    const top = new Container(), sw = 96, sh = 112;
    top.addChild(new Graphics().rect(0, 0, sw, sh).fill({ color: 0, alpha: 0.001 }));
    const statue = shrine(f.id, sh, redraw);
    if (statue) { statue.position.set(sw / 2, sh); top.addChild(statue); }
    const tw = w - sw - space.betweenSections;
    const side = stack([who(tw), about ? kit.text(about, { size: 14, fill: color.ash, wrap: tw }) : null].filter(Boolean), space.betweenRows);
    side.position.set(sw + space.betweenSections, Math.max(0, Math.round((sh - side.height) / 2)));
    top.addChild(side);
    return stack([
      top, pairs(kit, nums, w, w >= 300 ? 2 : 1),
      (GOD[f.id]?.rule ?? f.rule) ? kit.text(`Rule: ${GOD[f.id]?.rule ?? f.rule + '.'}`, { size: 14, fill: color.ash, wrap: w }) : null,
      gain ? kit.text(gain, { size: 14, fill: color.ash, wrap: w }) : null,
      godHead('Boons'), boonList(w),
      godHead('Prayers'), lines(kit, prs, w, 1),
    ].filter(Boolean), space.betweenRows);
  }
  // Keep the identity together above three aligned columns; descriptions stay native-sized.
  const usable = area.w - sec * 4, devotionW = Math.max(160, Math.floor(usable * 0.24));
  const boonW = Math.floor((usable - devotionW) * 0.56), prayerW = usable - devotionW - boonW;
  const xs = [0, devotionW + sec * 2, devotionW + boonW + sec * 4];
  const c = new Container();
  const statueH = 112, sw = 112;
  c.addChild(new Graphics().rect(0, 0, sw, statueH).fill({ color: 0, alpha: 0.001 }));
  const statue = shrine(f.id, statueH, redraw);
  if (statue) { statue.position.set(sw / 2, statueH); c.addChild(statue); }
  const about = deps.text?.(`god.${f.id}.summary`) ?? GOD[f.id]?.blurb;
  const head = stack([
    ...nameplate(kit, f.name, cap(f.title), god, true, area.w - sw - sec),
    // The description and the rule in one voice: same size, same colour, neither bold (Justin 10-16).
    about ? kit.text(about, { size: 14, fill: color.ash, wrap: area.w - sw - sec }) : null,
    // 1.7's whole rule, not its short form (proof pass item 18: 'Rule: Forbids shadow.').
    (GOD[f.id]?.rule ?? f.rule) ? kit.text(`Rule: ${GOD[f.id]?.rule ?? f.rule + '.'}`, { size: 14, fill: color.ash, wrap: area.w - sw - sec }) : null,
    gain ? kit.text(gain, { size: 14, fill: color.ash, wrap: area.w - sw - sec }) : null,
  ].filter(Boolean), space.inRow);
  head.position.set(sw + sec, Math.max(0, Math.round((statueH - head.height) / 2)));
  const low = Math.max(statueH, head.y + head.height) + sec;
  const col1 = stack([godHead('Devotion'), pairs(kit, nums, devotionW, 1)], space.betweenRows);
  const col2 = stack([godHead('Boons'), boonList(boonW)], space.betweenRows);
  const col3 = stack([godHead('Prayers'), lines(kit, prs, prayerW, 1)], space.betweenRows);
  const rule = new Graphics().rect(0, low - sec / 2, area.w, 1).fill({ color: color.rest, alpha: 0.35 });
  [col1, col2, col3].forEach((col, i) => { col.position.set(xs[i], low); c.addChild(col); });
  c.addChild(head, rule);
  return c;
}
