import { describe, expect, it, vi } from 'vitest';

// The HUD root builds DOM: linkedom's document and window, stubbed in this file only
const dom = vi.hoisted(async () => {
  const { parseHTML } = await import('linkedom');
  return parseHTML(
    '<!doctype html><html><head></head><body><div id="menuHud"></div></body></html>'
  );
});
vi.stubGlobal('document', (await dom).document);
vi.stubGlobal('window', (await dom).window);

import { createHudRoot, getHUDRootCMP, hasHudRoot, HUD_ROOT_ID, KIT_ROOT_CLASS } from './HUD';

describe('createHudRoot (p803 D4)', () => {
  it('makes the one HUD root, a kit root, in place of its slot', () => {
    expect(hasHudRoot()).toBe(false);
    expect(() => getHUDRootCMP()).toThrow();
    const slot = document.getElementById('menuHud') as HTMLElement;

    const root = createHudRoot({ slot });

    expect(hasHudRoot()).toBe(true);
    expect(getHUDRootCMP()).toBe(root);
    expect(slot.isConnected).toBe(false);
    expect(document.body.firstElementChild).toBe(root.elem);
    expect(root.elem.id).toBe(HUD_ROOT_ID);
    expect(root.elem.classList.contains(KIT_ROOT_CLASS)).toBe(true);
  });

  it('throws on a second call, naming the boot', () => {
    expect(() => createHudRoot()).toThrow(/exists already.*boot/);
    expect(hasHudRoot()).toBe(true);
  });
});
