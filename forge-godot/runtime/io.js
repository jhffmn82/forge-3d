// The runtime's files in the browser build, where tools/web.py serves this as io.js. Files are read from the site, a
// path from the runtime folder as in QuickJS; what the game keeps ("local:" paths) lives in the page's localStorage,
// which a worker cannot reach, so web.js hands it over and posts it back.
const BASE = new URL('./', import.meta.url);
const kept = new Map();

/** What the page kept under a "local:" name, given to the worker when it starts (web.js). */
export function keep(name, text) { kept.set(name, text); }

/** A file's text, or null. Read at once, as QuickJS reads it: a worker may wait on the network. */
export function readText(p) {
  if (p.startsWith('local:')) return kept.get(p.slice(6)) ?? null;
  const x = new XMLHttpRequest();
  x.open('GET', new URL(p, BASE), false);
  x.send();
  return x.status === 200 ? x.responseText : null;
}

/** A file written whole: a "local:" one goes back to the page to keep. */
export function writeText(p, t) {
  if (!p.startsWith('local:')) return;
  kept.set(p.slice(6), t);
  self.postMessage({ keep: p.slice(6), text: t });
}
