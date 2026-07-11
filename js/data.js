// Static game data: rosters and formation cards.
// Coordinates are for the HOME team (defends bottom edge, y=11; attacks top).
// Away positions are mirrored with mirrorY().

export const W = 7;
export const H = 12;
export const GOAL_COLS = [2, 3, 4]; // x columns covered by each goal mouth
export const MAX_TURNS = 40;

// Roster template shared by both teams. spd = tiles of movement,
// sho/pas/ctl = 2d6 modifiers.
export const ROSTER = [
  { num: 1, role: 'GK', name: 'Keeper', spd: 3, sho: 0, pas: 1, ctl: 3 },
  { num: 2, role: 'DF', name: 'Stopper', spd: 3, sho: 0, pas: 1, ctl: 2 },
  { num: 3, role: 'DF', name: 'Sweeper', spd: 4, sho: 0, pas: 1, ctl: 2 },
  { num: 4, role: 'MF', name: 'Engine', spd: 4, sho: 1, pas: 2, ctl: 1 },
  { num: 5, role: 'MF', name: 'Playmaker', spd: 4, sho: 1, pas: 2, ctl: 1 },
  { num: 6, role: 'FW', name: 'Winger', spd: 5, sho: 2, pas: 1, ctl: 1 },
  { num: 7, role: 'FW', name: 'Striker', spd: 4, sho: 3, pas: 0, ctl: 0 },
];

// Formation cards: gk slot + 6 ordered outfield slots (defense first).
// Slots map to roster order (2,3 → first two slots; 4,5 → next; 6,7 → last).
export const FORMATIONS = [
  {
    id: 'bus',
    name: '3-2-1 Park the Bus',
    short: '3-2-1',
    stance: 'defensive',
    gk: [3, 11],
    slots: [
      [1, 9], [3, 9], [5, 9],
      [2, 7], [4, 7],
      [3, 4],
    ],
  },
  {
    id: 'balanced',
    name: '2-2-2 Balanced',
    short: '2-2-2',
    stance: 'balanced',
    gk: [3, 11],
    slots: [
      [2, 9], [4, 9],
      [2, 6], [4, 6],
      [2, 3], [4, 3],
    ],
  },
  {
    id: 'press',
    name: '2-3-1 Midfield Press',
    short: '2-3-1',
    stance: 'pressing',
    gk: [3, 11],
    slots: [
      [2, 9], [4, 9],
      [1, 5], [3, 5], [5, 5],
      [3, 3],
    ],
  },
  {
    id: 'attack',
    name: '1-2-3 All-out Attack',
    short: '1-2-3',
    stance: 'attacking',
    gk: [3, 11],
    slots: [
      [3, 9],
      [2, 6], [4, 6],
      [1, 2], [3, 2], [5, 2],
    ],
  },
];

export const TEAM_META = {
  home: { name: 'Reds', color: '#e0453a', dark: '#8f221b' },
  away: { name: 'Blues', color: '#3a6fe0', dark: '#1b3a8f' },
};

export function mirrorY(y) {
  return H - 1 - y;
}
