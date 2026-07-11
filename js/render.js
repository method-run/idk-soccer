// SVG board renderer. Builds the static pitch once, then updates piece
// transforms + highlight layers on every render(). CSS transitions on the
// piece groups give us free movement animation.
//
// The engine's board is 7 wide (x) by 12 deep (y); we render it LANDSCAPE:
// depth runs along the screen's horizontal axis. Home defends the left
// goal and attacks the right (engine y=0 maps to the right edge).

import { W, H, TEAM_META } from './data.js';
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
  ctx.gHighlights = el('g', { class: 'layer-highlights' }, svg);
  ctx.gPlayers = el('g', { class: 'layer-players' }, svg);

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
  el('rect', { x: FX0, y: FY0, width: H * T, height: W * T, class: 'chalk', fill: 'none' }, g);
  el('line', { x1: FX0 + 6 * T, y1: FY0, x2: FX0 + 6 * T, y2: FY1, class: 'chalk' }, g);
  el('circle', { cx: FX0 + 6 * T, cy: FY0 + (W * T) / 2, r: T * 1.15, class: 'chalk', fill: 'none' }, g);
  // penalty boxes (5 wide x 2 deep, at each end)
  el('rect', { x: FX0, y: ty(1), width: 2 * T, height: 5 * T, class: 'chalk', fill: 'none' }, g);
  el('rect', { x: FX1 - 2 * T, y: ty(1), width: 2 * T, height: 5 * T, class: 'chalk', fill: 'none' }, g);
}

// A goal is a 3-wide x 2-deep box off the field's short edge, split into 6
// aim cells: {col: 0..2 (screen top->bottom), high: true = deep row (away
// from the field)}.
function drawGoal(svg, ctx, side) {
  const g = el('g', { class: `goal goal-${side}` }, svg);
  const gy = ty(2); // goal mouth spans board columns x=2..4
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
  }

  // goal aim cells
  for (const side of ['left', 'right']) {
    const aiming = ui.aimGoal === side;
    for (const c of ctx.goalCellEls[side]) {
      c.el.classList.toggle('aimable', aiming);
      c.label.textContent = aiming && ui.aimTNs ? ui.aimTNs({ col: c.col, high: c.high }) : '';
    }
  }
}

// Which goal (screen side) a team attacks.
export function goalSideFor(team) {
  return team === 'home' ? 'right' : 'left';
}
