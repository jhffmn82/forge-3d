// The page's display (consolidation C15, moved from main.js): the loading veil, the screen density, the options this
// side of the game applies (sound, motion, low power, map art, lighting, zoom, contrast) and the stage's resizes.
// S is the page's run state (main.js): game, stage, cssSize, resolution, lowPower, floorHold, ui.

import ui from '../../data/ui.json' with { type: 'json' };
import { reducedMotion } from '../ui/core/stage.js';
import { setLogTouch, setLogControls } from '../ui/screens/log-text.js';

/**
 * RB5 (1.7 bootstrap.js:22, :77-95; runtime/boot.js:376-400): the loading veil says how far the start has got:
 * "Loading game… N%" over the code, fonts, renderer and manifest, then "Lighting the torches…" and "Loading this scene
 * n / m" as the title's art arrives, and "(slow connection, still loading)" after 10 s with nothing new.
 */
export function veilStatus() {
  const p = typeof document !== 'undefined' ? document.querySelector('#loadVeil p') : null;
  let words = p?.textContent ?? '', slow = null;
  const say = w => {
    words = w;
    if (!p?.isConnected) return;
    p.textContent = w;
    clearTimeout(slow);
    slow = setTimeout(() => { if (p.isConnected && p.textContent === words) p.textContent = `${words} (slow connection, still loading)`; }, 10000);
  };
  return { say, done: () => clearTimeout(slow) };
}

// The screen density, followed live: a page that boots in a background tab, moves to another screen or is
// zoomed gets a new devicePixelRatio, and a canvas left at the old one draws everything upscaled and blurry.
// Options Low power (PLAN.md ruling 5, an Options switch only): the map draws at 1x density and 30 frames a second.
export const densityFor = lowPower => Math.min(window.devicePixelRatio || 1, lowPower ? 1 : ui.stage.maxResolution);

export function createDisplay(S, { app, map, audio, clock, opts, inputOptions, notices }) {
  // The options this side of the game applies (the Options window stores them; unset ones keep their defaults).
  function applyOptions() {
    const { game, stage, cssSize, floorHold, ui: uiApi } = S;
    audio.setLevels({ sound: opts.sound ?? true, music: opts.music ?? true, sfxVolume: opts.sfxVolume ?? 50, musicVolume: opts.musicVolume ?? 50 });
    clock.speed = opts.animSpeed ?? 1;
    clock.reduced = reducedMotion(opts.motion);
    if (S.lowPower !== (opts.lowPower === true)) {
      S.lowPower = map.lowPower = opts.lowPower === true;   // the map's motes rest in Low power (render/air-motes.js)
      app.ticker.maxFPS = S.lowPower ? 30 : 0;
      if (cssSize) {
        S.resolution = densityFor(S.lowPower);
        app.renderer.resize(cssSize[0], cssSize[1], S.resolution);
        if (map.resize(cssSize[0], cssSize[1], stage.s, stage.kind, S.resolution) && game && uiApi?.mode === 'play') map.setFloor(game);
      }
    }
    inputOptions.gamepad = opts.gamepad ?? true;
    inputOptions.keys = opts.keys ?? null;
    // RC6: Map art Blocks draws the readable glyph map (render/looks/blocks.js, 1.7 Block Art).
    // Relief reads the painted art's surfaces, so blocks are lit flat, as 1.7's Block Art was (Classic).
    const look = opts.mapArt === 'blocks' ? 'blocks' : 'painted';
    // Justin 2026-10-16: relief lighting on by default; Options Relief / Classic / Off, no automatic fallback.
    let lighting = opts.lighting === true ? 'relief' : (opts.lighting ?? 'relief');
    if (look === 'blocks' && lighting === 'relief') lighting = 'classic';
    if (map.lighting !== lighting) { map.lighting = lighting; if (game && uiApi?.mode === 'play') map.setSight(game, false); }
    if (map.look !== look) { map.look = look; if (game && uiApi?.mode === 'play' && !floorHold) map.setFloor(game); }
    if (mapOptions(stage) && cssSize) { map.resize(cssSize[0], cssSize[1], stage.s, stage.kind, S.resolution); if (game && uiApi?.mode === 'play' && !floorHold) map.setFloor(game); }
  }
  // CH-09: Map zoom and High contrast, whose defaults hang on the device (options-list.js touchDef). Map zoom is 1.7's
  // MAP_ZOOM_MUL (Far 18/12, Normal 14/12, Close 1, Closest 10/12 of the tiles across) taken against the device's
  // default, so the default keeps the map as it was. Returns whether the zoom changed.
  function mapOptions(st) {
    if (!st) return false;
    setLogTouch(st.touch);   // WC2: the stairs hints' touch words
    const MUL = { far: 18 / 12, normal: 14 / 12, close: 1, closest: 10 / 12 }, def = st.touch ? 'close' : 'normal';
    map.setContrast(opts.contrast ?? !!st.touch);
    setLogControls(opts.keys);   // CB34: the bound Pick up key in the pick-up hint
    // RB36: the multiplier and the device go to the map, which sizes its tile as 1.7 did (ui/core/stage.js mapTilePx).
    const zoom = MUL[opts.zoom] ?? MUL[def];
    if (map.zoom === zoom && map.touch === !!st.touch) return false;
    map.zoom = zoom; map.touch = !!st.touch;
    return true;
  }
  /** The stage changed size or device (ui/core/stage.js watchStage). */
  function onStage(s, w, h) {
    S.stage = s; S.cssSize = [w, h];
    S.resolution = densityFor(S.lowPower);
    app.renderer.resize(w, h, S.resolution);
    mapOptions(s);
    const retiled = map.resize(w, h, s.s, s.kind, S.resolution);
    if (S.game && S.ui.mode === 'play' && retiled) map.setFloor(S.game);
    S.ui.resize(s);
    notices.resize(w, h, s.touch);
  }
  return { applyOptions, onStage };
}
