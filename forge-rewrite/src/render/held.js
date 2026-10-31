// Held gear on a hero: which picture each hand holds, which sheet row an action plays, and where each picture sits,
// turned and layered, on every frame. Pure: reads sheet data and data/held.json, draws nothing (actor-sprite.js does).
// The rules are spec/held-items.md; each comment names its rule (H1 ...).

import held from '../../data/held.json' with { type: 'json' };
import weapons from '../../data/weapons.json' with { type: 'json' };
import offhands from '../../data/offhands.json' with { type: 'json' };
import ui from '../../data/ui.json' with { type: 'json' };

const R = held.rows, ITEM = R.items, G = R.grip, TWO = R['two-hand'], SWING = R['row-swing'], SCAN = R['hand-scan'];
const ROWS = R['clip-rows'], HOLDS = R['clip-holds'], STEPS = R['clip-steps'], OLD_DEATH = R['old-death'], WALK = R.walk;
const MS = ui.motion.clipMs, DEG = Math.PI / 180;
const clamp01 = v => Math.max(0, Math.min(1, v));
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const fore = h => Math.atan2(h.f[1] - h.e[1], h.f[0] - h.e[0]);

/** The carry row of a held picture ('holy-<god>' is held as the plain disc). */
export const heldRow = key => ITEM[key] ?? (key?.startsWith('holy-') ? ITEM.holy : null);

const pictureOf = item => {
  const row = item && (weapons.rows[item.id] ?? offhands.rows[item.id]);
  if (!row || row.unarmed) return null;
  const key = (row.icon ?? '').replace(/^item-/, '');
  return ITEM[key] ? key : null;
};

/**
 * H1-H3: the pictures a hero's worn gear puts in the hands. Each is {key, tier} or null.
 * @param {{worn: object, faith?: {god?: string}|null}} hero
 */
export function heldGear(hero) {
  const w = hero.worn, god = hero.faith?.god ?? null;
  const at = (item, key) => key ? { key, tier: item.tier ?? 1, ...(item.enchant ? { enchant: item.enchant } : {}) } : null;   // H23: an enchanted item glows
  let main = pictureOf(w.main), off = pictureOf(w.off);
  // H2: an off-hand weapon keeps its own picture when it is a one-handed handled one, else it is drawn as the dagger.
  if (w.off && weapons.rows[w.off.id] && !weapons.rows[w.off.id].unarmed) {
    const r = ITEM[off];
    off = r && !r.two && r.carry === 'handled' ? off : 'dagger';
  }
  // H3: an equipped Holy Symbol shows the holder's god's disc.
  if (off === 'holy' && god) off = 'holy-' + god;
  // H1: a two-hander or a left-hand weapon leaves no hand for the off item.
  if (main && (ITEM[main].two || ITEM[main].hand === 'l')) off = null;
  return { main: at(w.main, main), off: at(w.off, off), ranged: at(w.ranged, pictureOf(w.ranged)) };
}

const lookOf = meta => (meta.image ?? '').replace(/^cast-/, '').replace(/\.webp$/, '');

/**
 * C1: the sheet row an action plays. action: idle, walk, melee, melee-off (the off-hand jab of a dual wield),
 * hurt, death, cast, ranged, static. straight: a swing that names no weapon (the Bellow) plays the look's own melee
 * row, or the punch on an underwear or tourist look (1.7 clipRow with wpn null, render.js:841-846).
 */
export function rowFor(meta, action, gear, { straight = false } = {}) {
  const old = action === 'melee-off' ? 'melee' : action, look = lookOf(meta);
  let r = ROWS[old];
  if (r && typeof r === 'object') {
    const bare = /-unclad$/.test(look), tour = old === 'melee' && /-tourist$/.test(look);
    r = straight && !bare && !tour ? null : r[action === 'melee-off' || bare || straight ? 'fist' : gear?.main?.key ?? 'fist'];
  }
  const c = r && meta.clips[r];
  if (c && c.old === old) return r;
  return old === 'static' ? 'static' : meta.clips[old] ? old : 'idle';
}

/** C3: the step of a nine-step hold list at q (99ths of a clip of T ms). A step shorter than a paint joins the next. */
export function stepAt(hold, q, T, speed = 1, from = 0) {
  const min = HOLDS.paintMs * speed * 99 / T;
  let a = 0, i = from, left = 99;
  for (let k = 0; k < from; k++) left -= hold[k];
  for (; i < 8; i++) { a += hold[i]; left -= hold[i]; if (a >= min && left >= min) { if (q < a) break; q -= a; a = 0; } }
  return i;
}

const rowHold = (row, old) => {
  const ms = HOLDS[row + 'Ms'];
  return ms ? ms.map(v => v * 99 / HOLDS.rowMsOf) : HOLDS[old] ?? null;
};

/** The length of an action clip in ms (the action row's frames at its clipMs), C2. */
export function clipLength(meta, action) {
  const old = action === 'melee-off' ? 'melee' : action, c = meta.clips[old];
  return (MS[old] ?? MS.idle) * (c?.frames ?? 1);
}

/**
 * C2-C5: the frame on screen and the step it names, t ms into an action played on row.
 * Returns {frame, step, done}; step is undefined where the row has no hold list. done: the clip has ended.
 */
export function clipFrame(meta, action, row, t, { speed = 1, reduce = false } = {}) {
  const old = action === 'melee-off' ? 'melee' : action, off = action === 'melee-off';
  const c = meta.clips[old] ?? meta.clips[row], n = meta.clips[row]?.frames ?? 1, ms = MS[old] ?? MS.idle;
  if (old === 'idle' || old === 'static') return { frame: Math.floor(t / ms) % n, done: false };
  const T = ms * c.frames, done = t >= T, f = Math.min(Math.floor(t / ms), c.frames - 1);
  const launch = reduce ? STEPS.launch[old] ?? 0 : 0;
  if (row !== old) {
    const hold = rowHold(row, old), list = off ? STEPS.off : STEPS[row];
    if (!hold) return { frame: list ? list[Math.min(f, list.length - 1)] : Math.min(f, n - 1), done };
    const i = stepAt(hold, Math.min(t / T * 99, 99), T, speed, launch);
    return { frame: list ? list[i] : i, step: list && !off ? list[i] : i, off, done };
  }
  const list = old === 'death' ? OLD_DEATH[lookOf(meta)] : null;
  if (list) { const i = stepAt(HOLDS.death, Math.min(t / T * 99, 99), T, speed, launch); return { frame: list[i], step: i, done }; }
  return off ? { frame: f, off, done } : { frame: f, done };
}

/**
 * RC59: the beer row's frame `elapsed` ms after it began, by its play order ([frame, ms] pairs, 1.7 beerPlayFrame,
 * render.js:964-971): {frame}, or {after: the ms past its end} once it has played.
 */
export function beerStep(play, elapsed) {
  for (const [frame, ms] of play) { if (elapsed < ms) return { frame }; elapsed -= ms; }
  return { after: elapsed };
}

/** RC59: the beer hand is free: no two-hander or left-hand weapon (a bow), and the off hand empty or the Camera (1.7 beerHandFree). */
export function beerHandFree(hero) {
  const w = hero?.worn ?? {}, row = w.main && weapons.rows[w.main.id], key = pictureOf(w.main);
  if (row?.hands === 2 || (key && (ITEM[key].two || ITEM[key].hand === 'l'))) return false;
  return !w.off || w.off.id === 'camera';
}

/** W1: ms a run frame shows. */
export const walkFrameMs = () => Math.max(WALK.minFrameMs, ui.motion.moveMs / WALK.framesPerStep);

/* ---------------------------------------------------------------- where each picture sits */

/** H5: the tip angle of a handled item from a hand's forearm by the way it is carried. side: 1 right hand, -1 left. */
function tipAngle(style, hand, side) {
  const phi = fore(hand), s = Math.sin(phi);
  if (style === 'guard' && hand.a !== undefined) return hand.a * DEG;
  if (style === 'blade') {
    if (hand.a !== undefined) return hand.a * DEG;
    return phi + Math.max(0, s) * (G.pull * angDiff(Math.PI / 2, phi) + G.bladeBendDeg * DEG * side);
  }
  const t = s > 0 ? -phi : phi, u = Math.max(0, -Math.sin(t));
  const tip = t + u * G.pull * angDiff(-Math.PI / 2, t) - (style === 'guard' ? u * side * G.guardLean : 0);
  return style === 'guard' && Math.cos(tip) < 0 ? Math.PI - tip : tip;
}

/** S1-S3: the main weapon's turn on a step of an added melee row: {a (deg), row, hand, fists}. */
function rowSwing(key, grip, row, step, meta, gripsOf) {
  const up = row === 'heavy' && gripsOf('heavy')[2], left = !!up && up.l.f[1] < up.r.f[1];
  const a = SWING[left ? 'heavyl' : row]?.[key]?.[step];
  if (a == null) return {};
  const o = { a, row: true }, H = heldRow(key), cell = meta.cell, L = H.len * meta.stand;
  const r = grip.r.f, l = grip.l.f, d = Math.hypot(l[0] - r[0], l[1] - r[1]);
  if (row === 'thrust') {
    if (d >= cell * TWO.poleNear && d <= L * H.grip * TWO.poleFar) {
      o.a = Math.atan2(l[1] - r[1], l[0] - r[0]) / DEG;
      o.fists = d <= L * (H.grip - TWO.poleHead) ? ['r', 'l'] : ['r'];
    }
  } else if (row === 'heavy' && step > 1 && step < 8) {
    o.fists = ['r', 'l'];
    if (d < cell * TWO.near || d > cell * TWO.far) return o;
    const u = left ? l : r, v = left ? r : l, off = angDiff(Math.atan2(u[1] - v[1], u[0] - v[0]), a * DEG) / DEG;
    if (Math.abs(off) <= TWO.offDeg) { o.a = a + off; if (left) o.hand = 'l'; }
  }
  return o;
}

/** S5: the bow on the shoot row, square to the arrow's line from the string fist to the bow fist. */
function bowAim(grip) {
  const x = grip.l.f[0] - grip.r.f[0], y = grip.l.f[1] - grip.r.f[1], t = x > 0 ? Math.atan2(y, x) / DEG : 0;
  return { a: -90 + Math.max(-TWO.bowLeanDeg, Math.min(TWO.bowLeanDeg, t)), row: true };
}

/** H4: a two-hander carried level across the body, on the line through both fists of the row's first frame (rad). */
function acrossAngle(key, clip, first, offKey) {
  const H = heldRow(key);
  if (!H?.two || H.style !== 'across' || offKey || clip === 'death' || clip === 'ranged') return undefined;
  if (!first?.r || !first?.l || first.r.z < 0 || first.l.z < 0) return undefined;
  return Math.atan2(first.l.f[1] - first.r.f[1], first.l.f[0] - first.r.f[0]);
}

/**
 * Every held picture on one frame, in drawing order, with the body between them.
 * sheetData: the cast sheet's JSON (meta, frames with grips). at: {row, frame, step, off}.
 * artSize(key): the held picture's {w, h} in its own pixels.
 * Returns a list of layers, back to front:
 *   {body: true}
 *   {item: key, tier, x, y, rot, flatY, anchorX, anchorY, scale, mirror, enchant?}   (cell px; rot in rad; enchant: H23)
 *   {fingers: hand, x, y, r}             a disc of the body over the fist (H16)
 *   {fingers: hand, grip, runs: true}    the painted hand over an orb or tome (H17)
 */
export function heldLayers(sheetData, gear, at, artSize) {
  const meta = sheetData.meta, cell = meta.cell, floor = cell - (meta.foot ?? 0);
  const row = at.row, rowMeta = meta.clips[row];
  const clip = rowMeta?.old ?? row, add = rowMeta?.old ? row : null;
  const gripsOf = name => { const n = meta.clips[name]?.frames ?? 1; return Array.from({ length: n }, (_, i) => (sheetData.frames[name === 'static' ? 'static' : `${name}-${i}`] ?? sheetData.frames[`${name}-0`])?.grip); };
  const grip = (row === 'static' ? sheetData.frames.static : sheetData.frames[`${row}-${at.frame}`])?.grip;
  if (!grip) throw new Error(`no grip for ${meta.image} ${row} ${at.frame}`);
  const rowGrips = row === 'static' ? [grip] : gripsOf(row);
  const offSwing = !!at.off;

  let main = gear?.main ?? null, off = gear?.off ?? null, aimBow = false;
  if (main && heldRow(main.key).hand === 'l') off = null;
  // H18: the bow shot puts both hands' gear away; on a row drawn empty-handed the bow is drawn in the left hand.
  if (clip === 'ranged') {
    main = off = null;
    if (rowMeta?.bow === false) {
      const bow = [gear?.ranged, gear?.main].find(g => g?.key === 'bow');
      if (bow) { main = bow; aimBow = true; }
    }
  }
  const mainKey = main?.key ?? null, offKey = off?.key ?? null;

  let sw = add && mainKey && clip === 'melee' && at.step !== undefined && !offSwing ? rowSwing(mainKey, grip, add, at.step, meta, gripsOf) : null;
  // H19: a wand with an empty casting hand goes to that hand once its forearm is half way up.
  if (mainKey === 'wand' && clip === 'cast' && !offKey && clamp01(1 - Math.sin(fore(grip.l))) > 0.5) sw = { hand: 'l', fists: ['l'] };
  // H6: the idle and the walk keep the angle and the layer of their row's first frame.
  const keep = clip === 'idle' || clip === 'walk' ? rowGrips[0] : null, lay = keep || grip;
  const acr = mainKey ? acrossAngle(mainKey, clip, rowGrips[0], offKey) : undefined;
  if (acr !== undefined && (!sw || sw.a === undefined)) {
    const still = clip === 'idle' || clip === 'walk' || clip === 'static';
    sw = { ...sw, a: acr / DEG, row: true, fists: still ? ['r', 'l'] : sw?.fists ?? [heldRow(mainKey).hand] };
  }
  // H6: in a cast the weapon hand keeps the cast's first frame too.
  const keepMain = keep || (clip === 'cast' && !sw?.hand ? rowGrips[0] : null);
  const end = clip === 'death' ? rowGrips[rowGrips.length - 1] : null;
  const restY = hn => { const g = sheetData.frames['idle-0']?.grip?.[hn]; return g ? g.f[1] : floor * G.fallRestFloorShare; };
  const fallOf = hn => clamp01((grip[hn].f[1] - restY(hn)) / Math.max(1, floor - cell * G.fallFloorClear - restY(hn)));

  const items = [];
  if (mainKey) {
    const mh = sw?.hand ?? heldRow(mainKey).hand;
    items.push({
      key: mainKey, tier: main.tier, enchant: main.enchant ?? null, aim: clip === 'ranged' && aimBow, swing: sw,
      strike: clip === 'melee' && !offSwing && (at.step === undefined || (at.step > 2 && at.step < 7)),
      z: (keepMain || grip)[mh].z, carry: keepMain, fall: clip === 'death' ? fallOf(mh) : undefined,
    });
  }
  if (offKey) {
    items.push({
      key: offKey, tier: off.tier, enchant: off.enchant ?? null, hand: 'l', z: lay.l.z, carry: keep, fall: clip === 'death' ? fallOf('l') : undefined,
      style: clip === 'idle' || clip === 'static' ? heldRow(offKey).offIdle : undefined,
    });
  }
  if (add && mainKey) {
    if (add === 'shoot' && aimBow) items[0].swing = bowAim(grip);
    else if (!sw || sw.a === undefined) items[0].strike = false;
  }
  // L2: the striking weapon is drawn over the shield, and so is a sword the carry keeps in front of a shield hand behind.
  if (items.length > 1 && (items[0].strike || (clip === 'melee' && at.step === 7 && !offSwing) || (keep && grip.l.z < 0 && grip.r.z >= 0))) items.reverse();

  const place = it => {
    const H = heldRow(it.key), hk = it.swing?.hand ?? it.hand ?? H.hand, gh = grip[hk], f = gh.f, e = gh.e;
    const size = artSize(it.key), len = H.len * meta.stand, s = len / size.h, W = size.w * s;
    const phi = fore(gh), dying = it.fall !== undefined, fall = it.fall ?? 0;
    const base = { item: it.key, tier: it.tier, scale: s, flatY: 1, mirror: false };
    if (H.carry === 'strapped' || H.carry === 'book') {
      // H10, H12, H14: a shield on the forearm, a book held by its top edge; dying, it lies down along the forearm.
      const book = H.carry === 'book';
      const onArm = book ? -(len * G.bookInHand) / (Math.hypot(f[0] - e[0], f[1] - e[1]) || 1) : G.shieldOnForearm;
      const x = f[0] + (e[0] - f[0]) * onArm, y = f[1] + (e[1] - f[1]) * onArm;
      const lie = fall * angDiff(phi, Math.PI / 2), flat = 1 - fall * (1 - G.flat), up = len * (book ? G.bookUp : G.shieldUp);
      const low = (Math.abs(Math.cos(lie)) * (len - up) + Math.abs(Math.sin(lie)) * W / 2) * flat;
      return { ...base, x, y: Math.min(y, floor - low), rot: lie, flatY: flat, anchorX: 0.5, anchorY: up / len };
    }
    if (H.carry === 'palm') {
      // H11: under a hanging hand, over a raised one, never through the floor.
      const raised = clamp01(1 - Math.sin(phi)), past = cell * G.hand + (1 - raised) * len / 2 * G.orbInHand;
      const y = Math.min(f[1] + Math.sin(phi) * past - raised * len / 2 * G.orbOnHand, floor - len / 2);
      return { ...base, x: f[0] + Math.cos(phi) * past, y, rot: 0, anchorX: 0.5, anchorY: 0.5 };
    }
    // H5-H9, H13, H15: a handled item through the fist.
    const side = hk === 'r' ? 1 : -1, style = it.style || H.style;
    let tip = it.aim ? -Math.PI / 2 : it.swing?.a !== undefined ? it.swing.a * DEG : tipAngle(style, it.carry ? it.carry[hk] : gh, side);
    if (it.strike && Math.cos(tip) < 0) tip = Math.PI - tip;
    if (it.swing?.row && it.swing.a !== undefined) tip = it.swing.a * DEG;
    if (fall && (gh.a === undefined || H.style === 'upright' || H.style === 'across')) {
      const endTip = end ? tipAngle(H.style, end[hk], side) : tip;
      tip += fall * angDiff(Math.cos(endTip) < 0 ? Math.PI : 0, tip);
    }
    let sn = Math.sin(tip);
    const thick = W * G.thick, hi = (floor - f[1] - thick) / (len * H.grip), lo = -(floor - f[1]) / (len * (1 - H.grip));
    if (dying && (sn > hi || sn < lo)) {
      sn = Math.max(-1, Math.min(1, Math.max(Math.min(sn, hi), Math.min(lo, hi))));
      tip = Math.cos(tip) < 0 ? Math.PI - Math.asin(sn) : Math.asin(sn);
    }
    const under = f[1] + Math.max(sn * len * H.grip + Math.abs(Math.cos(tip)) * thick, -sn * len * (1 - H.grip)) - floor;
    const mirror = (!!it.hand && it.hand !== H.hand) !== !!it.aim;
    // H23: only a handled item carries its enchantment's glow (equip.js:495, :518-520; not a shield, orb or book).
    return { ...base, x: f[0], y: f[1] - (dying && under > 0 ? under : 0), rot: tip + Math.PI / 2, anchorX: 0.5, anchorY: H.grip, mirror, ...(it.enchant ? { enchant: it.enchant } : {}) };
  };

  const out = [];
  for (const it of items) if (it.z < 0) out.push(place(it));
  out.push({ body: true });
  for (const it of items) {
    if (it.z < 0) continue;
    out.push(place(it));
    const H = heldRow(it.key);
    if (H.carry === 'strapped') continue;
    for (const hn of it.swing?.fists ?? [it.hand ?? H.hand]) {
      if (grip[hn].z < 0) continue;   // H16: a hand behind the body shows no fingers
      if (H.carry === 'palm' || H.carry === 'book') out.push({ fingers: hn, grip: grip[hn], runs: true });
      else out.push({ fingers: hn, x: grip[hn].f[0], y: grip[hn].f[1], r: cell * G.fingers });
    }
  }
  return out;
}

/* ---------------------------------------------------------------- the painted hand (H17) */

const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const handMiddle = (hand, cell) => {
  const L = Math.hypot(hand.f[0] - hand.e[0], hand.f[1] - hand.e[1]) || 1;
  return [hand.f[0] + (hand.f[0] - hand.e[0]) / L * cell * G.hand, hand.f[1] + (hand.f[1] - hand.e[1]) / L * cell * G.hand];
};

/**
 * The look's hand colour: the median of the brightest pixels at the middle of each hand on its still.
 * px(x, y): [r, g, b, a] of the still's frame at cell px (x, y), or null outside it.
 */
export function skinOf(px, still, cell) {
  const rs = [], gs = [], bs = [], mid = a => a.sort((u, v) => u - v)[a.length >> 1], near = cell * SCAN.skinNear;
  for (const hn of ['r', 'l']) {
    const [cx, cy] = handMiddle(still[hn], cell), list = [];
    let top = 0;
    for (let y = Math.floor(cy - near) - 1; y <= cy + near + 1; y++) for (let x = Math.floor(cx - near) - 1; x <= cx + near + 1; x++) {
      const p = px(x, y);
      if (!p || p[3] < SCAN.alphaMin || Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > near) continue;
      const l = luma(p[0], p[1], p[2]); list.push([p, l]); if (l > top) top = l;
    }
    for (const [p, l] of list) if (l >= top * SCAN.skinTopShare) { rs.push(p[0]); gs.push(p[1]); bs.push(p[2]); }
  }
  return rs.length ? [mid(rs), mid(gs), mid(bs)] : null;
}

/** The painted hand at a grip as rows [x, y, width] in cell px: skin pixels joined to the hand's middle, and their dark line. */
export function handRuns(px, hand, skin, cell) {
  if (!skin) return [];
  const [cx, cy] = handMiddle(hand, cell), reach = cell * G.handReach, R = Math.ceil(reach) + 2;
  const x0 = Math.floor(cx) - R, y0 = Math.floor(cy) - R, n = 2 * R + 1, light = luma(...skin), mark = new Uint8Array(n * n), todo = [];
  const at = (x, y) => px(x0 + x, y0 + y);
  const dist = (x, y) => Math.hypot(x0 + x + 0.5 - cx, y0 + y + 0.5 - cy);
  const isSkin = (x, y) => {
    const p = at(x, y);
    return !!p && p[3] >= SCAN.alphaMin && Math.hypot(p[0] - skin[0], p[1] - skin[1], p[2] - skin[2]) <= SCAN.colourDistance
      && luma(p[0], p[1], p[2]) >= light * SCAN.lightShare && dist(x, y) <= reach;
  };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (dist(x, y) <= reach * SCAN.seedShare + 1 && isSkin(x, y)) { mark[y * n + x] = 1; todo.push(x, y); }
  while (todo.length) {
    const y = todo.pop(), x = todo.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const X = x + dx, Y = y + dy;
      if (X < 0 || Y < 0 || X >= n || Y >= n || mark[Y * n + X]) continue;
      if (isSkin(X, Y)) { mark[Y * n + X] = 1; todo.push(X, Y); continue; }
      const p = at(X, Y);
      if (p && p[3] >= SCAN.alphaMin && luma(p[0], p[1], p[2]) < light * SCAN.lightShare) mark[Y * n + X] = 2;
    }
  }
  const runs = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (mark[y * n + x]) {
    let x1 = x; while (x1 < n && mark[y * n + x1]) x1++;
    runs.push([x0 + x, y0 + y, x1 - x]); x = x1;
  }
  return runs;
}

/**
 * H22: how one held layer goes on screen, so its pixels match the body's. A picture painted finer than the figure
 * (the map: about 2 picture px to a cell px) is baked once down to the figure's own density, an area average, so
 * one texel is one cell pixel; one painted coarser (the paper doll) keeps its own pixels. Either way it is sampled
 * nearest, never through a smoothing or mipmap pass, and its point sits on a whole cell pixel.
 * art: the picture's {w, h}. Returns {w, h} of the texture to draw (baked or not), its scale, x, y and scaleMode.
 */
export function heldPixels(layer, art) {
  const k = Math.min(1, layer.scale), w = Math.max(1, Math.round(art.w * k)), h = Math.max(1, Math.round(art.h * k));
  return { w, h, baked: k < 1, scale: layer.scale * art.h / h, x: Math.round(layer.x), y: Math.round(layer.y), scaleMode: 'nearest' };
}

/** Worn gear's dull look (H21): a colour matrix, or null when the item draws as painted. */
export function wornMatrix(key, tier) {
  if (tier !== 0 || heldRow(key)?.keepWorn) return null;
  const t = R['worn-tint'], k = 1 - t.dim, g = t.desaturate, w = [0.3, 0.59, 0.11];
  const row = c => [0, 1, 2].map(j => k * (g * w[j] + (j === c ? 1 - g : 0)));
  return [...row(0), 0, 0, ...row(1), 0, 0, ...row(2), 0, 0, 0, 0, 0, 1, 0];
}
