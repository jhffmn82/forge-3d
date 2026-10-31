// The relief light's kinds over cave-style rock (the Caverns, the Underdark caves, the planes and the Chaos islands):
// one rule for how far up its face a rock sample stands, read off the outline the picture draws (item 211, Justin
// 2026-10-19: "need to smooth out the jagged edges here": a cliff's lip, where its lit face meets the dark top above,
// ran in the kinds grid's steps). Pure.

/**
 * How far straight down from sample (gu, gv) the rock's outline is, in tiles (Infinity past `reach`): the first open
 * sample below in its column, then the crossing between that sample and the rock above it, found on the outline
 * itself (`rockAt`, halved six times), so a face's lip lies as smoothly as the drawn outline, not on the sample grid.
 * Each crossing is worked out once; a column's run of rock shares it.
 * @param {number} KS samples a tile @param {(gu:number, gv:number) => boolean} solid the sample grid's rock
 * @param {(x:number, y:number) => boolean} rockAt the outline at any point, in tiles @param {number} reach tiles
 */
export function outlineBelow(KS, solid, rockAt, reach) {
  const crossings = new Map(), n = Math.ceil(reach * KS);
  return (gu, gv) => {
    for (let d = 1; d <= n; d++) {
      if (solid(gu, gv + d)) continue;
      const key = `${gu},${gv + d}`;
      let y = crossings.get(key);
      if (y === undefined) {
        const x = (gu + 0.5) / KS;
        let lo = (gv + d - 0.5) / KS, hi = (gv + d + 0.5) / KS;   // rock at lo, open ground at hi
        for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; if (rockAt(x, m)) lo = m; else hi = m; }
        crossings.set(key, y = (lo + hi) / 2);
      }
      const dist = y - (gv + 0.5) / KS;
      return dist <= reach ? dist : Infinity;
    }
    return Infinity;
  };
}

/**
 * A rock sample's kind and G for the kinds texture: a face within `face` tiles above its outline, else a top; G is the
 * distance over two faces (0.5 at the lip, 1 far above), which the ground shader reads between texels (ground-glsl.js
 * fineUp) to draw the lip as a line, and twice which is the face's height in faces.
 */
export const rockKind = (dist, face) => ({ k: dist < face ? 2 : 3, up: Math.max(1, Math.round(255 * Math.min(1, dist / (2 * face)))) });
