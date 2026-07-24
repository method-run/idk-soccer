// Procedural character art: flat-cartoon SVG portraits, hand-tuned per
// parody star (hair, skin, beard evoke the real player's look). Returns
// SVG markup strings so portraits can embed in HTML and inside board SVG.

const SKIN = {
  pale: '#f2cfae',
  light: '#eebd93',
  tan: '#d9a06b',
  brown: '#a06a3f',
  deep: '#71482a',
};
const HAIR = {
  black: '#191919',
  dark: '#2e2118',
  brown: '#5a3d22',
  blond: '#d9b04a',
  ginger: '#b5541e',
};

// look: { skin, hair, style, beard }
// styles: buzz | short | slick | curly | long | bun | fro | spiky | crop
// beards: none | full | stubble | goatee | mustache
export const LOOKS = {
  gk1: { skin: 'light', hair: 'dark', style: 'short', beard: 'full' }, // Alysson Bucker
  gk2: { skin: 'pale', hair: 'blond', style: 'slick', beard: 'none' }, // Neuherr
  gk3: { skin: 'pale', hair: 'dark', style: 'crop', beard: 'stubble' }, // Kourtoise
  gk4: { skin: 'light', hair: 'dark', style: 'slick', beard: 'stubble' }, // Ederson
  d1: { skin: 'deep', hair: 'black', style: 'bun', beard: 'full' }, // van Dyke
  d2: { skin: 'light', hair: 'black', style: 'crop', beard: 'stubble' }, // Ruben Diaz
  d3: { skin: 'tan', hair: 'black', style: 'curly', beard: 'stubble' }, // Hakeemi
  d4: { skin: 'light', hair: 'brown', style: 'curly', beard: 'none' }, // Trent A-A
  d5: { skin: 'tan', hair: 'brown', style: 'buzz', beard: 'goatee' }, // Markinhos
  d6: { skin: 'deep', hair: 'black', style: 'buzz', beard: 'stubble' }, // Saleeba
  d7: { skin: 'pale', hair: 'brown', style: 'crop', beard: 'none' }, // Gvardian
  d8: { skin: 'light', hair: 'dark', style: 'short', beard: 'stubble' }, // Carvahal
  m1: { skin: 'pale', hair: 'ginger', style: 'short', beard: 'none' }, // De Broin
  m2: { skin: 'pale', hair: 'brown', style: 'long', beard: 'stubble' }, // Modritch
  m3: { skin: 'brown', hair: 'black', style: 'curly', beard: 'stubble' }, // Bellingsworth
  m4: { skin: 'deep', hair: 'black', style: 'buzz', beard: 'none' }, // Kanteh
  m5: { skin: 'light', hair: 'brown', style: 'short', beard: 'stubble' }, // Rodri
  m6: { skin: 'pale', hair: 'blond', style: 'curly', beard: 'none' }, // de Young
  m7: { skin: 'light', hair: 'dark', style: 'fro', beard: 'none' }, // Pedri
  m8: { skin: 'light', hair: 'dark', style: 'buzz', beard: 'goatee' }, // Valverdi
  f1: { skin: 'light', hair: 'brown', style: 'short', beard: 'full' }, // Nessi
  f2: { skin: 'light', hair: 'black', style: 'slick', beard: 'none' }, // Bonaldo
  f3: { skin: 'brown', hair: 'black', style: 'buzz', beard: 'none' }, // Mbompé
  f4: { skin: 'pale', hair: 'blond', style: 'bun', beard: 'none' }, // Haalund
  f5: { skin: 'light', hair: 'black', style: 'spiky', beard: 'goatee' }, // Neimar
  f6: { skin: 'tan', hair: 'black', style: 'fro', beard: 'full' }, // Sallah
  f7: { skin: 'brown', hair: 'black', style: 'curly', beard: 'none' }, // Vinny
  f8: { skin: 'pale', hair: 'brown', style: 'short', beard: 'none' }, // Cane
};

// Deterministic look for template-roster players (quick match).
export function fallbackLook(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const skins = Object.keys(SKIN);
  const hairs = Object.keys(HAIR);
  const styles = ['buzz', 'short', 'slick', 'curly', 'long', 'crop', 'fro'];
  const beards = ['none', 'none', 'stubble', 'full', 'goatee'];
  return {
    skin: skins[h % skins.length],
    hair: hairs[(h >> 3) % hairs.length],
    style: styles[(h >> 6) % styles.length],
    beard: beards[(h >> 9) % beards.length],
  };
}

// The head + hair + face, centered on (32,30) in a 64x64 space.
// Exported separately so it can sit on meeple bodies and in SVG stat cards.
export function headMarkup(look) {
  const skin = SKIN[look.skin] || SKIN.light;
  const hair = HAIR[look.hair] || HAIR.dark;
  const behind = [];
  const front = [];
  switch (look.style) {
    case 'long':
      behind.push(`<path d="M18 26 q0 -14 14 -14 q14 0 14 14 v16 q0 5 -5 5 h-3 v-18 h-12 v18 h-3 q-5 0 -5 -5 z" fill="${hair}"/>`);
      front.push(`<path d="M19 27 q1 -13 13 -13 q12 0 13 13 q-5 -7 -13 -7 q-8 0 -13 7 z" fill="${hair}"/>`);
      break;
    case 'fro':
      behind.push(`<circle cx="32" cy="22" r="15" fill="${hair}"/>`);
      behind.push(`<circle cx="20" cy="27" r="7" fill="${hair}"/>`);
      behind.push(`<circle cx="44" cy="27" r="7" fill="${hair}"/>`);
      break;
    case 'bun':
      behind.push(`<circle cx="32" cy="12" r="6" fill="${hair}"/>`);
      front.push(`<path d="M19 27 q1 -12 13 -12 q12 0 13 12 q-4 -8 -13 -8 q-9 0 -13 8 z" fill="${hair}"/>`);
      break;
    case 'spiky':
      front.push(`<path d="M19 26 l3 -9 l4 5 l4 -8 l4 8 l4 -5 l4 9 q-5 -6 -11.5 -6 q-6.5 0 -11.5 6 z" fill="${hair}"/>`);
      break;
    case 'curly': {
      const dots = [];
      for (let i = 0; i < 6; i++) {
        const a = -160 + i * 28;
        const x = 32 + 12.5 * Math.cos((a * Math.PI) / 180);
        const y = 26 + 11 * Math.sin((a * Math.PI) / 180);
        dots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.4" fill="${hair}"/>`);
      }
      front.push(dots.join(''));
      break;
    }
    case 'slick':
      front.push(`<path d="M19 26 q0 -12 13 -12 q13 0 13 12 q-2 -7 -13 -7.5 q-8 0 -10 3.5 z" fill="${hair}"/>`);
      break;
    case 'buzz':
      front.push(`<path d="M20 25 q2 -10 12 -10 q10 0 12 10 q-5 -5 -12 -5 q-7 0 -12 5 z" fill="${hair}" opacity="0.75"/>`);
      break;
    case 'crop':
      front.push(`<path d="M19.5 26 q1 -11 12.5 -11 q11.5 0 12.5 11 q-4 -6.5 -12.5 -6.5 q-8.5 0 -12.5 6.5 z" fill="${hair}"/>`);
      break;
    default: // short
      front.push(`<path d="M19 27 q0 -13 13 -13 q13 0 13 13 q-3 -8 -13 -8 q-10 0 -13 8 z" fill="${hair}"/>`);
      front.push(`<path d="M19 26 v6 l3 -1 v-5 z M45 26 v6 l-3 -1 v-5 z" fill="${hair}"/>`);
  }

  let beard = '';
  if (look.beard === 'full') {
    beard = `<path d="M20.5 30 q0 13 11.5 13 q11.5 0 11.5 -13 q0 10 -4 12 q-3 2 -7.5 2 q-4.5 0 -7.5 -2 q-4 -2 -4 -12 z"
      fill="${hair}"/><path d="M27 40.5 q5 3.5 10 0 q-2 4 -5 4 q-3 0 -5 -4 z" fill="${hair}"/>`;
  } else if (look.beard === 'stubble') {
    beard = `<path d="M21.5 32 q0 10 10.5 10 q10.5 0 10.5 -10 q-1 8 -10.5 8 q-9.5 0 -10.5 -8 z" fill="${hair}" opacity="0.4"/>`;
  } else if (look.beard === 'goatee') {
    beard = `<path d="M28.5 41 q3.5 2.5 7 0 q-1 4 -3.5 4 q-2.5 0 -3.5 -4 z" fill="${hair}"/>`;
  } else if (look.beard === 'mustache') {
    beard = `<path d="M26 38 q6 -2.5 12 0 q-3 2.5 -6 2.5 q-3 0 -6 -2.5 z" fill="${hair}"/>`;
  }

  return `
    ${behind.join('')}
    <ellipse cx="19.5" cy="31" rx="2.6" ry="3.4" fill="${skin}"/>
    <ellipse cx="44.5" cy="31" rx="2.6" ry="3.4" fill="${skin}"/>
    <ellipse cx="32" cy="30" rx="13" ry="15" fill="${skin}"/>
    ${beard}
    ${front.join('')}
    <circle cx="27" cy="30" r="1.7" fill="#1c1c1c"/>
    <circle cx="37" cy="30" r="1.7" fill="#1c1c1c"/>
    <path d="M24.4 26.4 q2.6 -1.7 5 -0.6 M34.6 25.8 q2.6 -1.1 5 0.6"
      stroke="#1c1c1c" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <path d="M31.5 32 q1 2.5 -0.5 3.6" stroke="#00000033" stroke-width="1.3" fill="none" stroke-linecap="round"/>
    <path d="M28 38.5 q4 3 8 0" stroke="#5e2f1e" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
}

// Full portrait card: background, jersey, head.
export function portraitSVG(look, { size = 56, team = null, className = '' } = {}) {
  const jersey = team === 'away' ? '#3a6fe0' : team === 'home' ? '#e0453a' : '#4a5f52';
  const bg = team === 'away' ? '#1c2947' : team === 'home' ? '#47201d' : '#233029';
  return `<svg class="portrait ${className}" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
    <rect x="0" y="0" width="64" height="64" rx="10" fill="${bg}"/>
    <path d="M12 64 q1 -16 12 -18 l8 -3 l8 3 q11 2 12 18 z" fill="${jersey}"/>
    <rect x="28.5" y="41" width="7" height="7" fill="${SKIN[look.skin] || SKIN.light}"/>
    ${headMarkup(look)}
  </svg>`;
}
