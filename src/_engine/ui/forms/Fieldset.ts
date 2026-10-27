// The fieldset (p804 D9): a native `<fieldset>` and `<legend>` around a group of fields outside the
// property grid (a form's section). Disabling it disables every field in it, the kit's own stops
// too (the browser disables only native controls).
import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { addFormChildren, readFieldsetDisabled, type FormChild } from './Field';
import './Fieldset.scss';
import '../styles/kit.scss';

/** What {@link createFieldset} makes a fieldset from. */
export type FieldsetProps = {
  /** The group's name: its `<legend>`, shown, and the group's accessible name. */
  legend: string;
  /** Keeps the legend as the accessible name only, not shown (default false). */
  legendHidden?: boolean;
  /** A line of help under the legend, which the group is described by. */
  hint?: string;
  /** Disables every field in it (default false). */
  disabled?: boolean;
  /** Its first children, in order (`add` adds more). */
  children?: readonly FormChild[];
  /** Extra classes for the fieldset's element. */
  class?: string | string[];
  /** Extra attributes for the fieldset's element. */
  attr?: CMPAttr;
  /** The fieldset's element id (default: a generated one). */
  id?: string;
};

/** A fieldset {@link createFieldset} made. */
export type Fieldset = {
  /** The `<fieldset>`'s CMP: add it where it goes. `cmp.remove()` disposes of it and its
   * children. */
  cmp: CMPHandle;
  /** The CMP its children are in, after the legend and the hint. */
  content: CMPHandle;
  /** Adds children after the ones it has; a field added to a disabled fieldset is disabled. */
  add: (...children: FormChild[]) => void;
  /** Disables or enables it and every field in it (a field's own `disabled` stays). */
  setDisabled: (disabled: boolean) => void;
  /** Whether it's disabled. */
  isDisabled: () => boolean;
};

/**
 * Creates a fieldset (p804 D9): a native `<fieldset>` with its `<legend>` (the group's name) and
 * an optional hint, around a group of fields outside the property grid: a form's section, a
 * dialog's group of settings. `disabled` (and `setDisabled`) disables the group as the browser
 * does, and every field in it as its own `disabled` would: their labels, their state and the kit's
 * own stops (a slider's thumb), which the browser's `disabled` doesn't reach. A field keeps its own
 * `disabled` when the fieldset is enabled again.
 * - Parts: `fieldset.aekFieldset` (`disabled`) with `legend.aekFieldset__legend`
 *   (`aekVisuallyHidden` with `legendHidden`), `.aekFieldset__hint` and `.aekFieldset__content`.
 * - Custom properties: `--aek-fieldset-gap` (between its children, default `--aek-space-4`).
 * - ARIA: the native group, named by its legend; the hint describes it (`aria-describedby`).
 * @example
 * ```ts
 * const account = createFieldset({
 *   legend: 'Account',
 *   hint: 'Shown to other players',
 *   children: [
 *     createTextField({ label: 'Name', target: profile, key: 'name' }),
 *     createSelectField({ label: 'Region', target: profile, key: 'region', options: regions }),
 *   ],
 * });
 * settingsDialog.add(account.cmp);
 * ```
 */
export const createFieldset = (props: FieldsetProps): Fieldset => {
  let isDisabled = false;
  const cmp = CMP({
    tag: 'fieldset',
    class: classes('aekFieldset', props.class),
    attr: { ...props.attr, ...(props.id ? { id: props.id } : {}) },
  });
  const root = cmp.elem;

  const legend = document.createElement('legend');
  legend.className = classes(
    'aekFieldset__legend',
    props.legendHidden ? 'aekVisuallyHidden' : null
  ).join(' ');
  legend.textContent = props.legend;
  root.append(legend);
  if (props.hint) {
    const hint = document.createElement('p');
    hint.className = 'aekFieldset__hint';
    hint.id = `${cmp.id}__hint`;
    hint.textContent = props.hint;
    root.append(hint);
    root.setAttribute('aria-describedby', hint.id);
  }
  const content = cmp.add({ class: 'aekFieldset__content' });

  const setDisabled = (on: boolean) => {
    if (on === isDisabled) return;
    isDisabled = on;
    if (on) root.setAttribute('disabled', '');
    else root.removeAttribute('disabled');
    readFieldsetDisabled(root);
  };

  const add = (children: readonly FormChild[]) => {
    addFormChildren(content, children);
    if (isDisabled) readFieldsetDisabled(root);
  };

  if (props.children) add(props.children);
  setDisabled(Boolean(props.disabled));

  return {
    cmp,
    content,
    add: (...children) => add(children),
    setDisabled,
    isDisabled: () => isDisabled,
  };
};
