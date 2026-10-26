// The draggable windows' DOM parts that hold no module state (p803 D8): the window's attributes and
// name, its header (the title, the collapse and close buttons with their tooltips, the drag handle
// and the keys), the collapsed state and the content's tab stop. DraggableWindow.ts builds the
// window with them and passes in the header's actions; this module doesn't import it.
import type { CMPHandle } from '../../core/CMPTypes';
import { getSvgIcon } from '../../core/icons/SvgIcon';
import { getFirstFocusable } from '../FocusTrap';
import { DEBUGGER_ROOT_ATTR } from '../OverlayStack';
import { createTooltip } from '../Tooltip';
import { addDragHandle } from './DraggableWindowDrag';
import { STATE_ATTR } from './DraggableWindowGeometry';
import { addHeaderKeys } from './DraggableWindowKeys';
import type {
  DraggableWindowConfig,
  DraggableWindowRuntime,
  WindowEntry,
} from './DraggableWindowTypes';

/**
 * The window's global class (`DraggableWindow.scss`); its parts are `aekWindow__*`.
 * @internal
 */
export const WINDOW_CLASS = 'aekWindow';
const DEFAULT_ARIA_LABEL = 'Window';
const COLLAPSE_TEXT = 'Collapse';
const EXPAND_TEXT = 'Expand';
const CLOSE_TEXT = 'Close';

/** A debug window and its backdrop force the dark theme (p803 D6): the debugger's own panels are
 * dark whatever the system's theme until p806 gives it a theme setting. And they're a debugger
 * root, which an app's modal dialog leaves live (p803 D7). CMP copies it. */
const DEBUG_THEME_ATTR = { 'data-aek-theme': 'dark', [DEBUGGER_ROOT_ATTR]: '' };

/**
 * A debug window's backdrop's CMP props for the forced dark theme (p803 D6), else none.
 * @internal
 */
export const getThemeAttr = (config: DraggableWindowConfig) =>
  config.isDebugWindow ? { attr: DEBUG_THEME_ATTR } : {};

const getResizableAttr = ({ disableHoriResize, disableVertResize }: DraggableWindowConfig) =>
  disableHoriResize
    ? disableVertResize
      ? null
      : 'vertical'
    : disableVertResize
      ? 'horizontal'
      : 'both';

/**
 * The window element's attributes that its structure fixes (a change remounts it): its role,
 * whether it moves and resizes (p803 D5: states are attributes), the debug theme.
 * @internal
 */
export const getWindowAttr = (config: DraggableWindowConfig) => {
  const resizable = getResizableAttr(config);
  return {
    role: 'dialog',
    ...(config.disableDragging ? {} : { 'data-draggable': '' }),
    ...(resizable ? { 'data-resizable': resizable } : {}),
    ...(config.isDebugWindow ? DEBUG_THEME_ATTR : {}),
  };
};

/** Whether the header takes the focus: it has a key to act on (a move, a resize, a collapse) */
const isHeaderFocusable = (config: DraggableWindowConfig) =>
  !config.disableDragging ||
  !config.disableVertResize ||
  !config.disableHoriResize ||
  !config.disableCollapseBtn;

/** What the header's keys do, read to a screen reader as the header's description */
const getKeysHelp = (config: DraggableWindowConfig) => {
  const canResize = !config.disableVertResize || !config.disableHoriResize;
  return [
    config.disableDragging ? '' : 'Arrow keys move the window.',
    canResize ? 'Alt and arrow keys resize it.' : '',
    !config.disableDragging || canResize ? 'Shift takes bigger steps.' : '',
    config.disableCollapseBtn ? '' : 'Enter collapses or expands it.',
  ]
    .filter(Boolean)
    .join(' ');
};

/**
 * The id of a window's part that an ARIA attribute names.
 * @internal
 */
export const getPartId = (id: string, part: 'title' | 'content' | 'keys') => `${id}__${part}`;

/**
 * Names the window and its collapse button (p803 D8): by the title, else by `ariaLabel` (default
 * 'Window').
 * @internal
 */
export const writeWindowName = ({ config, runtime }: WindowEntry) => {
  const elems = [runtime.windowCMP?.elem, runtime.collapseBtnCMP?.elem];
  for (const elem of elems) {
    if (!elem) continue;
    if (config.title) {
      elem.setAttribute('aria-labelledby', getPartId(config.id, 'title'));
      elem.removeAttribute('aria-label');
    } else {
      elem.setAttribute('aria-label', config.ariaLabel || DEFAULT_ARIA_LABEL);
      elem.removeAttribute('aria-labelledby');
    }
  }
};

/**
 * Writes the collapsed state: the window's `data-state`, the collapse button's `aria-expanded`
 * and its tooltip's text.
 * @internal
 */
export const writeCollapsedState = ({ config, runtime }: WindowEntry) => {
  runtime.windowCMP?.elem.setAttribute(STATE_ATTR, config.isCollapsed ? 'collapsed' : 'expanded');
  runtime.collapseBtnCMP?.elem.setAttribute('aria-expanded', String(!config.isCollapsed));
  runtime.collapseTooltip?.setText(config.isCollapsed ? EXPAND_TEXT : COLLAPSE_TEXT);
};

/**
 * Makes a content with nothing focusable in it a tab stop itself, so its scroll has a keyboard
 * path (axe's `scrollable-region-focusable`); one with a control leaves that to the control. Read
 * at the mount and at a rebuild.
 * @internal
 */
export const syncContentTabStop = ({ contentWrapperCMP }: DraggableWindowRuntime) => {
  const elem = contentWrapperCMP?.elem;
  if (!elem) return;
  if (getFirstFocusable(elem)) {
    elem.removeAttribute('tabindex');
  } else {
    elem.setAttribute('tabindex', '0');
  }
};

/**
 * The header's title: the icon (if any) and the title text. A title without text is hidden from
 * assistive tech (an empty heading): the window is named by its `ariaLabel` then.
 * @internal
 */
export const renderTitle = (titleCMP: CMPHandle, config: DraggableWindowConfig) => {
  titleCMP.updateText(config.title);
  if (config.icon) titleCMP.elem.insertAdjacentHTML('afterbegin', getSvgIcon(config.icon));
  if (config.title) {
    titleCMP.elem.removeAttribute('aria-hidden');
  } else {
    titleCMP.elem.setAttribute('aria-hidden', 'true');
  }
};

/** Adds a header button with its tooltip */
const addHeaderButton = (
  { runtime }: WindowEntry,
  part: 'collapse' | 'close',
  attr: { [key: string]: string },
  onClick: () => void
) => {
  const button = runtime.headerCMP!.add({
    tag: 'button',
    class: ['aekWindow__button', `aekWindow__${part}`],
    attr: { type: 'button', ...attr },
    onClick: (e) => {
      e.preventDefault();
      onClick();
    },
  });
  const tooltip = createTooltip({
    anchor: button.elem,
    text: part === 'close' ? CLOSE_TEXT : COLLAPSE_TEXT,
    side: 'bottom',
  });
  (runtime.tooltips ??= []).push(tooltip);
  return { button, tooltip };
};

/**
 * What a window's header does, DraggableWindow.ts': a finished drag or key move, the collapse,
 * the close and the double-click's fit.
 * @internal
 */
export type HeaderActions = {
  onCommit: (entry: WindowEntry) => void;
  onToggleCollapse: () => void;
  onClose: () => void;
  onFit: () => void;
};

/**
 * Builds a mounted window's header (p803 D8): the title (its tooltip shows it whole when it's
 * cut), the collapse button (`aria-expanded`, `aria-controls`) and the close button with their
 * tooltips, the drag handle and the double-click fit. With a key to act on, the header is a tab
 * stop (`role="group"`, "movable window" when it moves, the keys described) with
 * `DraggableWindowKeys.ts`' keys.
 * @internal
 */
export const buildHeader = (entry: WindowEntry, actions: HeaderActions) => {
  const { config, runtime } = entry;
  const { id } = config;
  const isFocusable = isHeaderFocusable(config);
  const headerCMP = runtime.windowCMP!.add({
    class: 'aekWindow__header',
    ...(isFocusable
      ? {
          attr: {
            role: 'group',
            tabindex: '0',
            'aria-labelledby': getPartId(id, 'title'),
            'aria-describedby': getPartId(id, 'keys'),
            ...(config.disableDragging ? {} : { 'aria-roledescription': 'movable window' }),
          },
        }
      : {}),
  });
  runtime.headerCMP = headerCMP;
  runtime.titleCMP = headerCMP.add({
    tag: 'h3',
    class: 'aekWindow__title',
    text: config.title,
    attr: { id: getPartId(id, 'title') },
  });
  renderTitle(runtime.titleCMP, config);
  runtime.titleTooltip = createTooltip({
    anchor: runtime.titleCMP.elem,
    text: config.title,
    side: 'bottom',
    onlyWhenTruncated: true,
  });
  (runtime.tooltips ??= []).push(runtime.titleTooltip);
  if (isFocusable) {
    headerCMP.add({
      tag: 'span',
      text: getKeysHelp(config),
      attr: { id: getPartId(id, 'keys'), hidden: '' },
    });
    addHeaderKeys(entry, headerCMP.elem, actions);
  }
  if (!config.disableCollapseBtn) {
    const collapse = addHeaderButton(
      entry,
      'collapse',
      { 'aria-controls': getPartId(id, 'content') },
      actions.onToggleCollapse
    );
    runtime.collapseBtnCMP = collapse.button;
    runtime.collapseTooltip = collapse.tooltip;
  }
  if (!config.disableCloseBtn) {
    addHeaderButton(entry, 'close', { 'aria-label': CLOSE_TEXT }, actions.onClose);
  }
  addDragHandle(entry, headerCMP.elem, 'MOVE', actions.onCommit);
  headerCMP.elem.addEventListener('dblclick', (e) => {
    if (!(e.target as Element).closest('button')) actions.onFit();
  });
};
