import { beforeAll, describe, expect, it, vi } from 'vitest';
import { countListeners, dispatchKey, stubKitDomAsync } from '../testing/KitDom';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createButton } from './Button';
import { createButtonGroup, type ButtonGroupProps } from './ButtonGroup';

const click = (target: EventTarget) =>
  target.dispatchEvent(new window.Event('click', { bubbles: true }));

/** A group of toggles named by `labels`, the one at `pressed` pressed, added to the HUD root */
const addGroup = (
  labels: string[],
  pressed: number,
  props: Partial<ButtonGroupProps> = {},
  onPressedChange?: (pressed: boolean) => void
) => {
  const buttons = labels.map((label, i) =>
    createButton({ label, pressed: i === pressed, onPressedChange })
  );
  const group = createButtonGroup({ label: 'View', buttons, exclusive: true, ...props });
  getHUDRootCMP().add(group.cmp);
  return { group, elems: buttons.map((button) => button.cmp.elem) };
};

const getTabIndices = (elems: HTMLElement[]) => elems.map((e) => e.getAttribute('tabindex'));

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

describe('button group (p803 D10)', () => {
  it('is a named group of its buttons, each its own tab stop', () => {
    const buttons = ['Cut', 'Copy', 'Paste'].map((label) => createButton({ label }));
    const group = createButtonGroup({ label: 'Clipboard', buttons });
    const elem = group.cmp.elem;
    expect(elem.className).toBe('aekButtonGroup');
    expect(elem.getAttribute('role')).toBe('group');
    expect(elem.getAttribute('aria-label')).toBe('Clipboard');
    expect(elem.getAttribute('data-orientation')).toBe('horizontal');
    expect([...elem.children]).toEqual(buttons.map((b) => b.cmp.elem));
    expect(buttons.some((b) => b.cmp.elem.hasAttribute('tabindex'))).toBe(false);
    expect(countListeners(elem)).toBe(0);
    group.cmp.remove();
    expect(buttons[0].cmp.elem.isConnected).toBe(false);
  });

  it('exclusive: a toolbar whose tab stop is the pressed button', () => {
    const { group, elems } = addGroup(['Lit', 'Wire', 'Normals'], 1);
    expect(group.cmp.elem.getAttribute('role')).toBe('toolbar');
    expect(group.cmp.elem.hasAttribute('aria-orientation')).toBe(false);
    expect(getTabIndices(elems)).toEqual(['-1', '0', '-1']);
    expect(group.getPressedIndex()).toBe(1);
    group.cmp.remove();
  });

  it('exclusive: a press releases the pressed one; a press of the pressed one changes nothing', () => {
    const onChange = vi.fn();
    const onPressedChange = vi.fn();
    const { group, elems } = addGroup(['Lit', 'Wire', 'Normals'], 0, { onChange }, onPressedChange);
    click(elems[2]);
    expect(elems.map((e) => e.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
    expect(onChange).toHaveBeenCalledWith(2);
    expect(onPressedChange).toHaveBeenCalledTimes(1);
    expect(getTabIndices(elems)).toEqual(['-1', '-1', '0']);
    click(elems[2]);
    expect(elems[2].getAttribute('aria-pressed')).toBe('true');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onPressedChange).toHaveBeenCalledTimes(1);
    group.setPressedIndex(0);
    expect(group.getPressedIndex()).toBe(0);
    expect(onChange).toHaveBeenCalledTimes(1);
    group.cmp.remove();
  });

  it('exclusive: the arrows, Home and End move the focus and the tab stop, skipping disabled', () => {
    const { group, elems } = addGroup(['A', 'B', 'C', 'D'], 0);
    elems[2].setAttribute('disabled', '');
    elems[0].focus();
    expect(dispatchKey(elems[0], 'keydown', 'ArrowRight').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(elems[1]);
    expect(getTabIndices(elems)).toEqual(['-1', '0', '-1', '-1']);
    // The focus moves; the pressed button stays
    expect(group.getPressedIndex()).toBe(0);
    dispatchKey(elems[1], 'keydown', 'ArrowRight');
    expect(document.activeElement).toBe(elems[3]);
    dispatchKey(elems[3], 'keydown', 'ArrowRight');
    expect(document.activeElement).toBe(elems[0]);
    dispatchKey(elems[0], 'keydown', 'ArrowLeft');
    expect(document.activeElement).toBe(elems[3]);
    dispatchKey(elems[3], 'keydown', 'Home');
    expect(document.activeElement).toBe(elems[0]);
    dispatchKey(elems[0], 'keydown', 'End');
    expect(document.activeElement).toBe(elems[3]);
    expect(dispatchKey(elems[3], 'keydown', 'ArrowDown').defaultPrevented).toBe(false);
    expect(dispatchKey(elems[3], 'keydown', 'Tab').defaultPrevented).toBe(false);
    group.cmp.remove();
  });

  it('exclusive and vertical: Up and Down move, and the toolbar says its orientation', () => {
    const { group, elems } = addGroup(['A', 'B'], 0, { orientation: 'vertical' });
    expect(group.cmp.elem.getAttribute('aria-orientation')).toBe('vertical');
    elems[0].focus();
    expect(dispatchKey(elems[0], 'keydown', 'ArrowRight').defaultPrevented).toBe(false);
    dispatchKey(elems[0], 'keydown', 'ArrowDown');
    expect(document.activeElement).toBe(elems[1]);
    group.cmp.remove();
    expect(countListeners(group.cmp.elem)).toBe(0);
  });

  it('exclusive: the focus moving in by a click or code moves the tab stop', () => {
    const { group, elems } = addGroup(['A', 'B', 'C'], 0);
    elems[2].focus();
    expect(getTabIndices(elems)).toEqual(['-1', '-1', '0']);
    group.cmp.remove();
  });
});
