import { beforeAll, describe, expect, it } from 'vitest';
import { countListeners, stubKitDomAsync } from '../testing/KitDom';
import { registerIcon } from '../core/icons/SvgIcon';
import { createCompass } from './Compass';

const part = (elem: Element, name: string) =>
  elem.querySelector(`.aekCompass__${name}`) as HTMLElement;
const DEG = Math.PI / 180;

beforeAll(async () => {
  await stubKitDomAsync();
  registerIcon('testCamp', '<svg viewBox="0 0 16 16"><path d="M0 16 8 0l8 16z"/></svg>');
});

describe('compass (p808 D7)', () => {
  it('draws two turns of directions, hidden, and says the heading in words', () => {
    const compass = createCompass();
    const elem = compass.cmp.elem;
    expect(elem.className).toBe('aekCompass');
    expect(elem.getAttribute('data-placement')).toBe('top');
    expect(part(elem, 'window').getAttribute('aria-hidden')).toBe('true');
    // 720° over a 120° field
    expect(part(elem, 'strip').style.width).toBe('600%');
    const labels = [...elem.querySelectorAll('.aekCompass__label')] as HTMLElement[];
    expect(labels).toHaveLength(16);
    // From -180°: S, SW, W, NW, N at a quarter of the strip
    expect(labels.slice(0, 5).map((label) => label.textContent)).toEqual([
      'S',
      'SW',
      'W',
      'NW',
      'N',
    ]);
    expect(labels[4].style.left).toBe('25%');
    expect(labels[4].getAttribute('data-kind')).toBe('cardinal');
    expect(labels[5].getAttribute('data-kind')).toBe('intercardinal');
    expect(part(elem, 'spoken').textContent).toBe('Facing north');
    expect(part(elem, 'spoken').classList.contains('aekVisuallyHidden')).toBe(true);
    compass.cmp.remove();
  });

  it('moves the strip to the heading, writing nothing under a tenth of a degree', () => {
    const compass = createCompass();
    const strip = part(compass.cmp.elem, 'strip');
    // North at the centre: the strip's -180° at -(180 - 60) / 720 of it
    expect(strip.style.transform).toBe(`translateX(${((60 - 180) / 720) * 100}%)`);
    compass.setHeading(90 * DEG);
    expect(strip.style.transform).toBe(`translateX(${((60 - 270) / 720) * 100}%)`);
    expect(compass.getHeading()).toBeCloseTo(Math.PI / 2);
    strip.style.transform = 'marked';
    compass.setHeading(90.04 * DEG);
    expect(strip.style.transform).toBe('marked');
    compass.setHeading(90.2 * DEG);
    expect(strip.style.transform).not.toBe('marked');
    // Wrapped into [0, 2π)
    compass.setHeading(-90 * DEG);
    expect(compass.getHeading()).toBeCloseTo((3 * Math.PI) / 2);
    compass.cmp.remove();
  });

  it('writes the spoken heading only when the nearest direction changes', () => {
    const compass = createCompass({ heading: 40 * DEG });
    const spoken = part(compass.cmp.elem, 'spoken');
    expect(spoken.textContent).toBe('Facing north-east');
    spoken.textContent = 'marked';
    compass.setHeading(60 * DEG);
    expect(spoken.textContent).toBe('marked');
    compass.setHeading(80 * DEG);
    expect(spoken.textContent).toBe('Facing east');
    compass.setHeading(350 * DEG);
    expect(spoken.textContent).toBe('Facing north');
    compass.cmp.remove();
  });

  it('places a marker by its offset from the heading, on the nearer end outside the field', () => {
    const compass = createCompass({ markers: { camp: { bearing: 30 * DEG, label: 'Camp' } } });
    const marker = part(compass.cmp.elem, 'marker');
    expect(marker.style.left).toBe('75%');
    expect(part(marker, 'markerLabel').textContent).toBe('Camp');
    expect(part(marker, 'markerLabel').hidden).toBe(false);
    expect(part(marker, 'markerIcon').hasAttribute('data-default')).toBe(true);
    // Turning toward it brings it to the centre
    compass.setHeading(30 * DEG);
    expect(marker.style.left).toBe('50%');
    // Behind on the right: the end
    compass.setHeading(-90 * DEG);
    expect(marker.getAttribute('data-edge')).toBe('end');
    expect(marker.style.left).toBe('100%');
    // On the left
    compass.setMarkerBearing('camp', 150 * DEG);
    expect(marker.getAttribute('data-edge')).toBe('start');
    expect(marker.style.left).toBe('0%');
    // Back inside, wrapping round north
    compass.setMarkerBearing('camp', 300 * DEG);
    expect(marker.hasAttribute('data-edge')).toBe(false);
    expect(marker.style.left).toBe(`${50 + (30 / 120) * 100}%`);
    compass.cmp.remove();
  });

  it('writes a marker only when its place changed, and hides one that hides outside', () => {
    const compass = createCompass();
    compass.setMarker('ping', { bearing: 10 * DEG, offScreen: 'hide' });
    const marker = part(compass.cmp.elem, 'marker');
    marker.style.left = 'marked';
    compass.setMarkerBearing('ping', 10.03 * DEG);
    compass.setHeading(0.02 * DEG);
    expect(marker.style.left).toBe('marked');
    compass.setMarkerBearing('ping', 100 * DEG);
    expect(marker.hasAttribute('data-hidden')).toBe(true);
    expect(marker.hasAttribute('data-edge')).toBe(false);
    compass.setMarkerBearing('ping', 20 * DEG);
    expect(marker.hasAttribute('data-hidden')).toBe(false);
    compass.setMarkerBearing('nothing', 0);
    compass.cmp.remove();
  });

  it('changes a marker in place: its icon, label and colour', () => {
    const compass = createCompass();
    compass.setMarker('camp', { bearing: 0, label: 'Camp' });
    const marker = part(compass.cmp.elem, 'marker');
    compass.setMarker('camp', { bearing: 0, icon: 'testCamp', color: 'var(--aek-success)' });
    expect(compass.cmp.elem.querySelectorAll('.aekCompass__marker')).toHaveLength(1);
    expect(part(marker, 'markerIcon').querySelector('svg')).not.toBeNull();
    expect(part(marker, 'markerIcon').hasAttribute('data-default')).toBe(false);
    expect(part(marker, 'markerLabel').hidden).toBe(true);
    expect(marker.style.getPropertyValue('--aek-compass-marker-color')).toBe('var(--aek-success)');
    expect(compass.hasMarker('camp')).toBe(true);
    compass.removeMarker('camp');
    expect(compass.hasMarker('camp')).toBe(false);
    expect(marker.isConnected).toBe(false);
    compass.removeMarker('camp');
    compass.cmp.remove();
  });

  it('takes its words and its field, and leaves nothing behind', () => {
    const compass = createCompass({
      fov: Math.PI,
      placement: 'inline',
      texts: {
        labels: ['P', 'KO', 'I', 'KA', 'E', 'LO', 'L', 'LU'],
        names: ['pohjoinen', 'koillinen', 'itä', 'kaakko', 'etelä', 'lounas', 'länsi', 'luode'],
        facing: (name) => `Suunta: ${name}`,
      },
    });
    const elem = compass.cmp.elem;
    expect(elem.getAttribute('data-placement')).toBe('inline');
    expect(part(elem, 'strip').style.width).toBe('400%');
    expect(part(elem, 'spoken').textContent).toBe('Suunta: pohjoinen');
    expect(elem.querySelectorAll('.aekCompass__label')[4].textContent).toBe('P');
    compass.setMarker('a', { bearing: 80 * DEG });
    // 80° in a 180° field
    expect(part(elem, 'marker').style.left).toBe(`${50 + (80 / 180) * 100}%`);
    compass.cmp.remove();
    expect(countListeners(elem)).toBe(0);
    compass.setHeading(1);
    compass.setMarker('b', { bearing: 0 });
  });
});
