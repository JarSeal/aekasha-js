// The test bridge's debugger methods (p806 D14): what the scene runner's `debugger` configuration
// drives the drawer, the profiler window and the debug windows through. It names things by tab
// id, list row and control name, never by the debugger's classes, so its scripts outlive the port
// from Tweakpane to the UI kit. Debug env only (the drawer and the profiler are lazy imports: the
// bridge also loads in prod test mode, where neither may exist).

import { IS_DEBUG_ENV } from '../kernel/config/Config';
import {
  closeDraggableWindow,
  getDraggableWindow,
  getOpenDraggableWindowIds,
} from '../ui/overlays/windows/DraggableWindow';
import { DEBUGGER_ROOT_ATTR } from '../ui/overlays/OverlayStack';
import { PROFILER_WINDOW_ID } from './Profiler';
import type { AekTestBridge, TestBridgeDebuggerRoot } from './TestBridge';

/** The mark the runner finds a root by: `[data-aek-test-root="<root>"]` */
const ROOT_ATTR = 'data-aek-test-root';
/** What can take the focus and act: the native controls and the ARIA widgets the kit draws */
const CONTROL_SELECTOR = [
  'button',
  'input',
  'select',
  'textarea',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
  '[role="button"]',
  '[role="slider"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="option"]',
  '[role="tab"]',
].join(', ');
/** How many ancestors up from a label its control may be (Tweakpane's row is two) */
const LABEL_ROW_DEPTH = 4;
const SEEN_NAMES_MAX = 60;

let windowMarkCount = 0;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const afterTwoFrames = async () => {
  await nextFrame();
  await nextFrame();
};

const missing = (reason: string) => ({ status: 'MISSING' as const, reason });

const loadDrawer = () => import('./_dbg__DebuggerGUI');
const loadProfiler = () => import('./profiler/_dbg__Profiler');

/** Marks `element` as `root`, the only element with that mark */
const markRoot = (element: Element, root: string) => {
  for (const other of document.querySelectorAll(`[${ROOT_ATTR}="${root}"]`)) {
    if (other !== element) other.removeAttribute(ROOT_ATTR);
  }
  element.setAttribute(ROOT_ATTR, root);
};

const normalize = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

const isShown = (el: Element) =>
  el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

/** A control's name as a user finds it: its ARIA name, its label, its text or its title */
const getControlName = (el: HTMLElement) => {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return normalize(ariaLabel);
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/);
    return normalize(ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' '));
  }
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return normalize(label.textContent);
  }
  const wrappingLabel = el.closest('label');
  if (wrappingLabel) return normalize(wrappingLabel.textContent);
  // A button's text names it before its title (the accessible name's order)
  const text = el.matches('input, select, textarea') ? '' : normalize(el.textContent);
  return text || normalize(el.title);
};

/** The first shown control at or after `label` inside `row` (a titled wrapper holds its own) */
const findControlAfter = (label: Element, row: Element) => {
  for (const control of row.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)) {
    const isAfter =
      label.contains(control) ||
      Boolean(label.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (isAfter && isShown(control)) return control;
  }
  return null;
};

/** The controls an element named `name` labels: its text (a leaf's) or its title, then the first
 * control after it in its row, up to {@link LABEL_ROW_DEPTH} ancestors inside the root */
const findLabelledControls = (root: Element, name: string) => {
  const found: HTMLElement[] = [];
  for (const el of root.querySelectorAll('*')) {
    if (el.matches(CONTROL_SELECTOR) || !isShown(el)) continue;
    const isLabel =
      normalize(el.getAttribute('title')) === name ||
      (el.children.length === 0 && normalize(el.textContent) === name);
    if (!isLabel) continue;
    let row: Element | null = el;
    for (let depth = 0; row && depth <= LABEL_ROW_DEPTH; depth++) {
      const control = findControlAfter(el, row);
      if (control) {
        found.push(control);
        break;
      }
      if (row === root) break;
      row = row.parentElement;
    }
  }
  return found;
};

const getDebuggerTabOrder: AekTestBridge['getDebuggerTabOrder'] = async () => {
  if (!IS_DEBUG_ENV) return { DRAWER: [], PROFILER: [] };
  const [drawer, profiler] = await Promise.all([loadDrawer(), loadProfiler()]);
  return {
    DRAWER: drawer._getDrawerTestInfo().tabIds,
    PROFILER: profiler._getProfilerTestInfo().tabIds,
  };
};

const openDrawerTab = async (id: string): Promise<TestBridgeDebuggerRoot> => {
  const drawer = await loadDrawer();
  if (!drawer._getDrawerTestInfo().tabIds.includes(id)) return missing(`no drawer tab "${id}"`);
  drawer._openDebuggerTab(id);
  await afterTwoFrames();
  const info = drawer._getDrawerTestInfo();
  if (!info.element || info.mountedId !== id) {
    return missing(`the drawer didn't mount the tab "${id}"`);
  }
  markRoot(info.element, 'drawer');
  return { status: 'OPEN', root: 'drawer', title: id };
};

const openProfilerTab = async (id: string): Promise<TestBridgeDebuggerRoot> => {
  const profiler = await loadProfiler();
  if (!profiler._getProfilerTestInfo().tabIds.includes(id))
    return missing(`no profiler tab "${id}"`);
  profiler._openProfilerTab(id);
  await afterTwoFrames();
  const element = getDraggableWindow(PROFILER_WINDOW_ID)?.windowCMP?.elem;
  if (!element || profiler._getProfilerTestInfo().mountedId !== id) {
    return missing(`the profiler window didn't mount the tab "${id}"`);
  }
  markRoot(element, 'profiler');
  return { status: 'OPEN', root: 'profiler', title: id };
};

const openDebuggerTab: AekTestBridge['openDebuggerTab'] = async ({ host, id }) => {
  if (!IS_DEBUG_ENV) return missing('the debugger runs in the debug env only');
  return host === 'DRAWER' ? openDrawerTab(id) : openProfilerTab(id);
};

const openDebuggerListRow: AekTestBridge['openDebuggerListRow'] = async ({ index }) => {
  if (!IS_DEBUG_ENV) return missing('the debugger runs in the debug env only');
  const { contentElement, mountedId } = (await loadDrawer())._getDrawerTestInfo();
  if (!contentElement || !mountedId) return missing('no drawer tab is open');
  const { _clickDebuggerListRow } = await import('./_dbg__DebuggerList');
  const itemId = _clickDebuggerListRow(contentElement, index);
  if (itemId === null) return missing(`the tab "${mountedId}" has no list row ${index} to click`);
  await afterTwoFrames();
  return { status: 'CLICKED', itemId };
};

const focusDebuggerControl: AekTestBridge['focusDebuggerControl'] = async ({ root, name, nth }) => {
  const roots = [
    ...document.querySelectorAll(root ? `[${ROOT_ATTR}="${root}"]` : `[${DEBUGGER_ROOT_ATTR}]`),
  ];
  const seen: string[] = [];
  const named: HTMLElement[] = [];
  for (const rootEl of roots) {
    for (const control of rootEl.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)) {
      if (!isShown(control)) continue;
      const controlName = getControlName(control);
      if (controlName === name) named.push(control);
      else if (controlName && seen.length < SEEN_NAMES_MAX) seen.push(controlName);
    }
  }
  const matches = named.length
    ? named
    : roots.flatMap((rootEl) => findLabelledControls(rootEl, name));
  const control = [...new Set(matches)][nth ?? 0];
  if (!control) return { status: 'MISSING', seen };
  control.focus();
  await nextFrame();
  return { status: 'FOCUSED', tag: control.tagName.toLowerCase() };
};

const markDebuggerWindows: AekTestBridge['markDebuggerWindows'] = () => {
  const marked: TestBridgeDebuggerRoot[] = [];
  for (const id of getOpenDraggableWindowIds()) {
    const win = getDraggableWindow(id);
    const element = win?.windowCMP?.elem;
    if (!win || !element || element.hasAttribute(ROOT_ATTR)) continue;
    const root = `window-${++windowMarkCount}`;
    element.setAttribute(ROOT_ATTR, root);
    marked.push({ status: 'OPEN', root, title: win.title || id });
  }
  return marked;
};

const closeDebuggerWindows: AekTestBridge['closeDebuggerWindows'] = async () => {
  for (const id of getOpenDraggableWindowIds().reverse()) closeDraggableWindow(id);
  await afterTwoFrames();
};

/** The bridge's debugger methods, for `_installTestBridge` */
export const testBridgeDebugger = {
  getDebuggerTabOrder,
  openDebuggerTab,
  openDebuggerListRow,
  focusDebuggerControl,
  markDebuggerWindows,
  closeDebuggerWindows,
} satisfies Partial<AekTestBridge>;
