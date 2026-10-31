// The sound cues the art list names (consolidation C17, moved out of platform/assets.js so audio reads its own layer):
// platform/assets.js hands over the manifest's sounds when it loads (setSounds).

const BASE = 'assets/';
let sounds = null;

/** platform/assets.js: the manifest's sounds table, once the manifest is in. */
export function setSounds(table) { sounds = table ?? null; }

/** The files for a sound cue, or null when the manifest has none. */
export function soundFiles(cue) {
  const s = sounds?.[cue];
  return s ? s.files.map(f => BASE + f) : null;
}

export function soundInfo(cue) { return sounds?.[cue] ?? null; }

// Item 256 (Justin 2026-10-20: "just had no sound effects on breaking crates"): a recording fetched only at its first
// cue could arrive past the 500 ms stale window behind the floor's art, and the cue was dropped. A group's recordings
// now come with the group (platform/assets.js); the audio takes their bytes once, at the first cue.
const held = new Map(), TAKEN = 'taken';   // url -> its bytes on the way or in, until the audio takes them
const fetchBytes = url => fetch(url).then(r => { if (!r.ok) throw new Error(`${url} HTTP ${r.status}`); return r.arrayBuffer(); });

/** platform/assets.js: a group's recording fetched ahead of its first cue. Never fails (A14: a missing one is synthesized). */
export function holdSound(url) {
  if (!held.has(url)) { const p = fetchBytes(url); held.set(url, p); p.catch(() => { if (held.get(url) === p) held.delete(url); }); }
  const p = held.get(url);
  return p === TAKEN ? Promise.resolve() : p.then(() => {}, () => {});
}

/** The audio: a recording's bytes, the held ones (handed over once: decoding consumes them) or fetched now. */
export function soundBytes(url) {
  const p = held.get(url);
  held.set(url, TAKEN);
  return p && p !== TAKEN ? p : fetchBytes(url);
}
