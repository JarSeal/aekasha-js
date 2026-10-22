import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROOT } from './paths';
import { parseSnippetSpec, readSnippet, type HubSnippetResult } from './snippets';

/** The files a snippet reads must be inside the repo: a folder under the gitignored `.cache/` */
let dir = '';
let rel = '';

const SOURCE = `import { a } from 'b';

export const setup = () => {
  // #region setup (shown in the Hub)
  const world = createWorld();
  // #region inner
  world.step();
  // #endregion inner
  return world;
  // #endregion setup
};

/* #region css-style */
const x = 1;
/* #endregion css-style */

// #region twice
// #endregion twice
// #region twice
// #endregion twice

// #region open
const unclosed = true;
`;

const read = (ref: string): HubSnippetResult => readSnippet(parseSnippetSpec(`${rel}/${ref}`));
const message = (result: HubSnippetResult) => (result.isOk ? '' : result.message);

beforeAll(() => {
  fs.mkdirSync(path.join(ROOT, '.cache'), { recursive: true });
  dir = fs.mkdtempSync(path.join(ROOT, '.cache', 'hub-snippets-'));
  rel = path.relative(ROOT, dir).split(path.sep).join('/');
  fs.writeFileSync(path.join(dir, 'source.ts'), SOURCE);
  fs.writeFileSync(path.join(dir, 'data.json'), '{\n  "a": 1,\n  "b": 2\n}\n');
  fs.writeFileSync(path.join(dir, 'empty.ts'), '\n\n');
  fs.writeFileSync(path.join(dir, 'image.png'), '');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aek-snippet-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.ts'), 'export const secret = 1;\n');
  fs.symlinkSync(path.join(outside, 'secret.ts'), path.join(dir, 'link.ts'));
});

afterAll(() => {
  const outside = path.dirname(fs.realpathSync(path.join(dir, 'link.ts')));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe('parseSnippetSpec', () => {
  it('splits the path, the fragment and the meta', () => {
    expect(parseSnippetSpec('  src/a.ts#setup {3} wrap ')).toEqual({
      path: 'src/a.ts',
      fragment: 'setup',
      meta: '{3} wrap',
    });
    expect(parseSnippetSpec('src/a.ts')).toEqual({ path: 'src/a.ts', fragment: '', meta: '' });
  });
});

describe('readSnippet', () => {
  it('reads a region, dropping its nested markers and dedenting it', () => {
    expect(read('source.ts#setup')).toMatchObject({
      isOk: true,
      lang: 'ts',
      startLine: null,
      code: 'const world = createWorld();\nworld.step();\nreturn world;',
    });
  });

  it('takes the marker in any comment style', () => {
    expect(read('source.ts#css-style')).toMatchObject({ isOk: true, code: 'const x = 1;' });
  });

  it('reads lines, numbered as in the file past the blank lines it drops', () => {
    expect(read('source.ts#L2-L3')).toMatchObject({
      isOk: true,
      code: 'export const setup = () => {',
      startLine: 3,
    });
  });

  it("doesn't number lines a dropped marker would shift", () => {
    expect(read('source.ts#L4-L5')).toMatchObject({
      isOk: true,
      code: 'const world = createWorld();',
      startLine: null,
    });
  });

  it('reads a whole file without its markers, and JSON whole or by lines', () => {
    const whole = read('source.ts');
    expect(whole.isOk && whole.code).not.toContain('#region');
    expect(read('data.json')).toMatchObject({ isOk: true, lang: 'json' });
    expect(read('data.json#L2')).toMatchObject({ isOk: true, code: '"a": 1,', startLine: 2 });
  });

  it.each([
    ['source.ts#nope', 'No "#region nope" in it (it has: setup, inner, css-style, twice, open)'],
    ['source.ts#twice', '"#region twice" is in it 2 times (lines 17, 19): rename one'],
    ['source.ts#open', '"#region open" (line 22) has no "#endregion open"'],
    ['source.ts#L0-L2', '#L0-L2: '],
    ['source.ts#L30', '#L30: '],
    ['data.json#setup', 'JSON has no comments'],
    ['empty.ts', 'is empty'],
    ['missing.ts', 'No such file'],
    ['image.png', 'only text files can be included'],
    ['link.ts', 'links to a file outside the repo'],
  ])('%s fails: %s', (ref, expected) => {
    const result = read(ref);
    expect(result.isOk).toBe(false);
    expect(message(result)).toContain(expected);
  });

  it('refuses an absolute path and one outside the repo', () => {
    expect(message(readSnippet(parseSnippetSpec('/etc/passwd')))).toContain('not absolute');
    expect(message(readSnippet(parseSnippetSpec('../outside.ts')))).toContain('outside the repo');
    expect(message(readSnippet(parseSnippetSpec('')))).toContain('needs a file');
  });

  it('gives the resolved file of a missing one, so the dev server watches it', () => {
    const result = read('missing.ts');
    expect(result.file).toBe(path.join(dir, 'missing.ts'));
  });
});
