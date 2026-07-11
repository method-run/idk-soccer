// App controller: screens, human interaction state machine, AI turn driver.

import { makeDice } from './dice.js';
import { FORMATIONS, TEAM_META } from './data.js';
import {
  newMatch, activePlayerId, getPlayer, carrier, reachable, moveRange,
  doMove, doPass, doSteal, doShoot, canSteal, canShoot, canPass,
  setFormation, endTurn, cheb, shotDistance, shotTN, passTN, stealTN,
  PASS_MAX, goalCells, defendingKeeper,
} from './game.js';
import { aiChooseFormation, aiChooseMove, aiChooseAction, aiPickDive, p2d6 } from './ai.js';
import { initBoard, render, goalSideFor } from './render.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let state = null;
let dice = null;
let board = null;
const ui = {
  mode: 'pve',
  phase: 'idle', // idle | aim-pass | aim-shot | busy
  aiTurn: false,
  seenEvents: 0,
};

// ---------------------------------------------------------------------------
// Screens & overlays

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.remove('visible');
  $(id).classList.add('visible');
}

function overlay(html) {
  $('overlay-content').innerHTML = html;
  $('overlay').classList.add('visible');
}

function hideOverlay() {
  $('overlay').classList.remove('visible');
}

async function banner(text, cls = '', ms = 1400) {
  const b = $('banner');
  b.textContent = text;
  b.className = `show ${cls}`;
  await sleep(ms);
  b.className = '';
}

// ---------------------------------------------------------------------------
// Match lifecycle

function startMatch(mode) {
  ui.mode = mode;
  ui.phase = 'idle';
  ui.seenEvents = 0;
  dice = makeDice();
  state = newMatch({ mode });
  board = initBoard($('board'), state, {
    onTileClick: handleTileClick,
    onGoalCellClick: handleGoalCell,
    onPlayerClick: handlePlayerClick,
  });
  $('log').innerHTML = '';
  $('name-home').textContent = TEAM_META.home.name;
  $('name-away').textContent = TEAM_META.away.name;
  show('screen-match');
  beginTurn();
}

function isHumanTurn() {
  return ui.mode === 'pvp' || state.activeTeam === 'home';
}

function humanDefends(team) {
  // Is the keeper's dive picked by a human when `team` shoots?
  return ui.mode === 'pvp' || team === 'away';
}

async function beginTurn() {
  ui.phase = 'idle';
  ui.aiTurn = !isHumanTurn();
  renderAll();
  if (state.over) return showFullTime();
  if (ui.aiTurn) runAiTurn();
  else if (ui.mode === 'pvp') {
    await banner(`${TEAM_META[state.activeTeam].name} to play`, `team-${state.activeTeam}`, 900);
  }
}

// ---------------------------------------------------------------------------
// Rendering

function renderAll() {
  const activeId = state.over ? null : activePlayerId(state);
  const highlights = [];
  if (!state.over && isHumanTurn() && ui.phase === 'idle' && !state.moved) {
    for (const key of reachable(state, activeId).keys()) {
      const [x, y] = key.split(',').map(Number);
      const p = getPlayer(state, activeId);
      if (x === p.x && y === p.y) continue;
      highlights.push({ x, y, kind: 'move' });
    }
  }
  if (ui.phase === 'aim-pass') {
    const c = carrier(state);
    for (let x = 0; x < 7; x++) {
      for (let y = 0; y < 12; y++) {
        const d = cheb(c.x, c.y, x, y);
        if (d >= 1 && d <= PASS_MAX) {
          highlights.push({ x, y, kind: 'pass', label: passTN(d) });
        }
      }
    }
  }
  render(board, state, {
    activeId,
    aiTurn: ui.aiTurn,
    highlights,
    showTargetsFor: !state.over && isHumanTurn() ? state.activeTeam : null,
    aimGoal: ui.phase === 'aim-shot' ? goalSideFor(state.activeTeam) : null,
    aimTNs: (cell) => {
      const c = carrier(state);
      return c ? shotTN(shotDistance(state, c), cell) : '';
    },
  });
  renderTopbar();
  renderMoverChip(activeId);
  renderButtons();
  renderCards();
  renderLog();
}

function renderTopbar() {
  $('score-home').textContent = state.score.home;
  $('score-away').textContent = state.score.away;
  $('turn-label').textContent = state.over
    ? 'Full time'
    : `Turn ${state.turn}/${state.maxTurns}`;
  const t = TEAM_META[state.activeTeam];
  $('turn-team').textContent = state.over ? '' : `${t.name} to play`;
  $('turn-team').style.color = t.color;
}

function renderMoverChip(activeId) {
  const chip = $('mover-chip');
  if (!activeId) {
    chip.innerHTML = '';
    return;
  }
  const p = getPlayer(state, activeId);
  const hasBall = state.ball.carrier === p.id;
  chip.innerHTML = `
    <span class="chip-badge team-${p.team}">#${p.num}</span>
    <span class="chip-name">${p.name}${hasBall ? ' ⚽' : ''}</span>
    <span class="chip-stats">SPD ${p.spd} · SHO +${p.sho} · PAS +${p.pas} · CTL +${p.ctl}</span>
    <span class="chip-hint">${hint(p, hasBall)}</span>`;
}

function hint(p, hasBall) {
  if (ui.aiTurn) return 'Computer is thinking…';
  if (ui.phase === 'aim-pass') return 'Tap a square to pass there (number = target to beat)';
  if (ui.phase === 'aim-shot') return 'Tap a goal cell to aim your shot';
  if (!state.moved) {
    return hasBall
      ? `Dribble up to ${moveRange(state, p)} (ball slows you), then act`
      : `Move up to ${moveRange(state, p)} — land on the ball to take it`;
  }
  return 'Choose an action or end your turn';
}

function renderButtons() {
  const human = isHumanTurn() && !state.over && ui.phase !== 'busy';
  const aiming = ui.phase === 'aim-pass' || ui.phase === 'aim-shot';
  $('btn-pass').disabled = !human || aiming || !canPass(state);
  $('btn-shoot').disabled = !human || aiming || !canShoot(state);
  $('btn-steal').disabled = !human || aiming || !canSteal(state);
  $('btn-end').disabled = !human || aiming;
  $('btn-cancel').hidden = !aiming;
  if (canSteal(state)) {
    const c = carrier(state);
    $('btn-steal').textContent = `Steal (vs ${stealTN(c.ctl)})`;
  } else {
    $('btn-steal').textContent = 'Steal';
  }
}

function renderCards() {
  const wrap = $('cards');
  wrap.innerHTML = '';
  const team = state.activeTeam;
  for (const f of FORMATIONS) {
    const b = document.createElement('button');
    b.className = 'card';
    const active = state.formations[team] === f.id;
    if (active) b.classList.add('card-active');
    b.disabled =
      !isHumanTurn() || state.over || ui.phase !== 'idle' ||
      (state.formationSwitched && !active) || active;
    b.innerHTML = `<b>${f.short}</b><span>${f.name.replace(/^[\d-]+ /, '')}</span>`;
    b.addEventListener('click', () => {
      if (setFormation(state, f.id).ok) renderAll();
    });
    wrap.appendChild(b);
  }
}

const DIE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

function renderLog() {
  const log = $('log');
  const evs = state.events;
  for (; ui.seenEvents < evs.length; ui.seenEvents++) {
    const e = evs[ui.seenEvents];
    const div = document.createElement('div');
    div.className = `log-entry log-${e.type} team-${e.team}`;
    let roll = '';
    if (e.roll) {
      roll = ` <span class="log-dice">${DIE[e.roll.a]}${DIE[e.roll.b]}${
        e.roll.success ? '✓' : '✗'
      }</span>`;
    }
    div.innerHTML = `<span class="log-turn">T${e.turn}</span> ${e.text}${roll}`;
    log.appendChild(div);
  }
  log.scrollTop = log.scrollHeight;
}

// ---------------------------------------------------------------------------
// Human interaction

function handleTileClick(x, y) {
  if (!isHumanTurn() || state.over) return;
  if (ui.phase === 'idle' && !state.moved) {
    const res = doMove(state, dice, x, y);
    if (res.ok) {
      renderAll();
      maybeAutoEnd();
    }
  } else if (ui.phase === 'aim-pass') {
    const res = doPass(state, dice, x, y);
    if (res.ok) {
      ui.phase = 'idle';
      renderAll();
      flashRoll(res.roll, res.roll.success ? 'Pass: on target!' : 'Pass: astray!');
      maybeAutoEnd();
    }
  }
}

function handlePlayerClick(pid) {
  // Tapping any piece: peek at its stats in the chip; tapping a tile under
  // it still moves via the tile handler when relevant.
  const p = getPlayer(state, pid);
  const active = !state.over && activePlayerId(state) === pid;
  if (active) return; // chip already shows the mover
  const chip = $('mover-chip');
  chip.innerHTML = `
    <span class="chip-badge team-${p.team}">#${p.num}</span>
    <span class="chip-name">${p.name} (${p.role})</span>
    <span class="chip-stats">SPD ${p.spd} · SHO +${p.sho} · PAS +${p.pas} · CTL +${p.ctl}</span>
    <span class="chip-hint">tap elsewhere to dismiss</span>`;
  setTimeout(() => renderMoverChip(state.over ? null : activePlayerId(state)), 2500);
}

async function handleGoalCell(cell, side) {
  if (ui.phase !== 'aim-shot' || side !== goalSideFor(state.activeTeam)) return;
  ui.phase = 'busy';
  renderAll();
  const shooterTeam = state.activeTeam;
  let dive;
  if (ui.mode === 'pve') {
    dive = aiPickDive(state, dice);
  } else {
    dive = await pvpDivePick(shooterTeam);
  }
  await resolveShot(cell, dive);
}

async function resolveShot(aim, dive) {
  const res = doShoot(state, dice, aim, dive);
  renderAll();
  if (res.outcome === 'goal') await banner('⚽ GOAL!!!', 'goal', 1800);
  else if (res.outcome === 'save') await banner('🧤 SAVED!', 'save');
  else if (res.outcome === 'rebound') await banner('💥 Off the frame!', 'save');
  else await banner('Off target…', '', 1000);
  beginTurn();
}

// PvP blind dive: hand the device over, defender picks, then resolve.
function pvpDivePick(shooterTeam) {
  const defender = shooterTeam === 'home' ? 'away' : 'home';
  return new Promise((resolve) => {
    overlay(`
      <h2 class="team-${defender}">${TEAM_META[defender].name} keeper!</h2>
      <p>${TEAM_META[shooterTeam].name} are shooting. No peeking at their aim —
      pick where your keeper dives.</p>
      <div class="dive-grid" id="dive-grid"></div>`);
    buildDiveGrid($('dive-grid'), (cell) => {
      hideOverlay();
      resolve(cell);
    });
  });
}

function buildDiveGrid(grid, onPick) {
  const names = ['Left', 'Center', 'Right'];
  for (const high of [true, false]) {
    for (let col = 0; col < 3; col++) {
      const b = document.createElement('button');
      b.className = 'dive-cell';
      b.textContent = `${high ? 'High' : 'Low'} ${names[col]}`;
      b.addEventListener('click', () => onPick({ col, high }));
      grid.appendChild(b);
    }
  }
}

function flashRoll(roll, text) {
  banner(
    `${DIE[roll.a]}${DIE[roll.b]} ${roll.total} vs ${roll.tn} — ${text}`,
    roll.success ? 'save' : '',
    1100
  );
}

function maybeAutoEnd() {
  // If the mover has moved and has no possible action, don't auto-end —
  // let the player read the board. (Deliberate: End Turn is one tap.)
}

// Buttons
$('btn-pass').addEventListener('click', () => {
  if (!canPass(state)) return;
  ui.phase = 'aim-pass';
  renderAll();
});
$('btn-shoot').addEventListener('click', () => {
  if (!canShoot(state)) return;
  ui.phase = 'aim-shot';
  renderAll();
});
$('btn-cancel').addEventListener('click', () => {
  ui.phase = 'idle';
  renderAll();
});
$('btn-steal').addEventListener('click', () => {
  if (!canSteal(state)) return;
  const res = doSteal(state, dice);
  renderAll();
  flashRoll(res.roll, res.roll.success ? 'Ball WON!' : 'Held off!');
});
$('btn-end').addEventListener('click', () => {
  if (!isHumanTurn() || state.over) return;
  endTurn(state, dice);
  beginTurn();
});

// ---------------------------------------------------------------------------
// AI turn

async function runAiTurn() {
  ui.phase = 'busy';
  ui.aiTurn = true;
  const turnBefore = state.turn;
  await sleep(600);
  const f = aiChooseFormation(state);
  if (f) {
    setFormation(state, f);
    renderAll();
    await sleep(500);
  }
  const mv = aiChooseMove(state, dice);
  if (mv) {
    doMove(state, dice, mv.x, mv.y);
    renderAll();
    await sleep(650);
  }
  if (!state.over && !state.actionUsed && state.turn === turnBefore) {
    const act = aiChooseAction(state, dice);
    if (act.type === 'steal') {
      const res = doSteal(state, dice);
      renderAll();
      flashRoll(res.roll, res.roll.success ? 'Steal!' : 'Held off');
      await sleep(900);
    } else if (act.type === 'pass') {
      const res = doPass(state, dice, act.x, act.y);
      renderAll();
      await sleep(700);
    } else if (act.type === 'shoot') {
      let dive;
      if (humanDefends(state.activeTeam)) {
        dive = await new Promise((resolve) => {
          overlay(`
            <h2 class="team-home">Shot incoming!</h2>
            <p>${TEAM_META[state.activeTeam].name} are shooting.
            Pick where your keeper dives.</p>
            <div class="dive-grid" id="dive-grid"></div>`);
          buildDiveGrid($('dive-grid'), (cell) => {
            hideOverlay();
            resolve(cell);
          });
        });
      } else {
        dive = aiPickDive(state, dice);
      }
      await resolveShot(act.aim, dive);
      return; // resolveShot continues the loop via beginTurn
    }
  }
  if (!state.over && state.turn === turnBefore) endTurn(state, dice);
  beginTurn();
}

// ---------------------------------------------------------------------------
// Full time / menu / help

function showFullTime() {
  const { home, away } = state.score;
  const result =
    home === away
      ? "It's a draw!"
      : `${TEAM_META[home > away ? 'home' : 'away'].name} win!`;
  overlay(`
    <h2>Full time</h2>
    <p class="final-score">${TEAM_META.home.name} ${home} – ${away} ${TEAM_META.away.name}</p>
    <p>${result}</p>
    <div class="overlay-buttons">
      <button id="btn-rematch">Rematch</button>
      <button id="btn-menu">Menu</button>
    </div>`);
  $('btn-rematch').addEventListener('click', () => {
    hideOverlay();
    startMatch(ui.mode);
  });
  $('btn-menu').addEventListener('click', () => {
    hideOverlay();
    show('screen-menu');
  });
}

$('btn-pve').addEventListener('click', () => startMatch('pve'));
$('btn-pvp').addEventListener('click', () => startMatch('pvp'));
$('btn-help').addEventListener('click', () => {
  $('help').classList.add('visible');
});
$('help-close').addEventListener('click', () => {
  $('help').classList.remove('visible');
});
$('btn-quit').addEventListener('click', () => show('screen-menu'));

// PWA service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

show('screen-menu');
