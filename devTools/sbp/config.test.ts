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

  it('names a bad id, a repeated one and an entry that doesn’t build yet', () => {
    expect(
      checkSbpProfiles([
        { id: 'app', entry: 'src/index.html' },
        { id: 'app', entry: 'src/index.html' },
        { id: 'Bad id', entry: 'src/app/profiles/banner/banner.embed.ts' },
      ])
    ).toEqual([
      'profile app listed twice',
      'profile id "Bad id": a letter, then letters, digits, -',
      'profile Bad id: only src/index.html builds so far (embeds: p611 Phase 4)',
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
            chunks: { 'index.js': 1, 'assets/a.js': -1 },
            groups: { '/three': 1, three: 0 },
            modules: { '/src/_engine/ui/': 0, '_engine/ui/icons/': 0 },
          },
        },
      ])
    ).toEqual([
      'profile app: budgets.initial: a whole number of bytes, 0 or more',
      'profile app: budgets.chunks "index.js": a file of dist/assets/ (assets/index.js)',
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
