# Charge Counters & Player Abilities — Design

Goal: a strategic resource loop layered on the existing turn game. Doing
*footballing* things — keeping the ball, winning duels, defending — banks
**charges**; charges activate **one unique ability per drafted star**,
themed to the real player's game. Costs scale with impact.

## 1. Charge economy

**Team-wide pool** (not per-player): fewer counters to track, keeps paper
play simple (a stack of beads per team), and makes "who do I spend this
on?" a real decision.

Earning — REVISED (v2): outcome-blind. Charges reward *attempting* the
game's mechanics and falling behind, never winning rolls ("win-more").
Each line max once per your turn; bank cap **6**:

| Event | Charges | Why it's strategic |
|---|---|---|
| Attempting a pass (any outcome) | +1 | rewards interaction & ball movement |
| Attempting a tackle (any outcome) | +1 | rewards defensive engagement |
| Taking on a defender (dribble-through attempt) | +1 | rewards risky attacking play |
| Attempting a shot | +1 | rewards finishing moves |
| Ending your turn without possession | +1 | underdog drip while defending |
| Conceding a goal | +2 | rubber-band; sets up comeback drama |

**Stacking allowed (v2)**: any number of activations per turn; each
individual player's ability at most once per turn. Cheap abilities can be
doubled up. Activations are announced before dice are rolled for the
affected action.

Paper conversion: beads/coins by each team's goal; ability text lives on
the player's draft card.

## 2. Ability design rules

- Every pool player has exactly **one** ability, usable only under its
  stated condition (possession, proximity, field position).
- Cost rubric: **1** = small modifier/utility · **2** = reliable edge on
  one roll or a positional trick · **3** = auto-success on one contested
  thing · **4** = signature, game-swinging.
- Auto-successes never stack with each other in one action, and no
  ability can make a *goal* automatic — the shot roll or the keeper always
  gets a say, except where noted (and priced accordingly).

## 3. The roster (28 abilities)

### Keepers

| Player | Ability | Cost | Effect (condition) |
|---|---|---|---|
| Alysson Bucker | **Big-Game Save** | 2 | React when diving: reduce the dive's distance-off by 1 (min 0). |
| Manuel Neuherr | **Sweeper-Keeper** | 1 | This turn he moves at SPD+2, and until your next turn he takes no off-his-line save penalty. |
| Thibaut Kourtoise | **Giant Frame** | 2 | React on an opponent shot: your dive covers its cell and every adjacent cell as if 1 closer. |
| Ederson Morays | **Launch It** | 1 | While holding the ball: one pass with unlimited range at flat TN 6. |

### Defenders

| Player | Ability | Cost | Effect (condition) |
|---|---|---|---|
| Virgil van Dyke | **The Wall** | 3 | Until your next turn, any carrier moving within 1 square of him loses the ball to him (3×3 denial zone). |
| Ruben Diaz | **Organizer** | 2 | Teammates within 2 squares of him get +1 CTL until your next turn. |
| Ashraf Hakeemi | **Overlap** | 1 | +3 steps this turn (he must not be carrying at activation). |
| Trent Arnold-Alexander | **Quarterback** | 2 | One pass this turn: no distance penalty, any range (TN 6). |
| Markinhos | **Last-Ditch Tackle** | 3 | Automatic steal from an adjacent carrier. |
| Will Saleeba | **Recovery Pace** | 1 | Opponent has the ball: +3 steps this turn. |
| Josko Gvardian | **Bodyline** | 2 | +2 on all his contest rolls until your next turn. |
| Dani Carvahal | **Dark Arts** (foul) | 2 | Freeze an adjacent opponent: they can't be selected as mover on their next turn. |

### Midfielders

| Player | Ability | Cost | Effect (condition) |
|---|---|---|---|
| Kevin De Broin | **Laser Pass** | 3 | While carrying: one pass auto-succeeds (no roll, no scatter). |
| Luka Modritch | **Dictate Tempo** | 2 | Your end-of-turn drift moves teammates 2 squares instead of 1. |
| Jude Bellingsworth | **Arrives Late** | 2 | After your team's completed pass this turn, he immediately takes a bonus move of up to SPD. |
| N'Golo Kanteh | **Everywhere** | 3 | Automatic steal from an adjacent carrier. |
| Rodri Hernandes | **Metronome** | 1 | Until your next turn, your completed passes earn 2 charges instead of 1. |
| Frenkie de Young | **Press Resistance** | 3 | This turn, his dribble-through challenges auto-succeed. |
| Pedri Gonsales | **Half-Turn Escape** | 2 | Pre-declared on your turn: steals against him auto-fail until your next turn. |
| Federico Valverdi | **Thunderbolt** | 3 | One shot this turn takes no distance penalty. |

### Forwards

| Player | Ability | Cost | Effect (condition) |
|---|---|---|---|
| Leo Nessi | **Slalom** | 4 | This turn: +1 step and every dribble challenge he faces auto-wins. |
| Cristiano Bonaldo | **SIUUU** | 4 | While carrying, within 5 of goal: if his shot this turn is on target, skip the keeper entirely. (Accuracy roll still required.) |
| Kylian Mbompé | **Afterburner** | 2 | +3 steps this turn, carrying or not. |
| Erling Haalund | **Predator** | 3 | Within 3 of goal: his shot auto-passes the accuracy roll (keeper still dives). |
| Neimar Junyor | **Drama** (draw foul) | 3 | Adjacent to an opponent: freeze them next turn; your team snaps 2 drift steps toward formation; he takes a free pass action (no movement). |
| Mo Sallah | **Cut Inside** | 2 | If he moved ≥2 this turn: +2 SHO on this turn's shot. |
| Vinny Junyor | **Baila** | 2 | Auto-win one dribble challenge; the beaten defender is frozen next turn. |
| Harry Cane | **One-Two** | 2 | After his completed pass, the receiver immediately moves up to 2 squares (give-and-go). *(Replaced Drop Deep — pass-then-shoot was mechanically impossible.)* |

Coverage of the original rough ideas: auto-steal → Markinhos/Kanteh (3,
consumes the action); bypass miss chance → Haalund (3); bypass goalie →
Bonaldo (4, still needs accuracy); free dribble-through turn → de
Young/Nessi (3/4); foul → Carvahal (2); drawing a foul → Neimar (3, minus
the free pass — his pass is his normal action).

## 4. Rules details & edge cases

- **Frozen** players: can't be chosen as mover, don't drift, and count at
  −1 to support. Marker: lay the meeple down / status icon in app.
- Reaction abilities (keeper dive boosts) are declared after the trigger
  is announced but before dice hit the table (dice remain the undo
  checkpoint). With stacking allowed, reactions simply cost charges — no
  activation-slot bookkeeping.
- Bonus moves (Arrives Late, One-Two) move a player who is not the turn's
  mover; while a bonus move is in progress no ball action may be taken,
  and it ends when its steps run out or the turn ends.
- Quick-match template teams play without abilities (or with a single
  generic "+2 to one roll, cost 2" if testing wants parity).

## 5. Implementation sketch (for the follow-up PR)

- Engine: `state.charges = {home, away}`, `state.frozen = {playerId:
  turnNo}`, `state.abilityUsed` per turn; earning hooks in doPass/
  doSteal/resolvePickup/doShoot; `ABILITIES` table keyed by pool id with
  typed effects (`rollMod`, `autoSuccess`, `stepBonus`, `freeze`,
  `driftBoost`, `skipKeeper`, `freeAction`) so the engine stays
  data-driven rather than 28 special cases.
- UI: charge pips on team panels; "✨ Ability" ring item when the selected
  player's condition is met and charges suffice; ability text in the
  stats card; AI gets simple heuristics (spend when EV-positive: e.g.
  Kanteh steal when carrier is in range of goal).
- Tuning question to playtest first: is 6 the right bank cap, and should
  earning be symmetrical for both teams (currently yes)?
