import { describe, expect, it } from 'vitest';
import sbpProfiles from '../../sbp.config';
import { KIB, checkSbpProfiles, isWellUnderBudget } from './config';

describe('checkSbpProfiles', () => {
  it('accepts the app profile', () => {
    expect(checkSbpProfiles([{ id: 'app', entry: 'src/index.html' }])).toEqual([]);
  });

  it('accepts sbp.config.ts', () => {
    expect(checkSbpProfiles(sbpProfiles)).toEqual([]);
  });

  it('names a bad id and a repeated one', () => {
    expect(
      checkSbpProfiles([
        { id: 'app', entry: 'src/index.html' },
        { id: 'app', entry: 'src/index.html' },
        { id: 'Bad id', entry: 'src/app/profiles/banner/banner.embed.ts', scenes: ['banner'] },
      ])
    ).toEqual([
      'profile app listed twice',
      'profile id "Bad id": a letter, then letters, digits, -',
    ]);
  });

  it('accepts an embed with its scenes, and names a bad entry, no scenes and a scene twice', () => {
    expect(
      checkSbpProfiles([
        { id: 'banner', entry: 'src/app/profiles/banner/banner.embed.ts', scenes: ['banner'] },
      ])
    ).toEqual([]);
    expect(
      checkSbpProfiles([
        { id: 'a', entry: 'src/app/profiles/a/a.embed.js', scenes: ['x'] },
        { id: 'b', entry: 'src/../b.ts', scenes: ['x'] },
        { id: 'c', entry: 'src/app/profiles/c/c.embed.ts' },
        { id: 'd', entry: 'src/app/profiles/d/d.embed.ts', scenes: [] },
        { id: 'e', entry: 'src/app/profiles/e/e.embed.ts', scenes: ['x', 'x'] },
      ])
    ).toEqual([
      'profile a: entry "src/app/profiles/a/a.embed.js": src/index.html, or an embed\'s .ts module under src/',
      'profile b: entry "src/../b.ts": src/index.html, or an embed\'s .ts module under src/',
      "profile c: an embed lists its scenes (scenes: ['<sceneId>'])",
      "profile d: an embed lists its scenes (scenes: ['<sceneId>'])",
      'profile e: a scene listed twice',
    ]);
  });

  it('names a budget that isn’t a whole number of bytes and a key of the wrong shape', () => {
    expect(
      checkSbpProfiles([
        {
          id: 'app',
          entry: 'src/index.html',
          budgets: {
            initial: 1.5,
            chunks: { 'assets/sub/a.js': 1, 'assets/a.js': -1 },
            groups: { '/three': 1, three: 0 },
            modules: { '/src/_engine/ui/': 0, '_engine/ui/icons/': 0 },
          },
        },
      ])
    ).toEqual([
      'profile app: budgets.initial: a whole number of bytes, 0 or more',
      'profile app: budgets.chunks "assets/sub/a.js": a file of assets/, or an embed\'s entry (assets/index.js)',
      'profile app: budgets.chunks assets/a.js: a whole number of bytes, 0 or more',
      'profile app: budgets.groups "/three": a group (three, _engine/features/physics)',
      'profile app: budgets.modules "/src/_engine/ui/": a path from src/ (_engine/ui/icons/ or …/BuiltInIcons.ts)',
    ]);
  });
});

describe('isWellUnderBudget', () => {
  it('reports more than 10% under, and never less than 2 KiB under', () => {
    expect(isWellUnderBudget(100 * KIB, 104 * KIB)).toBe(false);
    expect(isWellUnderBudget(89 * KIB, 100 * KIB)).toBe(true);
    // 33% under, but within 2 KiB
    expect(isWellUnderBudget(2 * KIB, 3 * KIB)).toBe(false);
    expect(isWellUnderBudget(0, 0)).toBe(false);
  });
});
