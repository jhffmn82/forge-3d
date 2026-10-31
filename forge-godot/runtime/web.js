// The game for the browser build: bridge-core.js in a worker the page starts (web/page.js), a message in and out
// for each request, in order. A worker has a world of its own, so the windows' clock (ui.js sets setTimeout and
// requestAnimationFrame to run on Godot's ticks) and the 2D renderer's stand-ins (pixi.js) leave the page and Godot's own
// loop alone. What Godot answers on the PC, it answers here from tables tools/web.py measured in Godot: each font's
// letters' widths and each picture's size.
import './web-env.js';
import { serve, setAsk } from './bridge-core.js';
import { keep, readText } from './io.js';

const later = globalThis.setTimeout.bind(globalThis);
const settle = () => new Promise(r => later(r, 0));

let widths = null, sizes = null;
const table = name => JSON.parse(readText('../web/' + name) ?? '{}');

/** How wide some words are in a font at a size: each letter's width at the nearest size measured, scaled. */
function width(font, px, s) {
  widths ??= table('widths.json');
  const f = widths[font] ?? widths['spectral-400'];
  if (!f) return s.length * px * 0.5;
  const at = Math.max(1, Math.round(px));
  const row = f[String(at)] ?? f['100'], scale = f[String(at)] ? px / at : px / 100;
  let w = 0;
  for (const ch of s) w += row[ch] ?? row['?'] ?? at * 0.5;
  return w * scale;
}

setAsk(q => {
  if (q.ask === 'w') return width(String(q.f), Number(q.px), String(q.s));
  if (q.ask === 'img') {
    sizes ??= table('sizes.json');
    const [w, h] = sizes[q.src] ?? [1, 1];
    return { w, h };
  }
  return null;
});

// The board of shared memory the page reads at the start of every frame (web/page.js, which lays it out), when it has one.
let board = null;
const writer = new TextEncoder();

/** An answer put on the board, or false when there is no board or no room on it: it goes as a message. */
function onBoard(id, reply, ms) {
  if (!board) return false;
  const { marks, words, bytes } = board, text = writer.encode(reply), need = text.length + 16;
  let head = Atomics.load(marks, 0);
  const tail = Atomics.load(marks, 1);
  if (head >= tail) {
    if (bytes.length - head <= need) {
      if (tail <= need) return false;
      words[head >> 2] = -1;
      head = 0;
    }
  } else if (tail - head <= need) return false;
  bytes.set(text, head + 12);   // (encodeInto takes no shared memory)
  words[head >> 2] = id;
  words[(head >> 2) + 1] = ms;
  words[(head >> 2) + 2] = text.length;
  Atomics.store(marks, 0, head + 12 + ((text.length + 3) & ~3));
  return true;
}

let chain = Promise.resolve();
self.onmessage = e => {
  if (e.data.board) {
    const b = e.data.board;
    board = { marks: new Int32Array(b, 0, 2), words: new Int32Array(b, 64), bytes: new Uint8Array(b, 64) };
    return;
  }
  const { id, req, kept } = e.data;
  for (const [k, v] of Object.entries(kept ?? {})) keep(k, v);
  // Each request answered in turn. One that fails still answers (an error), so the ones after it are not left waiting:
  // a chain that stopped would freeze the game with the page still drawing. ms: the engine's own time on it.
  chain = chain.then(async () => {
    const t0 = performance.now();
    let reply;
    try { reply = JSON.stringify(await serve(req, settle)); }
    catch (e) { reply = JSON.stringify({ error: String(e?.stack ?? e) }); }
    const ms = Math.round(performance.now() - t0);
    let put = false;
    try { put = onBoard(id, reply, ms); } catch (e) { console.warn('forge link:', e.message); }
    if (put) self.postMessage({ nudge: true });
    else self.postMessage({ id, reply, ms });
  });
};
self.postMessage({ ready: true });
