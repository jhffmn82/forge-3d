// The sandbox's Record button in the 3D build (Justin 2026-10-31: "We need to bring back the record function in
// sandbox"), the 2D game's (forge-rewrite src/platform/recorder.js) on Godot's canvas: an MP4 of up to a minute, made to
// fit 10 MB as it stops, with the game's sound. A sandbox run in play shows it (play.gd), page elements over the canvas,
// so they are never in the video. Each recording also saves its timing (scripts/trace.gd) and puts it on the clipboard,
// to paste to Claude; Time records the timing alone, nothing else on the page's frames.

import { createClipRecorder } from '../../forge-rewrite/src/platform/clip-codec.js';

const CAP_BYTES = 10_000_000, TIME_MS = 60_000;

const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const fileName = (d, ext) => `forge-sandbox-${stamp(d)}.${ext}`;

/** The size the clip is taken at: the canvas with its longer side at most 1600 pixels, never up, both sides even (recorder.js). */
function recordSize(w, h) {
  const k = Math.min(1, 1600 / Math.max(1, w, h)), even = n => Math.max(2, Math.round(n * k / 2) * 2);
  return { w: even(w), h: even(h) };
}

function download(blob, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

/** The graphics card's name, for the timing's header. */
function gpuName(canvas) {
  const gl = canvas.getContext('webgl2'), x = gl?.getExtension('WEBGL_debug_renderer_info');
  return x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : 'unknown';
}

const LOOK = 'position:fixed;top:8px;z-index:20;padding:4px 12px;border-radius:6px;border:1px solid #70766a;background:#141619e6;color:#eee9ce;font:600 13px system-ui,sans-serif;cursor:pointer';

/** The buttons, and what shows them: show(on) as a sandbox run comes on screen or leaves it. */
export function mountRecord(forge) {
  const canvas = document.querySelector('canvas');
  const button = (words, left) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: words, tabIndex: -1 });
    b.addEventListener('mousedown', e => e.preventDefault());   // never takes the focus: Space and Enter stay the game's
    b.style.cssText = `${LOOK};left:calc(50% + ${left}px);display:none`;
    document.body.appendChild(b);
    return b;
  };
  const rec = button('Record', 44), timer = button('Time', 124);
  const note = Object.assign(document.createElement('div'), {});
  note.style.cssText = 'position:fixed;top:42px;left:calc(50% + 44px);z-index:20;max-width:420px;padding:4px 10px;border-radius:6px;background:#141619e6;color:#eee9ce;font:13px system-ui,sans-serif;display:none';
  document.body.appendChild(note);
  let noteTimer = 0;
  const say = w => {
    note.textContent = w; note.style.display = 'block';
    clearTimeout(noteTimer); noteTimer = setTimeout(() => { note.style.display = 'none'; }, 10000);
  };

  const clip = createClipRecorder({ cap: CAP_BYTES, save: download, say, fileName });
  let shown = false, tracing = false, copy = null, cur = null, starting = false, began = 0, video = false, label = '', tap = null;

  const trace = on => { tracing = on; if (on) began = performance.now(); forge.onRecord?.(on); };
  // Godot's answer to trace(false): its text, with what it ran on, saved and on the clipboard.
  forge.traced = text => {
    const d = new Date(), name = fileName(d, 'trace.json');
    const full = JSON.stringify({ build: document.querySelector('meta[name="forge-build"]')?.content ?? 'dev', link: forge.link, ua: navigator.userAgent, gpu: gpuName(canvas),
      window: [innerWidth, innerHeight, devicePixelRatio], canvas: [canvas.width, canvas.height], video, ...JSON.parse(text) });
    download(new Blob([full], { type: 'application/json' }), name);
    navigator.clipboard?.writeText(full).then(() => say(`Timing saved as ${name} and copied: paste it to Claude.`), () => say(`Timing saved as ${name}.`));
  };

  // The game's sound, where it leaves for the speakers (web/page.js keeps those nodes), for the clip.
  const soundTrack = () => {
    const outs = forge.audioOuts, ctx = outs?.[0]?.context;
    if (!ctx) return null;
    tap ??= ctx.createMediaStreamDestination();
    for (const n of outs) n.connect(tap);
    return tap.stream.getAudioTracks()[0] ?? null;
  };

  rec.onclick = async () => {
    if (starting || cur?.state().compressing) return;
    if (cur?.state().on) { cur.stop('stop'); trace(false); return; }
    if (tracing) return;
    const { w, h } = recordSize(canvas.width, canvas.height), next = Object.assign(document.createElement('canvas'), { width: w, height: h });
    starting = true;   // the copy is drawn from once the recorder has started, never while it starts
    cur = (await clip.start(next, soundTrack())) ? clip : null;
    starting = false;
    if (!cur) { say('This browser cannot record video.'); return; }
    copy = next; video = true;
    trace(true);
  };
  timer.onclick = () => {
    if (cur?.state().on || starting) return;
    video = false;
    trace(!tracing);
    if (tracing) say('Timing: hold the key, then press Stop.');
  };

  // Each frame, after Godot's has been drawn (its callback was asked for first), while the picture is still in the canvas.
  const frame = () => {
    requestAnimationFrame(frame);
    const st = cur?.state() ?? { on: false }, on = !!st.on;
    if (on && copy && clip.due()) {
      const same = canvas.width === copy.width && canvas.height === copy.height;
      if (!same) copy.getContext('2d').drawImage(canvas, 0, 0, copy.width, copy.height);
      clip.frame(same ? canvas : copy);
    }
    if (on) {
      if (!shown || document.hidden) { clip.stop('left'); trace(false); }
      else clip.check();
    }
    if (tracing && !on && (!shown || document.hidden || performance.now() - began >= TIME_MS)) trace(false);
    if (!on && !st.compressing) copy = null;
    if (tracing && !on) timer.textContent = `● Stop  ${Math.floor((performance.now() - began) / 1000)} s`;
    else timer.textContent = 'Time';
    const s = Math.floor((st.ms ?? 0) / 1000);
    const words = st.compressing ? `Compressing… ${st.pct}%` : on ? `● Stop  ${Math.floor(s / 60)}:${pad(s % 60)}  ${((st.bytes ?? 0) / 1e6).toFixed(1)} MB` : 'Record';
    if (words !== label) { rec.textContent = label = words; rec.style.color = on ? '#e86a5a' : '#eee9ce'; }
    const up = shown || on || !!st.compressing;
    rec.style.display = up ? 'block' : 'none';
    timer.style.display = shown || tracing ? 'block' : 'none';
  };
  requestAnimationFrame(frame);
  return on => { shown = on; };
}
