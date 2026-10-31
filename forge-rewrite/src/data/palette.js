// Colour roles from data (consolidation C5; render-11, ui-17). Each role reads its one data source, so render and UI
// stop keeping copies: an element's affinity colour (elements.json), a damage type's number colour (ui.json
// damageColours), a god's colour (gods.json) and an element's spark trail (elements.json trail).

import elements from '../../data/elements.json' with { type: 'json' };
import ui from '../../data/ui.json' with { type: 'json' };
import gods from '../../data/gods.json' with { type: 'json' };
import planes from '../../data/planes.json' with { type: 'json' };
import { rowsOf } from './index.js';

const E = rowsOf(elements, 'element');

/** Element affinity colours ('#E2622B' for fire). */
export const ELEMENT_COLOUR = Object.fromEntries(Object.entries(E).map(([k, r]) => [k, r.colour]));
/** Damage number colours by damage type, plus heal, miss, web, blood and xp. */
export const DAMAGE_COLOUR = Object.fromEntries(Object.entries(ui.damageColours).filter(([k]) => k !== 'src'));
/** Each god's colour. */
export const GOD_COLOUR = Object.fromEntries(Object.entries(gods.rows).map(([k, r]) => [k, r.color]));
/** The spark trails by kind (1.7 fx.js:25-36): colours, size, rate, life and drift; glow lights the head. */
export const TRAIL = Object.fromEntries(Object.entries(ui.effectTrails).filter(([k]) => k !== 'src'));
/** Each plane's portal colour (planes.json portalColour; 1.7 portals.js PLANE_COLORS). */
export const PORTAL_COLOUR = Object.fromEntries(['light', 'shadow', 'earth', 'fire', 'water', 'air'].map(e => [e, planes.rows['plane-' + e].portalColour]));
/** An element's spark trail kind (1.7 combat.js:177 TRAIL_EL). */
export const ELEMENT_TRAIL = Object.fromEntries(Object.entries(E).map(([k, r]) => [k, r.trail]));
