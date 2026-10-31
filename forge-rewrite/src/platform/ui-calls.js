// What the title, the windows and the HUD may ask of the page (consolidation C15, moved from main.js): the calls
// createUi (ui/screens/flow.js) receives. S is the page's run state (main.js): game, ui, floorHold, arrival, coachDue.

import { createGame, step } from '../engine/game.js';
import { toSave, fromSave } from '../save/save.js';
import { loadGroup } from './assets.js';
import { versionState, checkVersion, installUpdate, itchUpload, watchVersion, titleStatus } from './version.js';

export function uiCalls(S, { map, audio, slots, opts, journal, saves, floors, loop, display }) {
  const { slotInfo, newestSlot, tutorialOn, setTutorial, tutorialSeen, markTutorial } = slots;
  const { arrive, loadRun, save, saveWin, saveNow, runStarted } = saves;
  const { enterPlay } = floors;
  const uiApi = () => S.ui;
  return {
    hasContinue: () => { const n = newestSlot(); return n ? { line: n.s.line } : null; },   // never a sandbox run (save() keeps those in 'sandbox')
    floorHeld: () => !!S.floorHold,   // windows' floor-hold guard (36a7d2d, hold-gate.js): a rebuild waits out a floor's art
    continueRun: () => { const n = newestSlot(); S.game = n ? loadRun(n.id) : null; if (!S.game) return; runStarted(); enterPlay(); },
    // CH-39: the Sandbox's Build and Seed start a sandbox run from a chosen seed and keep its number scale.
    newRun: (choice, o = {}) => {
      S.arrival = null;
      const game = S.game = createGame({ seed: o.seed ?? Date.now() % 1000000, hero: choice, sandbox: !!o.sandbox });
      if (o.scale && game.sandbox) step(game, { type: 'sandbox', action: 'scale', ...o.scale });
      game.runId = `run-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
      runStarted(); setTutorial(choice.tutorial !== false); S.coachDue = choice.tutorial !== false; saveNow(); enterPlay();   // newRun: a new run starts saved (T37a)
    },
    slots: () => Object.fromEntries(['auto', '1', '2', '3', 'sandbox'].map(id => [id, slotInfo(id)])),
    // EP41 (1.7 saveTo, save.js:205): the player's own save says where it went, with a click.
    saveSlot: id => { if (!save(id)) return false; uiApi().say(`Saved to ${id === 'auto' ? 'the autosave' : id === 'sandbox' ? 'the sandbox slot' : 'slot ' + id}.`, 0x7fa05a); audio.cue('ui-click'); return true; },
    saveWin,
    loadSlot: id => { S.game = loadRun(id); runStarted(); enterPlay(); },
    deleteSlot: id => { slots.remove(id, { stamp: false }); },
    exportSave: () => toSave({ ...S.game, logTail: uiApi().logTail?.() ?? [] }, ''),
    // EP47 (1.7 exportSave, save.js:225): the file is named after the hero, level and floor.
    exportName: () => `fote-${String(S.game?.hero?.name || 'save').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-L${S.game?.hero?.level ?? 1}-F${S.game?.floorNo ?? 1}.json`,
    // Justin 2026-10-17 ("yes refuse the run", T37a): a run the journal lists as finished never comes back.
    importSave: text => { const g = fromSave(text); if (!g) return false; if (g.runId && journal.data().completedRuns?.[g.runId]) return 'That run has ended.'; S.game = arrive(g); runStarted(); enterPlay(); return true; },
    journal: saves.journalView,
    tutorial: { on: tutorialOn, set: setTutorial, seen: tutorialSeen, mark: markTutorial },
    quitToTitle: () => { saveNow(); uiApi().showTitle(); audio.playMusic('title'); },
    titleMusic: () => audio.playMusic('title'),   // A10: the end screen's Title
    command: c => loop.play(c),
    // Item 79: a hold on the hero's own tile rests (hud.js mapPointer), with a ring on the hero while it builds.
    rest: () => loop.startResting(),
    resting: () => loop.resting(),
    heroOnScreen: () => { const s = S.game && map.sprite(S.game.playerId); if (!s) return null; const p = s.root.getGlobalPosition(); return { x: p.x, y: p.y, tile: map.tile * map.scale }; },
    // The touch pad held down: the move to repeat as each step finishes, or null when let go.
    holdMove: loop.holdMove,
    // The map's walk to a landmark (ui/hud/automap.js): a route of ordinary steps (engine/travel.js).
    walk: loop.walk,
    // Auto-explore (CH-02): the Explore button and the O key toggle it; the HUD shows Stop while it runs, stairs once the floor is done.
    explore: { toggle: () => loop.toggleExplore(), state: loop.exploreState },
    cue: n => audio.cue(n),
    // Aim mode: the HUD marks the aimed tile and the tiles in range on the map.
    markTarget: (mark, inRange, area, path) => map.markTarget(mark, inRange, area, path),
    markHover: (rect, ok, lit, path) => map.markHover(rect, ok, lit, path),
    markBow: rect => map.markBow(rect),
    pointerBand: b => { map.pointerBand = b; },   // RC29: where the stairs arrow may stand (render/map-view.js)
    loadGroups: names => Promise.all(names.map(loadGroup)),
    // Player-facing words by key (for example 'god.grom.summary'); null until packet H's strings land.
    text: () => null,
    // C17: the update check for the title's version line and the Version window (platform/version.js).
    version: { state: versionState, check: checkVersion, install: installUpdate, itch: itchUpload, watch: watchVersion, titleStatus },
    options: { get: k => opts[k], set: (k, v) => { opts[k] = v; display.applyOptions(); slots.writeOptions(opts); } },
  };
}
