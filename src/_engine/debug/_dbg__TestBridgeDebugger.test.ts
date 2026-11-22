import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { stubKitDomAsync } from '../ui/testing/KitDom';
import { createPropertyGrid } from '../ui/forms/PropertyGrid';
import { addPropertyGridItems } from '../ui/forms/PropertyGridItems';
import { testBridgeDebugger } from './_dbg__TestBridgeDebugger';

// p806 D14: the bridge finds a debugger control by the name a script gives it

const PRECEDING = 2;
const FOLLOWING = 4;
const CONTAINS = 8;
const CONTAINED_BY = 16;

beforeAll(async () => {
  const { window } = await stubKitDomAsync();
  // linkedom's `Node` has no position flags, and its `compareDocumentPosition` reads an element in
  // another branch as preceding: the DOM's order, for the elements the bridge compares
  vi.stubGlobal('Node', {
    DOCUMENT_POSITION_PRECEDING: PRECEDING,
    DOCUMENT_POSITION_FOLLOWING: FOLLOWING,
  });
  Object.assign(window.HTMLElement.prototype, {
    compareDocumentPosition(this: Element, other: Element) {
      if (this === other) return 0;
      if (this.contains(other)) return CONTAINED_BY | FOLLOWING;
      if (other.contains(this)) return CONTAINS | PRECEDING;
      const all = [...document.querySelectorAll('*')];
      return all.indexOf(other) > all.indexOf(this) ? FOLLOWING : PRECEDING;
    },
  });
  // linkedom has none: every element is visible
  vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }));
});

afterEach(() => {
  document.body.replaceChildren();
});

/** A grid marked as the test root `drawer`: a labelled button row, then a button after it */
const makeWeatherGrid = () => {
  const grid = createPropertyGrid();
  addPropertyGridItems(grid, [
    { type: 'button', title: 'Rain shower', label: 'Weather', onClick: () => {} },
    { type: 'button', title: 'Dry', onClick: () => {} },
  ]);
  grid.cmp.elem.setAttribute('data-aek-test-root', 'drawer');
  document.body.append(grid.cmp.elem);
  const [rain, dry] = [...grid.cmp.elem.querySelectorAll('button')];
  return { rain, dry };
};

describe('focusDebuggerControl', () => {
  it('focuses a labelled row’s button by its own text, not the control after it (i180)', async () => {
    const { rain } = makeWeatherGrid();
    const result = await testBridgeDebugger.focusDebuggerControl({
      root: 'drawer',
      name: 'Rain shower',
    });
    expect(result).toEqual({ status: 'FOCUSED', tag: 'button' });
    expect(document.activeElement?.textContent).toBe('Rain shower');
    expect(document.activeElement).toBe(rain);
  });

  it('focuses the button by its row’s label and by its whole name', async () => {
    const { rain } = makeWeatherGrid();
    for (const name of ['Weather', 'Weather Rain shower']) {
      (document.activeElement as HTMLElement | null)?.blur();
      await testBridgeDebugger.focusDebuggerControl({ root: 'drawer', name });
      expect(document.activeElement).toBe(rain);
    }
  });
});
