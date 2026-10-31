// The natural-rock palettes the painters draw with (consolidation M4, render-03 step 1): the six planes'
// (planes.json presentation.terrainPalette, 1.7 planeterrain.js PT_MAT), the Rot and Violet islands' (biomes.json
// chaos.rockPalettes, 1.7 chaos-preview-render.js), the Caverns' (caverns.rockPalette, 1.7 cavernrender.js
// PT_MAT.cavern) and the Underdark's two cave rocks (underdark.rockPalettes, 1.7 deeprender.js DEEP_ROCK). One object
// per palette, read once, so a painter may tell palettes apart by identity. A fix in data reaches the screen.

import planes from '../../data/planes.json' with { type: 'json' };
import biomes from '../../data/biomes.json' with { type: 'json' };

/** The rock palettes of the planes and the Chaos islands, by name ('fire', 'rot'). */
export const ROCK = {
  ...Object.fromEntries(['light', 'shadow', 'earth', 'fire', 'water', 'air'].map(e => [e, planes.rows['plane-' + e].presentation.terrainPalette])),
  ...biomes.rows.chaos.rockPalettes,
};
/** The Caverns' cave material. */
export const CAVE_ROCK = biomes.rows.caverns.rockPalette;
/** The Underdark's cave rock by region: 1 the spider rock (0, the temple's caves, borrows it), 2 the volcanic rock. */
export const DEEP_ROCK = { 0: biomes.rows.underdark.rockPalettes[1], 1: biomes.rows.underdark.rockPalettes[1], 2: biomes.rows.underdark.rockPalettes[2] };
