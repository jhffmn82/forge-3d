// Item 300 (Justin 2026-10-21: "record high quality, then compress in the browser to fill 10 MB with a variable
// bitrate"): the sandbox recorder's WebCodecs path. The canvas copy is encoded as it is recorded, at full quality (H.264
// High, 12 Mbit/s, 30 frames a second) and kept in memory, at most a minute; the sound with it (AAC, else Opus). On stop
// a clip that fits 10 MB is put in an MP4 as it is; a longer one is decoded and encoded again with a variable bitrate
// that fills 10 MB, and once more, lower, if it still runs over. The MP4 is mp4-muxer's (vendored). Where the browser
// has no WebCodecs, or will not take the settings, recorder.js keeps its MediaRecorder path.

import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer-5.2.2.mjs';

export const HQ = { codec: 'avc1.640028', videoBps: 12_000_000, audioBps: 128_000, fps: 30, keySec: 2, maxMs: 60_000, fill: 0.95, floorBps: 250_000 };

/** The video bitrate that fills the cap: (cap x 8 x 0.95 - the sound's bits) / the seconds, never below 250 kbit/s. */
export const targetBitrate = (seconds, audioBytes, cap) => Math.max(HQ.floorBps, Math.floor((cap * 8 * HQ.fill - audioBytes * 8) / Math.max(0.1, seconds)));

/** Whether a recording of this many bytes fits the cap as it is, with room for the MP4's own boxes. */
export const fits = (bytes, frames, cap) => bytes + 64_000 + frames * 24 <= cap;

// Item 320 (Justin 2026-10-22: "frame rate dips pretty noticable when the recorder is on"): the GPU's encoder where there is
// one; live, the realtime mode (no look-ahead held while the game plays); the compress after the stop, the quality mode.
const videoConfig = (w, h, bitrate, hw, live) => ({ codec: HQ.codec, width: w, height: h, bitrate, framerate: HQ.fps, bitrateMode: 'variable', latencyMode: live ? 'realtime' : 'quality', hardwareAcceleration: hw, avc: { format: 'avc' } });
const idle = () => new Promise(ok => setTimeout(ok, 0));

/**
 * One recording at a time: start(copy, audioTrack) (resolves false where WebCodecs will not take it), due() and
 * frame(source) each tick it is due, stop(why), check(), state(): {on, compressing, pct, bytes, ms}. save(blob, name)
 * and say(words) as recorder.js's; fileName(date, ext) names the file.
 */
export function createClipRecorder({ cap, save, say = () => {}, fileName, now = () => performance.now() }) {
  let st = null;
  const fail = e => { say(`Recording failed: ${e?.message ?? e}`); try { st?.venc?.close(); st?.aenc?.close(); } catch { /* closed */ } st = null; };

  async function start(copy, track) {
    if (st || typeof VideoEncoder !== 'function' || typeof VideoDecoder !== 'function') return false;
    // Asked with a limit: a busy page can leave the answer pending for minutes, and the Record button must not wait on it.
    const w = copy.width, h = copy.height, late = new Promise(ok => setTimeout(() => ok(false), 1500));
    const takes = hw => Promise.race([VideoEncoder.isConfigSupported(videoConfig(w, h, HQ.videoBps, hw, true)).then(r => r.supported, () => false), late]);
    const hw = (await takes('prefer-hardware')) ? 'prefer-hardware' : (await takes('no-preference')) ? 'no-preference' : null;
    if (!hw) return false;
    const s = st = { w, h, hw, video: [], audio: [], vbytes: 0, abytes: 0, vconf: null, began: now(), last: -Infinity, n: 0, on: true, compressing: false, pct: 0, why: null };
    s.venc = new VideoEncoder({ output: (c, m) => { s.video.push([c, m]); s.vbytes += c.byteLength; if (m?.decoderConfig) s.vconf = m.decoderConfig; }, error: fail });
    s.venc.configure(videoConfig(w, h, HQ.videoBps, hw, true));
    if (track && typeof MediaStreamTrackProcessor === 'function' && typeof AudioEncoder === 'function') {
      s.reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
      (async () => {
        for (;;) {
          const { value: a, done } = await s.reader.read().catch(() => ({ done: true }));
          if (done) return;
          if (!s.aenc) {
            const conf = { sampleRate: a.sampleRate, numberOfChannels: a.numberOfChannels, bitrate: HQ.audioBps };
            const aac = (await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', ...conf }).catch(() => null))?.supported;
            s.acodec = aac ? 'aac' : 'opus'; s.arate = a.sampleRate; s.ach = a.numberOfChannels;
            s.aenc = new AudioEncoder({ output: (c, m) => { s.audio.push([c, m]); s.abytes += c.byteLength; }, error: () => { s.aenc = null; } });
            s.aenc.configure({ codec: aac ? 'mp4a.40.2' : 'opus', ...conf });
          }
          if (s.on && s.aenc?.state === 'configured') s.aenc.encode(a);
          a.close();
        }
      })();
    }
    say('Recording at full quality, up to a minute; it is made to fit 10 MB when it stops.');
    return true;
  }

  /** Whether this tick's picture is to be encoded: 30 a second, none while the encoder is behind (the caller copies only then). */
  const due = () => !!st?.on && now() - st.last >= 1000 / HQ.fps - 2 && st.venc.encodeQueueSize <= 3;
  /** The picture just drawn (the game's canvas, or the copy scaled from it), encoded; a keyframe each 2 s. */
  function frame(source) {
    const s = st, t = now();
    s.last = t;
    const f = new VideoFrame(source, { timestamp: Math.round((t - s.began) * 1000) });
    s.venc.encode(f, { keyFrame: s.n++ % (HQ.fps * HQ.keySec) === 0 });
    f.close();
  }

  function mux(s, video) {
    const m = new Muxer({ target: new ArrayBufferTarget(), fastStart: 'in-memory', firstTimestampBehavior: 'offset',
      video: { codec: 'avc', width: s.w, height: s.h, frameRate: HQ.fps },
      audio: s.audio.length ? { codec: s.acodec, numberOfChannels: s.ach, sampleRate: s.arate } : undefined });
    for (const [c, meta] of video) m.addVideoChunk(c, meta);
    for (const [c, meta] of s.audio) m.addAudioChunk(c, meta);
    m.finalize();
    return new Blob([m.target.buffer], { type: 'video/mp4' });
  }

  /** The recording decoded and encoded again at `bitrate`; pct runs from `from` to `to`. */
  async function reencode(s, bitrate, from, to) {
    const out = [];
    let n = 0, err = null;
    const enc = new VideoEncoder({ output: (c, m) => out.push([c, m]), error: e => { err = e; } });
    enc.configure(videoConfig(s.w, s.h, bitrate, s.hw, false));
    const dec = new VideoDecoder({ output: f => { enc.encode(f, { keyFrame: n++ % (HQ.fps * HQ.keySec) === 0 }); f.close(); }, error: e => { err = e; } });
    dec.configure(s.vconf);
    for (let i = 0; i < s.video.length && !err; i++) {
      dec.decode(s.video[i][0]);
      while (!err && (dec.decodeQueueSize > 6 || enc.encodeQueueSize > 6)) await idle();
      s.pct = Math.round(from + (to - from) * (i + 1) / s.video.length);
    }
    if (!err) { await dec.flush(); await enc.flush(); }
    dec.close(); enc.close();
    if (err) throw err;
    return out;
  }

  async function stop(why = 'stop') {
    const s = st;
    if (!s?.on) return;
    s.on = false; s.why = why;
    try {
      await s.venc.flush(); s.venc.close();
      await s.reader?.cancel().catch(() => {});
      if (s.aenc?.state === 'configured') { await s.aenc.flush(); s.aenc.close(); }
      if (!s.video.length) { say('Nothing was recorded.'); st = null; return; }
      const v = s.video, seconds = (v.at(-1)[0].timestamp - v[0][0].timestamp) / 1e6 + 1 / HQ.fps;
      let blob;
      if (fits(s.vbytes + s.abytes, v.length + s.audio.length, cap)) blob = mux(s, v);
      else {
        s.compressing = true;
        let bitrate = targetBitrate(seconds, s.abytes, cap);
        blob = mux(s, await reencode(s, bitrate, 0, 50));
        // A variable bitrate lands off its target: over the cap, or well under it on easy pictures (a 30 s clip came to
        // 5.2 MB). Once more, scaled by as much, never past full quality; a second try that runs over keeps the first.
        if (blob.size > cap || blob.size < cap * 0.8) {
          bitrate = Math.min(HQ.videoBps, Math.max(HQ.floorBps, Math.floor(bitrate * cap * HQ.fill / blob.size)));
          const again = mux(s, await reencode(s, bitrate, 50, 100));
          if (again.size <= cap || blob.size > cap) blob = again;
        }
      }
      const name = fileName(new Date(), 'mp4');
      save(blob, name);
      say(`${why === 'cap' ? 'A minute: recording stopped.' : 'Recording stopped.'} Saved ${name} (${(blob.size / 1e6).toFixed(1)} MB, ${Math.round(seconds)} s).`);
    } catch (e) { fail(e); return; }
    st = null;
  }

  /** The minute's end stops it. */
  const check = () => { if (st?.on && now() - st.began >= HQ.maxMs) stop('cap'); };
  const state = () => ({ on: !!st?.on, compressing: !!st?.compressing, pct: st?.pct ?? 0, bytes: st ? st.vbytes + st.abytes : 0, ms: st?.on ? now() - st.began : 0 });
  return { start, due, frame, stop, check, state };
}
