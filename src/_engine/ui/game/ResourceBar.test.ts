import { beforeAll, describe, expect, it } from 'vitest';
import { stubKitDomAsync } from '../testing/KitDom';
import { createResourceBar } from './ResourceBar';

const part = (elem: HTMLElement, name: string) =>
  elem.querySelector(`.aekResourceBar__${name}`) as HTMLElement;

beforeAll(async () => {
  await stubKitDomAsync();
});

describe('resource bar (p808 D6)', () => {
  it('is a meter named by its label, full by default', () => {
    const bar = createResourceBar({ label: 'Health' });
    const elem = bar.cmp.elem;
    const track = part(elem, 'track');
    expect(elem.className).toBe('aekResourceBar');
    expect(track.getAttribute('role')).toBe('meter');
    const labelId = track.getAttribute('aria-labelledby') ?? '';
    expect(elem.querySelector(`#${labelId}`)?.textContent).toBe('Health');
    expect(track.getAttribute('aria-valuemin')).toBe('0');
    expect(track.getAttribute('aria-valuemax')).toBe('100');
    expect(track.getAttribute('aria-valuenow')).toBe('100');
    expect(track.getAttribute('aria-valuetext')).toBe('100 of 100');
    expect(part(elem, 'fill').style.transform).toBe('scaleX(1)');
    expect(elem.hasAttribute('data-change')).toBe(false);
    expect(bar.getValue()).toBe(100);
    bar.cmp.remove();
  });

  it('leaves the trail to the CSS on a drop, eases a heal and flashes a big one', () => {
    const bar = createResourceBar({ label: 'Health', max: 200, showValue: 'fraction' });
    const elem = bar.cmp.elem;
    bar.setValue(50);
    expect(elem.getAttribute('data-change')).toBe('damage');
    expect(part(elem, 'fill').style.transform).toBe('scaleX(0.25)');
    expect(part(elem, 'trail').style.transform).toBe('scaleX(0.25)');
    expect(part(elem, 'value').textContent).toBe('50 / 200');
    expect(part(elem, 'value').getAttribute('aria-hidden')).toBe('true');
    expect(part(elem, 'flash').hasAttribute('data-run')).toBe(false);
    // A regen tick under the flash's share: a heal, no flash
    bar.setValue(55);
    expect(elem.getAttribute('data-change')).toBe('heal');
    expect(part(elem, 'flash').hasAttribute('data-run')).toBe(false);
    bar.setValue(120);
    expect(part(elem, 'flash').getAttribute('data-run')).toBe('1');
    bar.setValue(180);
    // The other name restarts the animation
    expect(part(elem, 'flash').getAttribute('data-run')).toBe('2');
    bar.setValue(999);
    expect(bar.getValue()).toBe(200);
    bar.setValue(-5);
    expect(bar.getValue()).toBe(0);
    bar.cmp.remove();
  });

  it('writes nothing when the value is unchanged, and the texts only when the rounded value is', () => {
    const bar = createResourceBar({ label: 'Stamina', value: 40 });
    const fill = part(bar.cmp.elem, 'fill');
    const track = part(bar.cmp.elem, 'track');
    fill.style.transform = 'marked';
    bar.setValue(40);
    expect(fill.style.transform).toBe('marked');
    track.setAttribute('aria-valuetext', 'marked');
    bar.setValue(40.2);
    expect(fill.style.transform).toBe('scaleX(0.402)');
    expect(track.getAttribute('aria-valuetext')).toBe('marked');
    bar.setValue(41);
    expect(track.getAttribute('aria-valuetext')).toBe('41 of 100');
    bar.cmp.remove();
  });

  it('puts the bar in the lowest threshold that holds, with its word', () => {
    const bar = createResourceBar({
      label: 'Health',
      showValue: 'percent',
      thresholds: [
        { below: 0.5, state: 'warning', text: 'Hurt' },
        { below: 0.2, state: 'danger', text: 'Low' },
      ],
    });
    const elem = bar.cmp.elem;
    const status = part(elem, 'status');
    expect(elem.hasAttribute('data-state')).toBe(false);
    expect(status.hidden).toBe(true);
    bar.setValue(45);
    expect(elem.getAttribute('data-state')).toBe('warning');
    expect(status.textContent).toBe('Hurt');
    expect(part(elem, 'track').getAttribute('aria-valuetext')).toBe('45 of 100, Hurt');
    bar.setValue(10);
    expect(elem.getAttribute('data-state')).toBe('danger');
    expect(part(elem, 'track').getAttribute('aria-valuetext')).toBe('10 of 100, Low');
    expect(part(elem, 'value').textContent).toBe('10 %');
    bar.setValue(80);
    expect(elem.hasAttribute('data-state')).toBe(false);
    expect(status.hidden).toBe(true);
    bar.cmp.remove();
  });

  it('draws its segments, and follows a new maximum without a change animation', () => {
    const bar = createResourceBar({ label: 'Shield', segments: 4, value: 50, hideLabel: true });
    const elem = bar.cmp.elem;
    expect(elem.style.getPropertyValue('--aek-resource-bar-segments')).toBe('4');
    expect(part(elem, 'segments')).not.toBeNull();
    expect(part(elem, 'label').classList.contains('aekVisuallyHidden')).toBe(true);
    bar.setMax(200);
    expect(part(elem, 'fill').style.transform).toBe('scaleX(0.25)');
    expect(part(elem, 'track').getAttribute('aria-valuemax')).toBe('200');
    expect(elem.hasAttribute('data-change')).toBe(false);
    bar.setMax(20);
    expect(bar.getValue()).toBe(20);
    bar.cmp.remove();
  });
});
