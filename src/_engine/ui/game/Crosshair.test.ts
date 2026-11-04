import { beforeAll, describe, expect, it } from 'vitest';
import { stubKitDomAsync } from '../testing/KitDom';
import { createCrosshair } from './Crosshair';

beforeAll(async () => {
  await stubKitDomAsync();
});

describe('crosshair (p808 D6)', () => {
  it('is hidden from assistive tech, with its parts and its sizes as properties', () => {
    const crosshair = createCrosshair({ gap: 5, length: 10, thickness: 3 });
    const elem = crosshair.cmp.elem;
    expect(elem.className).toBe('aekCrosshair');
    expect(elem.getAttribute('aria-hidden')).toBe('true');
    expect(elem.getAttribute('data-shape')).toBe('cross');
    expect(elem.getAttribute('data-state')).toBe('default');
    expect(
      [...elem.querySelectorAll('.aekCrosshair__arm')].map((arm) => arm.getAttribute('data-arm'))
    ).toEqual(['up', 'down', 'left', 'right']);
    expect(elem.querySelectorAll('.aekCrosshair__hitArm')).toHaveLength(4);
    expect(elem.style.getPropertyValue('--aek-crosshair-gap')).toBe('5px');
    expect(elem.style.getPropertyValue('--aek-crosshair-length')).toBe('10px');
    expect(elem.style.getPropertyValue('--aek-crosshair-thickness')).toBe('3px');
    crosshair.cmp.remove();
  });

  it('writes the spread only when it changes, and the state and shape as attributes', () => {
    const crosshair = createCrosshair();
    const elem = crosshair.cmp.elem;
    crosshair.setSpread(6);
    expect(elem.style.getPropertyValue('--aek-crosshair-spread')).toBe('6px');
    elem.style.setProperty('--aek-crosshair-spread', 'marked');
    crosshair.setSpread(6);
    expect(elem.style.getPropertyValue('--aek-crosshair-spread')).toBe('marked');
    crosshair.setSpread(-2);
    expect(elem.style.getPropertyValue('--aek-crosshair-spread')).toBe('0px');
    crosshair.setState('target');
    expect(elem.getAttribute('data-state')).toBe('target');
    crosshair.setShape('chevron');
    expect(elem.getAttribute('data-shape')).toBe('chevron');
    crosshair.cmp.remove();
  });

  it('restarts the hit marker by alternating its run, with its kind', () => {
    const crosshair = createCrosshair({ shape: 'dot' });
    const hit = crosshair.cmp.elem.querySelector('.aekCrosshair__hit') as HTMLElement;
    expect(hit.hasAttribute('data-run')).toBe(false);
    crosshair.showHitMarker();
    expect(hit.getAttribute('data-kind')).toBe('hit');
    expect(hit.getAttribute('data-run')).toBe('1');
    crosshair.showHitMarker('kill');
    expect(hit.getAttribute('data-kind')).toBe('kill');
    expect(hit.getAttribute('data-run')).toBe('2');
    // Full motion in Node (no computed style): not still
    expect(hit.hasAttribute('data-still')).toBe(false);
    crosshair.cmp.remove();
  });
});
