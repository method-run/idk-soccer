// SVG board renderer. Builds the static pitch once, then updates piece
// transforms + highlight layers on every render(). CSS transitions on the
// piece groups give us free movement animation.
//
// The engine's board is 7 wide (x) by 12 deep (y); we render it LANDSCAPE:
// depth runs along the screen's horizontal axis. Home defends the left
// goal and attacks the right (engine y=0 maps to the right edge).

import { W, H, GOAL_COLS, TEAM_META } from './data.js';
import { STAT_ICONS } from './icons.js';
import { LOOKS, fallbackLook, headMarkup } from './portraits.js';
import { formationTargets, activePlayerId, PASS_MAX, cheb, shotTN, passTN } from './game.js';

const NS = 'http://www.w3.org/2000/svg';
export const T = 48; // tile px
const PAD = 12;
const GR = 38; // goal cell depth (per row)
const GD = GR * 2; // total goal depth
const VW = PAD * 2 + GD * 2 + H * T;
const VH = PAD * 2 + W * T;

// Tile (x,y) -> screen top-left corner.
const tx = (y) => PAD + GD + (H - 1 - y) * T;
const ty = (x) => PAD + x * T;
const cx = (x, y) => tx(y) + T / 2;
const cy = (x) => ty(x) + T / 2;
// Field edges in screen coords.
const FX0 = PAD + GD;
const FX1 = PAD + GD + H * T;
const FY0 = PAD;
const FY1 = PAD + W * T;

function el(tag, attrs = {}, parent = null) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

export function initBoard(svg, state, handlers) {
  svg.setAttribute('viewBox', `0 0 ${VW} ${VH}`);
  svg.innerHTML = '';

  // arrowhead marker for drift-preview arrows
  const defs = el('defs', {}, svg);
  const marker = el('marker', {
    id: 'arrowhead', markerWidth: 7, markerHeight: 7,
    refX: 5, refY: 3.5, orient: 'auto',
  }, defs);
  el('path', { d: 'M0,0 L7,3.5 L0,7 Z', class: 'arrowhead' }, marker);

  const gField = el('g', { class: 'layer-field' }, svg);
  drawPitch(gField);

  const ctx = {
    svg,
    handlers,
    goalCellEls: {},
    gTargets: null,
    gHighlights: null,
    gPlayers: null,
    playerEls: new Map(),
    ballEl: null,
  };

  // Right goal is attacked by HOME (engine y=0 end), left by AWAY.
  ctx.goalCellEls.right = drawGoal(svg, ctx, 'right');
  ctx.goalCellEls.left = drawGoal(svg, ctx, 'left');

  ctx.gTargets = el('g', { class: 'layer-targets' }, svg);
  ctx.gArrows = el('g', { class: 'layer-arrows' }, svg);
  ctx.gHighlights = el('g', { class: 'layer-highlights' }, svg);
  ctx.gPathPreview = el('g', { class: 'layer-path' }, svg);
  ctx.gPlayers = el('g', { class: 'layer-players' }, svg);
  svg.addEventListener('mouseleave', () => handlers.onTileHover?.(null));

  for (const p of state.players) {
    const g = el('g', { class: `piece team-${p.team}`, 'data-id': p.id }, ctx.gPlayers);
    el('circle', { class: 'disc', r: 17, cx: 0, cy: 0 }, g);
    if (p.role === 'GK') el('circle', { class: 'gk-ring', r: 20, cx: 0, cy: 0 }, g);
    el('circle', { class: 'active-ring', r: 22, cx: 0, cy: 0 }, g);
    const t = el('text', { class: 'num', x: 0, y: 1 }, g);
    t.textContent = p.num;
    g.addEventListener('click', (ev) => {
      ev.stopPropagation();
      handlers.onPlayerClick?.(p.id);
    });
    ctx.playerEls.set(p.id, g);
  }

  const ball = el('g', { class: 'ball' }, svg);
  el('circle', { r: 8, cx: 0, cy: 0, class: 'ball-outer' }, ball);
  el('circle', { r: 3, cx: 0, cy: 0, class: 'ball-inner' }, ball);
  ctx.ballEl = ball;

  // top-most interactive layers: action ring and stats card
  ctx.gRing = el('g', { class: 'layer-ring' }, svg);
  ctx.gStats = el('g', { class: 'layer-stats' }, svg);

  // Tile click-catcher (pieces stopPropagation)
  svg.addEventListener('click', (ev) => {
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    const x = Math.floor((p.y - FY0) / T);
    const y = H - 1 - Math.floor((p.x - FX0) / T);
    if (x >= 0 && x < W && y >= 0 && y < H) handlers.onTileClick?.(x, y);
  });

  return ctx;
}

function drawPitch(g) {
  el('rect', { x: 0, y: 0, width: VW, height: VH, class: 'grass-bg' }, g);
  // striped mowing pattern (one stripe per depth row)
  for (let y = 0; y < H; y++) {
    el('rect', {
      x: tx(y), y: FY0, width: T, height: W * T,
      class: y % 2 ? 'stripe-a' : 'stripe-b',
    }, g);
  }
  // grid
  for (let i = 0; i <= H; i++) {
    el('line', { x1: FX0 + i * T, y1: FY0, x2: FX0 + i * T, y2: FY1, class: 'grid' }, g);
  }
  for (let j = 0; j <= W; j++) {
    el('line', { x1: FX0, y1: FY0 + j * T, x2: FX1, y2: FY0 + j * T, class: 'grid' }, g);
  }
  // pitch markings
  const MID = FX0 + (H / 2) * T;
  el('rect', { x: FX0, y: FY0, width: H * T, height: W * T, class: 'chalk', fill: 'none' }, g);
  el('line', { x1: MID, y1: FY0, x2: MID, y2: FY1, class: 'chalk' }, g);
  el('circle', { cx: MID, cy: FY0 + (W * T) / 2, r: T * 1.15, class: 'chalk', fill: 'none' }, g);
  // penalty boxes (goal width +2 wide, 3 deep, at each end)
  const boxY = ty(GOAL_COLS[0] - 1);
  const boxH = (GOAL_COLS.length + 2) * T;
  el('rect', { x: FX0, y: boxY, width: 3 * T, height: boxH, class: 'chalk', fill: 'none' }, g);
  el('rect', { x: FX1 - 3 * T, y: boxY, width: 3 * T, height: boxH, class: 'chalk', fill: 'none' }, g);
}

// A goal is a 3-wide x 2-deep box off the field's short edge, split into 6
// aim cells: {col: 0..2 (screen top->bottom), high: true = deep row (away
// from the field)}.
function drawGoal(svg, ctx, side) {
  const g = el('g', { class: `goal goal-${side}` }, svg);
  const gy = ty(GOAL_COLS[0]); // goal mouth spans the central goal columns
  const gx = side === 'right' ? FX1 : PAD;
  el('rect', { x: gx, y: gy, width: GD, height: 3 * T, class: 'goal-box' }, g);
  // net texture
  for (let i = 1; i < 12; i++) {
    el('line', { x1: gx, y1: gy + (i * 3 * T) / 12, x2: gx + GD, y2: gy + (i * 3 * T) / 12, class: 'net' }, g);
  }
  for (let i = 1; i < 4; i++) {
    el('line', { x1: gx + (i * GD) / 4, y1: gy, x2: gx + (i * GD) / 4, y2: gy + 3 * T, class: 'net' }, g);
  }
  const cells = [];
  for (const high of [false, true]) {
    for (let col = 0; col < 3; col++) {
      // "high" is the row farther from the field.
      const cellX = side === 'right' ? (high ? gx + GR : gx) : high ? gx : gx + GR;
      const cell = el('g', { class: 'goal-cell' }, g);
      el('rect', {
        x: cellX, y: gy + col * T, width: GR, height: T, class: 'goal-cell-rect',
      }, cell);
      const label = el('text', {
        x: cellX + GR / 2, y: gy + col * T + T / 2 + 5, class: 'goal-cell-tn',
      }, cell);
      cell.addEventListener('click', (ev) => {
        ev.stopPropagation();
        ctx.handlers.onGoalCellClick?.({ col, high }, side);
      });
      cells.push({ el: cell, rect: cell.firstChild, label, col, high });
    }
  }
  return cells;
}

// ---------------------------------------------------------------------------

export function render(ctx, state, ui) {
  // pieces
  for (const p of state.players) {
    const g = ctx.playerEls.get(p.id);
    g.setAttribute('transform', `translate(${cx(p.x, p.y)},${cy(p.x)})`);
    g.classList.toggle('is-active', ui.activeId === p.id && !ui.aiTurn);
    g.classList.toggle('is-ai-active', ui.activeId === p.id && !!ui.aiTurn);
  }
  // ball
  if (state.ball.carrier) {
    ctx.ballEl.setAttribute(
      'transform',
      `translate(${cx(state.ball.x, state.ball.y) + 13},${cy(state.ball.x) + 13})`
    );
  } else {
    ctx.ballEl.setAttribute(
      'transform',
      `translate(${cx(state.ball.x, state.ball.y)},${cy(state.ball.x)})`
    );
  }

  // formation target ghosts for the human's team
  ctx.gTargets.innerHTML = '';
  if (ui.showTargetsFor) {
    const targets = formationTargets(state, ui.showTargetsFor);
    for (const [pid, t] of Object.entries(targets)) {
      const d = el('path', {
        d: `M ${cx(t.x, t.y)} ${cy(t.x) - 7} l 7 7 l -7 7 l -7 -7 Z`,
        class: `target-ghost team-${ui.showTargetsFor}`,
      }, ctx.gTargets);
      d.dataset.pid = pid;
    }
  }

  // tile highlights
  ctx.gHighlights.innerHTML = '';
  for (const h of ui.highlights || []) {
    const r = el('rect', {
      x: tx(h.y) + 3, y: ty(h.x) + 3, width: T - 6, height: T - 6, rx: 8,
      class: `hl hl-${h.kind}`,
    }, ctx.gHighlights);
    if (h.label != null) {
      el('text', { x: tx(h.y) + T - 8, y: ty(h.x) + 14, class: 'hl-tn' }, ctx.gHighlights)
        .textContent = h.label;
    }
    r.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ctx.handlers.onTileClick?.(h.x, h.y);
    });
    if (h.kind === 'move') {
      r.addEventListener('mouseenter', () => ctx.handlers.onTileHover?.(h.x, h.y));
      r.addEventListener('mouseleave', () => ctx.handlers.onTileHover?.(null));
    }
  }
  ctx.gPathPreview.innerHTML = ''; // renderPathPreview redraws on hover

  // goal aim cells
  for (const side of ['left', 'right']) {
    const aiming = ui.aimGoal === side;
    for (const c of ctx.goalCellEls[side]) {
      c.el.classList.toggle('aimable', aiming);
      c.label.textContent = aiming && ui.aimTNs ? ui.aimTNs({ col: c.col, high: c.high }) : '';
    }
  }

  // drift-preview arrows
  ctx.gArrows.innerHTML = '';
  for (const a of ui.arrows || []) {
    el('line', {
      x1: cx(a.from[0], a.from[1]), y1: cy(a.from[0]),
      x2: cx(a.to[0], a.to[1]), y2: cy(a.to[0]),
      class: `drift-arrow team-${a.team}`,
      'marker-end': 'url(#arrowhead)',
    }, ctx.gArrows);
  }

  renderRing(ctx, state, ui);
  renderStatsCard(ctx, state, ui);
}

// Hover path preview: the exact route a move would take, with a running
// step count (3/5) per square and a warning shield wherever a contested
// control check would trigger.
// preview: { from: {x,y}, tiles: [{x, y, label, challenge}] } or null.
export function renderPathPreview(ctx, preview) {
  ctx.gPathPreview.innerHTML = '';
  if (!preview) return;
  const pts = [
    [cx(preview.from.x, preview.from.y), cy(preview.from.x)],
    ...preview.tiles.map((t) => [cx(t.x, t.y), cy(t.x)]),
  ];
  el('polyline', {
    points: pts.map(([px, py]) => `${px},${py}`).join(' '),
    class: 'path-line',
    'marker-end': 'url(#arrowhead)',
  }, ctx.gPathPreview);
  preview.tiles.forEach((t, i) => {
    const px = cx(t.x, t.y);
    const py = cy(t.x);
    const last = i === preview.tiles.length - 1;
    if (!t.challenge) {
      el('circle', { cx: px, cy: py, r: 3.5, class: 'path-dot' }, ctx.gPathPreview);
    } else {
      // amber warning shield: a contested control check happens here
      const g = el('g', { class: 'path-challenge' }, ctx.gPathPreview);
      el('title', {}, g).textContent = 'Contested control check!';
      el('path', {
        d: STAT_ICONS.ctl.path,
        'fill-rule': 'evenodd',
        transform: `translate(${px - 11},${py - 12}) scale(0.95)`,
      }, g);
      const ex = el('text', { x: px, y: py + 4, class: 'path-challenge-mark' }, g);
      ex.textContent = '!';
    }
    const label = el('text', {
      x: px + (last ? 0 : 14),
      y: py + (last ? -14 : -10),
      class: `path-count${last ? ' path-count-final' : ''}`,
    }, ctx.gPathPreview);
    label.textContent = t.label;
  });
}

// Action ring: pill buttons arced around the selected player.
function renderRing(ctx, state, ui) {
  ctx.gRing.innerHTML = '';
  const ring = ui.ring;
  if (!ring || !ring.items.length) return;
  const p = state.players.find((q) => q.id === ring.playerId);
  if (!p) return;
  const px = cx(p.x, p.y);
  const py = cy(p.x);
  const n = ring.items.length;
  const spread = n === 1 ? [-90] : n === 2 ? [-135, -45] : [-160, -90, -20];
  const flip = py < FY0 + 70; // near the top edge: arc below instead
  const R = 54;
  ring.items.forEach((item, i) => {
    const ang = ((flip ? -spread[i] : spread[i]) * Math.PI) / 180;
    let bx = px + R * Math.cos(ang);
    let by = py + R * Math.sin(ang);
    bx = Math.max(48, Math.min(VW - 48, bx));
    const g = el('g', {
      class: `ring-item${item.enabled === false ? ' ring-disabled' : ''}`,
      'data-action': item.key,
    }, ctx.gRing);
    el('rect', { x: bx - 42, y: by - 14, width: 84, height: 28, rx: 14 }, g);
    const t1 = el('text', { x: bx, y: by - 2, class: 'ring-label' }, g);
    t1.textContent = item.label;
    const t2 = el('text', { x: bx, y: by + 10, class: 'ring-sub' }, g);
    t2.textContent = item.sub || '';
    g.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (item.enabled !== false) ctx.handlers.onRingAction?.(item.key);
    });
  });
}

// Stats card next to a footballer (view 3 / inspecting an opponent).
function renderStatsCard(ctx, state, ui) {
  ctx.gStats.innerHTML = '';
  if (!ui.statsBox) return;
  const p = state.players.find((q) => q.id === ui.statsBox);
  if (!p) return;
  const bw = 186;
  const bh = 66;
  let bx = cx(p.x, p.y) + 26;
  let by = cy(p.x) - bh / 2;
  if (bx + bw > VW - 4) bx = cx(p.x, p.y) - 26 - bw;
  by = Math.max(4, Math.min(VH - bh - 4, by));
  const g = el('g', { class: `stats-box team-${p.team}` }, ctx.gStats);
  el('rect', { x: bx, y: by, width: bw, height: bh, rx: 8, class: 'stats-bg' }, g);
  el('rect', { x: bx, y: by, width: bw, height: 20, rx: 8, class: 'stats-head' }, g);
  // portrait
  const look = LOOKS[p.lookId] || fallbackLook(p.name);
  const pg = el('g', {
    transform: `translate(${bx + 2},${by + 22}) scale(0.65)`,
  }, g);
  pg.innerHTML = headMarkup(look);
  const name = el('text', { x: bx + 8, y: by + 14, class: 'stats-name' }, g);
  name.textContent = `#${p.num} ${p.name} (${p.role})`;
  const cells = [
    ['spd', p.spd, bx + 46, by + 24],
    ['sho', `+${p.sho}`, bx + 116, by + 24],
    ['pas', `+${p.pas}`, bx + 46, by + 43],
    ['ctl', `+${p.ctl}`, bx + 116, by + 43],
  ];
  for (const [key, val, ix, iy] of cells) {
    const ic = STAT_ICONS[key];
    const icon = el('path', {
      d: ic.path,
      class: 'stats-ico',
      transform: `translate(${ix},${iy}) scale(0.58)`,
    }, g);
    if (ic.fillRule) icon.setAttribute('fill-rule', ic.fillRule);
    el('title', {}, icon).textContent = `${ic.label} · ${ic.full}`;
    const t = el('text', { x: ix + 18, y: iy + 11, class: 'stats-line' }, g);
    t.textContent = val;
  }
}

// Which goal (screen side) a team attacks.
export function goalSideFor(team) {
  return team === 'home' ? 'right' : 'left';
}

// SVG user-space center of a tile — used by the meeple layer's projection.
export function tileCenterUV(x, y) {
  return { u: cx(x, y), v: cy(x) };
}
