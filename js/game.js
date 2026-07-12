// Pure game engine. No DOM. All randomness comes through an injected dice
// object (see dice.js) so the engine is testable and replayable.

import { W, H, MAX_TURNS, ROSTER, FORMATIONS, GOAL_COLS, CENTER_X, mirrorY } from './data.js';

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
  return team === 'home' ? { x: CENTER_X, y: 0 } : { x: CENTER_X, y: H - 1 };
}

export function getFormation(id) {
  return FORMATIONS.find((f) => f.id === id);
}

// ---------------------------------------------------------------------------
// Match setup

// rosters (optional): { home: { gk, outfield: [6] }, away: {...} } using
// PLAYER_POOL-shaped entries; outfield order maps onto formation slots
// (defensive slots first). Without rosters, the default template is used.
export function newMatch({ mode = 'pve', maxTurns = MAX_TURNS, rosters = null } = {}) {
  const players = [];
  for (const team of ['home', 'away']) {
    const r = rosters?.[team];
    const list = r ? [r.gk, ...r.outfield] : ROSTER;
    list.forEach((p, i) => {
      players.push({
        id: `${team}-${i + 1}`,
        team,
        num: i + 1,
        name: p.name,
        role: i === 0 ? 'GK' : p.role,
        spd: p.spd,
        sho: p.sho,
        pas: p.pas,
        ctl: p.ctl,
        x: 0,
        y: 0,
      });
    });
  }
  const state = {
    mode,
    turn: 1,
    maxTurns,
    activeTeam: 'home',
    score: { home: 0, away: 0 },
    ball: { x: CENTER_X, y: Math.floor(H / 2), carrier: null },
    players,
    formations: { home: 'balanced', away: 'balanced' },
    moverId: null, // explicit mover selection; null = default (carrier/closest)
    moved: false,
    stepsUsed: 0,
    actionUsed: false,
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
// Active mover: an explicit selection if one was made this turn, else the
// default — your carrier, else your closest to the ball.

export function activePlayerId(state) {
  const team = state.activeTeam;
  if (state.moverId) {
    const sel = getPlayer(state, state.moverId);
    if (sel && sel.team === team) return sel.id;
  }
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

// Pick which footballer to control this turn. Free until you move or act.
export function selectMover(state, id) {
  if (state.moved || state.actionUsed) return { ok: false, reason: 'already committed' };
  const p = getPlayer(state, id);
  if (!p || p.team !== state.activeTeam) return { ok: false, reason: 'not your player' };
  // The carrier is always the one who passes/shoots; selecting someone else
  // just means you move that player instead.
  state.moverId = id;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Formation targets. Slots slide 1 column toward the ball.

export function formationTargets(state, team) {
  const card = getFormation(state.formations[team]);
  const shift = Math.max(-1, Math.min(1, state.ball.x - CENTER_X));
  const my = (y) => (team === 'home' ? y : mirrorY(y));
  const targets = {};
  const roster = state.players.filter((p) => p.team === team);
  const gk = roster.find((p) => p.role === 'GK');
  targets[gk.id] = {
    x: Math.max(GOAL_COLS[0], Math.min(GOAL_COLS[GOAL_COLS.length - 1], card.gk[0] + shift)),
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

// Formations toggle freely during your turn; only the card active when the
// turn ends drives the drift.
export function setFormation(state, cardId) {
  if (state.formations[state.activeTeam] === cardId) return { ok: false, reason: 'already active' };
  state.formations[state.activeTeam] = cardId;
  logEvent(state, 'formation', `${state.activeTeam} switches to ${getFormation(cardId).name}`);
  return { ok: true };
}

// Outnumbering modifier for ball-control contests: each extra footballer
// adjacent to the contest tile beyond the other side's count is worth +1,
// capped at ±2. The two primary contestants don't count themselves.
export function supportMod(state, x, y, team, excludeIds = []) {
  let mine = 0;
  let theirs = 0;
  for (const p of state.players) {
    if (excludeIds.includes(p.id)) continue;
    if (cheb(p.x, p.y, x, y) <= 1) {
      if (p.team === team) mine++;
      else theirs++;
    }
  }
  return Math.max(-2, Math.min(2, mine - theirs));
}

// ---------------------------------------------------------------------------
// Movement. SPD is a step budget spent in any number of segments across the
// turn — before and/or after your ball action. Occupied tiles can be moved
// THROUGH (never ended on); dribbling through an opponent triggers a
// challenge (see resolveDribbleChallenge).

export function moveRange(state, player) {
  const isCarrier = state.ball.carrier === player.id;
  return isCarrier ? Math.max(1, player.spd - 1) : player.spd;
}

// Steps the current mover still has this turn.
export function stepsLeft(state) {
  const p = getPlayer(state, activePlayerId(state));
  return Math.max(0, moveRange(state, p) - state.stepsUsed);
}

// 8-directional BFS. Occupied tiles are traversable but not terminal.
// Returns { dist: Map key->steps (endable tiles only), parent: Map } within
// the mover's remaining budget.
function bfsInfo(state, playerId, max) {
  const player = getPlayer(state, playerId);
  const occupied = new Set(
    state.players.filter((p) => p.id !== playerId).map((p) => `${p.x},${p.y}`)
  );
  const startKey = `${player.x},${player.y}`;
  const seen = new Map([[startKey, 0]]);
  const parent = new Map();
  let frontier = [[player.x, player.y]];
  for (let step = 1; step <= max; step++) {
    const next = [];
    for (const [cx, cy] of frontier) {
      for (const [dx, dy] of DIRS8) {
        const nx = cx + dx;
        const ny = cy + dy;
        const key = `${nx},${ny}`;
        if (!inBounds(nx, ny) || seen.has(key)) continue;
        seen.set(key, step);
        parent.set(key, `${cx},${cy}`);
        next.push([nx, ny]);
      }
    }
    frontier = next;
  }
  const dist = new Map();
  for (const [key, d] of seen) {
    if (!occupied.has(key)) dist.set(key, d);
  }
  return { dist, parent, startKey };
}

function budgetFor(state, playerId) {
  const player = getPlayer(state, playerId);
  const used = activePlayerId(state) === playerId ? state.stepsUsed : 0;
  return Math.max(0, moveRange(state, player) - used);
}

// Map "x,y" -> steps for tiles the player can END a segment on.
export function reachable(state, playerId) {
  return bfsInfo(state, playerId, budgetFor(state, playerId)).dist;
}

// Move the mover to (x,y), spending steps. Multiple segments per turn are
// allowed while budget remains. Handles dribble challenges en route and
// loose-ball pickup on arrival.
export function doMove(state, dice, x, y) {
  const player = getPlayer(state, activePlayerId(state));
  const budget = budgetFor(state, player.id);
  if (budget <= 0) return { ok: false, reason: 'no steps left' };
  const info = bfsInfo(state, player.id, budget);
  const key = `${x},${y}`;
  const steps = info.dist.get(key);
  if (!steps) return { ok: false, reason: 'unreachable' }; // undefined or 0 (own tile)
  state.moved = true;
  state.moverId = player.id; // lock the selection once committed
  state.stepsUsed += steps;

  // Reconstruct the path (start exclusive, destination inclusive).
  const path = [];
  for (let k = key; k !== info.startKey; k = info.parent.get(k)) {
    path.unshift(k.split(',').map(Number));
  }

  const hadBall = state.ball.carrier === player.id;
  logEvent(
    state,
    'move',
    `#${player.num} ${player.name} ${hadBall ? 'dribbles' : 'runs'} to (${x},${y})`
  );
  // Dribble challenges for every opponent stood on the path.
  for (const [tx, ty] of path) {
    if (state.ball.carrier !== player.id) break; // lost it en route
    const occ = occupantAt(state, tx, ty);
    if (occ && occ.team !== player.team) {
      resolveDribbleChallenge(state, dice, player, occ);
    }
  }
  player.x = x;
  player.y = y;
  if (state.ball.carrier === player.id) {
    state.ball.x = x;
    state.ball.y = y;
  } else if (!state.ball.carrier && state.ball.x === x && state.ball.y === y) {
    resolvePickup(state, dice, player);
  }
  return { ok: true, steps };
}

// Dribbling through a defender: opposed 2d6+CTL (dribbler gets support,
// ties win). Lose by 1-2: ball knocked loose off the defender. Lose by 3+:
// clean steal — the defender keeps the ball where they stand. Either way
// the dribbler's run carries on to the chosen square.
function resolveDribbleChallenge(state, dice, dribbler, defender) {
  const sup = supportMod(state, defender.x, defender.y, dribbler.team, [
    dribbler.id,
    defender.id,
  ]);
  const mine = dice.roll2d6(dribbler.ctl + sup);
  const theirs = dice.roll2d6(defender.ctl);
  const through = mine.total >= theirs.total;
  const deficit = theirs.total - mine.total;
  const verdict = through
    ? { text: '💨 THROUGH!', tone: 'ok' }
    : deficit >= 3
      ? { text: '⛔ STOLEN!', tone: 'no' }
      : { text: '💥 KNOCKED LOOSE!', tone: 'mid' };
  logEvent(
    state,
    'dribble',
    `#${dribbler.num} ${dribbler.name} takes on #${defender.num} ${defender.name}: ` +
      `${mine.total} vs ${theirs.total} — ${verdict.text}`,
    {
      a: mine.a, b: mine.b, mod: mine.mod, total: mine.total,
      tn: theirs.total, success: through,
      title: 'Dribble challenge',
      tnLabel: `#${defender.num} ${defender.name} rolled ${theirs.a}+${theirs.b}+${theirs.mod}`,
      modLabel: `CTL +${dribbler.ctl}${sup ? ` ${sup > 0 ? '+' : ''}${sup} support` : ''} (ties win)`,
      opp: { a: theirs.a, b: theirs.b, mod: theirs.mod, total: theirs.total },
      verdict,
    }
  );
  if (through) return;
  if (deficit >= 3) {
    state.ball.carrier = defender.id;
    state.ball.x = defender.x;
    state.ball.y = defender.y;
  } else {
    scatterBall(state, dice, defender.x, defender.y, 1);
    logEvent(state, 'loose', 'The ball squirts free!');
  }
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
  const sup = supportMod(state, state.ball.x, state.ball.y, player.team, [player.id, opp.id]);
  const mine = dice.roll2d6(player.ctl + sup);
  const theirs = dice.roll2d6(opp.ctl);
  const won = mine.total >= theirs.total;
  logEvent(
    state,
    'contest',
    `Contested ball! #${player.num} ${player.name} [${mine.a}+${mine.b}+${mine.mod}=${mine.total}] vs #${opp.num} ${opp.name} [${theirs.a}+${theirs.b}+${theirs.mod}=${theirs.total}]`,
    {
      a: mine.a, b: mine.b, mod: mine.mod, total: mine.total,
      tn: theirs.total, success: won,
      title: 'Loose ball duel',
      tnLabel: `#${opp.num} ${opp.name} rolled ${theirs.a}+${theirs.b}+${theirs.mod}`,
      modLabel: `CTL +${player.ctl}${sup ? ` ${sup > 0 ? '+' : ''}${sup} support` : ''} (ties win)`,
      opp: { a: theirs.a, b: theirs.b, mod: theirs.mod, total: theirs.total },
    }
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
  const sup = supportMod(state, c.x, c.y, me.team, [me.id, c.id]);
  const r = dice.check(me.ctl + sup, stealTN(c.ctl));
  Object.assign(r, {
    title: 'Tackle',
    tnLabel: `8 base + ${c.ctl} their CTL`,
    modLabel: `CTL +${me.ctl}${sup ? ` ${sup > 0 ? '+' : ''}${sup} support` : ''}`,
  });
  state.actionUsed = true;
  state.moverId = me.id;
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

export const PASS_MAX = 10;

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
  Object.assign(r, {
    title: 'Pass',
    tnLabel: `6 base + ${Math.floor(dist / 3)} distance`,
    modLabel: `PAS +${passer.pas}`,
  });
  state.actionUsed = true;
  state.moverId = passer.id;
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
  const distPart = Math.ceil(Math.max(0, dist - 2) / 2);
  Object.assign(r, {
    title: 'Shot',
    tnLabel: `8 base${distPart ? ` + ${distPart} distance` : ''}${aim.col !== 1 ? ' + 1 corner' : ''}`,
    modLabel: `SHO +${shooter.sho}`,
  });
  state.actionUsed = true;
  state.moverId = shooter.id;
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
      Object.assign(keeperRoll, {
        title: 'Keeper scramble',
        tnLabel: '8 base',
        modLabel: `CTL +${keeper.ctl}`,
      });
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

  // Cinematic verdicts: say what actually happened, not SUCCESS/FAIL —
  // an on-target shot can still be a save.
  if (!r.success) {
    r.verdict =
      outcome === 'rebound'
        ? { text: '💥 OFF THE FRAME!', tone: 'no' }
        : { text: 'OFF TARGET', tone: 'no' };
  } else if (r.doubles) {
    r.verdict = { text: '⚽ GOAL! Unstoppable!', tone: 'ok' };
  } else if (keeperRoll) {
    r.verdict = { text: 'ON TARGET — keeper scrambles…', tone: 'mid' };
    keeperRoll.verdict = keeperRoll.success
      ? { text: '🧤 SAVED!', tone: 'mid' }
      : { text: '⚽ GOAL!', tone: 'ok' };
  } else if (outcome === 'save') {
    r.verdict = { text: '🧤 SAVED — keeper guessed right!', tone: 'mid' };
  } else {
    r.verdict = { text: '⚽ GOAL! Keeper went the wrong way!', tone: 'ok' };
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
    for (let gx = GOAL_COLS[0] - 1; gx <= GOAL_COLS[GOAL_COLS.length - 1] + 1; gx++) {
      if (!occupantAt(state, gx, gy)) options.push(gx);
    }
    state.ball.carrier = null;
    state.ball.x = options.length ? dice.pick(options) : CENTER_X;
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
  const mid = Math.floor(H / 2);
  state.moverId = null;
  state.stepsUsed = 0;
  state.ball.carrier = null;
  state.ball.x = CENTER_X;
  state.ball.y = teamWithBall === 'home' ? mid : mid - 1;
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
    // Nudge the squatter away from the center line, toward whichever half
    // the kicking team does NOT occupy the ball tile in.
    placeAt(state, squatter, state.ball.x, state.ball.y === mid ? mid + 1 : mid - 2);
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
  state.moverId = null;
  state.moved = false;
  state.stepsUsed = 0;
  state.actionUsed = false;
}

// Every active-team footballer except the controlled mover drifts 1 step
// (8-directional) toward its formation slot. Blocked tiles (players, the
// loose ball) halt drift for that piece this turn. driftPreview computes the
// steps without applying them (the UI draws them as arrows); drift applies
// the identical steps.
export function driftPreview(state) {
  const team = state.activeTeam;
  const mover = activePlayerId(state);
  const targets = formationTargets(state, team);
  const occupied = new Set(state.players.map((p) => `${p.x},${p.y}`));
  const steps = [];
  for (const p of state.players.filter((q) => q.team === team)) {
    // The controlled mover holds position; so does whoever holds the ball
    // (drifting a carrier would drag possession around for free).
    if (p.id === mover || p.id === state.ball.carrier) continue;
    const t = targets[p.id];
    const cur = { x: p.x, y: p.y };
    if (cur.x === t.x && cur.y === t.y) continue;
    let best = null;
    let bestD = (cur.x - t.x) ** 2 + (cur.y - t.y) ** 2;
    for (const [dx, dy] of DIRS8) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!inBounds(nx, ny)) continue;
      if (occupied.has(`${nx},${ny}`)) continue;
      if (!state.ball.carrier && state.ball.x === nx && state.ball.y === ny) continue;
      const d = (nx - t.x) ** 2 + (ny - t.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = [nx, ny];
      }
    }
    if (best) {
      occupied.delete(`${cur.x},${cur.y}`);
      occupied.add(`${best[0]},${best[1]}`);
      steps.push({ id: p.id, from: [cur.x, cur.y], to: best });
    }
  }
  return steps;
}

function drift(state) {
  for (const s of driftPreview(state)) {
    const p = getPlayer(state, s.id);
    p.x = s.to[0];
    p.y = s.to[1];
  }
}
