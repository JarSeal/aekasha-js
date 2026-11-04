import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ROOT } from '../paths';
import { HubDiagnostics } from './diagnostics';
import { createHubMarkdown, createMarkdownEnv, type HubRenderContext } from './markdown';
import type { HubPage } from './types';
import type { DocsOwner } from './generated/issues';
import { readPlans } from './generated/plans';
import { createRoadmapSections, createRowIds, type RoadmapSources } from './generated/roadmap';

// The roadmap pages (p809 D4, D6): the sections, the row ids, the links between the two roadmaps
// and the app's page without plans

// The rows link their files with `repo:`, which must be inside the repo: a folder under `.cache/`
fs.mkdirSync(path.join(ROOT, '.cache'), { recursive: true });
const tempRoot = fs.mkdtempSync(path.join(ROOT, '.cache', 'hub-roadmap-'));
afterAll(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

/** A folder under the temp root, by file name */
const writeFolder = (name: string, files: Record<string, string>) => {
  const dir = path.join(tempRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), text);
  return dir;
};

const plan = (header: string, title: string, body = '') => `${header}\n\n# ${title}\n\n${body}`;
const issue = (title: string, status: string, category?: string) =>
  `**Title:** ${title}\n\nStatus: ${status}\n${category ? `Category: ${category}\n` : ''}\n## Problem\n\nWhat it does.\n`;

const enginePlans = writeFolder('plans', {
  'CLAUDE.md': 'Not a plan.\n',
  'p100_epic.md': plan(
    'Status: draft | epic — not-implemented\nBlocks: p101_first.md, \\_DONE_p102_done-child.md',
    'The epic — Epic'
  ),
  'p101_first.md': plan(
    'Status: in progress | Phase 0 implemented\nCategory: Hub, Docs\nEpic: p100_epic.md\nBlocked by: \\_DONE_p102_done-child.md',
    'The first child',
    '### Phase 0: grounding — done\n\n### Phase 1: the `thing`\n'
  ),
  '_DONE_p102_done-child.md': plan('Status: implemented\nEpic: p100_epic.md', 'The done child'),
  'p200_other.md': plan(
    'Status: draft\nCategory: Physics\nBlocked by: p201_blocker.md (soft: later)',
    'Another plan'
  ),
  'p201_blocker.md': plan('Status: stub', 'A <blocker> & more — Stub'),
  'p202_lonely.md': plan('Status: backlog', 'The backlog — Backlog'),
  '_DONE_p050_old.md': plan('Status: implemented\nEpic: https://trello.com/b/x', 'An old plan'),
});
const appPlans = writeFolder('appPlans', {
  'p100_app-plan.md': plan('Status: draft\nBlocked by: docs/plans/p201_blocker.md', 'App plan'),
});
const engineIssues = writeFolder('issues', {
  'a.md': issue('Leak in `X`', 'open', 'Bug, ECS'),
  'b.md': issue('Slow', 'not filed yet', 'Physics, ecs'),
  'c.md': issue('Odd', 'open'),
  'd.md': issue('Fixed one', 'fixed', 'ECS'),
});
const emptyDir = writeFolder('empty', {});

const SOURCES: Required<RoadmapSources> = {
  plans: [
    { dir: enginePlans, owner: 'aekasha' },
    { dir: appPlans, owner: 'app' },
  ],
  issues: [
    { dir: engineIssues, owner: 'aekasha' },
    { dir: emptyDir, owner: 'app' },
  ],
};

/** Renders one roadmap page's slot as the build would, at its depth */
const render = (owner: DocsOwner, sources: RoadmapSources = SOURCES) => {
  const diag = new HubDiagnostics();
  const sections = createRoadmapSections(diag, sources);
  const section = sections[owner === 'aekasha' ? 0 : 1];
  const page = { file: 'index.html', body: '' } as HubPage;
  const env = createMarkdownEnv(page, '../../../', diag, {
    mode: 'dev',
    icons: { render: () => '' },
  } as unknown as HubRenderContext);
  const html = section.slots['generated-roadmap'](createHubMarkdown(), env);
  return { html, env, section, diag };
};

const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("Ækasha's roadmap", () => {
  const { html, env, diag } = render('aekasha');

  it('builds without a warning or an error', () => {
    expect([...diag.errors, ...diag.warnings]).toEqual([]);
  });

  it('has its sections in D4’s order, and a summary of the counts', () => {
    const order = ['In progress', 'Epics', 'Other plans', 'Done', 'Issues by area'].map((title) =>
      html.search(new RegExp(`<h2[^>]*>${title}`))
    );
    expect(order.every((index) => index > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain('4 open plans, 1 in progress, 2 done · 3 open issues.');
  });

  it('shows a plan in progress with its phases and its next phase, linked to its line', () => {
    expect(html).toContain(
      'In progress</span> <span class="hubRoadmapStatus">Phase 0 implemented</span>'
    );
    expect(html).toContain('1 of 2 phases done');
    expect(html).toMatch(
      /next: <a href="\/__open-in-editor\?file=[^"]*p101_first\.md%3A10" data-hub-open-in-editor>Phase 1: the <code>thing<\/code><\/a>/
    );
  });

  it('gives an open epic its section, graph and children’s table', () => {
    expect(html).toMatch(/<div class="hubRoadmapEpic" id="p100">\n<h3[^>]*>p100 The epic /);
    expect(html).toContain('1 of 2 children done');
    expect(html).toContain('id="hubPlanArrow-p100"');
    expect(html).toMatch(/<tr id="p101"><th scope="row"><a href="\/__open-in-editor/);
  });

  it('puts a plan’s id on its first row only: a done child in its epic, not in Done', () => {
    expect(count(html, 'id="p102"')).toBe(1);
    expect(html.indexOf('id="p102"')).toBeLessThan(html.indexOf('<details'));
    expect(html).toMatch(/<details class="hubRoadmapDone">\n<summary>The 2 done plans<\/summary>/);
    expect(html).toContain('<tr id="p50">');
    expect(html).toContain('>trello.com/b/x</a>');
    for (const id of ['p100', 'p101', 'p102', 'p200', 'p201', 'p202', 'p50']) {
      expect(env.ids.has(id)).toBe(true);
    }
  });

  it('draws the other plans with a dependency, and lists every other open plan', () => {
    const graph = html.slice(
      html.indexOf('hubPlanArrow-other'),
      html.indexOf('</figure>', html.indexOf('hubPlanArrow-other'))
    );
    expect(graph).toContain('href="#p200"');
    expect(graph).toContain('href="#p201"');
    expect(graph).not.toContain('#p202');
    expect(html).toContain('<tr id="p202">');
    // A soft blocker says so in words, and a title is escaped
    expect(html).toContain(
      'href="#p201" title="(soft: later)">p201</a> <span class="hubRoadmapNote">(soft)</span>'
    );
    expect(html).toContain('A &lt;blocker&gt; &amp; more');
  });

  it('links an app plan to its row on the app’s roadmap', () => {
    expect(html).toContain('href="../../../project/app/roadmap/#app-p100">the app’s p100</a>');
    expect(env.links).toContainEqual(
      expect.objectContaining({ targetPath: 'project/app/roadmap/', hash: 'app-p100' })
    );
  });

  it('lists the open issues under each area but Bug, Other last, and counts the closed', () => {
    const areas = [...html.matchAll(/<h3[^>]*>([^<]+?) <a class="hubAnchor"/g)].map(
      ([, name]) => name
    );
    expect(areas.slice(-3)).toEqual(['ECS', 'Physics', 'Other']);
    const ecs = html.slice(html.search(/<h3[^>]*>ECS/), html.search(/<h3[^>]*>Physics/));
    expect(ecs).toContain('Leak in <code>X</code>');
    expect(ecs).toContain('>Slow</a>');
    expect(ecs).not.toContain('Fixed one');
    expect(html).toContain('href="../../../issues/c/">Odd</a>');
    expect(html).toContain('1 closed issue not listed');
  });
});

describe("the app's roadmap", () => {
  it('names the rows app-…, and links an Ækasha plan to its row there', () => {
    const { html, env, diag } = render('app');
    expect([...diag.errors, ...diag.warnings]).toEqual([]);
    expect(html).toContain('<tr id="app-p100">');
    expect(html).toContain('href="../../../project/aekasha/roadmap/#p201">Ækasha’s p201</a>');
    expect(env.ids.has('app-p100')).toBe(true);
    // No app issues: no issues section
    expect(html).not.toContain('Issues by area');
  });

  it('says where the plans go when it has none, and leaves the other sections out', () => {
    const { html, env, diag } = render('app', {
      plans: [
        { dir: enginePlans, owner: 'aekasha' },
        { dir: emptyDir, owner: 'app' },
      ],
      issues: SOURCES.issues,
    });
    // The rules' anchor is checked against docs/plans/CLAUDE.md
    expect(diag.errors).toEqual([]);
    expect(html).toContain('No plans yet · 0 open issues.');
    expect(html).not.toMatch(/<h2/);
    expect(env.links).toContainEqual(
      expect.objectContaining({ targetPath: 'project/aekasha/', hash: 'from-a-plan-to-a-merge' })
    );
  });
});

describe('the sections', () => {
  it('watch each folder’s own files and folders', () => {
    const [engine, app] = createRoadmapSections(new HubDiagnostics(), SOURCES);
    expect(engine.path).toBe('project/aekasha/roadmap/');
    expect(app.path).toBe('project/app/roadmap/');
    expect(engine.dirs).toEqual([enginePlans, engineIssues]);
    expect(app.dirs).toEqual([appPlans, emptyDir]);
    expect(engine.files).toContain(path.join(engineIssues, 'a.md'));
    expect(engine.files).not.toContain(path.join(enginePlans, 'CLAUDE.md'));
    expect(app.files).toEqual([path.join(appPlans, 'p100_app-plan.md')]);
  });

  it('give a plan without a number, or sharing one, its file name’s slug', () => {
    const dir = writeFolder('ids', {
      'p7_a.md': plan('Status: draft', 'A'),
      'p7_b.md': plan('Status: draft', 'B'),
      'p8_c.md': plan('Status: draft', 'C'),
      'notes.md': plan('Status: draft', 'Notes'),
    });
    const model = readPlans(new HubDiagnostics(), [{ dir, owner: 'app' }]);
    expect([...createRowIds(model).values()]).toEqual([
      'app-p7-a',
      'app-p7-b',
      'app-p8',
      'app-notes',
    ]);
  });
});
