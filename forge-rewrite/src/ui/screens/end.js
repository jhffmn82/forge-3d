
import { Container, Graphics, Sprite, Texture, Rectangle } from '../../../../forge-godot/runtime/pixi.js';
import { color, space, CARD } from '../core/widgets.js';
import { scrollable, SCROLLBAR } from '../core/scroll.js';
import { stack, row, grid, flow } from '../core/layout.js';
import { sixGemFrame, sixGemInset } from '../core/plates.js';
import { whoLine } from '../model/hero-view.js';
import { runRecord, scoreBreakdown, reportText } from '../../engine/reads.js';   // C17: the rules' answers through the engine (PLAN section 2)
import { VERSION } from '../../data/version.js';
import { biomePlace, say } from '../model/words.js';
import { elementPalette, toCss } from '../core/colour.js';

/** 1.7's end-screen element dots, fire to shadow (run-events.js:118; ui.json elementPalettes.end). */
const ELEMENT_DOTS = Object.values(elementPalette('end')).map(toCss);

/** CSS-21 (1.7 run-history.js:215): six 10 px dots 12 apart, each on a soft glow of its own colour (box-shadow 0 0
 *  14px), drawn once on a canvas at twice the size. Its pad is the glow's reach around the dots. */
let dotsTex = null;
const DOT_PAD = 20;
function elementDots() {
  if (!dotsTex) {
    const R = 2, W = (5 * 22 + 10 + DOT_PAD * 2) * R, H = (10 + DOT_PAD * 2) * R;
    const c = Object.assign(document.createElement('canvas'), { width: W, height: H }), g = c.getContext('2d');
    g.scale(R, R);
    ELEMENT_DOTS.forEach((col, i) => {
      g.save(); g.shadowColor = col; g.shadowBlur = 14 * R; g.fillStyle = col;
      g.beginPath(); g.arc(DOT_PAD + 5 + i * 22, DOT_PAD + 5, 5, 0, Math.PI * 2); g.fill(); g.restore();
    });
    dotsTex = Texture.from({ resource: c, resolution: R, scaleMode: 'linear' });
  }
  const box = new Container(), s = new Sprite(dotsTex);
  s.position.set(-DOT_PAD, -DOT_PAD);
  box.addChild(s);
  box.boundsArea = new Rectangle(0, 0, 5 * 22 + 10, 10);
  return box;
}

/** The run's numbers as the end screen shows them. */
export function endView(state) {
  const h = state.hero ?? {}, p = state.actors[state.playerId];
  const won = !!state.won;
  const s = state.finished ?? runRecord(state, won);
  return {
    won,
    title: won ? 'The Forge of the Elements is restored' : 'Your journey ends here',
    name: h.name ?? p.name, who: whoLine(h),
    story: won ? 'You defeated the Unmaker and restored balance to the material plane. Fire, water, air, earth, light and shadow burn in harmony once more. Your work is done.'
      : `Floor ${state.floorNo} of ${biomePlace(state.where)} claimed another adventurer. Your journey is remembered.`,
    score: s.score ?? null,
    scoreLabel: `${s.earningsEstimated ? 'Estimated final score' : 'Final score'}${s.sandbox ? ' · sandbox' : ''}`,
    note: s.sandbox ? 'Sandbox run: not added to Previous Runs.' : state.historySaved === false ? 'Local storage is unavailable. This result is kept for this session only.' : null,
    earned: state.earned ?? [],
    patron: s.faith || 'No patron',
    affinities: (s.affinities ?? []).map(a => `${a.element[0].toUpperCase()}${a.element.slice(1)} ${a.rank}`).join(' · '),
    breakdown: scoreBreakdown(s), record: s,
    cells: [
      ['Deepest floor', s.depth], ['Level', h.level ?? 1], ['Bosses defeated', s.bosses],
      ['Enemies defeated', s.kills], ['Turns', s.turns], ['Faith', s.faithRank ? `Rank ${s.faithRank}` : 'None'],
    ],
  };
}

/** The six numbers: each a dark block w wide, the label above, the number beneath (1.7's end screen). Every block is
 *  as tall as the tallest, as 1.7's grid stretched them, so a label wrapped to two lines stays inside its own. */
function numberCells(kit, cells, w) {
  const words = cells.map(([label, value]) => {
    const l = kit.text(label, { size: 14, fill: color.ash, wrap: w - 8, align: 'center' });
    const v = kit.text(String(value), { size: 20, font: 'display', fill: color.ink, wrap: w - 8, align: 'center' });
    l.anchor.set(0.5, 0); v.anchor.set(0.5, 0);
    l.position.set(w / 2, 6); v.position.set(w / 2, 6 + l.height + 4);
    return [l, v];
  });
  const h = Math.max(...words.map(([l, v]) => l.height + v.height + 16));
  return { h, cells: words.map(([l, v]) => { const c = new Container(); c.addChild(kit.sheet(w, h, CARD, 0.75), l, v); return c; }) };
}

/**
 * Item 162 (1.7 painted-ui.css:967-990): which of 1.7's end screens a stage gets, by its size in CSS px. A short screen
 * (500 tall or less) puts the hero and the score beside the numbers; a small phone (420 wide or less, 760 tall or less)
 * keeps one column, as 1.7's later rule wins where both hold; both drop the story line. Every other screen is one
 * centred column. The numbers are three across on all of them.
 * @param {{w:number, h:number, s:number}} st
 */
export function endLayout(st) {
  const cssW = st.w * st.s, cssH = st.h * st.s, short = cssH <= 500, small = cssW <= 420 && cssH <= 760;
  return { short, small, beside: short && !small, story: !short && !small };
}

/** CSS-21 (painted-ui.css:320, 411, 991, 1172): the score in blackletter in the highlight at 48 px, 40 on a short
 *  screen, 36 on a small phone. The kit's largest step is 40, so the words are drawn sharper and scaled to fit. */
function scoreText(kit, score, look) {
  const px = look.short ? 40 : look.small ? 36 : 48, k = px / 40;
  const t = kit.text(String(score), { size: 40, font: 'display', weight: '700', fill: kit.accent });
  t.resolution *= k; t.scale.set(k);
  return t;
}

/**
 * @param {ReturnType<import('../core/widgets.js').createKit>} kit
 * @param {any} state
 * @param {{playAgain?:()=>void, title:()=>void, open?:(name:string, arg?:any)=>void}} acts
 */
export function buildEnd(kit, state, acts) {
  const st = kit.stage, P = st.kind === 'P', look = endLayout(st), root = new Container(), v = endView(state);
  root.addChild(new Graphics().rect(-st.ox / st.s, -st.oy / st.s, st.w + 2 * st.ox / st.s, st.h + 2 * st.oy / st.s).fill({ color: color.bg, alpha: 0.7 }));
  const fw = P ? 36 : 64, inset = sixGemInset(fw) + (P ? space.betweenRows : space.betweenSections);
  const w = P ? st.w - space.betweenRows * 2 : look.beside ? Math.floor(Math.min(760, st.w * st.s - 24) / st.s) : kit.textScale > 1 ? 740 : 610, innerW = w - inset * 2 - (P || look.short ? SCROLLBAR.w + SCROLLBAR.gap : 0);
  const centre = (n, within = innerW) => { n.x = Math.round((within - n.width) / 2); return n; };
  const gap = space.betweenSections + space.betweenRows;
  const lw = look.beside ? Math.floor((innerW - gap) / 2.3) : innerW, rw = look.beside ? innerW - gap - lw : innerW;
  const cw = Math.floor((rw - space.betweenRows * 2) / 3);
  const { cells, h: ch } = numberCells(kit, v.cells, cw);
  const stats = grid(cells, 3, cw, ch, space.betweenRows, space.betweenRows);
  const hero = [
    centre(elementDots(), lw),
    centre(kit.text(v.name, { size: 20, font: 'display', fill: color.ink, wrap: lw, align: 'center' }), lw),
    centre(kit.text(v.who, { size: 16, fill: color.ash, align: 'center', wrap: lw }), lw),
  ];
  const story = look.story && v.story ? centre(kit.text(v.story, { size: 16, fill: color.ash, align: 'center', wrap: lw }), lw) : null;
  const score = v.score !== null ? stack([
    centre(scoreText(kit, v.score, look), lw),
    centre(kit.text(v.scoreLabel, { size: 14, fill: color.ash, wrap: lw, align: 'center' }), lw),
  ], space.betweenRows) : null;
  const aff = centre(kit.text(v.affinities ? `${v.patron}\n${v.affinities}` : v.patron, { size: 14, fill: color.ash, align: 'center', wrap: rw }), rw);
  const why = kit.text('How this score was earned', { size: 14, fill: kit.accent, wrap: rw - 20 });
  const tri = Math.round(why.height * 0.32), arrow = new Graphics().poly([0, 0, tri * 1.2, tri, 0, tri * 2]).fill({ color: kit.accent });
  arrow.y = Math.round(why.height / 2 - tri); why.x = tri * 1.2 + space.betweenRows;
  const whyBox = new Container();
  whyBox.addChild(new Graphics().rect(0, 0, why.x + why.width, Math.max(why.height + 8, kit.target)).fill({ color: 0, alpha: 0.001 }), arrow, why);
  kit.details(whyBox, { title: 'Final score', rows: v.breakdown.rows, lines: [v.breakdown.words] });
  whyBox.label = 'end-breakdown';
  let middle;
  if (look.beside) {
    const used = hero.reduce((n, t) => n + t.height, 0) + space.betweenRows * 2;
    const band = Math.max(stats.height, used), extra = (band - used) / 3;
    let y = 0;
    for (const t of hero) { t.y = Math.round(y); y += t.height + space.betweenRows + extra; }
    const right = stack([aff, whyBox], space.betweenRows);
    stats.x = right.x = lw + gap; right.y = band + space.betweenRows;
    if (score) score.y = right.y;
    middle = new Container();
    middle.addChild(...hero, stats, ...(score ? [score] : []), right);
  } else middle = stack([stack([...hero, story]), score, stack([stats, aff, whyBox])], space.betweenSections);
  const earned = v.earned.length ? stack([
    centre(kit.text('New achievements', { size: 12, fill: color.ash })),
    centre(kit.text(v.earned.join(' · '), { size: 14, fill: kit.accent, align: 'center', wrap: innerW })),
  ], space.inRow) : null;
  const note = v.note ? centre(kit.text(v.note, { size: 14, fill: color.ash, align: 'center', wrap: innerW })) : null;
  if (keep.run !== (state.runId ?? state.seed)) { keep.run = state.runId ?? state.seed; keep.words = null; }
  const saveWin = v.won && !state.sandbox && acts.saveWin ? kit.plateButton(keep.words ?? 'Save this character', () => {
    if (keep.words) return;
    const r = acts.saveWin();
    keep.words = r?.slot ? `Saved to slot ${r.slot}` : r?.full ? 'All slots full: free one in Load Game' : 'Saving failed';
    acts.redraw?.();
  }, { h: Math.max(40, kit.target), size: 18 }) : null;
  if (saveWin) { saveWin.label = 'end-save'; if (keep.words) saveWin.alpha = 0.6; }
  // Item 227 (Justin 2026-10-19: "the play again button after death"): after a fall, Play again first, the same
  // character from floor 1 with no creation. No New run: Title screen leads there ("exit to main menu already covers
  // that").
  const again = !v.won && acts.playAgain, plate = (words, act, label, prominent) => { const b = kit.plateButton(words, act, { rank: prominent ? 'prominent' : undefined, h: Math.max(40, kit.target), size: 18 }); if (label) b.label = label; return b; };
  const plates = [
    again ? plate('Play again', acts.playAgain, null, true) : null,
    plate('Journal', () => acts.open?.('Journal'), 'end-journal'),
    plate('Run report', () => acts.open?.('Report', v.record), 'end-report'),
    saveWin,
    plate('Title screen', acts.title),
  ].filter(Boolean);
  const buttons = new Container();
  plates.forEach(b => buttons.addChild(b));
  flow(plates, innerW, space.betweenRows, space.betweenRows);
  const rows = new Map();
  for (const b of plates) rows.set(b.y, [...(rows.get(b.y) ?? []), b]);
  for (const r of rows.values()) { const last = r[r.length - 1], dx = Math.round((innerW - (last.x + last.width)) / 2); r.forEach(b => { b.x += dx; }); }
  const body = stack([
    centre(kit.text(v.title, { size: look.short ? 20 : 26, font: 'display', fill: kit.accent, align: 'center', wrap: innerW })),
    middle, earned, note,
  ].filter(Boolean), space.betweenSections);
  const maxH = st.h - 16;
  const naturalH = Math.max(body.height + buttons.height + space.betweenSections * 2 + inset * 2, P || look.beside ? 0 : Math.min(655, st.h - 120));
  const h = Math.min(maxH, naturalH);
  let room = h - inset * 2 - buttons.height - space.betweenSections;
  const summaryNav = body.height > room + 1 ? row([
    Object.assign(kit.button('‹', () => content.scrollBy(-Math.max(kit.target, room - space.betweenSections)), { size: 26, font: 'body' }), { label: 'end-summary-prev' }),
    kit.text(say('end.summary'), { size: 14, fill: color.ash }),
    Object.assign(kit.button('›', () => content.scrollBy(Math.max(kit.target, room - space.betweenSections)), { size: 26, font: 'body' }), { label: 'end-summary-next' }),
  ], space.betweenRows) : null;
  if (summaryNav) room -= summaryNav.height + space.betweenRows;
  const frame = new Container(); frame.addChild(sixGemFrame(w, h, fw));
  const content = scrollable(body, { w: innerW, h: room });
  content.position.set(inset, inset); buttons.position.set(inset, h - inset - buttons.height);
  frame.addChild(content, buttons);
  if (summaryNav) { summaryNav.position.set(inset + Math.round((innerW - summaryNav.width) / 2), buttons.y - summaryNav.height - space.betweenRows); frame.addChild(summaryNav); }
  frame.position.set(Math.round((st.w - w) / 2), Math.round((st.h - h) / 2));
  root.addChild(frame);
  return root;
}

/**
 * Run report (1.7 run-history.js openReport): the run as text to copy and share, Copy report, and Back to the summary.
 * The canvas cannot select text, so Copy writes it to the clipboard and says whether that worked.
 * @param {ReturnType<import('../core/widgets.js').createKit>} kit
 * @param {{w:number,h:number}} area
 * @param {any} ctx
 */
export function buildRunReport(kit, area, ctx) {
  const rec = ctx.arg ?? runRecord(ctx.game ?? {}, !!ctx.game?.won);
  const text = reportText(rec, ctx.deps?.journal?.()?.achievements ?? null, VERSION);
  if (reportNotice.text !== text) { reportNotice.text = text; reportNotice.page = 0; }
  const note = kit.text('Copy this report to share your build and how the run ended.', { size: 14, fill: color.ash, wrap: area.w });
  const said = kit.text(reportNotice.words, { size: 14, fill: color.ash, wrap: area.w });
  const copy = kit.plateButton('Copy report', () => {
    copyText(text).then(ok => { reportNotice.words = ok ? 'Report copied.' : 'Copy unavailable on this device.'; ctx.reopen?.(); });
  }, { rank: 'prominent', h: Math.max(40, kit.target), size: 18 });
  const fromJournal = ctx.arg?.from === 'journal';
  const back = kit.plateButton(fromJournal ? 'Previous runs' : 'Summary', () => { reportNotice.words = ''; if (fromJournal && ctx.open) ctx.open('Journal'); else ctx.close(); }, { h: Math.max(40, kit.target), size: 18 });
  const actions = new Container(); actions.addChild(copy, back); flow(actions.children, area.w, space.betweenRows, space.betweenRows);
  const room = Math.max(80, area.h - note.height - actions.height - (reportNotice.words ? said.height + space.betweenRows : 0) - kit.target - space.betweenRows * 5 - 16);
  const pages = [[]]; let used = 0;
  for (const line of text.split('\n')) {
    const probe = kit.text(line || ' ', { size: 14, wrap: area.w - 16 }), height = probe.height; probe.destroy();
    if (kit.stage.kind === 'L' && !kit.stage.touch && pages.at(-1).length && used + height > room) { pages.push([]); used = 0; }
    pages.at(-1).push(line); used += height;
  }
  const page = Math.min(reportNotice.page, pages.length - 1);
  const body = kit.text(pages[page].join('\n'), { size: 14, fill: color.ink, wrap: area.w - 16 }), sheet = new Container();
  sheet.addChild(kit.sheet(area.w, body.height + 16, CARD, 0.75)); body.position.set(8, 8); sheet.addChild(body);
  const go = n => { reportNotice.page = n; ctx.reopen(); };
  const nav = pages.length > 1 ? row([
    kit.button('‹', () => go(Math.max(0, page - 1)), { size: 26, dim: page === 0 }),
    kit.text((page + 1) + ' / ' + pages.length, { size: 14, fill: color.ash }),
    kit.button('›', () => go(Math.min(pages.length - 1, page + 1)), { size: 26, dim: page === pages.length - 1 }),
  ], space.betweenRows) : null;
  if (nav) nav.x = Math.round((area.w - nav.width) / 2);
  actions.x = Math.round((area.w - actions.width) / 2);
  return stack([note, sheet, nav, reportNotice.words ? said : null, actions], space.betweenRows);
}

/** RB12: what Save this character said, kept for the run whose end screen is up. */
const keep = { run: null, words: null };

/** What the last Copy did, kept while the report is open. */
const reportNotice = { words: '', text: '', page: 0 };

/**
 * EP37 (1.7 openReport's Copy): embedded hosts such as itch's frame may deny the Clipboard API, so the text is first
 * copied from a hidden, off-screen field during the click, while the browser still grants the gesture; the Clipboard
 * API is the fallback. Resolves true when either worked. doc and nav are for the test.
 * @param {string} text @returns {Promise<boolean>}
 */
export function copyText(text, doc = globalThis.document, nav = globalThis.navigator) {
  try {
    if (doc?.execCommand && doc.body) {
      const field = doc.createElement('textarea');
      field.value = text; field.readOnly = true;
      field.setAttribute('aria-hidden', 'true');
      field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      doc.body.appendChild(field);
      field.select(); field.setSelectionRange?.(0, text.length);
      let ok = false;
      try { ok = !!doc.execCommand('copy'); } catch { ok = false; }
      field.remove();
      if (ok) return Promise.resolve(true);
    }
  } catch { /* fall through to the Clipboard API */ }
  try {
    if (typeof nav?.clipboard?.writeText !== 'function') return Promise.resolve(false);
    return nav.clipboard.writeText(text).then(() => true, () => false);
  } catch { return Promise.resolve(false); }
}
