// Charge-powered player abilities. Data-driven: each pool star maps to one
// ability built from a small set of effect kinds the engine understands.
// Costs follow the rubric: 1 utility / 2 edge / 3 auto-success / 4 signature.
//
// kinds:
//  steps        +n steps for this player this turn (cond: varies)
//  autoSteal    instant steal from adjacent carrier (consumes the action)
//  passAuto     next pass auto-succeeds (once)
//  passFlat     next pass at TN 6, unlimited range (once)
//  shotNoDist   next shot: distance penalty halved, rounded down (once)
//  shotAuto     next shot auto-passes accuracy, keeper still dives (once)
//  skipKeeper   next on-target shot bypasses the keeper (once)
//  dribbleAuto  this turn his dribble challenges auto-win
//  wall         until your next turn, dribbling through him = he steals it
//  stealGuard   until your next turn, steals against him auto-fail
//  ctlAura      +n CTL to teammates within radius, until your next turn
//  ctlSelf      +n CTL to him, until your next turn
//  freeze       freeze an adjacent opponent for their next turn (target)
//  drama        freeze + your team immediately drifts 2 (target)
//  drift2       this turn's end-of-turn drift moves 2 squares
//  metronome    until your next turn, pass attempts earn 2 charges
//  shoMove      +2 SHO on this turn's shot if he moved 2+ first
//  oneTwo       after his completed pass, receiver gets 2 bonus steps (once)
//  arrive       (cond: your team completed a pass this turn) he immediately
//               gets a bonus move of up to SPD
//  diveCover    reaction while diving: count the dive 1 cell closer
//  keeperLine   +2 steps now; no off-line save penalty until your next turn

export const ABILITIES = {
  gk1: { name: 'Big-Game Save', cost: 2, kind: 'diveCover',
    blurb: 'When diving: count your dive 1 cell closer to the shot.' },
  gk2: { name: 'Sweeper-Keeper', cost: 1, kind: 'keeperLine',
    blurb: '+2 steps now; no off-line save penalty until your next turn.' },
  gk3: { name: 'Giant Frame', cost: 2, kind: 'diveCover',
    blurb: 'When diving: your frame covers 1 cell further.' },
  gk4: { name: 'Launch It', cost: 1, kind: 'passFlat',
    blurb: 'One pass at target 6, any distance.' },
  d1: { name: 'The Wall', cost: 3, kind: 'wall',
    blurb: 'Until your next turn, carriers moving onto or orthogonally beside him lose the ball to him.' },
  d2: { name: 'Organizer', cost: 2, kind: 'ctlAura', n: 1, radius: 2,
    blurb: '+1 CTL to teammates within 2 squares until your next turn.' },
  d3: { name: 'Overlap', cost: 1, kind: 'steps', n: 3, needs: 'notCarrying',
    blurb: '+3 steps this turn (while not carrying).' },
  d4: { name: 'Quarterback', cost: 2, kind: 'passFlat',
    blurb: 'One pass at target 6, any distance.' },
  d5: { name: 'Last-Ditch Tackle', cost: 3, kind: 'autoSteal',
    blurb: 'Automatic steal from an adjacent carrier (your action).' },
  d6: { name: 'Recovery Pace', cost: 1, kind: 'steps', n: 3, needs: 'oppBall',
    blurb: '+3 steps this turn while the opponent has the ball.' },
  d7: { name: 'Bodyline', cost: 2, kind: 'ctlSelf', n: 2,
    blurb: '+2 CTL on all his contests until your next turn.' },
  d8: { name: 'Dark Arts', cost: 2, kind: 'freeze',
    blurb: 'Foul: freeze an adjacent opponent for their next turn.' },
  m1: { name: 'Laser Pass', cost: 3, kind: 'passAuto',
    blurb: 'One pass that cannot miss.' },
  m2: { name: 'Dictate Tempo', cost: 2, kind: 'drift2',
    blurb: 'Your end-of-turn drift moves 2 squares this turn.' },
  m3: { name: 'Arrives Late', cost: 2, kind: 'arrive',
    blurb: 'After your team completes a pass: he immediately runs up to SPD.' },
  m4: { name: 'Everywhere', cost: 3, kind: 'autoSteal',
    blurb: 'Automatic steal from an adjacent carrier (your action).' },
  m5: { name: 'Metronome', cost: 1, kind: 'metronome',
    blurb: 'Pass attempts earn 2 charges until your next turn.' },
  m6: { name: 'Press Resistance', cost: 3, kind: 'dribbleAuto',
    blurb: 'His dribble challenges auto-succeed this turn.' },
  m7: { name: 'Half-Turn Escape', cost: 2, kind: 'stealGuard',
    blurb: 'Steals against him auto-fail until your next turn.' },
  m8: { name: 'Thunderbolt', cost: 3, kind: 'shotNoDist',
    blurb: 'One shot with the distance penalty halved.' },
  f1: { name: 'Slalom', cost: 4, kind: 'dribbleAuto', n: 1,
    blurb: '+1 step; his dribble challenges auto-win this turn.' },
  f2: { name: 'SIUUU', cost: 4, kind: 'skipKeeper', maxDist: 5,
    blurb: 'Within 5 of goal: an on-target shot bypasses the keeper.' },
  f3: { name: 'Afterburner', cost: 2, kind: 'steps', n: 3,
    blurb: '+3 steps this turn.' },
  f4: { name: 'Predator', cost: 3, kind: 'shotAuto', maxDist: 3,
    blurb: 'Within 3 of goal: his shot is automatically on target.' },
  f5: { name: 'Drama', cost: 3, kind: 'drama',
    blurb: 'Draw a foul: freeze an adjacent opponent; your team drifts 2 now.' },
  f6: { name: 'Cut Inside', cost: 2, kind: 'shoMove',
    blurb: '+2 SHO on this turn’s shot if he moved 2+ squares first.' },
  f7: { name: 'Baila', cost: 2, kind: 'dribbleAuto', freezeBeaten: true, once: true,
    blurb: 'Auto-win one dribble challenge; the beaten defender is frozen.' },
  f8: { name: 'One-Two', cost: 2, kind: 'oneTwo',
    blurb: 'After his completed pass, the receiver immediately moves 2.' },
};

// Non-unique fallback abilities for undrafted (template) teams, one per role,
// so quick matches still exercise the charge economy.
export const ROLE_ABILITIES = {
  GK: { name: 'Smother', cost: 2, kind: 'diveCover',
    blurb: 'When diving: count your dive 1 cell closer to the shot.' },
  DF: { name: 'Hard Tackle', cost: 2, kind: 'ctlSelf', n: 2,
    blurb: '+2 CTL on his contests until your next turn.' },
  MF: { name: 'Switch Play', cost: 2, kind: 'passFlat',
    blurb: 'One pass at target 6, any distance.' },
  FW: { name: 'Poacher', cost: 3, kind: 'shotAuto', maxDist: 3,
    blurb: 'Within 3 of goal: his shot is automatically on target.' },
};

export function abilityFor(player) {
  if (!player) return null;
  if (player.lookId && ABILITIES[player.lookId]) return ABILITIES[player.lookId];
  return ROLE_ABILITIES[player.role] || null;
}
