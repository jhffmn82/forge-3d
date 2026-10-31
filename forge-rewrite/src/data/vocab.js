// Shared vocabulary from data (consolidation C5, engine-rules-33): the six elements in elements.json order.

import elements from '../../data/elements.json' with { type: 'json' };
import { rowsOf } from './index.js';

const E = rowsOf(elements, 'element');

/** The six elements: fire, water, air, earth, light, shadow. */
export const ELEMENTS = Object.keys(E);
