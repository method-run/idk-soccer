// 3D-view board dressing: the SVG board is tilted with a pure (affine)
// rotateX, and the flat piece discs are replaced by standing meeple sprites
// positioned with the same affine map. All interaction still happens on the
// SVG layers underneath; sprites forward their clicks.

import { TEAM_META } from './data.js';
import { statLine } from './icons.js';
import { LOOKS, fallbackLook, portraitSVG } from './portraits.js';

// warm hex mixing for wood-toy shading
function mix(hex, target, k) {
  const n = parseInt(hex.slice(1), 16);
  const t = parseInt(target.slice(1), 16);
  const ch = (sh) => Math.round(((n >> sh) & 255) * (1 - k) + ((t >> sh) & 255) * k);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}
const lighten = (h, k) => mix(h, '#fff3d8', k);
const darken = (h, k) => mix(h, '#1a0e06', k);

export const TILT_DEG = 38;
export const TILT_YSCALE = 1.14; // vertical only — width must not overflow
const COS = Math.cos((TILT_DEG * Math.PI) / 180);

let layer = null;
let hudEl = null;
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
  if (!hudEl || hudEl.parentElement !== container) {
    hudEl = document.createElement('div');
    hudEl.id = 'hud-layer';
    container.appendChild(hudEl);
  }
  hudEl.innerHTML = '';
}

// SVG user coords -> px within #board-wrap, matching the CSS
// rotateX(TILT_DEG) scale(1, TILT_YSCALE) applied about the svg center.
// X is untouched so the goals never clip outside the container.
// NB: SVG elements have no offset* metrics — the meeple layer div shares the
// board-wrap box, so it is the measuring stick for the svg's layout size.
function project(u, v) {
  const vb = svgEl.viewBox.baseVal;
  const w0 = layer.clientWidth;
  const h0 = layer.clientHeight;
  const s = Math.min(w0 / vb.width, h0 / vb.height);
  const X = (w0 - vb.width * s) / 2 + u * s;
  const Y = (h0 - vb.height * s) / 2 + v * s;
  const cyp = h0 / 2;
  return {
    x: X,
    y: cyp + (Y - cyp) * COS * TILT_YSCALE,
    scale: s,
  };
}

// Classic wooden meeple: one solid silhouette in team color with warm
// top-left lighting, a soft offset contact shadow, faint grain, and an
// engraved number. Keepers get a painted gold base ring.
function meepleSVG(p) {
  const c = TEAM_META[p.team].color;
  const gk = p.role === 'GK';
  const gid = `mg-${p.team}-${p.num}`;
  return `<svg viewBox="0 0 40 52" aria-hidden="true">
    <defs>
      <linearGradient id="${gid}" x1="0.15" y1="0" x2="0.6" y2="1">
        <stop offset="0" stop-color="${lighten(c, 0.32)}"/>
        <stop offset="0.5" stop-color="${c}"/>
        <stop offset="1" stop-color="${darken(c, 0.3)}"/>
      </linearGradient>
    </defs>
    <ellipse cx="22" cy="48.3" rx="12" ry="3" fill="rgba(26,14,6,0.32)"/>
    ${gk ? '<ellipse cx="20" cy="46.8" rx="10.5" ry="2.4" fill="none" stroke="#d8a93c" stroke-width="2"/>' : ''}
    <path class="meeple-body" d="M20 3.5
      c4.2 0 6.8 2.9 6.8 6.1 c0 2 -0.9 3.7 -2.3 4.9
      c6 1.2 10.3 3.8 12.4 7 c1.7 2.6 0.8 5.2 -1.7 5.9
      c-2.3 0.7 -5.2 -0.3 -7.5 -2.1
      c-0.3 2.8 0.5 5.6 2.1 8.9 c1.5 3.1 0.3 4.9 -2.6 4.9
      h-3.2 c-1.6 0 -2.6 -0.9 -2.8 -2.4 l-1.2 -7.3 -1.2 7.3
      c-0.2 1.5 -1.2 2.4 -2.8 2.4 h-3.2
      c-2.9 0 -4.1 -1.8 -2.6 -4.9 c1.6 -3.3 2.4 -6.1 2.1 -8.9
      c-2.3 1.8 -5.2 2.8 -7.5 2.1 c-2.5 -0.7 -3.4 -3.3 -1.7 -5.9
      c2.1 -3.2 6.4 -5.8 12.4 -7 c-1.4 -1.2 -2.3 -2.9 -2.3 -4.9
      c0 -3.2 2.6 -6.1 6.8 -6.1 z"
      fill="url(#${gid})" stroke="${darken(c, 0.5)}" stroke-width="0.9"/>
    <path d="M14.8 8.4 q1.5 -3.1 4.6 -3.3" stroke="${lighten(c, 0.55)}"
      stroke-width="1.6" fill="none" stroke-linecap="round" opacity="0.8"/>
    <path d="M9.5 27.5 q10.5 4.2 21 0 M12.5 32 q7.5 2.8 15 0" stroke="${darken(c, 0.35)}"
      stroke-width="0.7" fill="none" opacity="0.35"/>
    <text x="20" y="23.5" text-anchor="middle" font-size="10" font-weight="800"
      fill="${darken(c, 0.55)}" opacity="0.85">${p.num}</text>
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
    const size = pos.scale * 48;
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
  const bs = bp.scale * 22;
  ballEl.style.width = `${bs}px`;
  ballEl.style.height = `${bs}px`;
  ballEl.style.left = `${bp.x - bs / 2}px`;
  ballEl.style.top = `${bp.y - bs}px`;
  ballEl.style.zIndex = 10 + Math.round(bc.v / 10) + 1;

  renderHud(state, ui, tileCenter);
}

// Action pills + stats card as HTML above the meeples (the SVG versions are
// hidden in 3D view — sprites would otherwise cover them).
function renderHud(state, ui, tileCenter) {
  hudEl.innerHTML = '';
  const w0 = layer.clientWidth;
  const h0 = layer.clientHeight;
  let ringWrap = null;
  if (ui.ring && ui.ring.items.length) {
    const p = state.players.find((q) => q.id === ui.ring.playerId);
    const c = tileCenter(p.x, p.y);
    const pos = project(c.u, c.v);
    ringWrap = document.createElement('div');
    ringWrap.className = 'hud-ring';
    for (const item of ui.ring.items) {
      const b = document.createElement('button');
      b.className = 'hud-pill';
      b.innerHTML = `<b>${item.label}</b>${item.sub ? `<span>${item.sub}</span>` : ''}`;
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        handlers?.onRingAction?.(item.key);
      });
      ringWrap.appendChild(b);
    }
    const approxW = ui.ring.items.length * 96;
    ringWrap.style.left = `${Math.max(approxW / 2 + 6, Math.min(w0 - approxW / 2 - 6, pos.x))}px`;
    ringWrap.style.top = `${Math.max(34, pos.y - pos.scale * 48 * 1.35)}px`;
    hudEl.appendChild(ringWrap);
  }
  if (ui.statsBox) {
    const p = state.players.find((q) => q.id === ui.statsBox);
    if (p) {
      const c = tileCenter(p.x, p.y);
      const pos = project(c.u, c.v);
      const look = LOOKS[p.lookId] || fallbackLook(p.name);
      const card = document.createElement('div');
      card.className = `hud-stats team-${p.team}`;
      card.innerHTML = `
        ${portraitSVG(look, { size: 44, team: p.team })}
        <div class="hud-stats-body">
          <b>#${p.num} ${p.name} <i>(${p.role})</i></b>
          <span>${statLine(p)}</span>
        </div>`;
      // Measure first, then pick the first placement that stays on the
      // board and doesn't collide with the action pills.
      card.style.visibility = 'hidden';
      hudEl.appendChild(card);
      const cw = card.offsetWidth;
      const chh = card.offsetHeight;
      const mh = pos.scale * 48 * 1.3; // meeple height
      let ring = null;
      if (ringWrap) {
        const hr = hudEl.getBoundingClientRect();
        const rr = ringWrap.getBoundingClientRect();
        ring = {
          l: rr.left - hr.left - 4,
          t: rr.top - hr.top - 4,
          r: rr.right - hr.left + 4,
          b: rr.bottom - hr.top + 4,
        };
      }
      const fits = ([l, t]) => l >= 4 && t >= 4 && l + cw <= w0 - 4 && t + chh <= h0 - 4;
      const collides = ([l, t]) =>
        !!ring && l < ring.r && l + cw > ring.l && t < ring.b && t + chh > ring.t;
      const candidates = [
        [pos.x + 24, pos.y - mh * 0.8], // right of the piece
        [pos.x - 24 - cw, pos.y - mh * 0.8], // left
        [pos.x - cw / 2, pos.y + 10], // below
        [pos.x + 24, pos.y + 10], // low-right
        [pos.x - cw / 2, (ring ? ring.t : pos.y - mh) - chh - 6], // above the pills
      ];
      const spot =
        candidates.find((s) => fits(s) && !collides(s)) ||
        candidates.find((s) => fits(s)) ||
        candidates[0];
      card.style.left = `${Math.max(4, Math.min(w0 - cw - 4, spot[0]))}px`;
      card.style.top = `${Math.max(4, Math.min(h0 - chh - 4, spot[1]))}px`;
      card.style.visibility = '';
    }
  }
}

export function setMeeplesVisible(on) {
  if (layer) layer.style.display = on ? '' : 'none';
  if (hudEl) hudEl.style.display = on ? '' : 'none';
}
