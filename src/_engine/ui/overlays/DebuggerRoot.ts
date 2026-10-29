// The debugger's roots' attributes (p806 D8): one function gives each root the debugger root's
// attribute, the debugger's theme and the compact density, and a theme change reaches every root
// live. The kit's (a debug window is the kit's), set from the debugger's theme setting.
import type { CMPHandle, CMPProps } from '../core/CMPTypes';
import { DEBUGGER_ROOT_ATTR } from './OverlayStack';

/**
 * The debugger's theme: `'dark'` or `'light'` forces it on the debugger's roots, `'app'` sets
 * none, so they follow the kit root (the app's forced theme, or the system's).
 * @internal
 */
export type DebuggerTheme = 'dark' | 'light' | 'app';

/**
 * The themes in the setting's order.
 * @internal
 */
export const DEBUGGER_THEMES: readonly DebuggerTheme[] = ['dark', 'light', 'app'];

const THEME_ATTR = 'data-aek-theme';
const DENSITY_ATTR = 'data-aek-density';

/** Dark until the setting is read (p806 D8: the default) */
let currentTheme: DebuggerTheme = 'dark';
/** The mounted roots made with getDebuggerRootProps, which a theme change rewrites */
const roots = new Set<CMPHandle>();

const getThemeAttr = (): Record<string, string> =>
  currentTheme === 'app' ? {} : { [THEME_ATTR]: currentTheme };

/** Through the CMP, so its props (which an `update()` rebuilds the element from) agree */
const writeTheme = (cmp: CMPHandle) => {
  if (currentTheme === 'app') {
    if (cmp.elem.hasAttribute(THEME_ATTR)) cmp.removeAttr(THEME_ATTR);
    return;
  }
  if (cmp.elem.getAttribute(THEME_ATTR) !== currentTheme) {
    cmp.updateAttr({ [THEME_ATTR]: currentTheme });
  }
};

/**
 * The attributes a debugger root is made with: `DEBUGGER_ROOT_ATTR` (an app's modal dialog leaves
 * it live, p803 D7), the debugger's theme and `data-aek-density="compact"`. Use
 * `getDebuggerRootProps` for a CMP, so a theme change reaches it.
 * @internal
 */
export const getDebuggerRootAttr = (): Record<string, string> => ({
  [DEBUGGER_ROOT_ATTR]: '',
  ...getThemeAttr(),
  [DENSITY_ATTR]: 'compact',
});

/**
 * A debugger root's CMP props (p806 D8): the attributes (`getDebuggerRootAttr`), and the hooks
 * that keep its theme live while it's mounted. Spread them into the root's props; a root that has
 * its own `attr` merges the two.
 * @internal
 */
export const getDebuggerRootProps = (): Required<
  Pick<CMPProps, 'attr' | 'onCreateCmp' | 'onRemoveCmp'>
> => ({
  attr: getDebuggerRootAttr(),
  // Also written here: a root made before a theme change and mounted after it
  onCreateCmp: (cmp) => {
    roots.add(cmp);
    writeTheme(cmp);
  },
  onRemoveCmp: (cmp) => {
    roots.delete(cmp);
  },
});

/**
 * Sets the debugger's theme (the Debug tools tab's setting over `AppConfig.debugDrawer.theme`):
 * every mounted debugger root changes now, a new one is made with it.
 * @internal
 */
export const setDebuggerTheme = (theme: DebuggerTheme) => {
  if (theme === currentTheme || !DEBUGGER_THEMES.includes(theme)) return;
  currentTheme = theme;
  for (const cmp of roots) writeTheme(cmp);
};

/**
 * The debugger's theme now.
 * @internal
 */
export const getDebuggerTheme = () => currentTheme;
