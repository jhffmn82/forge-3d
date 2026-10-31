// Icon chips, as 1.7's hotbar draws them (js/presentation/ui/hud.js hotbarIconPresentation @3c8b312): a dark well with a
// rim in the icon's family colour (no glow circle: Justin 10-16): a prayer takes its god's colour, a spell its element's, gear steel,
// rings and amulets violet, food amber. Every icon in a window sits in one (Justin 10-16: "better icon backgrounds than
// a black square"; "I'd like if all the icons matched how they look in the hotbar").

import { Container, Graphics } from '../../../../forge-godot/runtime/pixi.js';
import { CARD } from './widgets.js';
import { icon } from './icons.js';
import gods from '../../../data/gods.json' with { type: 'json' };
import prayers from '../../../data/prayers.json' with { type: 'json' };
import { isRuneArt, isBindRune } from '../../render/runes.js';
import abilities from '../../../data/abilities.json' with { type: 'json' };
import { toNum, tone, elementColour, iconElement } from './colour.js';

/** A spell's element by its icon name, from its abilities.json row (U7, ui-18; ui.json iconElement where a row has none). */
const SPELL_ELEMENT = Object.fromEntries(Object.values(abilities.rows).filter(r => r?.icon && r.element).map(r => [r.icon.replace(/^(ic|pr)-/, ''), r.element]));
const PRAYER_GOD = Object.fromEntries(Object.values(prayers.rows).filter(p => p.icon && p.god).map(p => [p.icon, p.god]));

/** The family colour for an icon name, or null for none. */
export function chipColour(name) {
  if (!name) return null;
  if (name === 'ic-pray') return tone('invokeRim');   // Invoke's sparkle sits on 1.7's violet rim
  // 1.7 hotbarIconPresentation: a sigil's rim is its rune's glow, violet for a bind-rune.
  if (isRuneArt(name)) return tone(isBindRune(name) ? 'bindRim' : 'sigilRim');
  if (PRAYER_GOD[name]) return toNum(gods.rows[PRAYER_GOD[name]].color);
  const key = name.replace(/^(ic|pr)-/, '');
  const el = SPELL_ELEMENT[key] ?? iconElement(key);
  if (el) return elementColour(el, 'glow');
  if (name.startsWith('mote-')) return elementColour(name.slice(5), 'glow');
  if (/^item-(ring|amulet)/.test(name)) return tone('trinket');
  if (/^item-(ration|bread|honeycake|moontart|figs|meat|skewer|graveplum|glowstew|emberpepper|starfruit)/.test(name)) return tone('food');
  if (name.startsWith('item-')) return tone('martial');
  if (name.startsWith('ic-') || name.startsWith('cls-')) return tone('martial');
  return null;
}

/** A size x size chip: the well, the family rim and glow, the icon at 84%. `o.dim` fades it; `o.empty` draws the well only; `o.rim` sets the rim. */
export function chip(name, size, o = {}) {
  // o.rim: gear takes its quality colour (1.7 sheets.js:211, :347 tierCol), grey, white, blue or gold, over the steel.
  const c = new Container(), col = o.rim ?? chipColour(name) ?? 0x6a7280;
  const g = new Graphics().roundRect(0, 0, size, size, 4).fill({ color: CARD, alpha: 0.95 });
  g.roundRect(1, 1, size - 2, size - 2, 4).stroke({ color: col, width: 2, alpha: o.empty ? 0.25 : o.rim !== undefined ? 0.9 : 0.7 });
  c.addChild(g);
  const pic = o.empty ? null : icon(name, Math.round(size * 0.84));
  if (pic) { pic.position.x += Math.round(size * 0.08); pic.position.y += Math.round(size * 0.08); c.addChild(pic); }
  if (o.dim) c.alpha = 0.5;
  return c;
}
