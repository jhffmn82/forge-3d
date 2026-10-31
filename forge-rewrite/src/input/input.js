// Every device becomes the same named actions (data/bindings.json). Nothing else reads raw keys or pads.

import bindings from '../../data/bindings.json' with { type: 'json' };

const DIRS = { 'move-n': [0, -1], 'move-s': [0, 1], 'move-w': [-1, 0], 'move-e': [1, 0], 'move-nw': [-1, -1], 'move-ne': [1, -1], 'move-sw': [-1, 1], 'move-se': [1, 1] };

/** Action name to a game command, or null for actions the UI handles. */
/** A key's name as the Options window writes it (1.7 keyLabel): Space, Esc, arrows as glyphs, a capital as Shift+ its key (C4, ui-34). */
export function keyLabel(k) {
  return { ' ': 'Space', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[k] ?? (k.startsWith('Digit') ? k.slice(5) : k.startsWith('Numpad') ? 'Numpad ' + k.slice(6) : k.length === 1 ? (k !== k.toLowerCase() ? 'Shift+' + k : k.toUpperCase()) : k);
}

export function commandFor(action) {
  if (DIRS[action]) return { type: 'move', dx: DIRS[action][0], dy: DIRS[action][1] };
  if (action === 'wait') return { type: 'wait' };
  if (action === 'search') return { type: 'search' };
  if (action === 'pickup') return { type: 'pickup' };
  if (action === 'close-door') return { type: 'close-doors' };
  if (action === 'descend' || action === 'ascend') return { type: action };
  return null;
}

// Keys the Options window cannot take away from moving: the arrows and the numpad ("Arrow keys always move").
const FIXED = k => k.startsWith('Arrow') || /^[1-9]$/.test(k) || ['Home', 'End', 'PageUp', 'PageDown'].includes(k);

/**
 * The key table in force: data/bindings.json with the player's choices from Options ({action: [key]}) laid over it.
 * A chosen key belongs to its new action only (it leaves any default action that had it); arrows and numpad stay.
 */
export function keyTable(overrides) {
  if (!overrides) return bindings.keys;
  const claimed = new Set(Object.values(overrides).flat());
  const out = {};
  for (const [action, list] of Object.entries(overrides)) out[action] = [...list, ...(bindings.keys[action] ?? []).filter(k => FIXED(k) && !claimed.has(k))];
  for (const [action, list] of Object.entries(bindings.keys)) if (!out[action]) out[action] = list.filter(k => !claimed.has(k));
  return out;
}

/** Key event to action name. Digits on the main row are the hotbar; numpad digits move. */
export function actionForKey(key, code, overrides = null) {
  // A capital letter is its shifted key only (1.7's Shift+C closes doors while c moves down-right).
  for (const [action, list] of Object.entries(keyTable(overrides))) if (list.some(k => k.length === 1 && k !== k.toLowerCase() && k === key)) return action;
  for (const [action, list] of Object.entries(keyTable(overrides))) {
    for (const k of list) {
      if (k.length === 1 && k !== k.toLowerCase()) continue;
      if (k.startsWith('Digit') || k.startsWith('Numpad') ? code === k : (k.length === 1 ? key.toLowerCase() === k : key === k)) {
        if (/^[0-9]$/.test(k) && !code.startsWith('Numpad')) continue;
        return action;
      }
    }
  }
  return null;
}

/**
 * The key Options stores for a key event (K3, 1.7 keybind.js bindingEventKey): a keypad key keeps its own name
 * (Numpad8, whatever Num Lock says), a top-row digit its code (Digit1, K4), a shifted letter its capital (Shift+C),
 * any other letter lower case.
 */
export function bindingKey(e) {
  const code = e.code ?? '';
  if (/^Numpad(?:[0-9]|Decimal|Add|Subtract|Multiply|Divide|Enter|Equal|Comma)$/.test(code)) return code;
  if (e.location === 3 && /^[0-9]$/.test(e.key)) return 'Numpad' + e.key;
  if (/^Digit[0-9]$/.test(code)) return code;
  if (e.key.length === 1) return e.shiftKey && /^[a-z]$/i.test(e.key) ? e.key.toUpperCase() : e.key.toLowerCase();
  return e.key;
}

const PAD = { a: 0, b: 1, select: 8, start: 9, 'dpad-up': 12, 'dpad-down': 13, 'dpad-left': 14, 'dpad-right': 15 };

/**
 * Starts listening. onAction(name, repeat) gets every action from any device (repeat: the system's key repeat).
 * @param {(action:string, repeat?:boolean)=>void} onAction
 * @param {{gamepad:boolean, keys?:Record<string,string[]>|null, onFrame?:(fn:(now:number)=>void)=>void}} options (keys: the
 *   Options window's choices; onFrame: where the pad polls each frame, the page's clock in play (C15), else its own frames)
 * @returns {{heldMove:()=>string|null}}
 */
export function startInput(onAction, options) {
  // Held move keys, newest last. In play the system's key repeat (half a second before the first repeat on Windows)
  // is not used for walking: the game walks the held direction itself the moment the last step finishes (item 43).
  const keysDown = [];
  window.addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement) return;
    const a = actionForKey(e.key, e.code, options.keys);
    if (!a) return;
    e.preventDefault();
    if (a.startsWith('move') && !keysDown.some(k => k.code === e.code)) keysDown.push({ code: e.code, action: a });
    onAction(a, e.repeat);   // a repeat still steps through windows and the aim cursor; play ignores it for walking
  });
  const lift = code => { const i = keysDown.findIndex(k => k.code === code); if (i >= 0) keysDown.splice(i, 1); };
  window.addEventListener('keyup', e => lift(e.code));
  window.addEventListener('blur', () => { keysDown.length = 0; });

  const held = new Map();
  let padMove = null;   // a held d-pad direction walks on like a held key
  function pollPad(now) {
    padMove = null;
    if (options.gamepad) {
      for (const pad of navigator.getGamepads?.() ?? []) {
        if (!pad || pad.mapping !== 'standard') continue;
        for (const [action, button] of Object.entries(bindings.gamepad)) {
          const down = pad.buttons[PAD[button]]?.pressed;
          const key = pad.index + action;
          if (!down) { held.delete(key); continue; }
          if (action.startsWith('move')) padMove = action;
          if (!held.has(key)) { held.set(key, now); onAction(action); }
        }
      }
    }
  }
  const onFrame = options.onFrame ?? (fn => { const loop = t => { fn(t); requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
  onFrame(pollPad);
  return {
    /** The move a held key asks for now, or null. */
    heldMove: () => keysDown.at(-1)?.action ?? padMove,
  };
}
