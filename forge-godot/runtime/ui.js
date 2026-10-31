// The 2D game's windows, run by its own code (forge-rewrite src/ui): the window shell, its tabs and plates, Menu,
// Character, Inventory, Faith, Options, the Journal, the combat log, Save, the Forge, shrines, the merchant, the popups,
// the map overlay and the end screen, built exactly as src/ui/screens/flow.js builds them, on the stand-in pixi
// (runtime/pixi.js). Godot paints what they build (scripts/ui2d.gd) and sends the pointer and the keys back here, where
// pixi's own hit testing and events reach the code that listens for them. bridge.js owns the game and runs the commands
// a window sends.

import { readText, writeText } from './io.js';
import * as P from './pixi.js';
import { createKit, color, space } from '../../forge-rewrite/src/ui/core/widgets.js';
import { createCards, cardFrame, createInfoLine } from '../../forge-rewrite/src/ui/core/cards.js';
import { createFocus } from '../../forge-rewrite/src/ui/core/focus.js';
import { buildShell } from '../../forge-rewrite/src/ui/core/shell.js';
import { scrollable, SCROLLBAR } from '../../forge-rewrite/src/ui/core/scroll.js';
import { findLabel, boundsIn } from '../../forge-rewrite/src/ui/core/layout.js';
import { loadPlates } from '../../forge-rewrite/src/ui/core/plates.js';
import { computeStage } from '../../forge-rewrite/src/ui/core/stage.js';
import { optionOf } from '../../forge-rewrite/src/ui/screens/options-list.js';
import { buildMenu } from '../../forge-rewrite/src/ui/screens/menu.js';
import { WINDOWS, TABS, windowSize } from '../../forge-rewrite/src/ui/screens/windows.js';
import { buildAutomap } from '../../forge-rewrite/src/ui/hud/automap.js';
import { buildEnd } from '../../forge-rewrite/src/ui/screens/end.js';
import { buildTitle } from '../../forge-rewrite/src/ui/screens/title.js';
import { buildCreation, newChoice } from '../../forge-rewrite/src/ui/screens/creation.js';
import { pickerChoice } from '../../forge-rewrite/src/ui/screens/places.js';
import { forgeReceipt, forgeSay, forgeSaying, pick as forgePick } from '../../forge-rewrite/src/ui/screens/forge.js';
import { buildCoach } from '../../forge-rewrite/src/ui/hud/coach.js';
import { buildMapTip } from '../../forge-rewrite/src/ui/hud/map-tip.js';
import { mapIntent } from '../../forge-rewrite/src/ui/hud/map-hover.js';
import { buildBossBar } from '../../forge-rewrite/src/ui/hud/status.js';
import { bossOf } from '../../forge-rewrite/src/ui/model/hud-model.js';
import { geo } from '../../forge-rewrite/src/ui/core/look.js';
import { CARDS, TOUR, CREATOR, cardPages, tipLive, tipsFromEvents } from '../../forge-rewrite/src/ui/hud/tips.js';
import { steps, startAffinity } from '../../forge-rewrite/src/ui/model/creation-model.js';
import { artStore } from '../../forge-rewrite/src/render/art-store.js';
import { createJournal, journalWatcher } from '../../forge-rewrite/src/save/journal.js';
import { createSlots, saveTo, loadFrom, toSave, fromSave } from './saves.js';
import { GFX_DEFAULTS, GFX_WEB, sandboxWithGraphics, optionsWithCamera } from './graphics.js';
import { runRecord } from '../../forge-rewrite/src/rules/run-record.js';
import { itemName } from '../../forge-rewrite/src/rules/item-names.js';
import { registerDropTarget } from '../../forge-rewrite/src/ui/core/drag.js';
import { slotMenu } from '../../forge-rewrite/src/ui/hud/slot-menu.js';
import { barOf, withSlot, swapSlots, statusList, statusCard, shieldsOf, xpView, hungerView, pietyView, walletView } from '../../forge-rewrite/src/ui/model/hud-model.js';
import { entryView, slotSentence } from '../../forge-rewrite/src/ui/hud/hotbar-model.js';
import { pulseAt, castCard, castWords } from '../../forge-rewrite/src/ui/core/pulse.js';
import { endsRun } from '../../forge-rewrite/src/ui/screens/popups.js';
import { keyTable, keyLabel } from '../../forge-rewrite/src/input/input.js';
import strings from '../../forge-rewrite/data/strings.json' with { type: 'json' };
import loot from '../../forge-rewrite/data/loot.json' with { type: 'json' };
import uiData from '../../forge-rewrite/data/ui.json' with { type: 'json' };

const ROOT = '../../forge-rewrite/';

// ---- what Godot answers: a string's width, a font's box, a picture's size (pixi.js hooks)

let asker = null;
/** bridge.js: how to ask Godot something while a request is being answered (null between requests). */
export function setAsker(fn) { asker = fn; }
// Each font's ink box (pixi measureFont: the ascent and descent of '|ÉqÅM'), as Chrome measures it for the 2D game
// (runtime/fontbox.json, read from the game's own pixi at each size it uses; others scaled from 100 px).
const FONT_BOX = JSON.parse(readText('fontbox.json'));
P.hooks.measure = (font, px, s) => asker?.({ ask: 'w', f: font, px, s }) ?? s.length * px * 0.5;
P.hooks.fontBox = (font, px) => {
  const t = FONT_BOX[font] ?? FONT_BOX['spectral-400'], at = t[String(px)];
  if (at) return { ascent: at[0], descent: at[1], fontSize: at[2] };
  const [a, d] = t['100'], ascent = Math.round(a * px / 100), descent = Math.round(d * px / 100);
  return { ascent, descent, fontSize: ascent + descent };
};
P.hooks.image = src => asker?.({ ask: 'img', src }) ?? { w: 1, h: 1 };

// ---- the 2D game's files and art: its sheets come from their catalogs as the game's loader reads them

P.files.read = p => readText(ROOT + p);
const manifest = JSON.parse(readText(ROOT + 'assets/manifest.json'));
const catalogs = new Map();
P.sheetLoaders.sheet = p => {
  const key = p.replace(/^assets\//, ''), file = manifest.sheetCatalogs?.[key];
  if (!file) return null;
  if (!catalogs.has(file)) catalogs.set(file, JSON.parse(readText(ROOT + 'assets/' + file)));
  return catalogs.get(file)[key] ?? null;
};
// The art store (render/art-store.js) holds every sheet by name; here a sheet is read the first time it is asked for.
const sheetMap = artStore.sheets, mapGet = sheetMap.get.bind(sheetMap), mapHas = sheetMap.has.bind(sheetMap);
function lazySheet(name) {
  if (mapHas(name)) return true;
  // A sheet by its name (sheets/<name>), or by a path of its own (images/creation/bases: the creation figures).
  const dir = name.includes('/') ? 'assets/' + name.replace(/[^/]*$/, '') : 'assets/sheets/', base = name.replace(/^.*\//, '');
  const path = dir + base + '.json', data = P.sheetLoaders.sheet(path);
  if (!data) return false;
  const sheet = P.spritesheetOf(data, dir + (data.meta?.image ?? base + '.webp'));
  sheetMap.set(name, sheet);
  P.Assets.cache.set(path, sheet);
  return true;
}
sheetMap.get = name => (lazySheet(name), mapGet(name));
sheetMap.has = name => lazySheet(name);
artStore.plugLoader({
  touch() {}, parked: () => false, wake() {},
  loadSheet: path => { const name = String(path).replace(/^.*sheets\//, '').replace(/\.json$/, ''); lazySheet(name); return Promise.resolve(sheetMap.get(name)); },
  loadGroup: () => Promise.resolve(), retainArt: () => () => {}, alsoLoad() {},
});

// ---- what the browser kept (localStorage), kept in one file Godot names

function fileStorage(path) {
  let data = {};
  try { const t = readText(path); if (t) data = JSON.parse(t); } catch { data = {}; }
  let dirty = false;
  return {
    getItem: k => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); dirty = true; },
    removeItem: k => { if (k in data) { delete data[k]; dirty = true; } },
    key: i => Object.keys(data)[i] ?? null,
    get length() { return Object.keys(data).length; },
    clear: () => { data = {}; dirty = true; },
    flush() {
      if (!dirty || !path) return;
      dirty = false;
      writeText(path, JSON.stringify(data));
    },
  };
}

// ---- the host

const PLAY_MS = 1300;   // play-loop.js DEATH_PAUSE_MS: a death plays out, then the end screen
const MAP_ZOOM = { far: 1.25, normal: 1, close: 0.8, closest: 0.65 };   // Options' Map zoom as the 3D camera's (graphics.js Zoom)
const BOSS_W = 420;     // hud.js bossW on a laptop

export function createUiHost(o) {
  // o: { state: () => game, play: cmd => void (runs a command in the engine), say: (words, fill) => void,
  //      newRun: (hero, {sandbox, seed}) => void, store: path }
  const storage = fileStorage(o.store);
  const slots = createSlots(storage), opts = slots.readOptions();
  const journal = createJournal(storage), watch = journalWatcher(journal);
  const root = new P.Container();
  const [screenLayer, windowLayer, cardLayer] = ['ui-screens', 'ui-windows', 'ui-cards'].map(label => Object.assign(new P.Container(), { label }));
  // hudLayer: the HUD's places as the windows' code sees them (the hotbar a drag drops on, a hover card's anchor; nothing
  // drawn: scripts/hud.gd draws the HUD); flashLayer: a sigil's cast pulse and card over the windows (flow.js flashLayer);
  // menuLayer: a hotbar slot's menu (hud.js menuLayer). None is cleared by a rebuild.
  const [hudLayer, flashLayer, menuLayer] = ['ui-hud', 'ui-flash', 'ui-menu'].map(label => Object.assign(new P.Container(), { label }));
  root.addChild(screenLayer, hudLayer, windowLayer, flashLayer, menuLayer, cardLayer);
  let stage = computeStage(1280, 800, false), kit = null, cards = null, focus = null, ready = false;
  let mode = 'play', win = null, winArg = null, mapOn = false, automap = null, wantsEnd = false;
  /**
   * stage.js computeStage over Godot's screen, the device's main pointer a finger or not (game.gd touch): a touch
   * screen's windows lay out for touch (bigger targets, the info line, Inventory's tap to pick). computeStage wants CSS
   * pixels and Godot's are the screen's, so it is asked in CSS pixels and its answer turned back to Godot's: over the
   * screen's own 1170 x 2532 a phone got a tablet's stage, the largest upright one, letterboxed in the middle of the
   * screen at half the 2D game's size (Justin 2026-10-31: "the character sprites seem small on a phone").
   */
  function stageOf(vw, vh, touch = false, dpr = 1) {
    const r = Math.max(1, dpr || 1), st = computeStage(vw / r, vh / r, !!touch);
    return { ...st, s: st.s * r, ox: st.ox * r, oy: st.oy * r };
  }
  const history = [];
  // The windows' words go to the log as the engine's do (o.say: the bridge's said), and every line the log hears comes
  // back here (heard), so the Combat log holds the whole run and a window shows the newest at its foot (flow.js say).
  // (Only the windows' own words were kept: the Combat log had no combat in it; 2026-10-30.)
  const say = (words, fill) => o.say(words, fill ?? color.ink);
  function heard(lines) {
    for (const l of lines ?? []) history.push({ words: l.words, fill: l.fill, ...(l.marks?.length ? { marks: l.marks } : {}) });
    if (history.length > 400) history.splice(0, history.length - 400);
    const last = lines?.at?.(-1);
    if (last && win && win !== 'Menu' && !(win === 'Forge' && forgeSaying())) notice(last.words, last.fill);
  }
  const game = () => o.state();
  const cue = name => o.cue?.(name);   // the windows' clicks, opening and closing (bridge-core.js: sound.gd plays them)
  // The 3D look as the Sandbox's View page sets it (graphics.js), kept with the options; gfxSeq counts its changes, so
  // the bridge sends it to Godot (main.gd apply_gfx) only when it changed.
  // A camera angle kept from before the game's own moved to 55 (gfxPitch 2) is the old default kept along with some
  // other setting, not a choice: it goes (Justin 2026-10-29: "60 is too high").
  if (opts.gfx && opts.gfxPitch !== 2) delete opts.gfx.pitch;
  const gfxBase = o.compat ? GFX_WEB : GFX_DEFAULTS, gfx = { ...gfxBase, ...(opts.gfx ?? {}) };
  let gfxSeq = 1;
  const gfxCtl = {
    values: gfx, base: gfxBase, pc: !o.compat,
    set: (k, v) => { gfx[k] = v; opts.gfx = { ...gfx }; opts.gfxPitch = 2; slots.writeOptions(opts); gfxSeq++; },
    reset: () => { Object.assign(gfx, gfxBase); delete opts.gfx; slots.writeOptions(opts); gfxSeq++; },
  };
  const SANDBOX = WINDOWS.Sandbox && { ...WINDOWS.Sandbox, build: (k, area, c) => sandboxWithGraphics(WINDOWS.Sandbox.build, k, area, c, gfxCtl) };
  const OPTIONS = { ...WINDOWS.Options, build: (k, area, c) => optionsWithCamera(WINDOWS.Options.build, k, area, c, gfxCtl) };

  const journalView = () => {
    const d = journal.data();
    return {
      deepest: d.highestDepth,
      achievements: journal.achievements().map(a => ({ name: a.title, text: a.text, have: a.unlocked, progress: a.visible ? a.current : 0, goal: a.target })),
      creatures: d.enemies, godRanks: d.godRanks, sigils: d.sigils, paths: d.paths,
      rings: d.rings, amulets: d.amulets, enchantments: d.enchantments, combos: d.combos, planes: d.planes, godAbilities: d.godAbilities,
      stored: journal.persisted(),
      runs: journal.runs().map(r => ({ ...r, deepest: r.depth, date: r.finishedAt ? new Date(r.finishedAt).toLocaleDateString() : '' })),
    };
  };
  // The map's targeting marks (forge-rewrite render/map-overlays.js markTarget, markHover, markBow), which the 2D game
  // draws over its map and scripts/marks.gd lays on the 3D floor (Justin 2026-10-28: "targeting visual queues are not in
  // game"): aim mode's reach, the tiles a spell would strike, a bolt's flight, the picked foe; the square under the
  // pointer; the bow's target. Rects {x, y, w} and tiles {x, y} in tiles.
  const marks = { target: null, hover: null, bow: null };
  let marksSeq = 0;

  // platform/version.js checkVersion as the title's version line and About read it (C17): this copy's build time (o.build:
  // the page's forge-build meta, which tools/web.py stamps; 'dev' on PC) against the site's build.json, fetched where the
  // engine can fetch (the browser build's worker; o.site, the page's folder): a newer live build says "Update available"
  // (the page reloaded plays it; saved games are kept). (A stub said nothing; 2026-10-30.)
  const ver = { message: '', latest: null, validated: false, installing: false, pending: null };
  const verWatch = new Set();
  const tellVer = () => { for (const fn of [...verWatch]) fn(ver); };
  /** version.js buildTime: an ISO build time as ms, NaN when it is not one. */
  const buildTime = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(v) ? Date.parse(v) : NaN);
  const versionCheck = {
    state: () => ver,
    check() {
      if (ver.pending) return ver.pending;
      const build = o.build ?? 'dev', local = buildTime(build);
      if (!Number.isFinite(local)) {
        ver.latest = null; ver.validated = false;
        ver.message = build === 'dev' ? 'Development build' : 'This copy has no valid build date.';
        tellVer(); return Promise.resolve(false);
      }
      if (typeof fetch !== 'function' || !o.site) { ver.validated = false; ver.message = 'Could not check for updates. You can keep playing this copy.'; tellVer(); return Promise.resolve(false); }
      ver.validated = false; ver.message = 'Checking for updates…'; tellVer();
      ver.pending = (async () => {
        try {
          const r = await fetch(`${o.site}build.json?t=${Date.now()}`, { cache: 'no-store' });
          if (!r.ok) throw new Error('Unavailable');
          const b = await r.json(), remote = buildTime(b?.built);
          if (!Number.isFinite(remote)) throw new Error('Invalid build');
          ver.latest = remote > local ? b : null; ver.validated = true;
          ver.message = ver.latest ? 'Update available. Reload the page to play it; saved games are kept.' : remote < local ? 'This copy is newer than the published build.' : 'Up to date';
          return true;
        } catch {
          ver.validated = false;
          ver.message = ver.latest ? 'Update available. Could not recheck; connect to install.' : 'Could not check for updates. You can keep playing this copy.';
          return false;
        } finally { ver.pending = null; tellVer(); }
      })();
      return ver.pending;
    },
    install() {}, itch: () => false,
    watch(fn) { verWatch.add(fn); return () => verWatch.delete(fn); },
    titleStatus: () => (ver.latest ? 'Update available' : ver.message).toLowerCase(),
  };
  versionCheck.check();

  // run-saves.js save, arrive and loadRun (EP42, item 80): a save keeps the run's last 40 log lines (never a dead run's);
  // a loaded run brings them back to the Combat log and opens on "Game loaded. Name, level N, floor N." in gold; a saved
  // winner loads as the retired hero, free to walk. (A load had said only "X takes up the run"; 2026-10-30.)
  const keep = (id, label = '') => { const g = game(); return !!g && !(g.over && !g.won) && saveTo(storage, id, { ...g, logTail: history.slice(-40) }, label); };
  let arrival = null;
  function arrive(g) {
    if (!g) return g;
    arrival = { log: Array.isArray(g.logTail) ? g.logTail : [], loaded: { words: `Game loaded. ${g.hero?.name ?? 'Hero'}, level ${g.hero?.level ?? 1}, floor ${g.floorNo}.`, fill: 0xe8b44a } };
    delete g.logTail;
    return g;
  }
  const loadRun = id => { const g = arrive(loadFrom(storage, id)); if (g?.won) g.over = false; return g; };
  /** flow.js play(g, {log, loaded}): the loaded run on screen, its log back. */
  function enter(g) {
    cardsReset();
    closeMenu();
    o.load?.(g);
    const a = arrival;
    arrival = null;
    history.splice(0, history.length, ...(a?.log ?? []).slice(-400));
    if (a) say(a.loaded.words, a.loaded.fill);
    build();
  }
  const deps = {
    markTarget: (mark, tiles = [], area = [], path = []) => {
      marks.target = mark || tiles?.length ? { mark: mark ?? null, tiles: tiles ?? [], area: area ?? [], path: path ?? [] } : null;
      marksSeq++;
    },
    markHover: (rect, ok, lit, path = []) => { marks.hover = rect ? { rect, ok: !!ok, lit: !!lit, path: path ?? [] } : null; marksSeq++; },
    markBow: rect => { marks.bow = rect ?? null; marksSeq++; },
    cue, command: c => o.play(c), journal: journalView,
    tutorial: { on: slots.tutorialOn, set: slots.setTutorial, seen: slots.tutorialSeen, mark: slots.markTutorial },
    options: { get: k => opts[k], set: (k, v) => {
      opts[k] = v;
      // display.js mapOptions: Options' Map zoom is the 3D camera's zoom (graphics.js Zoom: Far 1.25 to Closest 0.65).
      if (k === 'zoom' && MAP_ZOOM[v] !== undefined) { gfx.zoom = MAP_ZOOM[v]; opts.gfx = { ...gfx }; opts.gfxPitch = 2; gfxSeq++; }
      slots.writeOptions(opts); o.options?.(opts);
    } },
    slots: () => Object.fromEntries(['auto', '1', '2', '3', 'sandbox'].map(id => [id, slots.slotInfo(id)])),
    hasContinue: () => slots.newestSlot()?.s ?? null, floorHeld: () => false,
    // ui-calls.js saveSlot, loadSlot: the run kept in a slot (saves.js), or the slot's run played on.
    saveSlot: id => {
      if (!keep(id)) { say('The save could not be written.', 0xc8382e); return false; }
      say(`Saved to ${id === 'auto' ? 'the autosave' : id === 'sandbox' ? 'the sandbox slot' : 'slot ' + id}.`, 0x7fa05a);
      cue('ui-click');
      return true;
    },
    // (Into play, as Continue goes: from the title the run loaded and the title stood on over it; 2026-10-30.)
    loadSlot: id => { const g = loadRun(id); if (g) { mode = 'play'; win = null; closeWindow(); enter(g); } },
    deleteSlot: id => slots.remove(id, { stamp: false }),
    // ui-calls.js exportSave, exportName (EP47: named after the hero, level and floor); save.js download hands the text
    // to Godot (pixi.js document: the page's download), which saves the file.
    exportSave: () => (exported = toSave({ ...game(), logTail: history.slice(-40) })),
    exportName: () => `fote-${String(game()?.hero?.name || 'save').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-L${game()?.hero?.level ?? 1}-F${game()?.floorNo ?? 1}.json`,
    // ui-calls.js importSave: a run the journal lists as finished never comes back (Justin 2026-10-17, T37a).
    importSave: text => {
      const g = fromSave(text);
      if (!g) return false;
      if (g.runId && journal.data().completedRuns?.[g.runId]) return 'That run has ended.';
      closeWindow(); mode = 'play'; win = null; enter(arrive(g));
      return true;
    },
    // ui-calls.js quitToTitle: the run kept, then the title over it (its Continue plays it on).
    quitToTitle: () => { const g = game(); if (g && !g.won) keep(g.sandbox ? 'sandbox' : 'auto'); mode = 'title'; win = null; mapOn = false; closeMenu(); build(); },
    // run-saves.js saveWin (RB12): a won run's Save this character: the first empty numbered slot or this run's own,
    // never another character's, tagged victory; it loads as the retired hero, free to walk.
    saveWin: () => {
      const g = game();
      if (!g?.won || g.sandbox) return null;
      const own = id => { const s = loadFrom(storage, id); return !!s && !!s.runId && s.runId === g.runId; };
      const slot = ['1', '2', '3'].find(id => !slots.slotInfo(id) || own(id));
      if (!slot) return { full: true };
      return keep(slot, 'victory') ? { slot } : null;
    },
    titleMusic: () => {},
    newRun: (choice, opt = {}) => o.newRun(choice, opt),
    loadGroups: () => Promise.resolve(), text: () => null,
    walk: path => o.walk?.(path),
    explore: o.explore ?? { toggle: () => {}, state: () => null },
    version: versionCheck,
  };

  /** The element the hero leans to, for the highlight colour (flow.js affinityNow). */
  function affinityNow() {
    // Creation's is the choice's, the title's none: the run lying under them is not theirs (Justin 2026-10-31: "The UI
    // theming stays on fire even after a fire affinity is no longer selected").
    if (mode === 'create') return startAffinity(create.choice)[0] ?? null;
    if (mode === 'title') return null;
    const aff = game()?.hero?.affinity ?? {};
    return Object.keys(aff).filter(k => aff[k] > 0).sort((a, b) => aff[b] - aff[a])[0] ?? null;
  }
  const clear = layer => layer.removeChildren().forEach(c => c.destroy({ children: true }));

  // The HUD's pieces (scripts/hud.gd, at look.js geo.L), which the map's symbols and hint keep clear of.
  function hudAreas() {
    const w = stage.w, h = stage.h, bar = 8 * 69.3 + 7 * 5.3, x0 = Math.round((w - bar) / 2);
    return [
      { left: 0, top: 0, right: 380, bottom: 170 },
      { left: w - 16 - 58.6 - 4, top: 0, right: w, bottom: 16 + 3 * 69.3 + 4 },
      { left: x0 - 4, top: h - 16 - 69.3 - 4, right: x0 + bar + 8 + 69.3 + 4, bottom: h },
      { left: w - 16 - 298.5 - 4, top: h - 16 - 69.3 - 8 * 23.9 - 8, right: w, bottom: h },
    ];
  }

  // ---- the HUD's speaking parts (scripts/hud.gd draws the HUD; what it says and does is the 2D game's own here)

  // The hotbar as the windows' drags see it (core/drag.js registerDropTarget, as hud/hotbar.js registers itself): its
  // slots where hud.gd lays them, in the stage's units (hudPlaces), the slot a drag is over and the one it came from
  // (hud.gd draws both: state.hud), and what a drop does (hotbar.js drop). A drag fades the windows so the bar shows
  // through (flow.js lift). (Without a drop target every drag in the windows stopped before it began; 2026-10-30.)
  const barArea = new P.Container();
  barArea.label = 'hud-hotbar';
  hudLayer.addChild(barArea);
  let slotRects = [];
  const hudDrag = { over: -1, lifted: -1 };
  const setBar = next => { if (game()?.hero) o.play({ type: 'hotbar', slots: next }); };   // hud.js setBar
  registerDropTarget({
    root: barArea,
    slotAt(p) { return slotRects.findIndex(r => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h); },
    hover(i) { hudDrag.over = i; },
    lift: (on, k = 0.12) => { windowLayer.alpha = on ? k : 1; },
    lifted(i) { hudDrag.lifted = i; },
    get slotSize() { const r = slotRects[0]; return r ? { w: r.w, h: r.h } : null; },
    drop(i, entry, from) {
      const bar = barOf(game());
      if (i < 0) { if (from !== null) setBar(withSlot(bar, from, null)); return; }
      if (from !== null) { if (from !== i) setBar(swapSlots(bar, from, i)); return; }
      setBar(withSlot(bar, i, entry));
      cue('ui-click');
    },
  });
  /** Where hud.gd lays the hotbar's slots, in the stage's units ({x, y, w, h} each), sent when its layout changes. */
  function hudPlaces(rects) {
    slotRects = (rects ?? []).map(r => ({ x: +r.x, y: +r.y, w: +r.w, h: +r.h }));
    if (!slotRects.length) { barArea.boundsArea = null; return; }
    const x0 = Math.min(...slotRects.map(r => r.x)), y0 = Math.min(...slotRects.map(r => r.y));
    barArea.boundsArea = new P.Rectangle(x0, y0, Math.max(...slotRects.map(r => r.x + r.w)) - x0, Math.max(...slotRects.map(r => r.y + r.h)) - y0);
  }
  /** A slot dragged along the bar in hud.gd (hotbar.js drop with `from`): swapped with the one it lands on, or off the bar, cleared. */
  function barMove(from, to) {
    const bar = barOf(game());
    if (to < 0) setBar(withSlot(bar, from, null));
    else if (to !== from) setBar(swapSlots(bar, from, to));
  }

  // The HUD's hover cards (bars.js hoverCard, status.js, hotbar.js detailOf, hud.js's buttons): hud.gd says what the
  // mouse is over and where ({what, i, rect} in the stage's units); the card is the 2D game's, beside it.
  const BAG_MAX = loot.rows.bag.slots;
  const tipAnchor = new P.Container();
  tipAnchor.label = 'hud-tip-anchor';
  hudLayer.addChild(tipAnchor);
  let hudTip = null;
  /** hotbar.js detailOf, with a mouse: an empty slot has no card. */
  function slotCard(i) {
    const g = game(), entry = barOf(g)[i], v = entry ? entryView(g, entry) : null, key = `Key ${i + 1}`;
    if (!v) return null;
    if (v.bow) return { title: v.name, sub: key, rows: v.rows, lines: [v.ready ? 'Press to aim; press again to fire.' : 'Equip a bow to shoot.'] };
    if (v.card) return { ...v.card, sub: v.card.sub ? `${v.card.sub} · ${key}` : key, rows: [...(v.card.rows ?? []), ...v.rows] };
    if (v.amulet) return { title: v.name, sub: key, rows: v.rows, lines: [v.ready ? (v.aims ? 'Press to aim; press again to use.' : 'Press to use.') : 'Kills recharge it.'] };
    const said = slotSentence(g, entry);
    const click = !v.clickable ? [] : v.click ? ['Your click ability. Right-click to turn it off.'] : ['Right-click to cast this whenever you click an enemy.'];
    return { title: v.name, sub: key, rows: v.rows, lines: [...(said ? [said] : []), ...(v.ready ? [] : [v.left ? `Ready in ${v.left} turns.` : 'Not enough mana or favor yet.']), ...click] };
  }
  function hudCard(what, i) {
    const g = game(), h = g?.hero, p = g?.actors?.[g?.playerId];
    if (!h || !p) return null;
    switch (what) {
      case 'hp': { const sh = shieldsOf(p); return { title: 'Health', rows: [['HP', `${p.hp} / ${p.maxhp}`], ...(sh.total ? [['Shield', sh.total]] : [])], lines: sh.total ? [sh.parts.map(q => q.words ?? `${q.name} ${q.n}`).join(', ') + '. Shields absorb damage before HP.'] : [] }; }
      case 'mana': return { title: 'Mana', rows: [['Mana', `${p.mana} / ${p.maxmana}`]] };
      case 'xp': { const x = xpView(h); return { title: 'Experience', rows: [['Level', x.level], ['XP', x.next ? `${x.xp} / ${x.next}` : x.xp]], lines: [x.next ? `${Math.max(0, x.next - x.xp)} XP to the next level.` : 'Maximum level reached. Further XP still counts toward your run total.'] }; }
      case 'piety': { const f = pietyView(h.faith); return f && { title: 'Piety', sub: f.name, rows: [['God rank', `${f.rank} / ${f.top}`], ['Piety', f.next ? `${f.piety} / ${f.next}` : f.piety]], lines: [f.next ? `${Math.max(0, f.next - f.piety)} more piety to reach rank ${f.rank + 1}.` : 'Maximum god rank reached.'] }; }
      case 'hunger': { const v = hungerView(h.hunger); return { title: `Hunger: ${v.word}`, rows: [['Hunger', `${v.now} / ${v.max}`]], lines: ['Eat food from your bag to restore hunger.'] }; }
      case 'essence': { const wl = walletView(h); return { title: 'Essence & keys', rows: [['Essence', wl.essence], ['Keys', wl.keys]], lines: ['Essence pays for crafting and upgrades at a forge. Keys open locked doors on the floor where you find them.'] }; }
      case 'favor': { const f = pietyView(h.faith); return f && { title: 'Favor', rows: [['Favor', `${f.favor} / ${f.favorCap}`]], lines: ['Spent on divine abilities that cost Favor. It is earned alongside piety.'] }; }
      case 'amusement': return { title: `Amusement ${Math.max(0, Math.min(100, Math.round(h.faith?.amusement ?? 0)))}%`, lines: [strings.rows['god.wobbles.passive']] };
      case 'status': { const st = statusList(p, g)[i]; return st ? statusCard(g, p, st) : null; }
      case 'slot': return slotCard(i);
      // hud.js characterCard, pointsCard, inventoryCard and its buttons' cards.
      case 'portrait': { const f = pietyView(h.faith), pts = Math.max(0, Math.round(h.points ?? 0)); return { title: 'Character', rows: [['Level', h.level ?? 1], ...(f ? [[f.name, `Rank ${f.rank}`]] : []), ...(pts ? [['Unspent points', pts]] : [])], lines: ['Open attributes and passives.'] }; }
      case 'points': return { title: 'Attribute points', rows: [['Unspent', Math.max(0, Math.round(h.points ?? 0))]], lines: ['Open Character to spend them.'] };
      case 'satchel': return { title: 'Inventory', rows: [['Bag', `${(h.bag ?? []).filter(Boolean).length} / ${BAG_MAX}`]], lines: ['Open equipment, items and motes.'] };
      case 'menu': return { title: 'Menu', lines: ['Character, Inventory, Faith, Options, combat log and Journal.'] };
      case 'map': return { title: 'Map', lines: [mapOn ? 'Hide the map overlay.' : 'Show the explored dungeon.'] };
      case 'explore': {
        const ex = deps.explore?.state?.() ?? {}, k = (keyTable(opts.keys && Object.keys(opts.keys).length ? opts.keys : null).explore ?? [])[0];
        return ex.active ? { title: 'Stop exploring', lines: ['Stop travelling.'] } : ex.stairs ? { title: 'Next floor', lines: ['Walk to the stairs and descend.'] } : { title: 'Explore', sub: k ? `Key ${keyLabel(k)}` : null, lines: ['Walk through unexplored areas.'] };
      }
    }
    return null;
  }
  /** hud.gd: the mouse over one of the HUD's parts ({what, i, x, y, w, h}), or off them all (null). */
  function hudHover(t) {
    hudTip = t?.what ? { what: String(t.what), i: t.i | 0, rect: new P.Rectangle(+t.x, +t.y, +t.w, +t.h) } : null;
    showHudTip();
  }
  function showHudTip() {
    if (!cards) return;
    const d = hudTip && mode === 'play' && !win && !menu && !card ? hudCard(hudTip.what, hudTip.i) : null;
    if (!d) { if (tipAnchor.boundsArea) cards.hide(tipAnchor); tipAnchor.boundsArea = null; return; }
    tipAnchor.boundsArea = hudTip.rect;
    cards.show(tipAnchor, d);
  }

  // A slot's menu (hotbar.js openMenu, hud/slot-menu.js) on a right-click, and the click spell (toggleClick): a right-click
  // on a click spell's slot sets or clears it, any other opens the menu (Use, Cast on tap, Clear, Close). While it is up
  // the pointer is the windows' (blocking), so a click elsewhere closes it.
  let menu = null;
  function closeMenu() { if (!menu) return false; menu.destroy({ children: true }); menu = null; return true; }
  function toggleClick(i) {
    const g = game(), e = barOf(g)[i], v = e && entryView(g, e);
    if (!v?.clickable) return;
    closeMenu();
    cue('ui-click');
    o.play({ type: 'click-spell', id: v.click ? null : e.id });
  }
  function slotRightClick(i) {
    const g = game();
    if (!g?.hero || mode !== 'play' || win || !kit) return;
    const bar = barOf(g), v = bar[i] ? entryView(g, bar[i]) : null;
    if (v?.clickable) return toggleClick(i);
    closeMenu();
    hudTip = null; showHudTip();
    cue('ui-click');
    menu = slotMenu(kit, { detail: slotCard(i) ?? { title: 'Empty', lines: ['Drag an ability, a prayer or an item here from Character, Inventory or Faith.'] }, bar: barArea, layer: menuLayer, close: closeMenu,
      buttons: [v && ['Use', () => { closeMenu(); o.hotbar?.(i); }],
        v?.clickable && [v.click ? 'Stop casting on tap' : 'Cast on tap', () => toggleClick(i), !!v.click],
        v && ['Clear', () => { closeMenu(); setBar(withSlot(bar, i, null)); }], ['Close', closeMenu]].filter(Boolean) });
  }

  // The touch info line (hotbar.js createInfoLine, showInfo): one strip just above the bar, on a dark backing, where a tap
  // on an empty slot writes what goes there, for hotbarInfoMs. (A finger has no hover card.)
  let infoLine = null;
  function slotInfo(i) {
    if (!kit || !barArea.boundsArea) return;
    infoLine?.destroy({ children: true });
    const b = barArea.boundsArea, line = createInfoLine(kit, b.width), box = new P.Container();
    box.addChild(new P.Graphics().rect(-4, -4, b.width + 8, line.height + 8).fill({ color: 0x0b101b, alpha: 0.88 }), line.root);   // tone.glass
    box.position.set(b.x, b.y - line.height - 6);
    box.eventMode = 'none';
    box.label = 'hud-info';
    hudLayer.addChild(box);
    line.show(box, slotCard(i) ?? { title: 'Empty', lines: ['Drag an ability, a prayer or an item here from Character, Inventory or Faith.'] });
    infoLine = box;
    setTimeout(() => { if (infoLine === box) { box.destroy({ children: true }); infoLine = null; } }, uiData.timing.hotbarInfoMs);
  }

  // A sigil cast from a slot pulses there in its rune's glow (hotbar.js use, pulse.js pulseAt); one read from the bag
  // pulses its bag cell and says "You cast Blink" (flow.js castFlash, inventory.js bagAct).
  function slotPulse(i, colour) {
    const r = slotRects[i];
    if (r && colour !== null && colour !== undefined) pulseAt(flashLayer, r, colour);
  }

  // The page's one text field (text-entry.js editText: the hero's name, the Journal's search, the Sandbox's seed): Godot
  // lays a field of its own over the place while it is edited (state.typing) and sends back what is typed (text()).
  let typing = null;
  const entry = (() => {
    const on = { input: [], keydown: [], blur: [] };
    const px = v => parseFloat(v) || 0;
    const el = {
      id: 'text-entry', style: {}, value: '', maxLength: 24,
      addEventListener: (t, f) => on[t]?.push(f),
      removeEventListener: (t, f) => { if (on[t]) on[t] = on[t].filter(g => g !== f); },
      focus() { typing = { x: px(el.style.left), y: px(el.style.top), w: px(el.style.width), h: px(el.style.height), value: el.value, max: el.maxLength }; },
      blur() { if (!typing) return; typing = null; for (const f of [...on.blur]) f({}); },
      setSelectionRange() {},
      typed(v) { el.value = String(v).slice(0, el.maxLength); for (const f of [...on.input]) f({}); },
    };
    return el;
  })();
  globalThis.document.getElementById = id => (id === 'text-entry' ? entry : null);

  // The page's window (options.js listen, save.js exit): its key listeners take the next key while Options waits for one
  // to bind (rawKey: ui2d.gd sends the key as the page names it while state.listening); close() quits the game (the
  // bridge's quit). (No window: listen threw, and Exit game went no further than the title; 2026-10-30.)
  const keyListeners = [];
  globalThis.window = {
    addEventListener: (t, f) => { if (t === 'keydown' && !keyListeners.includes(f)) keyListeners.push(f); },
    removeEventListener: (t, f) => { const i = keyListeners.indexOf(f); if (t === 'keydown' && i >= 0) keyListeners.splice(i, 1); },
    close: () => o.quit?.(),
    devicePixelRatio: 1,
  };
  /** A key as the page names it ({key, code, shift, location}) to whatever listens on the window. */
  function rawKey(k) {
    const e = { key: String(k.key ?? ''), code: String(k.code ?? ''), shiftKey: !!k.shift, location: k.location | 0, repeat: false, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} };
    for (const f of [...keyListeners]) f(e);
    return true;
  }
  // A save to a file and one picked from a file (save.js download, pickFile through pixi.js document): what Godot is to
  // save ({name, text}) or that it is to open a file, said once in the next reply; the picked file's text comes back
  // (fileChosen) to the input that asked.
  let exported = '', fileOut = null, picking = null;
  P.hooks.download = el => { fileOut = { name: String(el.download || 'forge-save.json'), text: exported }; };
  P.hooks.pick = el => { picking = el; fileOut = { pick: true }; };
  function fileChosen(text) {
    const el = picking;
    picking = null;
    if (!el || typeof text !== 'string') return;
    el.files = [{ text: () => Promise.resolve(text) }];
    el.onchange?.({});
  }

  // The title and character creation (flow.js titleActs, createActs, fresh): the title's Continue plays the newest
  // save on, New Game and Sandbox open creation, whose Start begins the chosen hero's run.
  const create = { choice: newChoice(), step: 0, sandbox: false };
  const fresh = sandbox => {
    create.choice = { ...newChoice(), tutorial: deps.tutorial?.on?.() ?? true };
    create.step = 0; create.sandbox = sandbox; mode = 'create'; win = null; build();
  };
  const titleActs = {
    redraw: () => build(),
    hasContinue: () => deps.hasContinue(),
    continueRun: () => { const best = slots.newestSlot(); const g = best && loadRun(best.id); if (g) { mode = 'play'; win = null; enter(g); } },
    // Sandbox item 81 (flow.js titleActs.newGame): New Game asks first when it would end the run Continue resumes.
    newGame: () => { const cont = deps.hasContinue?.(); if (cont) openWindow('Confirm', endsRun(cont, 'New Game', () => fresh(false))); else fresh(false); },
    sandbox: () => fresh(true),
    open: openWindow, version: deps.version,
  };
  const createActs = {
    back: () => { mode = 'title'; build(); },
    redraw: () => build(),
    cue: n => cue(n),
    start: choice => o.newRun(choice, { sandbox: create.sandbox }),
  };

  // The tutorial (flow.js card, cardQueue: hud/tips.js says which card and when, hud/coach.js draws it): the card up,
  // { id, page, then?, back?, tour? }, with the game waiting under it, and the cards waiting for their moment. Each
  // shows once ever while tutorials are on. A turn's cards wait until the hero stands (play-loop.js tipsWaiting:
  // Godot says so, standing()); a new run's opening cards wait for its floor (floor-show.js coachDue).
  let card = null, cardQueue = [], tipsWaiting = [], coachDue = false, cam = null;
  const tut = deps.tutorial;
  const cardsOn = () => tut.on() !== false;
  const tipsOn = () => !!game() && tipLive(game()) && cardsOn();
  const fits = id => { const at = CARDS[id]?.at ?? 'map'; return at === 'any' || (at === 'map' ? !win : at === 'Forge' ? win === 'Forge' && !winArg?.infusion : at === 'core' && win === 'Forge' && !!winArg?.infusion); };
  const cardUp = () => !!card && (mode === 'play' ? !!card.tour || fits(card.id) : mode === 'title' && !!card.tour);
  const cardCtx = () => ({ touch: !!stage.touch, keys: opts.keys ?? null, state: game() });
  function drainCards() {
    if (card || mode !== 'play' || !game()) return;
    if (!tipsOn()) { cardQueue = []; return; }
    cardQueue = cardQueue.filter(id => !tut.seen(id));
    const id = cardQueue.find(fits);
    if (!id) return;
    cardQueue = cardQueue.filter(t => t !== id);
    tut.mark(id);
    showCard({ id, page: 0 });
  }
  function showCard(c) { card = c; const tab = cardPages(c.id, cardCtx())[c.page]?.tab; if (tab) forgePick.tab = tab; build(); }
  function cardEnd() {
    const c = card;
    card = null;
    if (c?.then?.length) return showCard({ id: c.then[0], page: 0, then: c.then.slice(1), back: c.back, tour: c.tour });
    if (c?.back) win = c.back;
    build(); drainCards();
  }
  function cardNext() { cue('ui-click'); if (card.page >= cardPages(card.id, cardCtx()).length - 1) cardEnd(); else showCard({ ...card, page: card.page + 1 }); }
  /** Don't show again: tutorials off (the waiting cards go) or back on (every card again); the creator's plate follows. */
  function cardToggle() {
    const off = tut.on() !== false;
    tut.set(!off);
    if (off) cardQueue = [];
    if (mode === 'create') create.choice = { ...create.choice, tutorial: !off };
    build();
  }
  /** The creator's card for its step (race, class): not in a sandbox, not with the Tutorial plate off, once ever. */
  const creatorCard = () => { const id = CREATOR[steps(create.choice)[create.step]]; return id && !create.sandbox && create.choice.tutorial && cardsOn() && !tut.seen(id) ? id : null; };
  function cardNode(id, page, next) {
    return buildCoach(kit, { page, pages: cardPages(id, cardCtx()), rect: t => tileRect(...t.tile, t.up), dontShow: tut.on() === false, next, toggle: cardToggle });
  }
  /** A map tile on screen and as much above it as the thing on it stands (`up` tiles), in the stage's units: its
   *  corners through the 3D camera (cam: Godot's projection and view, sent with each request). */
  function tileRect(x, y, up = 0) {
    if (!cam) return null;
    const m = cam.m, xs = [], ys = [];
    for (const [wx, wz] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) for (const wy of [0, up]) {
      const v = [wx, wy, wz, 1], c = [0, 1, 2, 3].map(r => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]);
      if (c[3] <= 0) return null;
      xs.push(((c[0] / c[3]) * 0.5 + 0.5) * cam.w); ys.push((0.5 - (c[1] / c[3]) * 0.5) * cam.h);
    }
    const sx = v => (v - stage.ox) / stage.s, sy = v => (v - stage.oy) / stage.s;
    const x0 = sx(Math.min(...xs)), y0 = sy(Math.min(...ys));
    return { x: x0, y: y0, w: sx(Math.max(...xs)) - x0, h: sy(Math.max(...ys)) - y0 };
  }
  /** The cards a turn or a new run calls for (flow.js offerTips). */
  function offerTips(ids) {
    if (!tipsOn()) return;
    for (const id of ids ?? []) if (!tut.seen(id) && !cardQueue.includes(id) && card?.id !== id) cardQueue.push(id);
    drainCards();
  }
  const cardsReset = () => { card = null; cardQueue = []; tipsWaiting = []; coachDue = false; };

  // The tile under the pointer on the 3D map (Godot picks it): { t: {x, y}, at: the pointer in the stage's units }. On
  // touch it is the tile a finger held (hud.js mapPointer's long press: `held` {band}, the free band between the HUD's
  // top block and the hotbar, where the card stands held upright).
  let hovered = null;
  function mapHover(t, at, held = null) {
    hovered = t ? { t, at, held } : null;
    // hud.js mapPointer, map-hover.js cursorFor: the cursor says what a click there does, by its glyph (attack, move,
    // shoot, break, door, grab, stairs, cast, use, inspect: data/cursors.json, ui2d.gd); none while aiming. (Only a
    // pointer showed; 2026-10-30.)
    const it = t && game() && !marks.target ? mapIntent(game(), t.x, t.y) : null;
    cursor = it ? 'glyph:' + it : 'default';
    build();
  }

  // The 3D hall behind creation (scripts/hall.gd), once it stands: the 2D stage's ground, floor, wall, pieces and life
  // fade off it and go, leaving the figures, the beam and the windows. Everything else of the screen is as it was.
  let hallAt = null;
  const HALL_FADE = 700;
  function hallBehind(made) {
    if (hallAt === null) return;
    const parts = [made.children[0], ...made.children.filter(n => ['stage-behind', 'stage-front', 'hall-life'].includes(n.label))];
    const left = () => 1 - (performance.now() - hallAt) / HALL_FADE;
    if (left() <= 0) { for (const n of parts) n.destroy({ children: true }); return; }
    const tick = () => {
      if (made.destroyed) return P.Ticker.shared.remove(tick);
      if (left() <= 0) { P.Ticker.shared.remove(tick); return build(); }
      for (const n of parts) n.alpha = left();
    };
    tick();
    P.Ticker.shared.add(tick);
  }

  const endActs = {
    playAgain: () => { const h = game()?.hero; if (!h) return; o.newRun({ name: h.name, sex: h.sex, race: h.race, court: h.court, cls: h.cls, god: h.god, named: true }, { sandbox: !!game().sandbox }); },
    title: () => { mode = 'title'; win = null; build(); },
    open: openWindow, saveWin: () => deps.saveWin(), redraw: () => build(),   // RB12: a won run's Save this character
  };

  function build() {
    if (!ready) return;
    focus?.destroy();
    clear(screenLayer); clear(windowLayer); clear(cardLayer);
    kit = createKit(stage, 1, affinityNow(), { tap: () => cue('ui-click'), textSize: opts.textSize, motion: opts.motion });
    cards = createCards(kit, stage);
    cardLayer.addChild(cards.root);
    kit.hooks.show = (node, d) => cards.show(node, d);
    kit.hooks.hide = node => cards.hide(node);
    focus = createFocus(kit, cardLayer);
    automap = null;
    const g = game();
    if (mode === 'title') screenLayer.addChild(buildTitle(kit, titleActs));
    else if (mode === 'create') {
      const made = buildCreation(kit, create, createActs);
      hallBehind(made);
      screenLayer.addChild(made);
      // flow.js buildNow: a sandbox run's creation says so, top right.
      if (create.sandbox) { const t = kit.text('Sandbox run', { size: 20, font: 'display', fill: kit.accent }); t.position.set(stage.w - t.width - space.betweenSections, space.betweenRows); screenLayer.addChild(t); }
    }
    else if (mode === 'end' && g) screenLayer.addChild(buildEnd(kit, g, endActs));
    else if (mapOn && g) {
      automap = buildAutomap(kit, stage, { blocked: hudAreas, walk: path => o.walk?.(path), close: () => toggleMap(false), say: w => say(w, color.ash), reduced: () => kit.reduced });
      automap.set(g);
      screenLayer.addChild(automap.root);
    }
    // The boss in sight's bar, top centre (hud.js buildBossBar): its name, its health, the blow it winds up.
    if (mode === 'play' && g && bossOf(g)) {
      const boss = buildBossBar(kit, BOSS_W);
      boss.set(g);
      boss.root.position.set(Math.round((stage.w - BOSS_W) / 2), geo[stage.kind].pad);
      screenLayer.addChild(boss.root);
    }
    if (win) buildWindow();
    // The tutorial card over the screen or its window; one whose moment has passed (its window closed) is done.
    if (card && !cardUp()) card = null;
    if (card) windowLayer.addChild(cardNode(card.id, card.page, cardNext));
    else if (mode === 'create' && !win && creatorCard()) { const id = creatorCard(); windowLayer.addChild(cardNode(id, 0, () => { cue('ui-click'); tut.mark(id); build(); })); }
    // The map's hover card (hud.js showAt, map-tip.js): what the tile under the pointer holds, a foe's odds.
    if (hovered && mode === 'play' && !win && !mapOn && !card && g) {
      const held = hovered.held, tip = buildMapTip(kit), c = tip.cardAt(g, hovered.t.x, hovered.t.y, { touch: !!held });
      if (c) { tip.show(c, hovered.at, { touch: !!held, upright: !!held && stage.kind === 'P', w: stage.w, h: stage.h, ...(held?.band ?? {}) }); cardLayer.addChild(tip.root); }
    }
    showHudTip();   // a HUD part's card, kept over the rebuild
    noticeNode = null;
    if (win && win !== 'Menu' && lastNotice && Date.now() < lastNotice.until) notice(lastNotice.words, lastNotice.fill, lastNotice.until);
  }

  // The paper doll's clock (flow.js uiClock): emptied on every rebuild.
  const winFrames = [];
  const uiClock = { speed: 1, reduced: false, onFrame: fn => winFrames.push(fn), tween: () => Promise.resolve(), wait: () => Promise.resolve(), busy: false };
  P.Ticker.shared.add(t => { for (const fn of winFrames) fn(Math.min(t.deltaMS, 64)); });
  const tickBase = P.Ticker.shared.count;   // the ticker's listeners at rest (state.live: more means something animates)
  /** The pointer and the keys are the windows' (ui2d.gd): a screen, a window, the map, a card or a slot's menu is up. */
  const isBlocking = () => mode !== 'play' || !!win || mapOn || cardUp() || !!menu;

  const uiApi = {};
  function buildWindow() {
    winFrames.length = 0;
    const g = game();
    if (win === 'Menu') { windowLayer.addChild(buildMenu(kit, { open: openWindow, close: closeWindow, options: deps.options, redraw: () => build() }, g)); return; }
    const spec = win === 'Sandbox' ? SANDBOX : win === 'Options' || win === 'Settings' ? { ...WINDOWS[win], build: OPTIONS.build } : WINDOWS[win];
    if (!spec) { win = null; return; }
    const tabs = TABS.includes(win) ? TABS : null;
    const size = windowSize(win, stage);
    const shellOf = h => buildShell(kit, { tabs, tab: win, title: tabs ? null : spec.titleOf?.(winArg) ?? spec.title, onTab: openWindow, onClose: spec.onClose ? () => spec.onClose(closeWindow, winArg) : closeWindow, w: size?.w, h, six: spec.six, fit: spec.fit });
    let shell = shellOf(size?.h);
    const bar = SCROLLBAR.w + SCROLLBAR.gap, lay = on => spec.build(kit, { ...shell.area, w: shell.area.w - (on ? bar : 0) }, { game: g, clock: uiClock, deps, ui: uiApi, arg: winArg, open: openWindow, close: closeWindow, reopen: () => build() });
    let scrolls = false, body = lay(scrolls);
    const spare = shell.area.h - body.height - space.betweenSections;
    if (size && Math.abs(spare) > 8) { shell.root.destroy({ children: true }); shell = shellOf(size.h - spare); }
    if (!scrolls && body.height > shell.area.h + 1) { body.destroy({ children: true }); winFrames.length = 0; body = lay(scrolls = true); }
    shell.content.addChild(scrolls ? scrollable(body, { ...shell.area, w: shell.area.w - bar }) : body);
    windowLayer.addChild(shell.root);
  }

  // A window hides the log, so a new line shows at the foot of its frame for a few seconds (flow.js notice).
  let noticeNode = null, lastNotice = null;
  function notice(words, fill, until = Date.now() + uiData.timing.noticeMs) {
    lastNotice = { words, fill, until };
    const frame = findLabel(windowLayer, 'window-frame');
    if (!frame || !kit) return;
    noticeNode?.destroy({ children: true });
    const r = boundsIn(frame, root);
    const t = kit.text(words, { size: 16, fill: fill ?? color.ink, wrap: r.w - 80, align: 'center' });
    const box = new P.Container();
    box.addChild(Object.assign(cardFrame(t.width + 24, t.height + 12, { radius: 6, alpha: 0.95 }), { x: -12, y: -6 }), t);
    box.position.set(Math.round(r.x + (r.w - t.width) / 2), Math.round(r.y + r.h - t.height - 26));
    box.label = 'window-notice';
    cardLayer.addChild(box);
    noticeNode = box;
    setTimeout(() => { if (noticeNode === box) { box.destroy({ children: true }); noticeNode = null; } }, Math.max(0, until - Date.now()));
  }

  function openWindow(name, arg = null) {
    cue('ui-open');
    if (!(win === name || win === 'Confirm' || win === 'Choose')) WINDOWS[name]?.fresh?.();
    win = name; winArg = arg;
    build();
  }
  function closeWindow() {
    if (!win) return false;
    cue('ui-close');
    win = null;
    build();
    drainCards();   // a card that waited for the window
    return true;
  }
  function toggleMap(force) {
    const was = mapOn;
    mapOn = force === undefined ? !mapOn : !!force;
    if (mapOn === was) return false;
    cue(mapOn ? 'ui-open' : 'ui-close');   // flow.js toggleMap: the map opens and closes with the windows' sounds
    build();
    return true;
  }

  Object.assign(uiApi, {
    open: (name, arg) => openWindow(name, arg),
    say: (w, f) => say(w, f),
    get history() { return history; },
    picker(ev) { openWindow('Choose', pickerChoice(game(), ev)); },
    forgeEvent(ev) {
      const words = forgeReceipt(ev, game());
      if (!words) return;
      forgeSay(words);
      if (win !== 'Forge') return;
      lastNotice = null; noticeNode?.destroy({ children: true }); noticeNode = null;
      build();
    },
    logTail: () => history.slice(-40),
    /** Feature 136 (flow.js castFlash): a sigil read from the bag: its cell pulses in the rune's colour and "You cast
     *  Blink" pops up there. `bounds` is the cell's rectangle on the stage (getBounds). (uiApi had none, so a cast from
     *  the bag showed nothing; 2026-10-30.) */
    castFlash(bounds, colour, name) {
      if (!kit || !bounds) return;
      const rect = { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height };
      clear(flashLayer);
      pulseAt(flashLayer, rect, colour);
      castCard(kit, flashLayer, rect, castWords(name), stage.w, stage.h);
    },
    /** W16: Options' How to play replays the run's first cards; the window it was opened from comes back after. */
    tour() {
      if (mode !== 'play' && mode !== 'title') return;
      const back = win;
      win = null;
      showCard({ id: TOUR[0], page: 0, then: TOUR.slice(1), back, tour: true });
    },
  });
  Object.defineProperties(uiApi, {
    blocking: { get: () => mode !== 'play' || !!win || cardUp() },
    mode: { get: () => mode },
    window: { get: () => win },
  });

  // The windows the engine's events open (platform/event-router.js WINDOWS).
  const ROUTES = {
    forge: () => openWindow('Forge'),
    'core-claimed': () => { if (game().coreInfusion) openWindow('Forge', { tab: 'fuse', infusion: true, onClose: () => o.play({ type: 'end-infusion' }) }); },
    picker: ev => uiApi.picker(ev),
    confirm: ev => openWindow('Confirm', { title: ev.title, text: ev.text, warn: ev.warn, yes: ev.yes ?? { toll: `Pay ${ev.cost} HP`, sacrifice: 'Offer' }[ev.id] ?? 'Yes', no: ev.no, onYes: () => o.play(ev.command), onNo: ev.decline ? () => o.play(ev.decline) : undefined }),
    shrine: ev => openWindow('Shrine', { god: ev.god, prayed: ev.prayed }),
    merchant: () => openWindow('Shop'),
  };

  // ---- pointer events, as pixi's EventBoundary dispatches them

  const isOn = m => m === 'static' || m === 'dynamic';
  function maskHas(mask, gp) {
    const l = mask.worldTransform.applyInverse(gp);
    if (mask.containsPoint(l)) return true;
    return mask.children.some(c => maskHas(c, gp));
  }
  function hitTest(c, gp, mode) {
    if (!c.visible || !c.renderable || !c.measurable || c._isMask || c.destroyed) return null;
    if (c.eventMode === 'none' || (c.eventMode === 'passive' && !c.interactiveChildren)) return null;
    if (c.hitArea) { const l = c.worldTransform.applyInverse(gp); if (!c.hitArea.contains(l.x, l.y)) return null; }
    if (c.mask && !maskHas(c.mask, gp)) return null;
    if (c.interactiveChildren && c.children.length) {
      const kids = c.drawOrder;
      for (let i = kids.length - 1; i >= 0; i--) {
        const ch = kids[i], nested = hitTest(ch, gp, isOn(mode) ? mode : ch.eventMode);
        if (nested) {
          if (nested.length > 0 || c.isInteractive()) nested.push(c);
          return nested;
        }
      }
    }
    if (isOn(mode) && (c.hitArea || c.containsPoint(c.worldTransform.applyInverse(gp)))) return c.isInteractive() ? [c] : [];
    return null;
  }
  const pathAt = (x, y) => hitTest(root, new P.Point(x, y), root.eventMode) ?? [];
  function makeEvent(type, x, y, extra = {}) {
    const e = { type, pointerType: ptype, pointerId: 1, button: 0, buttons: 0, deltaX: 0, deltaY: 0, global: new P.Point(x, y), client: new P.Point(x, y), stopped: false, target: null, currentTarget: null, ...extra };
    e.stopPropagation = () => { e.stopped = true; };
    e.stopImmediatePropagation = () => { e.stopped = true; };
    e.preventDefault = () => {};
    e.getLocalPosition = (c, out) => c.toLocal(e.global, undefined, out);
    e.data = e;
    return e;
  }
  /** Emits on each node of a path, from the target out, until one stops it. */
  function bubble(path, type, e) {
    e.target = path[0] ?? null;
    for (const n of path) { if (n.destroyed) continue; e.currentTarget = n; n.emit(type, e); if (e.stopped) break; }
  }
  function everyListening(type, c = root, out = []) { if (c.listenerCount(type)) out.push(c); for (const ch of c.children) everyListening(type, ch, out); return out; }
  let overPath = [], pressPath = null, rightPath = null, cursor = 'default', mouse = { x: -1, y: -1 };
  // The pointer a press came from: 'touch' for a finger (ui2d.gd: Godot's touch, felt as its mouse), else 'mouse'. A
  // finger has no hover: a tap shows a control's card, a hold lifts a drag (drag.js), Inventory picks on a tap.
  let ptype = 'mouse';
  function pointer(kind, x, y, extra = {}) {
    ptype = extra.pointer === 'touch' ? 'touch' : 'mouse';
    mouse = { x, y };
    if (kind === 'wheel') { const path = pathAt(x, y); bubble(path, 'wheel', makeEvent('wheel', x, y, { deltaY: extra.dy ?? 0, deltaX: extra.dx ?? 0 })); return; }
    const path = pathAt(x, y), target = path[0] ?? null;
    if (kind === 'move' || kind === 'down' || kind === 'up') {
      const old = overPath[0] ?? null;
      if (old !== target) {
        if (old && !old.destroyed) bubble(overPath, 'pointerout', makeEvent('pointerout', x, y));
        for (const n of overPath) if (!path.includes(n) && !n.destroyed) n.emit('pointerleave', makeEvent('pointerleave', x, y));
        for (const n of path) if (!overPath.includes(n)) n.emit('pointerenter', makeEvent('pointerenter', x, y));
        overPath = path;
        if (target) bubble(path, 'pointerover', makeEvent('pointerover', x, y));
      }
      bubble(path, 'pointermove', makeEvent('pointermove', x, y));
      for (const n of everyListening('globalpointermove')) { if (n.destroyed) continue; const e = makeEvent('globalpointermove', x, y); e.target = target; e.currentTarget = n; n.emit('globalpointermove', e); }
    }
    // The right button as pixi's EventBoundary has it (button 2): pointerdown and rightdown, pointerup and rightup, then
    // rightclick and pointertap on the pressed target; its press kept apart from the left's. (Only the left button came:
    // a right-click could not drop a bag item or take off a weapon; 2026-10-30, inventory.js cell.)
    const right = extra.button === 2, btn = right ? { button: 2 } : {};
    if (kind === 'down') {
      if (right) rightPath = path; else pressPath = path;
      bubble(path, 'pointerdown', makeEvent('pointerdown', x, y, { ...btn, buttons: right ? 2 : 1 }));
      if (right) bubble(path, 'rightdown', makeEvent('rightdown', x, y, { ...btn, buttons: 2 }));
    }
    if (kind === 'up') {
      const was = right ? rightPath : pressPath;
      bubble(path, 'pointerup', makeEvent('pointerup', x, y, btn));
      if (right) bubble(path, 'rightup', makeEvent('rightup', x, y, btn));
      const pressed = (was ?? []).filter(n => !n.destroyed && n.parent || n === root);
      for (const n of pressed) if (!path.includes(n)) n.emit('pointerupoutside', makeEvent('pointerupoutside', x, y, btn));
      // pixi's click target: the pressed target or its nearest ancestor that the release is also over.
      let i = 0;
      while (i < pressed.length && !path.includes(pressed[i])) i++;
      if (was && i < pressed.length) {
        const tapPath = pressed.slice(i);
        if (right) bubble(tapPath, 'rightclick', makeEvent('rightclick', x, y, btn));
        bubble(tapPath.filter(n => !n.destroyed), 'pointertap', makeEvent('pointertap', x, y, btn));
        if (!right) bubble(tapPath, 'click', makeEvent('click', x, y));
      }
      if (right) rightPath = null; else pressPath = null;
    }
    // The pointer's look under it: the nearest control's cursor.
    cursor = 'default';
    for (const n of overPath) if (n.cursor && n.cursor !== 'auto' && !n.destroyed) { cursor = n.cursor; break; }
  }

  // ---- keys (flow.js action)

  const KEY_TAB = { character: 'Character', inventory: 'Inventory', faith: 'Faith' };
  function action(a) {
    // A slot's menu takes the keys while it is up: Esc closes it (any other key too, as a tap elsewhere does).
    if (menu) { closeMenu(); return true; }
    // A card takes the keys while it is up: Enter or Wait turns the page, Esc closes it.
    if (cardUp()) { if (a === 'close') cardEnd(); else if (a === 'confirm' || a === 'wait') cardNext(); return true; }
    if (mode === 'create' && !win && creatorCard()) { if (a === 'close' || a === 'confirm' || a === 'wait') { tut.mark(creatorCard()); build(); } return true; }
    if (mode === 'end') return a === 'close' ? false : true;
    if (mode === 'create' && !win && a === 'close') return createActs.back(), true;
    if ((mode === 'title' || mode === 'create') && !win) {
      // CF41 (flow.js action): on the god step Left and Right turn the carousel; Up and Down move the focus.
      if (mode === 'create' && (a === 'move-w' || a === 'move-e')) {
        const turn = kit?.hooks.controls.findLast(c => c.node.label === (a === 'move-w' ? 'god-prev' : 'god-next') && !c.node.destroyed && c.node.parent);
        if (turn) { turn.act(); return true; }
      }
      if (a === 'wait' || a === 'confirm') focus.action('confirm');
      else if (a.startsWith('move-')) focus.action(a);
      return true;
    }
    if (a === 'close' && !win && mapOn) return toggleMap(false);
    if (a === 'map' && !win) return toggleMap(), true;
    if (a === 'menu') { if (win === 'Menu') closeWindow(); else openWindow('Menu'); return true; }
    if (a === 'journal') { if (win === 'Journal') closeWindow(); else openWindow('Journal'); return true; }
    if (a === 'close') return closeWindow();
    if (KEY_TAB[a]) { if (win === KEY_TAB[a]) closeWindow(); else { mapOn = false; openWindow(KEY_TAB[a]); } return true; }
    if (!win) return false;
    if (a === 'wait' || a === 'confirm') return focus.action('confirm');
    if (a.startsWith('move-')) { focus.action(a); return true; }
    return true;
  }

  // ---- timers: setTimeout and requestAnimationFrame run as Godot's frames go by (tick)

  const timers = [];
  let clock = 0, timerId = 1;
  globalThis.setTimeout = (fn, ms = 0, ...a) => { const id = timerId++; timers.push({ id, at: clock + (ms || 0), fn, a }); return id; };
  globalThis.clearTimeout = id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); };
  globalThis.setInterval = (fn, ms = 0, ...a) => { const id = timerId++; const run = () => { timers.push({ id, at: clock + ms, fn: () => { fn(...a); run(); }, a: [] }); }; run(); return id; };
  globalThis.clearInterval = globalThis.clearTimeout;
  globalThis.requestAnimationFrame = fn => globalThis.setTimeout(() => fn(clock), 0);
  globalThis.cancelAnimationFrame = id => globalThis.clearTimeout(id);
  function tick(ms) {
    clock += ms;
    for (let n = 0; n < 50; n++) {
      const due = timers.filter(t => t.at <= clock).sort((a, b) => a.at - b.at);
      if (!due.length) break;
      for (const t of due) { const i = timers.indexOf(t); if (i < 0) continue; timers.splice(i, 1); t.fn(...t.a); }
    }
    P.Ticker.shared.tick(ms);
  }

  // ---- what Godot draws: the tree, as plain data

  const r2 = v => Math.round(v * 100) / 100;
  const ident = m => m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.tx === 0 && m.ty === 0;
  const mat = m => [r2(m.a * 1000) / 1000, r2(m.b * 1000) / 1000, r2(m.c * 1000) / 1000, r2(m.d * 1000) / 1000, r2(m.tx), r2(m.ty)].map(v => Math.round(v * 10000) / 10000);
  const colour = (c, a) => { const [rgb, al] = P.colourOf(c, a ?? 1); return [rgb, Math.round(al * 1000) / 1000]; };
  const pts = s => s.pts.map(r2);
  function gradient(g) { return { a: [g.start.x, g.start.y], b: [g.end.x, g.end.y], s: g.colorStops.map(s => [s.offset, ...colour(s.color, s.alpha)]), l: g.textureSpace !== 'global' }; }
  function drawing(g) {
    const out = [];
    for (const ins of g.context.instructions) {
      if (ins.action === 'fill') {
        const st = ins.style, [rgb, a] = colour(st.color, st.alpha);
        if (a < 0.004 && !st.fill) continue;
        const d = { f: [rgb, a], p: ins.path.subs.filter(s => s.pts.length >= 6).map(pts) };
        if (st.fill instanceof P.FillGradient) d.g = gradient(st.fill);
        if (ins.holes) d.h = ins.holes.map(pts);
        if (d.p.length) out.push(d);
      } else if (ins.action === 'stroke') {
        const st = ins.style, [rgb, a] = colour(st.color, st.alpha);
        if (a < 0.004) continue;
        out.push({ s: [rgb, a, st.width ?? 1, st.alignment ?? 0.5], p: ins.path.subs.map(pts), cl: ins.path.subs.map(s => (s.closed ? 1 : 0)) });
      } else if (ins.action === 'svg') out.push({ svg: ins.svg, box: ins.box });
      else if (ins.action === 'texture') { const t = ins.texture; out.push({ img: t.source.label, fr: [t.frame.x, t.frame.y, t.frame.width, t.frame.height], r: ins.rect, t: ins.tint }); }
    }
    return out;
  }
  function words(t) {
    const m = t.metrics, st = t.style, fp = m.fontProperties, sw = st.stroke?.width || 0;
    const lh = st.lineHeight || fp.fontSize, shift = Math.max(0, (lh - fp.fontSize) / 2);
    const ox = -t.anchor.x * m.width, oy = -t.anchor.y * m.height;
    const x0 = i => sw / 2 + (st.align === 'right' ? m.maxLineWidth - m.lineWidths[i] : st.align === 'center' ? (m.maxLineWidth - m.lineWidths[i]) / 2 : 0);
    const y0 = i => sw / 2 + i * m.lineHeight + fp.ascent + shift;
    const font = P.fontFile(st), out = { k: 'x', f: font, px: st.fontSizePx, ink: colour(st.fill instanceof P.FillGradient ? st.fill.colorStops[0]?.color : st.fill) };
    const tagged = st.tagStyles && /<[a-z]/i.test(t.text) && !st.wordWrap;
    if (tagged) {
      const names = Object.keys(st.tagStyles).join('|'), re = new RegExp(`<(${names})>([\\s\\S]*?)<\\/\\1>`, 'g');
      out.l = t.text.split(/\r\n|\r|\n/).map((line, i) => {
        const runs = [];
        let at = 0, x = ox + x0(i), mm;
        const push = (s, tag) => {
          if (!s) return;
          const ts = tag ? st.tagStyles[tag] : null, f = ts ? P.fontFile({ ...st._plain(), ...ts }) : font, px = ts?.fontSize ? parseFloat(ts.fontSize) : st.fontSizePx;
          runs.push([s, r2(x), r2(oy + y0(i)), ts?.fill !== undefined ? colour(ts.fill) : null, f !== font ? f : null, px !== st.fontSizePx ? px : null]);
          x += P.hooks.measure(f, px, s);
        };
        re.lastIndex = 0;
        while ((mm = re.exec(line))) { push(line.slice(at, mm.index), null); push(mm[2], mm[1]); at = re.lastIndex; }
        push(line.slice(at), null);
        return runs;
      }).flat();
    } else out.l = m.lines.map((s, i) => [s, r2(ox + x0(i)), r2(oy + y0(i))]);
    if (st.dropShadow) { const d = st.dropShadow; out.sh = [...colour(d.color, d.alpha), d.blur, r2(Math.cos(d.angle) * d.distance), r2(Math.sin(d.angle) * d.distance)]; }
    if (st.stroke && sw) out.st = [...colour(st.stroke.color ?? st.stroke.fill ?? 0), sw];
    if (st.letterSpacing) out.ls = st.letterSpacing;
    return out;
  }
  function picture(s, o) {
    const t = s.texture;
    if (!t || t === P.Texture.EMPTY || !t.source) return false;
    o.k = 's'; o.src = t.source.label; o.fr = [t.frame.x, t.frame.y, t.frame.width, t.frame.height].map(r2); o.q = s._quad().map(r2);
    // A painted canvas: what was painted, at its own pixel size (the source's size times its resolution).
    if (t.source.resource instanceof P.RecCanvas) { const cv = t.source.resource; o.cv = { w: cv.width, h: cv.height, ops: cv.ops }; o.fr = [0, 0, t.source.width, t.source.height]; }
    if (t.source.scaleMode === 'nearest') o.n = 1;
    return true;
  }
  /** One node and what is under it; null for what does not draw. */
  function ser(c, asMask = false) {
    if (!c.visible || !c.renderable || c.destroyed || (c._isMask && !asMask)) return null;
    if (c.alpha <= 0.001 && !asMask) return null;
    if (c.filters?.some?.(f => f instanceof P.BlurFilter && f.enabled !== false && f.strength > 0)) return null;
    const o = {};
    const m = c.localTransform;
    if (!asMask && !ident(m)) o.m = mat(m);
    if (c.alpha !== 1) o.a = Math.round(c.alpha * 1000) / 1000;
    if (c.tint != null && c.tint !== 0xffffff && c.tint !== -1) o.t = P.colourOf(c.tint)[0];
    const cm = c.filters?.find?.(f => f instanceof P.ColorMatrixFilter && f.enabled !== false);
    if (cm && cm.matrix[0] !== 1) o.b = Math.round(cm.matrix[0] * 1000) / 1000;
    if (c.blendMode === 'add') o.bm = 'add';
    if (c instanceof P.Graphics) { o.k = 'g'; o.d = drawing(c); }
    else if (c instanceof P.Text) { Object.assign(o, words(c)); }
    else if (c instanceof P.NineSliceSprite) {
      const t = c.texture;
      o.k = 'n'; o.src = t.source.label; o.fr = [t.frame.x, t.frame.y, t.frame.width, t.frame.height]; o.w = r2(c.width); o.h = r2(c.height);
      o.b9 = [c.leftWidth, c.topHeight, c.rightWidth, c.bottomHeight]; o.q = [r2(-c.anchor.x * c.width), r2(-c.anchor.y * c.height)];
    } else if (c instanceof P.Sprite) { if (!picture(c, o)) o.k = 'c'; }
    else if (c instanceof P.PerspectiveMesh && c.texture?.source) { const t = c.texture; o.k = 'pm'; o.src = t.source.label; o.fr = [t.frame.x, t.frame.y, t.frame.width, t.frame.height]; o.q = c.corners.map(r2); o.g = [c.verticesX, c.verticesY]; }
    else if (c instanceof P.TilingSprite) { const t = c.texture; o.k = 'ts'; o.src = t.source.label; o.fr = [t.frame.x, t.frame.y, t.frame.width, t.frame.height]; o.w = r2(c.width); o.h = r2(c.height); }
    else o.k = 'c';
    const kids = [];
    for (const ch of c.drawOrder) {
      const s = ser(ch);
      if (!s) continue;
      if (ch.mask && ch.mask.parent !== undefined) {
        // A masked child: a clip node holds the mask's drawing in the mask's place, and the child inside it.
        const mk = ch.mask, rel = c.worldTransform.invert().append(mk.worldTransform);
        const inner = rel.clone().invert().append(ch.localTransform);
        s.m = mat(inner);
        const clip = { k: 'clip', m: mat(rel), mask: ser(mk, true), c: [s] };
        kids.push(clip);
      } else kids.push(s);
    }
    if (kids.length) o.c = kids;
    if (o.k === 'c' && !o.c) return null;
    return o;
  }

  // ---- the run's moments (play-loop.js, run-saves.js)

  /** run-saves.js deleteRunSaves: the saves that hold this run (its id, or for an older save its seed and hero). */
  function deleteRunSaves(g) {
    let gone = 0;
    for (const id of ['auto', '1', '2', '3', 'sandbox']) {
      const s = loadFrom(storage, id);
      const same = s && (s.runId && g.runId ? s.runId === g.runId : s.seed === g.seed && s.hero?.name === g.hero?.name && s.hero?.cls === g.hero?.cls);
      if (same && slots.remove(id)) gone += 1;
    }
    return gone;
  }

  function afterStep(events) {
    const g = game();
    if (!g) return;
    for (const ev of events ?? []) { uiApi.forgeEvent(ev); ROUTES[ev.type]?.(ev); }
    for (const t of watch.step(g, events)) say(`Achievement: ${t}.`, 0xe8b44a);
    if (!g.over && tipsOn()) tipsWaiting.push(...tipsFromEvents(g, events));   // RB3: a first level up, item, sigil, shrine, Forge, god
    if (g.over && !g.finished) {
      g.finished ??= runRecord(g, !!g.won, it => itemName(it, g));
      // C81 (run-saves.js runEnded): death is final, every save of the run goes; a win clears the Continue autosave.
      // (Kept, Continue brought the dead hero back; 2026-10-30, the 2D game audited.)
      if (!g.won && deleteRunSaves(g)) say('Death is final. Run saves deleted.', 0xc8382e);
      if (g.won && !g.sandbox) slots.remove('auto');
      for (const t of watch.finish(g, g.finished)) say(`Achievement: ${t}.`, 0xe8b44a);
      g.earned = watch.earned();
      g.historySaved = slots.works();
      win = null; mapOn = false;
      wantsEnd = true;
    }
    const boss = !!bossOf(g);
    if (win || mapOn || hovered || boss || bossShown) build();
    bossShown = boss;
  }
  let bossShown = false;

  // ---- what Godot has drawn, so a frame sends only what changed (frame)

  let lastTree = null, frameSeq = 0;
  /** Two FNV-1a hashes of a string, side by side, in base 36. */
  const hashOf = s => {
    let a = 0x811c9dc5, b = 0x01000193 ^ s.length;
    for (let i = 0; i < s.length; i++) { const k = s.charCodeAt(i); a = Math.imul(a ^ k, 16777619); b = Math.imul(b ^ k, 2246822519); }
    return (a >>> 0).toString(36) + (b >>> 0).toString(36);
  };
  // A node's place and look over what it draws: these change every tick for whatever sways or fades (creation's grass,
  // about 440 tufts), and Godot moves such a node without drawing it again.
  const PLACE = { m: [1, 0, 0, 1, 0, 0], a: 1, t: 0xffffff, b: 1, bm: '', n: 0 };
  const HASHES = ['#', '#o', '#d'];
  /** Each node's hashes, kept here only: what it draws (#d), all it holds but its children (#o), its whole part (#). */
  function stamp(n) {
    const { c, ...own } = n, drawn = { ...own };
    for (const k in PLACE) delete drawn[k];
    n['#d'] = hashOf(JSON.stringify(drawn));
    n['#o'] = hashOf(n['#d'] + JSON.stringify([own.m, own.a, own.t, own.b, own.bm, own.n]));
    n['#'] = c ? hashOf(n['#o'] + '|' + c.map(stamp).join(',')) : n['#o'];
    return n['#'];
  }
  /** A node as Godot gets it: without the hashes. */
  function bare(n) {
    const { c, ...own } = n;
    for (const k of HASHES) delete own[k];
    if (c) own.c = c.map(bare);
    return own;
  }
  /**
   * The frame as it differs from the last, node by node in place: the same part is {"=": 1}; a node that only moved
   * or faded is {"~": 1} with its new place and look (its children, when they are all the same, left out); any
   * other is sent whole, its children as they differ.
   */
  function changed(n, was) {
    if (was && was['#'] === n['#']) return { '=': 1 };
    const kids = n.c ? n.c.map((k, i) => changed(k, was?.c?.[i])) : null;
    if (was && was.k === n.k && was['#d'] === n['#d']) {
      const out = { '~': 1 };
      for (const k in PLACE) if (JSON.stringify(n[k]) !== JSON.stringify(was[k])) out[k] = n[k] ?? PLACE[k];
      const same = kids && was.c && kids.length === was.c.length && kids.every(k => k['=']);
      if (!same && (kids || was.c)) out.c = kids ?? [];
      return out;
    }
    const { c, ...own } = n;
    for (const k of HASHES) delete own[k];
    if (kids) own.c = kids;
    return own;
  }

  return {
    /** The Options' sound settings (display.js audio.setLevels), for scripts/sound.gd. */
    audioLevels: () => ({ sound: opts.sound ?? true, music: opts.music ?? true, sfxVolume: opts.sfxVolume ?? 50, musicVolume: opts.musicVolume ?? 50 }),
    /** Plates loaded, the stage known. */
    async start(vw, vh, touch = false, dpr = 1) {
      stage = stageOf(vw, vh, touch, dpr);
      await loadPlates();
      ready = true;
      build();
    },
    resize(vw, vh, touch = stage.touch, dpr = 1) { stage = stageOf(vw, vh, touch, dpr); build(); },
    /** run-saves.js saveNow: the run kept in its autosave as a floor begins (a sandbox run in its own slot; a won run never). */
    autosave() { const g = game(); if (g && !g.won) keep(g.sandbox ? 'sandbox' : 'auto'); },
    /** ui-calls.js newRun: a run the player began (creation's Enter, the end's Play again) is named, sets the
     *  tutorial as creation chose, and starts saved. */
    runBegun(choice) {
      const g = game();
      if (!g) return;
      g.runId = `run-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
      slots.setTutorial(choice?.tutorial !== false);
      coachDue = choice?.tutorial !== false;
      this.autosave();
    },
    /** A new run on screen, its log starting with its opening lines (`opening`: who enters, the floor's intro). */
    newRun(opening = []) {
      for (const w of Object.values(WINDOWS)) w.newRun?.();
      mode = 'play'; win = null; mapOn = false; wantsEnd = false;
      history.splice(0, history.length, ...opening.map(l => ({ words: l.words, fill: l.fill })));
      cardsReset(); closeMenu(); hudTip = null;
      const g = game();
      if (g) for (const t of watch.start(g)) say(`Achievement: ${t}.`, 0xe8b44a);
      build();
    },
    afterStep, pointer, action, tick, open: openWindow, close: closeWindow, toggleMap, heard,
    hudPlaces, hudHover, barMove, slotPulse, slotRightClick, closeMenu, rawKey, fileChosen, slotInfo,
    say: (w, f) => say(w, f ?? undefined),
    /** Something covers the HUD (a screen, a window, a card, a slot's menu); the map overlay does not (flow.js). */
    get covered() { return mode !== 'play' || !!win || cardUp() || !!menu; },
    /** A file to save or to open, said once (the bridge sends it to Godot). */
    takeFile() { const f = fileOut; fileOut = null; return f; },
    /** The bridge's hotbar press (hotbar.js use): the slot's click (A7), and a sigil's pulse in its rune's glow. */
    slotUsed(i, glow) { cue('ui-click'); slotPulse(i, glow); },
    /** Options' key table in force (input.js keyTable over the stored choices), for play.gd's keys; keysSeq counts its changes. */
    get keys() { return keyTable(opts.keys && Object.keys(opts.keys).length ? opts.keys : null); },
    get keysSeq() { return JSON.stringify(opts.keys ?? null); },
    /** The options that change the 3D build's play (scripts: hud.gd, play.gd), sent when one changes. */
    // pad, padSide, padSize: Options' Movement pad rows (hud.js: unset, the pad is on for a tablet and off for a phone);
    // form: the stage's device (phone, tablet, desktop: stage.js formOf), for the HUD's touch controls.
    get playOptions() { return { pad: !!optionOf(deps.options, 'pad', stage), padSide: opts.padSide ?? 'left', padSize: opts.padSize ?? 'normal', form: stage.form, animSpeed: +(opts.animSpeed ?? 1) || 1, statusSize: opts.statusSize ?? 'normal', statusSide: opts.statusSide ?? 'left', hotbar: opts.hotbar ?? 'horizontal', zoom: opts.zoom ?? 'normal', contrast: !!opts.contrast, mapArt: opts.mapArt ?? 'sprites', lighting: opts.lighting === true ? 'relief' : opts.lighting ?? 'relief', lowPower: !!opts.lowPower, gamepad: opts.gamepad ?? true }; },
    /** The end screen, once the death has played (Godot says when, play-loop.js DEATH_PAUSE_MS). */
    showEnd() { mode = 'end'; win = null; mapOn = false; build(); },
    /** The title screen, over the run the game starts with (flow.js showTitle). */
    showTitle() { mode = 'title'; win = null; mapOn = false; build(); },
    refresh() { if (win || mapOn || mode !== 'play') build(); },
    /** The hero stands, the turn played out (play-loop.js): a new run's opening cards, then the turns' waiting ones. */
    standing() {
      const g = game();
      if (!g || g.over) return;
      if (coachDue) { coachDue = false; offerTips([...TOUR, ...(g.hero?.cls === 'cleric' && g.hero?.faith?.god ? ['god'] : [])]); }
      if (tipsWaiting.length) { const t = [...new Set(tipsWaiting)]; tipsWaiting = []; offerTips(t); }
    },
    /** Cards wait for the hero to stand: Godot says when (standing). */
    get tips() { return mode === 'play' && (coachDue || tipsWaiting.length > 0); },
    /** The 3D hall stands behind creation now (main.gd). */
    hall() { hallAt = performance.now(); build(); },
    /** Where the 3D camera shows the floor: its projection and view (16 numbers, columns) and the screen's size. */
    set cam(c) { cam = c; },
    mapHover,
    /** For testing: the live control of that label pressed (bridge-core.js debug tap). */
    // By its label, or by its words when it has none (creation's Confirm and Enter plates).
    tap(label) {
      const live = kit?.hooks.controls.filter(c => !c.node.destroyed && c.node.parent) ?? [];
      const says = n => n.text === label || (n.children ?? []).some(says);
      (live.findLast(c => c.node.label === label) ?? live.findLast(c => says(c.node)))?.act();
    },
    /** For testing (play.gd {drag=...}): where the control of that label is, in the stage's units, or null. */
    where(label) { const n = findLabel(root, label); if (!n || n.destroyed) return null; const b = boundsIn(n, root); return { x: b.x, y: b.y, w: b.w, h: b.h }; },
    /** What is typed in Godot's field over the text being edited; done when Enter, Esc or a click elsewhere ends it. */
    text(value, done) { if (!typing) return; entry.typed(value); if (done) entry.blur(); },
    get wantsEnd() { return wantsEnd; },
    get gfx() { return gfx; },
    get gfxSeq() { return gfxSeq; },
    /** One of the 3D look's settings set from Godot (play.gd: the camera's keys), kept as a choice in Options is. */
    setGfx(k, v) {
      if (!(k in gfx)) return;
      // The camera's zoom keys move Options' Map zoom with it (its row shows the zoom in force).
      if (k === 'zoom') { const name = Object.keys(MAP_ZOOM).find(n => MAP_ZOOM[n] === v); if (name) opts.zoom = name; }
      gfxCtl.set(k, v);
    },
    /** An option's value, and one set as the Options window sets it (stored; play.gd's N toggles the music). */
    option: k => opts[k] ?? true,
    setOption: (k, v) => deps.options.set(k, v),
    markTarget: deps.markTarget, markHover: deps.markHover, markBow: deps.markBow,
    get marks() { return marks; },
    get marksSeq() { return marksSeq; },
    get blocking() { return isBlocking(); },
    get stage() { return stage; },
    flush() { storage.flush(); },
    /**
     * What Godot draws now, or null when it has not changed since the last call: only what changed since the last
     * frame sent (changed: a part that did not is {"=": 1}, kept as Godot has it; one that only moved, {"~": 1}), so
     * Godot redraws only what changed (game.gd _merged, ui2d.gd _update). Sending and rebuilding the whole
     * drawing every frame, about 60 KB in creation, held the browser build to a frame a second or so (Justin
     * 2026-10-28: "I'm getting like 1 fps if that in character creation"). #s numbers each frame, #b the one it
     * changes (0: the whole drawing), so Godot can tell when one went missing and ask for the whole again (force).
     */
    frame(force = false) {
      const tree = ser(root) ?? { k: 'c' };
      stamp(tree);
      if (!force && lastTree && lastTree['#'] === tree['#']) return null;
      const whole = force || !lastTree, out = whole ? bare(tree) : changed(tree, lastTree);
      out['#s'] = ++frameSeq; out['#b'] = whole ? 0 : frameSeq - 1;
      lastTree = tree;
      return out;
    },
    get cursor() { return cursor; },
    root,
    // hud: the hotbar slot a drag is over and the one it came from, a slot's menu up (hud.gd draws them); live: timers or
    // animations still to run (a cast's pulse, a card fading), so Godot ticks the windows' clock while one runs with no
    // window up; listening: Options waits for a key to bind, so the keys come as they are (ui2d.gd).
    get state() {
      return { window: win, map: mapOn, mode, blocking: isBlocking(), typing, stage: { w: stage.w, h: stage.h, s: stage.s, ox: stage.ox, oy: stage.oy, kind: stage.kind },
        hud: { over: hudDrag.over, lifted: hudDrag.lifted, menu: !!menu }, live: timers.length > 0 || P.Ticker.shared.count > tickBase, listening: keyListeners.length > 0 };
    },
    PLAY_MS,
  };
}
