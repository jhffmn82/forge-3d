// Colour parsing (consolidation C5, ui-33). Pure: imports nothing. Data writes colours as '#RRGGBB' (or 'RRGGBB');
// Pixi wants numbers, canvas text wants CSS strings. Parse data colours once at load with these.

/** '#RRGGBB', 'RRGGBB', '0xRRGGBB' or a number, as a number; null when it is not a colour. */
export function toNum(c) {
  if (typeof c === 'number') return Number.isFinite(c) ? c >>> 0 : null;
  if (typeof c !== 'string') return null;
  const m = /^(?:#|0x)?([0-9a-f]{6})$/i.exec(c.trim());
  return m ? parseInt(m[1], 16) : null;
}

/** Two [r, g, b] colours mixed, t of the way from a to b (unrounded). */
export const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** A colour's {r, g, b} channels, 0-255. */
export function toRgb(c) {
  const n = toNum(c);
  return n === null ? null : { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
