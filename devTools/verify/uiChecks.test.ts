import { describe, expect, it } from 'vitest';
import type { UiSetting } from './uiChecks';
import {
  BOX_STATE_NAME,
  describeStep,
  findAllowance,
  findStaleAllowances,
  getDemoStates,
  getSnapshotFile,
  groupProblems,
  groupViolations,
  parseUiArgs,
} from './uiChecks';

const UI_DARK: UiSetting = { theme: 'dark', density: '' };

describe('parseUiArgs', () => {
  it('reads the URL (with its slash), the pieces and the flags', () => {
    expect(parseUiArgs(['--url', 'http://localhost:8080/hub', '--only', 'window,dialog'])).toEqual({
      url: 'http://localhost:8080/hub/',
      noBuild: false,
      only: ['window', 'dialog'],
      update: false,
      headed: false,
    });
    expect(parseUiArgs(['--headed']).headed).toBe(true);
    expect(parseUiArgs(['--no-build']).noBuild).toBe(true);
    expect(parseUiArgs(['--update']).update).toBe(true);
  });

  it('throws on an unknown argument or a missing value', () => {
    expect(() => parseUiArgs(['--webgl'])).toThrow('Unknown argument: --webgl');
    expect(() => parseUiArgs(['--only'])).toThrow('Unknown argument: --only');
  });
});

describe('getDemoStates', () => {
  it('runs the box, each button (a repeated text numbered) and the table’s states', () => {
    const states = getDemoStates(['Info', 'Alert', 'Info'], {
      states: [{ name: 'list open', steps: [{ clickHud: '.x' }] }],
    });
    expect(states).toEqual([
      { name: BOX_STATE_NAME, steps: [] },
      { name: 'Info', steps: [{ button: 0 }] },
      { name: 'Alert', steps: [{ button: 1 }] },
      { name: 'Info 2', steps: [{ button: 2 }] },
      { name: 'list open', steps: [{ clickHud: '.x' }] },
    ]);
  });

  it('throws when two states make the same file name', () => {
    expect(() => getDemoStates(['Default'], { states: [{ name: 'default!', steps: [] }] })).toThrow(
      'Two states named "Default" and "default!"'
    );
  });

  it('names a screenshot by the piece, the state and the setting', () => {
    expect(getSnapshotFile('toaster', 'Info 2', { theme: 'light', density: 'compact' })).toBe(
      'toaster/info-2.light-compact.png'
    );
    expect(getSnapshotFile('dialog', 'with a drop-down, its list open', UI_DARK)).toBe(
      'dialog/with-a-drop-down-its-list-open.dark.png'
    );
  });
});

describe('groupViolations', () => {
  it('merges a rule over the settings, joining its targets', () => {
    const v = (targets: string[]) => ({ rule: 'r', impact: 'serious', help: 'h', targets });
    expect(
      groupViolations([
        { setting: 'dark', violations: [v(['#a'])] },
        { setting: 'light', violations: [v(['#a', '#b'])] },
        { setting: 'dark compact', violations: [] },
      ])
    ).toEqual([{ ...v(['#a', '#b']), settings: ['dark', 'light'] }]);
  });
});

describe('the allow list', () => {
  const list = [
    { rule: 'aria-dialog-name', piece: 'window', until: 'Phase 5.1' },
    { rule: 'color-contrast', piece: 'toaster', until: 'Phase 5.4' },
  ];

  it('allows a rule on its piece only', () => {
    expect(findAllowance(list, 'aria-dialog-name', 'window')).toBe(list[0]);
    expect(findAllowance(list, 'aria-dialog-name', 'dialog')).toBeUndefined();
  });

  it('lists the allowances that matched nothing, for the pieces run only', () => {
    const found = new Set(['aria-dialog-name@window']);
    expect(findStaleAllowances(list, ['window'], found)).toEqual([]);
    expect(findStaleAllowances(list, ['window', 'toaster'], found)).toEqual([list[1]]);
  });
});

describe('describeStep', () => {
  it('names each kind of step in a line', () => {
    expect(describeStep({ button: 0 })).toBe('button 1');
    expect(describeStep({ press: 'Shift+Tab' })).toBe('press Shift+Tab');
    expect(describeStep({ focusBox: 'Default' })).toBe('focusBox "Default"');
    expect(describeStep({ clickInBox: '.aekButton' })).toBe('clickInBox .aekButton');
    expect(describeStep({ contextClickInBox: '.aekField__label' })).toBe(
      'contextClickInBox .aekField__label'
    );
    expect(describeStep({ keyDown: 'Enter' })).toBe('keyDown Enter');
    expect(describeStep({ keyUp: 'Enter' })).toBe('keyUp Enter');
    expect(describeStep({ focusInBox: '.aekButton' })).toBe('focusInBox .aekButton');
    expect(describeStep({ expectFocusBox: 'Default' })).toBe('expectFocusBox "Default"');
    expect(describeStep({ expectStyle: '#t', name: 'left', value: '16px' })).toBe(
      'expectStyle #t left="16px"'
    );
    expect(describeStep({ expectAttr: '#t', name: 'aria-expanded', value: null })).toBe(
      'expectAttr #t aria-expanded=absent'
    );
    expect(describeStep({ expectCount: '.toast', count: 0 })).toBe('expectCount .toast = 0');
    expect(describeStep({ expectValue: '#t', value: 'ab' })).toBe('expectValue #t "ab"');
    expect(describeStep({ expectActiveOption: 'Teal' })).toBe('expectActiveOption "Teal"');
  });
});

describe('groupProblems', () => {
  it('lists each problem once with its settings', () => {
    expect(
      groupProblems([
        { setting: 'dark', problems: ['a', 'b'] },
        { setting: 'light', problems: ['a'] },
      ])
    ).toEqual([
      { problem: 'a', settings: ['dark', 'light'] },
      { problem: 'b', settings: ['dark'] },
    ]);
  });
});
