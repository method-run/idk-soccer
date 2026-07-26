// Heuristic computer opponent. Decisions are made in three phases that
// main.js executes with animation delays between them:
//   aiChooseFormation -> aiChooseMove -> aiChooseAction
// plus aiPickDive when defending a shot.

import { W, H } from './data.js';
import {
  activePlayerId, getPlayer, carrier, reachable, cheb, attackMouth,
  canSteal, canShoot, canPass, shotDistance, shotTN, passTN, stealTN,
  occupantAt, PASS_MAX, keeperDistance, KEEPER_STRANDED, offsideStatus,
  shotTNFor,
} from './game.js';

// P(2d6 + mod >= tn)
export function p2d6(mod, tn) {
  const need = tn - mod;
  if (need <= 2) return 1;
  if (need > 12) return 0;
  let ways = 0;
  for (let s = need; s <= 12; s++) ways += 6 - Math.abs(7 - s);
  return ways / 36;
}

export function aiChooseFormation(state) {
  const team = state.activeTeam;
  const c = carrier(state);
  const mid = Math.floor(H / 2);
  const ballInMyHalf =
    team === 'home' ? state.ball.y >= mid : state.ball.y < mid;
  let want;
  if (c && c.team === team) want = ballInMyHalf ? 'press' : 'attack';
  else if (c) want = ballInMyHalf ? 'bus' : 'balanced';
  else want = ballInMyHalf ? 'balanced' : 'press';
  return state.formations[team] === want ? null : want;
}

export function aiChooseMove(state, dice) {
  const me = getPlayer(state, activePlayerId(state));
  const iCarrier = state.ball.carrier === me.id;
  const tiles = [...reachable(state, me.id).keys()]
    .map((k) => {
      const [x, y] = k.split(',').map(Number);
      return { x, y };
    })
    .filter((t) => iCarrier || offsideStatus(state, me.team, t.y) === 0);
  const mouth = attackMouth(me.team);
  const iCarry = state.ball.carrier === me.id;
  const oppCarrier = carrier(state) && carrier(state).team !== me.team ? carrier(state) : null;

  const adjOpps = (x, y) =>
    state.players.filter(
      (p) => p.team !== me.team && cheb(p.x, p.y, x, y) <= 1
    ).length;

  let goal; // scoring function per candidate tile
  if (iCarry) {
    goal = (t) =>
      -cheb(t.x, t.y, mouth.x, mouth.y) * 1.0 -
      adjOpps(t.x, t.y) * 1.4 +
      dice.random() * 0.3;
  } else if (oppCarrier) {
    goal = (t) => -cheb(t.x, t.y, oppCarrier.x, oppCarrier.y) * 1.0 + dice.random() * 0.2;
  } else {
    // loose ball: strongly prefer landing on it
    goal = (t) =>
      (t.x === state.ball.x && t.y === state.ball.y ? 100 : 0) -
      cheb(t.x, t.y, state.ball.x, state.ball.y) +
      dice.random() * 0.2;
  }
  let best = { x: me.x, y: me.y };
  let bestScore = goal(best);
  for (const t of tiles) {
    const s = goal(t);
    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }
  return best.x === me.x && best.y === me.y ? null : best;
}

export function aiChooseAction(state, dice) {
  if (canSteal(state)) return { type: 'steal' };
  const me = getPlayer(state, activePlayerId(state));
  if (!canPass(state)) return { type: 'none' };

  // Restart duty: the ball MUST be put back in play. Best teammate ball,
  // else hoof it toward the middle of the pitch.
  if (state.restartDuty && state.restartDuty.playerId === me.id) {
    let best = null;
    let bestP = -1;
    for (const p of state.players) {
      if (p.team !== me.team || p.id === me.id || p.role === 'GK') continue;
      const d = cheb(me.x, me.y, p.x, p.y);
      if (d < 1 || d > PASS_MAX) continue;
      const prob = p2d6(me.pas, passTN(d));
      if (prob > bestP) {
        bestP = prob;
        best = p;
      }
    }
    if (best) return { type: 'pass', x: best.x, y: best.y };
    const tx = Math.max(0, Math.min(W - 1, 4));
    const ty = Math.max(0, Math.min(H - 1, Math.round(H / 2)));
    return { type: 'pass', x: tx, y: ty };
  }

  // Shoot?
  const dist = shotDistance(state, me);
  const cornerAim = { col: dice.pick([0, 2]), high: dice.random() < 0.5 };
  const centerAim = { col: 1, high: dice.random() < 0.5 };
  const pCorner = p2d6(me.sho, shotTNFor(state, me, cornerAim));
  const pCenter = p2d6(me.sho, shotTNFor(state, me, centerAim));
  // Rough keeper-beat odds: corners dodge the dive more often.
  const kd = keeperDistance(state, me.team);
  const stranded = kd >= KEEPER_STRANDED;
  // Beat-the-keeper odds improve as the keeper strays; stranded = automatic.
  const keeperFactor = stranded ? 1 : Math.min(1, 0.6 + kd * 0.15);
  const evCorner = pCorner * (stranded ? 1 : Math.min(1, 0.8 + kd * 0.1));
  const evCenter = pCenter * keeperFactor;
  // Stranded keeper? Aim center: pure accuracy, no corner penalty needed.
  const aim = stranded || evCenter >= evCorner ? centerAim : cornerAim;
  const shootEV = Math.max(evCorner, evCenter);
  if (dist <= (stranded ? 9 : 6) && shootEV >= (stranded ? 0.15 : 0.25)) {
    return { type: 'shoot', aim };
  }

  // Pass? Find a teammate meaningfully closer to goal, on a makeable ball.
  const mouth = attackMouth(me.team);
  let bestPass = null;
  let bestVal = 0.5; // threshold
  for (const p of state.players) {
    if (p.team !== me.team || p.id === me.id || p.role === 'GK') continue;
    const d = cheb(me.x, me.y, p.x, p.y);
    if (d < 1 || d > PASS_MAX) continue;
    const gain = cheb(me.x, me.y, mouth.x, mouth.y) - cheb(p.x, p.y, mouth.x, mouth.y);
    if (gain < 1) continue;
    const marked = state.players.some(
      (q) => q.team !== me.team && cheb(q.x, q.y, p.x, p.y) <= 1
    );
    const val = p2d6(me.pas, passTN(d)) * (marked ? 0.6 : 1) + gain * 0.05;
    if (val > bestVal) {
      bestVal = val;
      bestPass = p;
    }
  }
  if (bestPass) return { type: 'pass', x: bestPass.x, y: bestPass.y };

  // Under pressure with no better idea? Hoof it toward the goal mouth side.
  const pressure = state.players.filter(
    (p) => p.team !== me.team && cheb(p.x, p.y, me.x, me.y) <= 1
  ).length;
  if (pressure >= 2) {
    const ty = me.team === 'home' ? Math.max(0, me.y - 5) : Math.min(H - 1, me.y + 5);
    const tx = Math.max(0, Math.min(W - 1, me.x + dice.pick([-1, 0, 1])));
    if (!(tx === me.x && ty === me.y)) return { type: 'pass', x: tx, y: ty };
  }
  return { type: 'none' };
}

// Keeper dive for the AI: center-weighted columns, 50/50 height.
export function aiPickDive(state, dice) {
  const r = dice.random();
  const col = r < 0.28 ? 0 : r < 0.72 ? 1 : 2;
  return { col, high: dice.random() < 0.5 };
}
