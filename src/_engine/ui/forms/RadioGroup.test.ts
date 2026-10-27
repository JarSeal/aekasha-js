import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { countListeners, stubKitDomAsync } from '../testing/KitDom';
import { createBindingScheduler } from './binding/BindingScheduler';
import type { FieldChange } from './Field';
import {
  createRadioGroup,
  createSegmentedControl,
  type RadioGroupProps,
  type SegmentedControlProps,
} from './RadioGroup';

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot')! });
});

type Change = { value: string; prev: string; last: boolean; source: string };

const removers: (() => void)[] = [];
afterEach(() => {
  while (removers.length) removers.pop()!();
});

const OPTIONS = [
  { value: 'easy', label: 'Easy' },
  { value: 'normal', label: 'Normal' },
  { value: 'hard', label: 'Hard' },
];

/** A radio group bound to `target.mode`, in the HUD root, with its onChange calls */
const makeRadios = (props: Partial<RadioGroupProps<string>> = {}, start = 'normal') => {
  const target = { mode: start };
  const calls: Change[] = [];
  const field = createRadioGroup<string>({
    label: 'Difficulty',
    target,
    key: 'mode',
    options: OPTIONS,
    onChange: (value: string, { prev, last, source }: FieldChange<string>) =>
      calls.push({ value, prev, last, source }),
    ...props,
  } as RadioGroupProps<string>);
  getHUDRootCMP().add(field.cmp);
  removers.push(() => field.cmp.remove());
  const root = field.cmp.elem;
  const group = root.querySelector<HTMLElement>('.aekRadioGroup')!;
  const radios = [...root.querySelectorAll<HTMLInputElement>('input')];
  return { field, target, calls, root, group, radios };
};

describe('the radio group (p804 D7)', () => {
  it('native radios sharing a name in a radiogroup the label names', () => {
    const { root, group, radios } = makeRadios({ id: 'difficulty' });
    const label = root.querySelector('.aekField__label')!;
    expect(root.getAttribute('data-kind')).toBe('radio');
    expect(label.tagName).toBe('SPAN');
    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(group.getAttribute('aria-labelledby')).toBe(label.id);
    expect(group.getAttribute('data-orientation')).toBe('vertical');
    expect(radios.map((radio) => radio.getAttribute('type'))).toEqual(['radio', 'radio', 'radio']);
    const name = radios[0].getAttribute('name');
    expect(name).toMatch(/^aekRadio\d+$/);
    expect(radios.every((radio) => radio.getAttribute('name') === name)).toBe(true);
    expect(radios.map((radio) => radio.id)).toEqual([
      'difficulty-0',
      'difficulty-1',
      'difficulty-2',
    ]);
    // Each radio's label is its option's
    expect(radios.map((radio) => radio.closest('label')!.textContent)).toEqual([
      'Easy',
      'Normal',
      'Hard',
    ]);
    expect(radios.map((radio) => radio.checked)).toEqual([false, true, false]);
  });

  it('two groups’ radios have names of their own', () => {
    const first = makeRadios();
    const second = makeRadios();
    expect(first.radios[0].getAttribute('name')).not.toBe(second.radios[0].getAttribute('name'));
    second.radios[2].click();
    expect(first.radios[1].checked).toBe(true);
  });

  it('a pick writes once with last: true; a click on the checked one writes nothing', () => {
    const { target, calls, radios } = makeRadios();
    radios[2].click();
    expect(target.mode).toBe('hard');
    expect(radios.map((radio) => radio.checked)).toEqual([false, false, true]);
    expect(calls).toEqual([{ value: 'hard', prev: 'normal', last: true, source: 'user' }]);
    radios[2].click();
    expect(calls).toHaveLength(1);
  });

  it('a value none of the options has checks none', () => {
    const { radios } = makeRadios({}, 'insane');
    expect(radios.some((radio) => radio.checked)).toBe(false);
  });

  it('takes numbers and booleans, compared with ===', () => {
    const target = { lanes: 2 };
    const field = createRadioGroup({
      label: 'Lanes',
      target,
      key: 'lanes',
      options: [1, 2, 4].map((value) => ({ value, label: String(value) })),
    });
    removers.push(() => field.cmp.remove());
    const radios = [...field.cmp.elem.querySelectorAll<HTMLInputElement>('input')];
    expect(radios[1].checked).toBe(true);
    radios[2].click();
    expect(target.lanes).toBe(4);
    field.setValue(1);
    expect(radios.map((radio) => radio.checked)).toEqual([true, false, false]);
  });

  it('a change from outside checks its radio and flashes the group, without onChange', () => {
    const scheduler = createBindingScheduler();
    const { target, group, radios, calls } = makeRadios({ scheduler });
    target.mode = 'easy';
    scheduler.refresh();
    expect(radios[0].checked).toBe(true);
    expect(group.hasAttribute('data-flash')).toBe(true);
    expect(calls).toEqual([]);
    scheduler.dispose();
  });

  it('a disabled option stays disabled when the field is enabled again', () => {
    const { field, radios } = makeRadios({
      options: [...OPTIONS.slice(0, 2), { value: 'hard', label: 'Hard', disabled: true }],
    });
    expect(radios.map((radio) => radio.hasAttribute('disabled'))).toEqual([false, false, true]);
    field.setDisabled(true);
    expect(radios.every((radio) => radio.hasAttribute('disabled'))).toBe(true);
    // The group too: its label is then an inactive control's
    expect(field.cmp.elem.querySelector('.aekRadioGroup')!.getAttribute('aria-disabled')).toBe(
      'true'
    );
    field.setDisabled(false);
    expect(radios.map((radio) => radio.hasAttribute('disabled'))).toEqual([false, false, true]);
  });

  it('focus() goes where Tab would: the checked radio, else the first that can be picked', () => {
    const { field, radios } = makeRadios();
    field.focus();
    expect(document.activeElement).toBe(radios[1]);
    const none = makeRadios(
      { options: [{ value: 'a', label: 'A', disabled: true }, ...OPTIONS] },
      'none'
    );
    none.field.focus();
    expect(document.activeElement).toBe(none.radios[1]);
  });

  it('the hint and the error describe the group, which an error marks', () => {
    const { field, root, group, radios } = makeRadios({ hint: 'Changes the enemies' });
    const message = root.querySelector('.aekField__message')!;
    expect(group.getAttribute('aria-describedby')).toBe(message.id);
    field.setError('Pick one');
    expect(group.getAttribute('aria-invalid')).toBe('true');
    expect(radios.some((radio) => radio.hasAttribute('aria-invalid'))).toBe(false);
  });

  it('a horizontal group, and its disposal', () => {
    const { field, group } = makeRadios({ orientation: 'horizontal' });
    expect(group.getAttribute('data-orientation')).toBe('horizontal');
    field.cmp.remove();
    expect(countListeners(group)).toBe(0);
  });
});

describe('the segmented control (p804 D7)', () => {
  const makeSegmented = (props: Partial<SegmentedControlProps<string>> = {}) => {
    const target = { state: 'play' };
    const calls: string[] = [];
    const field = createSegmentedControl<string>({
      label: 'Simulation',
      target,
      key: 'state',
      options: [
        { value: 'play', label: 'Play', icon: '<svg class="play"></svg>', iconOnly: true },
        { value: 'pause', label: 'Pause', icon: '<svg class="pause"></svg>' },
        { value: 'stop', label: 'Stop' },
      ],
      onChange: (value: string) => calls.push(value),
      ...props,
    } as SegmentedControlProps<string>);
    getHUDRootCMP().add(field.cmp);
    removers.push(() => field.cmp.remove());
    const root = field.cmp.elem;
    const group = root.querySelector<HTMLElement>('.aekSegmented')!;
    const segments = [...root.querySelectorAll<HTMLElement>('.aekSegmented__segment')];
    const radios = [...root.querySelectorAll<HTMLInputElement>('input')];
    return { field, target, calls, root, group, segments, radios };
  };

  it('the radios drawn as segments: text, an icon with text, an icon alone', () => {
    const { root, group, segments, radios } = makeSegmented();
    expect(root.getAttribute('data-kind')).toBe('segmented');
    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(radios.every((radio) => radio.className === 'aekSegmented__input')).toBe(true);
    expect(radios[0].checked).toBe(true);
    const [play, pause, stop] = segments;
    // Icon-only: its label is its name, visually hidden
    expect(play.querySelector('.aekSegmented__icon')!.getAttribute('aria-hidden')).toBe('true');
    expect(play.querySelector('.aekSegmented__label')!.className).toContain('aekVisuallyHidden');
    expect(play.textContent).toBe('Play');
    expect(pause.querySelector('.aekSegmented__icon svg')).not.toBe(null);
    expect(pause.querySelector('.aekSegmented__label')!.className).toBe('aekSegmented__label');
    expect(stop.querySelector('.aekSegmented__icon')).toBe(null);
    expect(group.hasAttribute('data-fill')).toBe(false);
  });

  it('a pick writes; fill shares the width', () => {
    const { target, calls, radios } = makeSegmented();
    radios[2].click();
    expect(target.state).toBe('stop');
    expect(calls).toEqual(['stop']);
    const filled = makeSegmented({ fill: true });
    expect(filled.group.hasAttribute('data-fill')).toBe(true);
  });

  it('removes its icon-only segments’ tooltips and its listener with it', () => {
    const { field, group, segments } = makeSegmented();
    // The tooltip listens on its anchor, the icon-only segment
    expect(countListeners(segments[0])).toBeGreaterThan(0);
    expect(countListeners(segments[1])).toBe(0);
    field.cmp.remove();
    expect(countListeners(segments[0])).toBe(0);
    expect(countListeners(group)).toBe(0);
  });
});
