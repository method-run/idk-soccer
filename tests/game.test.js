import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDice } from '../js/dice.js';
import { W, H } from '../js/data.js';
import {
  newMatch, activePlayerId, getPlayer, carrier, reachable, moveRange, isOOBSquare,
  doMove, doPass, doSteal, doShoot, canSteal, canShoot, setFormation,
  endTurn, formationTargets, cheb, occupantAt, passTN, shotTN, stealTN,
  selectMover, driftPreview, stepsLeft,
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
    const takerOOB =
      state.restartDuty?.playerId === p.id && isOOBSquare(p.x, p.y);
    assert.ok(
      takerOOB || (p.x >= 0 && p.x < W && p.y >= 0 && p.y < H),
      `${p.id} in bounds`
    );
    const key = `${p.x},${p.y}`;
    assert.ok(!seen.has(key), `no stacking at ${key}`);
    seen.add(key);
  }
  assert.ok(
    (state.ball.x >= 0 && state.ball.x < W && state.ball.y >= 0 && state.ball.y < H) ||
      isOOBSquare(state.ball.x, state.ball.y),
    'ball on pitch or on the ring'
  );
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

test('carrying the ball reduces movement range by 1', () => {
  const s = newMatch();
  const c = carrier(s);
  assert.equal(moveRange(s, c), Math.max(1, c.spd - 1));
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
  // corner aim TN 9. Roll 4+5+3 = 12: accurate, not doubles. Keeper dives
  // the opposite corner: 3 cells off -> no chance.
  const dice = stubDice([4, 5]);
  const res = doShoot(s, dice, { col: 2, high: false }, { col: 0, high: true });
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

test('formations toggle freely; drift approaches the final card', () => {
  const s = newMatch();
  const dice = stubDice([3, 3]);
  assert.ok(setFormation(s, 'bus').ok, 'first switch');
  assert.ok(setFormation(s, 'attack').ok, 'can switch again in the same turn');
  assert.ok(!setFormation(s, 'attack').ok, 'same card is a no-op');
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
  assert.ok(totalGoals <= 220, `goal totals sane (got ${totalGoals})`);
});

test('selectMover: free until committed, locked after moving', () => {
  const s = newMatch();
  const dice = stubDice([3, 3]);
  const kicker = carrier(s);
  const other = s.players.find((p) => p.team === 'home' && p.id !== kicker.id && p.role === 'DF');
  assert.ok(selectMover(s, other.id).ok);
  assert.equal(activePlayerId(s), other.id);
  assert.ok(!selectMover(s, 'away-2').ok, 'cannot select an opponent');
  // move the selected player, then selection is locked
  const tiles = [...reachable(s, other.id).keys()].filter(
    (k) => k !== `${other.x},${other.y}`
  );
  const [x, y] = tiles[0].split(',').map(Number);
  assert.ok(doMove(s, dice, x, y).ok);
  assert.ok(!selectMover(s, kicker.id).ok, 'locked after moving');
  assert.equal(activePlayerId(s), other.id);
  // reset on end of turn
  endTurn(s, dice);
  assert.equal(s.moverId, null);
});

test('driftPreview matches what drift applies', () => {
  const s = newMatch();
  const dice = stubDice([3, 3]);
  setFormation(s, 'attack');
  const preview = driftPreview(s);
  assert.ok(preview.length > 0, 'somebody should want to move');
  endTurn(s, dice); // applies drift
  for (const step of preview) {
    const p = getPlayer(s, step.id);
    assert.deepEqual([p.x, p.y], step.to, `${step.id} followed the preview`);
  }
});

test('dice state snapshot: same action after restore rolls the same', () => {
  const dice = makeDice(42);
  const snap = dice.getState();
  const first = [dice.d6(), dice.d6(), dice.d6()];
  dice.setState(snap);
  const second = [dice.d6(), dice.d6(), dice.d6()];
  assert.deepEqual(first, second);
});

test('rolls carry cinematic metadata (title, target math, modifier)', () => {
  const s = newMatch();
  const passer = carrier(s);
  const dice = stubDice([6, 5]);
  doPass(s, dice, passer.x, passer.y - 4);
  const e = s.events.findLast((ev) => ev.type === 'pass');
  assert.equal(e.roll.title, 'Pass');
  assert.match(e.roll.tnLabel, /6 base/);
  assert.match(e.roll.modLabel, /PAS \+\d/);
});

test('outnumbering: support modifier swings a contested pickup', () => {
  const s = newMatch();
  clearBoard(s);
  const me = getPlayer(s, 'home-6'); // ctl +1 (lower number: forced mover)
  const mate = getPlayer(s, 'home-7'); // adjacent supporter
  const opp = getPlayer(s, 'away-7'); // ctl +0
  me.x = 3;
  me.y = 9;
  mate.x = 2;
  mate.y = 8; // adjacent to the ball tile -> +1 support
  opp.x = 3;
  opp.y = 7;
  s.ball = { x: 3, y: 8, carrier: null };
  // mover 1+2 (+1 ctl, +1 support) = 5 vs opp 2+3 (+0) = 5 -> tie -> mover.
  // Without support this is a 4 vs 5 loss.
  const dice = stubDice([1, 2, 2, 3]);
  assert.equal(activePlayerId(s), me.id);
  doMove(s, dice, 3, 8);
  assert.equal(s.ball.carrier, me.id, '2-on-1 wins the tie');
  const e = s.events.findLast((ev) => ev.type === 'contest');
  assert.match(e.roll.modLabel, /support/);
});

test('outnumbering: support modifier applies to steals', () => {
  const s = newMatch();
  clearBoard(s);
  const vic = getPlayer(s, 'away-7'); // ctl 0 -> TN 8
  const me = getPlayer(s, 'home-2'); // ctl +2
  const mate = getPlayer(s, 'home-3'); // supporter next to the carrier
  vic.x = 3;
  vic.y = 8;
  me.x = 3;
  me.y = 9;
  mate.x = 4;
  mate.y = 9;
  s.ball = { x: 3, y: 8, carrier: vic.id };
  const dice = stubDice([3, 3]);
  const res = doSteal(s, dice);
  assert.equal(res.roll.mod, 3, 'CTL +2 plus +1 support');
  assert.ok(res.roll.success, '6+3=9 vs 8');
});

test('movement is a step budget spent in multiple segments', () => {
  const s = newMatch();
  clearBoard(s);
  const dice = stubDice([3, 3]);
  const me = getPlayer(s, 'home-2'); // spd 4
  me.x = 4;
  me.y = 9;
  s.ball = { x: 8, y: 4, carrier: null }; // keep it away from everyone
  assert.equal(activePlayerId(s), me.id);
  assert.ok(doMove(s, dice, 4, 7).ok, 'first segment of 2');
  assert.equal(stepsLeft(s), 2);
  assert.ok(!doMove(s, dice, 4, 4).ok, '3 more steps is over budget');
  assert.ok(doMove(s, dice, 4, 5).ok, 'second segment of 2');
  assert.equal(stepsLeft(s), 0);
  assert.ok(!doMove(s, dice, 4, 4).ok, 'budget exhausted');
});

test('you can keep moving after your action', () => {
  const s = newMatch();
  const passer = carrier(s);
  const dice = stubDice([6, 5]);
  assert.ok(doPass(s, dice, passer.x, passer.y - 3).ok);
  assert.equal(s.actionUsed, true);
  assert.ok(stepsLeft(s) > 0, 'steps remain after passing');
  const spot = [...reachable(s, passer.id).entries()].find(([, d]) => d > 0);
  assert.ok(spot, 'somewhere to run');
  const [mx, my] = spot[0].split(',').map(Number);
  assert.ok(doMove(s, dice, mx, my).ok, 'post-action move works');
});

// Dribble-challenge scenarios: dribbler must cross a wall of defenders.
function dribbleSetup() {
  const s = newMatch();
  clearBoard(s);
  const me = getPlayer(s, 'home-6'); // ctl +1, spd 6 (5 while carrying)
  me.x = 4;
  me.y = 10;
  for (const [id, x] of [['away-2', 3], ['away-3', 4], ['away-4', 5]]) {
    const d = getPlayer(s, id);
    d.x = x;
    d.y = 9;
  }
  s.ball = { x: 4, y: 10, carrier: me.id };
  return { s, me };
}

test('dribble challenge: winning (or tying) carries you through', () => {
  const { s, me } = dribbleSetup();
  // straightest path crosses the MIDDLE defender (away-3, ctl +2), flanked
  // by both teammates: support -2. mine 5+4+1-2=8 vs 3+3+2=8 -> tie -> through
  const dice = stubDice([5, 4, 3, 3]);
  assert.ok(doMove(s, dice, 4, 8).ok);
  assert.equal(s.ball.carrier, me.id, 'kept the ball');
  assert.equal(s.ball.x, 4);
  assert.equal(s.ball.y, 8);
  const e = s.events.findLast((ev) => ev.type === 'dribble');
  assert.ok(e, 'challenge was rolled');
  assert.match(e.roll.modLabel, /support/);
});

test('dribble challenge: losing big is a clean steal at the defender', () => {
  const { s, me } = dribbleSetup();
  // mine 1+1+1-1=2 vs 3+3+2=8 -> deficit 6 -> stolen
  const dice = stubDice([1, 1, 3, 3]);
  assert.ok(doMove(s, dice, 4, 8).ok);
  assert.equal(me.x, 4, 'runner still completes the move');
  assert.equal(me.y, 8);
  const thief = getPlayer(s, s.ball.carrier);
  assert.equal(thief.team, 'away');
  assert.equal(s.ball.x, thief.x, 'ball stays where the defender stands');
  assert.equal(s.ball.y, thief.y);
});

test('dribble challenge: losing narrowly knocks the ball loose', () => {
  const { s, me } = dribbleSetup();
  // mine 3+3+1-1=6 vs 3+2+2=7 -> deficit 1 -> loose ball
  const dice = stubDice([3, 3, 3, 2]);
  assert.ok(doMove(s, dice, 4, 8).ok);
  assert.equal(s.ball.carrier, null, 'nobody holds it');
  assert.equal(me.y, 8, 'runner completes the move');
  assertInvariants(s);
});

test('newMatch accepts drafted rosters and maps outfield order to slots', async () => {
  const { PLAYER_POOL } = await import('../js/data.js');
  const gk = PLAYER_POOL.find((p) => p.role === 'GK');
  const out = PLAYER_POOL.filter((p) => p.role !== 'GK').slice(0, 6);
  const gk2 = PLAYER_POOL.filter((p) => p.role === 'GK')[1];
  const out2 = PLAYER_POOL.filter((p) => p.role !== 'GK').slice(6, 12);
  const s = newMatch({
    rosters: {
      home: { gk, outfield: out },
      away: { gk: gk2, outfield: out2 },
    },
  });
  assert.equal(s.players.length, 14);
  assert.equal(getPlayer(s, 'home-1').name, gk.name);
  assert.equal(getPlayer(s, 'home-1').role, 'GK');
  assert.equal(getPlayer(s, 'home-2').name, out[0].name);
  assert.equal(getPlayer(s, 'away-7').name, out2[5].name);
  // formation targets exist for every drafted player
  const targets = formationTargets(s, 'home');
  assert.equal(Object.keys(targets).length, 7);
});

test('shot rolls carry outcome verdicts (GOAL!/SAVED, not SUCCESS/FAIL)', () => {
  const s = newMatch();
  const striker = getPlayer(s, 'home-7');
  const occ = occupantAt(s, 3, 2);
  if (occ) { occ.x = 0; occ.y = 0; }
  striker.x = 3;
  striker.y = 2;
  s.ball = { x: 3, y: 2, carrier: striker.id };
  const dice = stubDice([4, 5]);
  // opposite-corner dive: 3 cells off -> goal, no keeper roll
  const res = doShoot(s, dice, { col: 2, high: false }, { col: 0, high: true });
  assert.match(res.roll.verdict.text, /GOAL/);

  // exact-dive save
  const s2 = newMatch();
  const st2 = getPlayer(s2, 'home-7');
  const occ2 = occupantAt(s2, 3, 2);
  if (occ2) { occ2.x = 0; occ2.y = 0; }
  st2.x = 3;
  st2.y = 2;
  s2.ball = { x: 3, y: 2, carrier: st2.id };
  const res2 = doShoot(s2, stubDice([4, 5]), { col: 1, high: false }, { col: 1, high: false });
  assert.match(res2.roll.verdict.text, /SAVED/);
});

test('graded saves: keeper roll target scales with dive distance', () => {
  const setup = () => {
    const s = newMatch();
    const st = getPlayer(s, 'home-7');
    const occ = occupantAt(s, 3, 2);
    if (occ) { occ.x = 0; occ.y = 0; }
    st.x = 3;
    st.y = 2;
    s.ball = { x: 3, y: 2, carrier: st.id };
    return s;
  };
  // 1 cell off: TN 11. Away keeper CTL +3, roll 4+5+3=12 -> SAVED.
  const s1 = setup();
  const r1 = doShoot(s1, stubDice([4, 5]), { col: 1, high: false }, { col: 1, high: true });
  assert.equal(r1.keeperRoll.tn, 11);
  assert.equal(r1.outcome, 'save');

  // 2 cells off: TN 14. Roll 2+3+3=8 -> GOAL. (shot 6+5+3=14 accurate)
  const s2 = setup();
  const r2 = doShoot(s2, stubDice([6, 5, 2, 3]), { col: 2, high: false }, { col: 1, high: true });
  assert.equal(r2.keeperRoll.tn, 14);
  assert.equal(r2.outcome, 'goal');
});

test('keeper position matters: off the line penalizes, stranded concedes', async () => {
  const { keeperDistance, KEEPER_STRANDED } = await import('../js/game.js');
  const setup = () => {
    const s = newMatch();
    const st = getPlayer(s, 'home-7');
    const occ = occupantAt(s, 3, 2);
    if (occ) { occ.x = 0; occ.y = 0; }
    st.x = 3;
    st.y = 2;
    s.ball = { x: 3, y: 2, carrier: st.id };
    return s;
  };

  // keeper 2 off the line: exact-cell dive is no longer automatic (TN 12)
  const s1 = setup();
  const gk1 = getPlayer(s1, 'away-1');
  gk1.x = 4;
  gk1.y = 2; // 2 from the mouth row
  assert.equal(keeperDistance(s1, 'home'), 2);
  const r1 = doShoot(s1, stubDice([4, 5, 6, 6, 1, 1]), { col: 1, high: false }, { col: 1, high: false });
  assert.ok(r1.keeperRoll, 'exact dive off the line still needs a roll');
  assert.equal(r1.keeperRoll.tn, 12);

  // keeper 3+ away: stranded — accurate shot scores with no dive at all
  const s2 = setup();
  const gk2 = getPlayer(s2, 'away-1');
  gk2.x = 4;
  gk2.y = 6;
  assert.ok(keeperDistance(s2, 'home') >= KEEPER_STRANDED);
  const r2 = doShoot(s2, stubDice([4, 5]), { col: 1, high: false }, null);
  assert.equal(r2.outcome, 'goal');
  assert.equal(r2.keeperRoll, null);
  assert.match(r2.roll.verdict.text, /stranded|Stranded/i);
});

test('kickoff: every player starts in their own half', () => {
  const s = newMatch();
  const mid = Math.floor(H / 2);
  for (const p of s.players) {
    if (p.team === 'home') assert.ok(p.y >= mid, `${p.id} in home half (y=${p.y})`);
    else assert.ok(p.y < mid, `${p.id} in away half (y=${p.y})`);
  }
});

test('deliberate pass out of bounds -> throw-in to the opponent', () => {
  const s = newMatch();
  clearBoard(s);
  const me = getPlayer(s, 'home-4');
  me.x = 1;
  me.y = 9;
  s.ball = { x: 1, y: 9, carrier: me.id };
  s.moverId = me.id;
  const res = doPass(s, stubDice([6, 5]), -1, 9); // over the near touchline
  assert.ok(res.ok);
  assert.deepEqual([s.ball.x, s.ball.y], [-1, 9], 'ball rests on the ring');
  assert.equal(s.restart.type, 'throw');
  assert.equal(s.restart.team, 'away', 'restart to the opponent');
  // opponent's turn: taker stands on the ring with the ball, cannot move
  const dice = stubDice([3, 3]);
  endTurn(s, dice);
  const taker = getPlayer(s, s.ball.carrier);
  assert.equal(taker.team, 'away');
  assert.deepEqual([taker.x, taker.y], [-1, 9], 'taker stands out of bounds');
  assert.equal(stepsLeft(s), 0, 'no running before the throw');
  assert.ok(!canShoot(s), 'no shooting from a throw-in');
  // takes the throw; steps back onto the pitch
  const mate = s.players.find((p) => p.team === 'away' && p.id !== taker.id && p.role !== 'GK');
  mate.x = 3;
  mate.y = 9;
  const r2 = doPass(s, stubDice([6, 5]), 3, 9);
  assert.ok(r2.ok);
  assert.equal(s.ball.carrier, mate.id);
  assert.ok(taker.x >= 0 && taker.x < W, 'taker stepped back in');
  assert.equal(s.restartDuty, null);
});

test('defensive clearance over own end line -> corner, taker may shoot', () => {
  const s = newMatch();
  clearBoard(s);
  const def = getPlayer(s, 'away-3'); // away defends y=0
  def.x = 1;
  def.y = 1;
  s.ball = { x: 1, y: 1, carrier: def.id };
  const dice = stubDice([6, 5]);
  endTurn(s, dice); // away's turn
  s.moverId = def.id;
  const res = doPass(s, stubDice([6, 5]), 1, -1); // hoofs it over his own line
  assert.ok(res.ok, res.reason);
  assert.equal(s.restart.type, 'corner');
  assert.equal(s.restart.team, 'home', 'corner to the attackers');
  assert.equal(s.restart.x, -1, 'ball placed in the corner arc');
  endTurn(s, stubDice([3, 3])); // home's turn: corner taker placed
  const taker = getPlayer(s, s.ball.carrier);
  assert.equal(taker.team, 'home');
  assert.ok(canShoot(s), 'corners may be shot directly');
});

test('wide shot -> goal kick: keeper restarts with the ball', () => {
  const s = newMatch();
  const striker = getPlayer(s, 'home-7');
  const occ = occupantAt(s, 4, 2);
  if (occ) { occ.x = 0; occ.y = 0; }
  striker.x = 4;
  striker.y = 2;
  s.ball = { x: 4, y: 2, carrier: striker.id };
  const res = doShoot(s, stubDice([1, 1, 3, 3]), { col: 0, high: false }, { col: 1, high: false });
  assert.equal(res.outcome, 'wide');
  // doShoot auto-ends the turn; the defending keeper restarts immediately
  assert.equal(s.ball.carrier, 'away-1', 'goal kick in the keeper\'s hands');
});

test('offside: deep moves excluded, one-past is a 90% flag', () => {
  const s = newMatch();
  clearBoard(s);
  // away's deepest outfielder holds the line at y=4
  s.players.filter((p) => p.team === 'away' && p.role !== 'GK')
    .forEach((p, i) => { p.x = i; p.y = 4 + i; });
  const runner = getPlayer(s, 'home-6'); // spd 6, not carrying
  runner.x = 4;
  runner.y = 6;
  s.ball = { x: 8, y: 9, carrier: null };
  s.moverId = runner.id;
  const tiles = reachable(s, runner.id);
  assert.ok(!tiles.has('4,2'), 'two past the line is never offered');
  assert.ok(tiles.has('4,3'), 'one past the line is offered (risky)');
  // flagged: roll under 11 -> turnover, whistle
  const res = doMove(s, stubDice([4, 4]), 4, 3);
  assert.ok(res.offside, 'flag went up');
  const holder = getPlayer(s, s.ball.carrier);
  assert.equal(holder.team, 'away', 'possession to the defense');
  assert.equal(s.activeTeam, 'away', 'whistle ended the turn');
});

test('offside: carrier is exempt and 11+ escapes the flag', () => {
  const s = newMatch();
  clearBoard(s);
  s.players.filter((p) => p.team === 'away' && p.role !== 'GK')
    .forEach((p, i) => { p.x = i; p.y = 4 + i; });
  // carrier dribbles past the line freely
  const runner = getPlayer(s, 'home-6');
  runner.x = 4;
  runner.y = 5;
  s.ball = { x: 4, y: 5, carrier: runner.id };
  s.moverId = runner.id;
  const rc = doMove(s, stubDice([1, 1]), 4, 2);
  assert.ok(rc.ok && !rc.offside, 'breakaway: no offside with the ball');
  assert.equal(s.ball.carrier, runner.id);
  // non-carrier escaping on 11+
  const s2 = newMatch();
  clearBoard(s2);
  s2.players.filter((p) => p.team === 'away' && p.role !== 'GK')
    .forEach((p, i) => { p.x = i; p.y = 4 + i; });
  const r2 = getPlayer(s2, 'home-6');
  r2.x = 4;
  r2.y = 6;
  s2.ball = { x: 8, y: 9, carrier: null };
  s2.moverId = r2.id;
  const res2 = doMove(s2, stubDice([6, 6]), 4, 3); // 12 >= 11: plays on
  assert.ok(res2.ok && !res2.offside, 'level enough — play continues');
  assert.equal(s2.activeTeam, 'home');
});

test('corner: teams shape up, taker kicks then steps in and can run', async () => {
  const { stepsLeft: sl } = await import('../js/game.js');
  const s = newMatch();
  clearBoard(s);
  const def = getPlayer(s, 'away-3');
  def.x = 1;
  def.y = 1;
  s.ball = { x: 1, y: 1, carrier: def.id };
  const dice = stubDice([6, 5]);
  endTurn(s, dice); // away's turn
  s.moverId = def.id;
  doPass(s, stubDice([6, 5]), 1, -1); // clearance over own line -> corner
  const before = s.players.map((p) => `${p.id}:${p.x},${p.y}`).join(' ');
  endTurn(s, stubDice([3, 3])); // home's corner: set-piece drift + placement
  const after = s.players.map((p) => `${p.id}:${p.x},${p.y}`).join(' ');
  assert.notEqual(before, after, 'set-piece shape-up moved players');
  const taker = getPlayer(s, s.ball.carrier);
  assert.deepEqual([taker.x, taker.y], [-1, -1], 'taker at the corner flag');
  assert.equal(sl(s), 0, 'no running before the kick');
  // super-low direct-shot odds from the flag: distance + tight angle
  const tn = (await import('../js/game.js')).shotTNFor(s, taker, { col: 1, high: false });
  assert.ok(tn >= 13, `corner strike target is brutal (got ${tn})`);
  // kick it in, step onto the pitch, run
  const mate = s.players.find((p) => p.team === taker.team && p.id !== taker.id && p.role !== 'GK');
  mate.x = 3;
  mate.y = 2;
  assert.ok(doPass(s, stubDice([6, 5]), 3, 2).ok);
  assert.ok(taker.x >= 0 && taker.y >= 0, 'taker stepped in at the corner');
  assert.ok(sl(s) > 0, 'free to make a run after the kick');
});

test('offside whistle triggers a shape reset for both teams', () => {
  const s = newMatch();
  clearBoard(s);
  s.players.filter((p) => p.team === 'away' && p.role !== 'GK')
    .forEach((p, i) => { p.x = i; p.y = 4 + i; });
  const runner = getPlayer(s, 'home-6');
  runner.x = 4;
  runner.y = 6;
  s.ball = { x: 8, y: 9, carrier: null };
  s.moverId = runner.id;
  const before = s.players.map((p) => `${p.id}:${p.x},${p.y}`).join(' ');
  const res = doMove(s, stubDice([4, 4]), 4, 3); // flagged
  assert.ok(res.offside);
  const after = s.players.map((p) => `${p.id}:${p.x},${p.y}`).join(' ');
  assert.notEqual(before, after, 'whistle reset positions');
});
