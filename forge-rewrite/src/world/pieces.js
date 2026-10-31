// Multi-tile pieces, one schema for every builder (consolidation W7, world-06): the head on the piece's top-left tile
// carries w and h; each other covered tile is a prop of the same id with part: {x, y} pointing at the head (and, where
// the piece blocks, blocks: true). The size comes from props.json footprint unless the caller gives one.

import props from '../../data/props.json' with { type: 'json' };

const P = props.rows;

/** The piece's footprint {w, h} (props.json footprint, else 1 x 1). */
export const footprint = id => P[id]?.footprint ?? { w: 1, h: 1 };

/**
 * Puts a piece down: the head {id, x, y, w, h, ...head} and a part on every other tile {id, x, y, part, ...part}.
 * o.w, o.h override the footprint; o.head, o.part are the fields each carries; o.blocks: the parts block always (true),
 * never (false) or as the props row says (undefined). Returns the head.
 */
export function placePiece(floor, id, x, y, o = {}) {
  const fp = footprint(id), w = o.w ?? fp.w, h = o.h ?? fp.h;
  const head = { id, x, y, ...(o.headFirst ?? {}), ...(w > 1 || h > 1 ? { w, h } : {}), ...(o.head ?? {}) };
  floor.props.push(head);
  const blocks = o.blocks ?? !!P[id]?.blocks;
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
    if (xx === x && yy === y) continue;
    floor.props.push({ id, x: xx, y: yy, part: { x, y }, ...(o.part ?? {}), ...(o.keepParts !== false ? { keep: head.keep } : {}), ...(blocks ? { blocks: true } : {}) });
  }
  return head;
}

/** The piece a prop is a cell of, from its head or any part: the head and every part (a one-tile prop alone). A piece
 *  leaves the floor whole: a part left without its head blocks and nothing draws it (item 168). */
export const piecesOf = (floor, p) => {
  const at = p.part ?? p;
  return floor.props.filter(q => q === p || (q.id === p.id && (q.part ? q.part.x === at.x && q.part.y === at.y : !!p.part && q.x === at.x && q.y === at.y)));
};
