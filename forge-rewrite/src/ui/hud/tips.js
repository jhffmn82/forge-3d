// The tutorial (Justin 2026-10-21/22; every card's words approved by him one at a time, side-session notes
// tutorial-script.md): a card for each first moment, shown once ever on this device while tutorials are on (creation's
// Tutorial plate, the card's Don't show again), never in a sandbox run. A card is centred with the rest of the screen
// uniformly dimmed; a card about something on the map sits beside it (hud/coach.js draws them).
// `at` says where a card may show: 'map' with no window open, 'Forge' over the Forge, 'core' over a claimed core's
// Fuse, 'any' over whatever is open (the Inventory a cursed piece was put on from), 'create' in the creator.

import { AUTO, litAt } from '../../engine/reads.js';   // C17: the rules' answers through the engine (PLAN section 2)
import { keyTable, keyLabel } from '../../input/input.js';
import { T } from '../../data/tiles.js';
import progression from '../../../data/progression.json' with { type: 'json' };

const HUNGRY = progression.rows.hunger.hungryWarningAt;

/** The first key bound to an action that is not an arrow or a number-pad key, named as Options names it (ui-34). */
function keyOf(table, action, fallback) {
  const k = (table[action] ?? []).find(x => !/^Arrow|^Numpad|^(Home|End|PageUp|PageDown)$/.test(x) && !/^\d$/.test(x));
  return keyLabel(k ?? fallback);
}

/** A worn piece that will not come off (I56): cursed or below +0, known (an unread amulet does not bind). */
const bound = it => !!it && (it.cursed || (it.plus ?? 0) < 0) && it.known !== false;
const boundSlot = state => Object.entries(state?.hero?.worn ?? {}).find(([, it]) => bound(it))?.[0] ?? null;
const stairsAt = state => { const f = state.floor, i = f.tiles.findIndex(t => t === T.STAIRS); return i < 0 ? null : { x: i % f.w, y: Math.floor(i / f.w) }; };
const page = (title, words, o = {}) => ({ title, words, ...o });
/** Map anchors include the height of a Forge or shrine; stairs are flat. */
const TALL = 0.6;

/** Each card: where it may show and its pages for this player (c: { touch, keys, state }). */
export const CARDS = {
  race: { at: 'create', pages: () => [page('Select your race', ['Your race sets your starting stats and abilities.', 'Fae must select a subrace.',
    'Hover or touch stats and traits for details. Press Confirm to continue.'])] },
  class: { at: 'create', pages: () => [page('Select your class', ['Your class sets starting stats and gear, plus abilities and passives.', 'Clerics must also select a god.',
    'Hover or touch abilities and passives for details. Press Confirm to continue.'])] },
  play: { pages: ({ touch, k, moves }) => [page('How to play', ['This game is turn-based. Nothing moves until you act.', 'Death deletes your run and its saves.',
    touch ? 'Tap to move or attack an adjacent enemy.' : `Move with arrows, ${moves}, or click. Walk into enemies to attack.`,
    touch ? 'Hold an enemy to compare hit chances.' : 'Hover over an enemy to compare hit chances.',
    touch ? 'Hold your hero to recover health and mana when no enemies are visible.' : `Press ${k('rest', 'r')} to recover health and mana when no enemies are visible.`,
    'Find the stairs down.'])] },
  around: { pages: ({ touch, k }) => [page('Finding your way around', ['The book opens the Menu, including Faith, Options, Journal and Save.',
    touch ? 'Tap your portrait for Character or the bag for Inventory.'
      : `${k('character', 'Tab')} or portrait: Character. ${k('inventory', 'i')} or bag: Inventory.`,
    touch ? 'Tap the map to view the floor, or the compass to auto-explore. Auto-explore stops for danger.'
      : `${k('map', 'm')} opens the map. ${k('explore', 'o')} or the compass auto-explores, stopping for danger.`,
    'The Journal explains what you discover.'])] },
  bag: { pages: ({ touch, k }) => [page('Your bag', [
    touch ? 'Tap the bag to open Inventory for free.' : `${k('inventory', 'i')} or the bag opens Inventory for free.`,
    touch ? 'Tap an item for details, then choose an action.' : 'Hover for details; click to use or equip; right-click to drop.',
    'Unknown gear may be cursed and refuse to come off. Wear or use it to identify it over time; a Sigil of Knowledge identifies it safely.',
    `${touch ? 'Tap ground items or stand on them and tap Pick up.' : `Click ground items or stand on them and press ${k('pickup', 'g')}.`} Essence, motes and keys collect automatically; hearts and mana globes only as needed.`])] },
  sigils: { pages: ({ touch }) => [page('Sigils', ['Sigils are single-use spells.',
    touch ? 'Tap one in your bag, then Use, or drag it to the hotbar.' : 'Click one in your bag to use it, or drag it to the hotbar.',
    'Using an unknown sigil reveals its kind for this run and triggers its effect, good or bad.',
    'Some gods restrict sigils; check Faith.'])] },
  cursed: { at: 'any', pages: () => [page('Cursed', ['This cursed item is weaker and cannot be removed.',
    'Choose Upgrade at a Forge to cleanse it instead of adding +1.',
    'A Sigil of Purity or Ascension also cleanses it. A Sigil of Rot destroys the item.'])] },
  hungry: { pages: () => [page('Hungry', ['You are hungry and must eat.',
    'While hungry you cannot rest.', 'While starving, you will begin losing health.'])] },
  'forge-found': { pages: ({ state }) => [page('A Forge', ['You have discovered a Forge!',
    'A Forge allows you to gain elemental affinity, enchant, upgrade, and recycle equipment, and craft sigils.'],
  { beside: state?.floor?.forge ? { tile: [state.floor.forge.x, state.floor.forge.y], up: TALL } : null })] },
  forge: { at: 'Forge', pages: () => [
    ['Fuse', ['Spend one mote for +1 permanent affinity. Affinity unlocks spells and passives and strengthens enchantments.',
      'Hold up to two elements, never opposites. Your first stays primary; the second cannot exceed it.',
      'At 3+2 affinity, unlock a combo passive.']],
    ['Enchant', ['Spend one mote to enchant identified gear you wear with its element.', 'Matching affinity strengthens most enchantments.']],
    ['Upgrade', ['Spend essence to add +1 to identified gear you wear.', 'Cursed items are cleansed instead.']],
    ['Craft', ['Choose a recipe to craft a sigil using motes and essence.', 'Crafted sigils are identified.']],
    ['Recycle', ['Convert gear from your bag into essence.']],
  ].map(([tab, words], i, all) => page(`${tab} · ${i + 1} of ${all.length}`, words, { tab })) },
  core: { at: 'core', pages: () => [page('Boss core', ['Your affinity cap increased by 1. Carry the core to the exit gate.',
    'Infuse one mote now without a Forge, or close this window and use a Forge later.'])] },
  shrine: { pages: ({ state }) => [page('Shrines', ['You have discovered a shrine! Learn its god\'s rule, swear to it, or pray.',
    'Praying at your own god\'s shrine refills favor once per floor.'],
  { beside: state?.floor?.shrine ? { tile: [state.floor.shrine.x, state.floor.shrine.y], up: TALL } : null })] },
  stairs: { pages: ({ state }) => [page('Stairs down', ['You have discovered the stairs! Descend to the next level. You can always return.'],
  { beside: state && stairsAt(state) ? { tile: [stairsAt(state).x, stairsAt(state).y] } : null })] },
  level: { pages: ({ touch, k }) => [page('Level up', ['You have gained a level!', 'The gold number on your portrait shows unspent stat points.',
    touch ? 'Tap your portrait, then + beside a stat.' : `Press ${k('character', 'Tab')} or click your portrait, then click + beside a stat.`,
    touch ? 'Tap a stat for details.' : 'Hover over stats for details.'])] },
  god: { pages: ({ touch, k }) => [page('Your god', ['Earn piety to gain ranks and unlock boons and prayers.',
    'Most prayers cost favor.', 'Favor is shown under the hunger bar.',
    touch ? 'Open Menu → Faith for your god\'s rule, boons and prayers.' : `Press ${k('faith', 'p')} for your god's rule, boons and prayers.`])] },
};

/** The cards a new run opens with, and Options' How to play replays. */
export const TOUR = ['play', 'around'];
/** The creator's step that each creator card belongs to. */
export const CREATOR = { race: 'race', cls: 'class' };

/** A card's pages for this player: each { title, words, next, tab?, beside? }; keys as the player bound them. */
export function cardPages(id, { touch = false, keys = null, state = null } = {}) {
  const table = keyTable(keys), k = (a, f) => keyOf(table, a, f);
  const four = ['move-n', 'move-w', 'move-s', 'move-e'].map((a, i) => k(a, 'wasd'[i]));
  const moves = four.every(x => x.length === 1) ? four.join('') : four.join(', ');
  const pages = CARDS[id]?.pages({ touch, k, moves, state }) ?? [];
  return pages.map((p, i) => ({ ...p, next: i === pages.length - 1 ? 'Got it' : 'Next' }));
}

/** A run cards may show in: under way, not a sandbox (1.7 live()). */
export const tipLive = state => !!state && !state.over && !state.won && !state.sandbox && !!state.hero;

/**
 * The cards a turn calls for: its events (a level, a bag item or a sigil picked up, a core claimed, a Forge opened, a god
 * sworn) and what the hero has or sees now (hunger under the warning, a piece that binds, a Forge, a shrine or stairs
 * down in sight). The flow shows each once ever, when the windows and the hero allow.
 */
export function tipsFromEvents(state, events) {
  const out = [];
  const add = t => { if (!out.includes(t)) out.push(t); };
  let bagItem = false, sigil = false;
  for (const e of events ?? []) {
    if (e.type === 'level') add('level');
    else if (e.type === 'pickup' && e.what && !AUTO.includes(e.what)) { bagItem = true; if (e.what === 'sigil') sigil = true; }
    else if (e.type === 'core-claimed') add('core');
    else if (e.type === 'forge') add('forge');
    else if (e.type === 'hero' && e.change === 'swear' && state?.hero?.faith?.god) add('god');
  }
  if (sigil) add('sigils'); else if (bagItem) add('bag');
  if (!state?.hero || !state.floor) return out;
  if ((state.hero.hunger ?? HUNGRY) < HUNGRY) add('hungry');
  if (boundSlot(state)) add('cursed');
  const f = state.floor, seen = at => !!at && litAt(state, at.x, at.y);
  if (seen(f.forge)) add('forge-found');
  if (seen(f.shrine)) add('shrine');
  if (seen(stairsAt(state))) add('stairs');
  return out;
}
