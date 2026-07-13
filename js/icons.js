// SVG stat icons (24x24 filled paths, colored via currentColor).
// SPD = lightning bolt, SHO = target, PAS = arrow, CTL = shield.

export const STAT_ICONS = {
  spd: {
    label: 'SPD',
    full: 'Speed — squares of movement per turn',
    path: 'M13.5 2 L5 14 h5.2 L8 22 l8.8-12.5 h-5.4 Z',
  },
  sho: {
    label: 'SHO',
    full: 'Shooting — bonus on shot rolls',
    path:
      'M12 3a9 9 0 1 0 .00001 18A9 9 0 0 0 12 3Zm0 2.6a6.4 6.4 0 1 1-.00001 12.8A6.4 6.4 0 0 1 12 5.6Zm0 3.3a3.1 3.1 0 1 0 .00001 6.2A3.1 3.1 0 0 0 12 8.9Z',
    fillRule: 'evenodd',
  },
  pas: {
    label: 'PAS',
    full: 'Passing — bonus on pass rolls',
    path: 'M3 10.2 h10.4 V5.6 L21 12 l-7.6 6.4 v-4.6 H3 Z',
  },
  ctl: {
    label: 'CTL',
    full: 'Control — bonus on tackles, duels and pickups',
    path: 'M12 2 20 5 v6.2 c0 4.9-3.3 8.9-8 10.8 C7.3 20.1 4 16.1 4 11.2 V5 Z M12 4.6 6.4 6.7 v4.5 c0 3.7 2.3 6.7 5.6 8.3 3.3-1.6 5.6-4.6 5.6-8.3 V6.7 Z',
    fillRule: 'evenodd',
  },
};

// Inline HTML icon. Hover shows the abbreviation + explanation.
export function statIcon(key) {
  const ic = STAT_ICONS[key];
  return `<svg class="stat-ico" viewBox="0 0 24 24" role="img" aria-label="${ic.label}"
    ${ic.fillRule ? `fill-rule="${ic.fillRule}"` : ''}>
    <title>${ic.label} · ${ic.full}</title><path d="${ic.path}"/></svg>`;
}

// One "icon value" chunk, e.g. statChip('spd', 5) or statChip('sho', '+2').
// abbrev: also print the text label (for roomy layouts).
export function statChip(key, value, { abbrev = false } = {}) {
  const ic = STAT_ICONS[key];
  return `<span class="stat-chip" title="${ic.label} · ${ic.full}">${statIcon(key)}${
    abbrev ? `<i>${ic.label}</i>` : ''
  }<b>${value}</b></span>`;
}

export function statLine(p, { abbrev = false } = {}) {
  return [
    statChip('spd', p.spd, { abbrev }),
    statChip('sho', `+${p.sho}`, { abbrev }),
    statChip('pas', `+${p.pas}`, { abbrev }),
    statChip('ctl', `+${p.ctl}`, { abbrev }),
  ].join('');
}
