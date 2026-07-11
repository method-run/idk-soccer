# Grid Soccer — v1 Design

A turn-based soccer board game, playable as a standalone PWA and convertible to paper.
User picked: 2d6 + modifier dice, one opinionated v1, vanilla JS + SVG.

## Board

- Field: 7 wide (x 0–6) × 12 deep (y 0–11).
- Goals: 3 wide × 2 deep rectangles attached outside the center of each short edge
  (columns 2–4). Home defends the bottom goal, Away defends the top.
- The goal rectangle doubles as the shot-targeting grid: 3 columns × 2 heights
  (low/high) = 6 aim cells.

## Teams (v1 chance taken: 7-a-side)

11-a-side (e.g. 3-3-4) would put 22 pieces on 84 tiles — heavy for a first
playtest. v1 uses **keeper + 6 outfield** per team. Team size is a constant in
`data.js`; easy to revisit.

Roster template (same both teams for fairness):

| # | Role | SPD | SHO | PAS | CTL |
|---|------|-----|-----|-----|-----|
| 1 | GK   | 3   | +0  | +1  | +3  |
| 2 | DF   | 3   | +0  | +1  | +2  |
| 3 | DF   | 4   | +0  | +1  | +2  |
| 4 | MF   | 4   | +1  | +2  | +1  |
| 5 | MF   | 4   | +1  | +2  | +1  |
| 6 | FW   | 5   | +2  | +1  | +1  |
| 7 | FW   | 4   | +3  | +0  | +0  |

Stats: SPD = movement tiles; SHO/PAS/CTL = 2d6 roll modifiers.

## Formation cards

Each card = 6 ordered outfield target tiles + GK slot. Four cards per team:

- **3-2-1 Park the Bus** (defensive)
- **2-2-2 Balanced**
- **2-3-1 Midfield Press**
- **1-2-3 All-out Attack**

Targets shift 1 column toward the ball (clamped) so the block slides laterally.
Switching cards (once per turn, free) is how you push up or drop deep.

## Turn sequence

1. *(Optional, once per turn)* Switch your formation card.
2. The **forced mover** — your footballer carrying the ball, else your closest
   to it (ties: lowest number) — moves and/or takes one ball action.
   - Carrying: move up to SPD−2 (min 1), then Pass or Shoot.
   - Not carrying: move up to SPD; landing on a loose ball = pickup;
     adjacent to an enemy carrier = may attempt Steal.
3. End turn: every *other* teammate drifts 1 tile (8-directional) toward its
   formation slot. Turn passes.

Movement is 8-directional BFS around occupied tiles.

## Dice (2d6 + stat vs target number)

- **Pass**: pick any tile within 8. TN = 6 + ⌊dist/3⌋. Success: ball lands
  there (teammate → control, opponent → they take it, empty → loose).
  Fail: scatter 1 tile (miss margin ≤2) or 2 tiles (else), random direction.
- **Shot**: TN = 8 + ⌈max(0, dist−2)/2⌉, +1 if aiming a corner column.
  Distance = Chebyshev to goal-mouth center.
  - Accurate + **doubles** = unstoppable screamer (skip keeper).
  - Accurate: keeper picks a dive cell (blind hand-off overlay in hotseat;
    weighted-random for AI). Exact cell = save; same column = save on
    2d6+CTL vs 8; wrong column = **goal**.
  - Miss by 1 = rebound loose near goal; worse = keeper's ball.
- **Pickup (loose ball)**: no opponent adjacent → automatic. Opponent adjacent
  → opposed 2d6+CTL vs best adjacent opponent; tie to mover; loss scatters
  the ball 1 tile.
- **Steal (carried ball)**: 2d6+CTL vs 8 + carrier's CTL. Success: take the
  ball. Fail: nothing (your action is spent).

All mechanics use only d6s + a random-direction die → convertible to paper.

## Match flow

- 40 turns total (20 per side), most goals wins, ties allowed in v1.
- Goal → both teams snap to formation targets, conceding team kicks off at
  the center tile.

## Modes

- **PvE**: Home = human, Away = heuristic AI (formation picks by game state;
  mover: shoot if expected value is decent, else advance/pass; chase/steal
  when defending; keeper dives weighted toward center).
- **PvP hotseat**: same screen; blind keeper-dive via a "hand over the device"
  overlay.

## Tech

Vanilla ES modules, no build step. SVG board. `manifest.webmanifest` +
service worker (cache-first) for offline/installable PWA. Pure game engine
(`game.js`, `dice.js` injectable RNG) covered by `node --test`; AI-vs-AI
simulation as an integration smoke test.

## Chances taken (flag for feedback)

1. 7-a-side instead of 11.
2. Forced mover (closest to ball) with deterministic tie-break.
3. Drift happens at end of turn, 1 tile.
4. One ball action per turn; steal consumes it.
5. No throw-ins/corners — scattered balls clamp to the field.
6. No stamina; SPD flat.
7. Shot ranges effectively cap around 6 tiles via TN growth.
