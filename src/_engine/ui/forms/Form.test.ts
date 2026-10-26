import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { countListeners, dispatchKey, stubKitDomAsync } from '../testing/KitDom';
import { createCheckbox } from './Checkbox';
import { createFieldset } from './Fieldset';
import { createFolder } from './Folder';
import { createForm, type Form, type FormProps } from './Form';
import { createMonitor } from './Monitor';
import { createNumberField } from './NumberField';
import { createPropertyGrid } from './PropertyGrid';
import { createRadioGroup } from './RadioGroup';
import { createSelectField } from './SelectField';
import { createTextField } from './TextField';

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot')! });
});

const removers: (() => void)[] = [];
afterEach(() => {
  while (removers.length) removers.pop()!();
});

/** A profile form in the HUD root: a required name with a length check, a required region and a
 * required terms checkbox */
const makeProfileForm = (props: Partial<FormProps> = {}) => {
  const profile = { name: '', region: '', terms: false };
  const name = createTextField({
    label: 'Name',
    target: profile,
    key: 'name',
    required: 'Enter your name',
    validate: (value) => (value.length < 3 ? 'Name must be 3 characters or more' : null),
  });
  const region = createSelectField({
    label: 'Region',
    target: profile,
    key: 'region',
    options: { Europe: 'eu', Americas: 'am' },
    placeholder: 'Choose',
    required: true,
  });
  const terms = createCheckbox({ label: 'Terms', target: profile, key: 'terms', required: true });
  const form = createForm({ submitLabel: 'Save', resetLabel: 'Reset', ...props });
  form.add(name, region, terms);
  getHUDRootCMP().add(form.cmp);
  removers.push(() => form.cmp.remove());
  const root = form.cmp.elem as HTMLFormElement;
  const summary = root.querySelector<HTMLElement>('.aekForm__summary')!;
  const input = name.cmp.elem.querySelector('input')!;
  return { form, profile, name, region, terms, root, summary, input };
};

/** A cancelable `submit` or `reset` event, as the browser's */
const fire = (form: Form, type: 'submit' | 'reset') => {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  form.cmp.elem.dispatchEvent(event);
  return event;
};

const getLinks = (summary: HTMLElement) =>
  [...summary.querySelectorAll<HTMLAnchorElement>('.aekForm__summaryLink')].map((link) => ({
    text: link.textContent,
    href: link.getAttribute('href'),
  }));

const getMessage = (field: { cmp: { elem: HTMLElement } }) =>
  field.cmp.elem.querySelector('.aekField__message')!.textContent;

describe('the form (p804 D9)', () => {
  it('is a form the browser doesn’t validate: a hidden summary group, a body, its buttons', () => {
    const form = createForm({ id: 'profile', submitLabel: 'Save', resetLabel: 'Reset' });
    const root = form.cmp.elem;
    expect(root.tagName).toBe('FORM');
    expect(root.id).toBe('profile');
    expect(root.hasAttribute('novalidate')).toBe(true);
    const summary = root.querySelector('.aekForm__summary')!;
    expect(root.firstElementChild).toBe(summary);
    expect(summary.hasAttribute('hidden')).toBe(true);
    expect(summary.getAttribute('role')).toBe('group');
    expect(summary.getAttribute('tabindex')).toBe('-1');
    const title = summary.querySelector('.aekForm__summaryTitle')!;
    expect(title.textContent).toBe('There is a problem');
    expect(summary.getAttribute('aria-labelledby')).toBe(title.id);
    const body = root.querySelector('.aekForm__body')!;
    expect(body.tagName).toBe('FIELDSET');
    expect(body.getAttribute('role')).toBe('none');
    expect(body.firstElementChild).toBe(form.content.elem);
    const buttons = [...root.querySelectorAll('.aekForm__actions button')];
    expect(buttons.map((b) => [b.textContent, b.getAttribute('type')])).toEqual([
      ['Save', 'submit'],
      ['Reset', 'reset'],
    ]);
    expect(form.submitButton!.cmp.elem).toBe(buttons[0]);
    form.cmp.remove();
    const bare = createForm({ summaryTitle: 'Check these' });
    expect(bare.cmp.elem.querySelector('.aekForm__actions')).toBeNull();
    expect(bare.submitButton).toBeNull();
    expect(bare.cmp.elem.querySelector('.aekForm__summaryTitle')!.textContent).toBe('Check these');
    bare.cmp.remove();
  });

  it('marks a required field: the label’s hidden mark, `required` or `aria-required` on its part', () => {
    const { name, region } = makeProfileForm();
    const mark = name.cmp.elem.querySelector('.aekField__label .aekField__required')!;
    expect(mark.textContent).toBe('*');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(name.cmp.elem.querySelector('input')!.hasAttribute('required')).toBe(true);
    // A button takes neither: the mark alone
    const trigger = region.cmp.elem.querySelector('.aekDropDownTrigger')!;
    expect(trigger.hasAttribute('required')).toBe(false);
    expect(trigger.hasAttribute('aria-required')).toBe(false);
    const size = createRadioGroup({
      label: 'Size',
      value: 's',
      options: [{ value: 's', label: 'Small' }],
      required: true,
    });
    expect(size.cmp.elem.querySelector('[role="radiogroup"]')!.getAttribute('aria-required')).toBe(
      'true'
    );
    const monitor = createMonitor({ label: 'Speed', get: () => 1, required: true });
    expect(monitor.cmp.elem.querySelector('.aekField__required')).toBeNull();
    size.cmp.remove();
    monitor.cmp.remove();
  });

  it('a submit with errors: each under its field, the summary linking them takes the focus', () => {
    const onSubmit = vi.fn();
    const { form, profile, name, region, terms, summary } = makeProfileForm({ onSubmit });
    profile.name = 'Al';
    name.refresh();
    const event = fire(form, 'submit');
    expect(event.defaultPrevented).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(getMessage(name)).toBe('Name must be 3 characters or more');
    expect(getMessage(region)).toBe('Region is required');
    expect(getMessage(terms)).toBe('Terms is required');
    expect(name.cmp.elem.hasAttribute('data-invalid')).toBe(true);
    expect(name.cmp.elem.querySelector('input')!.getAttribute('aria-invalid')).toBe('true');
    expect(summary.hasAttribute('hidden')).toBe(false);
    expect(getLinks(summary)).toEqual([
      {
        text: 'Name must be 3 characters or more',
        href: `#${name.cmp.elem.querySelector('input')!.id}`,
      },
      {
        text: 'Region is required',
        href: `#${region.cmp.elem.querySelector('.aekDropDownTrigger')!.id}`,
      },
      { text: 'Terms is required', href: `#${terms.cmp.elem.querySelector('input')!.id}` },
    ]);
    expect(document.activeElement).toBe(summary);
    // `required` comes first, with its own text
    profile.name = ' ';
    name.refresh();
    expect(form.submit()).toBe(false);
    expect(getMessage(name)).toBe('Enter your name');
  });

  it('a summary link focuses its field (opening a shut folder around it), with no navigation', () => {
    const target = { speed: Number.NaN };
    const speed = createNumberField({ label: 'Speed', target, key: 'speed', required: true });
    const folder = createFolder({ title: 'Motion', expanded: false, children: [speed] });
    const form = createForm({ children: [folder] });
    getHUDRootCMP().add(form.cmp);
    removers.push(() => form.cmp.remove());
    expect(form.submit()).toBe(false);
    const link = form.cmp.elem.querySelector<HTMLAnchorElement>('.aekForm__summaryLink')!;
    expect(link.textContent).toBe('Speed is required');
    const click = new window.Event('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(folder.isExpanded()).toBe(true);
    expect(document.activeElement).toBe(speed.cmp.elem.querySelector('input'));
  });

  it('checks a field on a blur only from the first submit: its link goes when it’s fixed', () => {
    const { form, profile, name, region, input, summary } = makeProfileForm();
    input.focus();
    region.focus();
    expect(getMessage(name)).toBe('');
    fire(form, 'submit');
    expect(getLinks(summary)).toHaveLength(3);
    profile.name = 'Ada';
    name.refresh();
    input.focus();
    region.focus();
    expect(getMessage(name)).toBe('');
    expect(name.cmp.elem.hasAttribute('data-invalid')).toBe(false);
    expect(getLinks(summary).map((link) => link.text)).toEqual([
      'Region is required',
      'Terms is required',
    ]);
    // A new error shows under its field, not in the summary (the last submit's)
    profile.name = 'A';
    name.refresh();
    input.focus();
    region.focus();
    expect(getMessage(name)).toBe('Name must be 3 characters or more');
    expect(getLinks(summary)).toHaveLength(2);
  });

  it('hides the summary when its last link goes', () => {
    const target = { name: '' };
    const field = createTextField({ label: 'Name', target, key: 'name', required: true });
    const other = createTextField({ label: 'Other', value: '' });
    const form = createForm({ children: [field, other] });
    getHUDRootCMP().add(form.cmp);
    removers.push(() => form.cmp.remove());
    const summary = form.cmp.elem.querySelector('.aekForm__summary')!;
    form.submit();
    expect(summary.hasAttribute('hidden')).toBe(false);
    target.name = 'Ada';
    field.refresh();
    field.focus();
    other.focus();
    expect(summary.hasAttribute('hidden')).toBe(true);
  });

  it('a valid submit calls onSubmit with the form', () => {
    const onSubmit = vi.fn();
    const { form, profile, name, region, terms } = makeProfileForm({ onSubmit });
    Object.assign(profile, { name: 'Ada', region: 'eu', terms: true });
    for (const field of [name, region, terms]) field.refresh();
    fire(form, 'submit');
    expect(onSubmit).toHaveBeenCalledWith(form);
    expect(form.submit()).toBe(true);
  });

  it('a promise from onSubmit makes it busy until it settles; a submit meanwhile is ignored', async () => {
    let resolve = () => {};
    const onSubmit = vi.fn(() => new Promise<void>((done) => (resolve = done)));
    const form = createForm({ submitLabel: 'Save', onSubmit });
    getHUDRootCMP().add(form.cmp);
    removers.push(() => form.cmp.remove());
    expect(form.submit()).toBe(true);
    expect(form.isBusy()).toBe(true);
    expect(form.cmp.elem.getAttribute('aria-busy')).toBe('true');
    expect(form.submitButton!.isLoading()).toBe(true);
    expect(form.submit()).toBe(false);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(form.isBusy()).toBe(false);
    expect(form.cmp.elem.hasAttribute('aria-busy')).toBe(false);
    expect(form.submitButton!.isLoading()).toBe(false);
  });

  it('a reset writes every default as the user’s, clears the errors and stops the blur checks', () => {
    const onReset = vi.fn();
    const changes: string[] = [];
    const target = { name: 'Ada' };
    const name = createTextField({
      label: 'Name',
      target,
      key: 'name',
      required: true,
      onChange: (value, { source, last }) => changes.push(`${value} ${source} ${last}`),
    });
    const other = createTextField({ label: 'Other', value: '' });
    const form = createForm({ onReset, children: [name, other] });
    getHUDRootCMP().add(form.cmp);
    removers.push(() => form.cmp.remove());
    target.name = '';
    name.refresh();
    form.submit();
    expect(getMessage(name)).toBe('Name is required');
    const event = fire(form, 'reset');
    expect(event.defaultPrevented).toBe(true);
    expect(target.name).toBe('Ada');
    expect(changes).toEqual(['Ada user true']);
    expect(getMessage(name)).toBe('');
    expect(form.cmp.elem.querySelector('.aekForm__summary')!.hasAttribute('hidden')).toBe(true);
    expect(onReset).toHaveBeenCalledWith(form);
    target.name = '';
    name.refresh();
    name.focus();
    other.focus();
    expect(getMessage(name)).toBe('');
  });

  it('doesn’t check a hidden or disabled field; a field’s own and the app’s errors count', () => {
    const hidden = createTextField({ label: 'Hidden', value: '', required: true, hidden: true });
    const off = createTextField({ label: 'Off', value: '', required: true, disabled: true });
    const age = createNumberField({ label: 'Age', value: 30 });
    const nick = createTextField({ label: 'Nick', value: 'ada' });
    const form = createForm({ children: [hidden, off, age, nick] });
    getHUDRootCMP().add(form.cmp);
    removers.push(() => form.cmp.remove());
    expect(form.validate()).toBe(true);
    // An expression that doesn't parse, on Enter: the field's own error
    const ageInput = age.cmp.elem.querySelector('input')!;
    ageInput.value = '3 +';
    ageInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    dispatchKey(ageInput, 'keydown', 'Enter');
    expect(age.cmp.elem.hasAttribute('data-invalid')).toBe(true);
    // A server's answer
    nick.setError('Taken');
    expect(form.validate()).toBe(false);
    const summary = form.cmp.elem.querySelector<HTMLElement>('.aekForm__summary')!;
    expect(getLinks(summary).map((link) => link.text)).toEqual([getMessage(age), 'Taken']);
    // `validate()` doesn't move the focus
    expect(document.activeElement).not.toBe(summary);
  });

  it('disabled, disables every field and its buttons', () => {
    const name = createTextField({ label: 'Name', value: '' });
    const form = createForm({ submitLabel: 'Save', disabled: true, children: [name] });
    getHUDRootCMP().add(form.cmp);
    removers.push(() => form.cmp.remove());
    expect(form.isDisabled()).toBe(true);
    expect(form.cmp.elem.querySelector('.aekForm__body')!.hasAttribute('disabled')).toBe(true);
    expect(name.cmp.elem.hasAttribute('data-disabled')).toBe(true);
    form.setDisabled(false);
    expect(name.cmp.elem.hasAttribute('data-disabled')).toBe(false);
    const late = createTextField({ label: 'Late', value: '' });
    form.setDisabled(true);
    form.add(late);
    expect(late.cmp.elem.hasAttribute('data-disabled')).toBe(true);
  });

  it('its fields join its scheduler; a property grid in it keeps its own', () => {
    const target = { a: 1, b: 2 };
    const a = createNumberField({ label: 'A', target, key: 'a' });
    const b = createNumberField({ label: 'B', target, key: 'b' });
    const grid = createPropertyGrid({ children: [b] });
    const form = createForm({
      children: [createFieldset({ legend: 'Group', children: [a] }), grid],
    });
    getHUDRootCMP().add(form.cmp);
    removers.push(() => form.cmp.remove());
    target.a = 5;
    target.b = 6;
    form.refresh();
    expect(a.getValue()).toBe(5);
    expect(a.cmp.elem.querySelector('input')!.value).toBe('5.00');
    expect(b.cmp.elem.querySelector('input')!.value).toBe('2.00');
    grid.refresh();
    expect(b.cmp.elem.querySelector('input')!.value).toBe('6.00');
  });

  it('removed, leaves no listener on the form or its summary', () => {
    const { form, root, summary } = makeProfileForm();
    form.submit();
    removers.pop();
    form.cmp.remove();
    expect(countListeners(root)).toBe(0);
    expect(countListeners(summary)).toBe(0);
  });
});
