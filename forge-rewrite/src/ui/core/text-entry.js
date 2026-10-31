// Typing on a canvas: the page's one hidden <input id="text-entry"> is laid over the field while it is edited,
// so phones raise their keyboard and every platform's typing rules apply. The canvas draws what it holds.

/**
 * Starts editing. `rect` is the field in logical stage px; the stage turns it into CSS px.
 * @param {{s:number, ox:number, oy:number}} stage
 * @param {{x:number,y:number,w:number,h:number}} rect
 * @param {string} value
 * @param {{max?:number, onInput:(v:string)=>void, onDone:(v:string)=>void}} o
 */
export function editText(stage, rect, value, o) {
  const el = /** @type {HTMLInputElement|null} */ (document.getElementById('text-entry'));
  if (!el) return () => {};
  const css = { left: stage.ox + rect.x * stage.s, top: stage.oy + rect.y * stage.s, width: rect.w * stage.s, height: rect.h * stage.s };
  Object.assign(el.style, { left: css.left + 'px', top: css.top + 'px', width: css.width + 'px', height: css.height + 'px', fontSize: Math.max(16, css.height * 0.5) + 'px' });
  el.maxLength = o.max ?? 24;
  el.value = value;
  const input = () => o.onInput(el.value);
  const key = e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); el.blur(); } };
  const done = () => { stop(); o.onDone(el.value.trim()); };
  function stop() {
    el.removeEventListener('input', input); el.removeEventListener('keydown', key); el.removeEventListener('blur', done);
    el.style.left = '-9999px';
  }
  el.addEventListener('input', input);
  el.addEventListener('keydown', key);
  el.addEventListener('blur', done);
  el.focus();
  el.setSelectionRange(el.value.length, el.value.length);
  return stop;
}
