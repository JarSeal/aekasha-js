import { createHudRoot, getHUDRootCMP, hasHudRoot } from 'aekasha/ui';

/**
 * The Hub's one UI kit HUD root (p805 Phase 7 section 2), shared by the search (`_search.ts`) and
 * the component library (`_components.ts`): `createHudRoot` throws on a second call, and either
 * may run first (⌘K before a library page's demos load). Made in a slot at the end of `<body>` (a
 * Hub page has no `#hudRoot`), as the boot does in an app. Both chunks import this module, so a
 * build puts it in a chunk they share. The built-in icons are the library's to register: the
 * search uses none, and they'd put about 10 kB into its chunk.
 */
export const getKitRoot = () => {
  if (hasHudRoot()) return getHUDRootCMP();
  const slot = document.createElement('div');
  document.body.append(slot);
  return createHudRoot({ slot });
};
