// The sandbox's recorder (item 172, Justin 2026-10-18: "a record function at the top of the screen that outputs a .mp4
// and limits the video to 10 mb"). A small Record button at the top of the screen in a sandbox run records the game
// canvas, and the sound when audio.stream() gives one. Where the browser has WebCodecs (item 300, clip-codec.js) it
// records at full quality, up to a minute, and on stop makes the MP4 fit 10,000,000 bytes, compressing when it must.
// Elsewhere MediaRecorder records: MP4 (H.264 with AAC or Opus) where the browser can, else WebM, saved as .webm and
// said so, stopping by itself before the file would pass the cap. Either stops on a hidden page or leaving the run, and
// saves at once; a window or a floor change is recorded (item 319). The button is a page element over the canvas, so it
// is never in the video.

import { sandboxShown } from '../ui/screens/title.js';
import { createClipRecorder } from './clip-codec.js';

export const CAP_BYTES = 10_000_000;
export const SLICE_MS = 1000;
/**
 * Item 300 (Justin 2026-10-21: "the output is really poor quality and grainy"): his clips run about 5 s, so length goes
 * for quality: 6 Mbit/s of video and 128 kbit/s of sound, some 770 KB a second, about 11 s in the cap.
 */
export const VIDEO_BPS = 6_000_000, AUDIO_BPS = 128_000;
const PER_SLICE = (VIDEO_BPS + AUDIO_BPS) / 8 * SLICE_MS / 1000;
/** A chunk at least this big has pictures in it (the MP4's header and tail are a few hundred bytes); a minute at most. */
const PICTURES = 4_000, MAX_MS = 60_000;
// The best the browser offers: H.264 High profile (level 4.0, up to 1600 x 1000 at 30 frames) in MP4, then VP9, then VP8,
// then whatever MP4 or WebM it takes.
const TYPES = [
  ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'mp4'], ['video/mp4;codecs=avc1.640028,opus', 'mp4'],
  ['video/webm;codecs=vp9,opus', 'webm'], ['video/webm;codecs=vp8,opus', 'webm'], ['video/mp4', 'mp4'], ['video/webm', 'webm'],
];

/** The first type `supported` (MediaRecorder.isTypeSupported) takes: { mime, ext }; null for none. */
export function pickFormat(supported) {
  const t = TYPES.find(([mime]) => supported(mime));
  return t ? { mime: t[0], ext: t[1] } : null;
}

/** forge-sandbox-2026-10-19-031502.mp4: the date and time the recording stopped. */
export function fileName(d, ext) {
  const p = n => String(n).padStart(2, '0');
  return `forge-sandbox-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}

/**
 * The size the video is recorded at: the canvas scaled so its longer side is at most 1600 pixels, never up, both sides
 * even (H.264 wants them so). Item 214 (2026-10-19): the full canvas at 1.6 Mbit/s came out in 16-pixel blocks; item 300
 * (2026-10-21) gives the 1600 pixels 6 Mbit/s.
 */
export function recordSize(w, h) {
  const k = Math.min(1, 1600 / Math.max(1, w, h)), even = n => Math.max(2, Math.round(n * k / 2) * 2);
  return { w: even(w), h: even(h) };
}

/** Whether the Record button shows: the play build (title.js BUILD), a sandbox run on screen. */
export const recordShown = S => sandboxShown() && !!S.game?.sandbox && S.ui?.mode === 'play';

/**
 * Why a recording of `game` must stop now, or null: the run left, a hidden page. Item 319 (Justin 2026-10-22: "exits as
 * soon as i open a ui window"): a window and the floor's hold draw on the canvas the clip takes, which renders on, so
 * they are recorded.
 */
export const stopReason = (S, game, hidden = false) => (S.game !== game || S.ui?.mode !== 'play' ? 'left' : hidden ? 'pause' : null);

/**
 * One recording at a time: start(stream), stop(why), check(), state(). It stops when the file would be the cap's size if
 * it stopped now: the chunks come so far, and what the encoder holds since its last chunk with pictures in it, at the
 * rate it has shown (the bitrate's until one comes), a second to spare; or at a minute. Item 300 (Justin 2026-10-21: "the
 * auto recorder is only recording a few seconds"): Chrome's MP4 gives a chunk each keyframe group, about 4 s, not each
 * slice (2.47 MB at 8.5 s at 1600 pixels), and the rule before, twice the largest chunk on a padded estimate, stopped on
 * the first. check() runs on each chunk and each frame.
 */
export function createRecorder({ Recorder = globalThis.MediaRecorder, supported = m => !!globalThis.MediaRecorder?.isTypeSupported?.(m), now = () => performance.now(), save, say = () => {} } = {}) {
  let rec = null, chunks = [], bytes = 0, began = 0, lastAt = 0, fmt = null, why = null;
  const shown = () => bytes > PICTURES && lastAt > began;   // a chunk with pictures has come: the encoder's own rate
  const projected = () => bytes + (shown() ? bytes / (lastAt - began) : PER_SLICE / SLICE_MS) * (now() - lastAt + 1000);
  const check = () => { if (rec?.state === 'recording' && (projected() > CAP_BYTES || now() - began >= MAX_MS)) stop('cap'); };
  function stop(reason = 'stop') {
    if (!rec || rec.state === 'inactive') return;
    why = reason;
    rec.stop();
  }
  function start(stream) {
    if (rec) return false;
    fmt = Recorder ? pickFormat(supported) : null;
    if (!fmt) { say('This browser cannot record video.'); return false; }
    if (fmt.ext !== 'mp4') say('This browser cannot record MP4: the video is saved as WebM.');
    say(`Recording: ${VIDEO_BPS / 1e6} Mbit/s video, ${AUDIO_BPS / 1000} kbit/s sound, about ${Math.floor(CAP_BYTES / PER_SLICE) - 1} s or more in 10 MB.`);
    const r = rec = new Recorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: VIDEO_BPS, audioBitsPerSecond: AUDIO_BPS });
    chunks = []; bytes = 0; began = lastAt = now(); why = null;
    r.ondataavailable = e => {
      if (!e.data?.size) return;
      chunks.push(e.data); bytes += e.data.size;
      if (e.data.size >= PICTURES) lastAt = now();
      check();
    };
    r.onstop = () => {
      const blob = new Blob(chunks, { type: fmt.mime.split(';')[0] }), name = fileName(new Date(), fmt.ext);
      save(blob, name);
      say(`${why === 'cap' ? 'The 10 MB cap: recording stopped.' : 'Recording stopped.'} Saved ${name} (${(blob.size / 1e6).toFixed(1)} MB).`);
      rec = null; chunks = [];
    };
    r.start(SLICE_MS);
    return true;
  }
  return { start, stop, check, state: () => ({ on: !!rec, bytes, ms: rec ? now() - began : 0, ext: fmt?.ext ?? null }) };
}

/** Saves `blob` through a link, at once (the browser's download). */
function download(blob, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

/**
 * The Record button at the top centre, clear of the HUD's corners: Record, or while recording Stop with the time and
 * the MB so far, then Compressing with its percent (item 300). Shown and checked every frame (`ticker`): a stop reason
 * ends the recording and saves it. WebCodecs records where the browser has it (clip-codec.js), else MediaRecorder.
 */
export function mountRecorder(S, { ticker, canvas, audio }) {
  const say = w => S.ui?.say?.(w, 0xb0a890);
  const rec = createRecorder({ save: download, say }), clip = createClipRecorder({ cap: CAP_BYTES, save: download, say, fileName });
  const b = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Record', tabIndex: -1 });
  b.addEventListener('mousedown', e => e.preventDefault());   // never takes the focus: Space and Enter stay the game's
  b.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:20;display:none;padding:4px 12px;border-radius:6px;border:1px solid #70766a;background:#141619e6;color:#eee9ce;font:600 13px system-ui,sans-serif;cursor:pointer';
  document.body.appendChild(b);
  let game = null, label = '', copy = null, cur = null, starting = false;
  b.onclick = async () => {
    if (starting || cur?.state().compressing) return;
    if (cur?.state().on) return cur.stop('stop');
    const { w, h } = recordSize(canvas.width, canvas.height), track = audio.stream?.()?.getAudioTracks()[0] ?? null;
    const next = Object.assign(document.createElement('canvas'), { width: w, height: h });
    starting = true;   // the copy is drawn from when a recorder has started, never while it starts (a frame then would drop it)
    cur = (await clip.start(next, track)) ? clip : rec.start(new MediaStream([...next.captureStream(30).getVideoTracks(), ...(track ? [track] : [])])) ? rec : null;
    starting = false;
    if (cur) { copy = next; game = S.game; }
  };
  // The picture is taken just after the map is drawn (below the renderer's priority), while it is still in the canvas.
  // Item 320 (Justin 2026-10-22: "frame rate dips pretty noticable when the recorder is on"): only on the ticks that are
  // recorded, 30 a second, not every tick; where the canvas is the clip's size it is encoded as it is, with no copy.
  let taken = -Infinity;
  ticker.add(() => {
    if (!copy || !cur?.state().on) { if (!cur?.state().compressing) copy = null; return; }
    const t = performance.now();
    if (cur.due ? !cur.due() : t - taken < 1000 / 30 - 2) return;
    taken = t;
    const same = !!cur.frame && canvas.width === copy.width && canvas.height === copy.height;
    if (!same) copy.getContext('2d').drawImage(canvas, 0, 0, copy.width, copy.height);
    cur.frame?.(same ? canvas : copy);
  }, null, -50);
  ticker.add(() => {
    const st = cur?.state() ?? rec.state();
    if (st.on) { const why = stopReason(S, game, document.hidden); if (why) cur.stop(why); else cur.check(); }
    const show = st.on || st.compressing || recordShown(S), s = Math.floor(st.ms / 1000);
    const words = st.compressing ? `Compressing… ${st.pct}%` : st.on ? `● Stop  ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}  ${(st.bytes / 1e6).toFixed(1)} MB` : 'Record';
    b.style.display = show ? 'block' : 'none';
    if (words !== label) { b.textContent = label = words; b.style.color = st.on ? '#e86a5a' : '#eee9ce'; }
  });
  return rec;
}
