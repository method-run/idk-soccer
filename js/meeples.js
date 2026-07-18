// 3D-view board dressing: the SVG board is tilted with a pure (affine)
// rotateX, and the flat piece discs are replaced by standing meeple sprites
// positioned with the same affine map. All interaction still happens on the
// SVG layers underneath; sprites forward their clicks.

import { LOOKS, fallbackLook } from './portraits.js';
import { TEAM_META } from './data.js';

export const TILT_DEG = 38;
export const TILT_SCALE = 1.14;
const COS = Math.cos((TILT_DEG * Math.PI) / 180);

let layer = null;
let svgEl = null;
const sprites = new Map();
let ballEl = null;
let handlers = null;

export function initMeeples(container, svg, h) {
  svgEl = svg;
  handlers = h;
  layer = container.querySelector('#meeple-layer');
  layer.innerHTML = '';
  sprites.clear();
  ballEl = null;
}

// SVG user coords -> px within #board-wrap, matching the CSS
// rotateX(TILT_DEG) scale(TILT_SCALE) applied about the svg center.
// NB: SVG elements have no offset* metrics — the meeple layer div shares the
// board-wrap box, so it is the measuring stick for the svg's layout size.
function project(u, v) {
  const vb = svgEl.viewBox.baseVal;
  const w0 = layer.clientWidth;
  const h0 = layer.clientHeight;
  const s = Math.min(w0 / vb.width, h0 / vb.height);
  const X = (w0 - vb.width * s) / 2 + u * s;
  const Y = (h0 - vb.height * s) / 2 + v * s;
  const cxp = w0 / 2;
  const cyp = h0 / 2;
  return {
    x: cxp + (X - cxp) * TILT_SCALE,
    y: cyp + (Y - cyp) * COS * TILT_SCALE,
    scale: s * TILT_SCALE,
  };
}

function meepleSVG(p) {
  const look = LOOKS[p.lookId] || fallbackLook(p.name);
  const skin = { pale: '#f2cfae', light: '#eebd93', tan: '#d9a06b', brown: '#a06a3f', deep: '#71482a' }[look.skin] || '#eebd93';
  const hair = { black: '#191919', dark: '#2e2118', brown: '#5a3d22', blond: '#d9b04a', ginger: '#b5541e' }[look.hair] || '#2e2118';
  const meta = TEAM_META[p.team];
  const gk = p.role === 'GK';
  return `<svg viewBox="0 0 40 52" aria-hidden="true">
    <ellipse cx="20" cy="48" rx="13" ry="3.6" fill="rgba(0,0,0,0.35)"/>
    <path class="meeple-body" d="M20 14
      C 26 14 28 18 27 22
      C 31 24 34 28 35 34
      C 36 40 33 42 30 41
      C 28 40.4 26.5 39 25.5 37.5
      L 27 46 Q 20 49 13 46 L 14.5 37.5
      C 13.5 39 12 40.4 10 41
      C 7 42 4 40 5 34
      C 6 28 9 24 13 22
      C 12 18 14 14 20 14 Z"
      fill="${meta.color}" stroke="${gk ? '#f2c14e' : 'rgba(0,0,0,0.5)'}" stroke-width="${gk ? 2 : 1.2}"/>
    <circle cx="20" cy="10" r="7" fill="${skin}"/>
    <path d="M13.6 9 q1 -5.6 6.4 -5.6 q5.4 0 6.4 5.6 q-2.6 -3 -6.4 -3 q-3.8 0 -6.4 3 z" fill="${hair}"/>
    <circle cx="17.6" cy="10.4" r="0.9" fill="#111"/>
    <circle cx="22.4" cy="10.4" r="0.9" fill="#111"/>
    <text x="20" y="36" text-anchor="middle" font-size="11" font-weight="800"
      fill="#fff" stroke="rgba(0,0,0,0.4)" stroke-width="2" paint-order="stroke">${p.num}</text>
  </svg>`;
}

// cx/cy in SVG user units for a tile, matching render.js geometry.
export function renderMeeples(state, ui, tileCenter) {
  if (!layer) return;
  const activeId = ui.activeId;
  for (const p of state.players) {
    let el = sprites.get(p.id);
    if (!el) {
      el = document.createElement('div');
      el.className = `meeple team-${p.team}`;
      el.innerHTML = meepleSVG(p);
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        handlers?.onPlayerClick?.(p.id);
      });
      layer.appendChild(el);
      sprites.set(p.id, el);
    }
    const c = tileCenter(p.x, p.y);
    const pos = project(c.u, c.v);
    const size = pos.scale * 44;
    el.style.width = `${size}px`;
    el.style.height = `${size * 1.3}px`;
    el.style.left = `${pos.x - size / 2}px`;
    el.style.top = `${pos.y - size * 1.3 + size * 0.16}px`;
    el.style.zIndex = 10 + Math.round(c.v / 10);
    el.classList.toggle('meeple-active', activeId === p.id && !ui.aiTurn);
    el.classList.toggle('meeple-ai-active', activeId === p.id && !!ui.aiTurn);
  }
  // ball
  if (!ballEl) {
    ballEl = document.createElement('div');
    ballEl.className = 'meeple-ball';
    ballEl.innerHTML = `<svg viewBox="0 0 20 20">
      <ellipse cx="10" cy="18" rx="6" ry="1.6" fill="rgba(0,0,0,0.3)"/>
      <circle cx="10" cy="9" r="7" fill="#fff" stroke="#222" stroke-width="1"/>
      <path d="M10 6.5 l2.4 1.7 -0.9 2.8 h-3 l-0.9 -2.8 z" fill="#222"/>
    </svg>`;
    layer.appendChild(ballEl);
  }
  const bc = tileCenter(state.ball.x, state.ball.y);
  const bp = project(bc.u + (state.ball.carrier ? 14 : 0), bc.v + (state.ball.carrier ? 10 : 0));
  const bs = bp.scale * 20;
  ballEl.style.width = `${bs}px`;
  ballEl.style.height = `${bs}px`;
  ballEl.style.left = `${bp.x - bs / 2}px`;
  ballEl.style.top = `${bp.y - bs}px`;
  ballEl.style.zIndex = 10 + Math.round(bc.v / 10) + 1;
}

export function setMeeplesVisible(on) {
  if (layer) layer.style.display = on ? '' : 'none';
}
