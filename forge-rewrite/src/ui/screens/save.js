// Save (in play) and Load (from the title): one line per slot (name, what it holds, when, its action word),
// then export and import, then leaving. A step that loses something asks once, on the same line.

import { Container } from '../../../../forge-godot/runtime/pixi.js';
import { color, space } from '../core/widgets.js';
import { stack, row, flow } from '../core/layout.js';
import { heading } from '../core/blocks.js';
import { endsRun } from './popups.js';

const SLOT_NAMES = { auto: 'Autosave', 1: 'Slot 1', 2: 'Slot 2', 3: 'Slot 3', sandbox: 'Sandbox' };
// Item 179: a sandbox run saves only to its own slot, so in one the Save window lists that alone; Load lists it last.
const ORDER = ['auto', '1', '2', '3'];
let asking = null;
export const saveFresh = () => { asking = null; };   // a fresh open asks nothing

function when(t) {
  if (!t) return '';
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function wrapped(nodes, w) {
  const c = new Container(); c.addChild(...nodes.filter(Boolean));
  flow(c.children, w, space.betweenRows, space.betweenRows); return c;
}

function slotLine(kit, w, id, s, actions) {
  const c = new Container();
  const name = kit.text(SLOT_NAMES[id] ?? id, { size: 16, font: 'display', fill: color.ink });
  const words = row(actions, space.betweenRows);
  // Wide: the slot's name in its own column. Narrow (phones): the name above what it holds, so nothing wraps thin.
  const narrow = w < 420, left = narrow ? 0 : 110;
  const below = w - left - words.width - space.betweenSections < 140;
  const room = below ? w - left : w - left - words.width - space.betweenSections;
  const what = kit.text(s ? s.label || 'Saved run' : 'Empty', { size: 14, fill: s ? color.ash : color.dim, wrap: room });
  const at = kit.text(when(s?.savedAt), { size: 12, fill: color.dim, wrap: room });
  const top = narrow ? name.height : 0;
  const block = top + what.height + (s ? at.height : 0);
  const h = Math.max(kit.target, narrow ? block : name.height, block);
  name.y = narrow ? Math.round((h - block) / 2) : (h - name.height) / 2;
  what.position.set(left, (narrow ? name.y : Math.round((h - block) / 2)) + top); at.position.set(left, what.y + what.height);
  words.position.set(below ? left : w - words.width, below ? h + space.inRow : (h - words.height) / 2);
  c.addChild(name, what, at, words);
  if (!s) at.visible = false;
  return c;
}

/** A line that asks before something is lost: the question, then the two words. */
function ask(kit, words, yes, onYes, ctx, w = Infinity) {
  const q = kit.text(words, { size: 14, fill: color.ash, wrap: w });
  const plates = wrapped([kit.plateButton(yes, () => { asking = null; onYes(); }, { h: Math.max(36, kit.target), size: 16, rank: 'prominent' }), kit.plateButton('Cancel', () => { asking = null; ctx.reopen(); }, { h: Math.max(36, kit.target), size: 16 })], w);
  // A phone: the question above its two words, so nothing runs past the window.
  return q.width + space.betweenRows + plates.width > w ? stack([q, plates], space.inRow) : row([q, plates], space.betweenRows);
}

function download(text, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function pickFile(onText) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,application/json';
  input.onchange = () => input.files?.[0]?.text().then(onText);
  input.click();
}

function fileWords(kit, ctx, canExport, cont = null, w = Infinity) {
  const d = ctx.deps;
  const pick = () => pickFile(t => { const r = d.importSave(t); if (r !== true) ctx.ui.say?.(typeof r === 'string' ? r : 'That file is not a save.', color.hp); ctx.reopen(); });
  // Sandbox item 81: from the title, Import asks first when a run would be replaced (popups.js endsRun).
  if (cont && asking === 'import') { const e = endsRun(cont, 'Import', pick); return ask(kit, `${e.question} ${e.text}`, e.yes, e.onYes, ctx, w); }
  return wrapped([
    canExport ? kit.plateButton('Export to file', () => download(d.exportSave(), d.exportName?.() ?? 'forge-save.json'), { h: Math.max(36, kit.target), size: 16 }) : null,
    Object.assign(kit.plateButton('Import from file', () => { if (cont) { asking = 'import'; ctx.reopen(); } else pick(); }, { h: Math.max(36, kit.target), size: 16 }), { label: 'import-file' }),
  ], w);
}

/** In play: save to a slot, export or import, quit to the title. */
export function buildSave(kit, area, ctx) {
  const d = ctx.deps, list = d.slots(), dead = ctx.game?.over;
  const lines = (ctx.game?.sandbox ? ['sandbox'] : ORDER).map(id => {
    const s = list[id] ?? null;
    if (asking === 'over-' + id) return ask(kit, `Overwrite ${SLOT_NAMES[id]}?`, 'Overwrite', () => { d.saveSlot(id); ctx.reopen(); }, ctx, area.w);
    const acts = id === 'auto' || dead ? [] : [Object.assign(kit.plateButton(s ? 'Overwrite' : 'Save', () => { if (s) { asking = 'over-' + id; ctx.reopen(); } else { d.saveSlot(id); ctx.reopen(); } }, { h: Math.max(36, kit.target), size: 16 }), { label: (s ? 'overwrite-' : 'save-') + id })];
    return slotLine(kit, area.w, id, s, acts);
  });
  // W41 (1.7 saveHTML, options.js:223-228): Leave holds Quit to title and Exit game; each asks once on its own line.
  // Exit game (1.7 exitGame, save.js:302): back to the title, then the window closes where the browser allows it.
  const exit = () => { d.quitToTitle(); try { window.close(); } catch { /* a tab the page did not open stays */ } };
  const leave = asking === 'quit'
    ? ask(kit, 'Progress since your last save is lost.', 'Quit', () => d.quitToTitle(), ctx, area.w)
    : asking === 'exit'
      ? ask(kit, 'Progress since your last save is lost.', 'Exit', exit, ctx, area.w)
      : wrapped([Object.assign(kit.plateButton('Quit to title', () => { asking = 'quit'; ctx.reopen(); }, { h: Math.max(36, kit.target), size: 16 }), { label: 'quit-title' }),
        Object.assign(kit.plateButton('Exit game', () => { asking = 'exit'; ctx.reopen(); }, { h: Math.max(36, kit.target), size: 16 }), { label: 'exit-game' })], area.w);
  leave.x = 0;
  const files = fileWords(kit, ctx, !dead, null, area.w); files.x = 0;
  // 1.7: a dead hero's Save game section says so in place of the slots.
  const slotsOrDead = dead ? [kit.text('The dead cannot be saved.', { size: 14, fill: color.ash })] : lines;
  return stack([heading(kit, 'Save game'), ...slotsOrDead, files, heading(kit, 'Leave'), leave], space.betweenSections);
}

/** From the title: load or delete a slot, import a file. */
export function buildLoad(kit, area, ctx) {
  const d = ctx.deps, list = d.slots(), cont = d.hasContinue?.() ?? null;
  const lines = (list.sandbox ? [...ORDER, 'sandbox'] : ORDER).map(id => {
    const s = list[id] ?? null;
    if (asking === 'del-' + id) return ask(kit, `Delete ${SLOT_NAMES[id]}?`, 'Delete', () => { d.deleteSlot(id); ctx.reopen(); }, ctx, area.w);
    // Sandbox item 81: loading another run asks first while Continue holds one; loading that same run does not, nor a
    // sandbox run, which saves to its own slot and leaves Continue's run as it is.
    const ends = cont && s && id !== 'sandbox' && s.line !== cont.line ? endsRun(cont, 'Load', () => d.loadSlot(id)) : null;
    if (ends && asking === 'load-' + id) return ask(kit, `${ends.question} ${ends.text}`, ends.yes, ends.onYes, ctx, area.w);
    const load = () => { if (ends) { asking = 'load-' + id; ctx.reopen(); } else d.loadSlot(id); };
    const acts = s ? [Object.assign(kit.plateButton('Load', load, { h: Math.max(36, kit.target), size: 16, rank: 'prominent' }), { label: 'load-' + id }), Object.assign(kit.plateButton('Delete', () => { asking = 'del-' + id; ctx.reopen(); }, { h: Math.max(36, kit.target), size: 16 }), { label: 'delete-' + id })] : [];
    return slotLine(kit, area.w, id, s, acts);
  });
  const files = fileWords(kit, ctx, false, cont, area.w); files.x = 0;
  // The import word gets its own room below the slots (Justin 10-16: it crowded them).
  return stack([stack(lines, space.betweenRows), files], space.betweenSections * 2);
}
