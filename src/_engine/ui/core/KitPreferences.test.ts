import { beforeAll, describe, expect, it } from 'vitest';
import { stubKitDomAsync } from '../testing/KitDom';
import { getKitPreferences, setKitPreferences } from './KitPreferences';

beforeAll(async () => {
  await stubKitDomAsync();
});

describe('kit preferences (p808 D9)', () => {
  it('starts from the system and the defaults', () => {
    const root = document.createElement('div');
    expect(getKitPreferences(root)).toEqual({
      theme: 'system',
      uiScale: 1,
      reducedMotion: 'system',
      density: 'default',
    });
  });

  it('writes the attributes and properties the tokens read, and reads them back', () => {
    const root = document.createElement('div');
    setKitPreferences({
      root,
      theme: 'light',
      uiScale: 1.25,
      reducedMotion: true,
      density: 'compact',
    });
    expect(root.getAttribute('data-aek-theme')).toBe('light');
    expect(root.style.getPropertyValue('--aek-ui-scale')).toBe('1.25');
    expect(root.style.getPropertyValue('--aek-motion')).toBe('0');
    expect(root.getAttribute('data-aek-density')).toBe('compact');
    expect(getKitPreferences(root)).toEqual({
      theme: 'light',
      uiScale: 1.25,
      reducedMotion: true,
      density: 'compact',
    });

    // Left out: unchanged; 'system' and 'default' remove
    setKitPreferences({ root, reducedMotion: false });
    expect(getKitPreferences(root)).toMatchObject({ theme: 'light', reducedMotion: false });
    setKitPreferences({ root, theme: 'system', reducedMotion: 'system', density: 'default' });
    expect(root.hasAttribute('data-aek-theme')).toBe(false);
    expect(root.style.getPropertyValue('--aek-motion')).toBe('');
    expect(root.hasAttribute('data-aek-density')).toBe(false);
  });

  it('keeps the UI scale at 0.5 or more and ignores one that is no number', () => {
    const root = document.createElement('div');
    setKitPreferences({ root, uiScale: 0.1 });
    expect(getKitPreferences(root).uiScale).toBe(0.5);
    setKitPreferences({ root, uiScale: Number.NaN });
    expect(getKitPreferences(root).uiScale).toBe(0.5);
  });
});
