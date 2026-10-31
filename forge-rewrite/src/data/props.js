// Prop predicates (consolidation C5; engine-rules-18, world-05): one reading of props.json's flags for every layer.
// A prop on the floor is {id, x, y} plus its own flags (blocks, set by the Realm's scenery); its row gives the rest.

import props from '../../data/props.json' with { type: 'json' };

const rowOf = p => props.rows[p?.id] ?? {};
/** Every prop on (x, y). */
export const propsAt = (floor, x, y) => (floor.props ?? []).filter(p => p.x === x && p.y === y);
/** A prop that stops a step: its own blocks flag or its row's (isWall's rule). */
export const propBlocks = p => !!(p?.blocks || rowOf(p).blocks);
/** A prop that stops a step and cannot be broken through (route planning that may not count on smashing it). */
export const propSolid = p => propBlocks(p) && !rowOf(p).breakable;
/** A web curtain: open to a spider's route, cut by fire (biomes.json underdark curtains). */
export const propCurtain = p => !!rowOf(p).curtain;
