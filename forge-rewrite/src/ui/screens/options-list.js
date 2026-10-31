// Every option the Options window offers: 1.7's list (js/presentation/ui/options.js:191-218 @3c8b312) under the
// 10-15 rulings: no Classic layout (ruling 8), Obsidian only (7), a low-power switch (5) and a gamepad switch (6).
// Moves to data/options.json if the coordinator wants it there (UI-HOOKS.md section 4).

/** @typedef {{key:string, label:string, choices:[any,string][], def:any, touchDef?:any, read?:(v:any)=>any, hint?:string, phoneHint?:string, phoneLabel?:string}} Option */
// W40 (1.7 settingsHTML, options.js:198-213): `hint` is 1.7's note under the row, shown here as the row's card on hover
// or tap (window rules); `phoneHint` and `phoneLabel` only on a touch phone (its short side under 600 CSS px).

/** True on a touch phone, as 1.7's settingsHTML `phone`. */
export const isPhone = st => (st?.form ?? formOf(st)) === 'phone';

import { formOf } from '../core/stage.js';

const onOff = [[true, 'On'], [false, 'Off']];

/** @type {{name:string, options:Option[]}[]} */
export const SECTIONS = [
  { name: 'Interface', options: [
    // The pad's three rows together (1.7's Interface section). Unset 'pad' is on for tablets, off for phones (Justin 10-16:
    // "3 no off"); the HUD applies the same rule.
    { key: 'pad', label: 'Movement pad', choices: onOff, def: false, byStage: st => (st.form ?? formOf(st)) === 'tablet',
      phoneHint: 'With the pad off, Search stays available beside the hotbar.' },
    { key: 'padSide', label: 'Pad position', choices: [['left', 'Left'], ['right', 'Right']], def: 'left' },
    { key: 'padSize', label: 'Pad size', choices: [['compact', 'Compact'], ['normal', 'Normal'], ['large', 'Large']], def: 'normal' },
    { key: 'textSize', label: 'Text size', choices: [['small', 'Small'], ['standard', 'Standard'], ['large', 'Large']], def: 'standard' },
    { key: 'statusSize', label: 'Status size', choices: [['compact', 'Compact'], ['normal', 'Normal'], ['large', 'Large']], def: 'normal' },
    { key: 'statusSide', label: 'Status position', choices: [['left', 'Left'], ['right', 'Right']], def: 'left', phoneHint: 'Portrait keeps status on the left. Landscape uses your chosen side.' },
  ] },
  { name: 'Map', options: [
    { key: 'zoom', label: 'Map zoom', choices: [['far', 'Far'], ['normal', 'Normal'], ['close', 'Close'], ['closest', 'Closest']], def: 'normal', touchDef: 'close' },
    { key: 'contrast', label: 'High contrast', choices: onOff, def: false, touchDef: true, hint: 'Brightens characters and ground items. On by default on mobile.' },
    // Relief by default, no automatic fallback (Justin 10-16); a save from before the choice holds true, read as Relief.
    { key: 'lighting', label: 'Lighting', choices: [['relief', 'Relief'], ['classic', 'Classic'], [false, 'Off']], def: 'relief', read: v => (v === true ? 'relief' : v) },
    { key: 'mapArt', label: 'Map art', choices: [['sprites', 'Sprites'], ['blocks', 'Blocks']], def: 'sprites' },
    { key: 'motion', label: 'Ambient motion', choices: [['auto', 'Auto'], [true, 'On'], [false, 'Off']], def: 'auto', hint: 'Sway, flicker and bobbing. Auto follows your device motion preference.' },
    { key: 'animSpeed', label: 'Animation speed', choices: [[1, '1×'], [1.5, '1.5×'], [2, '2×'], [3, '3×']], def: 1 },
  ] },
  { name: 'Controls', options: [
    // 1.7 options.js:97: a touch phone (its short side under 600 CSS px) starts Vertical, so held sideways the bar is the
    // 2 x 4 rail down the edge; upright it is always the bar along the bottom (hud.js).
    { key: 'hotbar', label: 'Hotbar layout', choices: [['vertical', 'Vertical'], ['horizontal', 'Horizontal']], def: 'horizontal', byStage: st => (isPhone(st) ? 'vertical' : 'horizontal'),
      phoneLabel: 'Landscape hotbar', phoneHint: 'Portrait uses two rows. Landscape uses your chosen layout.' },
    { key: 'gamepad', label: 'Gamepad', choices: onOff, def: true },
    { key: 'lowPower', label: 'Low power', choices: onOff, def: false },
  ] },
  { name: 'Audio', options: [
    { key: 'sound', label: 'Sound', choices: onOff, def: true },
    { key: 'music', label: 'Music', choices: onOff, def: true },
    // CSS-32: the volumes are 1.7's sliders, 0 to 100 (the choices stay as the marks a default and a test read).
    { key: 'sfxVolume', label: 'Effects volume', choices: [[0, '0'], [25, '25'], [50, '50'], [75, '75'], [100, '100']], def: 50, slider: true },
    { key: 'musicVolume', label: 'Music volume', choices: [[0, '0'], [25, '25'], [50, '50'], [75, '75'], [100, '100']], def: 50, slider: true },
  ] },
];

/** Names for the bound actions, in 1.7's order. */
export const ACTION_NAMES = [
  ['move-n', 'Move up'], ['move-s', 'Move down'], ['move-w', 'Move left'], ['move-e', 'Move right'],
  ['move-nw', 'Up-left'], ['move-ne', 'Up-right'], ['move-sw', 'Down-left'], ['move-se', 'Down-right'],
  ['wait', 'Wait a turn'], ['rest', 'Rest'], ['search', 'Search'], ['explore', 'Explore'], ['pickup', 'Pick up'],
  ['descend', 'Go down'], ['ascend', 'Go up'], ['close-door', 'Close a door'],
  // W17 (1.7 keybind.js BIND_ACTIONS): the eight hotbar keys rebind like the rest.
  ...Array.from({ length: 8 }, (_, i) => [`hotbar-${i + 1}`, `Hotbar ${i + 1}`]),
  ['character', 'Character'], ['inventory', 'Inventory'], ['faith', 'Faith'], ['map', 'Map'],
  ['mute', 'Sound on/off'], ['music', 'Music on/off'], ['close', 'Close'],
];

/** The value an option starts at on this device. */
export const defaultOf = (o, touch, stage) => (o.byStage && stage ? o.byStage(stage) : touch && 'touchDef' in o ? o.touchDef : o.def);
const BY_KEY = Object.fromEntries(SECTIONS.flatMap(s => s.options).map(o => [o.key, o]));
/** U5 (ui-20): an option's value, its default when it is unset, so no caller re-derives the pad or hotbar default. */
export function optionOf(store, key, stage) {
  const v = store?.get?.(key), o = BY_KEY[key];
  return v !== undefined && v !== null ? (o?.read ? o.read(v) : v) : o ? defaultOf(o, !!stage?.touch, stage) : v;
}
