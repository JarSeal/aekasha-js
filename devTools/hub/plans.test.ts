import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { HubDiagnostics } from './diagnostics';
import { readPlans, type PlanSource } from './generated/plans';

// The plan model (p809 D3): the header lines, the references across both folders and the warnings

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aek-hub-plans-'));
afterAll(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

/** A folder of plan files under the temp root, by file name */
const writeFolder = (name: string, files: Record<string, string>) => {
  const dir = path.join(tempRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), text);
  return dir;
};

/** A plan file: its header lines (`Status` first unless given otherwise), a title and a body */
const planText = (header: string, title = 'A plan', body = '') =>
  `${header}\n\n# ${title}\n\nWhat it does.\n${body}`;

/** Ækasha's folder alone, or with the app's */
const read = (dir: string, appDir?: string) => {
  const diag = new HubDiagnostics();
  const sources: PlanSource[] = [{ dir, owner: 'aekasha' }];
  if (appDir) sources.push({ dir: appDir, owner: 'app' });
  const model = readPlans(diag, sources);
  const get = (key: string) => {
    const plan = model.byKey.get(key);
    if (!plan) throw new Error(`No plan ${key}`);
    return plan;
  };
  return { model, get, diag, messages: diag.warnings.map(({ message }) => message) };
};

describe("a plan's own fields", () => {
  it('reads every status form the plans use', () => {
    const statuses: [string, string, string, string][] = [
      // [file, status, state, kind]
      ['_DONE_p1_a.md', 'implemented', 'done', 'plan'],
      ['_DONE_p2_a.md', 'implemented (Phases 0-9)', 'done', 'plan'],
      ['_DONE_p3_a.md', 'implemented (Stages A-D)', 'done', 'plan'],
      ['p4_a.md', 'draft | not-implemented', 'open', 'plan'],
      ['p5_a.md', 'draft | epic — not-implemented', 'open', 'epic'],
      ['p6_a.md', 'draft | spike-gated, not-implemented', 'open', 'plan'],
      ['p7_a.md', 'draft | not-implemented | needs-replanning', 'open', 'plan'],
      ['p8_a.md', 'stub — not-implemented', 'open', 'stub'],
      ['p9_a.md', 'research done — epic, not-implemented', 'open', 'epic'],
      ['p10_a.md', 'draft | study + not-implemented', 'open', 'research'],
      ['p11_a.md', 'in progress | Phases 0-4 implemented', 'in progress', 'plan'],
      ['p12_a.md', 'backlog | not-implemented', 'open', 'backlog'],
    ];
    const dir = writeFolder(
      'statuses',
      Object.fromEntries(statuses.map(([file, status]) => [file, planText(`Status: ${status}`)]))
    );
    const { get, diag } = read(dir);
    expect(diag.items).toEqual([]);
    for (const [file, status, state, kind] of statuses) {
      const plan = get(`aekasha/${file.replace(/\.md$/, '')}`);
      expect({ file, status: plan.status, state: plan.state, kind: plan.kind }).toEqual({
        file,
        status,
        state,
        kind,
      });
    }
  });

  it('reads the number, title, areas and phases', () => {
    const dir = writeFolder('fields', {
      'p20_a.md': planText(
        'Status: in progress | Phase 1 implemented\nCategory: Assets, Textures , Texture atlas',
        'Texture Arrays — Plan',
        [
          '## Phases',
          '### Phase 0: Spike — done',
          '### Phase 1 — Runtime arrays (D1) — done',
          '```md',
          '### Phase 9: in a code block',
          '```',
          '#### Phase 2a (after p302)',
          '## Phases and risks',
          '### Phase two',
        ].join('\n')
      ),
      'p21_a.md': planText('Status: stub — not-implemented', 'Vehicles — Stub', '## Phase 1\n'),
      'p22_a.md': planText('Status: draft', 'LOD System — Research & Epic'),
      'p23_a.md': planText('Status: draft', 'Material Editor — Editable Params, Settings'),
      'p24_a.md': planText('Status: draft', 'Follow-ups — Backlog'),
    });
    const { get } = read(dir);
    const plan = get('aekasha/p20_a');
    expect(plan.number).toBe(20);
    expect(plan.title).toBe('Texture Arrays');
    expect(plan.areas).toEqual(['Assets', 'Textures', 'Texture atlas']);
    expect(plan.phases).toEqual([
      { heading: 'Phase 0: Spike', line: 8, isDone: true },
      { heading: 'Phase 1 — Runtime arrays (D1)', line: 9, isDone: true },
      { heading: 'Phase 2a (after p302)', line: 13, isDone: false },
    ]);
    // A stub has no phases, whatever its headings
    expect(get('aekasha/p21_a').phases).toEqual([]);
    expect(get('aekasha/p21_a').title).toBe('Vehicles');
    expect(get('aekasha/p22_a').title).toBe('LOD System');
    // Text after a `—` that isn't a kind suffix is the title's
    expect(get('aekasha/p23_a').title).toBe('Material Editor — Editable Params, Settings');
    expect(get('aekasha/p24_a').title).toBe('Follow-ups');
  });

  it('reads the header lines in any order, and leaves CLAUDE.md out', () => {
    const dir = writeFolder('order', {
      'CLAUDE.md': 'Notes for the plans.\n',
      'p1_epic.md': planText('Status: draft | epic\nBlocks: p2_child.md'),
      'p2_child.md': planText(
        'Status: draft\nRelated: p1_epic.md (the epic)\nEpic: p1_epic.md (Tier 1)'
      ),
    });
    const { model, get, diag } = read(dir);
    expect(diag.items).toEqual([]);
    expect(model.plans.map(({ key }) => key)).toEqual(['aekasha/p1_epic', 'aekasha/p2_child']);
    expect(get('aekasha/p2_child').epic).toEqual({
      kind: 'plan',
      plan: 'aekasha/p1_epic',
      note: '(Tier 1)',
    });
  });

  it("keeps an Epic that isn't a plan as a URL or as text", () => {
    const url = 'https://trello.com/c/8ROzNdXe/161-physics-thread';
    const dir = writeFolder('epics', {
      'p1_a.md': planText(`Status: draft\nEpic: ${url}`),
      'p2_a.md': planText('Status: draft\nEpic: Profiler (this plan is the base)'),
    });
    const { get } = read(dir);
    expect(get('aekasha/p1_a').epic).toEqual({ kind: 'url', url });
    expect(get('aekasha/p2_a').epic).toEqual({
      kind: 'text',
      text: 'Profiler (this plan is the base)',
    });
  });
});

describe("the plans' references", () => {
  it('reads a Blocks line with commas inside its notes, escaped _DONE_ names and soft blockers', () => {
    const dir = writeFolder('references', {
      'p1_a.md': planText(
        'Status: draft\nBlocks: p2_b.md (soft: Phase 2 macro noise, Phase 7 bake), \\_DONE_p3_c.md Phase 2 (`lod: AUTO`, its chains), p4_d.md and p5_e.md'
      ),
      'p2_b.md': planText('Status: draft'),
      '_DONE_p3_c.md': planText('Status: implemented'),
      'p4_d.md': planText('Status: draft'),
      'p5_e.md': planText('Status: draft\nRelated: `docs/issues/p6_not-a-plan.md`, p101 removed'),
    });
    const { model, get, diag } = read(dir);
    expect(diag.items).toEqual([]);
    expect(get('aekasha/p1_a').unblocks).toEqual([
      { plan: 'aekasha/p2_b', isSoft: true, note: '(soft: Phase 2 macro noise, Phase 7 bake)' },
      { plan: 'aekasha/_DONE_p3_c', isSoft: false, note: 'Phase 2 (`lod: AUTO`, its chains)' },
      { plan: 'aekasha/p4_d', isSoft: false, note: '' },
      { plan: 'aekasha/p5_e', isSoft: false, note: '' },
    ]);
    expect(get('aekasha/p2_b').blockers).toEqual([
      { plan: 'aekasha/p1_a', isSoft: true, note: '(soft: Phase 2 macro noise, Phase 7 bake)' },
    ]);
    expect(model.edges).toHaveLength(4);
  });

  it('makes one edge of both sides, soft only when both say so', () => {
    const dir = writeFolder('bothSides', {
      'p1_a.md': planText('Status: draft\nBlocks: p2_b.md (soft: macro noise), p3_c.md (soft)'),
      'p2_b.md': planText('Status: draft\nBlocked by: p1_a.md (the noise)'),
      'p3_c.md': planText('Status: draft\nBlocked by: p1_a.md (soft: wet decals)'),
    });
    const { model, get } = read(dir);
    expect(model.edges).toHaveLength(2);
    // The blocked plan's own note wins
    expect(get('aekasha/p2_b').blockers).toEqual([
      { plan: 'aekasha/p1_a', isSoft: false, note: '(the noise)' },
    ]);
    expect(get('aekasha/p3_c').blockers).toEqual([
      { plan: 'aekasha/p1_a', isSoft: true, note: '(soft: wet decals)' },
    ]);
  });

  it("counts an epic's Blocks entry for its own child as membership, not a dependency", () => {
    const dir = writeFolder('epicChildren', {
      'p1_outside.md': planText('Status: draft\nBlocks: p10_epic.md'),
      'p10_epic.md': planText('Status: draft | not-implemented\nBlocks: p12_two.md, p11_one.md'),
      'p11_one.md': planText('Status: draft\nEpic: p10_epic.md\nBlocks: p12_two.md'),
      'p12_two.md': planText('Status: draft\nEpic: p10_epic.md'),
    });
    const { model, get } = read(dir);
    const epic = get('aekasha/p10_epic');
    // Epic by its children alone: its status doesn't say so
    expect(epic.kind).toBe('epic');
    expect(epic.children).toEqual(['aekasha/p11_one', 'aekasha/p12_two']);
    expect(epic.unblocks).toEqual([]);
    expect(epic.blockers.map(({ plan }) => plan)).toEqual(['aekasha/p1_outside']);
    expect(model.edges.map(({ from, to }) => `${from} → ${to}`)).toEqual([
      'aekasha/p1_outside → aekasha/p10_epic',
      'aekasha/p11_one → aekasha/p12_two',
    ]);
  });

  it("resolves the other folder's plans by their repo path", () => {
    const engineDir = writeFolder('crossEngine', {
      'p100_engine.md': planText('Status: draft'),
    });
    const appDir = writeFolder('crossApp', {
      'p100_app.md': planText(
        'Status: draft\nBlocked by: docs/plans/p100_engine.md (soft: its API), p101_app.md'
      ),
      'p101_app.md': planText('Status: draft\nEpic: docs/plans/p100_engine.md'),
    });
    const { model, get, diag } = read(engineDir, appDir);
    expect(diag.items).toEqual([]);
    // The numbers are per folder: p100 in both
    expect(model.plans.map(({ key }) => key)).toEqual([
      'aekasha/p100_engine',
      'app/p100_app',
      'app/p101_app',
    ]);
    expect(get('app/p100_app').blockers).toEqual([
      { plan: 'aekasha/p100_engine', isSoft: true, note: '(soft: its API)' },
      { plan: 'app/p101_app', isSoft: false, note: '' },
    ]);
    expect(get('aekasha/p100_engine').children).toEqual(['app/p101_app']);
  });
});

describe("the plans' warnings", () => {
  let folders = 0;
  /** A fresh folder per test (and one for the app's plans when given) */
  const warn = (files: Record<string, string>, appFiles?: Record<string, string>) => {
    const name = `warn-${folders++}`;
    return read(
      writeFolder(name, files),
      appFiles ? writeFolder(`${name}-app`, appFiles) : undefined
    );
  };

  it('warns on a reference to a missing file, naming its _DONE_ counterpart', () => {
    const { get, diag } = warn({
      'p1_a.md': planText(
        'Status: draft\nBlocked by: p2_done.md\nBlocks: \\_DONE_p3_open.md\nRelated: p9_gone.md'
      ),
      '_DONE_p2_done.md': planText('Status: implemented'),
      'p3_open.md': planText('Status: draft'),
    });
    expect(diag.warnings.map(({ line, message }) => [line, message])).toEqual([
      [
        2,
        "docs/plans/p2_done.md doesn't exist: it's docs/plans/_DONE_p2_done.md now (update the reference)",
      ],
      [
        3,
        "docs/plans/_DONE_p3_open.md doesn't exist: it's docs/plans/p3_open.md now (update the reference)",
      ],
      [4, "docs/plans/p9_gone.md doesn't exist: renamed or removed?"],
    ]);
    // The counterparts stand in, so the dependencies stay
    expect(get('aekasha/p1_a').blockers.map(({ plan }) => plan)).toEqual(['aekasha/_DONE_p2_done']);
    expect(get('aekasha/p1_a').unblocks.map(({ plan }) => plan)).toEqual(['aekasha/p3_open']);
  });

  it('warns when the _DONE_ prefix and an implemented status disagree', () => {
    const { diag } = warn({
      '_DONE_p1_a.md': planText('Status: draft | not-implemented'),
      'p2_a.md': planText('Status: implemented (Phases 1-3)'),
    });
    expect(diag.warnings.map(({ file, line }) => [path.basename(file), line])).toEqual([
      ['_DONE_p1_a.md', 1],
      ['p2_a.md', 1],
    ]);
    expect(diag.warnings[0].message).toMatch(/doesn't start with "implemented"/);
    expect(diag.warnings[1].message).toMatch(/without the _DONE_ prefix/);
  });

  it('warns on no Status on line 1, no title and no number', () => {
    const { get, model, messages } = warn({
      'p1_a.md': planText('Category: Physics\nStatus: draft'),
      'p2_a.md': 'Status: draft\n\nNo heading.\n',
      'notes.md': planText('Status: draft'),
    });
    expect(messages).toEqual([
      expect.stringMatching(/^No priority number/),
      expect.stringMatching(/^No "Status:" line on line 1/),
      expect.stringMatching(/^No "# " title/),
    ]);
    // A Status further down is still read
    expect(get('aekasha/p1_a').status).toBe('draft');
    expect(get('aekasha/p2_a').title).toBe('p2_a');
    expect(model.plans.at(-1)?.name).toBe('notes');
  });

  it('warns on an engine plan naming an app plan (D2)', () => {
    const { messages } = warn(
      {
        'p1_a.md': planText(
          'Status: draft\nBlocks: docsApp/plans/p1_x.md\nRelated: docsApp/plans/p1_x.md'
        ),
      },
      { 'p1_x.md': planText('Status: draft') }
    );
    // Related isn't a dependency, so it may
    expect(messages).toEqual([
      expect.stringMatching(
        /^An engine plan names an app plan in Blocks \(docsApp\/plans\/p1_x\.md\)/
      ),
    ]);
  });

  it('warns on a cycle in full and marks the edge that closes it', () => {
    const { model, diag } = warn({
      'p1_a.md': planText('Status: draft\nBlocks: p2_b.md'),
      'p2_b.md': planText('Status: draft\nBlocks: p3_c.md'),
      'p3_c.md': planText('Status: draft\nBlocks: p1_a.md\nBlocked by: p4_d.md'),
      'p4_d.md': planText('Status: draft'),
    });
    expect(
      diag.warnings.map(({ file, line, message }) => [path.basename(file), line, message])
    ).toEqual([['p3_c.md', 2, 'A Blocks / Blocked by cycle: p1_a → p2_b → p3_c → p1_a']]);
    expect(
      model.edges.filter(({ closesCycle }) => closesCycle).map(({ from, to }) => `${from} → ${to}`)
    ).toEqual(['aekasha/p3_c → aekasha/p1_a']);
    // The tables still list it
    expect(model.byKey.get('aekasha/p1_a')?.blockers.map(({ plan }) => plan)).toEqual([
      'aekasha/p3_c',
    ]);
  });

  it('reads a missing folder as an empty one', () => {
    const { model, diag } = read(path.join(tempRoot, 'missing'), path.join(tempRoot, 'missing2'));
    expect(model.plans).toEqual([]);
    expect(diag.items).toEqual([]);
  });
});
