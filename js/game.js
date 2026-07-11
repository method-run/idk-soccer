// Pure game engine. No DOM. All randomness comes through an injected dice
// object (see dice.js) so the engine is testable and replayable.

import { W, H, MAX_TURNS, ROSTER, FORMATIONS, mirrorY } from './data.js';

export const DIRS8 = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

export function inBounds(x, y) {
  return x >= 0 && x < W && y >= 0 && y < H;
}

export function cheb(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function otherTeam(team) {
  return team === 'home' ? 'away' : 'home';
}

// The goal-mouth tile a team shoots AT (edge-center of the opponent's end).
export function attackMouth(team) {
  return team === 'home' ? { x: 3, y: 0 } : { x: 3, y: H - 1 };
}

export function getFormation(id) {
  return FORMATIONS.find((f) => f.id === id);
}

// ---------------------------------------------------------------------------
// Match setup

export function newMatch({ mode = 'pve', maxTurns = MAX_TURNS } = {}) {
  const players = [];
  for (const team of ['home', 'away']) {
    for (const p of ROSTER) {
      players.push({
        id: `${team}-${p.num}`,
        team,
        num: p.num,
        name: p.name,
        role: p.role,
        spd: p.spd,
        sho: p.sho,
        pas: p.pas,
        ctl: p.ctl,
        x: 0,
        y: 0,
      });
    }
  }
  const state = {
    mode,
    turn: 1,
    maxTurns,
    activeTeam: 'home',
    score: { home: 0, away: 0 },
    ball: { x: 3, y: 6, carrier: null },
    players,
    formations: { home: 'balanced', away: 'balanced' },
    moved: false,
    actionUsed: false,
    formationSwitched: false,
    over: false,
    events: [],
  };
  kickoff(state, 'home');
  return state;
}

export function getPlayer(state, id) {
  return state.players.find((p) => p.id === id);
}

export function occupantAt(state, x, y) {
  return state.players.find((p) => p.x === x && p.y === y) || null;
}

export function carrier(state) {
  return state.ball.carrier ? getPlayer(state, state.ball.carrier) : null;
}

function logEvent(state, type, text, roll = null) {
  state.events.push({ turn: state.turn, team: state.activeTeam, type, text, roll });
}

// ---------------------------------------------------------------------------
// Active (forced) mover: your carrier, else your closest to the ball.

export function activePlayerId(state) {
  const team = state.activeTeam;
  const c = carrier(state);
  if (c && c.team === team) return c.id;
  let best = null;
  let bestKey = Infinity;
  for (const p of state.players) {
    if (p.team !== team) continue;
    const d = cheb(p.x, p.y, state.ball.x, state.ball.y);
    const key = d * 100 + p.num; // tie-break: lowest number
    if (key < bestKey) {
      bestKey = key;
      best = p;
    }
  }
  return best.id;
}

// ---------------------------------------------------------------------------
// Formation targets. Slots slide 1 column toward the ball.

export function formationTargets(state, team) {
  const card = getFormation(state.formations[team]);
  const shift = Math.max(-1, Math.min(1, state.ball.x - 3));
  const my = (y) => (team === 'home' ? y : mirrorY(y));
  const targets = {};
  const roster = state.players.filter((p) => p.team === team);
  const gk = roster.find((p) => p.role === 'GK');
  targets[gk.id] = {
    x: Math.max(2, Math.min(4, card.gk[0] + shift)),
    y: my(card.gk[1]),
  };
  const outfield = roster.filter((p) => p.role !== 'GK');
  card.slots.forEach(([sx, sy], i) => {
    const p = outfield[i];
    targets[p.id] = {
      x: Math.max(0, Math.min(W - 1, sx + shift)),
      y: my(sy),
    };
  });
  return targets;
}

export function setFormation(state, cardId) {
  if (state.formationSwitched) return { ok: false, reason: 'already switched this turn' };
  if (state.formations[state.activeTeam] === cardId) return { ok: false, reason: 'already active' };
  state.formations[state.activeTeam] = cardId;
  state.formationSwitched = true;
  logEvent(state, 'formation', `${state.activeTeam} switches to ${getFormation(cardId).name}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Movement

export function moveRange(state, player) {
  const isCarrier = state.ball.carrier === player.id;
  return isCarrier ? Math.max(1, player.spd - 2) : player.spd;
}

// BFS over unoccupied tiles, 8-directional. Returns Map "x,y" -> steps.
export function reachable(state, playerId) {
  const player = getPlayer(state, playerId);
  const max = moveRange(state, player);
  const blocked = new Set(
    state.players.filter((p) => p.id !== playerId).map((p) => `${p.x},${p.y}`)
  );
  const dist = new Map([[`${player.x},${player.y}`, 0]]);
  let frontier = [[player.x, player.y]];
  for (let step = 1; step <= max; step++) {
    const next = [];
    for (const [cx, cy] of frontier) {
      for (const [dx, dy] of DIRS8) {
        const nx = cx + dx;
        const ny = cy + dy;
        const key = `${nx},${ny}`;
        if (!inBounds(nx, ny) || blocked.has(key) || dist.has(key)) continue;
        dist.set(key, step);
        next.push([nx, ny]);
      }
    }
    frontier = next;
  }
  return dist;
}

// Move the forced mover to (x,y). Handles loose-ball pickup on arrival.
export function doMove(state, dice, x, y) {
  if (state.moved) return { ok: false, reason: 'already moved' };
  const player = getPlayer(state, activePlayerId(state));
  const tiles = reachable(state, player.id);
  if (!tiles.has(`${x},${y}`)) return { ok: false, reason: 'unreachable' };
  const hadBall = state.ball.carrier === player.id;
  player.x = x;
  player.y = y;
  state.moved = true;
  if (hadBall) {
    state.ball.x = x;
    state.ball.y = y;
    logEvent(state, 'move', `#${player.num} ${player.name} dribbles to (${x},${y})`);
    return { ok: true };
  }
  logEvent(state, 'move', `#${player.num} ${player.name} runs to (${x},${y})`);
  if (!state.ball.carrier && state.ball.x === x && state.ball.y === y) {
    resolvePickup(state, dice, player);
  }
  return { ok: true };
}

// Loose-ball pickup: automatic if no opponent is adjacent, otherwise an
// opposed 2d6+CTL contest against the best-CTL adjacent opponent (ties to
// the mover). Losing scatters the ball 1 tile.
function resolvePickup(state, dice, player) {
  const opps = state.players.filter(
    (p) =>
      p.team !== player.team &&
      cheb(p.x, p.y, state.ball.x, state.ball.y) <= 1
  );
  if (opps.length === 0) {
    state.ball.carrier = player.id;
    logEvent(state, 'pickup', `#${player.num} ${player.name} collects the loose ball`);
    return;
  }
  const opp = opps.reduce((a, b) => (b.ctl > a.ctl ? b : a));
  const mine = dice.roll2d6(player.ctl);
  const theirs = dice.roll2d6(opp.ctl);
  const won = mine.total >= theirs.total;
  logEvent(
    state,
    'contest',
    `Contested ball! #${player.num} ${player.name} [${mine.a}+${mine.b}+${mine.mod}=${mine.total}] vs #${opp.num} ${opp.name} [${theirs.a}+${theirs.b}+${theirs.mod}=${theirs.total}]`,
    { a: mine.a, b: mine.b, mod: mine.mod, total: mine.total, tn: theirs.total, success: won }
  );
  if (won) {
    state.ball.carrier = player.id;
    logEvent(state, 'pickup', `#${player.num} ${player.name} wins the ball`);
  } else {
    scatterBall(state, dice, state.ball.x, state.ball.y, 1);
    logEvent(state, 'loose', `#${opp.num} ${opp.name} pokes it away — ball is loose`);
  }
}

// Random-direction scatter to a free in-bounds tile.
function scatterBall(state, dice, fromX, fromY, tiles) {
  state.ball.carrier = null;
  const dirs = [...DIRS8];
  // shuffle via dice
  for (let i = dirs.length - 1; i > 0; i--) {
    const j = Math.floor(dice.random() * (i + 1));
    [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
  }
  for (const [dx, dy] of dirs) {
    const nx = Math.max(0, Math.min(W - 1, fromX + dx * tiles));
    const ny = Math.max(0, Math.min(H - 1, fromY + dy * tiles));
    if (!occupantAt(state, nx, ny) && !(nx === fromX && ny === fromY)) {
      state.ball.x = nx;
      state.ball.y = ny;
      return;
    }
  }
  state.ball.x = fromX;
  state.ball.y = fromY;
}

// ---------------------------------------------------------------------------
// Steal (ball held by an adjacent opponent)

export function canSteal(state) {
  if (state.actionUsed) return false;
  const c = carrier(state);
  if (!c || c.team === state.activeTeam) return false;
  const me = getPlayer(state, activePlayerId(state));
  return cheb(me.x, me.y, c.x, c.y) <= 1;
}

export function stealTN(defenderCtl) {
  return 8 + defenderCtl;
}

export function doSteal(state, dice) {
  if (!canSteal(state)) return { ok: false, reason: 'no steal available' };
  const me = getPlayer(state, activePlayerId(state));
  const c = carrier(state);
  const r = dice.check(me.ctl, stealTN(c.ctl));
  state.actionUsed = true;
  logEvent(
    state,
    'steal',
    `#${me.num} ${me.name} tackles #${c.num} ${c.name}: ${r.a}+${r.b}+${r.mod}=${r.total} vs ${r.tn} — ${r.success ? 'WINS the ball!' : 'held off'}`,
    r
  );
  if (r.success) {
    state.ball.carrier = me.id;
    state.ball.x = me.x;
    state.ball.y = me.y;
  }
  return { ok: true, roll: r };
}

// ---------------------------------------------------------------------------
// Passing

export const PASS_MAX = 8;

export function passTN(dist) {
  return 6 + Math.floor(dist / 3);
}

export function canPass(state) {
  if (state.actionUsed) return false;
  const c = carrier(state);
  return !!c && c.team === state.activeTeam && c.id === activePlayerId(state);
}

export function doPass(state, dice, x, y) {
  if (!canPass(state)) return { ok: false, reason: 'cannot pass' };
  const passer = carrier(state);
  const dist = cheb(passer.x, passer.y, x, y);
  if (dist < 1 || dist > PASS_MAX || !inBounds(x, y)) {
    return { ok: false, reason: 'bad target' };
  }
  const r = dice.check(passer.pas, passTN(dist));
  state.actionUsed = true;
  state.ball.carrier = null;
  logEvent(
    state,
    'pass',
    `#${passer.num} ${passer.name} passes (${dist} tiles): ${r.a}+${r.b}+${r.mod}=${r.total} vs ${r.tn} — ${r.success ? 'on target' : 'off target'}`,
    r
  );
  if (r.success) {
    state.ball.x = x;
    state.ball.y = y;
  } else {
    const missBy = -r.margin;
    state.ball.x = x;
    state.ball.y = y;
    scatterBall(state, dice, x, y, missBy <= 2 ? 1 : 2);
    logEvent(state, 'loose', 'The pass goes astray');
  }
  const rec = occupantAt(state, state.ball.x, state.ball.y);
  if (rec) {
    state.ball.carrier = rec.id;
    const rel = rec.team === passer.team ? 'receives' : 'INTERCEPTS';
    logEvent(state, rec.team === passer.team ? 'receive' : 'intercept',
      `#${rec.num} ${rec.name} ${rel} the ball`);
  }
  return { ok: true, roll: r };
}

// ---------------------------------------------------------------------------
// Shooting. Aim cell: { col: 0|1|2, high: bool } on the 3x2 goal grid.
// The keeper's dive is committed (blind) before the roll resolves.

export function goalCells() {
  const cells = [];
  for (const high of [false, true]) {
    for (const col of [0, 1, 2]) cells.push({ col, high });
  }
  return cells;
}

export function shotDistance(state, shooter) {
  const m = attackMouth(shooter.team);
  return cheb(shooter.x, shooter.y, m.x, m.y);
}

export function shotTN(dist, aim) {
  return 8 + Math.ceil(Math.max(0, dist - 2) / 2) + (aim && aim.col !== 1 ? 1 : 0);
}

export function canShoot(state) {
  return canPass(state); // same preconditions: forced mover holds the ball
}

export function defendingKeeper(state, attackingTeam) {
  return state.players.find(
    (p) => p.team === otherTeam(attackingTeam) && p.role === 'GK'
  );
}

export function doShoot(state, dice, aim, dive) {
  if (!canShoot(state)) return { ok: false, reason: 'cannot shoot' };
  const shooter = carrier(state);
  const keeper = defendingKeeper(state, shooter.team);
  const dist = shotDistance(state, shooter);
  const r = dice.check(shooter.sho, shotTN(dist, aim));
  state.actionUsed = true;
  const aimName = `${aim.high ? 'high' : 'low'} ${['left', 'center', 'right'][aim.col]}`;
  logEvent(
    state,
    'shot',
    `#${shooter.num} ${shooter.name} SHOOTS ${aimName} from ${dist} out: ${r.a}+${r.b}+${r.mod}=${r.total} vs ${r.tn}`,
    r
  );
  let outcome;
  let keeperRoll = null;
  if (r.success && r.doubles) {
    outcome = 'goal';
    logEvent(state, 'goal', 'DOUBLES! An unstoppable screamer!');
  } else if (r.success) {
    const diveName = `${dive.high ? 'high' : 'low'} ${['left', 'center', 'right'][dive.col]}`;
    if (dive.col === aim.col && dive.high === aim.high) {
      outcome = 'save';
      logEvent(state, 'save', `Keeper dove ${diveName} — right there! SAVED`);
    } else if (dive.col === aim.col) {
      keeperRoll = dice.check(keeper.ctl, 8);
      if (keeperRoll.success) {
        outcome = 'save';
        logEvent(state, 'save',
          `Keeper dove ${diveName}, scrambles: ${keeperRoll.a}+${keeperRoll.b}+${keeperRoll.mod}=${keeperRoll.total} vs 8 — SAVED`,
          keeperRoll);
      } else {
        outcome = 'goal';
        logEvent(state, 'goal',
          `Keeper dove ${diveName}, scrambles: ${keeperRoll.total} vs 8 — not enough. GOAL!`,
          keeperRoll);
      }
    } else {
      outcome = 'goal';
      logEvent(state, 'goal', `Keeper dove ${diveName} — wrong way! GOAL!`);
    }
  } else if (r.margin === -1) {
    outcome = 'rebound';
  } else {
    outcome = 'wide';
  }

  if (outcome === 'goal') {
    state.score[shooter.team]++;
    logEvent(state, 'score', `${shooter.team.toUpperCase()} scores! ${state.score.home}–${state.score.away}`);
    kickoff(state, otherTeam(shooter.team));
    endTurn(state, dice, { skipDrift: true });
  } else if (outcome === 'save' || outcome === 'wide') {
    state.ball.carrier = keeper.id;
    state.ball.x = keeper.x;
    state.ball.y = keeper.y;
    if (outcome === 'wide') logEvent(state, 'miss', 'Off target — keeper collects');
    endTurn(state, dice, {});
  } else {
    // rebound: loose ball in front of the goal
    const gy = shooter.team === 'home' ? dice.pick([0, 1]) : dice.pick([H - 1, H - 2]);
    const options = [];
    for (let gx = 1; gx <= 5; gx++) {
      if (!occupantAt(state, gx, gy)) options.push(gx);
    }
    state.ball.carrier = null;
    state.ball.x = options.length ? dice.pick(options) : 3;
    state.ball.y = gy;
    logEvent(state, 'rebound', 'Rattles the frame — rebound is LOOSE in front of goal!');
    endTurn(state, dice, {});
  }
  return { ok: true, roll: r, outcome, keeperRoll };
}

// ---------------------------------------------------------------------------
// Kickoff / reset after a goal (and at match start)

function placeAt(state, player, x, y) {
  // Snap to (x,y), or the nearest free tile if occupied.
  for (let radius = 0; radius < Math.max(W, H); radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (inBounds(nx, ny) && !occupantAt(state, nx, ny)) {
          player.x = nx;
          player.y = ny;
          return;
        }
      }
    }
  }
}

export function kickoff(state, teamWithBall) {
  state.ball.carrier = null;
  state.ball.x = 3;
  state.ball.y = teamWithBall === 'home' ? 6 : 5;
  // Clear the board, then snap everyone to their formation targets.
  for (const p of state.players) {
    p.x = -99;
    p.y = -99;
  }
  for (const team of ['home', 'away']) {
    const targets = formationTargets(state, team);
    for (const p of state.players.filter((q) => q.team === team)) {
      const t = targets[p.id];
      placeAt(state, p, t.x, t.y);
    }
  }
  // Clear the kickoff tile if a formation slot landed on it.
  const squatter = occupantAt(state, state.ball.x, state.ball.y);
  if (squatter) {
    squatter.x = -99;
    squatter.y = -99;
    placeAt(state, squatter, state.ball.x, state.ball.y === 6 ? 7 : 4);
  }
  // The kicking team's closest player steps onto the ball.
  let best = null;
  let bestKey = Infinity;
  for (const p of state.players) {
    if (p.team !== teamWithBall) continue;
    const key = cheb(p.x, p.y, state.ball.x, state.ball.y) * 100 + p.num;
    if (key < bestKey) {
      bestKey = key;
      best = p;
    }
  }
  best.x = state.ball.x;
  best.y = state.ball.y;
  state.ball.carrier = best.id;
  logEvent(state, 'kickoff', `Kickoff: ${teamWithBall} — #${best.num} ${best.name} on the ball`);
}

// ---------------------------------------------------------------------------
// End of turn: formation drift, then hand over.

export function endTurn(state, dice, { skipDrift = false } = {}) {
  if (state.over) return;
  if (!skipDrift) drift(state);
  state.turn++;
  if (state.turn > state.maxTurns) {
    state.over = true;
    logEvent(state, 'fulltime',
      `FULL TIME! Final score ${state.score.home}–${state.score.away}`);
    return;
  }
  state.activeTeam = otherTeam(state.activeTeam);
  state.moved = false;
  state.actionUsed = false;
  state.formationSwitched = false;
}

// Every active-team footballer except the forced mover drifts 1 step
// (8-directional) toward its formation slot. Blocked tiles (players, the
// loose ball) halt drift for that piece this turn.
function drift(state) {
  const team = state.activeTeam;
  const mover = activePlayerId(state);
  const targets = formationTargets(state, team);
  for (const p of state.players.filter((q) => q.team === team)) {
    if (p.id === mover) continue;
    const t = targets[p.id];
    if (p.x === t.x && p.y === t.y) continue;
    let best = null;
    let bestD = (p.x - t.x) ** 2 + (p.y - t.y) ** 2;
    for (const [dx, dy] of DIRS8) {
      const nx = p.x + dx;
      const ny = p.y + dy;
      if (!inBounds(nx, ny)) continue;
      if (occupantAt(state, nx, ny)) continue;
      if (!state.ball.carrier && state.ball.x === nx && state.ball.y === ny) continue;
      const d = (nx - t.x) ** 2 + (ny - t.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = [nx, ny];
      }
    }
    if (best) {
      p.x = best[0];
      p.y = best[1];
    }
  }
}
