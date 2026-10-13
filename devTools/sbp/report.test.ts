import { describe, expect, it } from 'vitest';
import {
  type Colors,
  REPORT_FORMAT_VERSION,
  formatReport,
  formatWhy,
  measureProfile,
  mergeReport,
} from './report';
import { createTestBundle } from './testBuild';

const NO_COLORS: Colors = { red: '', green: '', yellow: '', dim: '', reset: '' };

// Not the `app` profile's entry, so no bundle.json diff: the test reads no committed file
const measure = () =>
  measureProfile({
    profile: { id: 'test', entry: 'src/test.html' },
    collected: createTestBundle(),
    scenes: { a: ['skybox'], b: [] },
    dataFeatures: ['skybox', 'physics'],
  });

describe('measureProfile', () => {
  it('splits the build and lists the features with their chains', () => {
    const { report } = measure();
    expect(report.profile).toEqual({ id: 'test', entry: 'src/test.html', scenes: ['a', 'b'] });
    expect(report.initial.files).toEqual({ 'assets/index.js': { bytes: 45, gzip: 15 } });
    expect(Object.keys(report.lazy.files)).toEqual(['assets/GLTFLoader.js']);
    expect(report.features).toEqual([
      {
        feature: 'physics',
        initialGzip: 25,
        lazyGzip: 0,
        why: 'src/index.ts → aekasha/physics (features/physics/index.ts) → PhysicsFeature.ts',
        hasDataPart: true,
        scenes: [],
        isUnneededByData: true,
      },
    ]);
    expect(report.diff).toBeNull();
  });
});

describe('mergeReport', () => {
  it('replaces the profile and keeps the others', () => {
    const { report } = measure();
    const other = { ...report, profile: { ...report.profile, id: 'banner' } };
    const merged = mergeReport(mergeReport(null, other), report);
    expect(merged.formatVersion).toBe(REPORT_FORMAT_VERSION);
    expect(Object.keys(merged.profiles)).toEqual(['banner', 'test']);
  });

  it('drops a file of another format version', () => {
    const { report } = measure();
    const old = { formatVersion: REPORT_FORMAT_VERSION + 1, profiles: { banner: report } };
    expect(Object.keys(mergeReport(old, report).profiles)).toEqual(['test']);
  });
});

describe('the text', () => {
  it('formats the report', () => {
    const lines = formatReport(measure().report, NO_COLORS);
    expect(lines[0]).toBe('profile test: src/test.html, 2 scene(s)');
    expect(lines).toContain('initial: 1 file(s), 0.0 kB gzip (0.0 kB)');
    expect(lines.some((l) => /^ {2}physics .* no scene's data needs it/.test(l))).toBe(true);
    expect(lines.slice(-3)).toEqual([
      'diff against bundle.json: none (the app profile only)',
      '',
      'budgets: none (sbp.config.ts)',
    ]);
  });

  it('answers --why, and says when nothing matches', () => {
    const measured = measure();
    expect(formatWhy(measured, 'GLTFLoader.js', NO_COLORS)).toEqual({
      lines: [
        'why GLTFLoader.js (→ a static import, ⇢ an import())',
        'node_modules/three/GLTFLoader.js: code in lazy chunks only',
        '  src/index.ts → aekasha (_engine/index.ts) → kernel/init/InitEngine.ts → kernel/assets/ImportRegistry.ts → GLTFSource.ts ⇢ node_modules/three/GLTFLoader.js',
      ],
      isFound: true,
    });
    expect(formatWhy(measured, 'Nope.ts', NO_COLORS).isFound).toBe(false);
  });
});
