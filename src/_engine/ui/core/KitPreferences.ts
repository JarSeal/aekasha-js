import type { CMPHandle } from './CMPTypes';
import { getHUDRootCMP } from './HUD';

// The player's UI preferences on a kit root (p808 D9): the theme, the UI scale, reduced motion and
// the density, as the attributes and properties the tokens read (`tokens.css`). The styling
// guide's manual writes as one call, for a game's settings menu. It writes, never persists: the
// app saves what its settings menu reports.

/** The player's UI preferences on a kit root. Each one left out stays as it is. */
export type KitPreferences = {
  /** `'dark'` or `'light'` forces the theme; `'system'` follows `prefers-color-scheme`. */
  theme?: 'dark' | 'light' | 'system';
  /** A factor on every kit size (the game's "UI scale"): 1 is the default, at least 0.5. */
  uiScale?: number;
  /** `true` turns the kit's motion off, `false` keeps it on whatever the system prefers,
   * `'system'` follows `prefers-reduced-motion`. */
  reducedMotion?: boolean | 'system';
  /** `'compact'` makes the type and space scales smaller (the debugger's density). */
  density?: 'default' | 'compact';
};

/** Where {@link setKitPreferences} writes, and what. */
export type SetKitPreferencesProps = KitPreferences & {
  /** The kit root to write on. Default: the HUD root. */
  root?: CMPHandle | HTMLElement;
};

const MIN_UI_SCALE = 0.5;

const toElem = (root?: CMPHandle | HTMLElement) =>
  !root ? getHUDRootCMP().elem : 'elem' in root ? root.elem : root;

/**
 * Sets the player's UI preferences on a kit root (the HUD root by default): the theme
 * (`data-aek-theme`), the UI scale (`--aek-ui-scale`), reduced motion (`--aek-motion`) and the
 * density (`data-aek-density`), for a settings menu. Each preference left out stays as it is.
 * @param props the preferences, and the root to write them on
 * @remarks The UI scale is read on the kit root only: on an element inside one it does nothing.
 * @example
 * ```ts
 * import { setKitPreferences } from 'aekasha/ui';
 *
 * // The settings menu's "Interface" page reported a change
 * setKitPreferences({ theme: 'light', uiScale: 1.25, reducedMotion: 'system' });
 * ```
 */
export const setKitPreferences = (props: SetKitPreferencesProps) => {
  const elem = toElem(props.root);
  const { theme, uiScale, reducedMotion, density } = props;
  if (theme === 'system') elem.removeAttribute('data-aek-theme');
  else if (theme) elem.setAttribute('data-aek-theme', theme);
  if (uiScale !== undefined && Number.isFinite(uiScale)) {
    elem.style.setProperty('--aek-ui-scale', String(Math.max(MIN_UI_SCALE, uiScale)));
  }
  if (reducedMotion === 'system') elem.style.removeProperty('--aek-motion');
  else if (reducedMotion !== undefined) {
    elem.style.setProperty('--aek-motion', reducedMotion ? '0' : '1');
  }
  if (density === 'compact') elem.setAttribute('data-aek-density', 'compact');
  else if (density === 'default') elem.removeAttribute('data-aek-density');
};

/**
 * The UI preferences set on a kit root (the HUD root by default), as {@link setKitPreferences}
 * writes them: what a settings menu starts from. Every preference is given.
 * @param root the kit root (default: the HUD root)
 */
export const getKitPreferences = (root?: CMPHandle | HTMLElement): Required<KitPreferences> => {
  const elem = toElem(root);
  const theme = elem.getAttribute('data-aek-theme');
  const scale = parseFloat(elem.style.getPropertyValue('--aek-ui-scale'));
  const motion = elem.style.getPropertyValue('--aek-motion').trim();
  return {
    theme: theme === 'dark' || theme === 'light' ? theme : 'system',
    uiScale: Number.isFinite(scale) ? scale : 1,
    reducedMotion: motion === '' ? 'system' : motion === '0',
    density: elem.getAttribute('data-aek-density') === 'compact' ? 'compact' : 'default',
  };
};
