// Every window the shell can hold: its contents builder, its title when it has no tabs, and its size on L.
// The four sheets share one tab row; Save, Load, Settings and About stand alone.

import { color } from '../core/widgets.js';
import { heroView } from '../model/hero-view.js';
import { buildCharacter, characterFresh } from './character.js';
import { buildInventory, inventoryFresh } from './inventory.js';
import { buildFaith } from './faith.js';
import { buildOptions } from './options.js';
import { buildSave, buildLoad, saveFresh } from './save.js';
import { buildAbout, buildVersion } from './about.js';
import { buildJournal, journalFresh } from './journal.js';
import { buildForge, forgeFresh, forgeNewRun } from './forge.js';
import { buildConfirm, buildLog } from './popups.js';
import { buildCore, buildShrine, buildShop, buildChooseItem, shopFresh } from './places.js';
import { buildSandbox, sandboxNewRun } from './sandbox.js';
import { buildRunReport } from './end.js';

export const TABS = ['Character', 'Inventory', 'Faith', 'Options'];

/** @type {Record<string, {title?:string, build:(kit:any, area:{w:number,h:number}, ctx:any)=>any, size?:{w:number,h:number}}>} */
export const WINDOWS = {
  Character: { hotbar: true, fresh: characterFresh, newRun: characterFresh, build: (kit, area, c) => buildCharacter(kit, area, heroView(c.game), { ...c.deps, reopen: c.reopen, hero: c.game?.hero, game: c.game }) },
  Inventory: { hotbar: true, build: (kit, area, c) => buildInventory(kit, area, heroView(c.game), { ...c.deps, reopen: c.reopen, open: c.open, clock: c.clock, game: c.game, ui: c.ui, say: w => c.ui?.say?.(w, color.ash) }) },
  // Faith holds less than the other tabs, so it takes a smaller window on landscape screens (Justin 10-16).
  Faith: { hotbar: true, size: { w: 900, h: 470 }, build: (kit, area, c) => buildFaith(kit, area, heroView(c.game), { ...c.deps, reopen: c.reopen, wrath: c.game?.hero?.wrath, hero: c.game?.hero, game: c.game }) },
  Options: { build: (kit, area, c) => buildOptions(kit, area, c) },
  Settings: { title: 'Settings', build: (kit, area, c) => buildOptions(kit, area, c) },
  Save: { size: { w: 550, h: 480 }, build: (kit, area, c) => buildSave(kit, area, c) },
  Load: { title: 'Load game', size: { w: 550, h: 360 }, build: (kit, area, c) => buildLoad(kit, area, c) },
  About: { title: 'About', size: { w: 640, h: 300 }, build: (kit, area, c) => buildAbout(kit, area, c) },
  // The version words on the title open it: the update check, then every version's notes (1.7 showVersion).
  Version: { title: 'Version', size: { w: 900, h: 600 }, build: (kit, area, c) => buildVersion(kit, area, c) },
  Journal: { title: 'Journal', build: (kit, area, c) => buildJournal(kit, area, c) },
  Log: { title: 'Combat log', size: { w: 640, h: 560 }, build: (kit, area, c) => buildLog(kit, area, c) },
  // Opened with { tab: 'fuse', infusion: true, onClose } after a boss core is claimed: the Fuse tab alone (forge.json core-infusion).
  Forge: { title: 'The Elemental Forge', titleOf: a => (a?.infusion ? 'Core claimed: infuse an element' : null), six: true, size: { w: 1060, h: 560 },
    build: (kit, area, c) => (c.arg?.infusion ? buildCore(kit, area, c) : buildForge(kit, area, c)), onClose: (close, a) => { close(); a?.onClose?.(); } },
  Core: { title: 'Core claimed: infuse an element', six: true, size: { w: 1060, h: 460 }, build: (kit, area, c) => buildCore(kit, area, c) },
  Shrine: { title: 'Shrine', size: { w: 960, h: 520 }, build: (kit, area, c) => buildShrine(kit, area, c) },
  Shop: { title: 'Merchant', size: { w: 960, h: 560 }, build: (kit, area, c) => buildShop(kit, area, c) },
  Choose: { title: 'Choose an item', titleOf: a => a?.title ?? null, size: { w: 640, h: 420 }, build: (kit, area, c) => buildChooseItem(kit, area, c) },
  // A sandbox run's dev tools (src/engine/sandbox.js): floors, planes, the hero, creatures and items.
  ...((typeof __FORGE_PUBLIC__ === 'undefined' || !__FORGE_PUBLIC__) ? { Sandbox: { title: 'Sandbox', size: { w: 1060, h: 600 }, newRun: sandboxNewRun, build: (kit, area, c) => buildSandbox(kit, area, c) } } : {}),
  // CSS-20: the end screen's Run report (1.7 openReport), opened with the run's record.
  Report: { title: 'Run report', size: { w: 640, h: 560 }, build: (kit, area, c) => buildRunReport(kit, area, c) },
  Confirm: { size: { w: 460, h: 230 }, fit: true, build: (kit, area, c) => buildConfirm(kit, area, c) },
};

/** The L size of a window, or undefined for the full sheet. P windows always take the whole stage. */
// U7 (ui-23): what a window clears when opened afresh (not when a Confirm or Choose hands back to it) and on a new run.
Object.assign(WINDOWS.Forge, { fresh: forgeFresh, newRun: forgeNewRun }); WINDOWS.Inventory.fresh = inventoryFresh; WINDOWS.Journal.fresh = journalFresh;
WINDOWS.Shop.fresh = shopFresh; WINDOWS.Save.fresh = saveFresh; WINDOWS.Load.fresh = saveFresh;

export function windowSize(name, stage) {
  return WINDOWS[name]?.size;
}
