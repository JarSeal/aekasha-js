/**
 * What the component library's group modules share (`_components.ts` is the chunk's entry): the
 * demo's type, the ids' prefix, and the page's parts every demo builds its box from.
 */
import { CMP } from 'aekasha/ui';
import type { CMPHandle } from 'aekasha/ui';

/** A demo: fills its box (`data-hub-demo="<key>"`) with the controls that open its states */
export type Demo = (box: HTMLElement) => void;

/** Every id the demos give starts with it, so a demo never takes an id the kit uses */
export const ID_PREFIX = 'hubDemo';
/** The toaster demo's toaster, which other demos' toasts go to too (the drop-down's pick) */
export const TOASTER_ID = `${ID_PREFIX}Toaster`;

/** The single windows and dialogs the demos opened, for "Close all" */
export const openedIds = new Set<string>();
/** The kit roots the static demos draw in, which the page's switches set as they set the HUD root */
export const kitRoots: HTMLElement[] = [];

// --- The page's parts ---

/** A labelled row of buttons in a demo box */
export const addGroup = (box: HTMLElement, label: string) => {
  const group = document.createElement('div');
  group.className = 'hubComponentDemoGroup';
  const heading = document.createElement('p');
  heading.textContent = label;
  group.append(heading);
  box.append(group);
  return group;
};

/** A Hub button (the controls are the page's; what they open is the kit's) */
export const addButton = (parent: HTMLElement, label: string, onClick: () => void) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hubButton';
  button.textContent = label;
  button.addEventListener('click', onClick);
  parent.append(button);
  return button;
};

/** A kit root in a demo box (`aekUi`, as an app's own UI outside the HUD), for a piece drawn in
 * the page rather than opened over it */
export const addKitRoot = (box: HTMLElement) => {
  const root = document.createElement('div');
  root.className = 'aekUi hubDemoKitRoot';
  box.append(root);
  kitRoots.push(root);
  return root;
};

/** A window's content: paragraphs in the page's padding */
export const createPanel = (...texts: string[]) => {
  const panel = CMP({ class: 'hubDemoPanel' });
  for (const text of texts) panel.add({ tag: 'p', text });
  return panel;
};

/** A button inside a window's content (a CMP: it goes under the window) */
export const addPanelButton = (panel: CMPHandle, text: string, onClick: () => void) =>
  panel.add({ tag: 'button', class: 'hubButton', text, attr: { type: 'button' }, onClick });
