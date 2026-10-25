import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubKitDomAsync } from '../testing/KitDom';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createLoadingOverlay, type LoadingOverlayProps } from './LoadingOverlay';

/** An overlay added to the HUD root, as a scene loader adds its container */
const addOverlay = (props: LoadingOverlayProps) => {
  const overlay = createLoadingOverlay(props);
  getHUDRootCMP().add(overlay.cmp);
  return overlay;
};

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('loading overlay (p803 D10)', () => {
  it('starts hidden over the bounds, with a decorative spinner and its text as a status', () => {
    const overlay = addOverlay({ text: 'Loading the level' });
    const elem = overlay.cmp.elem;
    expect(elem.getAttribute('data-cover')).toBe('bounds');
    expect(elem.getAttribute('data-state')).toBe('hidden');
    expect(overlay.isShown()).toBe(false);
    expect(elem.querySelector('.aekSpinner')?.getAttribute('aria-hidden')).toBe('true');
    const text = elem.querySelector('.aekLoadingOverlay__text');
    expect(text?.getAttribute('role')).toBe('status');
    expect(text?.textContent).toBe('Loading the level');
    overlay.setText('Loading the sky');
    expect(text?.textContent).toBe('Loading the sky');
    overlay.cmp.remove();
  });

  it('fades in and out, each resolving true after its time', async () => {
    const overlay = addOverlay({ text: 'Loading', cover: 'parent', fadeInMs: 100, fadeOutMs: 200 });
    const elem = overlay.cmp.elem;
    expect(elem.getAttribute('data-cover')).toBe('parent');
    const shown = overlay.showAsync();
    expect(elem.getAttribute('data-state')).toBe('showing');
    expect(elem.style.transitionDuration).toBe('100ms');
    expect(overlay.isShown()).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    await expect(shown).resolves.toBe(true);
    expect(elem.getAttribute('data-state')).toBe('shown');
    const hidden = overlay.hideAsync();
    expect(elem.getAttribute('data-state')).toBe('hiding');
    expect(elem.style.transitionDuration).toBe('200ms');
    expect(overlay.isShown()).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    await expect(hidden).resolves.toBe(true);
    expect(elem.getAttribute('data-state')).toBe('hidden');
    overlay.cmp.remove();
  });

  it('resolves a cut fade false: the later call wins, and so does the removal', async () => {
    const overlay = addOverlay({ text: 'Loading' });
    const shown = overlay.showAsync();
    const hidden = overlay.hideAsync();
    await expect(shown).resolves.toBe(false);
    expect(overlay.cmp.elem.getAttribute('data-state')).toBe('hiding');
    overlay.cmp.remove();
    await expect(hidden).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('draws a progress bar named by its text, and swaps one in for the spinner', () => {
    const withBar = addOverlay({ text: 'Downloading', progress: null });
    const track = withBar.cmp.elem.querySelector('.aekProgress__track');
    expect(withBar.cmp.elem.querySelector('.aekSpinner')).toBe(null);
    expect(track?.hasAttribute('aria-valuenow')).toBe(false);
    withBar.setProgress(30);
    expect(track?.getAttribute('aria-valuenow')).toBe('30');
    withBar.setText('Unpacking');
    const labelId = track?.getAttribute('aria-labelledby') ?? '';
    expect(withBar.cmp.elem.querySelector(`#${labelId}`)?.textContent).toBe('Unpacking');
    withBar.cmp.remove();

    const swapped = addOverlay({ text: 'Loading' });
    const content = swapped.cmp.elem.querySelector('.aekLoadingOverlay__content');
    swapped.setProgress(50);
    expect(swapped.cmp.elem.querySelector('.aekSpinner')).toBe(null);
    expect([...(content?.children ?? [])].map((child) => child.className)).toEqual([
      'aekProgress aekLoadingOverlay__progress',
      'aekLoadingOverlay__text',
    ]);
    swapped.cmp.remove();
  });
});
