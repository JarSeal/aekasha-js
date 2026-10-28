/**
 * The component library's demos (p802 D9; public since p803 Phase 8): a chunk `hub.ts` imports on
 * a page with a `[data-hub-demo]` box, in both modes: the public library page
 * (`features/ui-kit/library/`), the dev one (`project/aekasha/components/`, the same boxes with
 * the notes for developing Ækasha) and the UI kit section's `::: demo` boxes. It uses
 * `aekasha/ui` without the engine: the Hub's script build resolves the kit's storage to its own
 * stand-in (`_kit/`, `devTools/hub/kitStandIns.ts`), and this makes the HUD root
 * (`createHudRoot`, which brings the kit's global styles), as the boot would.
 *
 * The root sits over the viewport, as in an app: each `[data-hub-demo]` box gets buttons that
 * open its piece's states there, and a library page's theme and density switches set its
 * attributes (elsewhere it follows the Hub's theme toggle, the page's `data-aek-theme`). A
 * piece drawn in the page (a key hint, an input glyph, a spinner) draws in a kit root of its own in its box
 * (`addKitRoot`, as an app's UI outside the HUD), which the switches set too.
 * The buttons and the windows' content are the page's (`.hubButton`, `.hubDemoPanel`), as an
 * app's content is the app's; everything else is the kit's.
 *
 * The demos are in `_library/`, a module per group of the UI kit section's pages (p805 D15):
 * the core page's `core.ts` and `layout.ts`, `overlays.ts`, the forms pages' `fields.ts`,
 * `editors.ts` and `containers.ts`, the data page's `data.ts` and `graphs.ts`, the dev page's `stress.ts`, and `page.ts`, the parts they
 * share. Each exports its demos by box key, and this merges them; their checks are
 * `_componentChecks.ts`' (`_library/*Checks.ts`).
 */
import { createHudRoot, registerBuiltInIcons } from 'aekasha/ui';
import { CONTAINERS_DEMOS } from './_library/containers';
import { CORE_DEMOS } from './_library/core';
import { DATA_DEMOS } from './_library/data';
import { EDITORS_DEMOS } from './_library/editors';
import { FIELDS_DEMOS } from './_library/fields';
import { GRAPHS_DEMOS } from './_library/graphs';
import { OVERLAYS_DEMOS } from './_library/overlays';
import { LAYOUT_DEMOS } from './_library/layout';
import { kitRoots, type Demo } from './_library/page';
import { STRESS_DEMOS } from './_library/stress';

const DEMOS: Record<string, Demo> = {
  ...CORE_DEMOS,
  ...LAYOUT_DEMOS,
  ...OVERLAYS_DEMOS,
  ...FIELDS_DEMOS,
  ...EDITORS_DEMOS,
  ...CONTAINERS_DEMOS,
  ...DATA_DEMOS,
  ...GRAPHS_DEMOS,
  ...STRESS_DEMOS,
};

// --- The page ---

/** The page's switches: each radio group sets (or, for '', removes) its attribute on the HUD root
 * and the demos' kit roots */
const SETTING_ATTRIBUTES: Record<string, string> = {
  theme: 'data-aek-theme',
  density: 'data-aek-density',
};

const initSettings = (hud: HTMLElement) => {
  document.querySelector('[data-hub-component-settings]')?.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const attribute = SETTING_ATTRIBUTES[input.name];
    if (!attribute) return;
    for (const elem of [hud, ...kitRoots]) {
      if (input.value) elem.setAttribute(attribute, input.value);
      else elem.removeAttribute(attribute);
    }
  });
};

/** Makes the HUD root and mounts each demo into its box (every `[data-hub-demo]` of the page) */
export const initComponents = () => {
  // The windows' buttons and the toasts are icons; the boot registers them in the debug env
  registerBuiltInIcons();
  // The root takes the place of its slot (as of the page's `#hudRoot` in an app)
  const slot = document.createElement('div');
  document.body.append(slot);
  initSettings(createHudRoot({ slot }).elem);
  for (const box of document.querySelectorAll<HTMLElement>('[data-hub-demo]')) {
    DEMOS[box.dataset.hubDemo ?? '']?.(box);
  }
};
