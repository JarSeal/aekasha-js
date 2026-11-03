import type { CMPAttr, CMPHandle } from '../../core/CMPTypes';
import type { InputGlyphFamily } from '../../components/GamepadGlyphs';
import { CMP, classes } from '../../core/CMP';
import { announce } from '../../components/Announcer';
import { createButton } from '../../components/Button';
import { createInputGlyph, type InputGlyphInput } from '../../components/InputGlyph';
import { swallowNextKeyUp } from '../../overlays/OverlayStack';
import {
  getBindingInputs,
  getPromptDevice,
  onPromptDeviceChange,
  type InputPromptBinding,
} from '../InputPrompt';
import {
  applySlotInput,
  canSlotTake,
  findSlotConflict,
  getCellSlots,
  getSlotInput,
  getSlotInputs,
  isSameBindings,
  replaceSlotInput,
  type BindSlot,
  type CapturedInput,
  type ControlsActionType,
  type ControlsColumn,
  type SlotConflict,
} from './ControlsBindings';
import { startCapture, type CaptureCancel } from './ControlsCapture';
import './ControlsPage.scss';
import '../../styles/kit.scss';

export type { ControlsActionType, ControlsColumn } from './ControlsBindings';

/** One binding of an action, in the action map's shapes (`map.getBindings(id)` as it is). */
export type ControlsBinding = InputPromptBinding;

/**
 * One action of a {@link ControlsPage}: a row, from the action map's definition and bindings.
 * @template B the bindings' type (the action map's `ActionBinding`), which `onRebind` gives back
 */
export type ControlsAction<B extends ControlsBinding = ControlsBinding> = {
  /** Its id in the map: `ControlsRebind.action`. */
  id: string;
  /** Its name in the row ('Jump'; the map's `actions[id].name`). */
  name: string;
  /** A line under the name. */
  description?: string;
  /** Its type (`actions[id].type`, default 'BUTTON'): a column with no binding gets an empty
   * slot only for a button. */
  type?: ControlsActionType;
  /** Its bindings now (`map.getBindings(id)`). */
  bindings: readonly B[];
  /** What "Reset to defaults" puts back (default: `bindings` at creation). */
  defaults?: readonly B[];
  /** The actions whose inputs may collide (default: one group for all): a menu map's actions
   * apart from gameplay's, so Enter in both is no conflict. */
  group?: string;
  /** Shown but not rebindable (Pause on Escape). Default true. */
  rebindable?: boolean;
};

/** A rebinding {@link ControlsPageProps.onRebind} reports: an action's whole new bindings. */
export type ControlsRebind<B extends ControlsBinding = ControlsBinding> = {
  /** The action's id. */
  action: string;
  /** Its new bindings, a new list: `map.setBindings(action, bindings)`. */
  bindings: readonly B[];
  /** The column rebound (null for a reset). */
  column: ControlsColumn | null;
  /** A capture, the other side of a swap, or "Reset to defaults". */
  reason: 'rebind' | 'swap' | 'reset';
};

/** The controls page's texts (each has a default: an app's language replaces them). */
export type ControlsPageTexts = {
  /** The first column's header ('Action'). */
  actionHeader: string;
  /** The keyboard and mouse column's header ('Keyboard and mouse'). */
  keyboardHeader: string;
  /** The gamepad column's header ('Gamepad'). */
  gamepadHeader: string;
  /** An empty slot's text ('Unbound'). */
  unbound: string;
  /** A keyboard slot's text while capturing ('Press a key'). */
  pressKey: string;
  /** A gamepad slot's text while capturing ('Press a button'). */
  pressButton: string;
  /** What a capture's start announces ('Press a key or mouse button for Jump. Escape cancels.'). */
  capturing: (action: string, column: ControlsColumn) => string;
  /** A slot's part ('Up', 'Down', 'Left', 'Right', 'Negative', 'Positive'). */
  parts: Readonly<Record<'up' | 'down' | 'left' | 'right' | 'negative' | 'positive', string>>;
  /** The conflict's text after the input's glyph ('Also bound to Interact.'). */
  conflict: (other: string) => string;
  /** The conflict's swap ('Swap'). */
  swap: string;
  /** The conflict's keep both ('Keep both'). */
  keepBoth: string;
  /** The conflict's cancel ('Cancel'). */
  cancel: string;
  /** The reset button ('Reset to defaults'). */
  reset: string;
  /** What a rebind announces ('Jump: F'). */
  rebound: (action: string, input: string) => string;
  /** What a capture ended without an input announces ('Jump not changed'). */
  notChanged: (action: string) => string;
  /** What the reset button announces ('Controls reset to defaults'). */
  resetDone: string;
};

const DEFAULT_TEXTS: ControlsPageTexts = {
  actionHeader: 'Action',
  keyboardHeader: 'Keyboard and mouse',
  gamepadHeader: 'Gamepad',
  unbound: 'Unbound',
  pressKey: 'Press a key',
  pressButton: 'Press a button',
  capturing: (action, column) =>
    `Press ${column === 'GAMEPAD' ? 'a gamepad button' : 'a key or mouse button'} for ${action}. Escape cancels.`,
  parts: {
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    negative: 'Negative',
    positive: 'Positive',
  },
  conflict: (other) => `Also bound to ${other}.`,
  swap: 'Swap',
  keepBoth: 'Keep both',
  cancel: 'Cancel',
  reset: 'Reset to defaults',
  rebound: (action, input) => `${action}: ${input}`,
  notChanged: (action) => `${action} not changed`,
  resetDone: 'Controls reset to defaults',
};

/**
 * What {@link createControlsPage} shows.
 * @template B the bindings' type (the action map's `ActionBinding`)
 */
export type ControlsPageProps<B extends ControlsBinding = ControlsBinding> = {
  /** The actions, a row each, in order. */
  actions: readonly ControlsAction<B>[];
  /** An action's bindings changed (a capture, a swap's other side, a reset): the app applies them
   * (`map.setBindings`) and persists them. The page shows them already. */
  onRebind: (change: ControlsRebind<B>) => void;
  /** The columns, in order (default both). */
  columns?: readonly ControlsColumn[];
  /** The table's name (default 'Controls'). */
  label?: string;
  /** The gamepad's family, whose labels the gamepad column shows. Default: the input prompts'
   * (`setPromptDevice`), followed as it changes; `GENERIC` before a gamepad was seen. */
  family?: InputGlyphFamily;
  /** A capture ends after this long without an input (default 8000 ms; 0: never). A gamepad has
   * no Escape that isn't a button to bind. */
  captureTimeoutMs?: number;
  /** Shows "Reset to defaults" under the table (default true; false in a settings menu, whose
   * "Reset page" calls `reset()`). */
  showReset?: boolean;
  /** A capture started or ended: the app turns its menu map off meanwhile (a gamepad's press goes
   * to the action maps too, which nothing on the page can stop). */
  onCaptureChange?: (capturing: boolean) => void;
  /** Its texts, each over the default. */
  texts?: Partial<ControlsPageTexts>;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/**
 * A controls page {@link createControlsPage} made: its CMP and its controls.
 * @template B the bindings' type (the action map's `ActionBinding`)
 */
export type ControlsPage<B extends ControlsBinding = ControlsBinding> = {
  /** Its element (`.aekControlsPage`): add it where it goes (a settings menu page's `content`). */
  cmp: CMPHandle;
  /** Puts every action's defaults back, reporting each one that changes. */
  reset: () => void;
  /** Replaces the actions (another map). */
  setActions: (actions: readonly ControlsAction<B>[]) => void;
  /** Shows an action's bindings changed elsewhere (a loaded save); reports nothing. */
  setBindings: (actionId: string, bindings: readonly B[]) => void;
  /** An action's bindings as the page shows them (null: no such action) */
  getBindings: (actionId: string) => readonly B[] | null;
  /** Whether it's waiting for an input */
  isCapturing: () => boolean;
  /** Ends a capture or a conflict's question without a change. */
  cancelCapture: () => void;
  /** Shows the gamepad column with a family's labels (null: follow the input prompts'). */
  setFamily: (family: InputGlyphFamily | null) => void;
};

/** One row's action and state */
type RowEntry<B extends ControlsBinding> = {
  action: ControlsAction<B>;
  bindings: readonly B[];
  defaults: readonly B[];
  rowCmp: CMPHandle | null;
  nameId: string;
};

/** A slot the page is capturing for, or asking about */
type Pending = {
  rowIndex: number;
  column: ControlsColumn;
  slot: BindSlot;
  slotIndex: number;
  stop: (() => void) | null;
  conflict: (SlotConflict & { input: CapturedInput; cmp: CMPHandle }) | null;
};

const COLUMNS: readonly ControlsColumn[] = ['KEYBOARD_MOUSE', 'GAMEPAD'];

const createPart = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string) => {
  const elem = document.createElement(tag);
  elem.className = className;
  return elem;
};

/** The spoken names of the glyphs under an element ('Control S') */
const readGlyphNames = (elem: Element) =>
  [...elem.querySelectorAll('.aekInputGlyph')]
    .map((glyph) => glyph.getAttribute('aria-label') ?? '')
    .join(' ');

/**
 * Creates a controls page (p808 D9): an action map's actions as rows, each with its binding per
 * device as glyphs, rebound by capturing the next key, mouse button or gamepad button. The page
 * reports each action's new bindings (`onRebind`) and its owner applies and persists them.
 * - Parts: `.aekControlsPage` > `__table` (a `table`: `__columnHeader`s, a `__row` per action,
 *   `data-action`, its `__action` row header with `__actionName` and `__actionDescription`, a
 *   `__cell` per column, `data-column`) holding its `__bind` buttons (`data-part` for an axis' or a
 *   composite's key, `data-empty`, `data-capturing`; `__glyphs` or `__text`, a hidden `__partLabel`),
 *   `__fixed` (a binding shown, not rebindable: a stick), `__none`; a `__conflictRow` under a row
 *   with `__conflict` (`__conflictText` with the input's glyph, `__swap`, `__keepBoth`,
 *   `__conflictCancel`); `__footer` with `__reset`.
 * - Custom properties (read on any ancestor): `--aek-controls-page-capture-color` (a capturing
 *   slot's ring, default the accent), the glyphs' `--aek-input-glyph-size`.
 * - Capturing (a slot's click, Enter, Space, or a gamepad's `SOUTH` through the app's map): the
 *   next key or mouse button (the keyboard column; Escape cancels and can't be bound) or gamepad
 *   button (the gamepad column) is taken in the capture phase on the window and stopped there, so
 *   no action map, overlay or game control sees it; a press of the other device, the window's
 *   blur and `captureTimeoutMs` cancel. A part of an axis or a composite (W A S D) takes a key
 *   only. An input another slot of the action's `group` has asks Swap (the other gets the old
 *   input), Keep both or Cancel; the focus leaving the question cancels it.
 * - Keys: Tab and the arrows' spatial navigation between its buttons (a game menu's); Enter and
 *   Space on its buttons are kept from the action maps.
 * - Assistive tech: a table named by `label`, a row header per action; a slot button named by its
 *   action, its column, its part and its input ('Jump Keyboard and mouse Space'); a capture's
 *   start, its result and a reset are announced politely; the conflict is a group named by its
 *   text, the focus on Swap.
 * - Motion: a capturing slot's ring pulses (still under reduced motion).
 * @example
 * ```ts
 * import { createActionMap, type ActionBinding, type ActionMap } from 'aekasha';
 * import { createControlsPage } from 'aekasha/ui';
 *
 * const map = createActionMap({
 *   id: 'play',
 *   actions: { jump: { type: 'BUTTON', name: 'Jump' } },
 *   bindings: {
 *     jump: [
 *       { device: 'KEYBOARD', keys: [' '] },
 *       { device: 'GAMEPAD', button: 'SOUTH' },
 *     ],
 *   },
 * });
 * // Any map is an `ActionMap`: its actions by a string id, their bindings `ActionBinding`s
 * const play: ActionMap = map;
 * const controls = createControlsPage<ActionBinding>({
 *   actions: Object.entries(play.actions).map(([id, def]) => ({
 *     id,
 *     name: def.name ?? id,
 *     type: def.type,
 *     bindings: play.getBindings(id),
 *   })),
 *   onRebind: ({ action, bindings }) => {
 *     play.setBindings(action, bindings);
 *     localStorage.setItem(`bindings.${action}`, JSON.stringify(bindings));
 *   },
 * });
 * ```
 */
export const createControlsPage = <B extends ControlsBinding = ControlsBinding>(
  props: ControlsPageProps<B>
): ControlsPage<B> => {
  const texts: ControlsPageTexts = { ...DEFAULT_TEXTS, ...props.texts };
  const columns = props.columns ?? COLUMNS;
  const timeoutMs = props.captureTimeoutMs ?? 8000;
  let fixedFamily: InputGlyphFamily | null = props.family ?? null;
  let promptFamily: InputGlyphFamily = getPromptDevice().family ?? 'GENERIC';
  let rows: RowEntry<B>[] = [];
  let pending: Pending | null = null;
  let rowCount = 0;
  let isRemoved = false;

  const getFamily = () => fixedFamily ?? promptFamily;

  const removePromptListener = onPromptDeviceChange(() => {
    const device = getPromptDevice();
    if (device.device !== 'GAMEPAD' || !device.family || device.family === promptFamily) return;
    promptFamily = device.family;
    if (!fixedFamily) redrawAll();
  });

  /** Enter and Space click a button themselves: kept from the action maps only */
  const onKeyDown = (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key !== 'Enter' && ke.key !== ' ') return;
    if ((ke.target as Element).tagName !== 'BUTTON') return;
    ke.stopPropagation();
    swallowNextKeyUp(ke.key);
  };

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekControlsPage', props.class),
    attr: props.attr,
    listeners: [{ type: 'keydown', fn: onKeyDown, options: { capture: false } }],
    onRemoveCmp: () => {
      // Its rows are gone already: nothing is drawn again
      isRemoved = true;
      endPending(false);
      removePromptListener();
    },
  });

  const tableCmp = cmp.add({ tag: 'table', class: 'aekControlsPage__table' });
  const table = tableCmp.elem;
  table.setAttribute('aria-label', props.label ?? 'Controls');
  const head = table.appendChild(createPart('thead', 'aekControlsPage__head'));
  const headRow = head.appendChild(document.createElement('tr'));
  const columnIds = new Map<ControlsColumn, string>();
  const actionHeader = headRow.appendChild(createPart('th', 'aekControlsPage__columnHeader'));
  actionHeader.scope = 'col';
  actionHeader.textContent = texts.actionHeader;
  for (const column of columns) {
    const th = headRow.appendChild(createPart('th', 'aekControlsPage__columnHeader'));
    th.scope = 'col';
    th.id = `${cmp.id}-${column.toLowerCase()}`;
    th.setAttribute('data-column', column);
    th.textContent = column === 'GAMEPAD' ? texts.gamepadHeader : texts.keyboardHeader;
    columnIds.set(column, th.id);
  }
  const bodyCmp = tableCmp.add({ tag: 'tbody', class: 'aekControlsPage__rows' });

  /** Every rebindable group's rows with their bindings, the conflict search's candidates */
  const getGroupRows = (rowIndex: number) => {
    const group = rows[rowIndex].action.group;
    return rows
      .map((row, index) => ({ index, bindings: row.bindings as readonly ControlsBinding[] }))
      .filter((_, index) => rows[index].action.group === group);
  };

  const getActionLabel = (row: RowEntry<B>, slot: BindSlot) =>
    slot.part && slot.part !== 'keys'
      ? `${row.action.name}, ${texts.parts[slot.part]}`
      : row.action.name;

  /** Fills a slot button: its input's glyphs, or a text (empty, capturing) */
  const fillSlot = (button: CMPHandle, inputs: InputGlyphInput[], text: string | null) => {
    const glyphs = button.add({ tag: 'span', class: 'aekControlsPage__glyphs' });
    if (text !== null) {
      glyphs.elem.className = 'aekControlsPage__text';
      glyphs.elem.textContent = text;
      return;
    }
    for (const input of inputs) {
      glyphs.add(createInputGlyph({ input, family: getFamily() }).cmp);
    }
  };

  const createSlotButton = (
    rowIndex: number,
    column: ControlsColumn,
    slot: BindSlot,
    slotIndex: number
  ) => {
    const row = rows[rowIndex];
    const button = CMP({
      tag: 'button',
      class: 'aekControlsPage__bind',
      attr: { type: 'button', 'data-slot': String(slotIndex) },
      listeners: [
        {
          type: 'click',
          fn: () => startSlotCapture(rowIndex, column, slot, slotIndex),
          options: { capture: false },
        },
      ],
    });
    const elem = button.elem;
    const labelIds = [row.nameId, columnIds.get(column) ?? ''];
    if (slot.part && slot.part !== 'keys') {
      elem.setAttribute('data-part', slot.part);
      const partLabel = createPart('span', 'aekControlsPage__partLabel');
      partLabel.hidden = true;
      partLabel.id = `${elem.id || button.id}-part`;
      partLabel.textContent = texts.parts[slot.part];
      elem.append(partLabel);
      labelIds.push(partLabel.id);
    }
    elem.id = button.id;
    labelIds.push(button.id);
    elem.setAttribute('aria-labelledby', labelIds.join(' '));
    const isCapturing =
      pending?.rowIndex === rowIndex &&
      pending.column === column &&
      pending.slotIndex === slotIndex &&
      pending.stop !== null;
    const inputs = getSlotInputs(row.bindings, slot);
    if (isCapturing) {
      elem.setAttribute('data-capturing', '');
      fillSlot(button, [], column === 'GAMEPAD' ? texts.pressButton : texts.pressKey);
    } else if (!inputs.length) {
      elem.setAttribute('data-empty', '');
      fillSlot(button, [], texts.unbound);
    } else {
      fillSlot(button, inputs, null);
    }
    return button;
  };

  const createCell = (rowIndex: number, column: ControlsColumn) => {
    const row = rows[rowIndex];
    const cell = CMP({
      tag: 'td',
      class: 'aekControlsPage__cell',
      attr: { 'data-column': column },
    });
    const { slots, fixed } = getCellSlots(row.bindings, column, row.action.type);
    if (row.action.rebindable === false || fixed !== -1) {
      // Shown as it is: a locked action's, a stick's
      const inputs =
        fixed !== -1
          ? getBindingInputs(row.bindings[fixed])
          : slots.flatMap((slot) => getSlotInputs(row.bindings, slot));
      const shown = cell.add({ tag: 'span', class: 'aekControlsPage__fixed' });
      if (!inputs.length) shown.elem.textContent = texts.unbound;
      for (const input of inputs) {
        shown.add(createInputGlyph({ input, family: getFamily() }).cmp);
      }
      return cell;
    }
    if (!slots.length) {
      const none = cell.add({ tag: 'span', class: 'aekControlsPage__none' });
      none.elem.textContent = texts.unbound;
      return cell;
    }
    slots.forEach((slot, slotIndex) =>
      cell.add(createSlotButton(rowIndex, column, slot, slotIndex))
    );
    return cell;
  };

  const createRow = (rowIndex: number) => {
    const row = rows[rowIndex];
    const rowCmp = CMP({
      tag: 'tr',
      class: 'aekControlsPage__row',
      attr: { 'data-action': row.action.id },
    });
    const th = createPart('th', 'aekControlsPage__action');
    th.scope = 'row';
    const name = th.appendChild(createPart('span', 'aekControlsPage__actionName'));
    name.id = row.nameId;
    name.textContent = row.action.name;
    if (row.action.description) {
      const description = th.appendChild(createPart('span', 'aekControlsPage__actionDescription'));
      description.textContent = row.action.description;
    }
    rowCmp.elem.append(th);
    for (const column of columns) rowCmp.add(createCell(rowIndex, column));
    return rowCmp;
  };

  /** The slot button that has the focus: its row, column and index */
  const getFocusedSlot = () => {
    const active = document.activeElement;
    const button = active?.closest?.('.aekControlsPage__bind');
    if (!button || !cmp.elem.contains(button)) return null;
    const rowElem = button.closest('.aekControlsPage__row');
    const rowIndex = rows.findIndex((row) => row.rowCmp?.elem === rowElem);
    const column = button.closest('.aekControlsPage__cell')?.getAttribute('data-column');
    return { rowIndex, column, slotIndex: button.getAttribute('data-slot') };
  };

  const findSlotButton = (rowIndex: number, column: string, slotIndex: string | number) =>
    rows[rowIndex]?.rowCmp?.elem.querySelector<HTMLElement>(
      `.aekControlsPage__cell[data-column="${column}"] .aekControlsPage__bind[data-slot="${slotIndex}"]`
    ) ?? null;

  /** Builds a row again in its place, the focus kept on the slot it was on */
  const redrawRow = (rowIndex: number) => {
    const row = rows[rowIndex];
    const focused = getFocusedSlot();
    const old = row.rowCmp;
    const next = createRow(rowIndex);
    row.rowCmp = next;
    bodyCmp.add(next);
    if (old) {
      old.elem.before(next.elem);
      old.remove();
    }
    if (focused?.rowIndex === rowIndex && focused.column) {
      findSlotButton(rowIndex, focused.column, focused.slotIndex ?? '0')?.focus();
    }
  };

  function redrawAll() {
    const focused = getFocusedSlot();
    for (const row of rows) {
      row.rowCmp?.remove();
      row.rowCmp = null;
    }
    rows.forEach((row, index) => {
      row.rowCmp = createRow(index);
      bodyCmp.add(row.rowCmp);
    });
    if (focused && focused.rowIndex !== -1 && focused.column) {
      findSlotButton(focused.rowIndex, focused.column, focused.slotIndex ?? '0')?.focus();
    }
  }

  /** Ends a capture or a question; `report` announces "not changed" for its action */
  function endPending(report: boolean) {
    const ended = pending;
    if (!ended) return;
    pending = null;
    ended.stop?.();
    ended.conflict?.cmp.remove();
    if (ended.stop) props.onCaptureChange?.(false);
    if (isRemoved) return;
    redrawRow(ended.rowIndex);
    if (report) {
      const row = rows[ended.rowIndex];
      announce(cmp.elem, texts.notChanged(getActionLabel(row, ended.slot)));
    }
  }

  const focusPendingSlot = (target: Pick<Pending, 'rowIndex' | 'column' | 'slotIndex'>) => {
    findSlotButton(target.rowIndex, target.column, target.slotIndex)?.focus();
  };

  /** Applies new bindings to a row, reports them and redraws it */
  const commitRow = (
    rowIndex: number,
    bindings: readonly ControlsBinding[],
    column: ControlsColumn | null,
    reason: ControlsRebind['reason']
  ) => {
    const row = rows[rowIndex];
    // The same input again: shown, not reported
    const isSame = isSameBindings(row.bindings, bindings);
    row.bindings = bindings as readonly B[];
    redrawRow(rowIndex);
    if (!isSame) props.onRebind({ action: row.action.id, bindings: row.bindings, column, reason });
  };

  /** A rebind's result: the slot's new input announced (`append`: after the one before it, a
   * swap's other side), replacing the capture's prompt if it's still pending */
  const announceSlot = (
    rowIndex: number,
    column: ControlsColumn,
    slot: BindSlot,
    slotIndex: number,
    append = false
  ) => {
    const button = findSlotButton(rowIndex, column, slotIndex);
    const row = rows[rowIndex];
    const names = button ? readGlyphNames(button) : '';
    announce(cmp.elem, texts.rebound(getActionLabel(row, slot), names || texts.unbound), {
      append,
    });
  };

  /** The other slot a swap or keep-both leaves: the question, under the row */
  const askConflict = (at: Pending, conflict: SlotConflict, input: CapturedInput) => {
    const row = rows[at.rowIndex];
    const other = rows[conflict.actionIndex];
    const own = row.bindings as readonly ControlsBinding[];
    const replacement = getSlotInput(own, at.slot);
    const swapped =
      conflict.actionIndex === at.rowIndex
        ? null
        : replaceSlotInput(other.bindings, conflict.slot, input, replacement);
    const next = applySlotInput(own, at.slot, input);
    if (!next) return;

    const conflictCmp = CMP({ tag: 'tr', class: 'aekControlsPage__conflictRow' });
    const td = conflictCmp.add({ tag: 'td', class: 'aekControlsPage__conflictCell' });
    td.elem.setAttribute('colspan', String(columns.length + 1));
    const group = td.add({
      class: 'aekControlsPage__conflict',
      attr: { role: 'group' },
      listeners: [
        {
          // The focus leaving the question (Back in a game menu, a click elsewhere) is Cancel
          type: 'focusout',
          fn: (e: Event) => {
            const nextFocus = (e as FocusEvent).relatedTarget as Node | null;
            if (nextFocus && group.elem.contains(nextFocus)) return;
            resolve('cancel');
          },
          options: { capture: false },
        },
      ],
    });
    const text = group.add({ tag: 'span', class: 'aekControlsPage__conflictText' });
    text.elem.id = `${group.id}-text`;
    group.elem.setAttribute('aria-labelledby', text.elem.id);
    text.add(createInputGlyph({ input, family: getFamily() }).cmp);
    text.elem.append(` ${texts.conflict(getActionLabel(other, conflict.slot))}`);
    const resolve = (choice: 'swap' | 'keep' | 'cancel') => {
      if (pending !== at) return;
      pending = null;
      conflictCmp.remove();
      if (choice === 'cancel') {
        redrawRow(at.rowIndex);
        focusPendingSlot(at);
        announce(cmp.elem, texts.notChanged(getActionLabel(row, at.slot)));
        return;
      }
      commitRow(at.rowIndex, next, at.column, 'rebind');
      if (choice === 'swap' && swapped) commitRow(conflict.actionIndex, swapped, at.column, 'swap');
      focusPendingSlot(at);
      announceSlot(at.rowIndex, at.column, at.slot, at.slotIndex);
      if (choice === 'swap' && swapped) {
        const otherSlots = getCellSlots(swapped, at.column, other.action.type).slots;
        const otherIndex = otherSlots.findIndex(
          (slot) => slot.index === conflict.slot.index && slot.part === conflict.slot.part
        );
        if (otherIndex !== -1) {
          announceSlot(conflict.actionIndex, at.column, conflict.slot, otherIndex, true);
        }
      }
    };
    const actions: [string, string, 'swap' | 'keep' | 'cancel', boolean][] = [
      ['aekControlsPage__swap', texts.swap, 'swap', Boolean(swapped)],
      ['aekControlsPage__keepBoth', texts.keepBoth, 'keep', true],
      ['aekControlsPage__conflictCancel', texts.cancel, 'cancel', true],
    ];
    for (const [className, label, choice, isShown] of actions) {
      if (!isShown) continue;
      group.add(
        createButton({
          label,
          class: className,
          variant: choice === 'swap' || (choice === 'keep' && !swapped) ? 'primary' : 'secondary',
          onClick: () => resolve(choice),
        }).cmp
      );
    }
    at.conflict = { ...conflict, input, cmp: conflictCmp };
    bodyCmp.add(conflictCmp);
    row.rowCmp?.elem.after(conflictCmp.elem);
    group.elem.querySelector<HTMLElement>('button')?.focus();
  };

  function startSlotCapture(
    rowIndex: number,
    column: ControlsColumn,
    slot: BindSlot,
    slotIndex: number
  ) {
    endPending(false);
    const at: Pending = { rowIndex, column, slot, slotIndex, stop: null, conflict: null };
    pending = at;
    const onCancel = (reason: CaptureCancel) => {
      if (pending !== at) return;
      endPending(true);
      // The pointer that cancelled goes where it was pointed; else the focus stays on the slot
      if (reason !== 'pointer' && reason !== 'blur') focusPendingSlot(at);
    };
    at.stop = startCapture({
      column,
      timeoutMs,
      accepts: (input) => canSlotTake(slot, column, input),
      onInput: (input) => {
        if (pending !== at) return;
        at.stop = null;
        props.onCaptureChange?.(false);
        const conflict = findSlotConflict(
          getGroupRows(rowIndex),
          column,
          { actionIndex: rowIndex, slot },
          input
        );
        if (conflict) {
          redrawRow(rowIndex);
          askConflict(at, conflict, input);
          return;
        }
        pending = null;
        const next = applySlotInput(rows[rowIndex].bindings, slot, input);
        if (!next) return;
        commitRow(rowIndex, next, column, 'rebind');
        focusPendingSlot(at);
        announceSlot(rowIndex, column, slot, slotIndex);
      },
      onCancel,
    });
    props.onCaptureChange?.(true);
    redrawRow(rowIndex);
    focusPendingSlot(at);
    announce(cmp.elem, texts.capturing(getActionLabel(rows[rowIndex], slot), column));
  }

  const setActions = (actions: readonly ControlsAction<B>[]) => {
    endPending(false);
    for (const row of rows) row.rowCmp?.remove();
    rows = actions.map((action) => ({
      action,
      bindings: action.bindings,
      defaults: action.defaults ?? action.bindings,
      rowCmp: null,
      nameId: `${cmp.id}-action-${rowCount++}`,
    }));
    redrawAll();
  };

  const reset = () => {
    endPending(false);
    rows.forEach((row, index) => {
      if (isSameBindings(row.bindings, row.defaults)) return;
      commitRow(index, row.defaults, null, 'reset');
    });
  };

  setActions(props.actions);

  if (props.showReset !== false) {
    const footer = cmp.add({ class: 'aekControlsPage__footer' });
    footer.add(
      createButton({
        label: texts.reset,
        class: 'aekControlsPage__reset',
        onClick: () => {
          reset();
          announce(cmp.elem, texts.resetDone);
        },
      }).cmp
    );
  }

  return {
    cmp,
    reset,
    setActions,
    setBindings: (actionId, bindings) => {
      const index = rows.findIndex((row) => row.action.id === actionId);
      if (index === -1) return;
      if (pending?.rowIndex === index) endPending(false);
      rows[index].bindings = bindings;
      redrawRow(index);
    },
    getBindings: (actionId) => rows.find((row) => row.action.id === actionId)?.bindings ?? null,
    isCapturing: () => pending?.stop != null,
    cancelCapture: () => endPending(true),
    setFamily: (family) => {
      fixedFamily = family;
      redrawAll();
    },
  };
};
