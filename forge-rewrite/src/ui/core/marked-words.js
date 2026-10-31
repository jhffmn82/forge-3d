// A log line with marked runs (consolidation C17, U8: moved from screens/hud.js; the HUD, the log window and the popups
// draw it), and game text's markup read into those runs (unmark, gameText).

import { CanvasTextMetrics, Container } from '../../../../forge-godot/runtime/pixi.js';
import { words } from './look.js';

/**
 * P8 (1.7 log() wrote its <b> as bold: "You find a <b>hidden door</b>!"): a line's markup taken out, each bold stretch
 * kept as a mark that the HUD and the log window draw in the font's 600 weight. Any other tag is taken out unread.
 */
export function unmark(text, fill) {
  const marks = [];
  let out = '';
  for (const part of String(text).split(/(<[^>]+>)/)) {
    if (/^<b>$/i.test(part)) marks.push({ from: out.length, to: -1, fill, bold: true });
    else if (/^<\/b>$/i.test(part)) { const m = marks.at(-1); if (m && m.to < 0) m.to = out.length; }
    else if (!/^<[^>]+>$/.test(part)) out += part;
  }
  for (const m of marks) if (m.to < 0) m.to = out.length;
  return { words: out, marks: marks.filter(m => m.to > m.from) };
}

/**
 * Item 305 (Justin 2026-10-21: "the message for the element lock is borked": "Offer the lock <b>1 water mote</b>?"
 * printed its tags): game text in a window, its markup read as the log reads it, never printed. `o` is kit.text's.
 */
export function gameText(kit, text, o) {
  const { words: w, marks } = unmark(text, o.fill);
  if (!marks.length) return kit.text(w, o);
  const px = o.size ?? 16;
  return markedWords(kit, w, px, { font: o.font ?? 'body', fill: o.fill, weight: o.weight, wrap: o.wrap, align: o.align, lineHeight: Math.round(px * (kit.textScale ?? 1) * 1.3), shadow: false }, marks);
}

/**
 * CB52 (1.7 combatDamageNumber): a log line whose numbers wear their damage type's colour (marks [{from, to, fill}]),
 * laid out a run at a time and wrapped by whole words as one Text of it would be. P8 (1.7's <b> in log lines): a mark
 * with bold set is drawn in the font's 600 weight ("You find a hidden door!"). o.align 'center' centres each row.
 */
export function markedWords(kit, text, px, o, marks) {
  const runs = [];
  let at = 0;
  for (const m of [...marks].sort((a, b) => a.from - b.from)) {
    if (m.from < at || m.to > text.length) continue;
    if (m.from > at) runs.push({ s: text.slice(at, m.from), fill: o.fill, bold: false });
    runs.push({ s: text.slice(m.from, m.to), fill: m.fill ?? o.fill, bold: !!m.bold });
    at = m.to;
  }
  if (at < text.length) runs.push({ s: text.slice(at), fill: o.fill, bold: false });
  // Whole words: pieces up to and with the space after them (a number and the stop after it stay one word).
  const all = [], cur = [];
  for (const r of runs) for (const s of r.s.match(/\S+\s*|\s+/g) ?? []) { cur.push({ s, fill: r.fill, bold: r.bold }); if (/\s$/.test(s)) all.push(cur.splice(0)); }
  if (cur.length) all.push(cur.splice(0));
  const one = { ...o, wrap: undefined }, probe = words(kit, ' ', px, one), style = probe.style.clone(), lh = Number(probe.style.lineHeight) || px;
  probe.destroy();
  const heavy = style.clone();
  heavy.fontWeight = '600';
  // Trailing spaces count (the metrics alone drop them): measured against a stop and the stop taken off.
  const width = (s, b) => { const st = b ? heavy : style; return CanvasTextMetrics.measureText(s + '.', st).width - CanvasTextMetrics.measureText('.', st).width; };
  const rows = [[]];
  let rowW = 0;
  for (const w of all) {
    const full = w.reduce((n, q) => n + width(q.s, q.bold), 0), last = w.at(-1);
    const trimmed = full - width(last.s, last.bold) + width(last.s.trimEnd(), last.bold);
    if (rowW && o.wrap && rowW + trimmed > o.wrap) { rows.push([]); rowW = 0; }
    rows.at(-1).push(...w); rowW += full;
  }
  const c = new Container();
  c.eventMode = 'none';
  // A row's width without its last trailing space, for centring.
  const rowWidth = pieces => (pieces.length ? pieces.reduce((n, q) => n + width(q.s, q.bold), 0) - width(pieces.at(-1).s, pieces.at(-1).bold) + width(pieces.at(-1).s.trimEnd(), pieces.at(-1).bold) : 0);
  const widest = o.align === 'center' ? Math.max(...rows.map(rowWidth)) : 0;
  rows.forEach((pieces, i) => {
    let x = o.align === 'center' ? (widest - rowWidth(pieces)) / 2 : 0;
    for (let k = 0; k < pieces.length;) {
      let s = '';
      const { fill, bold } = pieces[k];
      while (k < pieces.length && pieces[k].fill === fill && pieces[k].bold === bold) s += pieces[k++].s;
      const t = words(kit, s, px, { ...one, fill, ...(bold ? { weight: '600' } : {}) });
      t.position.set(Math.round(x), i * lh);
      c.addChild(t);
      x += width(s, bold);
    }
  });
  return c;
}
