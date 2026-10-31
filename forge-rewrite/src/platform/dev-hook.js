// The page's dev hook (consolidation C15, moved from main.js): window.forge, the handle the capture, probe and timing
// tools read (tools/lighting, tools/mapgen/board, tools/assets; most load the page without ?dev, so it is always set),
// and ?dev=quick, which skips the title. S is the page's run state (main.js).

import { createGame, DEFAULT_CHOICE } from '../engine/game.js';
import { loadFrom } from '../save/save.js';

export async function devHook(S, { app, map, audio, playback, notices, storage, saves, floors }) {
  window.forge = { get game() { return S.game; }, get stage() { return S.stage; }, audio, app, map, playback, get ui() { return S.ui; }, notices, get floorHeld() { return !!S.floorHold; } };
  // Dev only: ?dev=quick skips the title into the saved run, or a new default one (&room=test: in the fixed test room).
  const params = new URLSearchParams(location.search);
  if (params.get('dev') !== 'quick') return;
  const { save, runStarted } = saves, { enterPlay } = floors;
  const room = params.get('room'), seed = Date.now() % 1000000;
  S.game = loadFrom(storage, 'auto');
  if (!S.game) { S.game = createGame({ seed, hero: DEFAULT_CHOICE, testRoom: room === 'test' }); save('auto'); }   // a new run starts saved (T37a)
  runStarted();   // as New game and Continue do: the journal counts the run from its first floor (proof windows #12)
  await enterPlay();
}
