import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { HubDiagnostics } from './diagnostics';
import { createIssuesSection } from './generated/issues';
import { resolveApiLink, resolveRepoLink, type HubMarkdownEnv } from './markdown';

// p619 §1.4 H2: a malformed escape in a link threw out of the whole build, and two issue files
// whose names slug alike wrote one page

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aek-p619-links-'));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

const createEnv = () => {
  const diag = new HubDiagnostics();
  const env = {
    diag,
    root: '../',
    includes: [],
    apiLinks: () => ({ pagePath: 'documentation/x/', anchor: 'y' }),
  } as unknown as HubMarkdownEnv;
  return { env, diag };
};

describe('a link with a malformed escape is a diagnostic at its line', () => {
  it.each([
    ['api:', (env: HubMarkdownEnv) => resolveApiLink('api:load%Scene', env, 'p.md', 7)],
    ['repo:', (env: HubMarkdownEnv) => resolveRepoLink('repo:docs/100%.md', env, 'p.md', 7).href],
  ])('%s', (_kind, resolve) => {
    const { env, diag } = createEnv();
    expect(resolve(env)).toBe('#');
    expect(diag.errors).toMatchObject([{ file: 'p.md', line: 7 }]);
    expect(diag.errors[0].message).toMatch(/not followed by two hex digits/);
  });
});

describe('issue files', () => {
  it('two names that slug alike: the second is an error and gets no page', () => {
    const dir = path.join(TMP, 'issues');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a b.md'), '# One\n\nStatus: open\n\nText.\n');
    fs.writeFileSync(path.join(dir, 'a-b.md'), '# Two\n\nStatus: open\n\nText.\n');
    const diag = new HubDiagnostics();
    const section = createIssuesSection(diag, [{ dir, owner: 'aekasha' }]);
    expect(section.pages.map((page) => page.path)).toEqual(['issues/a-b/']);
    expect(diag.errors.map((error) => error.message)).toEqual([
      expect.stringContaining('rename one of the two files'),
    ]);
  });
});
