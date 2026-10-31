// Which music and ambience a scene gets, and whether a track is a song with an ending (consolidation S1). Pure: no
// sound plays here.

import data from '../../data/audio.json' with { type: 'json' };
import bosses from '../../data/bosses.json' with { type: 'json' };
import { BIOMES, biomeOf } from '../data/schedule.js';

const MUSIC = data.music;

/* A8, A9 (1.7 floorScore, ambienceForScene): the floor's own tune (its plane's, else its biome's), and its ambience:
   fire beside a Forge and on the Fire plane, water on the Water plane, none in the Caverns (their score carries its own
   air) or in a boss fight. */
export const tuneFor = state => (state.floor?.plane ? `plane-${state.floor.plane}` : state.floor?.biome ?? biomeOf(state.floorNo ?? 1));
export function ambienceFor(state, boss = false) {
  if (boss) return null;
  const plane = state.floor?.plane;
  if (state.floor?.forge || plane === 'fire') return 'amb-fire';
  if (plane === 'water') return 'amb-water';
  if (!plane && tuneFor(state) === 'caverns') return null;
  return 'amb-dungeon';
}
/* CH20, BO2 (1.7 sceneScore): the set piece's own score while its boss is awake on the map, so a game loaded mid-fight
   plays the fight's music: the Unmaker's encounter under way, the Maw out of its sleep, Morty waiting to rise, or a
   floor boss off its throne. Plane guardians keep the plane's score. */
export function bossTuneFor(state) {
  const f = state.floor ?? {};
  if (f.plane) return null;
  if (f.crucible?.phase === 'active') return bosses.rows.unmaker.music;
  if (f.maw && f.maw.phase !== 'dormant' && f.maw.phase !== 'dead') return bosses.rows['deep-maw'].music;
  if (f.mortyReturn) return bosses.rows.morty.music;
  for (const a of Object.values(state.actors ?? {})) {
    const row = bosses.rows[a.set];
    if (row?.floor && a.hp > 0 && a.throne === false && a.side !== 'ally') return row.music;
  }
  return null;
}
/** A biome, plane or boss score (the ambience plays under these, not under the title). */
export const isSceneTune = name => BIOMES.includes(name) || /^(plane|boss)-/.test(name);

/* A11 (1.7 musicEnds): a track whose last half second is silent is a song with an ending, not a loop. */
export function musicEnds(buf) {
  if (!buf || typeof buf.getChannelData !== 'function' || !buf.sampleRate) return false;
  const d = buf.getChannelData(0), n = Math.floor(buf.sampleRate * MUSIC.endsSilentSeconds);
  let peak = 0;
  for (let i = Math.max(0, d.length - n); i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  return peak < MUSIC.endsPeak;
}
