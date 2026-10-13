import { describe, expect, it } from 'vitest';
import { BUNDLE_FORMAT_VERSION, type BundleBaseline } from './bundleModel';
import { diffBundle, readBundleBaseline } from './bundleDiff';

const bundle = (
  chunks: Record<string, number>,
  mainGroups: Record<string, number> = {}
): BundleBaseline => ({
  formatVersion: BUNDLE_FORMAT_VERSION,
  chunks: Object.fromEntries(
    Object.entries(chunks).map(([name, gzip]) => [name, { bytes: gzip * 3, gzip }])
  ),
  main: { chunk: 'assets/index.js', modules: 1, rendered: 0, gzip: 0 },
  mainGroups: Object.fromEntries(
    Object.entries(mainGroups).map(([name, gzip]) => [name, { modules: 1, rendered: 0, gzip }])
  ),
});

describe('diffBundle', () => {
  it('flags growth past the tolerance and new chunks, reports shrinking and gone ones', () => {
    const before = bundle(
      { 'assets/index.js': 400_000, 'assets/a.js': 10_000, 'assets/gone.js': 1_000 },
      { three: 300_000 }
    );
    const after = bundle(
      { 'assets/index.js': 405_000, 'assets/a.js': 9_000, 'assets/new.js': 500 },
      { three: 304_000 }
    );
    expect(diffBundle(before, after)).toEqual([
      { line: 'assets/index.js: 390.6 kB → 395.5 kB gzip (+4.9 kB)', attention: true },
      { line: 'assets/a.js: 9.8 kB → 8.8 kB gzip (−1.0 kB)', attention: false },
      { line: 'new assets/new.js: 0.5 kB gzip', attention: true },
      { line: 'gone: assets/gone.js', attention: false },
      {
        line: '  main three: 293.0 kB → 296.9 kB gzip (+3.9 kB, 1 → 1 modules)',
        attention: false,
      },
    ]);
  });

  it('passes a change within the tolerance', () => {
    expect(
      diffBundle(bundle({ 'assets/index.js': 400_000 }), bundle({ 'assets/index.js': 400_050 }))
    ).toEqual([]);
  });
});

describe('readBundleBaseline', () => {
  it('reads the committed baseline', () => {
    expect(readBundleBaseline()?.main.chunk).toBe('assets/index.js');
  });

  it('reads a missing file as none', () => {
    expect(readBundleBaseline('/nonexistent/bundle.json')).toBeNull();
  });
});
