import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { countListeners, stubKitDomAsync } from '../ui/testing/KitDom';

vi.mock(import('../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lerror: vi.fn(),
}));

import { CMP } from '../ui/core/CMP';
import type { CMPHandle } from '../ui/core/CMPTypes';
import { createMonitor } from '../ui/forms/Monitor';
import { lerror } from '../utils/Logger';
import type { AnyDebuggerTabDef, DebuggerTabContext } from './DebuggerGUI';
import { createTabHost, type TabHost } from './_dbg__TabHost';

beforeAll(async () => {
  await stubKitDomAsync();
  // The builder's LS reads (no UI key here, so nothing is written)
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
});

// Each test's containers and hosts go after it: a CMP id stays taken while its CMP exists
const containers: CMPHandle[] = [];
const hosts: TabHost[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.dispose();
  for (const container of containers.splice(0)) container.remove();
  vi.useRealTimers();
});

const createHost = (visible = { value: true }) => {
  const container = CMP();
  document.body.append(container.elem);
  containers.push(container);
  const host = createTabHost({ getContainer: () => container, isVisible: () => visible.value });
  hosts.push(host);
  return { container, host, visible };
};

const tab = (def: Partial<AnyDebuggerTabDef>): AnyDebuggerTabDef => ({
  id: 'tab',
  title: 'Tab',
  icon: 'gear',
  content: () => [],
  ...def,
});

const throwingTab = tab({
  id: 'broken',
  title: 'Broken',
  content: () => {
    throw new Error('content failed');
  },
});

describe('tab host: a failing tab (p618 §1.4)', () => {
  // B3: a throwing content() threw out of mount(), and with it out of the drawer's build and
  // setCurrentScene, on every scene load while the tab was the saved one
  it("doesn't throw when a tab's content throws (B3); the error line is a kit empty state (p806 D5)", () => {
    const { container, host } = createHost();
    expect(() => host.mount(throwingTab)).not.toThrow();
    expect(host.mountedId).toBe('broken');
    const error = container.elem.querySelector('.debuggerTabError.aekEmptyState')!;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.querySelector('.aekEmptyState__title')?.textContent).toBe(
      'This tab failed to build'
    );
    expect(error.querySelector('.aekEmptyState__text')?.textContent).toBe(
      'content failed (see the console).'
    );
    // getSvgIcon('alert'): no built-in icon is registered without the boot, so only its slot
    expect(error.querySelector('.aekEmptyState__icon')).not.toBeNull();
    expect(lerror).toHaveBeenCalled();
  });

  it('runs no onOpen for a failed tab, and stays mountable', () => {
    const { container, host } = createHost();
    const onOpen = vi.fn();
    host.mount({ ...throwingTab, onOpen });
    expect(onOpen).not.toHaveBeenCalled();

    const cleanup = vi.fn();
    host.mount(
      tab({ id: 'working', onOpen: () => cleanup, content: () => [CMP({ text: 'fine' })] })
    );
    expect(host.mountedId).toBe('working');
    expect(container.elem.textContent).toContain('fine');
    expect(container.elem.textContent).not.toContain('failed to build');
    host.unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('keeps the tab when its onRefresh throws', () => {
    const { container, host } = createHost();
    host.mount(
      tab({
        onRefresh: () => {
          throw new Error('onRefresh failed');
        },
        content: () => [CMP({ text: 'built' })],
      })
    );
    expect(container.elem.textContent).toContain('built');
    expect(() => host.refresh()).not.toThrow();
  });

  it("logs a section's failing refresh instead of throwing", () => {
    const { host } = createHost();
    let shouldThrow = false;
    host.mount(
      tab({
        content: () => [
          CMP({
            html: () => {
              if (shouldThrow) throw new Error('html failed');
              return '<div>ok</div>';
            },
          }),
        ],
      })
    );
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
    host.mount(tab({ content: () => [CMP({ html })] }));

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

/** A refresh-only field's reads, as a count (each read calls `get`) */
const countingSection = (reads: { count: number }) => ({
  pane: true as const,
  content: [
    {
      get: () => ++reads.count,
      label: 'Reads',
      readonly: true,
      interval: 'refresh' as const,
    },
  ],
});

describe('tab host: the scheduler (p806 D5)', () => {
  it('gives content its scheduler, which every declarative section shares: one refresh reads each field once, after onRefresh', () => {
    const { host } = createHost();
    let ctx: DebuggerTabContext | null = null;
    const order: string[] = [];
    const reads = { count: 0 };
    host.mount(
      tab({
        onRefresh: () => order.push(`onRefresh at ${reads.count}`),
        content: (c) => {
          ctx = c;
          return [countingSection(reads), countingSection(reads)];
        },
      })
    );
    expect(ctx!.scheduler).toBe(host.scheduler);
    const atMount = reads.count;
    order.length = 0;
    host.refresh();
    // Each of the two fields read once, after onRefresh
    expect(reads.count - atMount).toBe(2);
    expect(order).toEqual([`onRefresh at ${atMount}`]);
  });

  it("refreshes a CMP section's kit field made with ctx.scheduler", () => {
    const { container, host } = createHost();
    const stats = { bodies: 1 };
    host.mount(
      tab({
        content: ({ scheduler }) => {
          const section = CMP();
          section.add(
            createMonitor({
              label: 'Bodies',
              target: stats,
              key: 'bodies',
              interval: 'refresh',
              precision: 0,
              scheduler,
            }).cmp
          );
          return [section];
        },
      })
    );
    const text = () => container.elem.querySelector('.aekMonitor__value')?.textContent;
    stats.bodies = 5;
    expect(text()).toBe('1');
    host.refresh();
    expect(text()).toBe('5');
  });

  it('ticks its monitors only while the host shows: mount, pause, resume, unmount', () => {
    vi.useFakeTimers();
    const visible = { value: false };
    const { container, host } = createHost(visible);
    const stats = { ms: 1 };
    host.mount(
      tab({
        content: ({ scheduler }) => {
          const section = CMP();
          section.add(
            createMonitor({ label: 'Ms', target: stats, key: 'ms', interval: 0, scheduler }).cmp
          );
          return [section];
        },
      })
    );
    const text = () => container.elem.querySelector('.aekMonitor__value')?.textContent;
    stats.ms = 2;
    vi.advanceTimersByTime(100);
    // Mounted while hidden: no tick
    expect(text()).toBe('1.00');
    visible.value = true;
    host.resume();
    // The resume's refresh reads it, the tick follows it
    expect(text()).toBe('2.00');
    stats.ms = 3;
    vi.advanceTimersByTime(32);
    expect(text()).toBe('3.00');
    visible.value = false;
    host.pause();
    stats.ms = 4;
    vi.advanceTimersByTime(100);
    expect(text()).toBe('3.00');
  });

  it('runs refreshIntervalMs only while visible: onRefresh, then the fields', () => {
    vi.useFakeTimers();
    const visible = { value: true };
    const { host } = createHost(visible);
    const reads = { count: 0 };
    const onRefresh = vi.fn();
    host.mount(tab({ refreshIntervalMs: 500, onRefresh, content: () => [countingSection(reads)] }));
    onRefresh.mockClear();
    reads.count = 0;
    vi.advanceTimersByTime(1000);
    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(reads.count).toBe(2);
    host.pause();
    vi.advanceTimersByTime(1000);
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });
});

describe('tab host: a scene change (p806 D5)', () => {
  it('rebuilds the open tab by default', () => {
    const { container, host } = createHost();
    const content = vi.fn(() => [CMP({ text: 'built' })]);
    host.mount(tab({ content }));
    const before = container.elem.firstElementChild;
    host.sceneChanged();
    expect(content).toHaveBeenCalledTimes(2);
    expect(container.elem.firstElementChild).not.toBe(before);
  });

  it('keeps a keepOnSceneChange tab: its DOM stays, onSceneChange then onRefresh then the fields', () => {
    const { container, host } = createHost();
    const order: string[] = [];
    const reads = { count: 0 };
    const content = vi.fn(() => [countingSection(reads)]);
    host.mount(
      tab({
        keepOnSceneChange: true,
        onSceneChange: () => order.push('onSceneChange'),
        onRefresh: () => order.push(`onRefresh at ${reads.count}`),
        content,
      })
    );
    const before = container.elem.firstElementChild;
    const atMount = reads.count;
    order.length = 0;
    host.sceneChanged();
    expect(content).toHaveBeenCalledTimes(1);
    expect(container.elem.firstElementChild).toBe(before);
    expect(order).toEqual(['onSceneChange', `onRefresh at ${atMount}`]);
    expect(reads.count - atMount).toBe(1);
  });

  it('logs a throwing onSceneChange and still refreshes', () => {
    const { host } = createHost();
    const onRefresh = vi.fn();
    host.mount(
      tab({
        keepOnSceneChange: true,
        onSceneChange: () => {
          throw new Error('scene change failed');
        },
        onRefresh,
      })
    );
    onRefresh.mockClear();
    vi.mocked(lerror).mockClear();
    expect(() => host.sceneChanged()).not.toThrow();
    expect(lerror).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('tab host: the fields’ context menu (p806 D4)', () => {
  it('listens on the container, once across mounts, and goes with the host', () => {
    const { container, host } = createHost();
    host.mount(tab({ id: 'a' }));
    host.mount(tab({ id: 'b' }));
    expect(countListeners(container.elem, 'contextmenu')).toBe(1);
    hosts.splice(hosts.indexOf(host), 1);
    host.dispose();
    expect(countListeners(container.elem, 'contextmenu')).toBe(0);
    expect(host.mountedId).toBeNull();
  });
});
