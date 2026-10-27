// The colour fields' recent colours (p804 D8): one list for the page, in memory, which every
// colour field adds to and shows; an owner that keeps them across loads reads and sets them here.
import { formatColorHex, parseColorText } from './ColorValue';

/** The most a list keeps: the newest first */
const MAX_RECENT_COLORS = 8;

const recentColors: string[] = [];
const recentListeners = new Set<(colors: readonly string[]) => void>();

/** A colour text as the list keeps it (`'#rrggbb'`, `'#rrggbbaa'` when not opaque), or null */
const toListColor = (text: string) => {
  const { value } = parseColorText(text);
  return value ? formatColorHex(value, value.a < 1) : null;
};

/**
 * The colours the page's colour fields last set (p804 D8): newest first, at most 8, each
 * `'#rrggbb'` (`'#rrggbbaa'` when not opaque). A copy: what an owner saves.
 */
export const getRecentColors = (): string[] => [...recentColors];

/**
 * Sets the recent colours (an owner's saved ones, at a load): any colour text, the first newest;
 * texts that aren't colours and repeats are left out, and only the first 8 kept. Calls no
 * {@link onRecentColorsChange} listener: the owner set them.
 * @param colors the colours, newest first
 */
export const setRecentColors = (colors: readonly string[]) => {
  recentColors.length = 0;
  for (const text of colors) {
    const color = toListColor(text);
    if (color && !recentColors.includes(color)) recentColors.push(color);
    if (recentColors.length === MAX_RECENT_COLORS) break;
  }
};

/**
 * Calls `listener` with the recent colours each time a colour field adds one (a colour the user
 * set: a typed one, a swatch, the eyedropper, a reset), so an owner can save them.
 * @param listener gets the list, newest first (a copy)
 * @returns removes the listener
 */
export const onRecentColorsChange = (listener: (colors: readonly string[]) => void) => {
  recentListeners.add(listener);
  return () => {
    recentListeners.delete(listener);
  };
};

/**
 * Puts a colour first in the list (moved there when it's in it already) and tells the listeners.
 * @internal
 */
export const addRecentColor = (text: string) => {
  const color = toListColor(text);
  if (!color) return;
  if (recentColors[0] === color) return;
  const index = recentColors.indexOf(color);
  if (index !== -1) recentColors.splice(index, 1);
  recentColors.unshift(color);
  if (recentColors.length > MAX_RECENT_COLORS) recentColors.length = MAX_RECENT_COLORS;
  for (const listener of recentListeners) listener(getRecentColors());
};
