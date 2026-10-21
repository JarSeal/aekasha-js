import { afterEach, describe, expect, it, vi } from 'vitest';

// The tab host builds DOM: linkedom's document and window, stubbed in this file only
const dom = vi.hoisted(async () => {
  const { parseHTML } = await import('linkedom');
  return parseHTML('<!doctype html><html><head></head><body></body></html>');
});
vi.stubGlobal('document', (await dom).document);
vi.stubGlobal('window', (await dom).window);
vi.stubGlobal('HTMLInputElement', (await dom).window.HTMLInputElement);

vi.mock(import('../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lerror: vi.fn(),
}));

import { CMP } from '../ui/CMP';
import { lerror } from '../utils/Logger';
import type { AnyDebuggerTabDef } from './DebuggerGUI';
import { createTabHost } from './_dbg__TabHost';

// Each test's containers are removed after it: a CMP id stays taken while its CMP exists
const containers: ReturnType<typeof CMP>[] = [];
afterEach(() => {
  for (const container of containers.splice(0)) container.remove();
});

const createHost = () => {
  const container = CMP();
  containers.push(container);
  const host = createTabHost({ getContainer: () => container, isVisible: () => true });
  return { container, host };
};

const throwingTab: AnyDebuggerTabDef = {
  id: 'broken',
  title: 'Broken',
  icon: 'gear',
  content: () => {
    throw new Error('content failed');
  },
};

describe('tab host: a failing tab (p618 §1.4)', () => {
  // B3: a throwing content() threw out of mount(), and with it out of the drawer's build and
  // setCurrentScene, on every scene load while the tab was the saved one
  it("doesn't throw when a tab's content throws (B3)", () => {
    const { container, host } = createHost();
    expect(() => host.mount(throwingTab)).not.toThrow();
    expect(host.mountedId).toBe('broken');
    expect(container.elem.textContent).toContain('This tab failed to build: content failed');
    expect(lerror).toHaveBeenCalled();
  });

  it('runs no onOpen for a failed tab, and stays mountable', () => {
    const { container, host } = createHost();
    const onOpen = vi.fn();
    host.mount({ ...throwingTab, onOpen });
    expect(onOpen).not.toHaveBeenCalled();

    const cleanup = vi.fn();
    host.mount({
      id: 'working',
      title: 'Working',
      icon: 'gear',
      onOpen: () => cleanup,
      content: () => [CMP({ text: 'fine' })],
    });
    expect(host.mountedId).toBe('working');
    expect(container.elem.textContent).toContain('fine');
    expect(container.elem.textContent).not.toContain('failed to build');
    host.unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('keeps the tab when its onRefresh throws', () => {
    const { container, host } = createHost();
    host.mount({
      id: 'refreshThrows',
      title: 'Refresh throws',
      icon: 'gear',
      onRefresh: () => {
        throw new Error('onRefresh failed');
      },
      content: () => [CMP({ text: 'built' })],
    });
    expect(container.elem.textContent).toContain('built');
    expect(() => host.refresh()).not.toThrow();
  });

  it("logs a section's failing refresh instead of throwing", () => {
    const { host } = createHost();
    let shouldThrow = false;
    host.mount({
      id: 'sectionThrows',
      title: 'Section throws',
      icon: 'gear',
      content: () => [
        CMP({
          html: () => {
            if (shouldThrow) throw new Error('html failed');
            return '<div>ok</div>';
          },
        }),
      ],
    });
    shouldThrow = true;
    vi.mocked(lerror).mockClear();
    expect(() => host.refresh()).not.toThrow();
    expect(lerror).toHaveBeenCalledTimes(1);
  });
});

describe('tab host: refresh', () => {
  // F3: a changed section's html ran twice per refresh (the comparison, then the update)
  it("computes a section's html once per refresh, and re-renders only on a change", () => {
    const { container, host } = createHost();
    let count = 0;
    const html = vi.fn(() => `<div>count ${count}</div>`);
    host.mount({ id: 'counter', title: 'Counter', icon: 'gear', content: () => [CMP({ html })] });

    html.mockClear();
    host.refresh();
    expect(html).toHaveBeenCalledTimes(1);

    count = 1;
    html.mockClear();
    host.refresh();
    expect(html).toHaveBeenCalledTimes(1);
    expect(container.elem.textContent).toContain('count 1');

    // The section's own html function is still the one a later refresh runs
    count = 2;
    host.refresh();
    expect(container.elem.textContent).toContain('count 2');
  });
});
