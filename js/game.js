// Pure game engine. No DOM. All randomness comes through an injected dice
// object (see dice.js) so the engine is testable and replayable.

import { W, H, MAX_TURNS, ROSTER, FORMATIONS, GOAL_COLS, CENTER_X, mirrorY } from './data.js';
import { abilityFor } from './abilities.js';

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
        lookId: p.id || null, // portrait key for drafted pool players
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
    // --- charge & ability system ---
    charges: { home: 0, away: 0 },
    earned: { home: {}, away: {} }, // per-turn earning caps by category
    frozen: {}, // playerId -> frozen while state.turn <= value
    effects: [], // active ability effects {kind, team, playerId, until, once?...}
    usedAbility: {}, // playerId -> turn of last activation (once per turn each)
    bonusMove: null, // {playerId, left} — ability-granted move for a non-mover
    lastPass: null, // {team, turn, success, receiverId}
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
// Charges: outcome-blind rewards for USING the mechanics, plus comeback
// drips. Each category earns at most once per your turn; bank caps at 6.

export const CHARGE_CAP = 6;

function addCharge(state, team, key, n = 1) {
  if (key && state.earned[team][key]) return;
  if (key) state.earned[team][key] = true;
  const before = state.charges[team];
  state.charges[team] = Math.min(CHARGE_CAP, before + n);
  if (state.charges[team] > before) {
    logEvent(state, 'charge', `${team} +${state.charges[team] - before}⚡ (${key || 'bonus'}) → ${state.charges[team]}`);
  }
}

export function isFrozen(state, playerId) {
  return (state.frozen[playerId] || -1) >= state.turn;
}

// Active ability effects
function fx(state, kind, filter = {}) {
  return state.effects.find(
    (e) =>
      e.kind === kind &&
      (filter.team == null || e.team === filter.team) &&
      (filter.playerId == null || e.playerId === filter.playerId)
  );
}

function consumeFx(state, effect) {
  state.effects = state.effects.filter((e) => e !== effect);
}

// CTL with ability buffs (Organizer aura, Bodyline).
function effCtl(state, p) {
  let c = p.ctl;
  const self = fx(state, 'ctlSelf', { playerId: p.id });
  if (self) c += self.n;
  for (const e of state.effects) {
    if (e.kind === 'ctlAura' && e.team === p.team && e.playerId !== p.id) {
      const src = getPlayer(state, e.playerId);
      if (cheb(src.x, src.y, p.x, p.y) <= e.radius) c += e.n;
    }
  }
  return c;
}

// ---------------------------------------------------------------------------
// Active mover: an explicit selection if one was made this turn, else the
// default — your carrier, else your closest to the ball.

export function activePlayerId(state) {
  // An ability-granted bonus move temporarily controls that player.
  if (state.bonusMove) return state.bonusMove.playerId;
  const team = state.activeTeam;
  if (state.moverId) {
    const sel = getPlayer(state, state.moverId);
    if (sel && sel.team === team && !isFrozen(state, sel.id)) return sel.id;
  }
  const c = carrier(state);
  if (c && c.team === team && !isFrozen(state, c.id)) return c.id;
  let best = null;
  let bestKey = Infinity;
  for (const p of state.players) {
    if (p.team !== team || isFrozen(state, p.id)) continue;
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
  if (isFrozen(state, id)) return { ok: false, reason: 'frozen by a foul' };
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

// The Wall: an active zone-denial effect. Returns the guarding defender if
// (x,y) lies in their plus-shaped zone (his square + orthogonal neighbors),
// else null. Frozen guards don't guard.
export function wallGuardAt(state, x, y, dribblerTeam) {
  for (const e of state.effects) {
    if (e.kind !== 'wall' || e.team === dribblerTeam) continue;
    const g = getPlayer(state, e.playerId);
    if (g && !isFrozen(state, g.id) && Math.abs(g.x - x) + Math.abs(g.y - y) <= 1) return g;
  }
  return null;
}

// Outnumbering modifier for ball-control contests: each extra footballer
// adjacent to the contest tile beyond the other side's count is worth +1,
// capped at ±2. The two primary contestants don't count themselves.
export function supportMod(state, x, y, team, excludeIds = []) {
  let mine = 0;
  let theirs = 0;
  for (const p of state.players) {
    if (excludeIds.includes(p.id) || isFrozen(state, p.id)) continue;
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
  let range = isCarrier ? Math.max(1, player.spd - 1) : player.spd;
  const boost = fx(state, 'steps', { playerId: player.id });
  if (boost) range += boost.n;
  return range;
}

// Steps the current mover still has this turn.
export function stepsLeft(state) {
  if (state.bonusMove) return state.bonusMove.left;
  const p = getPlayer(state, activePlayerId(state));
  return Math.max(0, moveRange(state, p) - state.stepsUsed);
}

// 8-directional path search. Occupied tiles are traversable but not
// terminal. Among equal-step routes the search prefers, in order: entering
// fewer opponent squares (heavily so while carrying — those are dribble
// challenges), fewer teammate squares, and the fewest direction changes
// (straight lines beat zigzags). Returns { dist: Map key->steps (endable
// tiles only), parent: Map } within the mover's remaining budget.
function bfsInfo(state, playerId, max) {
  const player = getPlayer(state, playerId);
  const isCarrier = state.ball.carrier === playerId;
  const occ = new Map();
  for (const p of state.players) {
    if (p.id !== playerId) occ.set(`${p.x},${p.y}`, p.team === player.team ? 'mate' : 'opp');
  }
  const STEP = 100000;
  const OPP = isCarrier ? 2000 : 400;
  const MATE = 100;
  const TURNC = 1;
  // active Wall zones are certain turnovers for a carrier: worst hazard
  const wallTiles = new Set();
  if (isCarrier) {
    for (const e of state.effects) {
      if (e.kind !== 'wall' || e.team === player.team) continue;
      const g = getPlayer(state, e.playerId);
      if (!g || isFrozen(state, g.id)) continue;
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        wallTiles.add(`${g.x + dx},${g.y + dy}`);
      }
    }
  }
  const startKey = `${player.x},${player.y}`;
  // best per tile: lowest composite cost (steps strictly dominate)
  const best = new Map([[startKey, { steps: 0, cost: 0, dir: -1 }]]);
  const parent = new Map();
  const queue = [{ x: player.x, y: player.y, key: startKey, steps: 0, cost: 0, dir: -1 }];
  while (queue.length) {
    let qi = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].cost < queue[qi].cost) qi = i;
    const cur = queue.splice(qi, 1)[0];
    if (cur.cost > (best.get(cur.key)?.cost ?? Infinity)) continue;
    if (cur.steps >= max) continue;
    for (let d = 0; d < DIRS8.length; d++) {
      const nx = cur.x + DIRS8[d][0];
      const ny = cur.y + DIRS8[d][1];
      if (!inBounds(nx, ny)) continue;
      const key = `${nx},${ny}`;
      const kind = occ.get(key);
      const hazard = wallTiles.has(key)
        ? OPP * 3
        : kind === 'opp'
          ? OPP
          : kind === 'mate'
            ? MATE
            : 0;
      const turn = cur.dir !== -1 && cur.dir !== d ? TURNC : 0;
      const cost = cur.cost + STEP + hazard + turn;
      const prev = best.get(key);
      if (!prev || cost < prev.cost) {
        best.set(key, { steps: cur.steps + 1, cost, dir: d });
        parent.set(key, cur.key);
        queue.push({ x: nx, y: ny, key, steps: cur.steps + 1, cost, dir: d });
      }
    }
  }
  const dist = new Map();
  for (const [key, b] of best) {
    if (!occ.has(key)) dist.set(key, b.steps);
  }
  return { dist, parent, startKey };
}

function budgetFor(state, playerId) {
  if (state.bonusMove && state.bonusMove.playerId === playerId) {
    return state.bonusMove.left;
  }
  const player = getPlayer(state, playerId);
  const used = activePlayerId(state) === playerId ? state.stepsUsed : 0;
  return Math.max(0, moveRange(state, player) - used);
}

// Map "x,y" -> steps for tiles the player can END a segment on.
export function reachable(state, playerId) {
  return bfsInfo(state, playerId, budgetFor(state, playerId)).dist;
}

// The route a move to (x,y) would take: { steps, path: [[x,y],...] }
// (start exclusive, destination inclusive), or null if unreachable. This is
// exactly the path doMove will walk, so the UI can preview challenges.
export function movePath(state, playerId, x, y) {
  const info = bfsInfo(state, playerId, budgetFor(state, playerId));
  const key = `${x},${y}`;
  const steps = info.dist.get(key);
  if (!steps) return null;
  const path = [];
  for (let k = key; k !== info.startKey; k = info.parent.get(k)) {
    path.unshift(k.split(',').map(Number));
  }
  return { steps, path };
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
  if (state.bonusMove && state.bonusMove.playerId === player.id) {
    state.bonusMove.left -= steps;
    if (state.bonusMove.left <= 0) state.bonusMove = null;
  } else {
    state.moved = true;
    state.moverId = player.id; // lock the selection once committed
    state.stepsUsed += steps;
  }

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
  // Dribble challenges for every opponent stood on the path, and Wall
  // zone-denial for every path square adjacent to an active Wall.
  for (const [tx, ty] of path) {
    if (state.ball.carrier !== player.id) break; // lost it en route
    const guard = wallGuardAt(state, tx, ty, player.team);
    if (guard) {
      const auto = fx(state, 'dribbleAuto', { playerId: player.id });
      if (auto) {
        logEvent(state, 'dribble',
          `#${player.num} ${player.name} dances through THE WALL's zone untouched!`);
      } else {
        state.ball.carrier = guard.id;
        state.ball.x = guard.x;
        state.ball.y = guard.y;
        logEvent(state, 'dribble',
          `#${player.num} ${player.name} strays into THE WALL — #${guard.num} ${guard.name} strips it clean!`);
        break;
      }
    }
    const occ = occupantAt(state, tx, ty);
    if (occ && occ.team !== player.team) {
      addCharge(state, player.team, 'dribble'); // taking someone on: earn
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
  // Ability short-circuits: Slalom/Press Resistance/Baila carry the dribbler
  // through; The Wall hands the ball straight to the guarded defender.
  const auto = fx(state, 'dribbleAuto', { playerId: dribbler.id });
  if (auto) {
    logEvent(state, 'dribble',
      `#${dribbler.num} ${dribbler.name} glides past #${defender.num} ${defender.name} — untouchable!`);
    if (auto.freezeBeaten) {
      state.frozen[defender.id] = state.turn + 1;
      logEvent(state, 'freeze', `#${defender.num} ${defender.name} is left dancing — frozen!`);
    }
    if (auto.once) consumeFx(state, auto);
    return;
  }
  // (Wall zone-denial is handled tile-by-tile in doMove before this point.)
  const sup = supportMod(state, defender.x, defender.y, dribbler.team, [
    dribbler.id,
    defender.id,
  ]);
  const mine = dice.roll2d6(effCtl(state, dribbler) + sup);
  const theirs = dice.roll2d6(effCtl(state, defender));
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
  const mine = dice.roll2d6(effCtl(state, player) + sup);
  const theirs = dice.roll2d6(effCtl(state, opp));
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
  if (state.actionUsed || state.bonusMove) return false;
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
  addCharge(state, me.team, 'tackle'); // attempting is what earns
  // Half-Turn Escape: steals against the guarded player simply fail.
  const guard = fx(state, 'stealGuard', { playerId: c.id });
  if (guard) {
    state.actionUsed = true;
    state.moverId = me.id;
    logEvent(state, 'steal',
      `#${me.num} ${me.name} lunges — but #${c.num} ${c.name} escapes on a half-turn!`);
    return { ok: true, roll: null, escaped: true };
  }
  const sup = supportMod(state, c.x, c.y, me.team, [me.id, c.id]);
  const r = dice.check(effCtl(state, me) + sup, stealTN(effCtl(state, c)));
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
  if (state.actionUsed || state.bonusMove) return false;
  const c = carrier(state);
  return !!c && c.team === state.activeTeam && c.id === activePlayerId(state);
}

export function doPass(state, dice, x, y) {
  if (!canPass(state)) return { ok: false, reason: 'cannot pass' };
  const passer = carrier(state);
  const dist = cheb(passer.x, passer.y, x, y);
  const flat = fx(state, 'passFlat', { team: passer.team });
  const auto = fx(state, 'passAuto', { team: passer.team });
  const maxRange = flat ? Math.max(W, H) : PASS_MAX;
  if (dist < 1 || dist > maxRange || !inBounds(x, y)) {
    return { ok: false, reason: 'bad target' };
  }
  const metro = fx(state, 'metronome', { team: passer.team });
  addCharge(state, passer.team, 'pass', metro ? 2 : 1); // attempting earns
  const tn = flat ? 6 : passTN(dist);
  const r = dice.check(passer.pas, tn);
  if (auto && !r.success) {
    r.success = true;
    r.margin = 0;
    r.total = r.tn;
  }
  Object.assign(r, {
    title: 'Pass',
    tnLabel: flat ? '6 flat (ability)' : `6 base + ${Math.floor(dist / 3)} distance`,
    modLabel: `PAS +${passer.pas}`,
    verdict: auto ? { text: '🎯 LASER — cannot miss!', tone: 'ok' } : undefined,
  });
  if (flat) consumeFx(state, flat);
  if (auto) consumeFx(state, auto);
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
  const completed = !!rec && rec.team === passer.team && r.success;
  state.lastPass = {
    team: passer.team,
    turn: state.turn,
    success: completed,
    receiverId: completed ? rec.id : null,
  };
  // One-Two: the receiver bursts onward immediately.
  const ot = fx(state, 'oneTwo', { team: passer.team });
  if (ot) {
    if (completed && rec.id !== passer.id) {
      state.bonusMove = { playerId: rec.id, left: 2 };
      logEvent(state, 'ability', `One-two! #${rec.num} ${rec.name} plays on (2 bonus steps)`);
    }
    consumeFx(state, ot);
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
  return 6 + Math.ceil(Math.max(0, dist - 2) / 3) + (aim && aim.col !== 1 ? 1 : 0);
}

export function canShoot(state) {
  return canPass(state); // same preconditions: forced mover holds the ball
}

export function defendingKeeper(state, attackingTeam) {
  return state.players.find(
    (p) => p.team === otherTeam(attackingTeam) && p.role === 'GK'
  );
}

// How far the defending keeper stands from their goal mouth (Chebyshev to
// the nearest mouth tile). 0 = on the line; 3+ = stranded, no save possible.
export function keeperDistance(state, attackingTeam) {
  const keeper = defendingKeeper(state, attackingTeam);
  const gy = attackingTeam === 'home' ? 0 : H - 1;
  return Math.min(...GOAL_COLS.map((gx) => cheb(keeper.x, keeper.y, gx, gy)));
}

export const KEEPER_STRANDED = 3;

export function doShoot(state, dice, aim, dive) {
  if (!canShoot(state)) return { ok: false, reason: 'cannot shoot' };
  const shooter = carrier(state);
  const keeper = defendingKeeper(state, shooter.team);
  const dist = shotDistance(state, shooter);
  addCharge(state, shooter.team, 'shot'); // attempting earns
  // ability effects on this shot
  const noDist = fx(state, 'shotNoDist', { team: shooter.team });
  const autoAcc = fx(state, 'shotAuto', { team: shooter.team });
  const skipGk = fx(state, 'skipKeeper', { team: shooter.team });
  const cutIn = fx(state, 'shoMove', { playerId: shooter.id });
  const shoBonus = cutIn && state.stepsUsed >= 2 ? 2 : 0;
  let tn = shotTN(dist, aim);
  let distPart = Math.ceil(Math.max(0, dist - 2) / 3);
  if (noDist) {
    tn -= distPart;
    distPart = 0;
    consumeFx(state, noDist);
  }
  const r = dice.check(shooter.sho + shoBonus, tn);
  if (autoAcc && !r.success) {
    r.success = true;
    r.margin = 0;
    r.total = r.tn;
  }
  if (autoAcc) consumeFx(state, autoAcc);
  if (cutIn && shoBonus) consumeFx(state, cutIn);
  Object.assign(r, {
    title: 'Shot',
    tnLabel: `6 base${distPart ? ` + ${distPart} distance` : ''}${aim.col !== 1 ? ' + 1 corner' : ''}${noDist ? ' (no distance: ability)' : ''}`,
    modLabel: `SHO +${shooter.sho}${shoBonus ? ' +2 cut inside' : ''}`,
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
  let kd = keeperDistance(state, shooter.team);
  const line = fx(state, 'keeperLine', { team: keeper.team });
  if (line) kd = 0; // sweeper-keeper: never punished for being off his line
  const siuu = r.success && skipGk;
  if (siuu) consumeFx(state, skipGk);
  if (r.success && (r.doubles || siuu)) {
    outcome = 'goal';
    logEvent(state, 'goal', siuu ? 'SIUUU! Nothing the keeper can do!' : 'DOUBLES! An unstoppable screamer!');
  } else if (r.success) {
    // Graded save: the closer the dive to the shot — and the closer the
    // keeper stands to their line — the better the odds. Exact cell from
    // on the line is a certain save; the opposite corner (3 cells off) has
    // no chance; a keeper 3+ squares upfield is stranded and can't save at
    // all. In between: 2d6+CTL vs 8 + 3/cell off + 2/square off the line.
    if (kd >= KEEPER_STRANDED || !dive) {
      outcome = 'goal';
      logEvent(state, 'goal',
        `Keeper is stranded ${kd} squares upfield — nobody home. GOAL!`);
    } else {
      const diveName = `${dive.high ? 'high' : 'low'} ${['left', 'center', 'right'][dive.col]}`;
      let off =
        Math.abs(dive.col - aim.col) + Math.abs((dive.high ? 1 : 0) - (aim.high ? 1 : 0));
      const cover = fx(state, 'diveCover', { team: keeper.team });
      if (cover) {
        off = Math.max(0, off - 1);
        consumeFx(state, cover);
        logEvent(state, 'save', 'The keeper seems to cover the whole goal!');
      }
      const posNote = kd ? `, ${kd} off their line` : '';
      if (off === 0 && kd === 0) {
        outcome = 'save';
        logEvent(state, 'save', `Keeper dove ${diveName} — right there! SAVED`);
      } else if (off >= 3) {
        outcome = 'goal';
        logEvent(state, 'goal', `Keeper dove ${diveName} — completely the wrong way! GOAL!`);
      } else {
        keeperRoll = dice.check(effCtl(state, keeper), 8 + 3 * off + 2 * kd);
        Object.assign(keeperRoll, {
          title: 'Keeper save',
          tnLabel: `8 base${off ? ` + ${3 * off} (${off} cell${off > 1 ? 's' : ''} off the shot)` : ''}${
            kd ? ` + ${2 * kd} (off their line)` : ''
          }`,
          modLabel: `CTL +${keeper.ctl}`,
        });
        if (keeperRoll.success) {
          outcome = 'save';
          logEvent(state, 'save',
            `Keeper dove ${diveName} (${off} off${posNote}): ${keeperRoll.a}+${keeperRoll.b}+${keeperRoll.mod}=${keeperRoll.total} vs ${keeperRoll.tn} — SAVED`,
            keeperRoll);
        } else {
          outcome = 'goal';
          logEvent(state, 'goal',
            `Keeper dove ${diveName} (${off} off${posNote}): ${keeperRoll.total} vs ${keeperRoll.tn} — not enough. GOAL!`,
            keeperRoll);
        }
      }
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
  } else if (siuu) {
    r.verdict = { text: '⚽ SIUUU! GOAL!', tone: 'ok' };
  } else if (r.doubles) {
    r.verdict = { text: '⚽ GOAL! Unstoppable!', tone: 'ok' };
  } else if (keeperRoll) {
    r.verdict = { text: 'ON TARGET — keeper scrambles…', tone: 'mid' };
    keeperRoll.verdict = keeperRoll.success
      ? { text: '🧤 SAVED!', tone: 'mid' }
      : { text: '⚽ GOAL!', tone: 'ok' };
  } else if (outcome === 'save') {
    r.verdict = { text: '🧤 SAVED — keeper guessed right!', tone: 'mid' };
  } else if (kd >= KEEPER_STRANDED) {
    r.verdict = { text: '⚽ GOAL! Keeper stranded — empty net!', tone: 'ok' };
  } else {
    r.verdict = { text: '⚽ GOAL! Keeper went the wrong way!', tone: 'ok' };
  }

  if (outcome === 'goal') {
    state.score[shooter.team]++;
    logEvent(state, 'score', `${shooter.team.toUpperCase()} scores! ${state.score.home}–${state.score.away}`);
    addCharge(state, otherTeam(shooter.team), 'concede', 2); // comeback fuel
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
  const ender = state.activeTeam;
  // Comeback drip: ending your turn without the ball earns a charge.
  const c = carrier(state);
  if (!c || c.team !== ender) addCharge(state, ender, 'nopos');
  if (!skipDrift) {
    drift(state);
    if (fx(state, 'drift2', { team: ender })) drift(state); // Dictate Tempo
  }
  state.earned[ender] = {};
  state.bonusMove = null;
  state.turn++;
  state.effects = state.effects.filter((e) => e.until >= state.turn);
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
    // (drifting a carrier would drag possession around for free). Frozen
    // players lie where they were fouled.
    if (p.id === mover || p.id === state.ball.carrier || isFrozen(state, p.id)) continue;
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

// ---------------------------------------------------------------------------
// Ability activation. Stacking allowed: any number of activations per turn,
// but each player's ability at most once per turn. Activations happen before
// dice are rolled for the affected action (deterministic, so undoable).

export function canActivateAbility(state, playerId) {
  const p = getPlayer(state, playerId);
  const def = abilityFor(p);
  const no = (reason) => ({ ok: false, reason, def });
  if (!def) return no(null);
  if (state.over || state.bonusMove) return no('busy');
  if (def.kind === 'diveCover') return no('reaction'); // via activateDiveBoost
  if (p.team !== state.activeTeam) return no('not your turn');
  if (isFrozen(state, playerId)) return no('frozen');
  if (state.usedAbility[playerId] === state.turn) return no('already used');
  if (state.charges[p.team] < def.cost) return no('not enough charges');
  const c = carrier(state);
  const carrying = state.ball.carrier === playerId;
  const adjOpps = state.players.filter(
    (q) => q.team !== p.team && !isFrozen(state, q.id) && cheb(q.x, q.y, p.x, p.y) <= 1
  );
  switch (def.kind) {
    case 'steps':
      if (def.needs === 'notCarrying' && carrying) return no('not while carrying');
      if (def.needs === 'oppBall' && !(c && c.team !== p.team)) return no('needs opponent ball');
      break;
    case 'autoSteal':
      if (state.actionUsed) return no('action used');
      if (!(c && c.team !== p.team && cheb(p.x, p.y, c.x, c.y) <= 1)) return no('no adjacent carrier');
      break;
    case 'passAuto':
    case 'passFlat':
    case 'oneTwo':
    case 'shotNoDist':
    case 'shoMove':
      if (!carrying || state.actionUsed) return no('needs the ball');
      break;
    case 'shotAuto':
    case 'skipKeeper':
      if (!carrying || state.actionUsed) return no('needs the ball');
      if (shotDistance(state, p) > def.maxDist) return no(`needs range ${def.maxDist}`);
      break;
    case 'dribbleAuto':
      if (!carrying) return no('needs the ball');
      break;
    case 'freeze':
    case 'drama':
      if (!adjOpps.length) return no('no adjacent opponent');
      return { ok: true, def, targets: adjOpps.map((q) => q.id) };
    case 'arrive':
      if (
        !(
          state.lastPass &&
          state.lastPass.turn === state.turn &&
          state.lastPass.team === p.team &&
          state.lastPass.success
        )
      ) {
        return no('needs a completed pass this turn');
      }
      break;
    default:
      break; // always-on kinds: wall, stealGuard, ctlAura, ctlSelf, metronome, drift2, keeperLine
  }
  return { ok: true, def };
}

export function activateAbility(state, playerId, targetId = null) {
  const chk = canActivateAbility(state, playerId);
  if (!chk.ok) return chk;
  const p = getPlayer(state, playerId);
  const def = chk.def;
  // freeze/drama need a resolved target before we commit charges
  let target = null;
  if (def.kind === 'freeze' || def.kind === 'drama') {
    const id = targetId || (chk.targets.length === 1 ? chk.targets[0] : null);
    if (!id || !chk.targets.includes(id)) {
      return { ok: false, reason: 'target required', needsTarget: true, targets: chk.targets, def };
    }
    target = getPlayer(state, id);
  }
  state.charges[p.team] -= def.cost;
  state.usedAbility[playerId] = state.turn;
  logEvent(state, 'ability', `✨ #${p.num} ${p.name}: ${def.name} (−${def.cost}⚡)`);
  const t = state.turn;
  const push = (e) => state.effects.push({ playerId, team: p.team, ...e });
  switch (def.kind) {
    case 'steps':
      push({ kind: 'steps', n: def.n, until: t });
      break;
    case 'keeperLine':
      push({ kind: 'steps', n: 2, until: t });
      push({ kind: 'keeperLine', until: t + 1 });
      break;
    case 'autoSteal': {
      const c = carrier(state);
      state.ball.carrier = p.id;
      state.ball.x = p.x;
      state.ball.y = p.y;
      state.actionUsed = true;
      state.moverId = p.id;
      logEvent(state, 'steal', `#${p.num} ${p.name} takes it clean off #${c.num} ${c.name} — no contest!`);
      break;
    }
    case 'passAuto':
    case 'passFlat':
    case 'oneTwo':
    case 'shotNoDist':
    case 'shotAuto':
    case 'skipKeeper':
      push({ kind: def.kind, maxDist: def.maxDist, until: t, once: true });
      break;
    case 'dribbleAuto':
      push({ kind: 'dribbleAuto', until: t, freezeBeaten: def.freezeBeaten, once: def.once });
      if (def.n) push({ kind: 'steps', n: def.n, until: t });
      break;
    case 'shoMove':
      push({ kind: 'shoMove', until: t });
      break;
    case 'wall':
    case 'stealGuard':
      push({ kind: def.kind, until: t + 1 });
      break;
    case 'ctlAura':
      push({ kind: 'ctlAura', n: def.n, radius: def.radius, until: t + 1 });
      break;
    case 'ctlSelf':
      push({ kind: 'ctlSelf', n: def.n, until: t + 1 });
      break;
    case 'metronome':
      push({ kind: 'metronome', until: t + 1 });
      break;
    case 'drift2':
      push({ kind: 'drift2', until: t });
      break;
    case 'freeze':
    case 'drama':
      state.frozen[target.id] = t + 1;
      logEvent(state, 'freeze',
        `#${target.num} ${target.name} is ${def.kind === 'drama' ? 'booked for the foul' : 'fouled'} — frozen for their next turn!`);
      if (def.kind === 'drama') {
        drift(state);
        drift(state);
        logEvent(state, 'formation', `${p.team} reset their shape around the free kick`);
      }
      break;
    case 'arrive':
      state.bonusMove = { playerId, left: p.spd };
      logEvent(state, 'ability', `#${p.num} ${p.name} arrives late into the play — bonus run!`);
      break;
    default:
      break;
  }
  return { ok: true, def };
}

// Keeper dive boost (Big-Game Save / Giant Frame): a reaction available to
// the DEFENDING team while their keeper picks a dive.
export function canDiveBoost(state, defendingTeam) {
  const keeper = state.players.find((q) => q.team === defendingTeam && q.role === 'GK');
  const def = abilityFor(keeper);
  if (!def || def.kind !== 'diveCover') return { ok: false };
  if (state.usedAbility[keeper.id] === state.turn) return { ok: false, reason: 'already used' };
  if (state.charges[defendingTeam] < def.cost) return { ok: false, reason: 'not enough charges' };
  if (fx(state, 'diveCover', { team: defendingTeam })) return { ok: false, reason: 'already active' };
  return { ok: true, def, keeperId: keeper.id };
}

export function activateDiveBoost(state, defendingTeam) {
  const chk = canDiveBoost(state, defendingTeam);
  if (!chk.ok) return chk;
  const keeper = getPlayer(state, chk.keeperId);
  state.charges[defendingTeam] -= chk.def.cost;
  state.usedAbility[keeper.id] = state.turn;
  state.effects.push({ kind: 'diveCover', playerId: keeper.id, team: defendingTeam, until: state.turn, once: true });
  logEvent(state, 'ability', `✨ #${keeper.num} ${keeper.name}: ${chk.def.name} (−${chk.def.cost}⚡)`);
  return { ok: true, def: chk.def };
}
