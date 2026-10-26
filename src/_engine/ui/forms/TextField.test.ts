import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { countListeners, dispatchKey, stubKitDomAsync } from '../testing/KitDom';
import type { FieldChange } from './Field';
import { createTextField, type TextFieldProps } from './TextField';

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot')! });
});

type Change = { value: string; prev: string; last: boolean; source: string };

const removers: (() => void)[] = [];
afterEach(() => {
  while (removers.length) removers.pop()!();
});

/** A text field bound to `target.value`, in the HUD root, with its onChange calls */
const makeText = (props: Partial<TextFieldProps> = {}, start = 'abc') => {
  const target = { value: start };
  const calls: Change[] = [];
  const field = createTextField({
    label: 'Name',
    target,
    key: 'value',
    onChange: (value: string, { prev, last, source }: FieldChange<string>) =>
      calls.push({ value, prev, last, source }),
    ...props,
  } as TextFieldProps);
  getHUDRootCMP().add(field.cmp);
  removers.push(() => field.cmp.remove());
  const root = field.cmp.elem;
  const input = root.querySelector<HTMLInputElement>('.aekTextField__input')!;
  const clear = root.querySelector<HTMLButtonElement>('.aekTextField__clear');
  const type = (text: string) => {
    input.value = text;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  return { field, target, calls, root, input, clear, type };
};

const user = (value: string, prev: string, last: boolean) => ({
  value,
  prev,
  last,
  source: 'user',
});

describe('the text field (p804 D7)', () => {
  it('is a labelled text input showing the bound value', () => {
    const { input, root } = makeText({ placeholder: 'Your name', maxLength: 8 });
    expect(input.tagName).toBe('INPUT');
    expect(input.getAttribute('type')).toBe('text');
    expect(input.value).toBe('abc');
    expect(input.getAttribute('placeholder')).toBe('Your name');
    expect(input.getAttribute('maxlength')).toBe('8');
    expect(root.querySelector('label')!.getAttribute('for')).toBe(input.id);
    expect(root.getAttribute('data-kind')).toBe('text');
  });

  it('writes the typed text on Enter, once with last: true, and gives onInput each keystroke', () => {
    const typed: string[] = [];
    const { input, target, calls, type } = makeText({ onInput: (text) => typed.push(text) });
    type('ab');
    type('abd');
    expect(target.value).toBe('abc');
    const enter = dispatchKey(input, 'keydown', 'Enter');
    // Not taken: a form submits after the value is written
    expect(enter.defaultPrevented).toBe(false);
    expect(target.value).toBe('abd');
    expect(typed).toEqual(['ab', 'abd']);
    expect(calls).toEqual([user('abd', 'abc', true)]);
  });

  it('writes on a blur', () => {
    const { input, target, type } = makeText();
    input.focus();
    type('x');
    input.blur();
    expect(target.value).toBe('x');
  });

  it('Escape puts the text back, through the overlay stack', () => {
    const { input, target, calls, type } = makeText();
    type('zzz');
    expect(dispatchKey(input, 'keydown', 'Escape').defaultPrevented).toBe(true);
    expect(input.value).toBe('abc');
    expect(target.value).toBe('abc');
    expect(calls).toEqual([]);
    expect(dispatchKey(input, 'keydown', 'Escape').defaultPrevented).toBe(false);
  });

  it('with live, writes each keystroke; Escape writes the value from before back', () => {
    const { target, calls, type, input } = makeText({ live: true });
    type('a');
    type('ab');
    expect(target.value).toBe('ab');
    dispatchKey(input, 'keydown', 'Escape');
    expect(target.value).toBe('abc');
    expect(calls).toEqual([
      user('a', 'abc', false),
      user('ab', 'a', false),
      user('abc', 'ab', false),
      user('abc', 'abc', true),
    ]);
  });

  it('a refresh doesn’t write over typed text; a value changed from outside shows after', () => {
    const { field, input, target, type } = makeText();
    type('typing');
    target.value = 'outside';
    field.refresh();
    expect(input.value).toBe('typing');
    dispatchKey(input, 'keydown', 'Escape');
    expect(input.value).toBe('outside');
  });
});

describe('a multiline text field (p804 D7)', () => {
  it('is a textarea of `rows` lines: Enter is a new line, Ctrl/⌘+Enter writes', () => {
    const { input, target, type } = makeText({ multiline: true, rows: 5 }, 'one');
    expect(input.tagName).toBe('TEXTAREA');
    expect(input.getAttribute('rows')).toBe('5');
    type('one\ntwo');
    expect(dispatchKey(input, 'keydown', 'Enter').defaultPrevented).toBe(false);
    expect(target.value).toBe('one');
    expect(dispatchKey(input, 'keydown', 'Enter', { metaKey: true }).defaultPrevented).toBe(true);
    expect(target.value).toBe('one\ntwo');
    type('three');
    dispatchKey(input, 'keydown', 'Enter', { ctrlKey: true });
    expect(target.value).toBe('three');
  });

  it('has 3 rows by default', () => {
    const { input } = makeText({ multiline: true });
    expect(input.getAttribute('rows')).toBe('3');
  });
});

describe('a search field (p804 D7)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is a searchbox with a mark and a clear button shown while there’s text', () => {
    const { input, root, clear, type } = makeText({ type: 'search' }, '');
    expect(input.getAttribute('role')).toBe('searchbox');
    expect(root.querySelector('.aekTextField__icon')!.getAttribute('aria-hidden')).toBe('true');
    expect(clear!.getAttribute('aria-label')).toBe('Clear Name');
    expect(clear!.hasAttribute('hidden')).toBe(true);
    type('q');
    expect(clear!.hasAttribute('hidden')).toBe(false);
  });

  it('calls onSearch after the delay, at once on Enter', () => {
    const searches: string[] = [];
    const { input, type } = makeText(
      { type: 'search', onSearch: (text) => searches.push(text), searchDelayMs: 100 },
      ''
    );
    type('a');
    vi.advanceTimersByTime(60);
    type('ab');
    vi.advanceTimersByTime(60);
    expect(searches).toEqual([]);
    vi.advanceTimersByTime(40);
    expect(searches).toEqual(['ab']);
    type('abc');
    dispatchKey(input, 'keydown', 'Enter');
    expect(searches).toEqual(['ab', 'abc']);
    vi.advanceTimersByTime(500);
    expect(searches).toEqual(['ab', 'abc']);
  });

  it('the clear button empties it, writes it, searches and focuses the input', () => {
    const searches: string[] = [];
    const { input, target, clear, calls } = makeText(
      { type: 'search', onSearch: (text) => searches.push(text) },
      'old'
    );
    expect(clear!.hasAttribute('hidden')).toBe(false);
    clear!.focus();
    clear!.click();
    expect(input.value).toBe('');
    expect(target.value).toBe('');
    expect(calls).toEqual([user('', 'old', true)]);
    expect(searches).toEqual(['']);
    expect(clear!.hasAttribute('hidden')).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it('leaves no listener or timer when removed mid-typing', () => {
    const { field, input, clear, type } = makeText(
      { type: 'search', onSearch: () => {}, searchDelayMs: 100 },
      ''
    );
    type('a');
    field.cmp.remove();
    expect(countListeners(input)).toBe(0);
    expect(countListeners(clear!)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(dispatchKey(getHUDRootCMP().elem, 'keydown', 'Escape').defaultPrevented).toBe(false);
  });
});

describe('the text field disabled', () => {
  it('disables the input and the clear button; disabling writes typed text', () => {
    const { field, input, target, clear, type } = makeText({ type: 'search' });
    type('typed');
    field.setDisabled(true);
    expect(input.hasAttribute('disabled')).toBe(true);
    expect(clear!.hasAttribute('disabled')).toBe(true);
    expect(target.value).toBe('typed');
  });
});
