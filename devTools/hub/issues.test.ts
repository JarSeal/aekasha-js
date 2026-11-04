import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { HubDiagnostics } from './diagnostics';
import { createHubMarkdown, createMarkdownEnv, type HubRenderContext } from './markdown';
import type { HubPage } from './types';
import { createIssuesSection, parseIssue, parseStatus, type IssueSource } from './generated/issues';

// The Issues section (p619 H2, p809 D7): the issue-file header, and Ækasha's and the app's folders

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aek-hub-issues-'));
afterAll(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

/** A folder of issue files under the temp root, by file name */
const writeFolder = (name: string, files: Record<string, string>) => {
  const dir = path.join(tempRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), text);
  return dir;
};

const issueText = (title: string, status: string, extra = '') =>
  `**Title:** ${title}\n\nStatus: ${status}\nCategory: ECS\n${extra}\n## Problem\n\nWhat ${title} does.\n`;

const render = (sources: IssueSource[]) => {
  const diag = new HubDiagnostics();
  const section = createIssuesSection(diag, sources);
  const page = { file: 'index.html', body: '' } as HubPage;
  const env = createMarkdownEnv(page, '../', diag, {
    mode: 'dev',
    icons: { render: () => '' },
  } as unknown as HubRenderContext);
  const md = createHubMarkdown();
  const list = section.slots['generated-issues'](md, env);
  const pages = Object.fromEntries(
    section.pages.map((issuePage) => [
      issuePage.path,
      { ...issuePage, html: issuePage.slots['generated-issue'](md, env) },
    ])
  );
  return { section, list, pages, diag };
};

describe('an issue file', () => {
  it('reads its title, status, meta lines and summary', () => {
    const dir = writeFolder('parse', {
      'a.md': issueText('Leak in `X`', 'open | fixed upstream', 'Found: p601\n'),
    });
    const issue = parseIssue(path.join(dir, 'a.md'), 'aekasha', new HubDiagnostics());
    expect(issue.title).toBe('Leak in `X`');
    expect(issue.plainTitle).toBe('Leak in X');
    expect(issue.status).toMatchObject({ label: 'open', detail: 'fixed upstream', kind: 'open' });
    expect(issue.meta).toEqual([
      { key: 'Category', value: 'ECS' },
      { key: 'Found', value: 'p601' },
    ]);
    expect(issue.summary?.text).toBe('What Leak in `X` does.');
    expect(issue.path).toBe('issues/a/');
  });

  it('sorts a status into its kind', () => {
    expect(parseStatus('fixed | 2026-10-09').kind).toBe('closed');
    expect(parseStatus("won't fix").kind).toBe('closed');
    expect(parseStatus('not filed yet').kind).toBe('other');
    expect(parseStatus(undefined)).toMatchObject({ label: 'Status not stated', kind: 'open' });
  });

  it('warns without a title line and falls back to its first heading', () => {
    const dir = writeFolder('untitled', { 'b.md': '# A heading\n\nStatus: open\n\nText.\n' });
    const diag = new HubDiagnostics();
    expect(parseIssue(path.join(dir, 'b.md'), 'aekasha', diag).title).toBe('A heading');
    expect(diag.warnings).toHaveLength(1);
  });
});

describe("the Issues section's folders (p809 D7)", () => {
  const engineDir = writeFolder('engine', {
    'leak.md': issueText('Leak', 'open'),
    'old.md': issueText('Old', 'fixed'),
    'README.txt': 'not an issue',
  });
  const appDir = writeFolder('app', { 'scene-bug.md': issueText('Scene bug', 'open') });
  const emptyDir = writeFolder('empty', {});

  it('lists by status alone when the app has no issues, as before', () => {
    const { list, section, diag } = render([
      { dir: engineDir, owner: 'aekasha' },
      { dir: emptyDir, owner: 'app' },
    ]);
    expect([...diag.errors, ...diag.warnings]).toEqual([]);
    expect(section.pages.map(({ path: pagePath }) => pagePath)).toEqual([
      'issues/leak/',
      'issues/old/',
    ]);
    expect(list).toMatch(/<h2[^>]*>.*Open/);
    expect(list).not.toMatch(/Ækasha|The app/);
    expect(section.dirs).toEqual([engineDir, emptyDir]);
  });

  it("gives the app's issues flat pages, a part line and a tag, under a heading of their own", () => {
    const { list, pages, section, diag } = render([
      { dir: engineDir, owner: 'aekasha' },
      { dir: appDir, owner: 'app' },
    ]);
    expect([...diag.errors, ...diag.warnings]).toEqual([]);
    const appPage = pages['issues/scene-bug/'];
    expect(appPage.tags).toContain('app');
    expect(appPage.html).toMatch(/<dt>Part<\/dt><dd>The app<\/dd>/);
    expect(pages['issues/leak/'].tags).not.toContain('app');
    expect(pages['issues/leak/'].html).not.toMatch(/<dt>Part<\/dt>/);
    // Ækasha's first, each folder's statuses one level down
    expect(list.indexOf('Ækasha')).toBeLessThan(list.indexOf('The app'));
    expect(list).toMatch(/<h3[^>]*>.*Open/);
    expect(section.files).toContain(path.join(appDir, 'scene-bug.md'));
  });

  it('refuses a second file whose page the other folder has', () => {
    const clashDir = writeFolder('clash', { 'leak.md': issueText('Another leak', 'open') });
    const { section, diag } = render([
      { dir: engineDir, owner: 'aekasha' },
      { dir: clashDir, owner: 'app' },
    ]);
    expect(diag.errors).toHaveLength(1);
    expect(section.pages.filter(({ path: pagePath }) => pagePath === 'issues/leak/')).toHaveLength(
      1
    );
  });

  it('reads a missing folder as an empty one', () => {
    const { section, diag } = render([{ dir: path.join(tempRoot, 'none'), owner: 'app' }]);
    expect(section.pages).toEqual([]);
    expect(diag.errors).toEqual([]);
  });
});
