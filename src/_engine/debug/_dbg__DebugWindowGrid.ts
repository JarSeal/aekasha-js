// A debug edit window's property grid (p806 D10): the windows Phase 3 took off Tweakpane (the
// camera's, the lights', …) build their content with it. The grid with the debugger's label column
// and the fields' context menu, the entity's info rows as monitors (never HTML holding values), and
// a button that says why it's disabled.
import { CMP } from '../ui/core/CMP';
import type { CMPHandle } from '../ui/core/CMPTypes';
import { createButton } from '../ui/components/Button';
import { createFieldContextMenu } from '../ui/forms/FieldContextMenu';
import { createPropertyGrid, type PropertyGrid } from '../ui/forms/PropertyGrid';
import {
  addPropertyGridItems,
  type PropertyGridCustomItem,
  type PropertyGridFieldItem,
  type PropertyGridItem,
} from '../ui/forms/PropertyGridItems';
import styles from './DebugWindowGrid.module.scss';

/** The label column's width: the kit's 40 %, not the drawer's 50 % (p806 Phase 0): a window is
 * narrower than the drawer (320 px by default), and at 50 % a vector's boxes cut its values */
const LABEL_WIDTH = 40;

/** What {@link createDebugWindowGrid} builds a window's content from. */
export type DebugWindowGridProps = {
  /** The grid's items, in order. */
  items: readonly PropertyGridItem[];
  /** Each folder's open state by its id: the window's saved ones. */
  folderExpanded?: Readonly<Record<string, boolean>>;
  /** A folder opened or shut: what the window saves. */
  onFolderExpandedChange?: (id: string, expanded: boolean) => void;
  /** The content removed (the window closed or rebuilt): what an `await` started by the window
   * checks before it touches the grid. */
  onRemove?: () => void;
};

/** A debug window's content {@link createDebugWindowGrid} made. */
export type DebugWindowGrid = {
  /** The window's content: `remove()` disposes of the grid and its context menu. */
  cmp: CMPHandle;
  /** The grid: `refresh()` re-reads its fields and its `hidden` / `disabled` functions. */
  grid: PropertyGrid;
};

/**
 * Builds a debug window's content: a property grid of `items` with its own scheduler (a window
 * shows while it’s open), the label column at 40 %, and the fields' context menu (Reset, Copy,
 * Paste) over it, removed with it.
 */
export const createDebugWindowGrid = (props: DebugWindowGridProps): DebugWindowGrid => {
  const grid = createPropertyGrid({ labelWidth: LABEL_WIDTH });
  addPropertyGridItems(grid, props.items, {
    folderExpanded: props.folderExpanded,
    onFolderExpandedChange: props.onFolderExpandedChange,
  });
  const menu = createFieldContextMenu({ container: grid.cmp.elem });
  const cmp = CMP({
    class: styles.windowGrid,
    onRemoveCmp: () => {
      menu.cmp.remove();
      props.onRemove?.();
    },
  });
  cmp.add(grid.cmp);
  return { cmp, grid };
};

/** An entity's info rows: what a debug window shows of the entity it edits. */
export type DebugEntityInfo = {
  entityId: number;
  appId?: string;
  /** Its kind (the camera's projection, the light's three type) */
  type: string;
  name?: string;
  description?: string;
};

/** An info row: a fixed text as a monitor (set as text, never HTML), read on a refresh only. */
export const getInfoRowItem = (label: string, value: string): PropertyGridFieldItem => ({
  label,
  value,
  readonly: true,
  interval: 'refresh',
});

/**
 * The entity's info rows after a separator, as monitors (their text set as text, never HTML): its
 * ids and type, and its name and description when it has them.
 */
export const getEntityInfoItems = (info: DebugEntityInfo): PropertyGridItem[] => [
  { type: 'separator' },
  getInfoRowItem('Entity ID', String(info.entityId)),
  getInfoRowItem('App ID', info.appId || 'None'),
  getInfoRowItem('Type', info.type),
  ...(info.name ? [getInfoRowItem('Name', info.name)] : []),
  ...(info.description ? [getInfoRowItem('Description', info.description)] : []),
];

/** What {@link getReasonedButtonItem} makes a button from. */
export type ReasonedButtonProps = {
  /** The button's text. */
  title: string;
  /** Why it's disabled, or null when it isn't: read at the build and on every refresh. */
  getDisabledReason: () => string | null;
  /** A click while it's enabled. */
  onClick: () => void;
};

/**
 * A grid item of a button across both columns, as a button item's, that stays a tab stop while
 * disabled with the reason as its tooltip (the grid's button item has no tooltip): read on every
 * refresh of the grid.
 */
export const getReasonedButtonItem = (props: ReasonedButtonProps): PropertyGridCustomItem => ({
  type: 'custom',
  build: (container) => {
    const button = createButton({
      label: props.title,
      focusableWhenDisabled: true,
      class: styles.rowButton,
      onClick: () => props.onClick(),
    });
    container.add(button.cmp);
    const readReason = () => {
      const reason = props.getDisabledReason();
      button.setDisabled(reason !== null, reason ?? undefined);
    };
    readReason();
    return readReason;
  },
});

/** A note across both columns: a paragraph of text (set as text) that says how the window's (or a
 * tab's) fields behave. A function's text is read at the build and on every refresh. */
export const getNoteItem = (text: string | (() => string)): PropertyGridCustomItem => ({
  type: 'custom',
  build: (container) => {
    if (typeof text === 'string') {
      container.add({ tag: 'p', class: styles.note, text });
      return;
    }
    let shown = text();
    const note = container.add({ tag: 'p', class: styles.note, text: shown });
    return () => {
      const next = text();
      if (next === shown) return;
      shown = next;
      note.updateText(next);
    };
  },
});
