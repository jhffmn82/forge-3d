// The browser's entry (consolidation C15: boot only). It builds the page's parts and hands each the run state S; what
// they do lives beside them: platform/display.js (density, options, resizes), run-saves.js (saves and the journal),
// floor-show.js (floor holds), play-loop.js (turns, the walker, input), event-router.js (each played event),
// ui-calls.js (what the windows may ask), dev-hook.js (window.forge, ?dev=quick).
import { loadManifest, loadGroup, streamGroups } from './platform/assets.js';   // installs catalog loading before UI imports can request art
import { createFieldsView } from './render/fields-view.js';
import { Application, Container, Text } from '../../forge-godot/runtime/pixi.js';
import ui from '../data/ui.json' with { type: 'json' };
import { watchStage, isTouchDevice } from './ui/core/stage.js';
import { createClock } from './render/clock.js';
import { createMapView } from './render/map-view.js';
import { createPlayback } from './render/playback.js';
import { heldGear } from './render/held.js';
import { createAudio } from './audio/audio.js';
import { loadFrom } from './save/save.js';
import { createJournal, journalWatcher } from './save/journal.js';
import { importLegacy } from './save/legacy.js';
import { createSlots } from './save/slots.js';
import { createNotices } from './ui/hud/notices.js';
import { color } from './ui/core/widgets.js';
import { createUi } from './ui/screens/flow.js';
import { startOffline } from './platform/offline.js';
import { loadFonts } from './platform/fonts.js';
import { PLAY_GROUPS } from './platform/floor-art.js';
import { veilStatus, densityFor, createDisplay } from './platform/display.js';
import { createRunSaves } from './platform/run-saves.js';
import { createFloorShow } from './platform/floor-show.js';
import { createPlayLoop } from './platform/play-loop.js';
import { routeEvents } from './platform/event-router.js';
import { uiCalls } from './platform/ui-calls.js';
import { devHook } from './platform/dev-hook.js';

async function boot() {
  const veil = veilStatus();   // index.html's loader counted the code as 0-85%; the start takes it on to 100%
  veil.say('Loading game… 88%');
  await loadFonts();
  veil.say('Loading game… 92%');
  const app = new Application();
  // The run state every part reads: the game, the stage and its density, the floor hold, the HUD, and what a run's
  // start hands the HUD (the loaded log, achievements already earned, the tutorial's guide).
  const S = { game: null, stage: null, cssSize: null, resolution: densityFor(false), lowPower: false, floorHold: null, ui: null, shownFloor: 0, arrival: null, startEarned: [], coachDue: false };
  await app.init({ background: ui.theme.obsidian.bg, resolution: S.resolution, autoDensity: true, antialias: false, preference: 'webgl' });
  document.getElementById('game').appendChild(app.canvas);
  veil.say('Loading game… 96%');
  const loading = new Text({ text: 'Loading', style: { fontFamily: ui.fonts.display, fontSize: 28, fill: ui.theme.obsidian.rest } });
  loading.anchor.set(0.5); loading.position.set(window.innerWidth / 2, window.innerHeight / 2);
  app.stage.addChild(loading);
  await loadManifest();
  veil.say('Loading game… 100%');
  veil.say('Lighting the torches…');
  let scene = 0, sceneOf = 0;
  const each = n => { if (n !== undefined) sceneOf += n; else scene += 1; if (sceneOf) veil.say(`Loading this scene ${scene} / ${sceneOf}`); };
  await Promise.all(['boot', 'audio-boot'].map(n => loadGroup(n, { each })));
  veil.done();
  loading.destroy();
  // Staged loading, as 1.7 (js/runtime/boot.js:404-410 @3c8b312, sandbox item 45): the title waits only for the
  // code, fonts, manifest and its own picture. Once it is drawn, creation's paintings and then the first floor's art
  // stream in behind it one group at a time (streamGroups, after the HUD starts below).

  const clock = createClock(app.ticker);
  const map = createMapView(clock);
  // Burning ground and fields (src/render/fields-view.js): above the light map (fire glows), under the aim mark and numbers.
  const fieldsView = createFieldsView(clock);
  map.root.addChildAt(fieldsView.root, Math.max(0, map.root.children.length - 2));
  // CR15: the residues' pools lie on the ground, under the bodies and the light map (1.7 drawGroundMaterial).
  map.root.addChildAt(fieldsView.under, map.root.getChildIndex(map.lightLayer.unlit) + 1);
  const groundLayers = map.lightLayer.flats.parent;
  groundLayers.addChildAt(fieldsView.puddles, groundLayers.getChildIndex(map.lightLayer.flats));
  // 1.7's effects are the one effects layer (fx-kit.js, map.pieces; C9): its struck surface of an area cast lies on the ground.
  map.root.addChildAt(map.pieces.under, map.root.getChildIndex(fieldsView.under) + 1);   // WC5
  // Burning tiles are lights too (lightmap, c1c02cb): when the fires change, the light map is worked out again.
  let fireKey = '';
  const drawFields = () => {
    if (!S.game) return;
    fieldsView.set(S.game, map.tile);
    const key = Object.keys(S.game.floor.burning ?? {}).join(',');
    if (key !== fireKey) { fireKey = key; map.setSight(S.game); }
  };
  map.gearOf = heldGear;
  const uiLayer = new Container();
  app.stage.addChild(map.root, uiLayer);
  // The floor notice and the offline badge, over everything (ui/hud/notices.js).
  const notices = createNotices(app.stage, () => S.resolution);
  const storage = window.localStorage;
  const audio = createAudio({ touch: isTouchDevice });   // C15: the device fact comes from here; audio imports no UI
  // Justin 2026-10-16: input never waits on creatures out of sight; their moves and blows land at once.
  const playback = createPlayback(clock, map, { seen: (x, y) => !!S.game?.vis?.[y * S.game.floor.w + x], player: () => S.game?.playerId, cue: n => audio.cue(n), ally: id => S.game?.actors?.[id]?.side === 'ally' });
  importLegacy(storage);   // EP44: the earlier build's settings, once, before this build's options are read
  const slots = createSlots(storage), opts = slots.readOptions();
  const inputOptions = { gamepad: true, keys: null };
  const display = createDisplay(S, { app, map, audio, clock, opts, inputOptions, notices });
  const journal = createJournal(storage), watch = journalWatcher(journal);
  const saves = createRunSaves(S, { storage, slots, journal, watch, audio });
  const floors = createFloorShow(S, { map, notices, audio, drawFields, saves });
  const loop = createPlayLoop(S, { app, clock, map, playback, audio, saves, watch, opts, slots, display, inputOptions });
  routeEvents(S, { playback, map, audio, fieldsView, drawFields, saves, floors, loop });
  S.ui = createUi(uiLayer, S.resolution, uiCalls(S, { map, audio, slots, opts, journal, saves, floors, loop, display }));
  if (typeof __FORGE_PUBLIC__ === 'undefined' || !__FORGE_PUBLIC__) {
    const { mountRecorder } = await import('./platform/recorder.js');
    mountRecorder(S, { ticker: app.ticker, canvas: app.canvas, audio });   // item 172: the sandbox's Record button
  }

  watchStage(display.onStage);
  display.applyOptions();
  await S.ui.start();
  audio.playMusic('title');
  // The stream behind the title (items 181, 200, 222, 291): creation's paintings first, so creation's figures are in
  // when it opens, then the first floor's art and a saved hero's look.
  // Continue or New game sooner loads what it needs itself.
  const savedLook = (() => { try { const n = slots.newestSlot(); return n ? loadFrom(storage, n.id)?.hero?.look ?? null : null; } catch { return null; } })();   // EP40: Continue's hero
  streamGroups(['creation', ...PLAY_GROUPS, ...(savedLook ? ['look-' + savedLook] : [])]);
  loop.start();
  // O1: a stamped release's offline copy (platform/offline.js), its badge in the lower right corner, stored only once
  // a run is on screen with its floor drawn.
  startOffline({ say: (t, done) => notices.badge(t, done), settled: () => S.ui.mode === 'play' && !S.floorHold, log: w => S.ui.say(w, color.ash) });
  document.getElementById('loadVeil')?.remove();   // completion does not depend on the local debug handle
  if (typeof __FORGE_PUBLIC__ === 'undefined' || !__FORGE_PUBLIC__) await devHook(S, { app, map, audio, playback, notices, storage, saves, floors });
}

boot();
