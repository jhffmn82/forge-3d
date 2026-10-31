// Sound: an effects bus and a music bus, unlocked by the first touch or key.
// Effects are 1.7's recorded cues, decoded on first use. Music streams: a track fades in when it arrives and
// nothing waits for it (Justin, 2026-10-15). A cue with no file is recorded in `missing` and, as in 1.7, makes a
// small synthesized sound instead (audit A14, synth.js). Every level, band, alias and timing is data/audio.json's;
// which event plays which cue is cues.js's table (consolidation S1).

import ui from '../../data/ui.json' with { type: 'json' };
import data from '../../data/audio.json' with { type: 'json' };
import { soundFiles, soundInfo, soundBytes } from './sound-list.js';   // C17: the manifest's cues, handed over by platform/assets.js
import { sfxLevel, distanceGain, createEvents } from './cues.js';
import { synthKit } from './synth.js';
import { tuneFor, ambienceFor, bossTuneFor, isSceneTune, musicEnds } from './scene.js';

export { sfxLevel, distanceGain, hitSfxFor } from './cues.js';
export { tuneFor, ambienceFor, bossTuneFor, musicEnds } from './scene.js';

const A = ui.audio, MIX = data.mix, MUSIC = data.music;

/* A5 (1.7 audioInit): spells, prayers, shrines, heals and the Forge ring in the stone-room echo. */
const ECHO_CUES = new RegExp(MIX.echoCues);

/* A13 (1.7 audioRetryDelay): a track that failed to arrive is tried again after 5 s, doubling to at most 30 s. */
const retryDelay = failures => Math.min(MUSIC.retryMs.max, MUSIC.retryMs.first * 2 ** Math.min(3, Math.max(0, failures - 1)));

// touch: whether the device is a touch one (C15: main.js hands it ui/core/stage.js isTouchDevice; audio imports no UI).
export function createAudio({ now = () => performance.now(), touch = () => false } = {}) {
  let ctx = null, sfxBus = null, musicBus = null, verb = null, synth = null, mix = null, tap = null;
  const buffers = new Map(), failed = new Map(), musicLru = [], voices = [], lastAt = new Map(), uiVoices = new WeakSet();
  // A15: the run the sounds belong to (a new or loaded run starts another); A3: the next stone step's take.
  let generation = 0, stepTake = 0, markUi = false;
  /** A4: every sounding effect counts toward the voice limit, the oldest cut; the interface's survive a new run (A15). */
  const track = (src, nodes) => {
    while (voices.length >= MIX.voices) { try { voices.shift().stop(); } catch { /* already ended */ } }
    if (markUi) uiVoices.add(src);
    voices.push(src);
    src.onended = () => { const i = voices.indexOf(src); if (i >= 0) voices.splice(i, 1); uiVoices.delete(src); src.disconnect(); for (const n of nodes) n.disconnect(); };
  };
  // played: every cue asked for; sounded: those distance and de-duplication let through, with their gain.
  const audio = { muted: false, played: [], sounded: [], missing: new Set(), music: null, wantMusic: null, wantAmbience: null, floorTune: null, boss: false };
  let current = null, ambience = null, here = null;

  // The player's options (Options window): sound and music on or off, and their volumes (0 to 1).
  const levels = { sound: true, music: true, sfx: A.sfxVolume, musicVol: A.musicVolume };
  const applyLevels = () => {
    if (!ctx) return;
    sfxBus.gain.value = levels.sound ? levels.sfx : 0;
    musicBus.gain.value = levels.music ? levels.musicVol : 0;
  };
  audio.setLevels = ({ sound, music, sfxVolume, musicVolume }) => {
    if (sound !== undefined) levels.sound = !!sound;
    if (music !== undefined) levels.music = !!music;
    if (sfxVolume !== undefined) levels.sfx = sfxVolume / 100;
    if (musicVolume !== undefined) levels.musicVol = musicVolume / 100;
    audio.muted = !levels.sound;
    applyLevels();
    // With music off nothing is fetched (1.7); turning it back on starts the wanted track.
    if (!levels.music) { fadeOut(current, A.musicFadeMs.default); fadeOut(ambience, A.musicFadeMs.default); current = ambience = null; }
    else if (ctx) { if (audio.wantMusic) audio.playMusic(audio.wantMusic); if (audio.wantAmbience) audio.playAmbience(audio.wantAmbience); }
  };

  // A13 (1.7 resumeAudio): every touch or key brings the sound back after a phone call, a lock or a hidden tab, and a
  // track that failed to arrive is asked for again.
  let resuming = null;
  function recover() {
    if (!levels.music) return;
    if (audio.wantMusic && (!current || current.failed)) { if (current?.failed) current = null; audio.playMusic(audio.wantMusic); }
    if (audio.wantAmbience && (!ambience || ambience.failed)) { if (ambience?.failed) ambience = null; audio.playAmbience(audio.wantAmbience); }
  }
  function resume() {
    if (!ctx || ctx.state === 'closed') return Promise.resolve();
    if (ctx.state === 'running' || typeof ctx.resume !== 'function') { recover(); return Promise.resolve(); }
    if (resuming) return resuming;
    let r;
    try { r = Promise.resolve(ctx.resume()); } catch { r = Promise.resolve(); }
    resuming = r.catch(() => {}).then(() => { resuming = null; if (ctx.state === 'running') recover(); });
    return resuming;
  }
  function unlock() {
    if (ctx) { resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC(); } catch { return; }
    // A5 (1.7 audioInit): both buses meet in a limiter so a loud stack never clips, and the effects bus carries a
    // generated stone-room echo.
    let out = ctx.destination;
    if (typeof ctx.createDynamicsCompressor === 'function') {
      const lim = ctx.createDynamicsCompressor(), L = MIX.limiter;
      lim.threshold.value = L.threshold; lim.knee.value = L.knee; lim.ratio.value = L.ratio; lim.attack.value = L.attack; lim.release.value = L.release;
      lim.connect(ctx.destination); out = lim;
    }
    sfxBus = ctx.createGain(); sfxBus.connect(out);
    musicBus = ctx.createGain(); musicBus.connect(out);
    mix = out;
    if (typeof ctx.createConvolver === 'function' && typeof ctx.createBuffer === 'function' && ctx.sampleRate) {
      const len = Math.floor(ctx.sampleRate * MIX.echo.seconds), ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, MIX.echo.decay); }
      verb = ctx.createConvolver(); verb.buffer = ir;
      const vg = ctx.createGain(); vg.gain.value = MIX.echo.gain; verb.connect(vg); vg.connect(sfxBus);
    }
    if (typeof ctx.createOscillator === 'function' && typeof ctx.createBiquadFilter === 'function') synth = synthKit(ctx, sfxBus, verb, track);
    applyLevels();
    if (audio.wantMusic) audio.playMusic(audio.wantMusic);
    if (audio.wantAmbience) audio.playAmbience(audio.wantAmbience);
    resume();
  }
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
  globalThis.document?.addEventListener?.('visibilitychange', () => { if (!document.hidden) resume(); });
  audio.unlock = unlock;

  /** A cue's decoded take (A3: a cue with several files, the stone steps, has one per take). */
  function buffer(name, take = 0) {
    const key = take ? `${name}#${take}` : name;
    if (buffers.has(key)) return buffers.get(key);
    const files = soundFiles(name);
    if (!files) { audio.missing.add(name); return null; }
    const f = failed.get(key), file = files[take] ?? files[0];
    if (f && now() < f.retryAt) return Promise.resolve(null);
    const p = soundBytes(file).then(b => ctx.decodeAudioData(b)).then(b => {
      failed.delete(key); audio.missing.delete(name);
      // A12 (1.7 AUDIO_MUSIC_LRU, 2026-10-14): a decoded track is 35 to 53 MB; a tablet keeps fewer than a desktop. The
      // playing one stays alive through its source.
      if (soundInfo(name)?.kind === 'music') {
        const at = musicLru.indexOf(name);
        if (at >= 0) musicLru.splice(at, 1);
        musicLru.push(name);
        while (musicLru.length > (touch() ? MUSIC.tracksKept.touch : MUSIC.tracksKept.desktop)) buffers.delete(musicLru.shift());
      }
      return b;
    }).catch(() => {
      // A13: a failure is not kept forever; the file is asked for again after the back-off.
      const failures = (failed.get(key)?.failures ?? 0) + 1;
      failed.set(key, { failures, retryAt: now() + retryDelay(failures) });
      buffers.delete(key); audio.missing.add(name);
      return null;
    });
    buffers.set(key, p);
    return p;
  }
  /** The decoded music tracks kept, oldest first (A12). */
  audio.cachedTracks = () => [...musicLru];

  /** Plays a named effect, optionally quieter (0-1), from a place in the world (a tile, or tiles of which the nearest
   *  counts; none is full volume). Every cue is recorded in `played`, so checks can see it happened. */
  audio.cue = (name, volume = 1, from = null) => {
    audio.played.push(name);
    if (audio.played.length > 100) audio.played.shift();
    const files = soundFiles(name);
    if (!files) audio.missing.add(name);   // A14: still heard, through the synth
    if (volume === 0) return;
    // Distance before de-duplication: a sound too far to hear, or a softer copy, never swallows a nearer one.
    const near = from ? distanceGain(from, here) : 1;
    if (near <= 0) return;
    // A4 (1.7 sfx): a repeat within its group's window plays once unless nearer; an alert plays quieter.
    const alert = /-alert$/.test(name), uiTick = /^ui-(click|open|close|hover)$/.test(name);
    const group = alert ? 'creature-alert' : uiTick ? 'ui-feedback' : name, t = now(), last = lastAt.get(group);
    if (last && Math.abs(t - last.at) < (MIX.repeatMs[group] ?? MIX.repeatMs.default) && last.gain >= near) return;
    lastAt.set(group, { at: t, gain: near });
    const gain = volume * sfxLevel(name) * (alert ? MIX.alertGain : 1) * near;
    audio.sounded.push({ name, gain });
    if (audio.sounded.length > 100) audio.sounded.shift();
    if (!ctx || audio.muted) return;
    // A15 (1.7 sfx): never a stale impact after a slow decode or a long suspension, and nothing from a run that is gone
    // (the interface's own sounds excepted).
    const ui = /^ui-/.test(name), gen = generation;
    const stale = () => audio.muted || now() > t + MIX.staleMs || (!ui && gen !== generation);
    const when = play => {
      if (ctx.state === 'suspended' || ctx.state === 'interrupted') resume().then(() => { if (ctx.state === 'running') play(); });
      else play();
    };
    if (!files) {   // A14: no recording, so 1.7's small synthesized sound at the cue's volume and distance
      if (synth) when(() => { if (stale()) return; markUi = ui; try { synth(name, volume * near); } finally { markUi = false; } });
      return;
    }
    // A3 (1.7 sfx): the stone steps rotate through their four takes.
    const take = files.length > 1 ? stepTake++ % files.length : 0;
    buffer(name, take)?.then(b => {
      if (!b) return;
      when(() => {
        if (stale()) return;
        const src = ctx.createBufferSource(), g = ctx.createGain();
        src.buffer = b; g.gain.value = gain; src.connect(g); g.connect(sfxBus);
        if (verb && ECHO_CUES.test(name)) g.connect(verb);   // A5
        markUi = ui; track(src, [g]); markUi = false;
        src.start();
      });
    });
  };
  /** The effects sounding now (A4: never more than the voice limit). */
  audio.voiceCount = () => voices.length;

  /** Starts a looped track on the music bus at a gain, fading in once it has arrived. A11 (1.7 playMusic): a song
   *  with an ending (`rests`, music only) plays once, rests and plays again instead of looping mid-phrase. */
  function loop(name, gain, fadeMs, rests = false) {
    const p = buffer(name);
    if (!p) return null;
    const node = { name, gain: ctx.createGain(), src: null, stopped: false, failed: false, timer: null, once: false };
    node.gain.gain.value = 0; node.gain.connect(musicBus);
    // Items 229, 253: a track's own filters (audio.json music.filters: a notch at a whistle, a low-pass over a whistling
    // bed, a peaking cut over a band of chirps),
    // between its source and its gain.
    node.input = (typeof ctx.createBiquadFilter === 'function' ? MUSIC.filters?.[name] ?? [] : []).reduceRight((to, f) => { const q = ctx.createBiquadFilter(); q.type = f.type; q.frequency.value = f.f; q.Q.value = f.q; if (f.gain != null) q.gain.value = f.gain; q.connect(to); return q; }, node.gain);
    p.then(b => {
      if (!b) { node.failed = true; return; }   // A13: the next touch or scene change asks again
      if (node.stopped) return;
      node.once = rests && musicEnds(b);
      const start = () => {
        if (node.stopped) return;
        const src = ctx.createBufferSource();
        src.buffer = b; src.loop = !node.once; src.connect(node.input);
        if (node.once) src.onended = () => { src.disconnect(); if (!node.stopped) node.timer = setTimeout(() => { node.timer = null; start(); }, MUSIC.restMs); };
        node.src = src; src.start();
        const t = ctx.currentTime;
        node.gain.gain.cancelScheduledValues?.(t);
        node.gain.gain.setValueAtTime(0, t); node.gain.gain.linearRampToValueAtTime(gain, t + fadeMs / 1000);
        audio.played.push('music:' + name);
      };
      start();
    });
    return node;
  }

  function fadeOut(node, fadeMs) {
    if (!node || !ctx) return;
    node.stopped = true;
    if (node.timer) { clearTimeout(node.timer); node.timer = null; }
    const t = ctx.currentTime;
    node.gain.gain.cancelScheduledValues(t); node.gain.gain.setValueAtTime(node.gain.gain.value, t);
    node.gain.gain.linearRampToValueAtTime(0, t + fadeMs / 1000);
    if (node.src) { try { node.src.stop(t + fadeMs / 1000 + 0.05); } catch { /* a song resting between plays has ended */ } }
  }

  /** Switches the music; the new track streams and fades in when it arrives (title and menu fade 6 s, others 2 s). */
  audio.playMusic = name => {
    audio.wantMusic = name;
    if (!isSceneTune(name)) audio.playAmbience(null);   // 1.7 playMusic: the title has no dungeon under it
    if (!ctx || !levels.music || (current?.name === name && !current.failed)) return;
    const fade = A.musicFadeMs[name] ?? A.musicFadeMs.default;
    fadeOut(current, fade);
    current = loop(name, 1, fade, true);
    audio.music = name;
  };

  /** A10 (1.7 syncSceneAudio): death or the end of the run stops the music and its ambience. */
  audio.stopMusic = () => {
    audio.wantMusic = null; audio.music = null; audio.boss = false;
    fadeOut(current, A.musicFadeMs.default); current = null;
    audio.playAmbience(null);
  };

  /** Switches the ambience under the music; none (null) fades it out. */
  audio.playAmbience = name => {
    audio.wantAmbience = name ?? null;
    if (!name) { fadeOut(ambience, A.musicFadeMs.default); ambience = null; return; }
    if (!ctx || !levels.music || (ambience?.name === name && !ambience.failed)) return;
    fadeOut(ambience, A.musicFadeMs.default);
    ambience = loop(name, A.ambienceGain, A.musicFadeMs.default);
  };

  /** A floor's music and ambience (arriving, loading, or a boss falling): its biome's or plane's tune. */
  audio.setScene = state => {
    const fight = bossTuneFor(state);
    audio.boss = !!fight;
    audio.floorTune = tuneFor(state);
    audio.playMusic(fight ?? audio.floorTune);
    audio.playAmbience(ambienceFor(state, !!fight));
    return audio.floorTune;
  };

  /** The engine's events, as 1.7's cues (cues.js). */
  const events = createEvents(audio, { soundFiles, setHere: at => { here = at; } });
  audio.onEvent = events.onEvent;

  /** Item 172: the whole mix as a MediaStream for the sandbox's recorder; null before sound is unlocked or where it cannot be. */
  audio.stream = () => {
    if (!ctx?.createMediaStreamDestination) return null;
    if (!tap) { tap = ctx.createMediaStreamDestination(); for (const n of mix === ctx.destination ? [sfxBus, musicBus] : [mix]) n.connect(tap); }
    return tap.stream;
  };

  /** A15 (1.7 resetRunSfx): a new or loaded run cuts the old run's sounds, queued ones too; the interface's play on. */
  audio.newRun = () => {
    generation += 1;
    for (const v of voices.splice(0)) { if (uiVoices.has(v)) voices.push(v); else { try { v.stop(); } catch { /* already ended */ } } }
    for (const k of [...lastAt.keys()]) if (k !== 'ui-feedback' && !k.startsWith('ui-')) lastAt.delete(k);
    events.clear();
  };

  return audio;
}
