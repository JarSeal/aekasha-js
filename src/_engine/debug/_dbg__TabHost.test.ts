import { describe, expect, it, vi } from 'vitest';

// The tab host builds DOM: linkedom's document and window, stubbed in this file only
const dom = vi.hoisted(async () => {
  const { parseHTML } = await import('linkedom');
  return parseHTML('<!doctype html><html><head></head><body></body></html>');
});
vi.stubGlobal('document', (await dom).document);
vi.stubGlobal('window', (await dom).window);
vi.stubGlobal('HTMLInputElement', (await dom).window.HTMLInputElement);

import { CMP } from '../ui/CMP';
import type { AnyDebuggerTabDef } from './DebuggerGUI';
import { createTabHost } from './_dbg__TabHost';

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
  it.fails("doesn't throw when a tab's content throws (B3)", () => {
    const container = CMP();
    const host = createTabHost({ getContainer: () => container, isVisible: () => true });
    expect(() => host.mount(throwingTab)).not.toThrow();
    expect(host.mountedId).toBe('broken');
  });
});
