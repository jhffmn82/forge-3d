// Feature 136 (Justin 2026-10-17: "some sort of glow or pulse animation colored the same as the sigils in the inventory
// slot or hotbar slot to make the casting of a sigil visually distinct ... maybe even a popup like a mousehover where
// the sigil was stating that you cast blink"). A soft glow that swells from a slot and fades, no hard ring edge (the
// flat Lantern look; effects: fluid, no hard lines), and a small card in the hover card's style. The HUD can pulse a
// hotbar slot with the same pulseAt.

import { Container, Graphics, Ticker } from '../../../../forge-godot/runtime/pixi.js';
import { isBindRune, RUNE_GLOW } from '../../render/runes.js';
import { toNum } from './colour.js';
import { cardFrame } from './cards.js';
import { animate } from './anim.js';

/** A sigil's glow: the colour its rune is drawn in (render/runes.js), blue for a rune, violet for a bind-rune. */
export const SIGIL_GLOW = { rune: toNum(RUNE_GLOW.rune), bind: toNum(RUNE_GLOW.bind) };
export const sigilGlow = iconName => (isBindRune(iconName) ? SIGIL_GLOW.bind : SIGIL_GLOW.rune);

/** The cast card's words: "You cast Blink" ("Sigil of Blink" loses its "Sigil of"). */
export const castWords = name => `You cast ${String(name).replace(/^Sigil of (the )?/i, '')}`;

/**
 * The pulse at time t (0..1): it swells out from the slot to 1.6x over the first third and fades to nothing, so the
 * glow reads as light leaving the slot, never a ring.
 */
export function pulseCurve(t) {
  const u = Math.min(1, Math.max(0, t));
  return { spread: 1 + 0.6 * Math.sin(Math.min(1, u * 1.5) * Math.PI / 2), alpha: u < 0.2 ? u / 0.2 : Math.pow(1 - (u - 0.2) / 0.8, 1.6) };
}

/**
 * The slot's own border lit in `colour`, its glow growing out from that border and fading, over `ms` (Justin's
 * reference, item136-justin-sigil-slot.png: the slot's rim lit in the rune's pale blue). `rect` ({x, y, w, h}) is the
 * slot in `layer`'s space. The halo is ten soft strokes stepping outward, each fainter, blended additively: light with
 * no edge, nothing drawn over the slot's face. Returns the node.
 */
export function pulseAt(layer, rect, colour, ms = 600, ticker = Ticker.shared) {
  const node = new Container(), hw = rect.w / 2, hh = rect.h / 2, R = 5;
  const rim = new Graphics().roundRect(-hw + 1, -hh + 1, rect.w - 2, rect.h - 2, R).stroke({ color: colour, width: 2 });
  const halo = new Graphics();
  for (let k = 1; k <= 10; k++) { const o = k * 1.8; halo.roundRect(-hw - o, -hh - o, rect.w + o * 2, rect.h + o * 2, R + o).stroke({ color: colour, width: 2.4, alpha: 0.22 * Math.pow(1 - k / 11, 1.5) }); }
  halo.blendMode = 'add'; rim.blendMode = 'add';
  node.addChild(halo, rim); node.position.set(rect.x + hw, rect.y + hh); node.eventMode = 'none'; node.label = 'cast-pulse';
  layer.addChild(node);
  // The halo swells out from the rim; the rim itself stays on the slot's edge and fades with it.
  animate(ms, t => { const p = pulseCurve(t); halo.scale.set(1 + (p.spread - 1) * 0.35); node.alpha = p.alpha; }, { done: () => node.destroy({ children: true }), ticker });
  return node;
}

/**
 * The cast card: the hover card's look (near-black, a soft shadow) holding "You cast Blink", at the slot (below it, or
 * above when the screen ends), gone after `ms` or on the next press or key. `stageW`/`stageH` bound it.
 */
export function castCard(kit, layer, rect, words, stageW, stageH, ms = 1500, ticker = Ticker.shared) {
  const pad = 10, t = kit.text(words, { size: 16, font: 'display', fill: kit.accent });
  const w = t.width + pad * 2, h = t.height + pad * 2, card = new Container();
  card.addChild(cardFrame(w, h, { radius: 4, alpha: 0.96 }), t);
  t.position.set(pad, pad);
  let x = rect.x + rect.w / 2 - w / 2, y = rect.y + rect.h + 6;
  if (y + h > stageH - 4) y = rect.y - h - 6;
  card.position.set(Math.round(Math.max(4, Math.min(stageW - w - 4, x))), Math.round(Math.max(4, y)));
  card.eventMode = 'none'; card.label = 'cast-card';
  layer.addChild(card);
  let gone = false, stop = null;
  const end = () => {
    if (gone) return; gone = true;
    stop?.();
    if (typeof removeEventListener === 'function') { removeEventListener('pointerdown', end, true); removeEventListener('keydown', end, true); }
    card.destroy({ children: true });
  };
  stop = animate(ms, t => { const age = t * ms; if (age > ms - 250) card.alpha = Math.max(0, (ms - age) / 250); }, { done: end, ticker });
  // The next press or key puts it away (after this one: the listener is added once the press that cast it is done).
  if (typeof addEventListener === 'function') setTimeout(() => { if (!gone) { addEventListener('pointerdown', end, true); addEventListener('keydown', end, true); } }, 0);
  return card;
}
