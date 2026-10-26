// The property grid's declarative items (p804 D10): a panel described as data, with Tweakpane's
// names, so the debugger's panes (p806) port by renaming. Its own module: making any field from
// a value's shape brings every field's code, which a grid built from handles shouldn't carry.
import type { CMPHandle } from '../core/CMPTypes';
import { CMP } from '../core/CMP';
import { createButton, type ButtonProps } from '../components/Button';
import { createDivider } from '../components/Divider';
import { lwarn } from '../../utils/Logger';
import type { BindingSource, ReadonlyBindingSource } from './binding/Binding';
import { addScheduledBinding, type BindingScheduler } from './binding/BindingScheduler';
import { createCheckbox, createSwitch } from './Checkbox';
import { createColorField, type ColorIntensityProps } from './color/ColorField';
import { isColorObject, isColorString } from './color/ColorValue';
import type { Field, FieldChange, FieldDyn, FieldOptions, FormChild } from './Field';
import { createFolder } from './Folder';
import { createMonitor } from './Monitor';
import { createNumberField } from './NumberField';
import type { PropertyGrid } from './PropertyGrid';
import { createRadioGroup, createSegmentedControl, type SegmentOption } from './RadioGroup';
import { createRangeSlider } from './RangeSlider';
import {
  createSelectField,
  normalizeOptions,
  type SelectOptions,
  type SelectValue,
} from './SelectField';
import { createSlider } from './Slider';
import type { SliderTick } from './SliderTrack';
import { createTextField } from './TextField';

/**
 * The field a property grid item makes (`kind`); without one it's inferred from the bound value.
 */
export type PropertyGridFieldKind =
  | 'number'
  | 'slider'
  | 'range'
  | 'checkbox'
  | 'switch'
  | 'radio'
  | 'segmented'
  | 'select'
  | 'text'
  | 'search'
  | 'color'
  | 'monitor';

/**
 * A field item (p804 D10): a binding (`{ target, key }`, `{ get, set }`, `{ get }` alone for a
 * read-only one, or `{ value }`) with the field's props, in Tweakpane's names where it has them.
 * Without `kind` the field is inferred from the value at creation: `options` make a select, a
 * number a number field (a slider with both `min` and `max`), a boolean a checkbox, a hex colour
 * string (`'#rgb'` to `'#rrggbbaa'`) or an `{ r, g, b, a? }` object a colour field, another
 * string a text field (a 24-bit colour number says `kind: 'color'`, Tweakpane's `view: 'color'`).
 * `readonly: true` makes it a monitor in that field's text.
 */
export type PropertyGridFieldItem = (BindingSource<unknown> | ReadonlyBindingSource<unknown>) &
  Omit<FieldOptions<unknown>, 'onChange' | 'scheduler'> & {
    /** A field (the default: an item with no `type` is a field). */
    type?: 'field';
    /** The field to make, in place of the one inferred from the value. */
    kind?: PropertyGridFieldKind;
    /** A number's or a slider's minimum (a range's track start). */
    min?: number;
    /** A number's or a slider's maximum (a range's track end). */
    max?: number;
    /** The step's grid, and its decimals. */
    step?: number;
    /** The decimals shown, in place of the step's. */
    precision?: number;
    /** An angle wraps at its range instead of clamping. */
    wrap?: boolean;
    /** A unit shown after a number. */
    unit?: string;
    /** The units a typed expression may use, each its factor. */
    expressionUnits?: Readonly<Record<string, number>>;
    /** Writes each valid keystroke of a typed field. */
    live?: boolean;
    /** A slider's or a range's marks. */
    ticks?: number | readonly SliderTick[];
    /** A slider's spin button (default true). */
    showInput?: boolean;
    /** A range's spin buttons at each end. */
    showInputs?: boolean;
    /** The least a range spans. */
    minGap?: number;
    /** A range's bars behind its track. */
    histogram?: readonly number[];
    /** A select's or a radio's options, Tweakpane's forms (`[{ text, value }]`, `{ [text]: value }`)
     * or the kit's (`[{ label, value }]`), or a select's getter of them. */
    options?:
      | SelectOptions<SelectValue>
      | readonly SegmentOption<SelectValue>[]
      | (() => SelectOptions<SelectValue>);
    /** A select's or a text field's text when it has no value. */
    placeholder?: string;
    /** A select's filter field. */
    searchable?: boolean;
    /** A select's filter field's placeholder. */
    searchPlaceholder?: string;
    /** A radio group's direction. */
    orientation?: 'vertical' | 'horizontal';
    /** A segmented control fills its width. */
    fill?: boolean;
    /** A text field's or a monitor's lines (Tweakpane's `multiline`). */
    multiline?: boolean;
    /** The lines' height (Tweakpane's `rows`). */
    rows?: number;
    /** A text field's longest text. */
    maxLength?: number;
    /** A search field's debounced text. */
    onSearch?(text: string): void;
    /** A colour field edits the alpha too. */
    alpha?: boolean;
    /** A colour object's space: `'srgb'` (default) or `'linear'` (a `THREE.Color`'s). */
    colorSpace?: 'srgb' | 'linear';
    /** A colour field's intensity, bound on its own (a light's). */
    intensity?: ColorIntensityProps;
    /** A colour field's swatches. */
    palette?: readonly string[];
    /** A colour field's recent colours (default true). */
    recent?: boolean;
    /** A colour field's eyedropper, where the browser has one (default true). */
    eyeDropper?: boolean;
    /** A checkbox shows as mixed. */
    indeterminate?: boolean;
    /** A switch's or a boolean monitor's text while on. */
    onText?: string;
    /** A switch's or a boolean monitor's text while off. */
    offText?: string;
    /** The value's text (Tweakpane's `format`): a number's, or a monitor's. */
    format?(value: unknown): string;
    /** Each keystroke's text in a typed field. */
    onInput?(text: string): void;
    /** Every write of the value, as the field's `onChange` (p804 D3). */
    onChange?(value: unknown, change: FieldChange<unknown>): void;
    /** Called with the field made (Tweakpane's `onCreate`, with the field's handle). */
    onCreate?(field: Field<unknown>): void;
  };

/** A folder item (p804 D10): a folder of items, its open state the grid's options' by its id. */
export type PropertyGridFolderItem = {
  /** A folder. */
  type: 'folder';
  /** The folder's name. */
  title: string;
  /** Its id in `folderExpanded` and `onFolderExpandedChange` (default: the title path,
   * `'Parent/Child'`). */
  id?: string;
  /** Whether it starts open when `folderExpanded` doesn't say (default true). */
  expanded?: boolean;
  /** Hides it: a value, or a function re-read on every refresh. */
  hidden?: FieldDyn<boolean>;
  /** Its items, in order. */
  items: readonly PropertyGridItem[];
};

/** A button item (p804 D10): the kit's button, with an optional label in the label column. */
export type PropertyGridButtonItem = {
  /** A button. */
  type: 'button';
  /** The button's text. */
  title: string;
  /** A label in the label column, as a field's (the button then sits in the control column). */
  label?: string;
  /** The button's look (default 'secondary'). */
  variant?: ButtonProps['variant'];
  /** Hides it: a value, or a function re-read on every refresh. */
  hidden?: FieldDyn<boolean>;
  /** Disables it: a value, or a function re-read on every refresh. */
  disabled?: FieldDyn<boolean>;
  /** Called on a click. */
  onClick(): void;
};

/** A separator item (p804 D10): the kit's divider across both columns. */
export type PropertyGridSeparatorItem = {
  /** A separator. */
  type: 'separator';
  /** Hides it: a value, or a function re-read on every refresh. */
  hidden?: FieldDyn<boolean>;
};

/**
 * A custom item (p804 D10): anything the items don't cover, built into a CMP across both
 * columns.
 */
export type PropertyGridCustomItem = {
  /** A custom item. */
  type: 'custom';
  /** Adds the item to `container`; the function it returns runs on every refresh. */
  build(container: CMPHandle): void | (() => void);
};

/**
 * One item of a declarative property grid (p804 D10): a field, a folder, a button, a separator or
 * a custom item, Tweakpane's pane items with its names.
 */
export type PropertyGridItem =
  | PropertyGridFieldItem
  | PropertyGridFolderItem
  | PropertyGridButtonItem
  | PropertyGridSeparatorItem
  | PropertyGridCustomItem;

/** How {@link addPropertyGridItems} adds items: the folders' open states. */
export type PropertyGridItemsOptions = {
  /** Each folder's open state by its id (over the item's `expanded`): the owner's saved ones. */
  folderExpanded?: Readonly<Record<string, boolean>>;
  /** A folder opened or shut, by its id: what the owner saves (a grid writes no storage). */
  onFolderExpandedChange?(id: string, expanded: boolean): void;
  /** The title path the folders' ids start from (a titled section's title: `'Title/Folder'`). */
  path?: string;
};

const resolveDyn = (value: FieldDyn<boolean> | undefined) =>
  typeof value === 'function' ? value() : Boolean(value);

/** The value at creation, which the kind is inferred from */
const readItemValue = (item: PropertyGridFieldItem): unknown => {
  if (item.get) return item.get();
  if (item.target) return (item.target as Record<string, unknown>)[item.key];
  return item.value;
};

/**
 * The field an item makes (D10's inference): its `kind`, else `options` a select, a number a
 * number field or (with `min` and `max`) a slider, a boolean a checkbox, a hex colour string or a
 * colour object a colour field, another string a text field. Any other value has no field yet (a
 * vector's, a rotation's: p804 Phase 5): `null`.
 * @internal
 */
export const inferFieldKind = (
  item: PropertyGridFieldItem,
  value: unknown
): PropertyGridFieldKind | null => {
  if (item.kind) return item.kind;
  if (item.options !== undefined) return 'select';
  if (typeof value === 'number') {
    return item.min !== undefined && item.max !== undefined ? 'slider' : 'number';
  }
  if (typeof value === 'boolean') return 'checkbox';
  // Tweakpane's: a hex string and an { r, g, b } object are colours (their channels 0-1, D8)
  if (isColorString(value) || isColorObject(value)) return 'color';
  if (typeof value === 'string') return 'text';
  return null;
};

/** A radio's options: an array of `{ value, label }` (the select's forms normalised) */
const toRadioOptions = (options: PropertyGridFieldItem['options']) => {
  const resolved = typeof options === 'function' ? options() : options ?? [];
  return normalizeOptions(resolved as SelectOptions<SelectValue>).map((option, index) => ({
    ...(Array.isArray(resolved) ? (resolved[index] as object) : {}),
    ...option,
  })) as SegmentOption<SelectValue>[];
};

/** Makes an item's field with the grid's scheduler */
const createItemField = (
  item: PropertyGridFieldItem,
  scheduler: BindingScheduler
): Field<unknown> => {
  const { type: _type, kind: _kind, onCreate, ...rest } = item;
  const props = { ...rest, scheduler };
  // The item's props are the union of the creators': each reads its own
  const make = (create: (p: never) => unknown, extra?: object) =>
    (create as (p: object) => unknown)({ ...props, ...extra }) as Field<unknown>;
  let kind = inferFieldKind(item, readItemValue(item));
  if (kind === null) {
    // A vector, a rotation: shown as a monitor until their fields exist
    if (!item.readonly) {
      lwarn(`Property grid item "${item.label}": no field edits this value yet; it's read-only.`);
    }
    kind = 'monitor';
  }
  let field: Field<unknown>;
  switch (kind) {
    case 'number':
      field = make(createNumberField);
      break;
    case 'slider':
      field = make(createSlider);
      break;
    case 'range':
      field = make(createRangeSlider);
      break;
    case 'checkbox':
      field = make(createCheckbox);
      break;
    case 'switch':
      field = make(createSwitch);
      break;
    case 'radio':
      field = make(createRadioGroup, { options: toRadioOptions(item.options) });
      break;
    case 'segmented':
      field = make(createSegmentedControl, { options: toRadioOptions(item.options) });
      break;
    case 'select':
      field = make(createSelectField);
      break;
    case 'text':
      field = make(createTextField);
      break;
    case 'search':
      field = make(createTextField, { type: 'search' });
      break;
    case 'color':
      field = make(createColorField);
      break;
    case 'monitor':
      field = make(createMonitor);
      break;
  }
  onCreate?.(field);
  return field;
};

/**
 * A row that isn't a field (a button, a separator, a custom item): its `hidden` and `disabled`
 * functions and its own refresh run with the scheduler's `refresh()`, and leave it with the row.
 */
const createItemRow = (className: string, scheduler: BindingScheduler, readState?: () => void) => {
  let removeEntry: (() => void) | null = null;
  const cmp = CMP({
    class: className,
    onRemoveCmp: () => {
      removeEntry?.();
      removeEntry = null;
    },
  });
  if (readState) {
    removeEntry = addScheduledBinding(scheduler, {
      read: () => {},
      readState,
      isShown: () => false,
    });
  }
  return cmp;
};

const setHiddenAttr = (elem: HTMLElement, hidden: boolean) => {
  if (hidden) elem.setAttribute('hidden', '');
  else elem.removeAttribute('hidden');
};

const createButtonRow = (item: PropertyGridButtonItem, scheduler: BindingScheduler) => {
  const isDynamic = typeof item.hidden === 'function' || typeof item.disabled === 'function';
  const readState = () => {
    setHiddenAttr(row.elem, resolveDyn(item.hidden));
    button.setDisabled(resolveDyn(item.disabled));
  };
  const row = createItemRow(
    'aekPropertyGrid__buttonRow',
    scheduler,
    isDynamic ? readState : undefined
  );
  const buttonId = `${row.id}__button`;
  if (item.label) {
    // Named by its label and its text, as a field is by its label ("Shadow map, Rebuild")
    const label = document.createElement('span');
    label.className = 'aekPropertyGrid__buttonLabel';
    label.id = `${row.id}__label`;
    label.textContent = item.label;
    row.elem.append(label);
    row.elem.setAttribute('data-labelled', '');
  }
  const button = createButton({
    id: item.label ? buttonId : undefined,
    label: item.title,
    variant: item.variant ?? 'secondary',
    onClick: () => item.onClick(),
  });
  if (item.label) {
    button.cmp.elem.setAttribute('aria-labelledby', `${row.id}__label ${buttonId}`);
  }
  row.add(button.cmp);
  readState();
  return row;
};

const createSeparatorRow = (item: PropertyGridSeparatorItem, scheduler: BindingScheduler) => {
  const readState = () => setHiddenAttr(row.elem, resolveDyn(item.hidden));
  const row = createItemRow(
    'aekPropertyGrid__dividerRow',
    scheduler,
    typeof item.hidden === 'function' ? readState : undefined
  );
  row.add(createDivider().cmp);
  readState();
  return row;
};

const createCustomRow = (item: PropertyGridCustomItem, scheduler: BindingScheduler) => {
  let refresh: (() => void) | null = null;
  const row = createItemRow('aekPropertyGrid__customRow', scheduler, () => refresh?.());
  refresh = item.build(row) || null;
  return row;
};

/** The items made into the grid's children, folders holding theirs */
const buildItems = (
  items: readonly PropertyGridItem[],
  scheduler: BindingScheduler,
  options: PropertyGridItemsOptions,
  path: string
): FormChild[] =>
  items.map((item) => {
    switch (item.type) {
      case 'folder': {
        const folderPath = path ? `${path}/${item.title}` : item.title;
        const id = item.id ?? folderPath;
        const saved = options.folderExpanded?.[id];
        return createFolder({
          title: item.title,
          expanded: saved ?? item.expanded !== false,
          hidden: item.hidden,
          scheduler,
          onExpandedChange: (expanded) => options.onFolderExpandedChange?.(id, expanded),
          children: buildItems(item.items, scheduler, options, folderPath),
        });
      }
      case 'button':
        return createButtonRow(item, scheduler);
      case 'separator':
        return createSeparatorRow(item, scheduler);
      case 'custom':
        return createCustomRow(item, scheduler);
      default:
        return createItemField(item, scheduler);
    }
  });

/**
 * Adds declarative items to a property grid (p804 D10): a panel described as data, Tweakpane's
 * pane items with its names (`label`, `min`, `max`, `step`, `format`, `options`, `readonly`,
 * `interval`, `multiline`, `rows`, `hidden`, `disabled`, `expanded`), so a ported pane is a rename.
 * - A field item binds `{ target, key }`, `{ get, set }` or `{ value }`; without `kind` its field
 *   is inferred from the value at creation: `options` make a select, a number a number field (a
 *   slider with both `min` and `max`), a boolean a checkbox, a hex colour string or an
 *   `{ r, g, b, a? }` object a colour field (a 24-bit number says `kind: 'color'`), another
 *   string a text field; `readonly: true` makes it a monitor in that field's text. A value no
 *   field edits yet (a vector's, a rotation's) is shown as a monitor, with a warning unless it's
 *   `readonly`.
 *   `onChange` is the field's (D3: every write, `last` on the gesture's end, never a refresh's),
 *   `onCreate` gets the field's handle.
 * - A folder item's id is its title path (`'Parent/Child'`, after `path`) or its `id`; its open
 *   state comes from `folderExpanded` and goes to `onFolderExpandedChange`, which the owner keeps.
 * - A button item is the kit's button (a `label` puts a label before it, in the label column); a
 *   separator item the kit's divider; a custom item gets a CMP across both columns, and the
 *   function its `build` returns runs on every refresh.
 * - Every `hidden` and `disabled` function, and every custom item's refresh, runs on the grid's
 *   `refresh()`; the items' fields and folders use the grid's scheduler.
 * @param grid the grid the items go into, after its children
 * @param items the items, in order
 * @param options the folders' open states and their ids' path
 * @remarks Its own module: inference may make any field, so it brings every field's code, which a
 * grid built from handles (`createPropertyGrid`'s `children`) doesn't.
 * @example
 * ```ts
 * const grid = createPropertyGrid();
 * addPropertyGridItems(
 *   grid,
 *   [
 *     { target: spinner, key: 'speed', label: 'Speed', min: 0, max: 10, step: 0.1 },
 *     { target: material, key: 'wireframe', label: 'Wireframe' },
 *     {
 *       type: 'folder',
 *       title: 'Light',
 *       items: [
 *         { target: light, key: 'intensity', label: 'Intensity', min: 0, step: 0.01 },
 *         { get: () => light.castShadow, label: 'Shadows', readonly: true },
 *       ],
 *     },
 *     { type: 'button', title: 'Reset the scene', onClick: () => resetScene() },
 *   ],
 *   {
 *     folderExpanded: savedFolders,
 *     onFolderExpandedChange: (id, open) => saveFolder(id, open),
 *   }
 * );
 * settingsWindow.add(grid.cmp);
 * ```
 */
export const addPropertyGridItems = (
  grid: PropertyGrid,
  items: readonly PropertyGridItem[],
  options: PropertyGridItemsOptions = {}
) => {
  grid.add(...buildItems(items, grid.scheduler, options, options.path ?? ''));
};
