// About, from the title: the game's name, then three short paragraphs: the game, its maker, and the AI assistance
// (Justin 10-16: "a paragraph about the game, me, and say it uses AI assistance"; then "make formatted to look better").

import { Container, Graphics } from '../../../../forge-godot/runtime/pixi.js';
import { color, space } from '../core/widgets.js';
import { stack, row, flow } from '../core/layout.js';
import { VERSION, PATCHES } from '../../data/version.js';
import { versionCheck } from '../model/version-check.js';

const PARAS = [
  'A turn-based roguelike. Choose a race and a class, swear to a god if you dare, and fight down twenty-five floors through five biomes, gathering the six elements to shape your gear and your magic.',
  'Made by Justin Hoffman, who designs it and directs every creature, map and sound.',
  'Built with AI assistance for the art, the music and the code.',
];

export function buildAbout(kit, area) {
  const title = kit.text('Forge of the Elements', { size: 26, font: 'display', fill: kit.accent, wrap: area.w });
  const body = PARAS.map((p, i) => kit.text(p, { size: 16, fill: i ? color.ash : color.ink, wrap: area.w }));
  return stack([title, ...body], space.betweenSections);
}

/** The Version window's picked version and notes page (kept while it is open). */
const notesAt = { pick: 0, page: 0 };

/**
 * Version, from the version words on the title (1.7 showVersion, js/platform/update.js:435-441): what the update
 * check found, Install update when a newer build is live, Check again, then every version's notes, newest first.
 * The notes of the picked version are paged to the window on a laptop; a phone gets its one scroll.
 */
export function buildVersion(kit, area, ctx) {
  const { state: versionState, check: checkVersion, install: installUpdate, itch: itchUpload, watch: watchVersion } = versionCheck(ctx.deps);   // C17: through deps
  const s = versionState(), built = { latest: !!s.latest, installing: s.installing, validated: s.validated };
  const status = kit.text(`${VERSION} · ${s.message}`, { size: 14, fill: s.latest ? kit.accent : color.ash, wrap: area.w });
  const plates = [];
  const plateH = Math.max(36, kit.target);
  if (s.latest && !itchUpload()) plates.push(kit.plateButton(s.installing ? 'Installing…' : 'Install update', () => { if (s.validated && !s.installing) installUpdate(); }, { h: plateH, size: 16, rank: 'prominent' }));
  plates.push(kit.plateButton('Check again', () => { ctx.deps?.cue?.('ui-click'); checkVersion(); }, { h: plateH, size: 16 }));
  plates.forEach(p => { p.label = 'version-' + p.label.toLowerCase().replace(/\W+/g, '-'); });
  const how = kit.text(itchUpload() ? 'To update this copy, reload the itch.io game page. Saved games and settings are kept.' : 'Reloading to update keeps your saved games and settings.', { size: 14, fill: color.dim, wrap: area.w });
  const actions = new Container();
  flow(plates, area.w, space.betweenRows, space.betweenRows); actions.addChild(...plates);
  const head = stack([status, actions, how], space.betweenRows);

  const pick = Math.min(notesAt.pick, PATCHES.length - 1);
  const names = PATCHES.map((p, i) => Object.assign(kit.button(p.version, () => { ctx.deps?.cue?.('ui-click'); notesAt.pick = i; notesAt.page = 0; ctx.reopen(); }, { size: 16, font: 'body', tight: !kit.stage.touch, selected: i === pick }), { label: 'version-' + i }));
  const list = new Container();
  names.forEach(n => list.addChild(n));
  flow(names, area.w, space.betweenRows, 0);

  // Each note a bulleted paragraph under the picked version's name.
  const bullet = kit.size(14) * 1.1;
  const items = PATCHES[pick].notes.map(words => {
    const c = new Container(), dot = new Graphics().circle(3, kit.size(14) * 0.7, 2.5).fill(color.dim);
    const t = kit.text(words, { size: 14, fill: color.ink, wrap: area.w - bullet });
    t.x = bullet; c.addChild(dot, t);
    return c;
  });
  const top = head.height + space.betweenSections + list.height + space.betweenSections;
  const P = kit.stage.kind === 'P' || kit.stage.touch;
  const room = area.h - top - kit.target - space.betweenRows;
  // Pages on a laptop: as many whole notes as fit; a note too long for a page has one to itself.
  const pages = [[]];
  let used = 0;
  for (const it of items) {
    const h = it.height + space.betweenRows;
    if (!P && pages.at(-1).length && used + h > room) { pages.push([]); used = 0; }
    pages.at(-1).push(it); used += h;
  }
  const page = Math.min(notesAt.page, pages.length - 1);
  items.filter(it => !pages[page].includes(it)).forEach(it => it.destroy({ children: true }));
  const body = stack(pages[page], space.betweenRows);
  const parts = [head, list, body];
  if (pages.length > 1) {
    const go = n => { notesAt.page = n; ctx.reopen(); };
    const prev = Object.assign(kit.button('‹', () => go(Math.max(0, page - 1)), { size: 26, font: 'body', dim: page === 0 }), { label: 'page-prev' });
    const next = Object.assign(kit.button('›', () => go(Math.min(pages.length - 1, page + 1)), { size: 26, font: 'body', dim: page === pages.length - 1 }), { label: 'page-next' });
    const nav = row([prev, kit.text(`${page + 1} / ${pages.length}`, { size: 14, fill: color.ash }), next], space.betweenRows);
    nav.x = Math.round((area.w - nav.width) / 2);
    parts.push(nav);
  }
  const root = stack(parts, space.betweenSections);
  // The status line follows the check; a change in what can be done (an update found, installing) rebuilds the window.
  const unwatch = watchVersion(v => {
    if (root.destroyed) return;
    if (!!v.latest !== built.latest || v.installing !== built.installing || v.validated !== built.validated) { setTimeout(() => { if (!root.destroyed) ctx.reopen(); }, 0); return; }
    status.text = `${VERSION} · ${v.message}`;
  });
  root.on('destroyed', unwatch);
  return root;
}
