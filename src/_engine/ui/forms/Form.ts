// The form (p804 D9): a `<form novalidate>` around fields, fieldsets and property grids, which
// checks its fields itself (each field's `required` and `validate`, read through the shell's
// `getFormField`), shows each error under its field and an error summary at the top that takes the
// focus and links each field (the GOV.UK pattern), and submits and resets through the fields'
// handles. The browser's own validation and `form.reset()` never run.
import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { createButton, type Button } from '../components/Button';
import { createBindingScheduler, type BindingScheduler } from './binding/BindingScheduler';
import {
  addFormChildren,
  getFormField,
  readFieldsetDisabled,
  revealFormChild,
  type FormChild,
  type FormFieldEntry,
} from './Field';
import './Form.scss';
import '../styles/kit.scss';

/** What {@link createForm} makes a form from. */
export type FormProps = {
  /** Its first children, in order (`add` adds more): fields, fieldsets, property grids, any CMP. */
  children?: readonly FormChild[];
  /** A valid submit (Enter in a field, the submit button, `submit()`): the app reads its bound
   * values. A promise makes the form busy until it settles (`aria-busy`, the submit button
   * loading), and a submit meanwhile is ignored. */
  onSubmit?: (form: Form) => void | Promise<unknown>;
  /** After a reset (the reset button, `reset()`): every field is at its default, the errors gone. */
  onReset?: (form: Form) => void;
  /** The submit button's text: a primary `type="submit"` button after the children (default: none,
   * the app adds its own). */
  submitLabel?: string;
  /** The reset button's text: a `type="reset"` button after the submit button (default: none). */
  resetLabel?: string;
  /** The error summary's title (default 'There is a problem'). */
  summaryTitle?: string;
  /** A host's scheduler, shared with its other forms and grids. Default: one of its own, disposed
   * with the form. */
  scheduler?: BindingScheduler;
  /** Whether its own scheduler's host shows at the start (default true). Not with a shared
   * `scheduler`. */
  visible?: boolean;
  /** Disables every field and button in it (default false). */
  disabled?: boolean;
  /** Extra classes for the form's element. */
  class?: string | string[];
  /** Extra attributes for the form's element (an `aria-label` names it as a landmark). */
  attr?: CMPAttr;
  /** The form's element id (default: none). */
  id?: string;
};

/** A form {@link createForm} made. */
export type Form = {
  /** The `<form>`'s CMP: add it where it goes. `cmp.remove()` disposes of it, its children and its
   * own scheduler. */
  cmp: CMPHandle;
  /** The CMP its children are in, after the summary and before the buttons. */
  content: CMPHandle;
  /** Its scheduler (its own, or the shared one). */
  scheduler: BindingScheduler;
  /** The submit button `submitLabel` made, or null. */
  submitButton: Button | null;
  /** The reset button `resetLabel` made, or null. */
  resetButton: Button | null;
  /** Adds children after the ones it has; a field or folder given no scheduler joins its. */
  add: (...children: FormChild[]) => void;
  /** Checks every field and, when all are valid, calls `onSubmit`; otherwise the summary takes the
   * focus. Whether `onSubmit` was called (false too while a submit is busy). */
  submit: () => boolean;
  /** Writes every field's default (each field's `onChange` as the user's), takes the errors and the
   * summary away, then calls `onReset`. */
  reset: () => void;
  /** Checks every field and draws the errors and the summary (with `focus`, the summary takes the
   * focus when it shows): what a submit does before `onSubmit`, and what an app calls after it set
   * a field's error itself (a server's answer). Whether every field is valid. */
  validate: (options?: { focus?: boolean }) => boolean;
  /** Reads every field of its scheduler (the scheduler's `refresh()`); never fires `onChange`. */
  refresh: () => void;
  /** Disables or enables every field and button in it. */
  setDisabled: (disabled: boolean) => void;
  /** Whether it's disabled. */
  isDisabled: () => boolean;
  /** Whether an `onSubmit` promise hasn't settled yet. */
  isBusy: () => boolean;
};

const DEFAULT_SUMMARY_TITLE = 'There is a problem';

/** What `required` counts as no value */
const isEmptyValue = (value: unknown) =>
  value === undefined ||
  value === null ||
  value === false ||
  (typeof value === 'string' && value.trim() === '') ||
  (typeof value === 'number' && Number.isNaN(value));

/** Hidden by itself or a container (not by a shut folder: a summary link opens it) */
const isHiddenField = (elem: Element) => Boolean(elem.closest('[hidden]:not(.aekFolder__region)'));

/**
 * Creates a form (p804 D9): a `<form novalidate>` around fields, fieldsets and property grids, with
 * its own checks, error summary, submit and reset. Each field's `required` and `validate` are
 * checked on a submit, and from then on when the focus leaves the field: its error under it, and
 * on a submit an error summary at the top (the GOV.UK pattern) that takes the focus and links each
 * error to its field (a link focuses it, opening a shut folder around it). A field that is hidden
 * or disabled isn't checked. A field's own error (an expression that doesn't parse) and the app's
 * `setError` count too, so `validate()` after an app set one (a server's answer) shows it in the
 * summary.
 * - Submit: Enter in a single-line field (the browser's implicit submission: with a submit button,
 *   or a single field), the submit button, `submit()`; `onSubmit` only when every field is valid.
 * - Reset: the reset button or `reset()` writes every field's default (an undo records it: the
 *   user's change), clears the errors and the summary and checks no field on a blur until the next
 *   submit.
 * - Scheduler: its own, or a host's shared one; a field or folder added without one joins it, a
 *   property grid in it keeps its own (`createPropertyGrid({ scheduler: form.scheduler })` shares).
 * - Parts: `form.aekForm` (`aria-busy` while `onSubmit`'s promise is pending) with
 *   `.aekForm__summary` (`hidden` without errors: `__summaryTitle`, `__summaryList` of `<li>`s with
 *   an `a.aekForm__summaryLink` each), `fieldset.aekForm__body` (`disabled`) holding
 *   `.aekForm__content` and `.aekForm__actions` (the buttons).
 * - Custom properties: `--aek-form-gap` (between its parts and children, default `--aek-space-4`),
 *   `--aek-form-summary-border-color` (default `--aek-danger`).
 * - ARIA: the summary is a `group` named by its title, `tabindex="-1"` (it takes the focus, so its
 *   title and links are read); each link's text is its field's error and its `href` the field's
 *   control. A required field's control has `required` or `aria-required` (see the field's
 *   `required`). The body fieldset is `role="none"`: it only disables.
 * @example
 * ```ts
 * const profile = { name: '', region: '', terms: false };
 * const form = createForm({
 *   submitLabel: 'Save',
 *   resetLabel: 'Reset',
 *   onSubmit: () => saveProfile(profile),
 *   children: [
 *     createTextField({
 *       label: 'Name',
 *       target: profile,
 *       key: 'name',
 *       required: 'Enter your name',
 *       validate: (name) => (name.length < 3 ? 'Name must be 3 characters or more' : null),
 *     }),
 *     createSelectField({
 *       label: 'Region',
 *       target: profile,
 *       key: 'region',
 *       options: { Europe: 'eu', Americas: 'am' },
 *       placeholder: 'Choose',
 *       required: true,
 *     }),
 *     createCheckbox({ label: 'I accept the terms', target: profile, key: 'terms', required: true }),
 *   ],
 * });
 * settingsDialog.add(form.cmp);
 * ```
 */
export const createForm = (props: FormProps = {}): Form => {
  const isOwnScheduler = !props.scheduler;
  const scheduler = props.scheduler ?? createBindingScheduler({ visible: props.visible });
  let isDisabled = false;
  let isRemoved = false;
  /** From the first submit (or `validate()`) to a reset: a blur checks its field */
  let isChecking = false;
  let busy: Promise<unknown> | null = null;
  /** The summary's links, each to its field */
  const links = new Map<HTMLAnchorElement, { elem: Element; entry: FormFieldEntry }>();

  const cmp = CMP({
    tag: 'form',
    class: classes('aekForm', props.class),
    attr: { ...props.attr, novalidate: '', ...(props.id ? { id: props.id } : {}) },
    onRemoveCmp: () => {
      isRemoved = true;
      busy = null;
      for (const [type, fn] of listeners) root.removeEventListener(type, fn as EventListener);
      summary.removeEventListener('click', onSummaryClick);
      links.clear();
      if (isOwnScheduler) scheduler.dispose();
    },
  });
  const root = cmp.elem as HTMLFormElement;

  const summary = document.createElement('div');
  summary.className = 'aekForm__summary';
  summary.id = `${cmp.id}__summary`;
  const summaryTitle = document.createElement('p');
  summaryTitle.className = 'aekForm__summaryTitle';
  summaryTitle.id = `${cmp.id}__summaryTitle`;
  summaryTitle.textContent = props.summaryTitle ?? DEFAULT_SUMMARY_TITLE;
  const summaryList = document.createElement('ul');
  summaryList.className = 'aekForm__summaryList';
  summary.append(summaryTitle, summaryList);
  for (const [name, value] of [
    ['role', 'group'],
    ['aria-labelledby', summaryTitle.id],
    ['tabindex', '-1'],
    ['hidden', ''],
  ]) {
    summary.setAttribute(name, value);
  }
  root.append(summary);

  // Disables what it holds as a fieldset does (the fields read it); a group of nothing to the
  // screen reader
  const body = cmp.add({ tag: 'fieldset', class: 'aekForm__body', attr: { role: 'none' } });
  const content = body.add({ class: 'aekForm__content' });

  const submitButton = props.submitLabel
    ? createButton({ label: props.submitLabel, variant: 'primary', type: 'submit' })
    : null;
  const resetButton = props.resetLabel
    ? createButton({ label: props.resetLabel, type: 'reset' })
    : null;
  if (submitButton || resetButton) {
    const actions = body.add({ class: 'aekForm__actions' });
    if (submitButton) actions.add(submitButton.cmp);
    if (resetButton) actions.add(resetButton.cmp);
  }

  /** Every edit field in it, in the page's order, with its element */
  const getFields = () => {
    const fields: { elem: Element; entry: FormFieldEntry }[] = [];
    for (const elem of content.elem.querySelectorAll('.aekField')) {
      const entry = getFormField(elem);
      if (entry) fields.push({ elem, entry });
    }
    return fields;
  };

  /** Runs the field's checks into its form error; the error it shows now (any slot's) */
  const checkField = (elem: Element, entry: FormFieldEntry) => {
    // A hidden or disabled field isn't checked, nor its own or the app's error the form's to show
    const isSkipped = entry.isDisabled() || isHiddenField(elem);
    let error: string | null = null;
    if (!isSkipped) {
      const value = entry.field.getValue();
      if (entry.required && isEmptyValue(value)) {
        error = typeof entry.required === 'string' ? entry.required : `${entry.label} is required`;
      } else {
        error = entry.validate?.(value) ?? null;
      }
    }
    entry.setFormError(error);
    return isSkipped ? null : entry.getError();
  };

  const setSummaryShown = (on: boolean) => {
    if (on) summary.removeAttribute('hidden');
    else summary.setAttribute('hidden', '');
  };

  const addLink = (elem: Element, entry: FormFieldEntry, error: string) => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'aekForm__summaryLink';
    link.setAttribute('href', `#${entry.targetId}`);
    link.textContent = error;
    item.append(link);
    summaryList.append(item);
    links.set(link, { elem, entry });
  };

  const validate = (options?: { focus?: boolean }) => {
    isChecking = true;
    links.clear();
    summaryList.replaceChildren();
    for (const { elem, entry } of getFields()) {
      const error = checkField(elem, entry);
      if (error !== null) addLink(elem, entry, error);
    }
    const isValid = links.size === 0;
    setSummaryShown(!isValid);
    if (!isValid && options?.focus) summary.focus();
    return isValid;
  };

  /** A blur's check: the field's error, and its summary link's text, or the link gone (a new error
   * isn't added: the summary is the last submit's) */
  const checkOnBlur = (elem: Element, entry: FormFieldEntry, next: Node | null) => {
    const error = checkField(elem, entry);
    // Tabbing up into the summary: its links stay as they are
    if (next && summary.contains(next)) return;
    for (const [link, linked] of links) {
      if (linked.entry !== entry) continue;
      if (error !== null) {
        link.textContent = error;
      } else {
        link.parentElement?.remove();
        links.delete(link);
      }
    }
    if (links.size === 0) setSummaryShown(false);
  };

  const submit = () => {
    if (busy || !validate({ focus: true })) return false;
    const result = props.onSubmit?.(form);
    if (!(result instanceof Promise)) return true;
    busy = result;
    root.setAttribute('aria-busy', 'true');
    submitButton?.setLoading(true);
    const settle = () => {
      if (busy !== result || isRemoved) return;
      busy = null;
      root.removeAttribute('aria-busy');
      submitButton?.setLoading(false);
    };
    // A rejection is the app's: it settles the form and still reaches the console
    void result.finally(settle);
    return true;
  };

  const reset = () => {
    isChecking = false;
    links.clear();
    summaryList.replaceChildren();
    setSummaryShown(false);
    for (const { entry } of getFields()) {
      entry.field.reset();
      entry.setFormError(null);
    }
    props.onReset?.(form);
  };

  const onSubmitEvent = (e: Event) => {
    // The browser's submit (a navigation) never runs
    e.preventDefault();
    submit();
  };

  const onResetEvent = (e: Event) => {
    // The browser's reset would write the inputs' default attributes, not the bound defaults
    e.preventDefault();
    reset();
  };

  const onFocusOut = (e: FocusEvent) => {
    if (!isChecking) return;
    const elem = (e.target as Element | null)?.closest?.('.aekField');
    const entry = elem && content.elem.contains(elem) ? getFormField(elem) : undefined;
    if (!elem || !entry) return;
    const next = e.relatedTarget as Node | null;
    // Still in the field (a range's two inputs, its reset button)
    if (next && elem.contains(next)) return;
    checkOnBlur(elem, entry, next);
  };

  const onSummaryClick = (e: MouseEvent) => {
    const link = (e.target as Element | null)?.closest?.('a');
    const linked = link ? links.get(link as HTMLAnchorElement) : undefined;
    if (!linked) return;
    // No navigation: the field takes the focus, its label in view
    e.preventDefault();
    revealFormChild(linked.elem);
    linked.entry.field.focus();
    linked.elem.scrollIntoView?.({ block: 'nearest' });
  };

  // Bubble listeners: a field's own blur (its typed text written) comes first
  const listeners: [string, (e: never) => void][] = [
    ['submit', onSubmitEvent],
    ['reset', onResetEvent],
    ['focusout', onFocusOut],
  ];
  for (const [type, fn] of listeners) root.addEventListener(type, fn as EventListener);
  summary.addEventListener('click', onSummaryClick);

  const setDisabled = (on: boolean) => {
    if (on === isDisabled) return;
    isDisabled = on;
    if (on) body.elem.setAttribute('disabled', '');
    else body.elem.removeAttribute('disabled');
    readFieldsetDisabled(body.elem);
  };

  const add = (children: readonly FormChild[]) => {
    addFormChildren(content, children, scheduler);
    if (isDisabled) readFieldsetDisabled(content.elem);
  };

  const form: Form = {
    cmp,
    content,
    scheduler,
    submitButton,
    resetButton,
    add: (...children) => add(children),
    submit,
    reset,
    validate,
    refresh: () => scheduler.refresh(),
    setDisabled,
    isDisabled: () => isDisabled,
    isBusy: () => busy !== null,
  };

  if (props.children) add(props.children);
  setDisabled(Boolean(props.disabled));
  return form;
};
