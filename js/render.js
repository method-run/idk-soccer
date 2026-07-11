// SVG board renderer. Builds the static pitch once, then updates piece
// transforms + highlight layers on every render(). CSS transitions on the
// piece groups give us free movement animation.

import { W, H, TEAM_META } from './data.js';
import { formationTargets, activePlayerId, PASS_MAX, cheb, shotTN, passTN } from './game.js';

const NS = 'http://www.w3.org/2000/svg';
export const T = 48; // tile px
const PAD = 12;
const GR = 38; // goal cell row height
const GD = GR * 2; // goal depth
const VW = PAD * 2 + W * T;
const VH = PAD * 2 + GD * 2 + H * T;

const fx = (x) => PAD + x * T;
const fy = (y) => PAD + GD + y * T;
const cx = (x) => fx(x) + T / 2;
const cy = (y) => fy(y) + T / 2;

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
    goalCellEls: { home: [], away: [] }, // keyed by defending... see below
    gTargets: null,
    gHighlights: null,
    gPlayers: null,
    playerEls: new Map(),
    ballEl: null,
  };

  // Goals: top goal is attacked by HOME, bottom by AWAY.
  ctx.goalCellEls.top = drawGoal(svg, ctx, 'top');
  ctx.goalCellEls.bottom = drawGoal(svg, ctx, 'bottom');

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

  // Tile click-catcher (under pieces visually but pieces stopPropagation)
  svg.addEventListener('click', (ev) => {
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    const x = Math.floor((p.x - PAD) / T);
    const y = Math.floor((p.y - PAD - GD) / T);
    if (x >= 0 && x < W && y >= 0 && y < H) handlers.onTileClick?.(x, y);
  });

  return ctx;
}

function drawPitch(g) {
  el('rect', { x: 0, y: 0, width: VW, height: VH, class: 'grass-bg' }, g);
  // striped mowing pattern
  for (let y = 0; y < H; y++) {
    el('rect', {
      x: fx(0), y: fy(y), width: W * T, height: T,
      class: y % 2 ? 'stripe-a' : 'stripe-b',
    }, g);
  }
  // grid
  for (let x = 0; x <= W; x++) {
    el('line', { x1: fx(x), y1: fy(0), x2: fx(x), y2: fy(H), class: 'grid' }, g);
  }
  for (let y = 0; y <= H; y++) {
    el('line', { x1: fx(0), y1: fy(y), x2: fx(W), y2: fy(y), class: 'grid' }, g);
  }
  // pitch markings
  el('rect', { x: fx(0), y: fy(0), width: W * T, height: H * T, class: 'chalk', fill: 'none' }, g);
  el('line', { x1: fx(0), y1: fy(6), x2: fx(W), y2: fy(6), class: 'chalk' }, g);
  el('circle', { cx: cx(3), cy: fy(6), r: T * 1.15, class: 'chalk', fill: 'none' }, g);
  // penalty boxes (5 wide x 2 deep)
  el('rect', { x: fx(1), y: fy(0), width: 5 * T, height: 2 * T, class: 'chalk', fill: 'none' }, g);
  el('rect', { x: fx(1), y: fy(H - 2), width: 5 * T, height: 2 * T, class: 'chalk', fill: 'none' }, g);
}

// A goal is a 3-wide x 2-deep box off the field edge, split into 6 aim cells.
// {col: 0..2 (screen left->right), high: true = deep row (away from field)}.
function drawGoal(svg, ctx, side) {
  const g = el('g', { class: `goal goal-${side}` }, svg);
  const gx = fx(2);
  const gy = side === 'top' ? PAD : fy(H);
  el('rect', { x: gx, y: gy, width: 3 * T, height: GD, class: 'goal-box' }, g);
  // net texture
  for (let i = 1; i < 12; i++) {
    el('line', { x1: gx + (i * 3 * T) / 12, y1: gy, x2: gx + (i * 3 * T) / 12, y2: gy + GD, class: 'net' }, g);
  }
  for (let i = 1; i < 4; i++) {
    el('line', { x1: gx, y1: gy + (i * GD) / 4, x2: gx + 3 * T, y2: gy + (i * GD) / 4, class: 'net' }, g);
  }
  const cells = [];
  for (const high of [false, true]) {
    for (let col = 0; col < 3; col++) {
      // For the top goal, "high" is the row farther from the field (screen top).
      const rowTop =
        side === 'top' ? (high ? gy : gy + GR) : high ? gy + GR : gy;
      const cell = el('g', { class: 'goal-cell' }, g);
      el('rect', {
        x: gx + col * T, y: rowTop, width: T, height: GR, class: 'goal-cell-rect',
      }, cell);
      const label = el('text', {
        x: gx + col * T + T / 2, y: rowTop + GR / 2 + 4, class: 'goal-cell-tn',
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
    g.setAttribute('transform', `translate(${cx(p.x)},${cy(p.y)})`);
    g.classList.toggle('is-active', ui.activeId === p.id && !ui.aiTurn);
    g.classList.toggle('is-ai-active', ui.activeId === p.id && !!ui.aiTurn);
  }
  // ball
  if (state.ball.carrier) {
    ctx.ballEl.setAttribute(
      'transform',
      `translate(${cx(state.ball.x) + 13},${cy(state.ball.y) + 13})`
    );
  } else {
    ctx.ballEl.setAttribute('transform', `translate(${cx(state.ball.x)},${cy(state.ball.y)})`);
  }

  // formation target ghosts for the human's team
  ctx.gTargets.innerHTML = '';
  if (ui.showTargetsFor) {
    const targets = formationTargets(state, ui.showTargetsFor);
    for (const [pid, t] of Object.entries(targets)) {
      const d = el('path', {
        d: `M ${cx(t.x)} ${cy(t.y) - 7} l 7 7 l -7 7 l -7 -7 Z`,
        class: `target-ghost team-${ui.showTargetsFor}`,
      }, ctx.gTargets);
      d.dataset.pid = pid;
    }
  }

  // tile highlights
  ctx.gHighlights.innerHTML = '';
  for (const h of ui.highlights || []) {
    const r = el('rect', {
      x: fx(h.x) + 3, y: fy(h.y) + 3, width: T - 6, height: T - 6, rx: 8,
      class: `hl hl-${h.kind}`,
    }, ctx.gHighlights);
    if (h.label != null) {
      el('text', { x: fx(h.x) + T - 8, y: fy(h.y) + 14, class: 'hl-tn' }, ctx.gHighlights)
        .textContent = h.label;
    }
    r.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ctx.handlers.onTileClick?.(h.x, h.y);
    });
  }

  // goal aim cells
  for (const side of ['top', 'bottom']) {
    const aiming = ui.aimGoal === side;
    for (const c of ctx.goalCellEls[side]) {
      c.el.classList.toggle('aimable', aiming);
      c.label.textContent = aiming && ui.aimTNs ? ui.aimTNs({ col: c.col, high: c.high }) : '';
    }
  }
}

// Which goal (screen side) a team attacks.
export function goalSideFor(team) {
  return team === 'home' ? 'top' : 'bottom';
}
