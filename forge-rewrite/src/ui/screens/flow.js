// The UI's one entry point: which screen is up (title, creation, play, end), which window is open over it,
// the hover cards, keyboard and gamepad focus. main.js hands it the hooks in `deps` (side note UI-HOOKS.md)
// and tells it about resizes, new state and log lines. Every screen is rebuilt from scratch when it changes.

import { Container, Ticker } from '../../../../forge-godot/runtime/pixi.js';
import { createKit, color, space } from '../core/widgets.js';
import uiData from '../../../data/ui.json' with { type: 'json' };
import { createCards, cardFrame } from '../core/cards.js';
import { createFocus } from '../core/focus.js';
import { buildShell } from '../core/shell.js';
import { scrollable, SCROLLBAR } from '../core/scroll.js';
import { findLabel, boundsIn } from '../core/layout.js';
import { createHoldGate } from '../core/hold-gate.js';
import { pulseAt, castCard, castWords } from '../core/pulse.js';
import { loadPlates } from '../core/plates.js';
import { loadGroup, retainArt } from '../core/art.js';
import { buildHud } from './hud.js';
import { buildAutomap } from '../hud/automap.js';
import { buildCoach } from '../hud/coach.js';
import { CARDS, TOUR, CREATOR, cardPages, tipLive } from '../hud/tips.js';
import { buildTitle } from './title.js';
import { buildCreation, newChoice } from './creation.js';
import { CREATION_ART } from './creation-art.js';
import { startAffinity, steps } from '../model/creation-model.js';
import { buildEnd } from './end.js';
import { buildMenu } from './menu.js';
import { WINDOWS, TABS, windowSize } from './windows.js';
import { endsRun } from './popups.js';
import { pickerChoice } from './places.js';
import { forgeReceipt, forgeSay, forgeSaying, pick as forgePick } from './forge.js';

const KEY_TAB = { character: 'Character', inventory: 'Inventory', faith: 'Faith' };

/**
 * @param {Container} uiLayer the stage-scaled layer main.js gives the UI
 * @param {number} resolution
 * @param {any} deps hooks into the game (UI-HOOKS.md section 1)
 */
export function createUi(uiLayer, resolution, deps) {
  // Layers by name, never place (ui-40); the flash layer keeps a sigil's cast pulse and card over the windows (136).
  const [screenLayer, windowLayer, cardLayer, flashLayer] = ['ui-screens', 'ui-windows', 'ui-cards', 'ui-flash'].map(label => Object.assign(new Container(), { label }));
  uiLayer.addChild(screenLayer, windowLayer, cardLayer, flashLayer);
  let stage = null, kit = null, cards = null, focus = null, ready = false;
  // In play every rebuild (a window, the map, a resize, a refresh) waits out main's floor hold (hold-gate.js; proof 13).
  const gate = createHoldGate(() => !!deps.floorHeld?.()), build = () => (mode === 'play' ? gate(buildNow) : buildNow());
  let samples = null, mode = 'title', win = null, winArg = null, hud = null, lines = [], history = [], game = null;
  const create = { choice: newChoice(), step: 0, sandbox: false };
  let creationHold = null, releaseCreation = null;
  function leaveCreation() {
    creationHold = null;
    releaseCreation?.(); releaseCreation = null;
  }
  let mapOn = false, automap = null;   // the map overlay (1.7 automap.js): the Map button or M
  // The tutorial (hud/tips.js says which card and when, hud/coach.js draws it): the card up, { id, page, then?, back?,
  // tour? }, with the game waiting under it, and the cards waiting for their moment. Each shows once ever on this device
  // while tutorials are on (save/slots.js); without that store (a test page) there are none.
  let card = null, cardQueue = [];
  const tut = deps.tutorial;
  const cardsOn = () => !!tut?.seen && tut.on?.() !== false;
  const tipsOn = () => !!game && tipLive(game) && cardsOn();
  /** Where a card may show now (tips.js CARDS at): no window, over the Forge, over a claimed core's Fuse, over anything. */
  const fits = id => { const at = CARDS[id]?.at ?? 'map'; return at === 'any' || (at === 'map' ? !win : at === 'Forge' ? win === 'Forge' && !winArg?.infusion : at === 'core' && win === 'Forge' && !!winArg?.infusion); };
  const cardUp = () => !!card && (mode === 'play' ? !!card.tour || fits(card.id) : mode === 'title' && !!card.tour);
  const cardCtx = () => ({ touch: !!stage?.touch, keys: deps.options?.get?.('keys') ?? null, state: game });
  function drainCards() {
    if (card || mode !== 'play' || !game) return;
    if (!tipsOn()) { cardQueue = []; return; }
    cardQueue = cardQueue.filter(id => !tut.seen(id));
    const id = cardQueue.find(fits);
    if (!id) return;
    cardQueue = cardQueue.filter(t => t !== id);
    tut.mark(id);
    showCard({ id, page: 0 });
  }
  /** A card's page up; a Forge page turns the Forge to its tab. */
  function showCard(c) { card = c; const tab = cardPages(c.id, cardCtx())[c.page]?.tab; if (tab) forgePick.tab = tab; build(); }
  function cardEnd() {
    const c = card;
    card = null;
    if (c?.then?.length) return showCard({ id: c.then[0], page: 0, then: c.then.slice(1), back: c.back, tour: c.tour });
    if (c?.back) win = c.back;
    build(); drainCards();
  }
  function cardNext() { deps.cue('ui-click'); if (card.page >= cardPages(card.id, cardCtx()).length - 1) cardEnd(); else showCard({ ...card, page: card.page + 1 }); }
  /** Don't show again: tutorials off (the waiting cards go) or back on (every card again); the creator's plate follows. */
  function cardToggle() {
    const off = tut?.on?.() !== false;
    tut?.set?.(!off);
    if (off) cardQueue = [];
    if (mode === 'create') create.choice = { ...create.choice, tutorial: !off };
    build();
  }
  /** The creator's card for its step (race, class): not in a sandbox, not with the Tutorial plate off, once ever. */
  const creatorCard = () => { const id = CREATOR[steps(create.choice)[create.step]]; return id && !create.sandbox && create.choice.tutorial && cardsOn() && !tut.seen(id) ? id : null; };
  function cardNode(id, page, next) {
    return buildCoach(kit, { page, pages: cardPages(id, cardCtx()), rect: t => tileRect(...t.tile, t.up), dontShow: tut?.on?.() === false, next, toggle: cardToggle });
  }
  /** A map tile on screen, and as much above it as the thing on it stands (`up` tiles: a Forge, a shrine; stairs none),
   * from the hero's place (main.js heroOnScreen). */
  function tileRect(x, y, up = 0) {
    const h = deps.heroOnScreen?.(), p = game?.actors?.[game.playerId];
    if (!h || !p) return null;
    const T = h.tile, side = 0.5 + up / 3, a = uiLayer.toLocal({ x: h.x + (x - p.x - side) * T, y: h.y + (y - p.y - 1 - up) * T }), b = uiLayer.toLocal({ x: h.x + (x - p.x + side) * T, y: h.y + (y - p.y) * T });
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  }
  const ui = {};

  /** The element the hero leans to, for the highlight colour: the choice in creation, the hero in play. */
  function affinityNow() {
    if (mode === 'create') return startAffinity(create.choice)[0] ?? null;
    const aff = game?.hero?.affinity ?? {};
    return Object.keys(aff).filter(k => aff[k] > 0).sort((a, b) => aff[b] - aff[a])[0] ?? null;
  }

  const clear = layer => layer.removeChildren().forEach(c => c.destroy({ children: true }));

  function buildNow() {
    if (!stage || !ready) return;
    focus?.destroy();
    clear(screenLayer); clear(windowLayer); clear(cardLayer);
    uiLayer.scale.set(stage.s);
    uiLayer.position.set(stage.ox, stage.oy);
    // Text is drawn at the screen's pixel density now, not the one at boot: a tab opened in the background, a moved
    // window or a browser zoom changes it, and stale text is blurry (Justin 10-16).
    const density = Math.min(window.devicePixelRatio || resolution, uiData.stage.maxResolution);
    kit = createKit(stage, density, affinityNow(), { tap: () => deps.cue('ui-click'), textSize: deps.options?.get?.('textSize'), motion: deps.options?.get?.('motion') });
    cards = createCards(kit, stage);
    cardLayer.addChild(cards.root);
    kit.hooks.show = (node, d) => cards.show(node, d);
    kit.hooks.hide = node => cards.hide(node);
    focus = createFocus(kit, cardLayer);
    hud = null; automap = null;
    if (mode === 'title') screenLayer.addChild(buildTitle(kit, titleActs));
    else if (mode === 'create') {
      screenLayer.addChild(buildCreation(kit, create, createActs));
      if (create.sandbox) { const t = kit.text('Sandbox run', { size: 20, font: 'display', fill: kit.accent }); t.position.set(stage.w - t.width - space.betweenSections, space.betweenRows); screenLayer.addChild(t); }
    }
    else if (mode === 'end') screenLayer.addChild(buildEnd(kit, game, endActs));
    else if (mode === 'play') {
      hud = buildHud(kit, stage, { lift: (on, k = 0.12) => { windowLayer.alpha = on ? k : 1; }, openMenu: () => openWindow('Menu'), openMap: () => toggleMap(), mapOn, explore: () => deps.explore?.toggle?.(), covered: !!win, hotbar: () => deps.cue('ui-click'), open: openWindow, deps, say: (w, f) => ui.say(w, f) });
      hud.restore(lines);
      if (game) hud.set(game);
      // The map overlay lies over the map and under the HUD; its symbols and hint keep clear of the HUD's pieces.
      if (mapOn) {
        automap = buildAutomap(kit, stage, { blocked: hudAreas, walk: path => deps.walk?.(path), close: () => toggleMap(false), say: w => ui.say(w, color.ash), reduced: () => kit.reduced });
        if (game) automap.set(game);
        screenLayer.addChild(automap.root);
      }
      screenLayer.addChild(hud.root);
    }
    if (win) buildWindow();
    // The tutorial card over the screen or its window; one whose moment has passed (its window closed) is done.
    if (card && !cardUp()) card = null;
    if (card) windowLayer.addChild(cardNode(card.id, card.page, cardNext));
    else if (mode === 'create' && !win && creatorCard()) { const id = creatorCard(); windowLayer.addChild(cardNode(id, 0, () => { deps.cue('ui-click'); tut.mark(id); build(); })); }
    // A rebuild (the window refreshing after the command) keeps a notice that has not run its time.
    noticeNode = null;
    if (win && win !== 'Menu' && lastNotice && Date.now() < lastNotice.until) notice(lastNotice.words, lastNotice.fill, lastNotice.until);
  }

  // A small animation clock for figures inside windows (the paper doll): its frame list is emptied on every rebuild,
  // so a destroyed figure is never called again.
  const winFrames = [];
  const uiClock = { speed: 1, reduced: false, onFrame: fn => winFrames.push(fn), tween: () => Promise.resolve(), wait: () => Promise.resolve(), busy: false };
  Ticker.shared.add(t => { for (const fn of winFrames) fn(Math.min(t.deltaMS, 64)); });

  function buildWindow() {
    winFrames.length = 0;
    if (win === 'Menu') { windowLayer.addChild(buildMenu(kit, { open: openWindow, close: closeWindow, options: deps.options, redraw: () => build() }, game)); return; }
    const spec = WINDOWS[win];
    const tabs = TABS.includes(win) ? TABS : null;
    const size = windowSize(win, stage);
    // On phones the windows you drag to the hotbar from stop above it; the rest cover it (Justin 10-16).
    let bottom, right;
    if (spec.hotbar && hud && (stage.kind === 'P' || stage.short)) {
      // The bar's box: a row stops the window above it; a column (a sideways phone's vertical hotbar) beside it, so the
      // window keeps its height (proof pass item 3: the three sheets collapsed to a strip above the column's top slot).
      let top = stage.h, left = stage.w, x1 = 0, y1 = 0;
      const find = c => { if (/^hud-slot/.test(c.label ?? '')) { const p = uiLayer.toLocal(c.getGlobalPosition()); top = Math.min(top, p.y); left = Math.min(left, p.x); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); } c.children?.forEach(find); };
      find(hud.root);
      if (y1 - top > x1 - left && left < stage.w) right = stage.w - left + 6;
      else if (top < stage.h) bottom = stage.h - top + 6;
    }
    const shellOf = h => buildShell(kit, { tabs, tab: win, title: tabs ? null : spec.titleOf?.(winArg) ?? spec.title, onTab: openWindow, onClose: spec.onClose ? () => spec.onClose(closeWindow, winArg) : closeWindow, w: size?.w, h, six: spec.six, fit: spec.fit, bottom, right });
    let shell = shellOf(size?.h);
    // A phone window that runs long gets its one scroll, laid out narrower so 1.7's 8 px bar sits inside the frame
    // (CSS-28). Laptop windows fit by design; one that larger text runs past its frame is laid out again to scroll (item 164).
    const bar = SCROLLBAR.w + SCROLLBAR.gap, lay = on => spec.build(kit, { ...shell.area, w: shell.area.w - (on ? bar : 0) }, { game, clock: uiClock, deps: samples ? { ...deps, ...samples } : deps, ui, arg: winArg, open: openWindow, close: closeWindow, reopen: () => build() });
    let scrolls = stage.kind === 'P' || stage.short || stage.touch, body = lay(scrolls);
    // A sized window hugs its contents (Justin 10-16: no dead space) and grows for bigger text: a popup never scrolls.
    const spare = shell.area.h - body.height - space.betweenSections;
    if (size && Math.abs(spare) > 8) { shell.root.destroy({ children: true }); shell = shellOf(size.h - spare); }
    if (!scrolls && body.height > shell.area.h + 1) { body.destroy({ children: true }); winFrames.length = 0; body = lay(scrolls = true); }
    if (shell.info) kit.hooks.show = (node, d) => shell.info.show(node, d);
    shell.content.addChild(scrolls ? scrollable(body, { ...shell.area, w: shell.area.w - bar }) : body);
    windowLayer.addChild(shell.root);
  }

  // A window hides the log, so while one is open each new log line also shows inside it, at the foot of its frame,
  // and fades after a few seconds (Justin 10-16: "some indication in inventory when [sigils] are cast because
  // inventory covers the log").
  let noticeNode = null, noticeTimer = 0, lastNotice = null;
  function notice(words, fill, until = Date.now() + uiData.timing.noticeMs) {
    lastNotice = { words, fill, until };
    const frame = findLabel(windowLayer, 'window-frame');
    if (!frame || !kit) return;
    noticeNode?.destroy({ children: true });
    const r = boundsIn(frame, uiLayer);
    const t = kit.text(words, { size: 16, fill: fill ?? color.ink, wrap: r.w - 80, align: 'center' });
    const box = new Container();
    box.addChild(Object.assign(cardFrame(t.width + 24, t.height + 12, { radius: 6, alpha: 0.95 }), { x: -12, y: -6 }), t);   // the card frame (ui-30)
    box.position.set(Math.round(r.x + (r.w - t.width) / 2), Math.round(r.y + r.h - t.height - 26));
    box.label = 'window-notice';
    cardLayer.addChild(box);
    noticeNode = box;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { if (noticeNode === box) { box.destroy({ children: true }); noticeNode = null; } }, Math.max(0, until - Date.now()));
  }

  function openWindow(name, arg = null) {
    if (creationHold) leaveCreation();
    deps.cue('ui-open');
    if (!(ui.handBack || win === name || win === 'Confirm' || win === 'Choose')) WINDOWS[name]?.fresh?.();   // ui-23 (popups.js handBack)
    win = name; winArg = arg;
    build();
  }
  function closeWindow() {
    if (!win) return false;
    if (creationHold && winArg === creationHold) leaveCreation();
    deps.cue('ui-close');
    win = null;
    build();
    drainCards();   // a card that waited for the window
    return true;
  }
  /** The map overlay on or off (1.7 toggleAutomap): its own open and close sounds; the HUD's Map button lights. */
  function toggleMap(force) {
    const was = mapOn;
    mapOn = force === undefined ? !mapOn : !!force;
    if (mapOn === was) return false;
    deps.cue(mapOn ? 'ui-open' : 'ui-close');
    build();
    return true;
  }
  /** The HUD's pieces on screen (4 px round each), which the map's symbols and hint keep clear of (1.7 automapBlockedAreas). */
  function hudAreas() {
    const out = [];
    for (const c of hud?.root.children ?? []) {
      if (!c.visible || c.label === 'map-tip' || c.alpha === 0) continue;
      const b = c.getBounds();
      if (!b.width || !b.height) continue;
      const r = boundsIn(b, uiLayer);
      out.push({ left: Math.max(0, r.x - 4), top: Math.max(0, r.y - 4), right: Math.min(stage.w, r.x + r.w + 4), bottom: Math.min(stage.h, r.y + r.h + 4) });
    }
    return out;
  }

  // A fresh creation, its Tutorial plate as the player last left it (1.7 cTutorial; proof pass 21); a sandbox run saves apart.
  const fresh = (sandbox, retry = false) => {
    leaveCreation();
    releaseCreation = retainArt(CREATION_ART);
    const hold = creationHold = { question: 'Preparing character creation…', yes: null };
    win = 'Confirm'; winArg = hold; build();
    loadGroup('creation', { retry }).then(() => {
      if (creationHold !== hold) return;
      creationHold = null;   // retain the art until play replaces creation, including the dungeon's load hold
      create.choice = { ...newChoice(), tutorial: deps.tutorial?.on?.() ?? true };
      create.step = 0; create.sandbox = sandbox; mode = 'create'; win = null; build();
    }, () => {
      if (creationHold !== hold) return;
      releaseCreation?.(); releaseCreation = null;
      Object.assign(hold, { question: 'Some artwork could not load.', yes: 'Retry', onYes: () => fresh(sandbox, true) });
      build();
    });
  };
  const titleActs = {
    redraw: () => build(),
    hasContinue: () => deps.hasContinue(),
    continueRun: () => { leaveCreation(); deps.continueRun(); },
    newGame: () => { const cont = deps.hasContinue?.(); if (cont) openWindow('Confirm', endsRun(cont, 'New Game', () => fresh(false))); else fresh(false); },   // sandbox 81
    sandbox: (typeof __FORGE_PUBLIC__ === 'undefined' || !__FORGE_PUBLIC__) ? () => fresh(true) : null,
    open: openWindow, version: deps.version,   // C17: the update check (platform/version.js through ui-calls.js)
  };
  const createActs = {
    back: () => { leaveCreation(); mode = 'title'; build(); },
    redraw: () => build(),
    cue: n => deps.cue(n),
    start: choice => deps.newRun(choice, { sandbox: create.sandbox }),
  };
  const endActs = {
    // Item 227: the fallen character again from floor 1 (a sandbox run as a sandbox), through creation's own start.
    playAgain: () => { const h = game?.hero; if (!h) return; create.sandbox = !!game.sandbox; createActs.start({ name: h.name, sex: h.sex, race: h.race, court: h.court, cls: h.cls, god: h.god, named: true, tutorial: deps.tutorial?.on?.() ?? true }); },
    title: () => { leaveCreation(); mode = 'title'; win = null; deps.titleMusic?.(); build(); },   // A10: the title song, as 1.7
    open: openWindow,
    saveWin: deps.saveWin ? () => deps.saveWin() : null,   // RB12: a won run's Save this character
    redraw: () => build(),
  };

  Object.assign(ui, {
    layer: uiLayer,
    /** The game's picker event ({type:'picker', sigil, bag}) opens the chooser with the items that sigil can take. */
    picker(ev) { openWindow('Choose', pickerChoice(game, ev)); },
    /** A map tap while aiming, passed to the HUD. */
    mapTap(t) { return hud?.mapTap?.(t); },
    /** The mouse over the map while aiming (null off the map): the HUD moves the target square. */
    aimHover(t) { return hud?.aimHover?.(t); },
    /** FX34: the hero took damage as the turn plays: the portrait flinches then (1.7 portrait-animation.js damageApplied). */
    flinch() { hud?.flinch?.(); },
    /** RB28: the HP and Mana bars drop or fill as each of the hero's blows, heals and casts plays. */
    vitals(hp, mana) { if (hud && !win) hud.vitals?.(hp, mana); },
    /**
     * Feature 136: a sigil cast from a slot: the slot pulses in the sigil's colour and "You cast Blink" pops up there.
     * `bounds` is the slot's global rectangle (getBounds()); `name` the sigil's name.
     */
    castFlash(bounds, colour, name) {
      if (!kit || !bounds) return;
      const rect = boundsIn(bounds, uiLayer);
      flashLayer.removeChildren().forEach(c => c.destroy({ children: true }));
      pulseAt(flashLayer, rect, colour);
      castCard(kit, flashLayer, rect, castWords(name), stage.w, stage.h);
    },
    /** FX28: a window covers the map (the map's power-up waits for it to close). */
    covered() { return !!win; },
    /** Map pointer events for 1.7's hover cursor, map card and touch long press (hud.js mapPointer). */
    mapPointer(kind, e, pick, g, canvas) { return mode === 'play' ? hud?.mapPointer?.(kind, e, pick, g, canvas) : undefined; },
    mapHeld() { return !!hud?.mapHeld?.(); },
    /** Dev and review captures only: stand-in contents for windows whose data packets are not written yet. */
    ...((typeof __FORGE_PUBLIC__ === 'undefined' || !__FORGE_PUBLIC__) ? { devSamples(s) { samples = s && { magic: () => s.magic, journal: () => s.journal, shop: () => s.shop, text: k => s.text?.[k] ?? null }; build(); } } : {}),
    /** Opens a window from the game: ui.open('Confirm', {...}), ui.open('Forge'), ui.open('Shrine', { god }). */
    open: (name, arg) => openWindow(name, arg),
    /** Called once plates are loaded and the first stage is known. */
    async start() { await loadPlates(); ready = true; build(); },
    resize(s) { stage = s; build(); },
    showTitle() { leaveCreation(); mode = 'title'; win = null; build(); },
    ...((typeof __FORGE_PUBLIC__ === 'undefined' || !__FORGE_PUBLIC__) ? { sandboxCreate: () => fresh(true) } : {}),   // item 166 (1.7 bCreate, New character)
    /** The run is on: show the HUD over the map. */
    // EP42 (1.7 saveApply, save.js:54-55): a loaded run brings back its last log lines (o.log) and opens on its loaded
    // line (o.loaded), which also stands in for the first-entry line; a new run starts its log empty.
    play(g, o = {}) {
      leaveCreation();
      for (const w of Object.values(WINDOWS)) w.newRun?.();   // ui-23: a run's window picks start fresh
      game = g; mode = 'play'; win = null; history.splice(0, history.length, ...(o.log ?? []).slice(-400)); lines = history.slice(-40); mapOn = false; card = null; cardQueue = [];
      if (o.loaded) lines.push(o.loaded);
      build();
      if (o.loaded) ui.say(o.loaded.words, o.loaded.fill);
    },
    /** EP42: the run's last 40 log lines, for its save (none while no run is on screen). */
    logTail() { return mode === 'play' || mode === 'end' ? history.slice(-40) : []; },
    /** The cards a turn or a new run calls for (hud/tips.js); each shows once ever, when its window and the hero allow. */
    offerTips(ids) {
      if (!tipsOn()) return;
      for (const id of ids ?? []) if (!tut.seen(id) && !cardQueue.includes(id) && card?.id !== id) cardQueue.push(id);
      drainCards();
    },
    /** W16: Options' How to play replays the run's first cards over the run or the title; the window it was opened from
     * steps aside and comes back when they end. */
    tour() {
      if (!stage || (mode !== 'play' && mode !== 'title')) return;
      const back = win;
      win = null;
      showCard({ id: TOUR[0], page: 0, then: TOUR.slice(1), back, tour: true });
    },
    refresh(g) { game = g; if (hud && !win && !deps.floorHeld?.()) { hud.set(g); automap?.set(g); } else build(); },
    showEnd(g) { leaveCreation(); game = g; mode = 'end'; win = null; build(); },
    say(words, fill, o) { lines.push({ words, fill }); if (lines.length > 40) lines.shift(); history.push({ words, fill, ...(o?.marks?.length ? { marks: o.marks } : {}) }); if (history.length > 400) history.shift(); hud?.say(words, fill, o); if (!o?.quiet && win && win !== 'Menu' && !(win === 'Forge' && forgeSaying())) notice(words, fill); },
    /** G29: a Forge event as it plays: its receipt goes across the top of the Forge's window (forge.js forgeSay), not the foot. */
    forgeEvent(ev) {
      const words = forgeReceipt(ev, game);
      if (!words) return;
      forgeSay(words);
      if (win !== 'Forge') return;
      lastNotice = null; noticeNode?.destroy({ children: true }); noticeNode = null;
      build();
    },
    /** Every log line this run, for the combat log window. */
    get history() { return history; },
    /** A named input action. Returns true when the UI used it. */
    action(a) {
      // A card takes the keys while it is up: Enter or Wait turns the page, Esc closes it.
      if (cardUp()) { if (a === 'close') cardEnd(); else if (a === 'confirm' || a === 'wait') cardNext(); return true; }
      if (mode === 'create' && !win && creatorCard()) { if (a === 'close' || a === 'confirm' || a === 'wait') { tut.mark(creatorCard()); build(); } return true; }
      // Esc closes the map first; M (or the pad's Select) toggles it while no window is up (1.7 automap.js keys).
      if (a === 'close' && mode === 'play' && !win && mapOn) return toggleMap(false);
      if (a === 'map' && mode === 'play' && !win) return toggleMap(), true;
      if (a === 'close') return closeWindow() || (mode === 'play' && !!hud?.cancelAim?.()) || (mode === 'create' ? (createActs.back(), true) : false);
      if (KEY_TAB[a] && mode === 'play') { if (win === KEY_TAB[a]) closeWindow(); else openWindow(KEY_TAB[a]); return true; }
      if (mode === 'play' && !win && hud?.action?.(a)) return true;
      if (!ui.blocking) return false;
      if (a === 'wait' || a === 'confirm') return focus.action('confirm');
      // CF41 (1.7 create.js:669-672): on the god step, Left and Right turn the carousel; Up and Down still move focus.
      if (mode === 'create' && !win && (a === 'move-w' || a === 'move-e')) {
        const turn = kit?.hooks.controls.findLast(c => c.node.label === (a === 'move-w' ? 'god-prev' : 'god-next') && !c.node.destroyed && c.node.parent);
        if (turn) { turn.act(); return true; }
      }
      if (a.startsWith('move-')) { focus.action(a); return true; }
      return true;
    },
  });
  Object.defineProperties(ui, {
    /** True while a screen or window covers the map, so map taps and moves must not reach the game. */
    blocking: { get: () => mode !== 'play' || !!win || cardUp() },
    mode: { get: () => mode },
    window: { get: () => win },
    /** The HUD is aiming a targeted ability: map taps go to ui.mapTap instead of moving. */
    aiming: { get: () => mode === 'play' && !win && !!hud?.aiming },
    /** The map overlay is up. */
    mapOn: { get: () => mode === 'play' && mapOn },
  });
  return ui;
}
