// The rules' read-only answers the windows and the map show (consolidation C4, the rules surface for UI and render).
// PLAN section 2: ui/screens and ui/hud read the engine, not the rules, so the engine hands these on unchanged.
// A window that needs another rules answer adds it here.

export { upgradeCost } from '../rules/forge.js';
export { affinityCap, fuseRefusal, elementOrder } from '../rules/magic.js';
export { recycleValue, sigilForbidden, carveCost } from '../rules/sigils.js'; export { runeOf, sigilKnown, sigilName } from '../rules/item-names.js';
export { previewBlow } from '../rules/attack.js';   // the map card's blow (H3, ui-06)
export { shieldPools } from '../rules/shields.js';   // the HP bar's shields (H3, ui-37)
export { doorClosable } from '../rules/doors.js';   // a right-click shuts a door (H4, map-input.js)
export { buffTurns } from '../rules/statuses.js';   // a buff's length under a Holy Symbol on its card (U3, ui-10)
export { slotFor, equipRefusal, gearRequirement, CLICK_SPELLS } from '../rules/hero.js';   // the Inventory's drop glow, requirements and off-hand choices (U3, ui-12)
export { enchantCurve } from '../rules/passives.js';   // enchant lines with the god's bonus (U3, ui-42)
export { godRefusal, godRefuses, refusalText } from '../rules/god-refusal.js';   // creation's refusal tags (U3, ui-36)
export { raceRangeBonus, abilityRow, aimRange, manaCost } from '../rules/abilities.js';   // the weapon card's range (U3, ui-11)
export { litAt, seenAt } from '../rules/sight.js';   // the hero's sight and the map's memory (C13: sight moved to rules)
export { trueForgeAt } from '../rules/unmaker.js';   // the map card's Forge of the Elements (H6, map-cards.js)
export { stealthScore } from '../rules/ai-sense.js';
export { aimArea } from '../rules/aim-area.js';
export { amount } from '../rules/amount.js';
export { actionCost, moveCost } from '../rules/costs.js';
export { heroStats } from '../rules/derive.js';
export { lanePath } from '../rules/effects/select.js';
export { pietyDepth, shrineState } from '../rules/faith.js';
export { amuletValues, capacity, killsNeeded } from '../rules/gear-use.js';
export { evasionOf, blowChance, isSurprise } from '../rules/hit.js';
export { WALK_TILES, chaosWay, itemTitle, tileTitle, sealedTreasure } from '../rules/inspect.js';
export { armourValue, itemRow, ringPower, value, weaponDamage } from '../rules/items.js';
export { trinketLook } from '../rules/loot.js';
export { AUTO } from '../rules/pickup.js'; export { usedOnBump } from '../rules/explore.js'; export { itemName, trinketKnown } from '../rules/item-names.js';
export { litByPlaneLight } from '../rules/planes.js';
export { previewAffinity, previewEnchant } from '../rules/preview.js';
export { SCORE_VERSION, reportText, runRecord, score, scoreBreakdown } from '../rules/run-record.js';
export { boltPath, canShoot, canShootProp } from '../rules/shoot.js';
export { planFor } from '../world/runplan.js';
