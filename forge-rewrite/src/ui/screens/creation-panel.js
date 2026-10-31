// The creation panel, as 1.7's (js/character/create.js:554-605 @3c8b312; Justin 2026-10-16: "1.7 was much better"): a
// title in the highlight colour, the choice in a sentence, the attributes between two rules with their values in the
// highlight colour, then each gift, ability and passive as icon, coloured name and its one line. Each step shows only
// what it decides (no class before the class step, a generic Cleric until a god is sworn); the last step stacks it all.
// The highlight follows the choice's element (kit.accent: blue for the Tide Court, orange for Ember).

import { Container, Graphics } from '../../../../forge-godot/runtime/pixi.js';
import { color, space } from '../core/widgets.js';
import { stack } from '../core/layout.js';
import { chip } from '../core/chip.js';
import { abilityLook } from '../core/icons.js';
import { elementColour, toNum } from '../core/colour.js';
import { startAttributes, startAffinity, refusal, passiveRows, races, courts, classes, gods, GODS, COURTS } from '../model/creation-model.js';
import { ruleLine, titleCase } from '../model/hero-view.js';
import { INK } from './character.js';
import { statShort, RACE, CLASS, GOD, ACTION, INVOKE, CLERIC_BOUND, GIFT, DAMAGE_WORD, titleLine } from '../model/words.js';
import abilities from '../../../data/abilities.json' with { type: 'json' };
import prayers from '../../../data/prayers.json' with { type: 'json' };

const P_ = kit => kit.stage.kind === 'P';
// CF35 (1.7 runtime/game.js AFF_COL, create.js:540, :599): a court's name in its element's colour.
export const courtColour = id => elementColour(courts.rows[id]?.element, 'enchant') ?? color.ink;
const words = (kit, text, w, fill = color.ash, italic = false) => kit.text(text, { size: P_(kit) ? 14 : 16, fill, wrap: w, italic });
// CH-36 (1.7 journal-menus.css:31-46): traits and benefits green, abilities gold, rules and refusals red, a god's style italic.
const TRAIT = INK.agility, ABILITY_INK = INK.might, RULE = INK.vitality, STYLE = 0xd3cec2;

/** 1.7's rule line: the word Rule in red, its words beside it in the copy colour. */
function ruleWords(kit, rule, w) {
  const r = new Container(), head = words(kit, 'Rule:', w, RULE);
  const body = words(kit, rule, w - head.width - space.inRow);
  body.x = head.width + space.inRow;
  r.addChild(head, body);
  return r;
}

/** A class's kind (strings.json class.<id>.tag; item 312, Justin 2026-10-22: "i think tourist needs a label Challenge
 *  Class"), centred on w in the rule red: by its name in the panel and under its icon in the class row. Null for a
 *  class without one; shadow: the halo the class row's names wear over the stage. */
export function classTag(kit, id, w, size, shadow) {
  const text = CLASS[id]?.tag;
  if (!text) return null;
  const t = kit.text(text, { size, font: 'display', fill: RULE, wrap: w, align: 'center', shadow });
  t.x = Math.round((w - t.width) / 2);
  return t;
}

/** The panel's title: the choice's name, centred, in the highlight colour (a god's in its own colour). */
function title(kit, text, w, { fill, compact = false, icon } = {}) {
  const small = kit.stage.short || (compact && P_(kit) && kit.stage.h < 720), size = small ? 20 : P_(kit) ? 26 : 32;
  const t = kit.text(text, { size, font: 'display', fill: fill ?? kit.accent, wrap: w, align: 'center' });
  t.style.breakWords = true;
  const iconSize = small ? 32 : P_(kit) ? 40 : 48, gap = space.betweenRows;
  if (icon && iconSize + gap + t.width <= w) {
    const row = new Container(), art = chip(icon, iconSize), h = Math.max(iconSize, t.height);
    art.y = Math.round((h - iconSize) / 2); t.position.set(iconSize + gap, Math.round((h - t.height) / 2));
    row.addChild(art, t); row.x = Math.round((w - row.width) / 2); return row;
  }
  t.x = Math.round((w - t.width) / 2);
  return t;
}

/** Might, Agility, Vitality, Focus between two rules, values in the highlight colour; each with its Journal card. */
function attrBlock(kit, c, w, compact) {
  const r = new Container(), cw = w / 4, pad = space.betweenRows;
  let h = 0;
  startAttributes(c).forEach((a, i) => {
    const label = words(kit, a.name), value = kit.text(String(a.value), { size: kit.stage.short || (compact && P_(kit) && kit.stage.h < 720) ? 20 : 26, font: 'display', fill: kit.accent, weight: '700' });
    label.anchor.set(0.5, 0); value.anchor.set(0.5, 0);
    label.position.set(cw * (i + 0.5), pad); value.position.set(cw * (i + 0.5), pad + label.height + space.inRow);
    const cell = new Container();
    cell.addChild(label, value);
    kit.details(cell, { title: a.name, lines: statShort(a.name), place: 'panel' });
    cell.label = 'create-attr-' + a.id;
    r.addChild(cell);
    h = Math.max(h, value.y + value.height + pad);
  });
  // CSS-23 (painted-ui.css:1121, forge-skin.css:900): the rules are #ffffff1f, the values blackletter at the step's word size.
  r.addChildAt(new Graphics().rect(0, 0, w, 1).rect(0, h, w, 1).fill({ color: 0xffffff, alpha: 0x1f / 255 }), 0);
  return r;
}

/**
 * One gift, ability or passive, as 1.7 sets it: the icon in its chip, the name in the highlight colour, its line under
 * it. Its card (the same words and the costs) on hover or tap, by the panel.
 */
function entry(kit, w, e, compact) {
  const c = new Container(), P = P_(kit), size = e.icon ? (P ? 36 : 40) : 0, gap = e.icon ? space.betweenRows + space.inRow : 0;
  const name = kit.text(e.name, { size: P ? 18 : 20, font: 'display', fill: e.fill ?? kit.accent });
  const half = Math.floor((w - space.betweenSections) / 2);
  const width = compact && size + gap + name.width <= half ? half : w;
  if (name.width > width - size - gap) { name.style.wordWrap = true; name.style.wordWrapWidth = width - size - gap; name.style.breakWords = true; }
  // Compact entries share a row only when their full names fit; their lines stay in the cards.
  const line = e.line && !compact ? words(kit, e.line, w - size - gap, e.lineFill) : null;
  const text = stack([name, line].filter(Boolean), 0);
  const h = Math.max(kit.target, size, text.height);
  text.position.set(size + gap, Math.round((h - text.height) / 2));
  if (e.icon) { const icon = chip(e.icon, size); icon.y = Math.round((h - size) / 2); c.addChild(icon); }
  c.addChild(text);
  c.addChildAt(new Graphics().rect(0, 0, width, h).fill({ color: 0, alpha: 0.001 }), 0);
  if (e.detail) kit.details(c, { ...e.detail, place: 'panel' });
  c.label = 'entry-' + e.name;
  return c;
}

// The cost line of an ability card: "7 mana · 20 turn cooldown · range 6"; CD30 (1.7 data.js instant): "· Instant" for
// a power that takes no turn, unless its sentence already says so (Iron Body, Temper).
export const costLine = (r, text = '') => [r?.mana ? `${r.mana} mana` : null, r?.cooldown ? `${r.cooldown} turn cooldown` : null, r?.aim?.range > 1 ? `range ${r.aim.range}` : null,
  r?.instant && !/\bInstant\b/.test(text) ? 'Instant' : null].filter(Boolean).join(' · ');
const card = (name, sub, text, r) => ({ title: name, sub, lines: [text, costLine(r, text)].filter(Boolean) });

const abilityEntry = id => { const { name, icon } = abilityLook(id); return { icon, name, fill: ABILITY_INK, line: ACTION[id], detail: card(name, 'Ability', ACTION[id], abilities.rows[id]) }; };
function invokeEntry(godId) {
  const id = gods.rows[godId]?.invoke, pr = prayers.rows[id], name = pr?.name ?? titleCase(id);
  return { icon: abilityLook(id).icon, name, fill: ABILITY_INK, line: ACTION[id], detail: card(name, 'Invoke', ACTION[id], pr) };
}
// A Cleric before a god is sworn (1.7 create.js:578: "Varies by god").
const genericInvoke = () => ({ icon: 'ic-pray', name: INVOKE.name, fill: ABILITY_INK, line: INVOKE.text, detail: card(INVOKE.name, 'Invoke', INVOKE.text) });
function passiveEntry(clsId) {
  const cls = classes.rows[clsId], line = CLASS[clsId]?.passive;
  return { icon: cls.icon, name: cls.passiveName, line, lineFill: TRAIT, detail: { title: cls.passiveName, sub: 'Passive', lines: [line, ...passiveRows(clsId).flatMap(([k]) => statShort(k))].filter(Boolean) } };
}

/** The starting element's first gift (Ice Armor 1 for the Tide Court, Life Drain 1 for a Gloomling), no icon, as 1.7. */
const giftEntries = c => startAffinity(c).filter(el => GIFT[el]).map(el => ({ name: `${GIFT[el].name} 1`, line: GIFT[el].line(1) }));

/** The race's line: its blurb, or on the last step a Fae's with the court's real weakness. */
function raceLine(c, last) {
  const r = RACE[c.race];
  if (!r) return null;
  if (last && r.after && c.court) return r.after.replace('%weak', DAMAGE_WORD[courts.rows[c.court]?.weakTo] ?? courts.rows[c.court]?.weakTo);
  return r.blurb;
}

/** The race line with the stat cards it mentions on hover or tap (sandbox item 1). */
const STAT_WORDS = [[/speed/, 'Speed'], [/affinity cap/, 'Affinity cap'], [/more (light )?damage/, 'Weak to'], [/piety gain/, 'Piety gain']];
function raceWords(kit, text, w) {
  const node = new Container();
  node.addChild(words(kit, text, w, color.ink));
  const stats = STAT_WORDS.filter(([re]) => re.test(text)).map(([, s]) => s);
  if (stats.length) kit.details(node, { title: 'What it means', lines: stats.flatMap(s => [s, ...statShort(s)]), place: 'panel' });
  return node;
}

/**
 * Which gods would turn this character away as a Cleric, where the choice can still change it (1.7 create.js:584-593):
 * "Refused as a Cleric by Chad, Saint Glimmer." On a Fae's race step the court is still to come, so only a god who
 * refuses every court is named there; one tied to a court shows on the court step.
 */
function refusedLine(kit, c, w, anyCourt) {
  const as = { ...c, cls: 'cleric' };
  const no = GODS.filter(g => anyCourt ? COURTS.every(k => refusal(g, { ...as, court: k })) : refusal(g, as));
  if (!no.length) return null;
  return words(kit, `Refused as a Cleric by ${no.map(g => gods.rows[g].name.split(/,| the /)[0]).join(', ')}.`, w, RULE);
}

/**
 * @param {ReturnType<import('../core/widgets.js').createKit>} kit
 * @param {any} c the choice @param {string} step @param {number} w @param {boolean} [compact] names only, lines in cards
 */
export function creationPanel(kit, c, step, w, compact = false) {
  const parts = [], gap = space.betweenRows;
  // Compact entries share a row when both fit; long names keep the panel's full width.
  const ew = compact ? Math.floor((w - space.betweenSections) / 2) : w;
  const put = e => parts.push(entry(kit, w, { ...e, detail: e.detail ?? { title: e.name, lines: [e.line] } }, compact));
  const pair = () => {
    if (!compact) return;
    for (let i = 0; i + 1 < parts.length; i++) {
      const a = parts[i], b = parts[i + 1];
      if (a.label?.startsWith('entry-') && b.label?.startsWith('entry-') && a.width <= ew && b.width <= ew) {
        const row = new Container(); b.x = ew + space.betweenSections; row.addChild(a, b); row.label = 'entry-pair';
        parts.splice(i, 2, row);
      }
    }
  };

  if (step === 'race') {
    // What the race gives, and nothing of a class not yet chosen (items 48, 49).
    parts.push(title(kit, races.rows[c.race].name, w, { compact }), words(kit, RACE[c.race]?.summary ?? '', w, color.ink), attrBlock(kit, { ...c, cls: null }, w, compact));
    parts.push(raceWords(kit, raceLine(c, false), w));
    if (c.race !== 'fae') giftEntries(c).forEach(put);
    // No refusal line before a class is chosen: it shows on the class step, for a Cleric (Justin 10-16 item 49;
    // sandbox 87 follow-up, 10-17).
    pair();
    return stack(parts, gap);
  }

  if (step === 'court') {
    // The court's gift and, in red, its weakness (1.7 create.js:599).
    const k = courts.rows[c.court];
    parts.push(title(kit, k.name, w, { fill: courtColour(c.court), compact }), attrBlock(kit, { ...c, cls: null }, w, compact));
    giftEntries(c).forEach(put);
    parts.push(words(kit, `Takes 25% more ${DAMAGE_WORD[k.weakTo] ?? k.weakTo} damage.`, w, RULE));
    pair();
    return stack(parts, gap);
  }

  if (step === 'god') {
    // The god's name in its colour, its name line, whom it favors, how it awards piety, its rule, then its ability.
    const g = gods.rows[c.god], t = GOD[c.god] ?? {};
    parts.push(title(kit, g.name, w, { fill: toNum(g.color), compact }));
    const ep = words(kit, titleLine(g.title), w, STYLE, true);
    ep.x = Math.round((w - ep.width) / 2);
    parts.push(ep);
    const no = refusal(c.god, c);
    if (no) parts.push(words(kit, `Refuses you: ${no}`, w, RULE));
    if (t.favors) parts.push(words(kit, t.favors, w, color.ink));
    if (g.loves) parts.push(words(kit, `Loves ${races.rows[g.loves].name}s: +25% piety gain.`, w, TRAIT));
    const rule = ruleLine(g);
    // A phone with no room keeps the name line, Favors and the ability on the face; the piety and rule lines move into the
    // ability's tap card (Justin 2026-10-16, item 50: "make sure it isn't too much to fit in the windows on mobile").
    const inv = invokeEntry(c.god);
    if (compact) inv.detail = { ...inv.detail, lines: [...(inv.detail.lines ?? []), t.piety && `Piety: ${t.piety}`, rule && `Rule: ${rule}`].filter(Boolean) };
    else {
      if (t.piety) parts.push(words(kit, `Piety: ${t.piety}`, w));
      if (rule) parts.push(ruleWords(kit, rule, w));
    }
    put(inv);
    pair();
    return stack(parts, gap);
  }

  const cleric = c.cls === 'cleric', sworn = cleric && step === 'name' && c.god;
  const cls = classes.rows[c.cls];
  const actives = cleric ? [sworn ? invokeEntry(c.god) : genericInvoke()] : cls.abilities.map(abilityEntry);

  if (step === 'cls') {
    // A Cleric is generic here: Invoke, Devout, and the vow (item 49), then the gods who would refuse them (1.7 :600).
    const brief = compact && P_(kit) && kit.stage.h < 720;
    const heading = title(kit, cls.name, w, { compact, icon: brief ? null : cls.icon }), tag = classTag(kit, c.cls, w, P_(kit) ? 16 : 18);
    if (tag) tag.label = 'class-tag';
    if (!brief) parts.push(heading, ...(tag ? [tag] : []), words(kit, CLASS[c.cls]?.summary ?? '', w, color.ink));
    else {
      const row = new Container(), h = Math.max(kit.target, heading.height);
      heading.y = Math.round((h - heading.height) / 2);
      row.addChild(new Graphics().rect(0, 0, w, h).fill({ color: 0, alpha: 0.001 }), heading);
      row.label = 'creation-class-summary';
      kit.details(row, { title: cls.name, lines: [CLASS[c.cls]?.summary].filter(Boolean), place: 'panel' });
      parts.push(row, ...(tag ? [tag] : []));
    }
    parts.push(attrBlock(kit, c, w, compact));
    actives.forEach(put);
    if (cls.passiveName) put(passiveEntry(c.cls));
    if (cleric) parts.push(words(kit, CLERIC_BOUND, w));
    pair();
    const no = cleric ? refusedLine(kit, c, w, false) : null;
    if (no) parts.push(no);
    return stack(parts, gap);
  }

  // The last step: the whole character, stacked as 1.7's summary (item 54).
  const who = [races.rows[c.race].name, cls.name].join(' ') + (sworn ? ` of ${gods.rows[c.god].name}` : '') + (c.court ? `, ${courts.rows[c.court].name}` : '');
  if (!P_(kit)) parts.push(title(kit, c.name || 'Adventurer', w, { compact }));
  // A phone's chevrons above already spell out race, court, class and god, so the panel leaves that line to them.
  if (!compact && !P_(kit)) parts.push(words(kit, who, w, color.ink));
  parts.push(attrBlock(kit, c, w, compact));
  const rl = raceLine(c, true);
  if (rl) parts.push(raceWords(kit, rl, w));
  giftEntries(c).forEach(put);
  actives.forEach(put);
  if (cls.passiveName) put(passiveEntry(c.cls));
  pair();
  return stack(parts, gap);
}
