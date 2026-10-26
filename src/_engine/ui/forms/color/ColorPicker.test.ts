import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHudRoot, getHUDRootCMP } from '../../core/HUD';
import { stubKitDomAsync } from '../../testing/KitDom';
import { createColorField } from './ColorField';
import { isColorPickerLoaded, loadColorPickerAsync } from './ColorPicker';

// Its own file: the picker isn't loaded at its start, as on a page's first open

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot')! });
});

const removers: (() => void)[] = [];
afterEach(() => {
  while (removers.length) removers.pop()!();
  vi.restoreAllMocks();
});

const makeField = (palette: string[] = []) => {
  const field = createColorField({ label: 'Fog', value: 0x3fd8f2, palette });
  getHUDRootCMP().add(field.cmp);
  removers.push(() => field.cmp.remove());
  const swatch = field.cmp.elem.querySelector<HTMLElement>('.aekColorField__swatch')!;
  const panel = () => document.querySelector<HTMLElement>('.aekColorPopover');
  return { field, swatch, panel };
};

/** The microtasks a load's `then` waits for */
const settleAsync = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('the colour picker’s lazy load (p804 D8)', () => {
  it('a load that fails warns; the panel shows without it, and the next open tries again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.doMock('vanilla-colorful/lib/entrypoints/hsva', () => {
      throw new Error('offline');
    });
    const { swatch, panel } = makeField();
    swatch.click();
    const slot = panel()!.querySelector('.aekColorPanel__picker')!;
    expect(slot.hasAttribute('data-loading')).toBe(true);
    expect(await loadColorPickerAsync()).toBe(false);
    await settleAsync();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(isColorPickerLoaded()).toBe(false);
    expect(panel()!.querySelector('.aekColorPanel__picker')).toBe(null);
    // Nothing else to show: what to type
    expect(panel()!.querySelector('.aekColorPanel__empty')!.textContent).toMatch(/#rrggbb/);
    swatch.click();
    vi.doUnmock('vanilla-colorful/lib/entrypoints/hsva');
  });

  it('the first open loads it: its place kept, then the plane takes the focus', async () => {
    const { swatch, panel } = makeField(['#000']);
    swatch.focus();
    swatch.click();
    const slot = panel()!.querySelector<HTMLElement>('.aekColorPanel__picker')!;
    expect(slot.hasAttribute('data-loading')).toBe(true);
    // Meanwhile the focus is on the first focusable: the swatch
    expect(document.activeElement!.className).toBe('aekColorPanel__swatch');
    expect(await loadColorPickerAsync()).toBe(true);
    await settleAsync();
    expect(isColorPickerLoaded()).toBe(true);
    expect(slot.hasAttribute('data-loading')).toBe(false);
    const picker = slot.querySelector<HTMLElement>('aek-color-picker')!;
    expect(document.activeElement).toBe(picker);
    expect(window.customElements.get('aek-color-picker')).toBeDefined();
    // The next open shows it at once
    swatch.click();
    swatch.click();
    expect(panel()!.querySelector('.aekColorPanel__picker')!.hasAttribute('data-loading')).toBe(
      false
    );
  });

  it('a page that has the tag already: no second definition; a focus moved while it loads stays', async () => {
    // Fresh modules: a first open again, with `aek-color-picker` defined on the page (the test above)
    vi.resetModules();
    const define = vi.spyOn(window.customElements, 'define');
    const fresh = await import('./ColorField');
    const picker = await import('./ColorPicker');
    expect(picker.isColorPickerLoaded()).toBe(false);
    const field = fresh.createColorField({
      label: 'Tint',
      value: '#000000',
      palette: ['#000', '#fff'],
    });
    getHUDRootCMP().add(field.cmp);
    removers.push(() => field.cmp.remove());
    field.cmp.elem.querySelector<HTMLElement>('.aekColorField__swatch')!.click();
    const popover = document.querySelector<HTMLElement>('.aekColorPopover')!;
    const swatches = popover.querySelectorAll<HTMLElement>('.aekColorPanel__swatch');
    swatches[1].focus();
    expect(await picker.loadColorPickerAsync()).toBe(true);
    await settleAsync();
    expect(define).not.toHaveBeenCalled();
    expect(popover.querySelector('aek-color-picker')).not.toBe(null);
    expect(document.activeElement).toBe(swatches[1]);
  });
});
