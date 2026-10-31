// Item 177 (Justin 2026-10-19: "let's do the z's but use the Z we already use for sleep for enemies"): while a hold on the
// hero's own tile builds toward Rest (item 79), the sleepers' 'z' (render/status-badges.js markText) rises over the hero,
// one more for each third of the hold, from the spot a sleeper's sits; as the rest begins they drift up and fade. Motion
// Off sets each in place and fades it there, with no climb. Replaces the gold ring.

import { Container } from '../../../../forge-godot/runtime/pixi.js';
import { markText } from '../core/art.js';

const ease = t => 1 - (1 - t) * (1 - t);

/** @param {ReturnType<import('../core/widgets.js').createKit>} kit */
export function buildRestZ(kit) {
  const root = new Container();
  root.label = 'rest-z';
  root.eventMode = 'none';
  root.visible = false;
  let made = '';
  return {
    root,
    /**
     * k: the hold's share, 0 to 1; fade: 1 while held, down to 0 over the rest's first moment; h: the hero in this layer's px,
     * { x, y: the foot of the tile it is drawn on, tile }; res: the text resolution.
     */
    draw(k, fade, h, res) {
      const T = h.tile;
      if (made !== `${T},${res}`) { root.removeChildren().forEach(c => c.destroy()); for (let i = 0; i < 3; i++) root.addChild(markText(T, res)); made = `${T},${res}`; }
      root.children.forEach((z, i) => {
        const a = Math.max(0, Math.min(1, k * 3 - i)), climb = kit.reduced ? 0 : (1 - ease(a)) * T * 0.12 - (1 - fade) * T * 0.2;
        z.scale.set(1 + i * 0.18);
        z.position.set(h.x + T * (0.28 + i * 0.16), h.y - T * (0.92 + i * 0.26) + climb);   // the first where a sleeper's sits
        z.alpha = a * fade;
      });
      root.visible = true;
    },
    clear() { root.visible = false; },
  };
}
