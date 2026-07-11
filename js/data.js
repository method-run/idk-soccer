// Static game data: board dimensions, rosters and formation cards.
// Coordinates are for the HOME team (defends the y=H-1 edge; attacks y=0).
// Away positions are mirrored with mirrorY().

export const W = 9;
export const H = 18;
export const GOAL_COLS = [3, 4, 5]; // x columns covered by each goal mouth
export const CENTER_X = 4;
export const MAX_TURNS = 50;

// Roster template shared by both teams. spd = tiles of movement,
// sho/pas/ctl = 2d6 modifiers.
export const ROSTER = [
  { num: 1, role: 'GK', name: 'Keeper', spd: 4, sho: 0, pas: 1, ctl: 3 },
  { num: 2, role: 'DF', name: 'Stopper', spd: 4, sho: 0, pas: 1, ctl: 2 },
  { num: 3, role: 'DF', name: 'Sweeper', spd: 5, sho: 0, pas: 1, ctl: 2 },
  { num: 4, role: 'MF', name: 'Engine', spd: 5, sho: 1, pas: 2, ctl: 1 },
  { num: 5, role: 'MF', name: 'Playmaker', spd: 5, sho: 1, pas: 2, ctl: 1 },
  { num: 6, role: 'FW', name: 'Winger', spd: 6, sho: 2, pas: 1, ctl: 1 },
  { num: 7, role: 'FW', name: 'Striker', spd: 5, sho: 3, pas: 0, ctl: 0 },
];

// Formation cards: gk slot + 6 ordered outfield slots (defense first).
// Slots map to roster order (2,3 -> first slots; 4,5 -> next; 6,7 -> last).
export const FORMATIONS = [
  {
    id: 'bus',
    name: '3-2-1 Park the Bus',
    short: '3-2-1',
    stance: 'defensive',
    gk: [4, 17],
    slots: [
      [2, 14], [4, 14], [6, 14],
      [3, 11], [5, 11],
      [4, 7],
    ],
  },
  {
    id: 'balanced',
    name: '2-2-2 Balanced',
    short: '2-2-2',
    stance: 'balanced',
    gk: [4, 17],
    slots: [
      [3, 14], [5, 14],
      [3, 9], [5, 9],
      [3, 5], [5, 5],
    ],
  },
  {
    id: 'press',
    name: '2-3-1 Midfield Press',
    short: '2-3-1',
    stance: 'pressing',
    gk: [4, 17],
    slots: [
      [3, 14], [5, 14],
      [2, 8], [4, 8], [6, 8],
      [4, 5],
    ],
  },
  {
    id: 'attack',
    name: '1-2-3 All-out Attack',
    short: '1-2-3',
    stance: 'attacking',
    gk: [4, 17],
    slots: [
      [4, 14],
      [3, 8], [5, 8],
      [2, 3], [4, 3], [6, 3],
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
