// What a sigil and an amulet show, as 1.7 drew them (js/engine/sigil-adapter.js:24-219, js/equipment/amulets.js:86-240;
// Justin 2026-10-12: "these are epic spells that deserve some effects", "hand crafted, so hard lines are out"). A sigil
// lays a seal in its element under the reader and one piece that says what it does; an amulet its own piece. Each plan is
// a list of calls on the spells' kit (fx-kit.js), timed from the cast's release (RELEASE, 240 ms after the read). Looks
// only: no state, no rolls. Firestorm, Molten Ring and Smoke read as themselves (their bursts and fields), as in 1.7.

import { TRAIL, DAMAGE_COLOUR as DMG_COL, ELEMENT_COLOUR as AFF_COL } from '../data/palette.js';
import { RELEASE } from './spell-fx.js';

const call = (fn, ...args) => ({ fn, args });
// 1.7 SIGIL_HUE: each name is a colour in TRAIL, [palette, place in it].
const HUE = { fire: ['fire', 1], water: ['ice', 1], clear: ['ice', 0], air: ['lightning', 2], wind: ['phys', 0], earth: ['earth', 2], mud: ['earth', 0], light: ['light', 1], sun: ['light', 2],
  shadow: ['dark', 1], dusk: ['dark', 0], magic: ['magic', 1], life: ['heal', 1], bolt: ['lightning', 1] };
export const sigilHue = name => { const [p, i] = HUE[name]; return TRAIL[p].col[i]; };
const at = (late = 0) => RELEASE + late;

/**
 * A sigil's pieces. `at`: the reader's tile when the rune is read; `foes`: the bodies it struck, nearest first (Storm's
 * bolts, Sunburst's glare), or held (Mire); `spots`: where Nature's Bounty set its dishes; `carry`: {from, to} when it
 * carried the reader off (Blinking, Homeward Wind).
 */
export function sigilPlan(id, { at: me, foes = [], spots = [], carry = null, changed = null, read = false }) {
  const calls = [], { x, y } = me;
  const seal = (hue, size, dur = 850, where = me) => calls.push(call('glyph', where.x, where.y, sigilHue(hue), { size, dur, at: at() }));
  // 1.7 sigilCarry: the hero comes apart where it was read, a streak the way it went (two short ones when the way is
  // long), and a bloom setting it down. These start at once; the seal is laid at the far end by the cast.
  const carried = (goneHue, streakHue) => {
    const { from: a, to: b } = carry, far = Math.hypot(b.x - a.x, b.y - a.y), ux = far ? (b.x - a.x) / far : 0, uy = far ? (b.y - a.y) / far : 0;
    calls.push(call('swirl', a.x, a.y, sigilHue(goneHue), 0.8, { dur: 460 }));
    if (far > 0.5) {
      if (far <= 7) calls.push(call('sweep', a.x, a.y, b.x, b.y, sigilHue(streakHue), { dur: 340, width: 0.45 }));
      else calls.push(call('sweep', a.x, a.y, a.x + ux * 3, a.y + uy * 3, sigilHue(streakHue), { dur: 320, width: 0.45 }), call('sweep', b.x - ux * 3, b.y - uy * 3, b.x, b.y, sigilHue(streakHue), { dur: 340, width: 0.45, at: 140 }));
    }
    calls.push(call('flare', b.x, b.y, sigilHue(streakHue), { size: 0.9, dur: 380, at: far > 7 ? 320 : 190 }));
  };
  switch (id) {
    case 'firestorm': calls.push(call('burst', x, y, 'fire', 60, 0.12)); break;
    case 'firestorm2': calls.push(call('burst', x, y, 'fire', 90, 0.14)); break;
    case 'mana': seal('shadow', 1); calls.push(call('rise', x, y, sigilHue('water'), { n: 12, height: 1.5, spread: 0.4, dur: 850, at: at(60) })); break;
    case 'levitate': seal('air', 0.85); calls.push(call('rise', x, y, sigilHue('wind'), { n: 8, height: 1.2, spread: 0.5, dur: 800, at: at() })); break;
    case 'levitate2': seal('air', 1.35); calls.push(call('rise', x, y, sigilHue('wind'), { n: 14, height: 1.9, spread: 0.65, dur: 950, at: at() })); break;
    case 'stoneskin': seal('earth', 0.85); calls.push(call('shard', x, y, sigilHue('earth'), 1, { n: 7, dur: 750, at: at(80) })); break;
    case 'stoneskin2': seal('earth', 1.35); calls.push(call('shard', x, y, sigilHue('earth'), 1.5, { n: 12, dur: 850, at: at(80) }), call('flare', x, y, sigilHue('light'), { size: 1.1, dur: 420, at: at(300) })); break;
    case 'heal': seal('light', 0.85); calls.push(call('rise', x, y, sigilHue('life'), { n: 10, height: 1.4, dur: 850, at: at() }), call('flare', x, y, sigilHue('light'), { size: 0.9, dur: 420, at: at(220) })); break;
    case 'heal2': seal('light', 1.35); calls.push(call('rise', x, y, sigilHue('life'), { n: 16, height: 2, spread: 0.6, dur: 950, at: at() }), call('flare', x, y, sigilHue('light'), { size: 1.4, dur: 480, at: at(260) })); break;
    case 'vanish': seal('shadow', 0.85); calls.push(call('swirl', x, y, sigilHue('shadow'), 1, { dur: 600, at: at() })); break;
    case 'vanish2': seal('shadow', 1.35); calls.push(call('swirl', x, y, sigilHue('shadow'), 1.6, { dur: 750, at: at() })); break;
    case 'identify':
      seal('water', 0.85); calls.push(call('swirl', x, y, sigilHue('clear'), 1.1, { inward: true, dur: 560, at: at() }), call('flare', x, y, sigilHue('clear'), { size: 0.7, dur: 320, at: at(480) }));
      // E21 (1.7 sigils.js:319 knowPicker): the glint of the chosen piece being read, after the read's own bloom
      if (read) calls.push(call('flare', x, y, TRAIL.ice.col[0], { size: 0.8, dur: 340, at: at(820) }));
      break;
    case 'identify2': seal('water', 1.35); calls.push(call('swirl', x, y, sigilHue('clear'), 1.6, { inward: true, dur: 700, at: at() }), call('flare', x, y, sigilHue('clear'), { size: 1.1, dur: 380, at: at(620) })); break;
    case 'mapping': seal('light', 1, 550); calls.push(call('ripple', x, y, sigilHue('sun'), 8, { rings: 1, dur: 900, at: at(300) })); break;
    case 'haste': seal('air', 1, 700); calls.push(call('swirl', x, y, sigilHue('wind'), 1.1, { dur: 450, at: at() })); break;
    case 'cinder': seal('fire', 1, 700); calls.push(call('rise', x, y, sigilHue('fire'), { n: 10, height: 0.9, spread: 0.45, dur: 650, at: at() })); break;
    case 'rot':
      seal('shadow', 1, 600);
      // E21 (1.7 sigils.js:340-342 rotPicker): the piece comes apart into shadow that winds away, and a foul breath lifts off
      if (changed === 'destroy') calls.push(call('burst', x, y, 'dark', 40, 0.08), call('swirl', x, y, TRAIL.dark.col[1], 1.1, { dur: 650, at: at() }), call('rise', x, y, TRAIL.poison.col[1], { n: 6, height: 0.9, spread: 0.35, dur: 850, at: at(120) }));
      break;
    case 'ascension':
      seal('light', 1.5, 600);
      // E21 (1.7 sigils.js:227-228 sigilUpgradePicker): light climbing off the floor through the hero, and a bloom on the body
      if (changed === 'upgrade') calls.push(call('rise', x, y, TRAIL.light.col[2], { n: 12, height: 1.8, spread: 0.5, dur: 900, at: at() }), call('flare', x, y, TRAIL.light.col[1], { size: 1, dur: 420, at: at(250) }));
      break;
    case 'transmutation':
      // E21 (1.7 sigils.js:192-197): a grand seal, the thing drawn in on itself, and a bloom as it comes back as something else
      if (changed === 'transmute') calls.push(call('sparkle', x, y, 'magic', 30), call('glyph', x, y, TRAIL.magic.col[1], { size: 1.5, dur: 900, at: at() }), call('swirl', x, y, TRAIL.magic.col[1], 1.3, { inward: true, dur: 520, at: at() }), call('flare', x, y, TRAIL.magic.col[0], { size: 1.1, dur: 380, at: at(460) }));
      break;
    case 'wisdom': seal('magic', 1.5, 950); calls.push(call('rise', x, y, sigilHue('sun'), { n: 16, height: 2.3, spread: 0.6, dur: 1000, at: at(80) })); break;
    case 'aegis': seal('light', 1.35); calls.push(call('swirl', x, y, sigilHue('sun'), 1, { inward: true, dur: 600, at: at() }), call('shard', x, y, sigilHue('earth'), 1, { n: 5, dur: 700, at: at(380) })); break;
    case 'purify': seal('light', 1); calls.push(call('ripple', x, y, sigilHue('water'), 1.6, { rings: 1, dur: 650, at: at(60) }), call('rise', x, y, sigilHue('clear'), { n: 6, height: 1.3, spread: 0.4, dur: 800, at: at(200) })); break;
    case 'mire':
      seal('water', 1, 600);
      calls.push(call('splash', x, y, sigilHue('mud'), 3, { dur: 850, at: at(200) }));
      for (const f of foes) calls.push(call('burst', f.x, f.y, 'earth', 8, 0.04));
      break;
    case 'storm':
      seal('water', 1);
      // 1.7 sigilBolt: a soft bolt out of the air onto each body struck, one after another, never from the same height or side
      foes.slice(0, 3).forEach((f, nth) => {
        const when = at(nth * 150), lean = nth % 2 ? 0.6 : -0.45, high = 3.3 + 0.4 * ((nth * 2) % 3);
        calls.push(call('sweep', f.x + lean, f.y - high, f.x, f.y, sigilHue('bolt'), { dur: 280, width: 0.34, at: when }), call('flare', f.x, f.y, sigilHue('bolt'), { size: 0.8, dur: 300, at: when + 140 }));
      });
      break;
    case 'sunburst':
      seal('sun', 1.3, 550);
      calls.push(call('flare', x, y, sigilHue('sun'), { size: 3, dur: 520, at: at() }), call('ripple', x, y, sigilHue('light'), 4.2, { rings: 1, dur: 700, at: at(160) }), call('light', x, y, sigilHue('light'), { r: 9, s: 0.9, flash: 800 }));
      foes.slice(0, 6).forEach(f => calls.push(call('flare', f.x, f.y, sigilHue('light'), { size: 0.7, dur: 300, at: at(160 + Math.min(6, Math.hypot(f.x - x, f.y - y)) * 70) })));
      break;
    case 'naturesbounty':
      // each dish grows up out of its tile, one after another and none the same size
      spots.slice(0, 3).forEach((s, i) => calls.push(call('sparkle', s.x, s.y, 'heal', 12), call('rise', s.x, s.y, sigilHue('life'), { n: 5 + i, height: 0.8 + 0.15 * i, spread: 0.3, dur: 700, at: at(120 + i * 120) })));
      seal('life', 1.2);
      break;
    case 'blink':
      if (!carry) break;
      calls.push(call('sparkle', carry.from.x, carry.from.y, 'magic', 20), call('sparkle', carry.to.x, carry.to.y, 'magic', 20));
      carried('shadow', 'dusk'); seal('shadow', 1, 850, carry.to);
      break;
    case 'recall':
      if (!carry) break;
      calls.push(call('sparkle', carry.from.x, carry.from.y, 'lightning', 20), call('sparkle', carry.to.x, carry.to.y, 'lightning', 20));
      carried('wind', 'wind'); seal('light', 1, 850, carry.to);
      break;
    default: break;   // magma, smoke: their own fields and choosers say it
  }
  return { calls };
}

/**
 * An amulet's pieces (1.7 amulets.js:86-110, :160-166, :181-189, :229-232). `at`: the wearer's tile as it is used;
 * `swap` {from, to}: where the wearer stood and now stands; `radius`: Seeking's reach. The Hook throws a grappling hook
 * of its own (map-words.js grapple, item 262).
 */
export function amuletPlan(kind, { at: me, swap = null, radius = 16 }) {
  const calls = [], { x, y } = me, magic = TRAIL.magic.col;
  if (kind === 'stillness') {
    // the moment drawn in and held: pale motes spiral into the wearer, and a dial of soft strokes opens under the feet
    calls.push(call('sparkle', x, y, 'ice', 12), call('swirl', x, y, DMG_COL.ice, 1.2, { inward: true, dur: 620, at: at() }), call('glyph', x, y, TRAIL.ice.col[0], { size: 1.05, dur: 780, at: at(120) }));
  } else if (kind === 'echo') {
    // the same thing again, wider and fainter: two soft blooms, one after the other (the sigil's own pieces follow)
    calls.push(call('flare', x, y, magic[1], { size: 0.55, dur: 300, at: at() }), call('flare', x, y, magic[2], { size: 0.9, dur: 420, at: at(140) }));
  } else if (kind === 'plenty') {
    calls.push(call('sparkle', x, y, 'light', 8), call('rise', x, y, TRAIL.light.col[2], { n: 7, height: 0.9, spread: 0.4, dur: 700, at: at() }));
  } else if (kind === 'thorns') {
    calls.push(call('sparkle', x, y, 'earth', 12), call('shard', x, y, AFF_COL.earth, 1.0, { n: 12, dur: 850, at: at() }), call('flare', x, y, TRAIL.poison.col[0], { size: 0.85, dur: 420, at: at(140) }));
  } else if (kind === 'seeking') {
    calls.push(call('ripple', x, y, DMG_COL.ice, Math.max(4, radius * 0.47), { rings: 1, dur: 900, at: at() }), call('flare', x, y, TRAIL.ice.col[0], { size: 0.8, dur: 360, at: at() }));
  } else if (kind === 'swap' && swap) {
    // the two pass each other: a soft streak each way, side by side, and a bloom where each lands
    const { from: a, to: b } = swap, dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, ox = -dy / len * 0.14, oy = dx / len * 0.14;
    calls.push(call('sparkle', a.x, a.y, 'magic', 16), call('sparkle', b.x, b.y, 'magic', 16),
      call('sweep', a.x + ox, a.y + oy, b.x + ox, b.y + oy, magic[1], { dur: 460, width: 0.4 }), call('sweep', b.x - ox, b.y - oy, a.x - ox, a.y - oy, magic[2], { dur: 460, width: 0.4 }),
      call('flare', b.x, b.y, magic[1], { size: 0.7, dur: 320, at: RELEASE }), call('flare', a.x, a.y, magic[2], { size: 0.7, dur: 320, at: RELEASE }));
  }
  return { calls };
}
