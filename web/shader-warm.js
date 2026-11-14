// The browser build's shaders, built ahead in the background and handed to Godot as it asks for them
// (export_presets.cfg head include, before page.js).
//
// Godot builds each shader program as it first needs it and waits for it there, on the page's one thread: over
// Direct3D 11 (Edge and Chrome on Windows, Justin's laptop) a lit program takes one to two and a half seconds, and the
// first floor needs some 200 programs, which stood the page still for most of a minute after Enter (2026-10-30, the
// bench on d3d11). So, as the page opens, this builds the programs the floors are known to need
// (forge-godot/shader-warm.json, made by tools/shader_list.py from a run of this build), several at a time and without
// waiting on any (KHR_parallel_shader_compile: the browser builds them on its own threads), while the engine is still
// coming over the network.
//
// And Godot is given those very programs. Until 2026-11-10 each was let go once built, for the browser to keep its
// compiled form: Godot's own build of one was then quick, but not free, 50 to 160 ms each with the shader's text read
// again, and all 82 the first floor built after Enter were such second builds, four and a half seconds of its loading
// screen (tools/webbench.py --keep). Now a program Godot asks to link, whose two shaders' text is one of the list's, is
// answered with the one built here: Godot's own program object stands for it in every call from then on (PROGRAM_CALLS),
// its shaders are never compiled, and nothing is waited on unless the one asked for is still being built. More than one
// of Godot's may stand for the same one, as when a floor's shaders are made again after the last floor's were let go:
// they are the same text, set up the same way.
//
// For that the programs must be the game's own context's, so that context is made here, as the page first asks whether
// WebGL 2 is there, with what Godot asks of it (CONTEXT): Godot's own asking later is given the same one.
// Without the extension a build here would stand the page still as Godot's own does, so nothing is built here then and
// every call goes straight through. ?warm=off for testing, and for tools/shader_list.py: none of this.
//
// The building rests while the engine starts and brings its title up (HOLD): from Godot's asking for its context until
// the game says its title is drawn (window.forgeTitle, main.gd) or a floor is (a test's run with no title), six seconds
// at most. Over OpenGL the browser builds programs on the thread that draws, and the list's 184 took the title from 2.1 s
// after the engine's start to 5 or 6, four seconds of a visitor's wait (2026-11-10, the bench on OpenGL: title up at 10.9
// to 12.1 s with the list, 6.9 to 7.1 without); over Direct3D 11 it cost a fifth of a second. The programs already
// begun finish; any the title itself asks for is begun at its asking, as ever.
(() => {
  if (new URLSearchParams(location.search).get('warm') === 'off') return;
  // The safe graphics mode (web/page.js: for a day after the browser's graphics stopped under the game, or ?safe=on):
  // nothing is built ahead and Godot builds each program as it needs it, as before 2026-11-10.
  try {
    const asked = new URLSearchParams(location.search).get('safe');
    if (asked ? asked !== 'off' : JSON.parse(localStorage.getItem('forge3d-graphics-lost') || '[]').some(e => Date.now() - Date.parse(e.at) < 864e5)) return;
  } catch { /* storage blocked: as ever */ }
  const G = WebGL2RenderingContext.prototype;
  // What Godot asks of its context (platform/web/display_server_web.cpp: emscripten's defaults, no alpha, no antialias,
  // and the picture kept between frames, which its own swapping of them brings with it).
  const CONTEXT = { alpha: false, depth: true, stencil: false, antialias: false, premultipliedAlpha: true,
    preserveDrawingBuffer: true, powerPreference: 'default', failIfMajorPerformanceCaveat: false };
  // Every call that names a program, and where in its arguments: Godot's stands for the one built here in each.
  const PROGRAM_CALLS = ['useProgram', 'getProgramParameter', 'getProgramInfoLog', 'getUniformLocation', 'getUniform',
    'getActiveUniform', 'getActiveAttrib', 'getAttribLocation', 'validateProgram', 'getFragDataLocation',
    'getUniformIndices', 'getActiveUniforms', 'getUniformBlockIndex', 'getActiveUniformBlockParameter',
    'getActiveUniformBlockName', 'uniformBlockBinding', 'getTransformFeedbackVarying'];
  const getContext = HTMLCanvasElement.prototype.getContext;
  const HOLD = 6000;
  let started = false, asked = 0;   // asked: when Godot asked for its context (0: not yet)
  const resting = () => asked > 0 && !window.forgeTitle && !(window.forgeFloor > 0) && performance.now() - asked < HOLD;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (!started && type === 'webgl2') {
      started = true;
      const canvas = document.getElementById('canvas');
      const gl = canvas && getContext.call(canvas, 'webgl2', CONTEXT);
      if (gl) warm(gl).catch(() => { /* no list, or the context lost: Godot builds them as it would */ });
    }
    if (type === 'webgl2' && this.id === 'canvas') {
      HTMLCanvasElement.prototype.getContext = getContext;
      asked = performance.now();
      // (Godot's own asking, answered with the context made above: said aloud if it has come to ask for another kind.)
      for (const k of ['alpha', 'depth', 'stencil', 'antialias', 'premultipliedAlpha', 'preserveDrawingBuffer']) {
        if (attrs && k in attrs && !!attrs[k] !== CONTEXT[k]) console.warn(`shader-warm: Godot asks for a context with ${k} ${attrs[k]}, and was given one made with ${CONTEXT[k]} (web/shader-warm.js CONTEXT)`);
      }
    }
    return getContext.call(this, type, attrs);
  };

  // A shader's text as a short key: its length and two sums over it (the texts are 60 to 130 KB each).
  const keyOf = src => {
    let a = 0x811c9dc5, b = 0x1b873593;
    for (let i = 0; i < src.length; i++) {
      const c = src.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193);
      b = Math.imul(b + c, 0x5bd1e995) ^ (b >>> 13);
    }
    return `${src.length}:${a >>> 0}:${b >>> 0}`;
  };

  // In flight together: three where the browser builds programs on threads of its own (Direct3D, Metal: the rest of the
  // page keeps going meanwhile), one where it builds them on the thread that draws (OpenGL: three queued there stood
  // every frame, and a press under the title, half a second and more). ?warmn=N to try another.
  async function warm(gl) {
    const ext = gl.getExtension('KHR_parallel_shader_compile');
    if (!ext) return;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const card = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '');
    // (A browser drawing in software builds them on the processor that is also drawing every pixel: one at a time there.)
    const SOFTWARE = /swiftshader|basic render|llvmpipe|softpipe|software/i.test(card);
    const AT_ONCE = Number(new URLSearchParams(location.search).get('warmn')) || (/Direct3D|Metal/i.test(card) && !SOFTWARE ? 3 : 1);
    const r = await fetch('forge-godot/shader-warm.json');
    if (!r.ok) return;
    const d = await r.json();
    const text = ids => ids.map(i => d.lines[i]).join('\n');
    // The calls as they stood (a test's own counting of them, tools/webbench.py, is under these and still counts).
    const real = {};
    for (const n of ['createProgram', 'createShader', 'shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'deleteProgram',
      'getShaderParameter', 'getShaderInfoLog', 'transformFeedbackVaryings', 'bindAttribLocation', ...PROGRAM_CALLS]) real[n] = G[n];

    // The list's programs, each by its two shaders' keys; `built` once made (begun: the browser is building it).
    const byPair = new Map(), known = new Set(), order = [];
    const t0 = performance.now();
    const state = window.__forgeWarm = { done: 0, of: d.progs.length, given: 0, own: 0 };
    let next = 0, keyed = 0;
    const begin = e => {
      if (e.built) return e.built;
      const p = real.createProgram.call(gl);
      for (const src of e.srcs ?? e.ids.map(text)) {
        const s = real.createShader.call(gl, src.includes('gl_Position') ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER);
        real.shaderSource.call(gl, s, src);
        real.compileShader.call(gl, s);
        real.attachShader.call(gl, p, s);
        gl.deleteShader(s);   // (goes with its program)
      }
      real.linkProgram.call(gl, p);
      e.srcs = null;
      e.built = p;
      return p;
    };
    // Every program's keys are wanted before Godot's first asking, a few seconds off: read a few at a time between frames.
    const keyThem = () => {
      const until = performance.now() + 6;
      while (keyed < d.progs.length && performance.now() < until) {
        const e = { ids: d.progs[keyed++].s, srcs: null, built: null, ready: false };
        e.srcs = e.ids.map(text);
        const keys = e.srcs.map(keyOf);
        e.srcs = null;   // (made again when it is built: 119 programs' text at once is 30 MB)
        for (const k of keys) known.add(k);
        byPair.set(keys.slice().sort().join('|'), e);
        order.push(e);
      }
      if (keyed < d.progs.length) setTimeout(keyThem, 0);
    };
    keyThem();
    const allKeyed = () => { while (keyed < d.progs.length) { const was = keyed; keyThem(); if (keyed === was) break; } };

    let live = [];
    const step = () => {
      if (gl.isContextLost()) return;
      live = live.filter(e => {
        if (!real.getProgramParameter.call(gl, e.built, ext.COMPLETION_STATUS_KHR)) return true;
        e.ready = true;
        if (++state.done === d.progs.length) console.log(`[warm] ${d.progs.length} shader programs built ahead in ${Math.round(performance.now() - t0)} ms, ${state.given} of them given to the engine so far`);
        return false;
      });
      while (!resting() && live.length < AT_ONCE && next < order.length) {
        const e = order[next++];
        if (e.built) { if (!e.ready) live.push(e); continue; }   // (begun already, for Godot's asking)
        begin(e);
        live.push(e);
      }
      if (live.length || next < d.progs.length) setTimeout(step, AT_ONCE > 1 ? 30 : 8);   // (one at a time: the next as soon as the last is done)
    };
    step();

    // Godot's side. A shader whose text is one of the list's is not compiled as it is made; a program whose two are a
    // pair of the list's is not linked, and stands for the one built here. Any other is compiled and linked as it would
    // have been, at its link.
    G.shaderSource = function (s, src) {
      if (this === gl && s) {
        allKeyed();
        const k = keyOf(src);
        s.__k = known.has(k) ? k : null;
        s.__made = false;
      }
      return real.shaderSource.call(this, s, src);
    };
    G.compileShader = function (s) {
      if (this === gl && s && s.__k) return;   // (at its program's link, if it comes to that)
      if (s) s.__made = true;
      return real.compileShader.call(this, s);
    };
    G.getShaderParameter = function (s, n) {
      if (this === gl && s && s.__k && !s.__made && n === gl.COMPILE_STATUS) return true;
      return real.getShaderParameter.call(this, s, n);
    };
    G.getShaderInfoLog = function (s) {
      if (this === gl && s && s.__k && !s.__made) return '';
      return real.getShaderInfoLog.call(this, s);
    };
    G.attachShader = function (p, s) {
      if (this === gl && p && s) (p.__sh = p.__sh || []).push(s);
      return real.attachShader.call(this, p, s);
    };
    for (const n of ['transformFeedbackVaryings', 'bindAttribLocation']) {
      G[n] = function (p, ...more) {
        if (p) p.__own = true;   // (set before its link, on the program itself: built as Godot's own)
        return real[n].call(this, p, ...more);
      };
    }
    G.linkProgram = function (p) {
      if (this === gl && p) {
        const sh = p.__sh || [];
        const e = !p.__own && sh.length === 2 && sh[0].__k && sh[1].__k ? byPair.get([sh[0].__k, sh[1].__k].sort().join('|')) : null;
        if (e) {
          p.__as = begin(e);
          state.given++;
          return;
        }
        for (const s of sh) if (s.__k && !s.__made) { s.__made = true; real.compileShader.call(this, s); }
        state.own++;
      }
      return real.linkProgram.call(this, p);
    };
    G.deleteProgram = function (p) {
      if (p) p.__as = null;   // (the one built here stays, for the next of Godot's with its text)
      return real.deleteProgram.call(this, p);
    };
    for (const n of PROGRAM_CALLS) {
      G[n] = function (p, ...more) { return real[n].call(this, p && p.__as || p, ...more); };
    }
  }
})();
