// Where each played event goes (consolidation C15, moved from main.js): the autosave and the new floor, the map's
// redraws, the fields, the windows an event opens, the bars, the effects, the sound and the log.
// S is the page's run state (main.js): game, ui, floorHold.

import { infusionColours } from '../render/spell-fx.js';
import { eventFx } from '../render/event-fx.js';
import { castTiles } from '../rules/effects/select.js';
import { logLines } from '../ui/screens/log-text.js';
import { loadGroup } from './assets.js';
import { bodySheets } from './floor-art.js';

// RB7: while a new floor's art loads, its map events are left for setFloor; the sound and the log still play.
const HELD = new Set(['floor', 'sight', 'door', 'ground', 'field', 'field-ended', 'pulse', 'trap', 'trap-found', 'fell', 'pickup', 'chest', 'drops', 'expired', 'spawned', 'telegraph', 'telegraph-end', 'prop-broken', 'explosion', 'terrain', 'collapse']);
const FIELDS = new Set(['field', 'field-ended', 'ground', 'floor', 'sight']);

/** The windows and the HUD's answers to an event, by its type: (ev, S, play, map) => void. */
const WINDOWS = {
  forge: (ev, S) => S.ui.open?.('Forge'),
  // FX28 (1.7 forge-adapter.js:90 infuseFx): an element fused plays its power-up on the hero once the Forge's panel closes.
  fused: (ev, S, play, map) => { if (!map.pieces) return; const c = infusionColours(ev.element); map.pieces.infuse(c.col, c.pale, { waits: () => !!S.ui.covered?.(), at: () => { const p = S.game?.actors?.[S.game.playerId]; return p ? { x: p.x, y: p.y } : null; } }); },
  // D51: a claimed core opens the Forge's Fuse tab alone ("Core claimed: infuse an element"); closing sends end-infusion.
  'core-claimed': (ev, S, play) => { if (S.game.coreInfusion) S.ui.open?.('Forge', { tab: 'fuse', infusion: true, onClose: () => play({ type: 'end-infusion' }) }); },
  picker: (ev, S) => S.ui.picker?.(ev),   // D47: a picker sigil's chooser
  // A choice the engine asks first (the toll door, the sacrifice altar): the windows' Confirm popup sends its command.
  confirm: (ev, S, play) => S.ui.open?.('Confirm', { title: ev.title, text: ev.text, warn: ev.warn, yes: ev.yes ?? { toll: `Pay ${ev.cost} HP`, sacrifice: 'Offer' }[ev.id] ?? 'Yes', no: ev.no, onYes: () => play(ev.command), onNo: ev.decline ? () => play(ev.decline) : undefined }),
  shrine: (ev, S) => S.ui.open?.('Shrine', { god: ev.god, prayed: ev.prayed }),
  merchant: (ev, S) => S.ui.open?.('Shop'),   // S24: the cavern merchant's stall (rules/caverns.js); again after a purchase, to show it sold
  damaged: (ev, S) => { if (ev.id === S.game?.playerId && ev.amount > 0) S.ui.flinch?.(); },   // FX34
};

export function routeEvents(S, { playback, map, audio, fieldsView, drawFields, saves, floors, loop }) {
  playback.listen(ev => {
    if (ev.type === 'floor') saves.saveNow();   // the only autosave (Justin 2026-10-17)
    if (ev.type === 'floor') floors.enterFloor(ev.shake);
    const { game, ui: uiApi } = S;
    if (S.floorHold && HELD.has(ev.type)) { if (game) audio.onEvent(ev, game); for (const line of logLines(ev, game)) uiApi.say(line.words, line.fill, line); return; }
    map.onEvent(ev, game, { sheets: bodySheets, group: loadGroup });   // M9 (render-25): the map's own redraws (render/map-events.js)
    if (FIELDS.has(ev.type) || (ev.type === 'pulse' && (Object.keys(game.floor.burning ?? {}).length || game.floor.fields?.length || fieldsView.root.children.length))) drawFields();
    uiApi.forgeEvent?.(ev);   // G29: a fuse, enchant, upgrade, carving or recycling says so across the top of the Forge's window
    WINDOWS[ev.type]?.(ev, S, loop.play, map);
    // PL14: 'log' events are said by logLines below, in their own ink (log-text.js logFill).
    const vit = loop.vit;
    if (vit && ev.id === game?.playerId && (['damaged', 'healed', 'mana'].includes(ev.type) || (ev.type === 'ability' && vit.cost))) {
      if (ev.type === 'damaged') vit.hp -= ev.amount ?? 0;
      else if (ev.type === 'healed') vit.hp += ev.amount ?? 0;
      else if (ev.type === 'mana') vit.mana += ev.amount ?? 0;
      else { vit.mana += vit.cost; vit.cost = 0; }
      uiApi.vitals?.(vit.hp, vit.mana);   // RB28
    }
    if (game) eventFx(map.pieces, map, game, ev, (x, y) => !!game.vis?.[y * game.floor.w + x]);   // bursts, rings and shakes as each event plays
    // WC5 (1.7 casting-adapter.js:293): a hero's cast over two tiles or more shows its struck tiles in sight for 0.65 s.
    if (game && ev.type === 'ability' && ev.id === game.playerId) { const t = castTiles(game, ev.ability, ev.at); if (t.length > 1) map.pieces.castSurface(t.filter(c => game.vis?.[c.y * game.floor.w + c.x])); }
    audio.onEvent(ev, game);
    for (const line of logLines(ev, game)) uiApi.say(line.words, line.fill, line);   // E1: a hit and its procs on one line
  });
}
