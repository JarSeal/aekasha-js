import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubKitDomAsync } from '../testing/KitDom';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { pushOverlay } from '../overlays/OverlayStack';
import { createSubtitles, type SubtitlesProps } from './Subtitles';

/** Subtitles added to the HUD root */
const addSubtitles = (props: SubtitlesProps = {}) => {
  const subtitles = createSubtitles(props);
  getHUDRootCMP().add(subtitles.cmp);
  return subtitles;
};

const getLines = (elem: HTMLElement) =>
  [...elem.querySelectorAll('.aekSubtitles__line')].map((line) => line.textContent);

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

describe('subtitles (p808 D10)', () => {
  it('is a polite live region at the bottom, a line with its speaker in its own colour', () => {
    const subtitles = addSubtitles();
    const elem = subtitles.cmp.elem;
    expect(elem.getAttribute('aria-live')).toBe('polite');
    expect(elem.getAttribute('aria-relevant')).toBe('additions');
    expect(elem.getAttribute('data-placement')).toBe('bottom');
    subtitles.show({ speaker: 'Mara', speakerColor: '#e8a33d', text: 'Over here!' });
    subtitles.show({ text: '(Distant thunder)' });
    const [first, second] = [...elem.querySelectorAll('.aekSubtitles__line')] as HTMLElement[];
    expect(first.tagName).toBe('P');
    const speaker = first.querySelector('.aekSubtitles__speaker') as HTMLElement;
    expect(speaker.textContent).toBe('Mara');
    expect(speaker.style.getPropertyValue('--aek-subtitles-speaker-color')).toBe('#e8a33d');
    expect(first.textContent).toBe('Mara: Over here!');
    expect(second.querySelector('.aekSubtitles__speaker')).toBeNull();
    expect(second.textContent).toBe('(Distant thunder)');
    subtitles.cmp.remove();
  });

  it('shows a line for its time, by default from its length', () => {
    const subtitles = addSubtitles({ maxLines: 3 });
    const elem = subtitles.cmp.elem;
    // 1000 + 65 × 4 characters is under the 2000 floor
    subtitles.show({ text: 'Run!' });
    // 1000 + 65 × 40 = 3600
    subtitles.show({ text: 'x'.repeat(36), speaker: 'Mara' });
    subtitles.show({ text: 'Quick', durationMs: 500 });
    vi.advanceTimersByTime(500);
    expect(getLines(elem)).toEqual(['Run!', `Mara: ${'x'.repeat(36)}`]);
    vi.advanceTimersByTime(1500);
    expect(getLines(elem)).toEqual([`Mara: ${'x'.repeat(36)}`]);
    vi.advanceTimersByTime(1599);
    expect(getLines(elem)).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(getLines(elem)).toHaveLength(0);
    subtitles.cmp.remove();
  });

  it('removes the oldest line past its maximum, the newest last', () => {
    const subtitles = addSubtitles();
    const elem = subtitles.cmp.elem;
    subtitles.show({ text: 'One' });
    subtitles.show({ text: 'Two' });
    subtitles.show({ text: 'Three' });
    expect(getLines(elem)).toEqual(['Two', 'Three']);
    expect(vi.getTimerCount()).toBe(2);
    subtitles.clear();
    expect(getLines(elem)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    subtitles.cmp.remove();
  });

  it('stays live under a modal’s inert, and leaves no timer after its removal', () => {
    const subtitles = addSubtitles({ placement: 'top' });
    const elem = subtitles.cmp.elem;
    expect(elem.getAttribute('data-placement')).toBe('top');
    const dialog = document.createElement('div');
    getHUDRootCMP().elem.append(dialog);
    const remove = pushOverlay({ elem: dialog, inert: true });
    expect(elem.hasAttribute('inert')).toBe(false);
    remove(false);
    dialog.remove();
    subtitles.show({ text: 'Still here' });
    subtitles.cmp.remove();
    expect(vi.getTimerCount()).toBe(0);
  });
});
