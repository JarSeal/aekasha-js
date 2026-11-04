import fs from 'node:fs';
import path from 'node:path';
import type { HubDiagnostics } from '../diagnostics';
import { APP_PLANS_DIR, PLANS_DIR } from '../paths';
import { listIssueFiles, type DocsOwner } from './issues';

/**
 * The plan model (p809 D3): every plan file of `docs/plans/` and `docsApp/plans/` (`CLAUDE.md`
 * aside) read into plain data for the roadmap pages.
 *
 * A plan's header lines (`docs/plans/CLAUDE.md`) are the lines before its first `# ` heading:
 * `Status` (line 1), `Category`, `Blocks`, `Blocked by`, `Epic` and `Related`, in any order. A
 * reference in them is a plan file name (`p305_….md`, `\_DONE_p347_….md` with Prettier's escape),
 * optionally behind a repo path (`docs/plans/…`, `docsApp/plans/…`: the other folder's, D2), and
 * its note is the text up to the next reference (`(soft: …)` makes a soft blocker). An epic's
 * `Blocks` entry for a plan whose `Epic` names it is membership, not a dependency.
 *
 * The warnings (never errors, so a plan being written never stops the Hub), each at its file and
 * line: a reference to a missing file (naming its `_DONE_` or non-`_DONE_` counterpart when that
 * exists, which it then resolves to), a `_DONE_` prefix and an `implemented` status that disagree,
 * no `Status` on line 1, no title, no priority number, an engine plan naming an app plan (D2), and
 * a `Blocks` / `Blocked by` cycle (its closing edge marked, for the graph to leave out).
 */

/** A folder of plan files and whose they are */
export type PlanSource = { dir: string; owner: DocsOwner };

/** The folders the roadmaps read, Ækasha's first */
export const PLAN_SOURCES: PlanSource[] = [
  { dir: PLANS_DIR, owner: 'aekasha' },
  { dir: APP_PLANS_DIR, owner: 'app' },
];

/** How a header line names a plan in the other folder (p809 D2) */
const OWNER_PREFIXES: Record<DocsOwner, string> = {
  aekasha: 'docs/plans/',
  app: 'docsApp/plans/',
};
const OWNER_ORDER: DocsOwner[] = ['aekasha', 'app'];

export type PlanState = 'open' | 'in progress' | 'done';
export type PlanKind = 'epic' | 'stub' | 'research' | 'backlog' | 'plan';

/** A dependency as one plan's row shows it: the other plan's key, and whether it's a soft one */
export type PlanLink = { plan: string; isSoft: boolean; note: string };

/** A blocker → blocked edge, from either side's header line (both sides' mentions are one edge) */
export type PlanEdge = {
  from: string;
  to: string;
  /** Soft only when every mention says `soft` */
  isSoft: boolean;
  /** The first mention's note, the blocked plan's own `Blocked by` first */
  note: string;
  /** The first mention: the file and line a cycle's warning names */
  file: string;
  line: number;
  /** The edge that closes a cycle: the graph leaves it out (the tables still list it) */
  closesCycle: boolean;
};

export type PlanEpic =
  | { kind: 'plan'; plan: string; note: string }
  | { kind: 'url'; url: string }
  | { kind: 'text'; text: string };

export type PlanPhase = {
  /** The heading's text without ` — done`: `Phase 3: the plan model` */
  heading: string;
  line: number;
  isDone: boolean;
};

export type Plan = {
  /** `<owner>/<file name without .md>`: unique across both folders */
  key: string;
  owner: DocsOwner;
  /** The file name without `.md`: `p305_terrain-material-generator` */
  name: string;
  file: string;
  /** The file name's `p<digits>`, or null (sorted last) */
  number: number | null;
  isDone: boolean;
  state: PlanState;
  kind: PlanKind;
  /** `Status` as written */
  status: string;
  /** The first `# ` heading without its kind suffix (`— Plan`), else the file name */
  title: string;
  /** `Category`, split on `,` */
  areas: string[];
  epic: PlanEpic | null;
  /** The plans it waits on, in plan order */
  blockers: PlanLink[];
  /** The plans waiting on it, in plan order */
  unblocks: PlanLink[];
  /** The plans whose `Epic` names it, in plan order */
  children: string[];
  /** None for a stub */
  phases: PlanPhase[];
};

export type PlanModel = {
  /** Ækasha's first, each folder by number */
  plans: Plan[];
  byKey: Map<string, Plan>;
  edges: PlanEdge[];
  /** Every plan file read, for the watcher */
  files: string[];
};

/** A plan reference as written in a header line */
type PlanReference = {
  owner: DocsOwner;
  /** Unescaped: `_DONE_p347_lod-chain-generation.md` */
  fileName: string;
  note: string;
  isSoft: boolean;
  line: number;
};

type HeaderKey = 'Status' | 'Category' | 'Blocks' | 'Blocked by' | 'Epic' | 'Related';
type HeaderLine = { value: string; line: number };

/** A plan file as read, before its references are resolved against the others */
type ParsedPlan = {
  plan: Plan;
  header: Partial<Record<HeaderKey, HeaderLine>>;
  blocks: PlanReference[];
  blockedBy: PlanReference[];
  epic: PlanReference | null;
  related: PlanReference[];
};

const HEADER_LINE_REGEX = /^(Status|Category|Blocks|Blocked by|Epic|Related):\s*(.*?)\s*$/;
/**
 * A plan file name, optionally behind a repo path. Not inside a longer name or path
 * (`docs/issues/p1_x.md` isn't one), and a Markdown escape before `_DONE_`'s underscores is allowed
 */
const REFERENCE_REGEX =
  /(?<![\w/.\\-])((?:docs|docsApp)\/plans\/)?((?:\\?_DONE\\?_)?p\d+\\?_[\w-]+\.md)\b/g;
const DONE_PREFIX = '_DONE_';
const NUMBER_REGEX = /^(?:_DONE_)?p(\d+)/;
const TITLE_REGEX = /^#\s+(.+?)\s*$/;
/** The title's kind suffixes; any other text after a `—` is part of the title */
const TITLE_SUFFIX_REGEX = /\s+—\s+(?:Plan|Stub|Epic|Backlog|Research & (?:Epic|Recommendation))$/;
const PHASE_REGEX = /^#{2,4}\s+((?:Phase|Stage)\s+(?:\d+[a-z]?|[A-Z])(?=$|[\s:(—-]).*?)\s*$/;
const PHASE_DONE_REGEX = /\s+—\s+done$/i;
const FENCE_REGEX = /^\s*(`{3,}|~{3,})/;
const URL_REGEX = /^https?:\/\/\S+$/;

const keyOf = (owner: DocsOwner, fileName: string) => `${owner}/${fileName.replace(/\.md$/, '')}`;

/** A reference as a header line would write it from anywhere: `docs/plans/p305_….md` */
const showReference = (owner: DocsOwner, fileName: string) => `${OWNER_PREFIXES[owner]}${fileName}`;

/** The text between a reference and the next: its parenthetical, without the list's separators */
const cleanNote = (text: string) =>
  text
    .replace(/^[\s,;]+/, '')
    .replace(/[\s,;]+$/, '')
    .replace(/(?:^|\s+)(?:and|or)$/, '')
    .trim();

/** A header line's plan references, each with its note */
const parseReferences = (header: HeaderLine | undefined, owner: DocsOwner): PlanReference[] => {
  if (!header) return [];
  const matches = [...header.value.matchAll(REFERENCE_REGEX)];
  return matches.map((match, i) => {
    const end = match.index + match[0].length;
    const note = cleanNote(header.value.slice(end, matches[i + 1]?.index ?? header.value.length));
    return {
      owner: match[1] ? (match[1].startsWith('docsApp/') ? 'app' : 'aekasha') : owner,
      fileName: match[2].replace(/\\_/g, '_'),
      note,
      isSoft: /^\(?\s*soft\b/i.test(note),
      line: header.line,
    };
  });
};

const getState = (isDone: boolean, status: string): PlanState =>
  isDone ? 'done' : /^in progress\b/i.test(status) ? 'in progress' : 'open';

/** The kind from the status's words; `epic` is also given by a plan's own children (`readPlans`) */
const getKind = (status: string): PlanKind =>
  /\bepic\b/i.test(status)
    ? 'epic'
    : /\bstub\b/i.test(status)
      ? 'stub'
      : /\b(?:research|study)\b/i.test(status)
        ? 'research'
        : /\bbacklog\b/i.test(status)
          ? 'backlog'
          : 'plan';

/** The header lines (before the first `# ` heading) and the title */
const readHeader = (lines: string[]) => {
  const header: Partial<Record<HeaderKey, HeaderLine>> = {};
  let title: { text: string; line: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const titleMatch = TITLE_REGEX.exec(lines[i]);
    if (titleMatch) {
      title = { text: titleMatch[1], line: i + 1 };
      break;
    }
    const match = HEADER_LINE_REGEX.exec(lines[i]);
    if (match) header[match[1] as HeaderKey] ??= { value: match[2], line: i + 1 };
  }
  return { header, title };
};

/** The `Phase <n>` and `Stage <x>` headings (`##` to `####`) outside code fences */
const readPhases = (lines: string[], from: number): PlanPhase[] => {
  const phases: PlanPhase[] = [];
  let fence: string | null = null;
  for (let i = from; i < lines.length; i++) {
    const fenceMatch = FENCE_REGEX.exec(lines[i]);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const match = PHASE_REGEX.exec(lines[i]);
    if (!match) continue;
    const isDone = PHASE_DONE_REGEX.test(match[1]);
    phases.push({ heading: match[1].replace(PHASE_DONE_REGEX, ''), line: i + 1, isDone });
  }
  return phases;
};

/** One plan file: its own fields and its references as written (the per-file warnings here) */
const parsePlan = (file: string, owner: DocsOwner, diag: HubDiagnostics): ParsedPlan => {
  const name = path.basename(file, '.md');
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  const { header, title } = readHeader(lines);

  const number = NUMBER_REGEX.exec(name);
  if (!number) {
    diag.warn(file, 1, 'No priority number in the file name (`p<digits>_<name>.md`): sorted last');
  }
  const isDone = name.startsWith(DONE_PREFIX);
  const status = header.Status?.value ?? '';
  if (header.Status?.line !== 1) {
    diag.warn(file, 1, 'No "Status:" line on line 1 (the header lines in docs/plans/CLAUDE.md)');
  }
  const isImplemented = /^implemented\b/i.test(status);
  if (isDone && !isImplemented) {
    diag.warn(
      file,
      header.Status?.line ?? 1,
      `A ${DONE_PREFIX} file whose Status doesn't start with "implemented"`
    );
  } else if (!isDone && isImplemented) {
    diag.warn(
      file,
      header.Status?.line,
      `Status "implemented" without the ${DONE_PREFIX} prefix: \`git mv\` it (docs/plans/CLAUDE.md's "Mark the plan done")`
    );
  }
  if (!title) diag.warn(file, 1, 'No "# " title heading: the file name stands in');

  const kind = getKind(status);
  const epicLine = header.Epic;
  const epicReference = parseReferences(epicLine, owner)[0] ?? null;
  let epic: PlanEpic | null = null;
  if (epicLine && !epicReference) {
    epic = URL_REGEX.test(epicLine.value)
      ? { kind: 'url', url: epicLine.value }
      : { kind: 'text', text: epicLine.value };
  }
  return {
    plan: {
      key: keyOf(owner, name),
      owner,
      name,
      file,
      number: number ? Number(number[1]) : null,
      isDone,
      state: getState(isDone, status),
      kind,
      status,
      title: title?.text.replace(TITLE_SUFFIX_REGEX, '') || name,
      areas: (header.Category?.value ?? '')
        .split(',')
        .map((area) => area.trim())
        .filter(Boolean),
      epic,
      blockers: [],
      unblocks: [],
      children: [],
      phases: kind === 'stub' ? [] : readPhases(lines, title?.line ?? lines.length),
    },
    header,
    blocks: parseReferences(header.Blocks, owner),
    blockedBy: parseReferences(header['Blocked by'], owner),
    epic: epicReference,
    related: parseReferences(header.Related, owner),
  };
};

/** Plan order: Ækasha's first, then by number (none last), then by name */
const comparePlans = (a: Plan, b: Plan) =>
  OWNER_ORDER.indexOf(a.owner) - OWNER_ORDER.indexOf(b.owner) ||
  (a.number ?? Infinity) - (b.number ?? Infinity) ||
  a.name.localeCompare(b.name);

/**
 * Marks each edge that closes a cycle and warns with the cycle in full: a DFS in plan order, over
 * `model.edges` (sorted by their ends' plan order, so the same edge closes it on every build)
 */
const markCycles = (model: PlanModel, diag: HubDiagnostics) => {
  const outgoing = new Map<string, PlanEdge[]>();
  for (const edge of model.edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  }

  const state = new Map<string, 'visiting' | 'visited'>();
  const stack: string[] = [];
  const visit = (key: string) => {
    state.set(key, 'visiting');
    stack.push(key);
    for (const edge of outgoing.get(key) ?? []) {
      const next = state.get(edge.to);
      if (next === 'visiting') {
        edge.closesCycle = true;
        const cycle = [...stack.slice(stack.indexOf(edge.to)), edge.to];
        diag.warn(
          edge.file,
          edge.line,
          `A Blocks / Blocked by cycle: ${cycle.map((plan) => model.byKey.get(plan)!.name).join(' → ')}`
        );
      } else if (!next) visit(edge.to);
    }
    stack.pop();
    state.set(key, 'visited');
  };
  for (const plan of model.plans) if (!state.has(plan.key)) visit(plan.key);
};

/**
 * Every plan of `sources` (Ækasha's and the app's by default), with the references resolved across
 * both folders: the blockers and the plans each unblocks, the epics' children, and the warnings
 * (this module's comment), read once per build
 */
export const readPlans = (
  diag: HubDiagnostics,
  sources: PlanSource[] = PLAN_SOURCES
): PlanModel => {
  const files = sources.flatMap(({ dir, owner }) =>
    listIssueFiles(dir)
      .filter((file) => path.basename(file) !== 'CLAUDE.md')
      .map((file) => ({ file, owner }))
  );
  const parsed = files.map(({ file, owner }) => parsePlan(file, owner, diag));
  const plans = parsed.map(({ plan }) => plan).sort(comparePlans);
  const byKey = new Map(plans.map((plan) => [plan.key, plan]));
  const model: PlanModel = { plans, byKey, edges: [], files: files.map(({ file }) => file) };

  /** The plan a reference names, or its `_DONE_` / non-`_DONE_` counterpart with a warning */
  const resolve = (from: Plan, reference: PlanReference) => {
    const key = keyOf(reference.owner, reference.fileName);
    if (byKey.has(key)) return key;
    const counterpart = reference.fileName.startsWith(DONE_PREFIX)
      ? reference.fileName.slice(DONE_PREFIX.length)
      : DONE_PREFIX + reference.fileName;
    const counterpartKey = keyOf(reference.owner, counterpart);
    const shown = showReference(reference.owner, reference.fileName);
    if (byKey.has(counterpartKey)) {
      diag.warn(
        from.file,
        reference.line,
        `${shown} doesn't exist: it's ${showReference(reference.owner, counterpart)} now (update the reference)`
      );
      return counterpartKey;
    }
    diag.warn(from.file, reference.line, `${shown} doesn't exist: renamed or removed?`);
    return null;
  };

  /** D2: an engine plan never names an app plan in `Blocks`, `Blocked by` or `Epic` */
  const checkLayering = (from: Plan, reference: PlanReference, line: string) => {
    if (from.owner !== 'aekasha' || reference.owner !== 'app') return;
    diag.warn(
      from.file,
      reference.line,
      `An engine plan names an app plan in ${line} (${showReference(reference.owner, reference.fileName)}): the app plan's own Blocked by records the dependency (p809 D2)`
    );
  };

  const edgesByPair = new Map<string, PlanEdge>();
  const addEdge = (from: string, to: string, reference: PlanReference, file: string) => {
    const pair = `${from}\0${to}`;
    const edge = edgesByPair.get(pair);
    if (edge) {
      edge.isSoft &&= reference.isSoft;
      edge.note ||= reference.note;
      return;
    }
    const added: PlanEdge = {
      from,
      to,
      isSoft: reference.isSoft,
      note: reference.note,
      file,
      line: reference.line,
      closesCycle: false,
    };
    edgesByPair.set(pair, added);
    model.edges.push(added);
  };

  // The epics first: a Blocks entry is membership when its plan's Epic names the plan
  for (const { plan, epic } of parsed) {
    if (!epic) continue;
    checkLayering(plan, epic, 'Epic');
    const key = resolve(plan, epic);
    plan.epic = key
      ? { kind: 'plan', plan: key, note: epic.note }
      : { kind: 'text', text: showReference(epic.owner, epic.fileName) };
    if (key) byKey.get(key)!.children.push(plan.key);
  }
  // The blocked plan's own Blocked by first, so its note wins over the blocker's Blocks note
  for (const { plan, blockedBy } of parsed) {
    for (const reference of blockedBy) {
      checkLayering(plan, reference, 'Blocked by');
      const key = resolve(plan, reference);
      if (key) addEdge(key, plan.key, reference, plan.file);
    }
  }
  for (const { plan, blocks } of parsed) {
    for (const reference of blocks) {
      checkLayering(plan, reference, 'Blocks');
      const key = resolve(plan, reference);
      if (!key) continue;
      const target = byKey.get(key)!;
      if (target.epic?.kind === 'plan' && target.epic.plan === plan.key) plan.kind = 'epic';
      else addEdge(plan.key, key, reference, plan.file);
    }
  }
  for (const { plan, related } of parsed) for (const reference of related) resolve(plan, reference);

  const order = new Map(plans.map((plan, i) => [plan.key, i]));
  model.edges.sort(
    (a, b) => order.get(a.from)! - order.get(b.from)! || order.get(a.to)! - order.get(b.to)!
  );
  for (const edge of model.edges) {
    byKey.get(edge.to)!.blockers.push({ plan: edge.from, isSoft: edge.isSoft, note: edge.note });
    byKey.get(edge.from)!.unblocks.push({ plan: edge.to, isSoft: edge.isSoft, note: edge.note });
  }
  for (const plan of plans) {
    plan.blockers.sort((a, b) => order.get(a.plan)! - order.get(b.plan)!);
    plan.children.sort((a, b) => order.get(a)! - order.get(b)!);
  }
  markCycles(model, diag);
  return model;
};
