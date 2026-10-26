import { beforeAll, describe, expect, it } from 'vitest';
import { stubKitDomAsync } from '../testing/KitDom';
import { createCheckbox } from './Checkbox';
import { createFieldset } from './Fieldset';
import { createNumberField } from './NumberField';
import { createSlider } from './Slider';

beforeAll(async () => {
  await stubKitDomAsync();
});

const isFieldDisabled = (elem: HTMLElement) => elem.hasAttribute('data-disabled');

describe('the fieldset (p804 D9)', () => {
  it('is a native fieldset named by its legend, described by its hint', () => {
    const fieldset = createFieldset({ legend: 'Account', hint: 'Shown to others', id: 'account' });
    const root = fieldset.cmp.elem;
    document.body.append(root);
    expect(root.tagName).toBe('FIELDSET');
    expect(root.id).toBe('account');
    expect(root.className).toBe('aekFieldset');
    const legend = root.querySelector('legend')!;
    expect(legend.textContent).toBe('Account');
    expect(legend.className).toBe('aekFieldset__legend');
    const hint = root.querySelector('.aekFieldset__hint')!;
    expect(hint.textContent).toBe('Shown to others');
    expect(root.getAttribute('aria-describedby')).toBe(hint.id);
    expect(root.firstElementChild).toBe(legend);
    fieldset.cmp.remove();
    const hidden = createFieldset({ legend: 'Hidden', legendHidden: true });
    expect(hidden.cmp.elem.querySelector('legend')!.className).toBe(
      'aekFieldset__legend aekVisuallyHidden'
    );
    expect(hidden.cmp.elem.hasAttribute('aria-describedby')).toBe(false);
  });

  it('holds its children in order after the legend', () => {
    const name = createNumberField({ label: 'Age', value: 30 });
    const ok = createCheckbox({ label: 'Public', value: true });
    const fieldset = createFieldset({ legend: 'Profile', children: [name] });
    fieldset.add(ok);
    expect([...fieldset.content.elem.children]).toEqual([name.cmp.elem, ok.cmp.elem]);
    fieldset.cmp.remove();
  });

  it('disabled, disables every field in it, the kit’s own stops too; enabled, keeps a field’s own', () => {
    const speed = createNumberField({ label: 'Speed', value: 1 });
    const volume = createSlider({ label: 'Volume', value: 5, min: 0, max: 10, showInput: false });
    const locked = createCheckbox({ label: 'Locked', value: true, disabled: true });
    const fieldset = createFieldset({ legend: 'Audio', children: [speed, volume, locked] });
    document.body.append(fieldset.cmp.elem);
    const thumb = volume.cmp.elem.querySelector('.aekSlider__thumb')!;
    expect(isFieldDisabled(speed.cmp.elem)).toBe(false);
    expect(thumb.getAttribute('tabindex')).toBe('0');
    fieldset.setDisabled(true);
    expect(fieldset.isDisabled()).toBe(true);
    expect(fieldset.cmp.elem.hasAttribute('disabled')).toBe(true);
    expect(isFieldDisabled(speed.cmp.elem)).toBe(true);
    expect(speed.cmp.elem.querySelector('input')!.hasAttribute('disabled')).toBe(true);
    // The browser's disabled doesn't reach a role="slider" thumb: the field's does
    expect(thumb.getAttribute('aria-disabled')).toBe('true');
    expect(thumb.hasAttribute('tabindex')).toBe(false);
    fieldset.setDisabled(false);
    expect(isFieldDisabled(speed.cmp.elem)).toBe(false);
    expect(thumb.getAttribute('tabindex')).toBe('0');
    expect(isFieldDisabled(locked.cmp.elem)).toBe(true);
    fieldset.cmp.remove();
  });

  it('a field added to a disabled fieldset is disabled, and stays so in a disabled inner one', () => {
    const outer = createFieldset({ legend: 'Outer', disabled: true });
    document.body.append(outer.cmp.elem);
    const speed = createNumberField({ label: 'Speed', value: 1 });
    outer.add(speed);
    expect(isFieldDisabled(speed.cmp.elem)).toBe(true);
    const inner = createFieldset({ legend: 'Inner', disabled: true });
    const size = createNumberField({ label: 'Size', value: 1 });
    inner.add(size);
    outer.add(inner);
    outer.setDisabled(false);
    expect(isFieldDisabled(speed.cmp.elem)).toBe(false);
    expect(isFieldDisabled(size.cmp.elem)).toBe(true);
    inner.setDisabled(false);
    expect(isFieldDisabled(size.cmp.elem)).toBe(false);
    outer.cmp.remove();
  });
});
