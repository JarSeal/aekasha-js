import { beforeAll, describe, expect, it } from 'vitest';
import { countListeners, dispatchKey, stubKitDomAsync } from '../testing/KitDom';
import { getFirstFocusable, getFocusableElements, trapFocus } from './FocusTrap';

/** A dialog-like element: a disabled button, two buttons, an input and a hidden one */
const createTrapElem = () => {
  const elem = document.createElement('div');
  elem.setAttribute('tabindex', '-1');
  elem.innerHTML =
    '<button disabled>Off</button><button id="first">First</button>' +
    '<span tabindex="-1">Not by Tab</span><input id="last" /><input type="hidden" />';
  document.body.appendChild(elem);
  return {
    elem,
    first: elem.querySelector<HTMLElement>('#first')!,
    last: elem.querySelector<HTMLElement>('#last')!,
  };
};

beforeAll(() => stubKitDomAsync());

describe('focus trap (p803 D7)', () => {
  it('finds what Tab reaches, in document order', () => {
    const { elem, first, last } = createTrapElem();
    expect(getFocusableElements(elem)).toEqual([first, last]);
    expect(getFirstFocusable(elem)).toBe(first);
    expect(getFirstFocusable(document.createElement('div'))).toBeNull();
    expect(getFirstFocusable()).toBeNull();
    elem.remove();
  });

  it('wraps Tab from the last to the first, and Shift+Tab back', () => {
    const { elem, first, last } = createTrapElem();
    const removeTrap = trapFocus(elem);
    last.focus();
    expect(dispatchKey(last, 'keydown', 'Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    expect(dispatchKey(first, 'keydown', 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    // From the trapping element itself, Shift+Tab goes to the last too
    elem.focus();
    dispatchKey(elem, 'keydown', 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(last);
    removeTrap();
    elem.remove();
  });

  it('leaves a Tab between the edges to the browser', () => {
    const { elem, first } = createTrapElem();
    const removeTrap = trapFocus(elem);
    first.focus();
    expect(dispatchKey(first, 'keydown', 'Tab').defaultPrevented).toBe(false);
    expect(dispatchKey(first, 'keydown', 'Tab', { ctrlKey: true }).defaultPrevented).toBe(false);
    removeTrap();
    elem.remove();
  });

  it('keeps the focus with nothing to go to, and removes its listener', () => {
    const elem = document.createElement('div');
    elem.setAttribute('tabindex', '-1');
    document.body.appendChild(elem);
    const removeTrap = trapFocus(elem);
    elem.focus();
    expect(dispatchKey(elem, 'keydown', 'Tab').defaultPrevented).toBe(true);
    expect(countListeners(elem)).toBe(1);
    removeTrap();
    expect(countListeners(elem)).toBe(0);
    elem.remove();
  });
});
