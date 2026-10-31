// The play loop (consolidation C15, moved from main.js): the pump that starts each turn, the one buffered command, the
// one walker slot (Explore or a rest), walks of more than a step, and the keys, pad and presses that drive them.
// S is the page's run state (main.js): game, ui, floorHold.

import { step } from '../engine/game.js';
import { createTraveller } from '../engine/travel.js';
import { startWalk, walkNext } from '../rules/auto.js';   // C12: explore and rest are the one walker's kinds
import { startInput, commandFor } from '../input/input.js';
import { attachMapInput } from '../ui/hud/map-input.js';
import { tipsFromEvents } from '../ui/hud/tips.js';
import { flushLog } from '../ui/screens/log-text.js';
import { recentLog } from '../ui/screens/hud.js';
import { color } from '../ui/core/widgets.js';

// Movement rebuild (feel spec 2.1, 2.3; Justin 2026-10-17: "the point was to right new code because the old code was
// slow and all over the place"): turns run from the pump, the clock's first call each frame, when the gate is open:
// no hold playing (a blow, cast, shot or death), the hero's slide and every visible creature's 0.7 through or done,
// no floor hold. What runs: the one buffered command (items 78, 109: a press counts at any point of a step, a newer
// one replaces it), else a held key or pad (item 43: no system key repeat), else a walk, Explore or a rest. A turn
// starts at max(the press or the gate opening, the frame's time less a frame), never later than the frame, so the
// next step leaves while the hero still slides and no work sits between his arrival and his departure.
const DEATH_PAUSE_MS = 1300;   // item 90: 1.7's pause between the hero's fall and the score screen
const FRAME_MS = 1000 / 60;
const FIELD_ACTS = new Set(['move', 'wait', 'search', 'pickup']);

export function createPlayLoop(S, { app, clock, map, playback, audio, saves, watch, opts, slots, display, inputOptions }) {
  // walker: Explore or a rest, { kind, walk } (rules/auto.js); one at a time (C15), a new one takes the old one's place.
  let queued = null, input = null, heldPad = null, walker = null, vit = null, pressAt = -Infinity, pumpAt = null, tipsWaiting = [];
  // Feel spec 2.5 (cause 4): a turn's run-end work (the log, the HUD, the journal, tips) runs as a job on a later frame,
  // one a frame, so the frame that starts a step carries only the turn; a new turn finishes any job still waiting first.
  const jobs = [];
  const flushJobs = () => { while (jobs.length) jobs.shift()(); };
  function gateOpen(T) {
    const { game, floorHold } = S;
    if (!game || game.over || floorHold || playback.busy) return false;
    const hero = map.sprite(game.playerId);
    if (hero && !clock.ready(hero, T)) return false;
    for (const id of game.order) {
      const a = game.actors[id];
      if (!a || a.hp <= 0 || id === game.playerId || a.side === 'ally' || !game.vis?.[a.y * game.floor.w + a.x]) continue;
      const sp = map.sprite(id);
      if (sp && !clock.ready(sp, T)) return false;
    }
    return true;
  }
  const standing = () => { const hero = map.sprite(S.game.playerId); return !hero || clock.frac(hero) >= 1; };
  // Walks of more than a step (engine/travel.js): each step an ordinary move, the next taken when its events have
  // played. A key, a press anywhere, a window or the page hiding stops it (1.7 travel.js).
  const traveller = createTraveller({ game: () => S.game, play: c => play(c), say: w => S.ui.say(w) });
  clock.onFrame(() => {
    const { game, ui: uiApi } = S;
    if (!game) return;
    const T = clock.now;
    // Tips wait until the hero stands with nothing more to walk (a tip's card would halt a held walk).
    if (tipsWaiting.length && !game.over && standing() && !queued && !input?.heldMove() && !heldPad && walker?.kind !== 'explore' && !traveller.active) { const t = [...new Set(tipsWaiting)]; tipsWaiting = []; uiApi.offerTips?.(t); }
    if (!gateOpen(T)) return;
    const hero = clock.slideOf(map.sprite(game.playerId));
    pumpAt = Math.min(T, Math.max(pressAt, hero ? hero.ready : -Infinity, T - FRAME_MS));
    try {
      if (queued) { const c = queued; queued = null; play(c); }
      else if (uiApi.blocking) { traveller.stop(); stopWalker(); }
      else if (input?.heldMove()) onAction(input.heldMove());
      else if (heldPad) play(heldPad);
      else if (traveller.active) traveller.next();
      else if (walker) walkStep();
    } finally { pumpAt = null; pressAt = -Infinity; }
  }, true);
  clock.onFrame(() => { jobs.shift()?.(); });
  function play(command) {
    const { game, floorHold, ui: uiApi } = S;
    if (!game || game.over || floorHold) return;   // RB7: no move on the old picture while the new floor's art loads
    // T3 (1.7 touchui.js:200-202 uiOpen): a step, wait, search or pick up never goes under a window (the Forge, a shrine,
    // a confirm), even from a key or pad held as it opened or a step queued before it; a held pad lets go.
    if (uiApi.blocking && FIELD_ACTS.has(command?.type)) { heldPad = null; return; }
    // From a key or a press between frames: at once if the gate is open, else it waits as the one buffered command.
    // Item 134 (Justin 2026-10-17: "the movement is slippery, it's too easy to queue up the next movement"; the lead's
    // ruling, his item 78 rule): a press in the first half of the hero's step is dropped; from halfway it waits. During a
    // blow or a cast it waits. A held key walks on from the pump, as before.
    const W = performance.now(), hs = map.sprite(game.playerId);
    if (pumpAt === null && !gateOpen(W)) { if (hs && !playback.busy && clock.frac(hs, W) < 0.5) return; queued = command; pressAt = W; return; }
    const t0 = pumpAt ?? W;
    flushJobs();
    const p0 = game.actors[game.playerId], hp0 = p0?.hp ?? 0, mana0 = p0?.mana ?? 0;
    recentLog.begin();   // RB53: this command's lines are one batch of the recent log
    const events = step(game, command);
    // RB28 (1.7 ui-adapter.js:229, turn-presentation.js:82): the bars move as each blow lands, not after the turn. The
    // mana a cast spent (no event of its own) comes off as the hero's cast plays.
    const pid = game.playerId, own = t => events.filter(e => e.id === pid && e.type === t).reduce((n, e) => n + (e.amount ?? 0), 0);
    vit = { hp: hp0, mana: mana0, cost: (game.actors[pid]?.mana ?? 0) - mana0 - own('mana') };
    playback.run(events, { t0 }).then(() => jobs.push(() => {
      const { game, ui: uiApi } = S;
      vit = null;
      for (const line of flushLog()) uiApi.say(line.words, line.fill, line);
      uiApi.refresh(game);
      saves.sayEarned(watch.step(game, events));
      if (!game.over) tipsWaiting.push(...tipsFromEvents(game, events));   // RB3: a first level up, item, sigil, shrine, Forge, god
      if (game.over) saves.runEnded();
      // A10, C81: the music stops. Item 90 (1.7 run-events.js:106): a death plays out in full, then 1.3 s, then the score screen.
      if (game.over) { audio.stopMusic(); if (game.won) uiApi.showEnd(game); else { const ended = game; setTimeout(() => { if (S.game === ended) uiApi.showEnd(ended); }, DEATH_PAUSE_MS); } }
      recentLog.end();
    }));
  }

  // The walker. K1: R rests, as 1.7's: a half-chance search a turn until HP and mana are full. Auto-explore, as 1.7's
  // travel loop: each step an ordinary move, taken when the last one's events have played. Any key, a press anywhere
  // (but on Explore, for Explore), a window or the page hiding stops either (1.7 travel.js).
  function begin(kind) {
    const { game, ui: uiApi } = S;
    if (!game || game.over || uiApi.blocking) return;
    if (uiApi.aiming) uiApi.action('close');
    const r = startWalk(kind, game);
    if (kind === 'rest') { if (r.say) uiApi.say(r.say, color.ash); if (!r.walk) return; }
    else if (!r.walk) { if (r.say) uiApi.say(r.say); uiApi.refresh(game); return; }
    stopWalker();
    walker = { kind, walk: r.walk };
    if (kind === 'explore') uiApi.refresh(game);
    if (!playback.busy) walkStep();
  }
  const startResting = () => begin('rest');
  const toggleExplore = () => (walker?.kind === 'explore' ? stopWalker() : begin('explore'));
  function stopWalker(why) {
    if (!walker) return;
    const kind = walker.kind;
    walker = null;
    if (kind !== 'explore') return;   // a rest stops without a word
    const { game, ui: uiApi } = S;
    if (why) uiApi.say(why);
    if (game && !uiApi.blocking) uiApi.refresh(game);
  }
  function walkStep() {
    const { game, ui: uiApi } = S;
    if (!walker || !game || playback.busy) return;
    if (uiApi.blocking) return stopWalker();
    const n = walkNext(game, walker.walk);
    if (n.stop && walker.kind === 'rest') { walker = null; if (n.say) uiApi.say(n.say, n.good ? 0x7fd08a : color.ink); return; }
    if (n.stop) { stopWalker(n.say); if (n.command) play(n.command); return; }
    play(n.command);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stopWalker(); traveller.stop(); } });

  function onAction(action, repeat = false) {
    const uiApi = S.ui;
    traveller.stop();   // any key stops a walk (1.7 travel.js)
    if (walker) { const kind = walker.kind; stopWalker(); if (action === kind) return; }   // any key stops Explore or a rest; O or R again only stops it
    // K1: V and N switch the sound and the music, on the title as in play (1.7 ui.js:827-831); Options shows the change.
    if (action === 'mute' || action === 'music') {
      if (repeat) return;
      const k = action === 'mute' ? 'sound' : 'music';
      opts[k] = !(opts[k] ?? true); display.applyOptions();
      slots.writeOptions(opts);
      return;
    }
    // AA3 (1.7 game.js:531-532, pressDirectionPad): a move while aiming ends the aim instead of stepping.
    if (action.startsWith('move') && uiApi.aiming) { if (!repeat) uiApi.action('close'); return; }
    if (uiApi.action(action)) return;
    if (action === 'explore') { if (!repeat) toggleExplore(); return; }
    if (action === 'rest') { if (!repeat) startResting(); return; }
    if (repeat && action.startsWith('move')) return;   // held keys walk from the pump, not from the system repeat
    if (action.startsWith('hotbar')) return audio.cue('ui-click');
    const c = commandFor(action);
    if (c) play(c);
  }

  /** Keys, the pad and the map's presses start once the HUD exists (main.js, after createUi). */
  function start() {
    // The pad polls on the clock, before the pump (C15), so a held d-pad walks on in the same frame as a held key.
    inputOptions.onFrame = fn => clock.onFrame((dt, now) => fn(now), true);
    input = startInput(onAction, inputOptions);
    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    // The map's pointer input (ui/hud/map-input.js): hover card, long press and rest, the aim square, taps, right-clicks.
    attachMapInput(app.stage, app.canvas, { map, ui: S.ui, game: () => S.game, play, walk: (path, done) => traveller.walk(path, done) });
    // A press anywhere stops a walk and a rest (K1); Explore goes on under a press on its own button (1.7 travel.js pointerdown).
    app.stage.on('pointerdown', e => {
      traveller.stop();
      if (walker?.kind === 'explore') for (let n = e.target; n; n = n.parent) if (n.label === 'Explore') return;
      stopWalker();
    });
  }
  return {
    play, onAction, startResting, toggleExplore, start,
    holdMove: c => { heldPad = c; },
    walk: path => traveller.walk(path),
    exploreState: () => ({ active: walker?.kind === 'explore', stairs: !!S.game?.floor?.exploreComplete }),
    resting: () => walker?.kind === 'rest',   // item 309: the HUD's rest z's, however the rest began
    get vit() { return vit; },
  };
}
