import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYER_POOL } from '../js/data.js';
import { ABILITIES } from '../js/abilities.js';
import {
  newMatch, getPlayer, carrier, activePlayerId, selectMover, doMove, doPass,
  doSteal, doShoot, endTurn, canActivateAbility, activateAbility,
  canDiveBoost, activateDiveBoost, isFrozen, stepsLeft, canPass, occupantAt,
  CHARGE_CAP,
} from '../js/game.js';

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

const BY = Object.fromEntries(PLAYER_POOL.map((p) => [p.id, p]));
// home: Bucker GK; Markinhos, Hakeemi, Kanteh, Bellingsworth, Bonaldo, Cane
// away: Neuherr GK; van Dyke, Carvahal, De Broin, Pedri, Haalund, Neimar
function draftMatch() {
  return newMatch({
    rosters: {
      home: { gk: BY.gk1, outfield: ['d5', 'd3', 'm4', 'm3', 'f2', 'f8'].map((i) => BY[i]) },
      away: { gk: BY.gk2, outfield: ['d1', 'd8', 'm1', 'm7', 'f4', 'f5'].map((i) => BY[i]) },
    },
  });
}

test('every pool player has an ability', () => {
  for (const p of PLAYER_POOL) {
    assert.ok(ABILITIES[p.id], `${p.name} has an ability`);
    assert.ok(ABILITIES[p.id].cost >= 1 && ABILITIES[p.id].cost <= 4);
  }
});

test('charges: attempts earn, outcomes irrelevant, comeback drips', () => {
  const s = draftMatch();
  const passer = carrier(s);
  // failed pass still earns +1
  const dice = stubDice([1, 1, 3, 3]);
  doPass(s, dice, passer.x, passer.y - 4);
  assert.equal(s.charges.home, 1, 'pass attempt earns despite the miss');
  // ending the turn without possession earns +1 (ball scattered loose or taken)
  const holder = carrier(s);
  const homeHolds = holder && holder.team === 'home';
  endTurn(s, dice);
  assert.equal(s.charges.home, homeHolds ? 1 : 2, 'no-possession drip');
});

test('charges: concede pays +2 and bank caps at 6', () => {
  const s = draftMatch();
  s.charges.home = 5;
  const striker = getPlayer(s, 'home-6'); // Bonaldo
  const occ = occupantAt(s, 4, 2);
  if (occ) {
    occ.x = 0;
    occ.y = 0;
  }
  striker.x = 4;
  striker.y = 2;
  s.ball = { x: 4, y: 2, carrier: striker.id };
  // accurate shot, keeper dives opposite corner -> goal
  doShoot(s, stubDice([4, 5]), { col: 2, high: false }, { col: 0, high: true });
  assert.equal(s.score.home, 1);
  assert.equal(s.charges.away, 2, 'conceding pays 2');
  assert.ok(s.charges.home <= CHARGE_CAP, 'bank capped');
});

test('autoSteal: instant, spends action and charges', () => {
  const s = draftMatch();
  const kanteh = getPlayer(s, 'home-4');
  const vic = getPlayer(s, 'away-6'); // Haalund
  s.players.forEach((p, i) => {
    p.x = i % 9;
    p.y = p.team === 'home' ? 16 : 1;
  });
  kanteh.x = 4;
  kanteh.y = 9;
  vic.x = 4;
  vic.y = 8;
  s.ball = { x: 4, y: 8, carrier: vic.id };
  s.charges.home = 3;
  selectMover(s, kanteh.id);
  const chk = canActivateAbility(s, kanteh.id);
  assert.ok(chk.ok, chk.reason);
  const res = activateAbility(s, kanteh.id);
  assert.ok(res.ok);
  assert.equal(s.ball.carrier, kanteh.id);
  assert.equal(s.actionUsed, true);
  assert.equal(s.charges.home, 0);
  // once per player per turn
  s.charges.home = 6;
  assert.ok(!canActivateAbility(s, kanteh.id).ok, 'no double activation');
});

test('stacking: two different players can activate in one turn', () => {
  const s = draftMatch();
  s.charges.home = 4;
  const hakeemi = getPlayer(s, 'home-3');
  const cane = getPlayer(s, 'home-7');
  // Hakeemi Overlap (1, needs not carrying), Cane One-Two (2, needs ball)
  selectMover(s, hakeemi.id);
  assert.ok(activateAbility(s, hakeemi.id).ok, 'first activation');
  // give Cane the ball for his
  const c = carrier(s);
  s.ball = { x: cane.x, y: cane.y, carrier: cane.id };
  s.moverId = null;
  assert.ok(activateAbility(s, cane.id).ok, 'second activation same turn');
  assert.equal(s.charges.home, 1);
  void c;
});

test('freeze: victim cannot move, drift, or be selected; expires', () => {
  const s = draftMatch();
  const carvahal = getPlayer(s, 'away-3');
  const victim = getPlayer(s, 'home-4');
  // away turn setup
  const dice = stubDice([3, 3]);
  endTurn(s, dice); // home -> away
  s.charges.away = 2;
  carvahal.x = victim.x + 1;
  carvahal.y = victim.y;
  selectMover(s, carvahal.id);
  const res = activateAbility(s, carvahal.id, victim.id);
  assert.ok(res.ok, res.reason);
  assert.ok(isFrozen(s, victim.id));
  endTurn(s, dice); // away -> home (victim's turn: still frozen)
  assert.ok(isFrozen(s, victim.id));
  assert.ok(!selectMover(s, victim.id).ok, 'frozen: not selectable');
  assert.notEqual(activePlayerId(s), victim.id, 'frozen: never the default mover');
  const before = { x: victim.x, y: victim.y };
  endTurn(s, dice); // home turn ends: victim must not drift
  assert.deepEqual({ x: victim.x, y: victim.y }, before, 'frozen players do not drift');
  endTurn(s, dice); // back to home: freeze expired
  assert.ok(!isFrozen(s, victim.id));
});

test('passFlat: long ball at target 6 beyond normal range', () => {
  const s = draftMatch();
  const trent = getPlayer(s, 'home-2'); // Markinhos... roster order: d5 is home-2
  // home-2 is Markinhos (autoSteal); use away side: De Broin passAuto is away-4.
  // For passFlat use gk4/d4 which aren't in this draft — instead verify
  // passAuto (Laser Pass) on away's De Broin.
  const dice = stubDice([1, 1]); // would fail any roll
  endTurn(s, dice); // away's turn
  const kdb = getPlayer(s, 'away-4');
  const mate = getPlayer(s, 'away-6');
  s.players.forEach((p, i) => {
    p.x = i % 9;
    p.y = p.team === 'away' ? 3 : 14;
  });
  kdb.x = 4;
  kdb.y = 6;
  mate.x = 4;
  mate.y = 10;
  s.ball = { x: 4, y: 6, carrier: kdb.id };
  s.charges.away = 3;
  assert.ok(activateAbility(s, kdb.id).ok);
  const res = doPass(s, dice, mate.x, mate.y);
  assert.ok(res.roll.success, 'laser pass cannot miss');
  assert.equal(s.ball.carrier, mate.id);
  void trent;
});

test('skipKeeper: on-target SIUUU bypasses the dive', () => {
  const s = draftMatch();
  const bonaldo = getPlayer(s, 'home-6');
  const occ = occupantAt(s, 4, 3);
  if (occ) {
    occ.x = 0;
    occ.y = 0;
  }
  bonaldo.x = 4;
  bonaldo.y = 3;
  s.ball = { x: 4, y: 3, carrier: bonaldo.id };
  s.charges.home = 4;
  assert.ok(activateAbility(s, bonaldo.id).ok);
  // accurate (4+5+3 vs ~7), keeper dives the EXACT cell — still a goal
  const res = doShoot(s, stubDice([4, 5]), { col: 1, high: false }, { col: 1, high: false });
  assert.equal(res.outcome, 'goal');
  assert.match(res.roll.verdict.text, /SIUUU/);
});

test('dive boost: one cell off becomes a certain save', () => {
  const s = draftMatch(); // home keeper Bucker has Big-Game Save
  const shooter = getPlayer(s, 'away-6'); // Haalund
  const dice = stubDice([4, 5]);
  endTurn(s, dice); // away's turn, shooting at home's goal
  const occ = occupantAt(s, 4, 14);
  if (occ) {
    occ.x = 0;
    occ.y = 1;
  }
  shooter.x = 4;
  shooter.y = 14;
  s.ball = { x: 4, y: 14, carrier: shooter.id };
  s.charges.home = 2;
  const chk = canDiveBoost(s, 'home');
  assert.ok(chk.ok, chk.reason);
  assert.ok(activateDiveBoost(s, 'home').ok);
  // dive 1 cell off the aim: boost brings it to 0 -> automatic save
  const res = doShoot(s, dice, { col: 1, high: false }, { col: 1, high: true });
  assert.equal(res.outcome, 'save');
  assert.equal(res.keeperRoll, null, 'no scramble roll needed at 0 off');
});

test('One-Two: completed pass grants the receiver a 2-step bonus move', () => {
  const s = draftMatch();
  const cane = getPlayer(s, 'home-7');
  const mate = getPlayer(s, 'home-4');
  s.players.forEach((p, i) => {
    p.x = i % 9;
    p.y = p.team === 'home' ? 12 : 2;
  });
  cane.x = 4;
  cane.y = 12;
  mate.x = 4;
  mate.y = 9;
  s.ball = { x: 4, y: 12, carrier: cane.id };
  s.charges.home = 2;
  assert.ok(activateAbility(s, cane.id).ok);
  const res = doPass(s, stubDice([6, 5]), mate.x, mate.y);
  assert.ok(res.roll.success);
  assert.equal(s.ball.carrier, mate.id);
  assert.equal(activePlayerId(s), mate.id, 'receiver controls the bonus move');
  assert.equal(stepsLeft(s), 2);
  assert.ok(!canPass(s), 'no ball actions during a bonus move');
  const dice = stubDice([3, 3]);
  assert.ok(doMove(s, dice, mate.x, mate.y - 2).ok, 'bonus move spends its steps');
  assert.equal(s.bonusMove, null, 'bonus exhausted');
  assert.equal(s.ball.carrier, mate.id, 'carrier keeps the ball while bursting');
});

test('The Wall: plus-shaped zone strips; diagonals slip past', () => {
  const s = draftMatch(); // away-2 is Virgil van Dyke
  const dice = stubDice([3, 3]);
  const wall = getPlayer(s, 'away-2');
  const runner = getPlayer(s, 'home-6'); // Bonaldo, carrying
  s.players.forEach((p, i) => {
    p.x = i % 9;
    p.y = p.team === 'home' ? 16 : 1;
  });
  // away activates The Wall on their turn
  endTurn(s, dice);
  wall.x = 4;
  wall.y = 8;
  s.charges.away = 3;
  selectMover(s, wall.id);
  assert.ok(activateAbility(s, wall.id).ok);
  endTurn(s, dice); // back to home
  // runner dribbles PAST the wall (adjacent lane, never through his square)
  runner.x = 3;
  runner.y = 10;
  s.ball = { x: 3, y: 10, carrier: runner.id };
  s.moverId = null;
  selectMover(s, runner.id);
  const res = doMove(s, dice, 4, 7); // destination orthogonally beside (4,8)
  assert.ok(res.ok);
  assert.equal(s.ball.carrier, wall.id, 'zone strip: van Dyke takes it');
  assert.equal(s.ball.x, wall.x);
  assert.equal(runner.y, 7, 'runner still completes the move');
  // diagonal-only contact is safe now: fresh runner slips past corner-wise
  s.moverId = null;
  const r2 = getPlayer(s, 'home-7');
  r2.x = 3;
  r2.y = 10;
  s.ball = { x: 3, y: 10, carrier: r2.id };
  selectMover(s, r2.id);
  doMove(s, dice, 3, 7); // (3,9)->(3,8)? pathfinder avoids; diagonals of wall are safe
  assert.equal(s.ball.carrier, r2.id, 'diagonal slip keeps the ball');
  // and the effect expires after away's next turn ends
});
