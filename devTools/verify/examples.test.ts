import { describe, expect, it } from 'vitest';
import {
  checkExamples,
  collectReadmeExamples,
  collectRepoExamples,
  extractExamples,
  extractMarkdownExamples,
  formatFinding,
  type ExampleBlock,
} from './examples';

const FIXTURE = 'fixture.ts';

// Checked in the repo's program (one program: building it is most of the time)
const FIXTURES: ExampleBlock[] = [
  {
    // Free names, the reader's own module, an unused result
    file: FIXTURE,
    line: 10,
    owner: 'free',
    code: [
      "import config from './CONFIG';",
      'const outline = createLines({ segments: box3EdgesToSegments(box), color });',
      'setPhysicsTierPolicy({ rings: [{ tier: config.tier }] });',
    ].join('\n'),
  },
  {
    // A wrong option on its third line
    file: FIXTURE,
    line: 20,
    owner: 'wrongOption',
    code: ['setPhysicsTierPolicy({', '  rings: [', "    { tier: 'NOPE' }],", '});'].join('\n'),
  },
  { file: FIXTURE, line: 30, owner: 'unknownEntry', code: "import { x } from 'aekasha/nope';" },
  { file: FIXTURE, line: 40, owner: 'syntax', code: 'for (...) createLines();' },
];

describe('@example', () => {
  it('extracts fenced and unfenced examples at their source lines', () => {
    const source = [
      '/**', //                                          1
      ' * Fenced.',
      ' * @example',
      ' * ```ts',
      ' * fenced(1);', //                                5
      ' *   indented(2);',
      ' * ```',
      ' * ```json',
      ' * { "skipped": true }',
      ' * ```', //                                       10
      ' */',
      'export const a = () => 1;',
      '/**',
      ' * @example unfenced(3);',
      ' * unfenced(4);', //                              15
      ' */',
      'export class B {',
      '  /** @example member(5); */',
      '  m() {}',
      '}', //                                            20
    ].join('\n');
    expect(extractExamples('m.ts', source)).toEqual([
      { file: 'm.ts', owner: 'a', line: 5, code: 'fenced(1);\n  indented(2);' },
      { file: 'm.ts', owner: 'B', line: 14, code: 'unfenced(3);\nunfenced(4);' },
      { file: 'm.ts', owner: 'B.m', line: 18, code: 'member(5);' },
    ]);
  });

  it("extracts a Markdown file's ts / js blocks, each owned by the heading above it", () => {
    const text = [
      '# Title', //                                      1
      '```bash',
      'yarn dev',
      '```',
      '## 1. Boot', //                                   5
      '```ts',
      'boot();',
      '```',
      '```jsonc',
      '{}', //                                           10
      '```',
      '### 2. Spin',
      '```js',
      'spin();',
      '```', //                                          15
    ].join('\n');
    expect(extractMarkdownExamples('readme.md', text)).toEqual([
      { file: 'readme.md', owner: '1. Boot', line: 7, code: 'boot();' },
      { file: 'readme.md', owner: '2. Spin', line: 14, code: 'spin();' },
    ]);
    expect(extractMarkdownExamples('readme.md', 'no code')).toEqual([]);
  });

  it('every documented API and readme example type-checks against the entries, and a bad one fails at its line', () => {
    const readme = collectReadmeExamples();
    expect(readme.length).toBeGreaterThan(0);
    const findings = checkExamples([...collectRepoExamples(), ...readme, ...FIXTURES]);
    expect(findings.filter((f) => f.file !== FIXTURE).map(formatFinding)).toEqual([]);

    const fixtureFindings = findings.filter((f) => f.file === FIXTURE);
    const byOwner = (owner: string) => fixtureFindings.filter((f) => f.owner === owner);
    expect(byOwner('free')).toEqual([]);
    expect(byOwner('wrongOption').map((f) => f.line)).toEqual([22]);
    expect(byOwner('unknownEntry').map((f) => f.message)).toEqual([
      expect.stringContaining("TS2307: Cannot find module 'aekasha/nope'"),
    ]);
    expect(byOwner('syntax').length).toBeGreaterThan(0);
    expect(byOwner('syntax').every((f) => f.line === 40)).toBe(true);
  }, 30_000);
});
