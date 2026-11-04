import path from 'node:path';
import MarkdownIt from 'markdown-it';
import { HubDiagnostics } from '../diagnostics';
import { escapeHtml } from '../html';
import {
  renderMarkdownText,
  resolveHubLink,
  resolveRepoLink,
  slugify,
  type HubMarkdownEnv,
} from '../markdown';
import { PLANS_DIR, toRepoPath } from '../paths';
import {
  ISSUE_SOURCES,
  listIssueFiles,
  parseIssue,
  type DocsOwner,
  type Issue,
  type IssueSource,
} from './issues';
import { createPlanGraph, getPlanLabel, renderPlanGraph } from './planGraph';
import {
  PLAN_SOURCES,
  readPlans,
  type Plan,
  type PlanLink,
  type PlanModel,
  type PlanSource,
  type PlanState,
} from './plans';
import type { HubGeneratedSection } from './section';

/**
 * The roadmap pages (p809 D4, D6): the dev pages `project/aekasha/roadmap/` and
 * `project/app/roadmap/`, each a hand-written page whose `generated-roadmap` slot this fills from
 * its folder's plans (`readPlans`, one model for both, since a reference crosses the folders) and
 * issues (`parseIssue`). Top to bottom: the counts, the plans in progress with their next phase,
 * a section per open epic (its graph and its children's table), the other open plans (the graph
 * of those with dependencies, and every one's row), the done plans in a closed `<details>`, and
 * the open issues by area.
 *
 * Every plan has a row id (`#p305`, `#app-p100` for the app's), on its first row on the page (a
 * done child is in its epic's table and in Done), and an open epic's on its section: a graph
 * node, a "Waits on" or "Unblocks" link jumps to it, and the row links the file. A plan of the
 * other folder links to that roadmap's row. The app's page with no plans says where they go and
 * leaves the other sections out.
 */

/** The two roadmap pages, by whose plans they show */
export const ROADMAP_PATHS: Record<DocsOwner, string> = {
  aekasha: 'project/aekasha/roadmap/',
  app: 'project/app/roadmap/',
};
const ROADMAP_SLOT = 'generated-roadmap';
const OWNERS: DocsOwner[] = ['aekasha', 'app'];

/** The plan rules, which the summary links */
const PLAN_RULES_FILE = path.join(PLANS_DIR, 'CLAUDE.md');
const APP_RULES_ANCHOR = 'the-apps-plans-and-issues';
const PLAN_WORKFLOW_LINK = 'hub:project/aekasha#from-a-plan-to-a-merge';

/** A plan of the other folder, in a link's text: `Ækasha’s p302` */
const OWNER_NAMES: Record<DocsOwner, string> = { aekasha: 'Ækasha’s', app: 'the app’s' };

/** Each state's badge: the issues' classes, plus `_progress` (`_sections.scss`) */
const STATE_BADGES: Record<PlanState, { kind: string; word: string }> = {
  open: { kind: 'open', word: 'Open' },
  'in progress': { kind: 'progress', word: 'In progress' },
  done: { kind: 'closed', word: 'Done' },
};

/** `Category`'s word for a kind of issue, not an area (D6) */
const NOT_AN_AREA = 'bug';
const OTHER_AREA = 'Other';

/** What the roadmaps read, Ækasha's folders first: the plans and the issues */
export type RoadmapSources = { plans?: PlanSource[]; issues?: IssueSource[] };

/** Titles and statuses are Markdown: inline code, no links or HTML */
const inlineMd = new MarkdownIt({ html: false });
const inline = (markdown: string) => inlineMd.renderInline(markdown);

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** One page's render: the model, whose page it is, and the row ids placed so far */
type RoadmapRender = {
  model: PlanModel;
  owner: DocsOwner;
  rowIds: Map<string, string>;
  md: MarkdownIt;
  env: HubMarkdownEnv;
  placed: Set<string>;
};

/**
 * Each plan's row id: its label (`p305`, `p056`), `app-p100` for the app's, or its file name's
 * slug when it has no number or shares it with another plan of its folder
 */
export const createRowIds = (model: PlanModel) => {
  const numbers = new Map<string, number>();
  const numberKey = (plan: Plan) => `${plan.owner}/${plan.number}`;
  for (const plan of model.plans)
    numbers.set(numberKey(plan), (numbers.get(numberKey(plan)) ?? 0) + 1);
  return new Map(
    model.plans.map((plan) => {
      const id =
        plan.number !== null && numbers.get(numberKey(plan)) === 1
          ? getPlanLabel(plan)
          : slugify(plan.name);
      return [plan.key, plan.owner === 'app' ? `app-${id}` : id];
    })
  );
};

/** ` id="p305"` on the plan's first row (or an epic's section) on the page, else nothing */
const placeRowId = (ctx: RoadmapRender, plan: Plan) => {
  const id = ctx.rowIds.get(plan.key)!;
  if (ctx.placed.has(id) || ctx.env.ids.has(id)) return '';
  ctx.placed.add(id);
  ctx.env.ids.add(id);
  return ` id="${escapeHtml(id)}"`;
};

/** A plan's row: `#p305` on this page, the other roadmap's for the other folder's (checked) */
const hrefOf = (ctx: RoadmapRender, plan: Plan, from: string) => {
  const id = ctx.rowIds.get(plan.key)!;
  if (plan.owner === ctx.owner) return `#${id}`;
  return resolveHubLink(`hub:${ROADMAP_PATHS[plan.owner]}#${id}`, ctx.env, from, 1);
};

/** A plan as a link's text: `p305`, or `Ækasha’s p302` for the other folder's */
const labelOf = (ctx: RoadmapRender, plan: Plan) =>
  plan.owner === ctx.owner
    ? getPlanLabel(plan)
    : `${OWNER_NAMES[plan.owner]} ${getPlanLabel(plan)}`;

/** A link to the plan's file (the editor in `dev`), at `line` */
const renderFileLink = (ctx: RoadmapRender, plan: Plan, html: string, line = 1) => {
  const hash = line > 1 ? `#L${line}` : '';
  const { href, isEditor } = resolveRepoLink(
    `repo:${toRepoPath(plan.file)}${hash}`,
    ctx.env,
    plan.file,
    1
  );
  const attrs = isEditor ? ' data-hub-open-in-editor' : ' rel="noopener"';
  return `<a href="${escapeHtml(href)}"${attrs}>${html}</a>`;
};

/** `p305 Terrain material generator`, linked to its file */
const renderPlanName = (ctx: RoadmapRender, plan: Plan) =>
  renderFileLink(
    ctx,
    plan,
    `<span class="hubRoadmapLabel">${escapeHtml(getPlanLabel(plan))}</span> ${inline(plan.title)}`
  );

const renderBadge = (state: PlanState) =>
  `<span class="hubStatus hubStatus_${STATE_BADGES[state].kind}">${STATE_BADGES[state].word}</span>`;

/** The badge and the status as written, without the badge's word when it starts with it */
const renderStatus = (plan: Plan) => {
  const word = STATE_BADGES[plan.state].word.toLowerCase();
  const status = plan.status.toLowerCase().startsWith(word)
    ? plan.status.slice(word.length).replace(/^\s*[|—]?\s*/, '')
    : plan.status;
  return `${renderBadge(plan.state)}${status ? ` <span class="hubRoadmapStatus">${inline(status)}</span>` : ''}`;
};

/** "Waits on" or "Unblocks": each plan linked to its row, soft and done ones marked in words */
const renderLinks = (ctx: RoadmapRender, from: Plan, links: PlanLink[]) => {
  if (!links.length) return '—';
  return links
    .map((link) => {
      const plan = ctx.model.byKey.get(link.plan)!;
      const notes = [link.isSoft ? 'soft' : '', plan.state === 'done' ? 'done' : ''].filter(
        Boolean
      );
      const title = link.note ? ` title="${escapeHtml(link.note)}"` : '';
      return `<a href="${escapeHtml(hrefOf(ctx, plan, from.file))}"${title}>${escapeHtml(labelOf(ctx, plan))}</a>${
        notes.length ? ` <span class="hubRoadmapNote">(${notes.join(', ')})</span>` : ''
      }`;
    })
    .join(', ');
};

const renderEpic = (ctx: RoadmapRender, plan: Plan) => {
  const { epic } = plan;
  if (!epic) return '—';
  if (epic.kind === 'url') {
    return `<a href="${escapeHtml(epic.url)}" rel="noopener">${escapeHtml(epic.url.replace(/^https?:\/\//, ''))}</a>`;
  }
  if (epic.kind === 'text') return inline(epic.text);
  const epicPlan = ctx.model.byKey.get(epic.plan)!;
  return `<a href="${escapeHtml(hrefOf(ctx, epicPlan, plan.file))}">${escapeHtml(labelOf(ctx, epicPlan))}</a>`;
};

/** A table of plans: each row's header cell its name, linked to its file, and the row its id */
const renderTable = (
  ctx: RoadmapRender,
  head: string[],
  plans: Plan[],
  cells: (plan: Plan) => string[]
) => `<div class="hubTable">
<table class="hubRoadmapTable">
<thead><tr>${head.map((label) => `<th scope="col">${label}</th>`).join('')}</tr></thead>
<tbody>
${plans
  .map(
    (plan) =>
      `<tr${placeRowId(ctx, plan)}><th scope="row">${renderPlanName(ctx, plan)}</th>${cells(plan)
        .map((cell) => `<td>${cell}</td>`)
        .join('')}</tr>`
  )
  .join('\n')}
</tbody>
</table>
</div>
`;

/** The open plans' table (D4): Plan, Status, Category, Waits on, Unblocks */
const renderPlanTable = (ctx: RoadmapRender, plans: Plan[]) =>
  renderTable(ctx, ['Plan', 'Status', 'Category', 'Waits on', 'Unblocks'], plans, (plan) => [
    renderStatus(plan),
    escapeHtml(plan.areas.join(', ')) || '—',
    renderLinks(ctx, plan, plan.blockers),
    renderLinks(ctx, plan, plan.unblocks),
  ]);

const heading = (ctx: RoadmapRender, markdown: string, file = PLAN_RULES_FILE) =>
  renderMarkdownText(ctx.md, `${markdown}\n`, file, ctx.env);

/** The counts, where the files are, and the plan rules (D4's summary) */
const renderSummary = (
  ctx: RoadmapRender,
  plans: Plan[],
  issues: Issue[],
  sources: Required<RoadmapSources>
) => {
  const folders = (list: { dir: string; owner: DocsOwner }[]) =>
    list
      .filter(({ owner }) => owner === ctx.owner)
      .map(({ dir }) => `\`${toRepoPath(dir)}/\``)
      .join(', ');
  const rules = `repo:${toRepoPath(PLAN_RULES_FILE)}${ctx.owner === 'app' ? `#${APP_RULES_ANCHOR}` : ''}`;
  const openIssues = issues.filter(({ status }) => status.kind !== 'closed').length;
  if (!plans.length) {
    return heading(
      ctx,
      `**No plans yet · ${count(openIssues, 'open issue')}.** The app's plans go in ${folders(sources.plans)} and its issues in ${folders(sources.issues)}. They're written as [Developing Ækasha](${PLAN_WORKFLOW_LINK}) explains, with [the app's differences](${rules}), and show here when the Hub builds.`
    );
  }
  const byState = (state: PlanState) => plans.filter((plan) => plan.state === state).length;
  return heading(
    ctx,
    `**${count(byState('open'), 'open plan')}, ${byState('in progress')} in progress, ${byState('done')} done · ${count(openIssues, 'open issue')}.** Read from ${folders(sources.plans)} and ${folders(sources.issues)} when the Hub builds; [the plan rules](${rules}) say how a plan's header lines are written.`
  );
};

/** Each plan in progress: its status, its phases done and its next phase, linked to its line */
const renderInProgress = (ctx: RoadmapRender, plans: Plan[]) => {
  const items = plans
    .filter(({ state }) => state === 'in progress')
    .map((plan) => {
      const done = plan.phases.filter(({ isDone }) => isDone).length;
      const next = plan.phases.find(({ isDone }) => !isDone);
      const parts = [
        renderStatus(plan),
        plan.phases.length ? `${done} of ${count(plan.phases.length, 'phase')} done` : '',
        next ? `next: ${renderFileLink(ctx, plan, inline(next.heading), next.line)}` : '',
      ];
      return `<li>${renderPlanName(ctx, plan)}<p class="hubRoadmapMeta">${parts.filter(Boolean).join(' · ')}</p></li>`;
    });
  if (!items.length) return '';
  return `${heading(ctx, '## In progress')}<ul class="hubRoadmapList">\n${items.join('\n')}\n</ul>\n`;
};

/** An open epic: its status, children done, the graph of its children and their table */
const renderEpicSection = (ctx: RoadmapRender, epic: Plan) => {
  const children = epic.children
    .map((key) => ctx.model.byKey.get(key)!)
    .filter(({ owner }) => owner === ctx.owner);
  const done = children.filter(({ state }) => state === 'done').length;
  const meta = [
    renderStatus(epic),
    `${done} of ${children.length} ${children.length === 1 ? 'child' : 'children'} done`,
    renderFileLink(ctx, epic, 'the epic’s file'),
  ];
  const graph = children.length
    ? renderPlanGraph(
        createPlanGraph(
          ctx.model,
          children.map(({ key }) => key),
          (plan) => hrefOf(ctx, plan, epic.file)
        ),
        ctx.rowIds.get(epic.key)!
      )
    : '';
  return `<div class="hubRoadmapEpic"${placeRowId(ctx, epic)}>
${heading(ctx, `### ${getPlanLabel(epic)} ${epic.title}`, epic.file)}<p class="hubRoadmapMeta">${meta.join(' · ')}</p>
${graph}${children.length ? renderPlanTable(ctx, children) : ''}</div>
`;
};

/**
 * The open plans outside an open epic of this folder: the graph of those with a dependency that
 * isn't done, then every one's row (the backlog among them)
 */
const renderOtherPlans = (ctx: RoadmapRender, plans: Plan[]) => {
  if (!plans.length) return '';
  const isOpen = (key: string) => ctx.model.byKey.get(key)!.state !== 'done';
  const members = plans.filter(
    ({ blockers, unblocks }) =>
      blockers.some(({ plan }) => isOpen(plan)) || unblocks.some(({ plan }) => isOpen(plan))
  );
  const graph = members.length
    ? renderPlanGraph(
        createPlanGraph(
          ctx.model,
          members.map(({ key }) => key),
          (plan) => hrefOf(ctx, plan, members[0].file)
        ),
        'other'
      )
    : '';
  return `${heading(ctx, '## Other plans')}${graph}${renderPlanTable(ctx, plans)}`;
};

/** The done plans, in a `<details>` closed by default: Plan, Category, Epic */
const renderDone = (ctx: RoadmapRender, plans: Plan[]) => {
  const done = plans.filter(({ state }) => state === 'done');
  if (!done.length) return '';
  const table = renderTable(ctx, ['Plan', 'Category', 'Epic'], done, (plan) => [
    escapeHtml(plan.areas.join(', ')) || '—',
    renderEpic(ctx, plan),
  ]);
  return `${heading(ctx, '## Done')}<details class="hubRoadmapDone">
<summary>The ${count(done.length, 'done plan')}</summary>
${table}</details>
`;
};

/** An issue's areas: its `Category` without `Bug` (a kind), or `Other` */
const getIssueAreas = (issue: Issue) => {
  const category = issue.meta.find(({ key }) => key.toLowerCase() === 'category')?.value ?? '';
  const areas = category
    .split(',')
    .map((area) => area.trim())
    .filter((area) => area && area.toLowerCase() !== NOT_AN_AREA);
  return areas.length ? areas : [OTHER_AREA];
};

/**
 * The open issues (everything `parseStatus` doesn't call closed) under a heading per area, an
 * issue under each of its areas, then the closed ones' count (D6)
 */
const renderIssues = (ctx: RoadmapRender, issues: Issue[]) => {
  if (!issues.length) return '';
  const open = issues.filter(({ status }) => status.kind !== 'closed');
  const areas = new Map<string, { name: string; issues: Issue[] }>();
  for (const issue of open) {
    for (const name of getIssueAreas(issue)) {
      const area = areas.get(name.toLowerCase()) ?? { name, issues: [] };
      area.issues.push(issue);
      areas.set(name.toLowerCase(), area);
    }
  }
  const sorted = [...areas.values()].sort(
    (a, b) =>
      Number(a.name === OTHER_AREA) - Number(b.name === OTHER_AREA) || a.name.localeCompare(b.name)
  );
  let html = heading(ctx, '## Issues by area');
  if (!open.length) html += '<p>No open issues.</p>\n';
  for (const area of sorted) {
    const items = area.issues
      .sort((a, b) => a.plainTitle.localeCompare(b.plainTitle))
      .map(
        (issue) =>
          `<li><a href="${escapeHtml(resolveHubLink(`hub:${issue.path}`, ctx.env, issue.file, 1))}">${inline(issue.title)}</a> <span class="hubStatus hubStatus_${issue.status.kind}">${escapeHtml(capitalize(issue.status.label))}</span></li>`
      );
    html += `${heading(ctx, `### ${area.name}`, area.issues[0].file)}<ul class="hubRoadmapList">\n${items.join('\n')}\n</ul>\n`;
  }
  const closed = issues.length - open.length;
  return (
    html +
    heading(
      ctx,
      `${closed ? `${count(closed, 'closed issue')} not listed: ` : ''}[the Issues section](hub:issues) has every issue with its page.`
    )
  );
};

/** One roadmap page's slot (this module's comment) */
const renderRoadmap = (ctx: RoadmapRender, issues: Issue[], sources: Required<RoadmapSources>) => {
  const plans = ctx.model.plans.filter(({ owner }) => owner === ctx.owner);
  const own = issues.filter(({ owner }) => owner === ctx.owner);
  const summary = renderSummary(ctx, plans, own, sources);
  if (!plans.length) return summary + renderIssues(ctx, own);

  const isOpenEpic = (key: string) => {
    const plan = ctx.model.byKey.get(key)!;
    return plan.owner === ctx.owner && plan.kind === 'epic' && plan.state !== 'done';
  };
  const epics = plans.filter(({ key }) => isOpenEpic(key));
  const others = plans.filter(
    (plan) =>
      plan.state !== 'done' &&
      !isOpenEpic(plan.key) &&
      !(plan.epic?.kind === 'plan' && isOpenEpic(plan.epic.plan))
  );
  return [
    summary,
    renderInProgress(ctx, plans),
    epics.length ? heading(ctx, '## Epics') : '',
    ...epics.map((epic) => renderEpicSection(ctx, epic)),
    renderOtherPlans(ctx, others),
    renderDone(ctx, plans),
    renderIssues(ctx, own),
  ].join('');
};

/**
 * Both folders' issues: the Issues section reports their warnings and errors, so they're read
 * here quietly, and a file whose page another took (a clashing slug) is left out, as there
 */
const readIssues = (sources: IssueSource[]) => {
  const quiet = new HubDiagnostics();
  const paths = new Set<string>();
  return sources.flatMap(({ dir, owner }) =>
    listIssueFiles(dir).flatMap((file) => {
      const issue = parseIssue(file, owner, quiet);
      if (paths.has(issue.path)) return [];
      paths.add(issue.path);
      return [issue];
    })
  );
};

/**
 * The two roadmap pages' sections, Ækasha's and the app's, from one read of both folders' plans
 * and issues per build (the plans' warnings go to `diag`). Each watches its own folders.
 */
export const createRoadmapSections = (
  diag: HubDiagnostics,
  { plans: planSources = PLAN_SOURCES, issues: issueSources = ISSUE_SOURCES }: RoadmapSources = {}
): HubGeneratedSection[] => {
  const model = readPlans(diag, planSources);
  const issues = readIssues(issueSources);
  const rowIds = createRowIds(model);
  const sources = { plans: planSources, issues: issueSources };
  return OWNERS.map((owner) => ({
    path: ROADMAP_PATHS[owner],
    slots: {
      [ROADMAP_SLOT]: (md, env) =>
        renderRoadmap({ model, owner, rowIds, md, env, placed: new Set() }, issues, sources),
    },
    pages: [],
    files: [
      ...model.plans.filter((plan) => plan.owner === owner).map(({ file }) => file),
      ...issues.filter((issue) => issue.owner === owner).map(({ file }) => file),
    ],
    dirs: [...planSources, ...issueSources]
      .filter((source) => source.owner === owner)
      .map(({ dir }) => dir),
  }));
};
