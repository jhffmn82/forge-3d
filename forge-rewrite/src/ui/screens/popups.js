// Small windows: the confirm popup (stairs, portals, anything that cannot be undone) and the combat log.

import { Container } from '../../../../forge-godot/runtime/pixi.js';
import { color, space } from '../core/widgets.js';
import { stack, flow } from '../core/layout.js';
import { markedWords, gameText } from '../core/marked-words.js';
import { tone } from '../core/colour.js';

/**
 * Confirm: one question and two plates, the safe one first (1.7: "Step through the portal?" Cancel, Step through).
 * ctx.arg = { question (or title), text?, figure?, warn?, yes, onYes, no?, onNo? }: figure, a drawing under the text
 * (kit => node: the Forge's sigil cost).
 */
export function buildConfirm(kit, area, ctx) {
  const a = ctx.arg ?? { question: 'Are you sure?', yes: 'Yes' };
  // Item 305: the question and its lines are game text, their markup read (the elemental lock's <b>1 water mote</b>).
  const q = gameText(kit, a.question ?? a.title, { size: 20, font: 'display', fill: kit.accent, align: 'center', wrap: area.w });
  q.x = Math.round((area.w - q.width) / 2);
  // An optional line under the question (the engine's confirm events: title, then text).
  const t = a.text ? gameText(kit, a.text, { size: 16, fill: color.ash, align: 'center', wrap: area.w }) : null;
  if (t) t.x = Math.round((area.w - t.width) / 2);
  const fig = a.figure?.(kit) ?? null;
  if (fig) fig.x = Math.round((area.w - fig.width) / 2);
  // CB42 (1.7 confirmBox's c-you line): a warning in red under it ("This would kill you.").
  const warn = a.warn ? gameText(kit, a.warn, { size: 16, fill: tone('bad'), weight: '600', align: 'center', wrap: area.w }) : null;
  if (warn) warn.x = Math.round((area.w - warn.width) / 2);
  // onNo / onYes may reopen the window that asked (the Forge does: 1.7 returns to the same tab either way).
  // An answer that reopens the window that asked hands back to it, not a fresh open (ui-23: the Forge keeps its tab).
  const answer = fn => { if (ctx.ui) { ctx.ui.handBack = true; queueMicrotask(() => { ctx.ui.handBack = false; }); } ctx.close(); fn?.(); };
  const h = Math.max(40, kit.target);
  const no = kit.plateButton(a.no ?? 'Cancel', () => answer(a.onNo), { h, size: 18 });
  const yes = a.yes ? kit.plateButton(a.yes, () => answer(a.onYes), { h, size: 18, rank: 'prominent' }) : null;
  const row = new Container();
  const buttons = [no, yes].filter(Boolean);
  flow(buttons, area.w, space.betweenRows, space.betweenRows); row.addChild(...buttons);
  row.x = Math.round((area.w - row.width) / 2);
  return stack([q, t, fig, warn, row].filter(Boolean), space.betweenSections);
}

/**
 * Combat log: the run's lines, unchanged and terse, oldest at the top (1.7's log window). The newest lines that fit
 * show on a laptop; a phone gets its one scroll over the whole history.
 */
export function buildLog(kit, area, ctx) {
  const all = ctx.ui.history ?? [];
  // G35 (1.7 combatDamageBreakdown): a hit line's numbers keep their damage type's colours here too.
  const lh = Math.round(16 * (kit.textScale ?? 1) * 1.3);
  const parts = all.map(l => l.marks?.length ? markedWords(kit, l.words, 16, { font: 'body', fill: l.fill ?? color.ash, wrap: area.w, lineHeight: lh, shadow: false }, l.marks) : kit.text(l.words, { size: 16, fill: l.fill ?? color.ash, wrap: area.w }));
  if (!parts.length) return kit.text('Nothing has happened yet.', { size: 16, fill: color.dim });
  if (kit.stage.kind === 'L') {
    let h = 0, from = parts.length;
    while (from > 0 && h + parts[from - 1].height + 2 <= area.h) { from -= 1; h += parts[from].height + 2; }
    parts.slice(0, from).forEach(p => p.destroy());
    return stack(parts.slice(from), 2);
  }
  return stack(parts, 2);
}

/**
 * Sandbox item 81: the ask before New Game, Load or Import replaces a run that Continue would resume. `cont` is
 * hasContinue()'s { line: 'Naela, level 20, floor 21' }; `what` names the action ('New Game', 'Load', 'Import'). Open it
 * with ui.open('Confirm', endsRun(cont, 'New Game', go)); Cancel leaves the title as it was.
 */
export function endsRun(cont, what, onYes) {
  return { question: `${what}?`, text: `This ends ${cont.line}.`, yes: what === 'New Game' ? 'Start over' : what, no: 'Keep my run', onYes };
}
