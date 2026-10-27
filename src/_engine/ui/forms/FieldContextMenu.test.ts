import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { countListeners, dispatchKey, stubClipboard, stubKitDomAsync } from '../testing/KitDom';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createFieldContextMenu } from './FieldContextMenu';
import { createNumberField } from './NumberField';
import { createColorField } from './color/ColorField';
import { createVectorField } from './VectorField';
import { createMonitor } from './Monitor';
import { createSelectField } from './SelectField';
import { createCheckbox } from './Checkbox';
import type { Field } from './Field';

let container: HTMLElement;
let clipboard: ReturnType<typeof stubClipboard>;

const getMenus = () => [...getHUDRootCMP().elem.querySelectorAll<HTMLElement>('.aekMenu')];
/** The open menus' items: label → element */
const getItem = (label: string) =>
  [...getHUDRootCMP().elem.querySelectorAll<HTMLElement>('.aekMenu__item')].find(
    (item) => item.querySelector('.aekMenu__label')?.textContent === label
  );
const isDisabled = (label: string) => getItem(label)?.getAttribute('aria-disabled') === 'true';
const click = (target: EventTarget) =>
  target.dispatchEvent(new window.Event('click', { bubbles: true }));
const rightClick = (target: EventTarget) =>
  target.dispatchEvent(new window.Event('contextmenu', { bubbles: true, cancelable: true }));

const add = <T>(field: Field<T>) => {
  container.append(field.cmp.elem);
  return field;
};
const labelOf = (field: { cmp: { elem: HTMLElement } }) =>
  field.cmp.elem.querySelector('.aekField__label') as HTMLElement;

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

beforeEach(() => {
  container = document.createElement('div');
  getHUDRootCMP().elem.appendChild(container);
  clipboard = stubClipboard();
});

afterEach(() => {
  container.remove();
  clipboard.restore();
});

describe('the fields’ context menu (p805 D11)', () => {
  it('opens on a field’s label, named by it; Reset is off at the default and resets', () => {
    const target = { speed: 2 };
    const speed = add(createNumberField({ label: 'Speed', target, key: 'speed', step: 0.5 }));
    const menu = createFieldContextMenu({ container });
    expect(rightClick(labelOf(speed))).toBe(false);
    expect(getMenus()[0].getAttribute('aria-label')).toBe('Speed');
    expect(isDisabled('Reset')).toBe(true);
    menu.close();
    speed.setValue(4);
    rightClick(labelOf(speed));
    expect(isDisabled('Reset')).toBe(false);
    click(getItem('Reset') as HTMLElement);
    expect(target.speed).toBe(2);
    expect(menu.isOpen()).toBe(false);
    menu.cmp.remove();
    speed.cmp.remove();
  });

  it('a right click on the control keeps the browser’s menu; the keys open it from the control', () => {
    const speed = add(createNumberField({ label: 'Speed', value: 2 }));
    const menu = createFieldContextMenu({ container });
    const input = speed.cmp.elem.querySelector('input') as HTMLInputElement;
    expect(rightClick(input)).toBe(true);
    expect(menu.isOpen()).toBe(false);
    input.focus();
    expect(dispatchKey(input, 'keydown', 'ContextMenu').defaultPrevented).toBe(true);
    expect(menu.isOpen()).toBe(true);
    dispatchKey(document.activeElement as HTMLElement, 'keydown', 'Escape');
    expect(document.activeElement).toBe(input);
    // Outside any field: nothing
    expect(rightClick(container)).toBe(true);
    menu.cmp.remove();
    speed.cmp.remove();
  });

  it('Copy puts the value’s text on the clipboard; Paste writes a pasted value, kept to its rules', async () => {
    const target = { speed: 2 };
    const onChange = vi.fn();
    const speed = add(
      createNumberField({ label: 'Speed', target, key: 'speed', step: 0.5, max: 10, onChange })
    );
    const menu = createFieldContextMenu({ container });
    rightClick(labelOf(speed));
    click(getItem('Copy') as HTMLElement);
    await vi.waitFor(() => expect(clipboard.getText()).toBe('2'));
    clipboard.setText('3.3');
    rightClick(labelOf(speed));
    click(getItem('Paste') as HTMLElement);
    await vi.waitFor(() => expect(target.speed).toBe(3.5));
    expect(onChange).toHaveBeenLastCalledWith(
      3.5,
      expect.objectContaining({ source: 'user', last: true })
    );
    // An expression, as typed; then a text that isn't one: the field's message
    clipboard.setText('100 / 4');
    rightClick(labelOf(speed));
    click(getItem('Paste') as HTMLElement);
    await vi.waitFor(() => expect(target.speed).toBe(10));
    clipboard.setText('fast');
    rightClick(labelOf(speed));
    click(getItem('Paste') as HTMLElement);
    await vi.waitFor(() => expect(speed.cmp.elem.getAttribute('data-invalid')).toBe(''));
    expect(target.speed).toBe(10);
    menu.cmp.remove();
    speed.cmp.remove();
  });

  it('Copy as: a colour’s hex, rgb() and sRGB floats; a vector’s array and object', async () => {
    const tint = add(createColorField({ label: 'Tint', value: '#ff8000' }));
    const offset = add(createVectorField({ label: 'Offset', value: { x: 1, y: 2.5, z: -3 } }));
    const menu = createFieldContextMenu({ container });
    const copyAs = async (field: { cmp: { elem: HTMLElement } }, form: string) => {
      rightClick(labelOf(field));
      click(getItem('Copy as') as HTMLElement);
      click(getItem(form) as HTMLElement);
      await vi.waitFor(() => expect(menu.isOpen()).toBe(false));
      return clipboard.getText();
    };
    expect(await copyAs(tint, 'Hex')).toBe('#ff8000');
    expect(await copyAs(tint, 'rgb()')).toBe('rgb(255, 128, 0)');
    expect(await copyAs(tint, 'sRGB floats')).toBe('1, 0.502, 0');
    expect(await copyAs(offset, 'Array')).toBe('[1, 2.5, -3]');
    expect(await copyAs(offset, 'Object')).toBe('{ x: 1, y: 2.5, z: -3 }');
    // A colour pasted as typed text is; a vector's list of numbers
    clipboard.setText('rgb(0, 0, 255)');
    rightClick(labelOf(tint));
    click(getItem('Paste') as HTMLElement);
    await vi.waitFor(() => expect(tint.getValue()).toBe('#0000ff'));
    clipboard.setText('(4, 5, 6)');
    rightClick(labelOf(offset));
    click(getItem('Paste') as HTMLElement);
    await vi.waitFor(() => expect(offset.getValue()).toEqual({ x: 4, y: 5, z: 6 }));
    menu.cmp.remove();
    tint.cmp.remove();
    offset.cmp.remove();
  });

  it('a choice copies its label and pastes a label or a value; a checkbox on and off', async () => {
    const shadows = add(
      createSelectField({
        label: 'Shadows',
        value: 1024,
        options: [
          { label: 'Low', value: 512 },
          { label: 'High', value: 1024 },
        ],
      })
    );
    const grid = add(createCheckbox({ label: 'Grid', value: false }));
    const menu = createFieldContextMenu({ container });
    rightClick(labelOf(shadows));
    click(getItem('Copy') as HTMLElement);
    await vi.waitFor(() => expect(clipboard.getText()).toBe('High'));
    clipboard.setText('low');
    rightClick(labelOf(shadows));
    click(getItem('Paste') as HTMLElement);
    await vi.waitFor(() => expect(shadows.getValue()).toBe(512));
    clipboard.setText('on');
    rightClick(labelOf(grid));
    click(getItem('Paste') as HTMLElement);
    await vi.waitFor(() => expect(grid.getValue()).toBe(true));
    menu.cmp.remove();
    shadows.cmp.remove();
    grid.cmp.remove();
  });

  it('a monitor copies its text; its Reset and Paste are off, as a disabled field’s are', () => {
    const fps = add(createMonitor({ label: 'FPS', get: () => 59.94, precision: 1 }));
    const speed = add(createNumberField({ label: 'Speed', value: 2, disabled: true }));
    const menu = createFieldContextMenu({ container });
    rightClick(labelOf(fps));
    expect(isDisabled('Reset')).toBe(true);
    expect(isDisabled('Copy')).toBe(false);
    expect(isDisabled('Paste')).toBe(true);
    expect(getItem('Copy as')).toBeUndefined();
    menu.close();
    speed.setValue(3);
    rightClick(labelOf(speed));
    expect(isDisabled('Reset')).toBe(true);
    expect(isDisabled('Paste')).toBe(true);
    expect(isDisabled('Copy')).toBe(false);
    menu.cmp.remove();
    fps.cmp.remove();
    speed.cmp.remove();
  });

  it('without a clipboard Copy, Paste and Copy as are off; a refused read pastes nothing', async () => {
    const tint = add(createColorField({ label: 'Tint', value: '#ff8000' }));
    const menu = createFieldContextMenu({ container });
    clipboard.restore();
    rightClick(labelOf(tint));
    expect(isDisabled('Copy')).toBe(true);
    expect(isDisabled('Paste')).toBe(true);
    expect(isDisabled('Copy as')).toBe(true);
    menu.close();
    clipboard = stubClipboard({ text: '#000000', readable: false });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    rightClick(labelOf(tint));
    click(getItem('Paste') as HTMLElement);
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(tint.getValue()).toBe('#ff8000');
    warn.mockRestore();
    menu.cmp.remove();
    tint.cmp.remove();
  });

  it('a paste whose field went while the clipboard was read writes nothing', async () => {
    const onChange = vi.fn();
    const speed = add(createNumberField({ label: 'Speed', value: 2, onChange }));
    const menu = createFieldContextMenu({ container });
    clipboard.setText('5');
    rightClick(labelOf(speed));
    click(getItem('Paste') as HTMLElement);
    speed.cmp.remove();
    await Promise.resolve();
    await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();
    menu.cmp.remove();
    expect(countListeners(container)).toBe(0);
  });
});
