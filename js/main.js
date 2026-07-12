// App controller: screens, human interaction state machine, AI turn driver,
// undo/redo history, and the dice cinematic.

import { makeDice } from './dice.js';
import { W, H, FORMATIONS, TEAM_META, PLAYER_POOL } from './data.js';
import {
  newMatch, activePlayerId, getPlayer, carrier, reachable, moveRange,
  doMove, doPass, doSteal, doShoot, canSteal, canShoot, canPass,
  setFormation, selectMover, driftPreview, endTurn, cheb, stepsLeft,
  shotDistance, shotTN, passTN, stealTN, PASS_MAX, getFormation, supportMod,
} from './game.js';
import { aiChooseFormation, aiChooseMove, aiChooseAction, aiPickDive, p2d6 } from './ai.js';
import { initBoard, render, goalSideFor } from './render.js';

const $ = (id) => document.getElementById(id);
const rawSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sleep = (ms) => rawSleep(ms / ui.speed);

let state = null;
let dice = null;
let board = null;
const ui = {
  mode: 'pve',
  phase: 'idle', // idle | aim-pass | aim-shot | busy
  aiTurn: false,
  seenEvents: 0,
  speed: 1,
  session: 0, // bumped on new match / quit; stale async loops check it
  paused: false,
  playerView: 1, // 0 minimal | 1 action ring | 2 stats
  inspectId: null, // stats peek at a non-selected player
  skipRoll: false,
};
const hist = { undo: [], redo: [] };

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

// ---------------------------------------------------------------------------
// Draft & lineup assignment

let draft = null;

function playerCardHTML(p, extra = '') {
  return `
    <span class="pc-role pc-${p.role}">${p.role}</span>
    <b class="pc-name">${p.name}</b>
    <span class="pc-stats">SPD ${p.spd} · SHO +${p.sho}<br>PAS +${p.pas} · CTL +${p.ctl}</span>
    ${extra}`;
}

function snakeOrder(rounds = 7) {
  const order = [];
  for (let r = 0; r < rounds; r++) {
    order.push(...(r % 2 ? ['away', 'home'] : ['home', 'away']));
  }
  return order;
}

function startDraft(mode) {
  ui.session++;
  draft = {
    mode,
    remaining: [...PLAYER_POOL],
    picks: { home: [], away: [] },
    order: snakeOrder(),
    idx: 0,
  };
  show('screen-draft');
  renderDraft();
  maybeAiPick();
}

function draftTeamNow() {
  return draft.order[draft.idx];
}

function draftDone() {
  return draft.idx >= draft.order.length;
}

function isHumanDrafter(team) {
  return draft.mode === 'pvp' || team === 'home';
}

function pickable(team, p) {
  const picks = draft.picks[team];
  const hasGK = picks.some((q) => q.role === 'GK');
  const left = 7 - picks.length;
  if (left <= 0) return false;
  if (p.role === 'GK') return !hasGK;
  return !(left === 1 && !hasGK); // last pick must be the keeper if missing
}

function draftValue(team, p) {
  const picks = draft.picks[team];
  const count = (role) => picks.filter((q) => q.role === role).length;
  let v = p.spd * 0.7 + p.sho + p.pas + p.ctl;
  if (p.role !== 'GK' && count(p.role) < 2) v += 1.2; // roster balance
  if (p.role === 'GK') v += picks.length >= 3 ? 1.5 : -1; // keeper mid-draft
  return v;
}

function doPick(p) {
  const team = draftTeamNow();
  draft.remaining = draft.remaining.filter((q) => q.id !== p.id);
  draft.picks[team].push(p);
  draft.idx++;
  renderDraft();
  if (draftDone()) {
    setTimeout(startAssign, 400);
  } else {
    maybeAiPick();
  }
}

async function maybeAiPick() {
  const mySession = ui.session;
  while (!draftDone() && !isHumanDrafter(draftTeamNow())) {
    await rawSleep(350);
    if (ui.session !== mySession || !draft) return;
    const team = draftTeamNow();
    const candidates = draft.remaining.filter((p) => pickable(team, p));
    const best = candidates.reduce((a, b) =>
      draftValue(team, b) > draftValue(team, a) ? b : a
    );
    doPick(best);
    return; // doPick re-enters maybeAiPick; avoid double-stepping
  }
}

function renderDraft() {
  if (draftDone()) {
    $('draft-sub').textContent = 'Draft complete!';
  } else {
    const team = draftTeamNow();
    const meta = TEAM_META[team];
    $('draft-title').textContent = `Draft — pick ${Math.floor(draft.idx / 2) + 1} of 7`;
    $('draft-sub').innerHTML = `<span class="team-${team}"><b>${meta.name}</b></span> ${
      isHumanDrafter(team) ? 'are on the clock' : 'are thinking…'
    } (snake order)`;
  }
  for (const team of ['home', 'away']) {
    const el = $(`draft-roster-${team}`);
    el.innerHTML =
      `<h3 class="team-${team}">${TEAM_META[team].name}</h3>` +
      draft.picks[team]
        .map((p) => `<div class="roster-line"><i class="pc-role pc-${p.role}">${p.role}</i> ${p.name}</div>`)
        .join('');
  }
  const pool = $('draft-pool');
  pool.innerHTML = '';
  const team = draftDone() ? null : draftTeamNow();
  const humanTurn = team && isHumanDrafter(team);
  for (const p of draft.remaining) {
    const b = document.createElement('button');
    b.className = 'pcard';
    b.disabled = !humanTurn || !pickable(team, p);
    b.innerHTML = playerCardHTML(p);
    b.addEventListener('click', () => {
      if (draft && !draftDone() && isHumanDrafter(draftTeamNow()) && pickable(draftTeamNow(), p)) {
        doPick(p);
      }
    });
    pool.appendChild(b);
  }
}

// Lineup assignment: order the 6 outfielders into formation slots.
let assign = null;
const SLOT_LABELS = ['Defense 1', 'Defense 2', 'Middle 1', 'Middle 2', 'Attack 1', 'Attack 2'];

function autoLineup(picks) {
  const gk = picks.find((p) => p.role === 'GK');
  const rest = picks.filter((p) => p !== gk);
  const take = (arr, n, score) => {
    const sorted = [...arr].sort((a, b) => score(b) - score(a));
    const chosen = sorted.slice(0, n);
    return [chosen, arr.filter((p) => !chosen.includes(p))];
  };
  const [df, afterDf] = take(rest, 2, (p) => p.ctl * 2 + p.spd * 0.3);
  const [mf, fw] = take(afterDf, 2, (p) => p.pas * 2 + p.spd * 0.3);
  fw.sort((a, b) => b.sho - a.sho);
  return { gk, outfield: [...df, ...mf, ...fw] };
}

function startAssign() {
  const humanTeams = draft.mode === 'pvp' ? ['home', 'away'] : ['home'];
  assign = {
    mode: draft.mode,
    queue: humanTeams,
    idx: 0,
    rosters: {},
    selected: null,
  };
  for (const team of ['home', 'away']) {
    if (!humanTeams.includes(team)) assign.rosters[team] = autoLineup(draft.picks[team]);
  }
  showAssignScreen();
}

function showAssignScreen() {
  const team = assign.queue[assign.idx];
  assign.current = autoLineup(draft.picks[team]);
  assign.selected = null;
  $('assign-title').innerHTML = `<span class="team-${team}">${TEAM_META[team].name}</span>: set your lineup`;
  show('screen-assign');
  renderAssign();
}

function renderAssign() {
  const team = assign.queue[assign.idx];
  const list = $('assign-list');
  list.innerHTML = '';
  const gkRow = document.createElement('div');
  gkRow.className = 'assign-row assign-gk';
  gkRow.innerHTML = `<span class="slot-label">Keeper</span>${playerCardHTML(assign.current.gk)}`;
  list.appendChild(gkRow);
  assign.current.outfield.forEach((p, i) => {
    const row = document.createElement('button');
    row.className = `assign-row${assign.selected === i ? ' assign-selected' : ''}`;
    row.innerHTML = `<span class="slot-label">${SLOT_LABELS[i]}</span>${playerCardHTML(p)}`;
    row.addEventListener('click', () => {
      if (assign.selected === null) {
        assign.selected = i;
      } else {
        const o = assign.current.outfield;
        [o[assign.selected], o[i]] = [o[i], o[assign.selected]];
        assign.selected = null;
      }
      renderAssign();
    });
    list.appendChild(row);
  });
}

$('assign-auto').addEventListener('click', () => {
  const team = assign.queue[assign.idx];
  assign.current = autoLineup(draft.picks[team]);
  assign.selected = null;
  renderAssign();
});
$('assign-done').addEventListener('click', () => {
  const team = assign.queue[assign.idx];
  assign.rosters[team] = assign.current;
  assign.idx++;
  if (assign.idx < assign.queue.length) {
    showAssignScreen();
  } else {
    const rosters = assign.rosters;
    const mode = assign.mode;
    draft = null;
    assign = null;
    startMatch(mode, rosters);
  }
});
$('draft-quit').addEventListener('click', () => {
  draft = null;
  ui.session++;
  show('screen-menu');
});
$('assign-quit').addEventListener('click', () => {
  draft = null;
  assign = null;
  ui.session++;
  show('screen-menu');
});

function startFlow(mode) {
  if (mode !== 'cvc' && $('opt-draft').checked) startDraft(mode);
  else startMatch(mode);
}

function startMatch(mode, rosters = null) {
  ui.mode = mode;
  ui.lastRosters = rosters;
  ui.phase = 'idle';
  ui.seenEvents = 0;
  ui.session++;
  ui.speed = 1;
  ui.paused = false;
  ui.playerView = 1;
  ui.inspectId = null;
  ui.diveResolve = null;
  hist.undo.length = 0;
  hist.redo.length = 0;
  $('btn-speed').hidden = mode !== 'cvc';
  $('btn-speed').textContent = '1×';
  $('btn-pause').hidden = mode !== 'cvc';
  $('btn-pause').textContent = '⏸';
  dice = makeDice();
  state = newMatch({ mode, rosters });
  board = initBoard($('board'), state, {
    onTileClick: handleTileClick,
    onGoalCellClick: handleGoalCell,
    onPlayerClick: handlePlayerClick,
    onRingAction: handleRingAction,
  });
  $('log').innerHTML = '';
  $('dice-tray').innerHTML = '';
  show('screen-match');
  beginTurn();
}

function isHumanTurn() {
  if (ui.mode === 'cvc') return false;
  return ui.mode === 'pvp' || state.activeTeam === 'home';
}

function humanDefends(team) {
  if (ui.mode === 'cvc') return false;
  return ui.mode === 'pvp' || team === 'away';
}

async function beginTurn() {
  hist.undo.length = 0;
  hist.redo.length = 0;
  ui.phase = 'idle';
  ui.aiTurn = !isHumanTurn();
  ui.playerView = 1;
  ui.inspectId = null;
  renderAll();
  if (state.over) return showFullTime();
  if (ui.aiTurn) runAiTurn();
  else if (ui.mode === 'pvp') {
    await banner(`${TEAM_META[state.activeTeam].name} to play`, `team-${state.activeTeam}`, 900);
  }
}

// ---------------------------------------------------------------------------
// Undo / redo (until you end your turn)

function snapshot() {
  return { state: structuredClone(state), dice: dice.getState() };
}

function pushHistory() {
  if (!isHumanTurn()) return;
  hist.undo.push(snapshot());
  hist.redo.length = 0;
}

function restore(snap) {
  state = snap.state;
  dice.setState(snap.dice);
  ui.phase = 'idle';
  ui.inspectId = null;
  rebuildLog();
  renderAll();
}

function doUndo() {
  if (!hist.undo.length || !isHumanTurn() || ui.phase === 'busy') return;
  hist.redo.push(snapshot());
  restore(hist.undo.pop());
}

function doRedo() {
  if (!hist.redo.length || !isHumanTurn() || ui.phase === 'busy') return;
  hist.undo.push(snapshot());
  restore(hist.redo.pop());
}

function rebuildLog() {
  $('log').innerHTML = '';
  $('dice-tray').innerHTML = '';
  ui.seenEvents = 0;
  renderLog(true);
}

// ---------------------------------------------------------------------------
// Rendering

function renderAll() {
  const human = isHumanTurn() && !state.over;
  const activeId = state.over ? null : activePlayerId(state);
  const selected = activeId;
  const selPlayer = selected ? getPlayer(state, selected) : null;

  const highlights = [];
  if (human && ui.phase === 'idle' && stepsLeft(state) > 0 && ui.playerView !== 0) {
    for (const key of reachable(state, selected).keys()) {
      const [x, y] = key.split(',').map(Number);
      if (x === selPlayer.x && y === selPlayer.y) continue;
      highlights.push({ x, y, kind: 'move' });
    }
  }
  if (ui.phase === 'aim-pass') {
    const c = carrier(state);
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        const d = cheb(c.x, c.y, x, y);
        if (d >= 1 && d <= PASS_MAX) {
          highlights.push({ x, y, kind: 'pass', label: `${pct(c.pas, passTN(d))}%` });
        }
      }
    }
  }

  render(board, state, {
    activeId,
    aiTurn: ui.aiTurn,
    highlights,
    showTargetsFor:
      !state.over && (isHumanTurn() || ui.mode === 'cvc') ? state.activeTeam : null,
    aimGoal:
      ui.phase === 'aim-shot' || ui.phase === 'pick-dive'
        ? goalSideFor(state.activeTeam)
        : null,
    aimTNs: (cell) => {
      if (ui.phase === 'pick-dive') return ''; // defender can't see the aim
      const c = carrier(state);
      if (!c) return '';
      const tn = shotTN(shotDistance(state, c), cell);
      return `${pct(c.sho, tn)}%`;
    },
    arrows: human
      ? driftPreview(state).map((s) => ({ ...s, team: state.activeTeam }))
      : null,
    ring: human && ui.phase === 'idle' && ui.playerView === 1 ? buildRing(selected) : null,
    statsBox:
      ui.inspectId || (human && ui.playerView === 2 && ui.phase === 'idle' ? selected : null),
  });
  renderClock();
  renderTeamPanels();
  renderMoverChip(activeId);
  renderButtons();
  renderLog();
}

function pct(mod, tn) {
  return Math.round(p2d6(mod, tn) * 100);
}

function buildRing(selectedId) {
  const items = [];
  const p = getPlayer(state, selectedId);
  if (canShoot(state) && state.ball.carrier === selectedId) {
    const tn = shotTN(shotDistance(state, p), { col: 1, high: false });
    items.push({ key: 'shoot', label: 'Shoot', sub: `~${pct(p.sho, tn)}% on target` });
  }
  if (canPass(state) && state.ball.carrier === selectedId) {
    items.push({ key: 'pass', label: 'Pass', sub: 'pick a target' });
  }
  if (canSteal(state)) {
    const c = carrier(state);
    const sup = supportMod(state, c.x, c.y, p.team, [p.id, c.id]);
    items.push({ key: 'steal', label: 'Steal', sub: `${pct(p.ctl + sup, stealTN(c.ctl))}%` });
  }
  return items.length ? { playerId: selectedId, items } : null;
}

function renderClock() {
  const minute = state.over
    ? 90
    : Math.min(90, Math.round(((state.turn - 1) / state.maxTurns) * 90));
  $('clock-min').textContent = `${minute}′`;
  $('clock-half').textContent = state.over
    ? 'Full time'
    : state.turn - 1 < state.maxTurns / 2
      ? '1st Half'
      : '2nd Half';
  $('progress-fill').style.width = `${((state.turn - 1) / state.maxTurns) * 100}%`;
  $('turn-label').textContent = `Turn ${Math.min(state.turn, state.maxTurns)}/${state.maxTurns}`;
}

function controllerLabel(team) {
  if (ui.mode === 'pvp') return 'Human';
  if (ui.mode === 'cvc') return 'CPU';
  return team === 'home' ? 'You' : 'CPU';
}

function renderTeamPanels() {
  for (const team of ['home', 'away']) {
    const panel = $(`panel-${team}`);
    const meta = TEAM_META[team];
    const card = getFormation(state.formations[team]);
    const active = !state.over && state.activeTeam === team;
    const canPick =
      active && isHumanTurn() && ui.phase === 'idle' && !state.over;
    panel.classList.toggle('tp-active', active);
    panel.innerHTML = `
      <div class="tp-name">${meta.name}</div>
      <div class="tp-score">${state.score[team]}</div>
      <div class="tp-controller">${controllerLabel(team)}${active ? ' · playing' : ''}</div>
      <button class="tp-card" ${canPick ? '' : 'disabled'} data-team="${team}">
        ${cardPitchSVG(card, team)}
        <b>${card.short}</b>
        <span>${card.name.replace(/^[\d-]+ /, '')}</span>
        ${canPick ? '<em>tap to switch</em>' : ''}
      </button>`;
    panel.querySelector('.tp-card').addEventListener('click', () => {
      if (canPick) openFormationPicker(team);
    });
  }
}

function cardPitchSVG(f, team) {
  const pw = 62;
  const ph = 32;
  const dots = [[...f.gk, true], ...f.slots.map((s) => [...s, false])]
    .map(([sx, sy, gk]) => {
      const dy = team === 'home' ? sy : H - 1 - sy;
      const px = 3 + ((H - 1 - dy + 0.5) / H) * (pw - 6);
      const py = 3 + ((sx + 0.5) / W) * (ph - 6);
      return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${gk ? 2.6 : 2.1}"
        class="${gk ? 'mini-gk' : 'mini-dot'}"/>`;
    })
    .join('');
  return `<svg class="mini-pitch" viewBox="0 0 ${pw} ${ph}" aria-hidden="true">
    <rect x="1" y="1" width="${pw - 2}" height="${ph - 2}" rx="3" class="mini-field"/>
    <line x1="${pw / 2}" y1="1" x2="${pw / 2}" y2="${ph - 1}" class="mini-line"/>
    ${dots}</svg>`;
}

function openFormationPicker(team) {
  const current = state.formations[team];
  overlay(`
    <h2 class="team-${team}">${TEAM_META[team].name}: pick a formation</h2>
    <p>Teammates drift 1 square toward their slots when you end your turn —
    the arrows on the board preview the moves. Switch as often as you like
    before ending your turn.</p>
    <div class="formation-grid card-${team}" id="formation-grid"></div>
    <div class="overlay-buttons"><button id="formation-cancel">Cancel</button></div>`);
  const grid = $('formation-grid');
  for (const f of FORMATIONS) {
    const b = document.createElement('button');
    b.className = 'card';
    if (f.id === current) {
      b.classList.add('card-active');
      b.disabled = true;
    }
    b.innerHTML = `${cardPitchSVG(f, team)}<b>${f.short}</b><span>${f.name.replace(/^[\d-]+ /, '')}</span>`;
    b.addEventListener('click', () => {
      setFormation(state, f.id);
      hideOverlay();
      renderAll();
    });
    grid.appendChild(b);
  }
  $('formation-cancel').addEventListener('click', hideOverlay);
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
    <span class="chip-hint">${hint(p, hasBall)}</span>`;
}

function hint(p, hasBall) {
  if (ui.phase === 'pick-dive') return 'SHOT INCOMING — tap a goal cell to dive your keeper!';
  if (ui.aiTurn) return 'Computer is thinking…';
  if (ui.phase === 'aim-pass') return 'Tap a square (or a teammate) to pass there — odds shown';
  if (ui.phase === 'aim-shot') return 'Tap a goal cell to aim (accuracy shown)';
  const left = stepsLeft(state);
  if (!state.moved && !state.actionUsed) {
    return hasBall
      ? `Dribble up to ${left} (through defenders = challenge) · tap them to cycle views · tap a teammate to switch`
      : `Move up to ${left} — land on the ball to take it · tap a teammate to switch`;
  }
  if (left > 0 && !state.actionUsed) return `${left} steps left — move again, act, or end your turn`;
  if (left > 0) return `${left} steps left — keep moving or end your turn`;
  if (!state.actionUsed) return 'Act from the ring, or end your turn';
  return 'Out of moves — end your turn';
}

function renderButtons() {
  const human = isHumanTurn() && !state.over && ui.phase !== 'busy';
  const aiming = ui.phase === 'aim-pass' || ui.phase === 'aim-shot';
  $('btn-end').disabled = !human || aiming;
  $('btn-cancel').hidden = !aiming;
  $('btn-undo').disabled = !human || aiming || !hist.undo.length;
  $('btn-redo').disabled = !human || aiming || !hist.redo.length;
}

const DIE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

// ---------------------------------------------------------------------------
// Dice tray (compact history) — the cinematic overlay is separate.

const PIPS = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 25], [28, 50], [28, 75], [72, 25], [72, 50], [72, 75]],
};

function dieFace(v, cls = '') {
  const pips = (PIPS[v] || [])
    .map(([x, y]) => `<span class="pip" style="left:${x}%;top:${y}%"></span>`)
    .join('');
  return `<span class="die ${cls}" data-value="${v}">${pips}</span>`;
}

function trayAdd(e) {
  const tray = $('dice-tray');
  const r = e.roll;
  const div = document.createElement('div');
  div.className = `tray-roll team-${e.team}`;
  const mod = r.mod >= 0 ? `+${r.mod}` : `${r.mod}`;
  div.innerHTML = `
    <span class="tray-label">${r.title || e.type}</span>
    ${dieFace(r.a)}${dieFace(r.b)}
    <span class="tray-math">${mod} = <b>${r.total}</b> vs ${r.tn}</span>
    <span class="tray-result ${r.success ? 'ok' : 'no'}">${r.success ? '✓' : '✗'}</span>`;
  tray.prepend(div);
  while (tray.children.length > 3) tray.lastChild.remove();
}

function renderLog(skipTray = false) {
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
    if (e.roll && !skipTray) trayAdd(e);
  }
  log.scrollTop = log.scrollHeight;
}

// ---------------------------------------------------------------------------
// Dice cinematic: pre-roll target math -> animated roll -> result.
// Wraps an engine call; plays one sequence per roll the call produced.

async function diceAction(exec) {
  const before = state.events.length;
  const mySession = ui.session;
  const result = exec();
  const rollEvents = state.events.slice(before).filter((e) => e.roll);
  if (rollEvents.length) {
    // A dice roll is an unchangeable checkpoint: nothing at or before it
    // can be undone.
    hist.undo.length = 0;
    hist.redo.length = 0;
  }
  for (const e of rollEvents) {
    if (ui.session !== mySession) break;
    await playRoll(e);
  }
  return result;
}

async function playRoll(e) {
  const r = e.roll;
  const o = $('dice-overlay');
  ui.skipRoll = false;
  const oppLine = r.opp
    ? `<div class="do-opp">${dieFace(r.opp.a)}${dieFace(r.opp.b)}
       <span>+${r.opp.mod} = ${r.opp.total}</span></div>`
    : '';
  o.innerHTML = `
    <div class="do-box team-${e.team}">
      <div class="do-title">${r.title || 'Roll'}</div>
      <div class="do-target">Need <b>${r.tn}</b></div>
      <div class="do-math">${r.tnLabel || ''}</div>
      ${oppLine}
      <div class="do-dice">${dieFace(0, 'rolling')}${dieFace(0, 'rolling')}</div>
      <div class="do-mod">${r.modLabel || `+${r.mod}`}</div>
      <div class="do-result"></div>
    </div>`;
  o.classList.add('visible');
  const [d1, d2] = o.querySelectorAll('.do-dice .die');
  const resultEl = o.querySelector('.do-result');

  const beat = async (ms) => {
    // small slices so a click can skip ahead
    const step = 60;
    for (let t = 0; t < ms && !ui.skipRoll; t += step) await sleep(step);
  };

  // pre-roll beat: read the target
  await beat(450);
  // tumble
  for (let i = 0; i < 7 && !ui.skipRoll; i++) {
    setDie(d1, 1 + Math.floor(Math.random() * 6));
    setDie(d2, 1 + Math.floor(Math.random() * 6));
    await sleep(50 + i * 8);
  }
  setDie(d1, r.a);
  setDie(d2, r.b);
  d1.classList.remove('rolling');
  d2.classList.remove('rolling');
  const mod = r.mod >= 0 ? `+${r.mod}` : `${r.mod}`;
  const v = r.verdict || {
    text: r.success ? '✓ SUCCESS' : '✗ FAIL',
    tone: r.success ? 'ok' : 'no',
  };
  resultEl.innerHTML = `${r.a} + ${r.b} ${mod} = <b>${r.total}</b>
    <span class="${v.tone}">${v.text}</span>`;
  resultEl.classList.add('shown');
  await beat(750);
  o.classList.remove('visible');
}

function setDie(el, v) {
  el.innerHTML = (PIPS[v] || [])
    .map(([x, y]) => `<span class="pip" style="left:${x}%;top:${y}%"></span>`)
    .join('');
}

$('dice-overlay').addEventListener('click', () => {
  ui.skipRoll = true;
});

// ---------------------------------------------------------------------------
// Human interaction

async function handleTileClick(x, y) {
  if (!isHumanTurn() || state.over) return;
  if (ui.phase === 'idle' && stepsLeft(state) > 0) {
    const selected = activePlayerId(state);
    if (!reachable(state, selected).get(`${x},${y}`)) return;
    pushHistory();
    ui.phase = 'busy';
    await diceAction(() => doMove(state, dice, x, y));
    ui.phase = 'idle';
    renderAll();
  } else if (ui.phase === 'aim-pass') {
    ui.phase = 'busy';
    await diceAction(() => doPass(state, dice, x, y));
    ui.phase = 'idle';
    renderAll();
  }
}

function handlePlayerClick(pid) {
  const p = getPlayer(state, pid);
  // While aiming a pass, a footballer is just a target tile.
  if (ui.phase === 'aim-pass' && isHumanTurn() && !state.over) {
    handleTileClick(p.x, p.y);
    return;
  }
  if (!isHumanTurn() || state.over || ui.aiTurn) {
    // spectating / opponent's turn: peek at stats
    ui.inspectId = ui.inspectId === pid ? null : pid;
    renderAll();
    return;
  }
  if (ui.phase !== 'idle') return;
  const selected = activePlayerId(state);
  if (p.team === state.activeTeam) {
    if (pid === selected) {
      ui.playerView = ui.playerView === 1 ? 2 : ui.playerView === 2 ? 0 : 1;
      ui.inspectId = null;
    } else if (!state.moved && !state.actionUsed) {
      selectMover(state, pid);
      ui.playerView = 1;
      ui.inspectId = null;
    } else {
      ui.inspectId = ui.inspectId === pid ? null : pid;
    }
  } else {
    ui.inspectId = ui.inspectId === pid ? null : pid;
  }
  renderAll();
}

async function handleRingAction(key) {
  if (!isHumanTurn() || state.over || ui.phase !== 'idle') return;
  if (key === 'pass') {
    ui.phase = 'aim-pass';
    renderAll();
  } else if (key === 'shoot') {
    ui.phase = 'aim-shot';
    renderAll();
  } else if (key === 'steal') {
    ui.phase = 'busy';
    renderAll();
    await diceAction(() => doSteal(state, dice));
    ui.phase = 'idle';
    renderAll();
  }
}

async function handleGoalCell(cell, side) {
  if (side !== goalSideFor(state.activeTeam)) return;
  // Defender picking a dive on the goal itself (PvE, computer shooting).
  if (ui.phase === 'pick-dive' && ui.diveResolve) {
    const resolve = ui.diveResolve;
    ui.diveResolve = null;
    ui.phase = 'busy';
    resolve(cell);
    return;
  }
  if (ui.phase !== 'aim-shot') return;
  ui.phase = 'busy';
  renderAll();
  const shooterTeam = state.activeTeam;
  let dive;
  if (ui.mode === 'pve') dive = aiPickDive(state, dice);
  else dive = await pvpDivePick(shooterTeam);
  await resolveShot(cell, dive);
}

async function resolveShot(aim, dive) {
  const mySession = ui.session;
  const res = await diceAction(() => doShoot(state, dice, aim, dive));
  if (ui.session !== mySession) return;
  if (res.outcome === 'goal') await banner('⚽ GOAL!!!', 'goal', 1800);
  else if (res.outcome === 'save') await banner('🧤 SAVED!', 'save');
  else if (res.outcome === 'rebound') await banner('💥 Off the frame!', 'save');
  else await banner('Off target…', '', 1000);
  if (ui.session !== mySession) return;
  beginTurn();
}

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

// Laid out like the on-screen goal: 3 rows (top/center/bottom posts) by
// 2 columns (low = near the mouth, high = top shelf).
function buildDiveGrid(grid, onPick) {
  const names = ['Top', 'Center', 'Bottom'];
  for (let col = 0; col < 3; col++) {
    for (const high of [false, true]) {
      const b = document.createElement('button');
      b.className = 'dive-cell';
      b.textContent = `${names[col]} · ${high ? 'High' : 'Low'}`;
      b.addEventListener('click', () => onPick({ col, high }));
      grid.appendChild(b);
    }
  }
}

// Buttons
$('btn-cancel').addEventListener('click', () => {
  ui.phase = 'idle';
  renderAll();
});
$('btn-undo').addEventListener('click', doUndo);
$('btn-redo').addEventListener('click', doRedo);
$('btn-end').addEventListener('click', () => {
  if (!isHumanTurn() || state.over || ui.phase === 'busy') return;
  endTurn(state, dice);
  beginTurn();
});

// ---------------------------------------------------------------------------
// AI turn

async function pauseGate(mySession) {
  while (ui.paused && ui.session === mySession) await rawSleep(150);
}

async function runAiTurn() {
  ui.phase = 'busy';
  ui.aiTurn = true;
  const mySession = ui.session;
  const stale = () => ui.session !== mySession;
  const turnBefore = state.turn;
  await sleep(600);
  await pauseGate(mySession);
  if (stale()) return;
  const f = aiChooseFormation(state);
  if (f) {
    setFormation(state, f);
    renderAll();
    await sleep(500);
    if (stale()) return;
  }
  const mv = aiChooseMove(state, dice);
  if (mv) {
    await diceAction(() => doMove(state, dice, mv.x, mv.y));
    renderAll();
    await sleep(650);
    await pauseGate(mySession);
    if (stale()) return;
  }
  if (!state.over && !state.actionUsed && state.turn === turnBefore) {
    const act = aiChooseAction(state, dice);
    if (act.type === 'steal') {
      await diceAction(() => doSteal(state, dice));
      renderAll();
      await sleep(500);
      if (stale()) return;
    } else if (act.type === 'pass') {
      await diceAction(() => doPass(state, dice, act.x, act.y));
      renderAll();
      await sleep(600);
      if (stale()) return;
    } else if (act.type === 'shoot') {
      let dive;
      if (humanDefends(state.activeTeam)) {
        // Pick the dive directly on the goal's six cells.
        dive = await new Promise((resolve) => {
          ui.diveResolve = resolve;
          ui.phase = 'pick-dive';
          renderAll();
          banner('🧤 Shot incoming — tap a goal cell to dive!', 'team-home', 1500);
        });
      } else {
        dive = aiPickDive(state, dice);
      }
      if (stale()) return;
      await resolveShot(act.aim, dive);
      return; // resolveShot continues via beginTurn
    }
  }
  await pauseGate(mySession);
  if (stale()) return;
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
    startMatch(ui.mode, ui.lastRosters || null);
  });
  $('btn-menu').addEventListener('click', () => {
    hideOverlay();
    show('screen-menu');
  });
}

$('btn-pve').addEventListener('click', () => startFlow('pve'));
$('btn-pvp').addEventListener('click', () => startFlow('pvp'));
$('btn-cvc').addEventListener('click', () => startFlow('cvc'));
$('btn-speed').addEventListener('click', () => {
  ui.speed = ui.speed >= 4 ? 1 : ui.speed * 2;
  $('btn-speed').textContent = `${ui.speed}×`;
});
$('btn-pause').addEventListener('click', () => {
  ui.paused = !ui.paused;
  $('btn-pause').textContent = ui.paused ? '▶' : '⏸';
});
$('btn-help').addEventListener('click', () => $('help').classList.add('visible'));
$('help-close').addEventListener('click', () => $('help').classList.remove('visible'));
$('btn-quit').addEventListener('click', () => {
  ui.session++; // abort any in-flight AI loop
  ui.paused = false;
  show('screen-menu');
});

// PWA service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

show('screen-menu');
