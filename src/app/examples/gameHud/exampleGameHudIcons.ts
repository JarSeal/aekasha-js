import { registerIcon } from 'aekasha/ui';

// The example's own icons (16 × 16, `currentColor`): the hotbar's and the inventory's items, the
// feed's lines and the emotes. A production build registers no built-in icon, so an app
// registers the ones it shows (an unregistered name draws `??` with a warning).

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor">${body}</svg>`;

const ICONS = {
  gameHudPotion: svg('<path d="M6 1h4v1H9v3.2a5 5 0 1 1-2 0V2H6zm-2.2 9a4.2 4.2 0 0 0 8.4 0z"/>'),
  gameHudTonic: svg('<path d="M9.5 1 3 9h4l-1 6 6.5-8h-4z"/>'),
  gameHudWhistle: svg(
    '<path d="M2 7h7l5-3v2l-3 2a4 4 0 1 1-8 1zm4 1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/>'
  ),
  gameHudSword: svg('<path d="M13 1h2v2l-7 7 1.5 1.5-1 1L7 11l-3 3-2-2 3-3-1.5-1.5 1-1L6 8z"/>'),
  gameHudDagger: svg('<path d="M12 2h2v2l-5 5 1 1-1 1-1.5-1.5L5 12l-1-1 2.5-2.5L5 7l1-1 1 1z"/>'),
  gameHudShield: svg('<path d="M8 1 2 3v4c0 4 3 6.5 6 8 3-1.5 6-4 6-8V3z"/>'),
  gameHudGem: svg('<path d="M4 2h8l3 4-7 9-7-9zm0 4h8L8 13z"/>'),
  gameHudCoin: svg(
    '<path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/>'
  ),
  gameHudFlag: svg('<path d="M3 1h1.5v14H3zm2.5 1H13l-2 3 2 3H5.5z"/>'),
  gameHudHeart: svg('<path d="M8 14 2 8a3.5 3.5 0 0 1 6-4 3.5 3.5 0 0 1 6 4z"/>'),
  gameHudWave: svg('<path d="M6 1h1.5v6h1V2H10v5h1V3h1.5v7a5 5 0 0 1-10 0V6H4v3h1V2h1z"/>'),
  gameHudStar: svg(
    '<path d="m8 1 2.1 4.5 4.9.6-3.6 3.4.9 4.9L8 12l-4.3 2.4.9-4.9L1 6.1l4.9-.6z"/>'
  ),
  gameHudPoint: svg('<path d="M1 7h9V4l5 4-5 4V9H1z"/>'),
  gameHudShrug: svg(
    '<path d="M8 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM1 6l3 3h8l3-3 1 1-3.5 4H11v4H5v-4H3.5L0 7z"/>'
  ),
} as const;

/** The example's icon names */
export type GameHudIcon = keyof typeof ICONS;

/** Registers the example's icons (on every visit: a registration replaces the same name's) */
export const registerGameHudIcons = () => {
  for (const name in ICONS) registerIcon(name, ICONS[name as GameHudIcon]);
};
