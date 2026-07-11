import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDice } from '../js/dice.js';
import { W, H } from '../js/data.js';
import {
  newMatch, activePlayerId, getPlayer, carrier, reachable, moveRange,
  doMove, doPass, doSteal, doShoot, canSteal, canShoot, setFormation,
  endTurn, formationTargets, cheb, occupantAt, passTN, shotTN, stealTN,
} from '../js/game.js';
import {
  aiChooseFormation, aiChooseMove, aiChooseAction, aiPickDive, p2d6,
} from '../js/ai.js';

// Dice stub: d6 pops values from a queue (cycles); random() is fixed.
function stubDice(rolls, rand = 0.5) {
  let i = 0;
  return {
    d6() {
      return rolls[i++ % rolls.length];
    },
    roll2d6(mod = 0) {
      const a = this.d6();
      const b = this.d6();
      return { a, b, mod, total: a + b + mod, doubles: a === b };
    },
    check(mod, tn) {
      const r = this.roll2d6(mod);
      return { ...r, tn, success: r.total >= tn, margin: r.total - tn };
    },
    pick(arr) {
      return arr[0];
    },
    random() {
      return rand;
    },
  };
}

function assertInvariants(state) {
  const seen = new Set();
  for (const p of state.players) {
    assert.ok(p.x >= 0 && p.x < W && p.y >= 0 && p.y < H, `${p.id} in bounds`);
    const key = `${p.x},${p.y}`;
    assert.ok(!seen.has(key), `no stacking at ${key}`);
    seen.add(key);
  }
  assert.ok(state.ball.x >= 0 && state.ball.x < W);
  assert.ok(state.ball.y >= 0 && state.ball.y < H);
  if (state.ball.carrier) {
    const c = carrier(state);
    assert.equal(c.x, state.ball.x, 'ball tracks carrier x');
    assert.equal(c.y, state.ball.y, 'ball tracks carrier y');
  }
  assert.ok(state.score.home >= 0 && state.score.away >= 0);
}

test('newMatch sets up a legal board with home in possession', () => {
  const s = newMatch();
  assert.equal(s.players.length, 14);
  assertInvariants(s);
  assert.ok(s.ball.carrier?.startsWith('home-'));
  assert.equal(s.activeTeam, 'home');
});

test('forced mover is the carrier, else closest to ball', () => {
  const s = newMatch();
  assert.equal(activePlayerId(s), s.ball.carrier);
  s.ball.carrier = null;
  s.ball.x = 0;
  s.ball.y = 11;
  const active = getPlayer(s, activePlayerId(s));
  for (const p of s.players.filter((q) => q.team === 'home')) {
    const da = cheb(active.x, active.y, 0, 11);
    const dp = cheb(p.x, p.y, 0, 11);
    assert.ok(da <= dp, 'no teammate is closer');
  }
});

test('carrying the ball reduces movement range', () => {
  const s = newMatch();
  const c = carrier(s);
  assert.equal(moveRange(s, c), Math.max(1, c.spd - 2));
  const other = s.players.find((p) => p.team === 'home' && p.id !== c.id);
  assert.equal(moveRange(s, other), other.spd);
});

test('dribbling carries the ball along', () => {
  const s = newMatch();
  const dice = stubDice([3, 3]);
  const c = carrier(s);
  const tiles = [...reachable(s, c.id).keys()].filter((k) => k !== `${c.x},${c.y}`);
  const [x, y] = tiles[0].split(',').map(Number);
  const res = doMove(s, dice, x, y);
  assert.ok(res.ok);
  assert.equal(s.ball.x, x);
  assert.equal(s.ball.y, y);
  assert.equal(s.ball.carrier, c.id);
});

// Spread everyone along the top/bottom edges so scenarios can place pieces
// explicitly without formation players interfering.
function clearBoard(s) {
  s.players.filter((p) => p.team === 'away').forEach((p, i) => {
    p.x = i;
    p.y = 0;
  });
  s.players.filter((p) => p.team === 'home').forEach((p, i) => {
    p.x = i;
    p.y = H - 1;
  });
}

test('uncontested pickup is automatic', () => {
  const s = newMatch();
  const dice = stubDice([1, 1]);
  clearBoard(s);
  const me = getPlayer(s, 'home-7');
  me.x = 3;
  me.y = 8;
  s.ball = { x: 3, y: 7, carrier: null };
  assert.equal(activePlayerId(s), me.id);
  const res = doMove(s, dice, 3, 7);
  assert.ok(res.ok);
  assert.equal(s.ball.carrier, me.id);
});

test('contested pickup: opposed roll, tie goes to the mover', () => {
  const s = newMatch();
  clearBoard(s);
  const me = getPlayer(s, 'home-2'); // ctl +2
  const opp = getPlayer(s, 'away-7'); // ctl +0
  me.x = 3;
  me.y = 9;
  opp.x = 3;
  opp.y = 7;
  s.ball = { x: 3, y: 8, carrier: null };
  // mover rolls 2+2(+2)=6, opp rolls 3+3(+0)=6 -> tie -> mover wins
  const dice = stubDice([2, 2, 3, 3]);
  assert.equal(activePlayerId(s), me.id);
  doMove(s, dice, 3, 8);
  assert.equal(s.ball.carrier, me.id);
});

test('contested pickup loss scatters the ball', () => {
  const s = newMatch();
  clearBoard(s);
  const me = getPlayer(s, 'home-7'); // ctl +0
  const opp = getPlayer(s, 'away-2'); // ctl +2
  me.x = 3;
  me.y = 9;
  opp.x = 3;
  opp.y = 7;
  s.ball = { x: 3, y: 8, carrier: null };
  // mover 1+1+0=2 vs opp 6+6+2=14 -> loss
  const dice = stubDice([1, 1, 6, 6]);
  doMove(s, dice, 3, 8);
  assert.equal(s.ball.carrier, null);
  assert.ok(!(s.ball.x === 3 && s.ball.y === 8), 'ball scattered off the tile');
  assertInvariants(s);
});

test('successful pass to a teammate transfers control', () => {
  const s = newMatch();
  const passer = carrier(s);
  const mate = s.players.find(
    (p) => p.team === 'home' && p.id !== passer.id && cheb(p.x, p.y, passer.x, passer.y) <= 8
  );
  const dice = stubDice([6, 5]); // 11 + pas always >= TN <= 8
  const res = doPass(s, dice, mate.x, mate.y);
  assert.ok(res.ok);
  assert.ok(res.roll.success);
  assert.equal(s.ball.carrier, mate.id);
});

test('failed pass scatters near the target', () => {
  const s = newMatch();
  const passer = carrier(s);
  const tx = passer.x;
  const ty = passer.y - 4; // empty-ish tile upfield
  const dice = stubDice([1, 2]); // 3 + pas: always fails vs 7
  const res = doPass(s, dice, tx, ty);
  assert.ok(res.ok);
  assert.ok(!res.roll.success);
  assert.equal(s.actionUsed, true);
  const d = cheb(s.ball.x, s.ball.y, tx, ty);
  assert.ok(d >= 0 && d <= 2, `scatter within 2 (got ${d})`);
  assertInvariants(s);
});

test('steal: success takes the ball, failure spends the action', () => {
  const s = newMatch();
  clearBoard(s);
  // Give the ball to away, put home-2 adjacent.
  const vic = getPlayer(s, 'away-7'); // ctl 0 -> TN 8
  const me = getPlayer(s, 'home-2'); // ctl +2
  vic.x = 3;
  vic.y = 8;
  me.x = 3;
  me.y = 9;
  s.ball = { x: 3, y: 8, carrier: vic.id };
  assert.equal(activePlayerId(s), me.id);
  assert.ok(canSteal(s));
  const win = stubDice([4, 4]); // 8+2=10 vs 8
  const res = doSteal(s, win);
  assert.ok(res.roll.success);
  assert.equal(s.ball.carrier, me.id);

  // reset for a failure
  s.ball.carrier = vic.id;
  s.ball.x = vic.x;
  s.ball.y = vic.y;
  s.actionUsed = false;
  const lose = stubDice([1, 2]); // 3+2=5 vs 8
  const res2 = doSteal(s, lose);
  assert.ok(!res2.roll.success);
  assert.equal(s.ball.carrier, vic.id);
  assert.equal(s.actionUsed, true);
});

test('shot past a wrong-way keeper is a goal and resets to kickoff', () => {
  const s = newMatch();
  const striker = getPlayer(s, 'home-7');
  // Teleport striker near the top goal with the ball.
  const occ = occupantAt(s, 3, 2);
  if (occ) {
    occ.x = 0;
    occ.y = 0;
  }
  striker.x = 3;
  striker.y = 2;
  s.ball = { x: 3, y: 2, carrier: striker.id };
  // dist 2 -> TN 8 center. Roll 4+5+3 = 12: accurate, not doubles.
  const dice = stubDice([4, 5]);
  const res = doShoot(s, dice, { col: 1, high: false }, { col: 0, high: false });
  assert.equal(res.outcome, 'goal');
  assert.equal(s.score.home, 1);
  assert.ok(s.ball.carrier?.startsWith('away-'), 'away kicks off after conceding');
  assert.equal(s.activeTeam, 'away');
  assertInvariants(s);
});

test('exact dive saves; keeper takes the ball', () => {
  const s = newMatch();
  const striker = getPlayer(s, 'home-7');
  const occ = occupantAt(s, 3, 2);
  if (occ) {
    occ.x = 0;
    occ.y = 0;
  }
  striker.x = 3;
  striker.y = 2;
  s.ball = { x: 3, y: 2, carrier: striker.id };
  const dice = stubDice([4, 5]);
  const res = doShoot(s, dice, { col: 1, high: false }, { col: 1, high: false });
  assert.equal(res.outcome, 'save');
  assert.equal(s.ball.carrier, 'away-1');
  assert.equal(s.score.home, 0);
});

test('accurate doubles is an unstoppable goal', () => {
  const s = newMatch();
  const striker = getPlayer(s, 'home-7');
  const occ = occupantAt(s, 3, 2);
  if (occ) {
    occ.x = 0;
    occ.y = 0;
  }
  striker.x = 3;
  striker.y = 2;
  s.ball = { x: 3, y: 2, carrier: striker.id };
  const dice = stubDice([5, 5]); // doubles, 10+3 vs 8
  const res = doShoot(s, dice, { col: 1, high: false }, { col: 1, high: false });
  assert.equal(res.outcome, 'goal');
});

test('formation switch is once per turn and drift approaches targets', () => {
  const s = newMatch();
  const dice = stubDice([3, 3]);
  assert.ok(setFormation(s, 'attack').ok);
  assert.ok(!setFormation(s, 'bus').ok);
  const targets = formationTargets(s, 'home');
  const distBefore = s.players
    .filter((p) => p.team === 'home')
    .map((p) => cheb(p.x, p.y, targets[p.id].x, targets[p.id].y));
  endTurn(s, dice);
  const distAfter = s.players
    .filter((p) => p.team === 'home')
    .map((p) => cheb(p.x, p.y, targets[p.id].x, targets[p.id].y));
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  assert.ok(sum(distAfter) <= sum(distBefore), 'team drifts toward new formation');
  assert.equal(s.activeTeam, 'away');
  assert.equal(s.turn, 2);
});

test('match ends at the turn limit', () => {
  const s = newMatch({ maxTurns: 3 });
  const dice = stubDice([3, 4]);
  endTurn(s, dice);
  endTurn(s, dice);
  endTurn(s, dice);
  assert.ok(s.over);
});

test('p2d6 sanity', () => {
  assert.equal(p2d6(0, 2), 1);
  assert.equal(p2d6(0, 13), 0);
  assert.ok(Math.abs(p2d6(0, 7) - 21 / 36) < 1e-9);
  assert.ok(p2d6(3, 9) > p2d6(0, 9));
});

// ---------------------------------------------------------------------------
// Integration: full AI-vs-AI matches across seeds must not crash and must
// keep every invariant every step of the way.

function playAiMatch(seed) {
  const dice = makeDice(seed);
  const s = newMatch({ mode: 'sim' });
  let guard = 0;
  let goals = 0;
  while (!s.over && guard++ < 1000) {
    const f = aiChooseFormation(s);
    if (f) setFormation(s, f);
    const mv = aiChooseMove(s, dice);
    if (mv) {
      const res = doMove(s, dice, mv.x, mv.y);
      assert.ok(res.ok, `AI move must be legal (${JSON.stringify(mv)})`);
    }
    assertInvariants(s);
    if (!s.over && !s.actionUsed) {
      const before = s.turn;
      const act = aiChooseAction(s, dice);
      if (act.type === 'steal') doSteal(s, dice);
      else if (act.type === 'pass') doPass(s, dice, act.x, act.y);
      else if (act.type === 'shoot') doShoot(s, dice, act.aim, aiPickDive(s, dice));
      if (s.turn === before && !s.over) endTurn(s, dice);
    } else if (!s.over) {
      endTurn(s, dice);
    }
    assertInvariants(s);
  }
  assert.ok(s.over, `match with seed ${seed} finished (guard=${guard})`);
  goals = s.score.home + s.score.away;
  return { goals, score: s.score, shots: s.events.filter((e) => e.type === 'shot').length };
}

test('AI vs AI: 20 seeded matches complete legally', () => {
  let totalGoals = 0;
  let totalShots = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const { goals, shots } = playAiMatch(seed);
    totalGoals += goals;
    totalShots += shots;
  }
  // Tuning sanity: matches should produce some shots and some goals overall.
  assert.ok(totalShots >= 20, `expected some shots across matches (got ${totalShots})`);
  assert.ok(totalGoals >= 5, `expected some goals across matches (got ${totalGoals})`);
  assert.ok(totalGoals <= 160, `goal totals sane (got ${totalGoals})`);
});
