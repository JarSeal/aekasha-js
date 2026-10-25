import { beforeAll, describe, expect, it } from 'vitest';
import { stubKitDomAsync } from '../testing/KitDom';
import { createProgressBar } from './ProgressBar';

const getTrack = (elem: HTMLElement) => elem.querySelector('.aekProgress__track') as HTMLElement;
const getFills = (elem: HTMLElement) =>
  [...elem.querySelectorAll('.aekProgress__fill')].map(
    (fill) => (fill as HTMLElement).style.transform
  );

beforeAll(async () => {
  await stubKitDomAsync();
});

describe('progress bar (p803 D10)', () => {
  it('is a progressbar named by its visible label, indeterminate by default', () => {
    const bar = createProgressBar({ label: 'Loading the level', id: 'levelLoad' });
    const elem = bar.cmp.elem;
    const track = getTrack(elem);
    expect(elem.id).toBe('levelLoad');
    expect(elem.hasAttribute('data-indeterminate')).toBe(true);
    expect(track.getAttribute('role')).toBe('progressbar');
    const labelId = track.getAttribute('aria-labelledby') ?? '';
    expect(elem.querySelector(`#${labelId}`)?.textContent).toBe('Loading the level');
    expect(track.getAttribute('aria-valuemin')).toBe('0');
    expect(track.getAttribute('aria-valuemax')).toBe('100');
    expect(track.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar.getValue()).toBe(null);
    expect(elem.querySelector('.aekProgress__value')).toBe(null);
    bar.setLabel('Loading the assets');
    expect(elem.querySelector('.aekProgress__label')?.textContent).toBe('Loading the assets');
    bar.cmp.remove();
  });

  it('sets its value in place, clamped, with the shown percent hidden from assistive tech', () => {
    const bar = createProgressBar({ label: 'Download', value: 25, showValue: true });
    const elem = bar.cmp.elem;
    const track = getTrack(elem);
    const valueElem = elem.querySelector('.aekProgress__value');
    expect(elem.hasAttribute('data-indeterminate')).toBe(false);
    expect(track.getAttribute('aria-valuenow')).toBe('25');
    expect(getFills(elem)).toEqual(['scaleX(0.25)']);
    expect(valueElem?.textContent).toBe('25 %');
    expect(valueElem?.getAttribute('aria-hidden')).toBe('true');
    const fill = elem.querySelector('.aekProgress__fill');
    bar.setValue(150);
    expect(bar.getValue()).toBe(100);
    expect(track.getAttribute('aria-valuenow')).toBe('100');
    expect(getFills(elem)).toEqual(['scaleX(1)']);
    // Written in place: the same element
    expect(elem.querySelector('.aekProgress__fill')).toBe(fill);
    bar.setValue(null);
    expect(elem.hasAttribute('data-indeterminate')).toBe(true);
    expect(track.hasAttribute('aria-valuenow')).toBe(false);
    expect(getFills(elem)).toEqual(['']);
    expect(valueElem?.textContent).toBe('');
    bar.cmp.remove();
  });

  it('fills its segments in turn, on its own range', () => {
    const bar = createProgressBar({
      label: 'Health',
      hideLabel: true,
      min: 0,
      max: 5,
      segments: 5,
      value: 2.5,
    });
    const elem = bar.cmp.elem;
    const track = getTrack(elem);
    expect(elem.hasAttribute('data-label-hidden')).toBe(true);
    expect(elem.querySelector('.aekProgress__label')?.classList.contains('aekVisuallyHidden')).toBe(
      true
    );
    expect(track.getAttribute('data-segments')).toBe('5');
    expect(track.getAttribute('aria-valuemax')).toBe('5');
    expect(track.getAttribute('aria-valuenow')).toBe('2.5');
    expect(elem.querySelectorAll('.aekProgress__segment')).toHaveLength(5);
    expect(getFills(elem)).toEqual([
      'scaleX(1)',
      'scaleX(1)',
      'scaleX(0.5)',
      'scaleX(0)',
      'scaleX(0)',
    ]);
    bar.setValue(-1);
    expect(bar.getValue()).toBe(0);
    expect(getFills(elem).every((transform) => transform === 'scaleX(0)')).toBe(true);
    bar.cmp.remove();
  });
});
