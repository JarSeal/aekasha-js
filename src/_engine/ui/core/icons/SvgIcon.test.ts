import { describe, expect, it, vi } from 'vitest';
import { lwarn } from '../../../utils/Logger';
import { getSvgIcon, registerIcon } from './SvgIcon';

vi.mock(import('../../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lwarn: vi.fn(),
}));

const SVG = '<svg viewBox="0 0 16 16"></svg>';

describe('getSvgIcon (p803 D5)', () => {
  it('wraps a registered icon in aekIcon, 1em without a size', () => {
    registerIcon('shield', SVG);
    expect(getSvgIcon('shield')).toBe(`<span class="aekIcon">${SVG}</span>`);
  });

  it('writes a size as data-size', () => {
    registerIcon('shield', SVG);
    expect(getSvgIcon('shield', 'lg')).toBe(`<span class="aekIcon" data-size="lg">${SVG}</span>`);
    expect(getSvgIcon('shield', 'sm')).toBe(`<span class="aekIcon" data-size="sm">${SVG}</span>`);
  });

  it('renders ?? for an unregistered name and warns once', () => {
    expect(getSvgIcon('missing')).toContain('??');
    getSvgIcon('missing');
    expect(lwarn).toHaveBeenCalledTimes(1);
  });
});
