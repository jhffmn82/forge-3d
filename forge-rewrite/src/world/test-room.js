// The skeleton's test room, until world generation (packet G) and real monsters (packet F) land.
// Looks and sounds are 1.7's (js/content/data.js art and sfx fields). Numbers are 1.7's: the Dungeon Rat and the Goblin
// (js/content/data.js:914, :918). The hero is built from packet A's data (src/rules/hero.js).

import { T } from '../data/tiles.js';

export function testFloor() {
  const w = 24, h = 16, tiles = new Array(w * h).fill(T.WALL);
  for (let y = 2; y < 13; y++) for (let x = 2; x < 16; x++) tiles[y * w + x] = T.FLOOR;
  for (let x = 16; x < 22; x++) tiles[7 * w + x] = T.FLOOR;
  for (let y = 4; y < 11; y++) for (let x = 18; x < 22; x++) tiles[y * w + x] = T.FLOOR;
  tiles[6 * w + 8] = T.WALL; tiles[6 * w + 9] = T.WALL;
  // Two wall torches on the north wall (spec/lighting.md L11), so the room has firelight to judge.
  return { w, h, tiles, ground: new Array(w * h).fill(0), props: [], items: [], chests: [], traps: [], rooms: [{ x: 2, y: 2, w: 14, h: 11 }, { x: 18, y: 4, w: 4, h: 7 }], lights: [{ kind: 'wall-torch', x: 5, y: 1 }, { kind: 'wall-torch', x: 12, y: 1 }] };
}

const body = o => ({ t: 0, statuses: {}, hunting: false, caughtOff: -1, ...o });

export function testCreatures() {
  return [
    body({ id: 'rat-1', asleep: true, kind: 'rat', name: 'Dungeon Rat', side: 'foe', x: 13, y: 9, hp: 16, maxhp: 16, speed: 100, acc: 56, eva: 22, armour: 0, dmg: [3, 4], sight: 6, look: { sheet: 'mob-m-rat', art: 0.75 }, sfx: 'rat' }),
    body({ id: 'goblin-1', kind: 'goblin', name: 'Goblin', side: 'foe', x: 20, y: 5, hp: 20, maxhp: 20, speed: 100, acc: 60, eva: 16, armour: 1, dmg: [4, 6], sight: 6, look: { sheet: 'mob-m-goblin', art: 0.9 }, sfx: 'goblin' }),
  ];
}
