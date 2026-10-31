// The browser build's shaders, built ahead in the background (export_presets.cfg head include, before page.js).
//
// Godot builds each shader program as it first needs it and waits for it there, on the page's one thread: over
// Direct3D 11 (Edge and Chrome on Windows, Justin's laptop) a lit program takes one to two and a half seconds, and the
// first floor needs some 200 programs, which stood the page still for most of a minute after Enter (2026-10-30, the
// bench on d3d11). The browser keeps every program it has built, by its sources: one built again is ready at once.
// So, as Godot makes its 3D context, this builds the programs the floors are known to need (forge-godot/shader-warm.json,
// made by tools/shader_list.py from a run of this build) on that context, several at a time and without waiting on any
// (KHR_parallel_shader_compile: the browser builds them on its own threads), and lets each go as it finishes. When Godot
// asks for one, it is there. Without that extension a build here would stand the page still as Godot's own does, so
// nothing is built here then. ?warm=off for testing: none.
(() => {
  if (new URLSearchParams(location.search).get('warm') === 'off') return;
  const G = WebGL2RenderingContext.prototype;
  const gl_ = { create: G.createProgram, shader: G.createShader, source: G.shaderSource, compile: G.compileShader,
    attach: G.attachShader, link: G.linkProgram, param: G.getProgramParameter, del: G.deleteProgram, delShader: G.deleteShader };
  const getContext = HTMLCanvasElement.prototype.getContext;
  let started = false;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    const ctx = getContext.call(this, type, attrs);
    if (!started && ctx && type === 'webgl2') {
      started = true;
      HTMLCanvasElement.prototype.getContext = getContext;
      warm(ctx).catch(() => { /* no list, or the context lost: Godot builds them as it would */ });
    }
    return ctx;
  };
  const AT_ONCE = 3;   // in flight together: the rest of the machine (and the game's loading) keeps going meanwhile
  async function warm(gl) {
    const ext = gl.getExtension('KHR_parallel_shader_compile');
    if (!ext) return;
    const r = await fetch('forge-godot/shader-warm.json');
    if (!r.ok) return;
    const d = await r.json();
    const text = ids => ids.map(i => d.lines[i]).join('\n');
    let next = 0, live = [];
    const t0 = performance.now();
    window.__forgeWarm = { done: 0, of: d.progs.length };
    const step = () => {
      if (gl.isContextLost()) return;
      live = live.filter(p => {
        if (!gl_.param.call(gl, p, ext.COMPLETION_STATUS_KHR)) return true;
        gl_.param.call(gl, p, gl.LINK_STATUS);   // (read, as Godot reads it: the browser keeps it only then)
        gl_.del.call(gl, p);
        if (++window.__forgeWarm.done === d.progs.length) console.log(`[warm] ${d.progs.length} shader programs built ahead in ${Math.round(performance.now() - t0)} ms`);
        return false;
      });
      while (live.length < AT_ONCE && next < d.progs.length) {
        const prog = d.progs[next++], p = gl_.create.call(gl);
        for (const ids of prog.s) {
          const src = text(ids), s = gl_.shader.call(gl, src.includes('gl_Position') ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER);
          gl_.source.call(gl, s, src);
          gl_.compile.call(gl, s);
          gl_.attach.call(gl, p, s);
          gl_.delShader.call(gl, s);   // (goes with its program)
        }
        gl_.link.call(gl, p);
        live.push(p);
      }
      if (live.length) setTimeout(step, 30);
    };
    step();
  }
})();
