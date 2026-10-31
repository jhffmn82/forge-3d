// A14 (1.7 synth, js/platform/audio.js:227-323): a cue with no recording still makes a small sound, built from tones
// and filtered noise as 1.7 built it, at the cue's gain, through the echo. The recipes are data/audio.json's synth table
// (consolidation S1, render-32): the first whose pattern matches the cue plays.

import data from '../../data/audio.json' with { type: 'json' };
import { sfxLevel } from './cues.js';

const S = data.synth;
const RECIPES = S.recipes.map(r => ({ ...r, re: new RegExp(r.re) }));
const ELEMENT_OF = S.elementOf.map(([word, el]) => [new RegExp(word), el]);

/** The layers a cue is built from, and whether their peaks scale by the cue's level. */
export function synthRecipe(name) {
  const r = RECIPES.find(x => x.re.test(name));
  if (!r) return { layers: S.fallback, levelled: false };
  if (!r.element) return r;
  const el = ELEMENT_OF.find(([w]) => w.test(name))?.[1] ?? S.elementDefault;
  return { layers: S.elements[el][/hit/.test(name) ? 'hit' : 'cast'], levelled: false };
}

/** A player of recipes on `ctx` into `out` (and the echo `verb`), each voice handed to `track`. */
export function synthKit(ctx, out, verb, track) {
  let NOISE = null, k = 1;
  const env = (t, a, d, peak) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * k), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    return g;
  };
  const send = g => { g.connect(out); if (verb) g.connect(verb); };
  const tone = (t, type, f1, f2, dur, vol) => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f1, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    const g = env(t, Math.min(0.01, dur * 0.2), dur, vol);
    o.connect(g); send(g); track(o, [g]); o.start(t); o.stop(t + dur + 0.05);
  };
  const noise = (t, dur, vol, type, f1, f2, q) => {
    if (!NOISE) { NOISE = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = NOISE.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const s = ctx.createBufferSource(); s.buffer = NOISE;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f1, t);
    if (f2) f.frequency.exponentialRampToValueAtTime(Math.max(30, f2), t + dur);
    f.Q.value = q;
    const g = env(t, Math.min(0.008, dur * 0.15), dur, vol);
    s.connect(f); f.connect(g); send(g); track(s, [f, g]); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  };
  const arp = (t, notes, step, type, vol) => notes.forEach((n, i) => tone(t + i * step, type, n, 0, step * 2.2, vol));
  const layer = (l, t, scale) => {
    const [count, every] = l.repeat ?? [1, 0];
    for (let i = 0; i < count; i++) {
      const at = t + (l.at ?? 0) + i * every;
      if (l.tone) { const [w, f1, f2, d, v] = l.tone; tone(at, w, f1, f2, d, v * scale); }
      else if (l.noise) { const [d, v, type, f1, f2, q] = l.noise; noise(at, d, v * scale, type, f1, f2, q); }
      else if (l.arp) { const [notes, step, w, v] = l.arp; arp(at, notes, step, w, v * scale); }
    }
  };
  /** Plays a cue now at a gain (the cue's volume times its distance gain). */
  return (name, gain) => {
    k = gain;
    try {
      const r = synthRecipe(name), scale = r.levelled ? sfxLevel(name) : 1, t = ctx.currentTime;
      for (const l of r.layers) layer(l, t, scale);
    } finally { k = 1; }
  };
}
