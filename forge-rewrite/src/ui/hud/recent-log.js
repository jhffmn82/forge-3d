// The HUD keeps the last three commands that produced messages (item 326, Justin 2026-10-23). Quiet commands and
// elapsed time leave those messages in place, on every device. A command starts a batch only when its first line arrives.
// A line said again in the same command reads "x2" instead of a second line, and pick-ups in one command gather on
// one line ("You pick up A, B x2."), at most four, as 1.7's receipts. A warning never merges.

const KEEP_BATCHES = 3, MAX_PARTS = 4;
// 1.7's receipt lines: the prefix that gathers, how the parts join, the end.
const GATHER = [/^(You pick up )(.+)(\.)$/, /^(Picked up )(.+)(\.)$/];

/** @param {{later?:(fn:()=>void)=>void}} [o] */
export function createRecentLog(o = {}) {
  const later = o.later ?? (fn => setTimeout(fn, 0));
  let entries = [], batch = 0, seq = 0, open = false, settling = false, pending = false;
  const textOf = e => {
    if (e.parts) {
      const counted = [];
      for (const p of e.parts) { const c = counted.find(x => x.p === p); if (c) c.n += 1; else counted.push({ p, n: 1 }); }
      return e.prefix + counted.map(c => (c.n > 1 ? `${c.p} ×${c.n}` : c.p)).join(', ') + e.suffix;
    }
    return e.n > 1 ? `${e.words} ×${e.n}` : e.words;
  };
  return {
    /** A command starts; it counts toward retention only if it says something before end(). */
    begin() { open = true; pending = true; },
    /** The command's results have all been said. */
    end() { open = false; },
    /** @param {string} words @param {number} fill @param {{warning?:boolean, marks?:{from:number,to:number,fill:number}[]}} [m] */
    add(words, fill, m = {}) {
      // A line outside a command starts its own batch; the lines said with it in the same task join it (1.7 settle).
      if (!open && !settling) { this.begin(); open = false; settling = true; later(() => { settling = false; }); }
      if (pending) { batch += 1; pending = false; entries = entries.filter(e => e.batch > batch - KEEP_BATCHES); }
      const warning = !!m.warning;
      const prev = entries[entries.length - 1];
      const same = prev && !warning && !prev.warning && prev.batch === batch && prev.fill === fill;
      const g = warning ? null : GATHER.map(re => re.exec(words)).find(Boolean);
      if (same && g && prev.parts && prev.prefix === g[1] && prev.parts.length < MAX_PARTS) prev.parts.push(g[2]);
      else if (same && !prev.parts && prev.words === words) prev.n += 1;
      else entries.push({ id: ++seq, batch, words, fill, warning, n: 1, marks: m.marks?.length ? m.marks : null, ...(g ? { prefix: g[1], parts: [g[2]], suffix: g[3] } : {}) });
    },
    /** The retained lines, oldest first, fully readable until a newer message batch replaces them. */
    lines() {
      // CB52: a gathered line's parts move its numbers, so it shows in one ink.
      return entries.map(e => ({ id: e.id, words: textOf(e), fill: e.fill, marks: e.parts ? null : e.marks, warning: e.warning, alpha: 1 }));
    },
    /** True when nothing shows. */
    get empty() { return !entries.length; },
    clear() { entries = []; batch += 1; },
  };
}
