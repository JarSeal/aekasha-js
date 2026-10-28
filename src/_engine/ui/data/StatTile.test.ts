import { beforeAll, describe, expect, it } from 'vitest';
import { stubKitDomAsync } from '../testing/KitDom';
import { CMP } from '../core/CMP';
import { createSparkline } from './graphs/Sparkline';
import { createStatTile } from './StatTile';

const part = (elem: HTMLElement, name: string) =>
  elem.querySelector(`.aekStatTile__${name}`) as HTMLElement;

beforeAll(async () => {
  await stubKitDomAsync();
});

describe('stat tile (p805 D9)', () => {
  it('shows its label, its figure in one text node and its unit; none yet is a dash', () => {
    const tile = createStatTile({
      label: 'Frame time',
      unit: 'ms',
      format: (ms) => ms.toFixed(1),
    });
    const elem = tile.cmp.elem;
    expect(part(elem, 'label').textContent).toBe('Frame time');
    expect(part(elem, 'figure').textContent).toBe('– ms');
    const node = part(elem, 'value').firstChild;
    tile.setValue(16.64);
    expect(part(elem, 'value').textContent).toBe('16.6');
    // Written in place: the same text node
    expect(part(elem, 'value').firstChild).toBe(node);
    tile.setValue('n/a');
    expect(part(elem, 'value').textContent).toBe('n/a');
    tile.setValue(NaN);
    expect(part(elem, 'value').textContent).toBe('–');
    tile.setLabel('Frame');
    expect(part(elem, 'label').textContent).toBe('Frame');
    tile.cmp.remove();
  });

  it('hides the change until there is one, then gives its sign, arrow and words', () => {
    const tile = createStatTile({ label: 'Draw calls', value: 120 });
    const elem = tile.cmp.elem;
    const delta = part(elem, 'delta');
    expect(delta.hasAttribute('hidden')).toBe(true);
    expect(elem.hasAttribute('data-trend')).toBe(false);
    expect(part(elem, 'arrow').getAttribute('aria-hidden')).toBe('true');
    expect(part(elem, 'deltaText').getAttribute('aria-hidden')).toBe('true');
    tile.setDelta(12.04);
    expect(delta.hasAttribute('hidden')).toBe(false);
    expect(elem.getAttribute('data-trend')).toBe('up');
    expect(part(elem, 'deltaText').textContent).toBe('+12 %');
    expect(delta.querySelector('.aekVisuallyHidden')?.textContent).toBe('up 12 %');
    // Neutral without goodDirection
    expect(elem.hasAttribute('data-tone')).toBe(false);
    tile.setDelta(-0.55);
    expect(elem.getAttribute('data-trend')).toBe('down');
    expect(part(elem, 'deltaText').textContent).toBe('−0.6 %');
    expect(delta.querySelector('.aekVisuallyHidden')?.textContent).toBe('down 0.6 %');
    tile.setDelta(0);
    expect(elem.getAttribute('data-trend')).toBe('flat');
    expect(part(elem, 'deltaText').textContent).toBe('0 %');
    expect(delta.querySelector('.aekVisuallyHidden')?.textContent).toBe('no change');
    tile.setDelta(null);
    expect(delta.hasAttribute('hidden')).toBe(true);
    expect(elem.hasAttribute('data-trend')).toBe(false);
    tile.cmp.remove();
  });

  it('colours a change by goodDirection, and takes its own format of the size', () => {
    const tile = createStatTile({
      label: 'Frame time',
      goodDirection: 'down',
      delta: -2,
      formatDelta: (ms) => `${ms} ms`,
    });
    const elem = tile.cmp.elem;
    expect(elem.getAttribute('data-tone')).toBe('success');
    expect(part(elem, 'deltaText').textContent).toBe('−2 ms');
    tile.setDelta(3);
    expect(elem.getAttribute('data-tone')).toBe('danger');
    tile.setDelta(0);
    expect(elem.hasAttribute('data-tone')).toBe(false);
    tile.cmp.remove();
  });

  it('holds the sparkline it was given and removes it with itself', () => {
    const host = CMP({ attach: undefined });
    const sparkline = createSparkline({ values: [1, 2, 3] });
    const tile = createStatTile({ label: 'Triangles', sparkline });
    host.add(tile.cmp);
    expect(part(tile.cmp.elem, 'spark').contains(sparkline.cmp.elem)).toBe(true);
    tile.cmp.remove();
    expect(sparkline.cmp.elem.isConnected).toBe(false);
    expect(sparkline.cmp.parent).toBe(null);
    host.remove();
  });
});
