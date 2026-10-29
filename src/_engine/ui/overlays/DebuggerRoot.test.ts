import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { stubKitDomAsync } from '../testing/KitDom';
import { CMP } from '../core/CMP';
import {
  getDebuggerRootAttr,
  getDebuggerRootProps,
  getDebuggerTheme,
  setDebuggerTheme,
  type DebuggerTheme,
} from './DebuggerRoot';
import { DEBUGGER_ROOT_ATTR } from './OverlayStack';

beforeAll(async () => {
  await stubKitDomAsync();
});

afterEach(() => {
  setDebuggerTheme('dark');
  document.body.replaceChildren();
});

/** A root CMP mounted under a parent in the page, as the HUD root's children are */
const mountRoot = () => {
  const parent = CMP();
  document.body.append(parent.elem);
  const root = parent.add({ ...getDebuggerRootProps() });
  return { parent, root };
};

describe('the debugger roots (p806 D8)', () => {
  it('makes a root a debugger root in the dark theme and the compact density by default', () => {
    expect(getDebuggerTheme()).toBe('dark');
    expect(getDebuggerRootAttr()).toEqual({
      [DEBUGGER_ROOT_ATTR]: '',
      'data-aek-theme': 'dark',
      'data-aek-density': 'compact',
    });
    const { root } = mountRoot();
    expect(root.elem.getAttribute('data-aek-theme')).toBe('dark');
    expect(root.elem.getAttribute('data-aek-density')).toBe('compact');
    expect(root.elem.hasAttribute(DEBUGGER_ROOT_ATTR)).toBe(true);
  });

  it('changes every mounted root live, and the app theme sets none', () => {
    const { root: first } = mountRoot();
    const { root: second } = mountRoot();
    setDebuggerTheme('light');
    for (const root of [first, second]) {
      expect(root.elem.getAttribute('data-aek-theme')).toBe('light');
    }
    expect(getDebuggerRootAttr()['data-aek-theme']).toBe('light');

    setDebuggerTheme('app');
    expect(first.elem.hasAttribute('data-aek-theme')).toBe(false);
    expect(getDebuggerRootAttr()).not.toHaveProperty('data-aek-theme');
    // The density and the root attribute stay
    expect(first.elem.getAttribute('data-aek-density')).toBe('compact');
    expect(first.elem.hasAttribute(DEBUGGER_ROOT_ATTR)).toBe(true);

    // Through the CMP's props: an update() rebuilds the element with the theme it has now
    first.update({ class: 'rebuilt' });
    expect(first.elem.hasAttribute('data-aek-theme')).toBe(false);
    setDebuggerTheme('dark');
    first.update({ class: 'again' });
    expect(first.elem.getAttribute('data-aek-theme')).toBe('dark');
  });

  it('gives a root made before a change and mounted after it the theme of its mount', () => {
    const parent = CMP();
    document.body.append(parent.elem);
    const root = CMP({ ...getDebuggerRootProps() });
    setDebuggerTheme('light');
    parent.add(root);
    expect(root.elem.getAttribute('data-aek-theme')).toBe('light');
  });

  it('lets a removed root go, and ignores a theme it does not know', () => {
    const { root } = mountRoot();
    root.remove();
    setDebuggerTheme('light');
    // Not written: the removed root's element keeps what it had
    expect(root.elem.getAttribute('data-aek-theme')).toBe('dark');

    setDebuggerTheme('blue' as DebuggerTheme);
    expect(getDebuggerTheme()).toBe('light');
  });
});
