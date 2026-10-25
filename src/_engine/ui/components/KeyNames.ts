// A key's names (p803 D10): what Kbd and the input glyph show for a key and what they say for it,
// on macOS and elsewhere. No styles, so either component imports it without the other's.

/**
 * The platform a key's names are for: macOS shows the modifiers as symbols (⌘), the others as
 * words.
 * @internal
 */
export type KeyPlatform = 'mac' | 'other';

/**
 * A key's names: `shown` (`'⌘'`, `'Ctrl'`, `'↑'`) and `spoken` (`'Command'`, `'Control'`, `'Up
 * arrow'`), the text assistive tech reads.
 * @internal
 */
export type KeyName = { shown: string; spoken: string };

/** By the key's lowercased name: [shown on macOS, shown elsewhere, spoken on macOS, elsewhere] */
const NAMES: { [key: string]: [string, string, string, string] } = {
  ctrl: ['⌃', 'Ctrl', 'Control', 'Control'],
  control: ['⌃', 'Ctrl', 'Control', 'Control'],
  shift: ['⇧', 'Shift', 'Shift', 'Shift'],
  alt: ['⌥', 'Alt', 'Option', 'Alt'],
  option: ['⌥', 'Alt', 'Option', 'Alt'],
  meta: ['⌘', 'Meta', 'Command', 'Meta'],
  cmd: ['⌘', 'Meta', 'Command', 'Meta'],
  command: ['⌘', 'Meta', 'Command', 'Meta'],
  arrowup: ['↑', '↑', 'Up arrow', 'Up arrow'],
  arrowdown: ['↓', '↓', 'Down arrow', 'Down arrow'],
  arrowleft: ['←', '←', 'Left arrow', 'Left arrow'],
  arrowright: ['→', '→', 'Right arrow', 'Right arrow'],
  escape: ['Esc', 'Esc', 'Escape', 'Escape'],
  esc: ['Esc', 'Esc', 'Escape', 'Escape'],
  ' ': ['Space', 'Space', 'Space', 'Space'],
  space: ['Space', 'Space', 'Space', 'Space'],
  enter: ['Enter', 'Enter', 'Enter', 'Enter'],
  return: ['Enter', 'Enter', 'Enter', 'Enter'],
  backspace: ['Backspace', 'Backspace', 'Backspace', 'Backspace'],
  delete: ['Del', 'Del', 'Delete', 'Delete'],
  pageup: ['PgUp', 'PgUp', 'Page up', 'Page up'],
  pagedown: ['PgDn', 'PgDn', 'Page down', 'Page down'],
};

/**
 * Whether the page runs on macOS or iOS (the platform whose modifiers are symbols): read when a
 * component is made, never at load.
 * @internal
 */
export const getKeyPlatform = (): KeyPlatform => {
  if (typeof navigator === 'undefined') return 'other';
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || '')
    ? 'mac'
    : 'other';
};

/**
 * A key's shown and spoken names (`KeyboardEvent.key` values and `getKeyChordLabel`'s words, case
 * ignored); a one-character key is upper-cased, an unknown one kept as it is.
 * @internal
 */
export const getKeyName = (key: string, platform: KeyPlatform): KeyName => {
  const names = NAMES[key.length === 1 ? key : key.toLowerCase()];
  if (names) {
    const isMac = platform === 'mac';
    return { shown: names[isMac ? 0 : 1], spoken: names[isMac ? 2 : 3] };
  }
  const name = key.length === 1 ? key.toUpperCase() : key;
  return { shown: name, spoken: name };
};

/**
 * A chord's keys, in order (`'Ctrl+Shift+P'` → three; a trailing `+` is the key itself:
 * `'Ctrl++'`, and `'+'` alone).
 * @internal
 */
export const splitKeyChord = (chord: string): string[] => {
  const text = chord.trim();
  if (text === '+') return ['+'];
  if (text.endsWith('++')) return [...text.slice(0, -2).split('+'), '+'].map((k) => k.trim());
  return text
    .split('+')
    .map((key) => key.trim())
    .filter(Boolean);
};
