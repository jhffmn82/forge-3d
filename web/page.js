// The browser build's page (export_presets.cfg head include): starts the game's engine in a worker (runtime/web.js)
// and links Godot to it (scripts/game.gd): window.forge.send(id, request) out, forge.onReply(id, reply) back. What the
// game keeps (the options, the journal) lives in this page's localStorage, which the worker cannot reach: it is handed
// over with the first request and written back as it changes.
//
// The engine's answers come back on a board of shared memory, read at the start of every frame, not as messages (below).
//
// The engine is some 340 files, fetched as the worker starts, and the connection to GitHub's servers can drop mid-load,
// taking every download in flight with it (Justin 2026-10-28: "The game engine did not start"). A worker that fails
// before it says it is ready is started again, a second, two, three later, and handed the requests it never answered.
(() => {
  const PREFIX = 'forge-3d:';
  const TRIES = 4;
  const waiting = [];   // the requests sent and not answered yet, in order
  let worker = null, ready = false, tries = 0, first = true;
  const kept = () => {
    const o = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith(PREFIX)) o[k.slice(PREFIX.length)] = localStorage.getItem(k);
      }
    } catch { /* storage blocked: the game starts fresh */ }
    return o;
  };
  let showRecord = null, wantRecord = false, recordAsked = false;
  const forge = window.forge = {
    onReply: null,
    onRecord: null,
    audioOuts: [],   // what leaves for the speakers, for a recording's sound (below)
    // A sandbox run on screen or gone (play.gd): the Record button, fetched the first time it is wanted.
    record(on) {
      wantRecord = on;
      if (showRecord) showRecord(on);
      else if (on && !recordAsked) {
        recordAsked = true;
        import('../forge-godot/runtime/record-web.js').then(m => { showRecord = m.mountRecord(forge); showRecord(wantRecord); }, e => console.warn('forge record:', e.message));
      }
    },
    send(id, text) {
      const msg = { id, req: JSON.parse(text), at: performance.now() };
      if (first) { first = false; msg.kept = kept(); }
      waiting.push(msg);
      worker?.postMessage(msg);
    },
  };
  // The nodes the game's sound leaves by, kept as Godot connects them: nothing else can hear what the speakers do.
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (to, ...more) {
    if (to === this.context.destination && !forge.audioOuts.includes(this)) forge.audioOuts.push(this);
    return connect.call(this, to, ...more);
  };
  // The engine's answers: a message has to wait its turn on this thread, and while a key repeated, on a machine whose
  // frames fill the time, one came up to 698 ms late against 30 ms with no key down, though frames ran steadily all along
  // (Justin's laptop, 2026-10-31: "i'm wondering if it's some sort of input lag where holding causes it to skip input by
  // overloading something"; "it takes longer for holding input to stall movement, but it still happens"). So the worker
  // writes each answer on a board of shared memory and every frame starts by reading it: a frame does not wait, so an
  // answer does not. The worker's message after each is only a nudge, for when no frame is running. Board: two marks, the
  // next byte to write and the next to read; then from byte 64 the answers, each its id, the engine's ms, its length and
  // its text, -1 for an id meaning the rest of the board was skipped (runtime/web.js writes them).
  // Sharing memory needs the page isolated from other sites', which takes headers GitHub Pages does not send: web/coi-sw.js
  // adds them, after one reload on a first visit. Without that, or with ?link=message for a comparison, answers come as
  // messages and frames queue behind them (below).
  const asked = new URLSearchParams(location.search).get('link');
  if (!self.crossOriginIsolated && asked !== 'message' && navigator.serviceWorker) {
    navigator.serviceWorker.register('coi-sw.js').then(() => navigator.serviceWorker.ready).then(() => {
      // (Once: if that did not isolate it, the game goes on by messages.)
      let last = 0;
      try { last = Number(sessionStorage.getItem(PREFIX + 'isolating')) || 0; sessionStorage.setItem(PREFIX + 'isolating', String(Date.now())); } catch { return; }
      if (Date.now() - last > 15000) location.reload();
    }, e => console.warn('forge link:', e.message));
  }
  const shared = self.crossOriginIsolated && asked !== 'message' ? new SharedArrayBuffer(64 + 16 * 1024 * 1024) : null;
  forge.link = shared ? 'board' : 'message';
  const marks = shared && new Int32Array(shared, 0, 2), words = shared && new Int32Array(shared, 64), bytes = shared && new Uint8Array(shared, 64);
  const reader = new TextDecoder();
  const answered = (id, reply, ms) => {
    const i = waiting.findIndex(m => m.id === id);
    if (i >= 0) {
      // A slow answer says so in the console, with what was asked: what a player sees as a freeze.
      const m = waiting.splice(i, 1)[0], took = performance.now() - m.at;
      if (took > 500) console.warn(`forge engine: ${m.req.op}${m.req.kind ? ' ' + m.req.kind : ''} took ${Math.round(took)} ms (${ms} ms of it the engine's own)`);
    }
    if (forge.onReply) forge.onReply(id, reply);
  };
  const readBoard = () => {
    for (;;) {
      const at = Atomics.load(marks, 1);
      if (at === Atomics.load(marks, 0)) return;
      const id = words[at >> 2], ms = words[(at >> 2) + 1], n = words[(at >> 2) + 2];
      if (id === -1) { Atomics.store(marks, 1, 0); continue; }
      const reply = reader.decode(bytes.slice(at + 12, at + 12 + n));   // (a copy: decode takes no shared memory)
      Atomics.store(marks, 1, at + 12 + ((n + 3) & ~3));
      answered(id, reply, ms);
    }
  };
  // Without the board: while the engine owes an answer, a frame waits its turn behind what is already queued. Run straight
  // from requestAnimationFrame, frames take the main thread ahead of the worker's messages while a key repeats. Posted, a
  // frame queues with them, first come first served. All a frame's callbacks go together, in order: the recorder's copy
  // reads the canvas Godot has just drawn.
  const raf = window.requestAnimationFrame.bind(window), turn = new MessageChannel();
  let due = [];
  turn.port1.onmessage = () => { const now = due; due = []; for (const [f, t] of now) f(t); };
  window.requestAnimationFrame = cb => raf(t => {
    if (shared) { readBoard(); cb(t); return; }
    if (!waiting.length && !due.length) { cb(t); return; }
    if (!due.length) turn.port2.postMessage(0);
    due.push([cb, t]);
  });
  const start = () => {
    tries++;
    ready = false;
    worker = new Worker('forge-godot/runtime/web.js', { type: 'module' });
    if (shared) worker.postMessage({ board: shared });
    worker.onmessage = e => {
      const d = e.data;
      if (d.ready) ready = true;
      else if (d.nudge) readBoard();
      else if (d.keep !== undefined) { try { localStorage.setItem(PREFIX + d.keep, d.text); } catch { /* not kept */ } }
      else if (d.id !== undefined) answered(d.id, d.reply, d.ms);
    };
    worker.onerror = e => {
      if (!ready && tries < TRIES) {
        console.warn('forge engine: did not load, trying again', e.message ?? '');
        worker.terminate();
        worker = null;
        setTimeout(() => { start(); for (const m of waiting) worker.postMessage(m); }, 1000 * tries);
        return;
      }
      console.error('forge engine:', e.message, e.filename, e.lineno);
      const p = document.createElement('div');
      p.textContent = 'The game engine did not start: ' + (e.message || 'see the console');
      p.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:99;color:#e8b44a;font:14px monospace;';
      document.body.appendChild(p);
    };
  };
  start();
})();

// The 2D game's loading screen while Godot's own files come (forge-rewrite index.html #loadVeil, RB5): the title and
// "Loading game… N%", the code counted as 0-85%, read off Godot's own progress bar; "(slow connection, still loading)"
// after 10 s with nothing new. It goes as Godot's starts (its status overlay gone), where scripts/boot.gd says the rest
// in the same words and look. (Godot's bare bar showed instead; 2026-10-30.)
document.addEventListener('DOMContentLoaded', () => {
  const veil = document.createElement('div'), touch = matchMedia('(pointer: coarse)').matches;
  veil.style.cssText = `position:fixed;inset:0;z-index:99;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:#080b11;color:#bdc2d8;font:${touch ? 16 : 14}px monospace;text-align:center;padding:0 16px;`;
  const h = document.createElement('h1'), p = document.createElement('p');
  h.textContent = 'Forge of the Elements';
  h.style.cssText = `font:700 ${touch ? 34 : 32}px/1.1 serif;color:#e8b44a;margin:0;`;
  p.style.margin = '0';
  p.textContent = 'Loading game… 0%';
  veil.append(h, p);
  document.body.appendChild(veil);
  let said = p.textContent, at = performance.now();
  const tick = setInterval(() => {
    const status = document.getElementById('status'), bar = document.getElementById('status-progress');
    if (!status || status.style.display === 'none' || status.style.visibility === 'hidden' || getComputedStyle(status).display === 'none') {
      clearInterval(tick); veil.remove(); return;
    }
    const words = bar && bar.max > 0 ? `Loading game… ${Math.min(85, Math.round(85 * bar.value / bar.max))}%` : said.replace(/ \(slow.*$/, '');
    if (words !== said.replace(/ \(slow.*$/, '')) { said = words; at = performance.now(); p.textContent = words; }
    else if (performance.now() - at > 10000 && !said.includes('slow')) { said = `${words} (slow connection, still loading)`; p.textContent = said; }
  }, 100);
});

// The props' 3D models come a small pack each as a floor wants them (scripts/models.gd); the one pack they came in, and
// the browser cache it was kept in, are gone (2026-10-28).
(async () => { try { await caches.delete('forge-3d-models'); } catch { /* no cache storage here */ } })();

// The title's and creation's pictures (forge-godot/web/preload.json) asked for as the page opens, alongside the engine,
// so they are in the browser's cache when the boot screen wants them (scripts/boot.gd, ui2d.gd preload_art).
fetch('forge-godot/web/preload.json').then(r => r.json()).then(list => {
  for (const src of list) fetch('forge-rewrite/' + src, { priority: 'low' }).catch(() => {});
}).catch(() => {});
