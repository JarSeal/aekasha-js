import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { countListeners, stubKitDomAsync } from '../testing/KitDom';
import { createBindingScheduler } from './binding/BindingScheduler';
import { createCheckbox, createSwitch } from './Checkbox';
import type { Field } from './Field';
import { createMonitor, type MonitorProps } from './Monitor';
import { createNumberField } from './NumberField';
import { createRadioGroup, createSegmentedControl } from './RadioGroup';
import { createRangeSlider } from './RangeSlider';
import { createSelectField } from './SelectField';
import { createSlider } from './Slider';
import { createTextField } from './TextField';

beforeAll(async () => {
  await stubKitDomAsync();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Any field: only its element is read */
type Shown = Pick<Field<never>, 'cmp'>;

const added: Shown[] = [];
const add = <F extends Shown>(field: F) => {
  document.body.append(field.cmp.elem);
  added.push(field);
  return field;
};
afterEach(() => {
  for (const field of added.splice(0)) field.cmp.remove();
});

const textOf = (field: Shown) =>
  field.cmp.elem.querySelector('.aekMonitor__value')?.textContent ??
  field.cmp.elem.querySelector('textarea')?.value;

const makeMonitor = <T>(props: Partial<MonitorProps<T>>) =>
  add(createMonitor({ label: 'Speed', ...props } as MonitorProps<T>));

describe('the monitor (p804 D7)', () => {
  it('shows the value as text after its label, which names nothing; no reset, no live region', () => {
    const monitor = makeMonitor({ value: 1.5, unit: 'm/s', id: 'speedMonitor' });
    const root = monitor.cmp.elem;
    expect(root.querySelector('.aekMonitor')!.id).toBe('speedMonitor');
    expect(root.getAttribute('data-kind')).toBe('monitor');
    const label = root.querySelector('.aekField__label')!;
    expect(label.tagName).toBe('SPAN');
    expect(label.hasAttribute('for')).toBe(false);
    const line = root.querySelector('.aekMonitor')!;
    expect(line.tagName).toBe('SPAN');
    // A name on a plain span is ARIA's prohibited attribute; and not a live region (D7)
    for (const attr of ['role', 'aria-labelledby', 'aria-label', 'aria-live']) {
      expect(line.hasAttribute(attr)).toBe(false);
    }
    expect(root.querySelector('[aria-live], [role="status"]')).toBeNull();
    expect(textOf(monitor)).toBe('1.50');
    expect(root.querySelector('.aekMonitor__unit')!.textContent).toBe('m/s');
    expect(root.querySelector('.aekField__reset')).toBeNull();
    expect(root.querySelector('input, button')).toBeNull();
  });

  it('writes a number in its decimals, a boolean, a string and a vector’s axes', () => {
    expect(textOf(makeMonitor({ value: 2 }))).toBe('2.00');
    expect(textOf(makeMonitor({ value: 1.23456 }))).toBe('1.23456');
    expect(textOf(makeMonitor({ value: 1.23456, precision: 1 }))).toBe('1.2');
    expect(textOf(makeMonitor({ value: true }))).toBe('On');
    expect(textOf(makeMonitor({ value: false, offText: 'Idle' }))).toBe('Idle');
    expect(textOf(makeMonitor({ value: 'Loading' }))).toBe('Loading');
    expect(textOf(makeMonitor({ value: { x: 1, y: -2, z: 0.5 }, precision: 1 }))).toBe(
      '1.0, -2.0, 0.5'
    );
    expect(textOf(makeMonitor({ value: 3, format: (v: number) => `#${v}` }))).toBe('#3');
  });

  it('reads a vector changed in place axis by axis', () => {
    const position = { x: 0, y: 0, z: 0 };
    const monitor = makeMonitor({ target: { position }, key: 'position', precision: 0 });
    position.y = 4;
    monitor.refresh();
    expect(textOf(monitor)).toBe('0, 4, 0');
  });

  it('reads on its scheduler’s tick every 200 ms by default, never firing onChange', () => {
    vi.useFakeTimers();
    const stats = { ms: 16 };
    const onChange = vi.fn();
    const scheduler = createBindingScheduler();
    const monitor = makeMonitor({ target: stats, key: 'ms', precision: 0, scheduler, onChange });
    const value = monitor.cmp.elem.querySelector('.aekMonitor__value')!;
    const node = value.firstChild;
    vi.advanceTimersByTime(16);
    stats.ms = 20;
    vi.advanceTimersByTime(100);
    expect(textOf(monitor)).toBe('16');
    vi.advanceTimersByTime(250);
    expect(textOf(monitor)).toBe('20');
    // One text node, its data written (no node replaced: a style recalc)
    expect(value.firstChild).toBe(node);
    expect(value.childNodes.length).toBe(1);
    // An unchanged value writes nothing
    const writes = vi.spyOn(node as Text, 'data', 'set');
    vi.advanceTimersByTime(1000);
    expect(writes).not.toHaveBeenCalled();
    stats.ms = 21;
    vi.advanceTimersByTime(250);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    scheduler.dispose();
  });

  it('takes its own interval; a refresh reads it without a flash', () => {
    vi.useFakeTimers();
    const stats = { ms: 1 };
    const scheduler = createBindingScheduler();
    const monitor = makeMonitor({ target: stats, key: 'ms', interval: 1000, scheduler });
    // Its first read is the first frame's
    vi.advanceTimersByTime(16);
    stats.ms = 2;
    vi.advanceTimersByTime(500);
    expect(textOf(monitor)).toBe('1.00');
    scheduler.refresh();
    expect(textOf(monitor)).toBe('2.00');
    expect(monitor.cmp.elem.querySelector('[data-flash]')).toBeNull();
    scheduler.dispose();
  });

  it('without a scheduler, ticks on the page’s shared one until it’s removed', () => {
    vi.useFakeTimers();
    const stats = { ms: 1 };
    const a = makeMonitor({ target: stats, key: 'ms', interval: 0 });
    const b = makeMonitor({ get: () => stats.ms * 2, interval: 0 });
    // One listener for both: one tick
    expect(countListeners(document, 'visibilitychange')).toBe(1);
    stats.ms = 3;
    vi.advanceTimersByTime(32);
    expect(textOf(a)).toBe('3.00');
    expect(textOf(b)).toBe('6.00');
    a.cmp.remove();
    b.cmp.remove();
    expect(countListeners(document, 'visibilitychange')).toBe(0);
  });

  it('holding its own value, joins no tick: setValue draws it, firing onChange', () => {
    const onChange = vi.fn();
    const monitor = makeMonitor({ value: 'Idle', onChange });
    expect(countListeners(document, 'visibilitychange')).toBe(0);
    monitor.setValue('Running');
    expect(textOf(monitor)).toBe('Running');
    expect(onChange).toHaveBeenCalledWith('Running', expect.objectContaining({ source: 'api' }));
  });

  it('takes a getter alone: setValue draws its value until the next read', () => {
    let frames = 10;
    const monitor = makeMonitor({ get: () => frames, precision: 0 });
    monitor.setValue(99);
    expect(textOf(monitor)).toBe('99');
    frames = 11;
    monitor.refresh();
    expect(textOf(monitor)).toBe('11');
  });

  it('with multiline, is a read-only text area its label names, rows high', () => {
    const monitor = makeMonitor({ value: 'a\nb', multiline: true, hint: 'Per domain' });
    const area = monitor.cmp.elem.querySelector('textarea')!;
    expect(area.className).toBe('aekMonitor aekMonitor__text');
    expect(area.hasAttribute('readonly')).toBe(true);
    expect(area.getAttribute('rows')).toBe('3');
    expect(area.value).toBe('a\nb');
    const label = monitor.cmp.elem.querySelector('label')!;
    expect(label.getAttribute('for')).toBe(area.id);
    expect(area.getAttribute('aria-describedby')).toBe(
      monitor.cmp.elem.querySelector('.aekField__message')!.id
    );
    expect(
      makeMonitor({ value: '', multiline: true, rows: 8 })
        .cmp.elem.querySelector('textarea')!
        .getAttribute('rows')
    ).toBe('8');
  });

  it('disabled, marks the field; the text area is disabled', () => {
    const line = makeMonitor({ value: 1, disabled: true });
    expect(line.cmp.elem.hasAttribute('data-disabled')).toBe(true);
    const block = makeMonitor({ value: 'x', multiline: true });
    block.setDisabled(true);
    expect(block.cmp.elem.querySelector('textarea')!.hasAttribute('disabled')).toBe(true);
  });

  it('leaves no listener on its label after it’s removed', () => {
    const monitor = createMonitor({ label: 'Speed', target: { v: 1 }, key: 'v' });
    document.body.append(monitor.cmp.elem);
    const label = monitor.cmp.elem.querySelector('.aekField__label')!;
    monitor.cmp.remove();
    expect(countListeners(label)).toBe(0);
    expect(countListeners(document, 'visibilitychange')).toBe(0);
  });
});

describe('readonly: true on every field (p804 D7)', () => {
  const isMonitor = (field: Shown) =>
    field.cmp.elem.getAttribute('data-kind') === 'monitor' &&
    !field.cmp.elem.querySelector('input, button, [role="slider"]');

  it('takes a getter alone', () => {
    const stats = { ms: 16.25 };
    const number = add(
      createNumberField({ label: 'Frame', get: () => stats.ms, precision: 1, readonly: true })
    );
    expect(textOf(number)).toBe('16.3');
  });

  it('a number field and a slider: their format and unit', () => {
    const number = add(
      createNumberField({ label: 'Speed', value: 1.25, step: 0.1, unit: 'm/s', readonly: true })
    );
    expect(isMonitor(number)).toBe(true);
    expect(textOf(number)).toBe('1.3');
    expect(number.cmp.elem.querySelector('.aekMonitor__unit')!.textContent).toBe('m/s');
    const slider = add(
      createSlider({
        label: 'Volume',
        value: 0.5,
        min: 0,
        max: 1,
        format: (v) => `${v * 100} %`,
        readonly: true,
      })
    );
    expect(isMonitor(slider)).toBe(true);
    expect(textOf(slider)).toBe('50 %');
  });

  it('a range slider: its two ends, read in place', () => {
    const filters = { price: { min: 10, max: 50 } };
    const range = add(
      createRangeSlider({
        label: 'Price',
        target: filters,
        key: 'price',
        min: 0,
        max: 100,
        step: 1,
        readonly: true,
      })
    );
    expect(isMonitor(range)).toBe(true);
    expect(textOf(range)).toBe('10 to 50');
    filters.price.max = 60;
    range.refresh();
    expect(textOf(range)).toBe('10 to 60');
  });

  it('a checkbox (mixed too) and a switch: their state as text', () => {
    const checkbox = add(createCheckbox({ label: 'Shadows', value: true, readonly: true }));
    expect(isMonitor(checkbox)).toBe(true);
    expect(textOf(checkbox)).toBe('On');
    checkbox.setIndeterminate(true);
    expect(checkbox.isIndeterminate()).toBe(true);
    expect(textOf(checkbox)).toBe('Mixed');
    const toggle = add(
      createSwitch({ label: 'V-sync', value: false, offText: 'Off (tearing)', readonly: true })
    );
    expect(textOf(toggle)).toBe('Off (tearing)');
  });

  it('a radio group, a segmented control and a select: the option’s label', () => {
    const options = [
      { value: 'easy', label: 'Easy' },
      { value: 'hard', label: 'Hard' },
    ];
    const radio = add(createRadioGroup({ label: 'Mode', value: 'hard', options, readonly: true }));
    expect(isMonitor(radio)).toBe(true);
    expect(textOf(radio)).toBe('Hard');
    const segmented = add(
      createSegmentedControl({ label: 'Mode', value: 'easy', options, readonly: true })
    );
    expect(textOf(segmented)).toBe('Easy');
    let names: Record<string, number> = { Low: 1, High: 2 };
    const select = add(
      createSelectField<number>({
        label: 'Quality',
        value: 2,
        options: () => names,
        readonly: true,
      })
    );
    expect(isMonitor(select)).toBe(true);
    expect(textOf(select)).toBe('High');
    // A getter's label changed while the value didn't: the refresh draws it
    names = { Low: 1, Best: 2 };
    select.refresh();
    expect(textOf(select)).toBe('Best');
    const none = add(
      createSelectField<number>({
        label: 'Map',
        value: 9,
        options: names,
        placeholder: 'None',
        readonly: true,
      })
    );
    expect(textOf(none)).toBe('None');
  });

  it('a text field: the text, multiline as a text area', () => {
    const line = add(createTextField({ label: 'Name', value: 'Ada', readonly: true }));
    expect(isMonitor(line)).toBe(true);
    expect(textOf(line)).toBe('Ada');
    const block = add(
      createTextField({ label: 'Log', value: 'a\nb', multiline: true, rows: 5, readonly: true })
    );
    expect(block.cmp.elem.querySelector('textarea')!.getAttribute('rows')).toBe('5');
    expect(block.cmp.elem.querySelector('textarea')!.hasAttribute('readonly')).toBe(true);
  });
});
