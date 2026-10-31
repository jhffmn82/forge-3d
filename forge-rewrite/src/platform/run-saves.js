// A run's saves and its record (consolidation C15, moved from main.js): load and save, the won run's slot, the autosave
// on a floor change, the start and end of a run in the journal, and the journal's view for its window.
// S is the page's run state (main.js): game, ui, arrival, startEarned, coachDue.

import ui from '../../data/ui.json' with { type: 'json' };
import { saveTo, loadFrom, saveProblem } from '../save/save.js';
import { runRecord } from '../rules/run-record.js';
import { itemName } from '../rules/item-names.js';
import { color } from '../ui/core/widgets.js';
import { recentLog } from '../ui/screens/hud.js';

export function createRunSaves(S, { storage, slots, journal, watch, audio }) {
  const { slotInfo } = slots;
  // EP42 (1.7 saveSnapshot log, save.js:25): a save keeps the run's last 40 log lines, put back when it is loaded.
  // EP42 (1.7 saveApply, save.js:54-55): the HUD opens on "Game loaded. Name, level N, floor N." in gold.
  const arrive = g => {
    if (!g) return g;
    S.arrival = { log: Array.isArray(g.logTail) ? g.logTail : [], loaded: { words: `Game loaded. ${g.hero?.name ?? 'Hero'}, level ${g.hero?.level ?? 1}, floor ${g.floorNo}.`, fill: 0xe8b44a } };
    delete g.logTail;
    return g;
  };
  // Item 80 (1.7 saveApply over a 'victory' save, save.js:57, :101): a saved winner loads as the retired hero, free to walk
  // the world again; the run is not over, it is won.
  const loadRun = id => { const g = arrive(loadFrom(storage, id)); if (g?.won) g.over = false; return g; };
  // G46: a save that fails is said once (1.7 save.js:203-204), again only after one has worked in between.
  let saveWarned = null;
  const save = (id, label = '') => {
    const { game, ui: uiApi } = S;
    if (game?.over && !game.won) return false;   // death is final (C81): a dead run is never saved
    if (!saveTo(storage, id, { ...game, logTail: uiApi.logTail?.() ?? [] }, label)) {
      if (saveProblem() !== saveWarned) {
        saveWarned = saveProblem();
        uiApi.say(saveWarned === 'full' ? 'Save storage is full. Export this run to a file; your previous saves are safe.' : 'Saving failed. Export this run to a file; your previous saves are safe.', color.hp);
      }
      return false;
    }
    saveWarned = null;
    slots.stamp(id);
    return true;
  };
  // RB12 (1.7 run-events.js:139-145): a won run's Save this character: the first empty numbered slot or this run's own,
  // never another character's.
  const saveWin = () => {
    const { game } = S;
    if (!game?.won || game.sandbox) return null;
    const own = id => { const s = loadFrom(storage, id); return !!s && !!s.runId && s.runId === game.runId; };
    const slot = ['1', '2', '3'].find(id => !slotInfo(id) || own(id));
    if (!slot) return { full: true };
    return save(slot, 'victory') ? { slot } : null;   // tagged 'victory', as 1.7's writeSlot(slot, 'victory')
  };
  // Justin 2026-10-17: "auto save should only happen when floors change". The autosave gzips the whole run (up to
  // 308 ms on floor 8), so walking and fighting never save; a floor change (stairs, a plane, the Realm) does, and the
  // player's own actions keep theirs (a slot save, quitting to the title, a won run). Sandbox item 73. A sandbox run's
  // autosave is its own slot, which Continue never offers and only Load lists (item 179).
  const saveNow = () => { const { game } = S; if (game && !game.won) save(game.sandbox ? 'sandbox' : 'auto'); };   // a won run never autosaves (item 80)

  // The record across runs (1.7 journal.js, run-history.js): achievements, the bestiary, previous runs. Earned
  // achievements are said once in the log (1.7 journal-adapter.js announce).
  const sayEarned = titles => { for (const t of titles) S.ui.say(`Achievement: ${t}.`, 0xe8b44a); };
  // A run's start may already earn one (a Fae's court element); it is said once the HUD is up (showPlay).
  // A15: a new or loaded run cuts the old run's sounds (audio.newRun).
  const runStarted = () => { S.startEarned = S.game ? watch.start(S.game) : []; S.coachDue = false; audio.newRun(); recentLog.clear(); };
  /** C81: the saves that hold this run (its id, or for an older save its seed and hero), Continue's among them. */
  function deleteRunSaves(g) {
    let gone = 0;
    for (const id of ['auto', '1', '2', '3', 'sandbox']) {
      const s = loadFrom(storage, id);
      const same = s && (s.runId && g.runId ? s.runId === g.runId : s.seed === g.seed && s.hero?.name === g.hero?.name && s.hero?.cls === g.hero?.cls);
      if (!same) continue;
      if (slots.remove(id)) gone += 1;
    }
    return gone;
  }
  /** The run is over: its record joins the journal (never a sandbox run's); a death deletes its saves. */
  function runEnded() {
    const { game, ui: uiApi } = S;
    game.finished ??= runRecord(game, !!game.won, it => itemName(it, game));
    sayEarned(watch.finish(game, game.finished));
    game.earned = watch.earned();
    // RB11 (1.7 RUN.historySaved): with this browser's storage blocked the end screen says the result lasts this session.
    game.historySaved = slots.works();
    if (!game.won && deleteRunSaves(game)) uiApi.say('Death is final. Run saves deleted.', Number('0x' + ui.theme.obsidian.hp.slice(1)));
    // Item 80 (Justin 2026-10-17): a win clears the Continue autosave; Save this character keeps the hero.
    if (game.won && !game.sandbox) slots.remove('auto');
  }
  const journalView = () => {
    const d = journal.data();
    return {
      deepest: d.highestDepth,
      achievements: journal.achievements().map(a => ({ name: a.title, text: a.text, have: a.unlocked, progress: a.visible ? a.current : 0, goal: a.target })),
      creatures: d.enemies,
      godRanks: d.godRanks, sigils: d.sigils,   // W7, CD22: the Encyclopedia's boons, prayers and sigils found in any run
      paths: d.paths,   // W22: the best rank reached in each element, for the Encyclopedia's Paths
      // G43: the other discoveries 1.7's Encyclopedia opened by (rings, amulets, enchants, combinations, planes, god abilities).
      rings: d.rings, amulets: d.amulets, enchantments: d.enchantments, combos: d.combos, planes: d.planes, godAbilities: d.godAbilities,
      stored: journal.persisted(),   // W44: false shows the journal's storage notice
      runs: journal.runs().map(r => ({ ...r, deepest: r.depth, date: r.finishedAt ? new Date(r.finishedAt).toLocaleDateString() : '' })),
    };
  };
  return { arrive, loadRun, save, saveWin, saveNow, sayEarned, runStarted, runEnded, journalView };
}
