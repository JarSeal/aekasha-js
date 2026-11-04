Status: in progress | Phases 0-1 implemented
Category: Documentation, Hub, Tooling
Epic: p800_debugger-ui-overhaul.md
Related: \_DONE_p802_hub-project-section.md (the dev pages, the Project section and the generated sections that fill a dev page's slots, which the roadmap pages are; its Blocks line names this plan), \_DONE_p621_hub-docs-readme-and-claude-md-final.md (the readme's Roadmap, last checked against the open plans there), p990_follow-ups-from-done-plans.md (the backlog, listed on the roadmap as a plan)

# Project Roadmaps and the Docs Split

p800's ninth and last child. Two parts:

1. **The split.** `docs/` stays Ækasha's (plans, issues, techniques, analysis, templates). The
   app gets a folder of its own for its plans and issues, in the same file formats. An app made
   from the template then keeps its own plans and issues without mixing them with the engine's,
   and gets the engine's updates without merge conflicts in its own files.
2. **The roadmaps.** Two dev-only pages in the Project section, one for Ækasha and one for the
   app. Both are generated from the plans' header lines as tables and dependency graphs, with
   open and done plans and the open issues per area. The Hub's Issues section reads both issue
   folders, and `readme.md`'s Roadmap points at the roadmap page.

Nothing in the engine, the toolkit or the app's code changes. The work is the Hub's generator,
the docs and one new folder.

**Out of scope:**

- A Hub page per plan. Generated pages are public (`pages.ts` makes one under a dev page an
  error), and a plan is a working file, not something to publish. The roadmap links each plan to
  its file (`repo:`, which opens in the editor on the dev server's Hub).
- `docs/templates/todo-plan-prompts.txt`'s unwritten prompts (p450, p770, …). They are free text
  with no header lines. A prompt shows on the roadmap once it's a plan.
- A client-side filter on the roadmap (status, category). The pages are static. A filter can come
  later as a Hub TS entry if the tables get too long.
- Trello epics (`p250`, `p500`): the URL is shown as a link and nothing is fetched.

---

## 1. As found (2026-11-04, `main` at `86543f07`, Engine 5.14.0 with the unreleased 6.0.0 work, Toolkit 2.2.1, App 1.18.0)

### 1.1 p800's p809 sketch, checked

- "`docs/` stays Ækasha's (plans, issues, techniques, analysis, templates)": these are its five
  folders today, plus `docs/plans/CLAUDE.md`. The only tools that read `docs/` are the Hub's
  Issues section (`devTools/hub/paths.ts`' `ISSUES_DIR`, `generated/issues.ts`), `outDir.ts`'
  `SOURCE_DIRS` (the folders `yarn hub:build --out` refuses), `devTools/codecat.sh`'s default
  excludes and the dev plugin's watcher (`hubPlugin.ts`). A few code comments cite a plan or an
  issue file by path (`vitest.config.ts`, `vite.config.ts`, `tsconfig.json`). The layout check
  covers `src/` only (`layoutRules.ts`), so a new root folder needs no rule.
- "`docsApp/` gets the app's plans and issues": nothing is app-only today. Every open plan is
  the engine's or the toolkit's. The one with `App` in its `Category`, p310 (terrain preview
  scenes), is p301's last child: its scenes are app scenes, but its work is the epic's handbook
  pass, so it stays with the epic. Every issue is the engine's, the Hub's or a library's. **So
  the app's folder starts empty and nothing moves.**
- "Generated from the plans' header lines (`Status`, `Category`, `Blocks` / `Blocked by`,
  `Epic`)": checked against all 93 plan files (50 `_DONE_`):
  - `Status` is on line 1 of every file and is free text. Its first word or words (before `|`,
    `—` or `(`): `implemented` 50, `draft` 24, `stub` 15, `research done` 2, `in progress` 1
    (p299), `backlog` 1 (p990). The `_DONE_` prefix and an `implemented` status agree in every
    file. The text after the first word or words varies: `draft | epic — not-implemented`,
    `draft | spike-gated, not-implemented`, `draft | not-implemented | needs-replanning`,
    `in progress | Phases 0-4 implemented`, `implemented (Phases 0-9)`, `implemented (Stages A-D)`.
  - `Blocks`, `Blocked by` and `Epic` name plans by file name, a `_DONE_` one with an escaped
    underscore (`\_DONE_p801_….md`, Prettier's escape). Most entries carry a parenthetical
    (`(soft: only Phase 5's JSON binding)`, `(Tier 1.2)`, `(p800 §5; written when each starts)`),
    sometimes with commas inside. `soft` marks a blocker that isn't a hard one (p299, p304, p305,
    p420, p421, p424). `Epic` is a plan file (p301, p350, p370, p800, p600) or a Trello URL (p250,
    p500).
  - Epics list their children on their `Blocks` line (p301, p350, p370, p600, p800), and each
    child names the epic on its `Epic` line. So an epic's `Blocks` entry for its own child means
    membership, not a dependency.
  - Every plan file name in the four header lines (`Related` too) names an existing file and
    agrees with its `_DONE_` state. The only exceptions are the two lines naming this plan
    before it existed (p800's and p802's `Blocks`). `Related` also cites plans whose files were
    removed, as plain text (`p101 scene-load determinism`, `p026 (impulse joints …)`), never as a
    file name.
  - The title is the first `# ` heading, often with a kind suffix (`— Plan`, `— Stub`,
    `— Epic`, `— Research & Epic`, `— Backlog`).
  - Phases are `### Phase <n>: …` headings, with ` — done` appended when done. p600 uses Stages,
    and stubs have no phases.
- "The issues per area": 28 issue files. `Category:` is on all but one
  (`three-bind-group-cache-light-leak.md`, which also has no `Status:` line). It lists one to
  three areas, sometimes with `Bug` first (`Bug, ECS`). 20 are open or `not filed yet`, 7 fixed,
  1 `won't fix`.
- "The Hub's Issues section reads both folders": `createIssuesSection` reads `ISSUES_DIR` only.
  Each issue gets a page at `issues/<slug>/` (out of the nav), and the section's page lists them
  with a `##` per status. Two files whose names slug alike are an error, and the second gets no
  page.
- "`readme.md`'s Roadmap points at the page": the Roadmap (`readme.md` line 456) points at
  `docs/plans/` and lists three hand-picked highlights. Its Documentation list points at
  `docs/plans/` too ("Design docs"). The roadmap page is dev only, so GitHub readers can't follow
  a link to it: the readme names it as a dev server URL instead.
- "The plan rules gain the app's folder": `docs/plans/CLAUDE.md` has one `##` section ("Plans
  logic and structure"), which `project/aekasha/`'s `aek:covers` covers.

### 1.2 The Hub this builds on

- **Dev pages** (p802): `aek:dev` on `project/` makes the whole section dev only. `public` drops
  the pages after the coverage check. A generated section's own `pages` can't be under a dev
  page, but its `slots` can fill one: the design and component sections do exactly that
  (`project/aekasha/design/`, `project/aekasha/components/`), run after the API section in
  `build.ts`.
- **The Project pages**: `project/` (philosophy), `project/aekasha/` (conventions and workflow
  slots, its children `code-blocks/`, `components/`, `design/`, listed by
  `::: cards project/aekasha`), `project/app/` (intro and conventions, its child `design/`). The
  homepage's dev-only `PROJECT_LINKS` (`generated/home.ts`) lists seven links.
  `project/aekasha/workflow.md` explains plans and issues.
- **Status badges**: `.hubStatus` with `_open`, `_closed` and `_other` (`_sections.scss`), used by
  the issue pages and the list.
- **No diagrams.** The Hub has no diagram directive, and the UI kit's graphs (p805: sparkline,
  donut, stacked bar, chart, time series) have no node graph.
- **The watcher**: `docs/issues/` goes through Vite's watcher (a section's `dirs` and `files`).
  Every run rebuilds the whole Hub and `diffBuilds` reloads only the changed pages.
- **The search index** is over its 450 KiB warning mark (485 KiB, p808). Dev pages are only in the
  dev server's index.
- **No `issues.test.ts`**: the issues generator is covered only through `links.test.ts`.

---

## 2. Decisions (proposed 2026-11-04, for review)

### D1. The app's folder is `docsApp/`

`docsApp/` at the repo root, next to `docs/`, holding `plans/` and `issues/` (p800 §8 left the
name to this plan). The reasons:

- **It sits next to `docs/` and says whose it is.** It's camelCase like `devTools/`. An app made
  from the template replaces `src/app/` and `docsApp/` and keeps `docs/` as upstream ships it.
- **Not `docs-app/`**: that's one letter from the gitignored `docs-api/` (`yarn docs`' output),
  in a root that already has `dist-hub/`, `dist-embed/` and `dist-stats/`.
- **Not `docs/app/`**: `docs/` would then hold the app's files, and an upstream change to `docs/`
  would land in the same tree as the app's own.
- **Not `src/app/docs/`**: Markdown would sit in the code tree, under Vite's root, the gatherer's
  walk and the layout rules.

Its files: `docsApp/CLAUDE.md` (one paragraph: what the folder is and where the rules live, D2),
and `.gitkeep` in `plans/` and `issues/`, so an empty template shows where its files go. The tools
read `.md` files only, and a missing folder counts as an empty one (as `ISSUES_DIR` already
does).

### D2. The same formats, separate numbers, and one-way references

- **Formats**: an app plan follows `docs/plans/CLAUDE.md` (name, header lines, phases, marking
  done, `_DONE_`), and an app issue follows `hub/CLAUDE.md`'s issue-file convention. The rules
  stay in one place: `docs/plans/CLAUDE.md` gets a `## The app's plans and issues` section saying
  what differs. `docsApp/CLAUDE.md` points there. It has no `##` section of its own, so it needs
  no `aek:covers`.
- **Numbers**: the app's plans have their own number space (an app `p100` and an engine `p100`
  can both exist). The number is the priority within its folder.
- **References**: a header line names a plan in its own folder by file name, as today. A plan in
  the other folder is named by its repo path (`docs/plans/p302_material-and-texture-system-refactor.md`).
- **Layering, as in the code**: an app plan can wait on an engine plan. An engine plan never
  names an app plan in `Blocks`, `Blocked by` or `Epic`. The template's engine files then never
  change because of a fork's app plans, and an app's dependency on an engine plan is written on
  the app plan only (its `Blocked by`). The roadmap warns on an engine plan naming an app plan
  (D3).
- **What goes where**: a change to `src/app/` or the app-level `src/*.ts` files is the app's. A
  change to the engine or the toolkit is Ækasha's, even when an app scene shows it (p310). An
  issue goes with the code it's in.

### D3. The plan model: what's read, and the warnings

One parser, `devTools/hub/generated/plans.ts`'s `readPlans(dir, owner, diag)` (owner `'aekasha'`
or `'app'`), reads every `*.md` but `CLAUDE.md` and returns a plain model.

| Field      | From                                                                    | Notes                                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `number`   | The file name's `p<digits>`                                             | Sorts the tables. A file name without one warns and sorts last                                                                                                |
| `isDone`   | The `_DONE_` prefix                                                     | The file name is the rule (`docs/plans/CLAUDE.md`)                                                                                                            |
| `state`    | `Status`                                                                | `done` (`isDone`), `in progress` (starts with it), else `open`                                                                                                |
| `kind`     | `Status`'s words                                                        | `epic` (its own `Blocks` children, or "epic" in the status), `stub`, `research` (`research` or `study`), `backlog`, else `plan`                               |
| `status`   | `Status`, as written                                                    | Shown next to the badge                                                                                                                                       |
| `title`    | The first `# ` heading                                                  | The kind suffix after the last `—` removed (`— Plan`, `— Stub`, `— Epic`, `— Research & Epic`, `— Backlog`)                                                   |
| `areas`    | `Category`, split on `,`                                                | Shown as text, not grouped (plan categories are too varied to group by)                                                                                       |
| `epic`     | `Epic`                                                                  | A plan reference, or a URL (shown as a link)                                                                                                                  |
| `blockers` | `Blocked by`, plus the plans whose `Blocks` names this one              | Each `{ plan, isSoft }`: soft when its parenthetical starts with `soft`. An epic's `Blocks` entry for a plan whose `Epic` names it is membership, not an edge |
| `phases`   | `#{2,4} Phase <n>` and `Stage <x>` headings, and those ending ` — done` | For "Phases 3 of 7". None for a stub                                                                                                                          |

A reference is a plan file name, `\_DONE_` unescaped, optionally behind a repo path
(`docs/plans/…`, `docsApp/plans/…`). It's found with one regex over the line, and its
parenthetical is the text up to the next reference. Plain-text mentions (`p101 scene-load
determinism`) aren't references and are ignored.

**Warnings** (`yarn hub:build` and the dev Hub, at the file and line; none are errors, so a plan
being written never stops the Hub):

- A header reference to a file that doesn't exist: renamed, removed or marked done without its
  references updated (`docs/plans/CLAUDE.md`'s "Mark the plan done"). It names the `_DONE_` or
  non-`_DONE_` file when that one exists.
- A `_DONE_` file whose `Status` doesn't start with `implemented`, or the reverse.
- No `Status` line on line 1.
- An engine plan referring to an app plan (D2).
- A `Blocks` / `Blocked by` cycle (named in full). The edge that closes it is left out of the
  graph.

`Related` is checked for missing files (the first warning) but isn't otherwise read: it's too
long and too loose to draw.

As found (§1.1), the plans give no warnings once this file exists.

### D4. The roadmap pages

Two dev pages, `project/aekasha/roadmap/` ("Roadmap", `aek:order` after the design document)
and `project/app/roadmap/`. Each is a hand-written `index.html` with an `intro` slot and a
`generated-roadmap` slot that a generated section fills (`generated/roadmap.ts`'s
`createRoadmapSection`, run after the design and component sections in `build.ts`, with
`readPlans` and the issues' parser as its sources). The page, top to bottom:

1. **Summary**: one line of counts ("43 open plans, 1 in progress, 50 done · 20 open issues"),
   and the folder's path as a `repo:` link.
2. **In progress**: each plan with its status and phase count, and its next phase's heading
   (the first one not ` — done`).
3. **Epics**: an `###` per open epic, ordered by number. Each has its status, "n of m children
   done", the dependency graph of its children (D5) and the table of its children.
4. **Other plans**: one graph of the open plans outside epics that have dependencies (today
   p420 with p421 and p424, and p512 with p428, p500, p510 and p511), then one table of every
   open plan outside an epic, the backlog (p990) among them.
5. **Done**: a `<details>` with the done plans' table (number, title, category, epic), closed by
   default.
6. **Issues by area** (D6).

**The table** (one shape everywhere): Plan (`p305` and the title, linked to the file), Status
(the badge and `status`), Category, Waits on and Unblocks (links to those plans' rows, soft ones
marked "soft"). Each row has an id (`#p305`, `#app-p100` for the app's), so a graph node or a
"Waits on" link jumps to the row and the row links to the file. A reference into the other folder
links to that roadmap's row.

**Badges**: `.hubStatus_open`, `_closed` (done) and a new `_progress`, on the Hub's tokens. A
badge always has its word, so colour is never the only sign (p800 D8).

**The app's page** on the template, with no plans: the summary says so and gives the folder and
the plan rules (`hub:project/aekasha#from-a-plan-to-a-merge`). Its other sections are left out.

The homepage's `PROJECT_LINKS` gains both: "The app's roadmap" after "The app", and "Ækasha's
roadmap" after "Developing Ækasha". `::: cards project/aekasha` lists the new page by itself, and
`project/app/`'s intro links its own.

### D5. The dependency graph: an SVG at build time

A small layered layout in `devTools/hub/generated/planGraph.ts`, written for these graphs (the
largest, p301's, has 10 nodes). No new dependency, and nothing runs in the page.

- **Layout**: top to bottom, blockers above. Longest-path layering from the plans that wait on
  nothing. A long edge gets a point per layer it crosses, so it routes between nodes. Nodes in a
  layer are ordered by two barycenter sweeps, ties broken by number. A node is a fixed box
  (number on the first line, the title clipped to two lines), with the layer and node gaps from
  the Hub's space tokens.
- **What it shows**: an epic's graph has its children (done ones muted, with a check mark and
  "done") and its open blockers from outside the epic, drawn as dashed boxes labelled with their
  epic. Done outside blockers block nothing and are left out. Soft edges are dashed, hard ones
  solid with an arrowhead.
- **Markup**: `<figure>` with a caption ("Blockers above; the table lists the same
  dependencies"), and inside a scroll container (`overflow-x: auto`, so a wide graph scrolls in
  its box and the page doesn't at phone width) an `<svg>` with a `viewBox`. Each node is an
  `<a href="#p305">` with a `<title>`, so it's reachable by keyboard with the focus ring. Colours
  are classes (`.hubPlanNode_open`, `_progress`, `_done`, `_outside`) on the Hub's tokens, so
  both themes work. The table is the text equivalent: the SVG is `aria-hidden` and its links are
  `tabindex="-1"`. Reaching the same row twice by Tab, once in the graph and once in the table,
  would be noise.
- **Escaping**: every title and id goes through `html.ts`' `escapeHtml`.

### D6. Issues by area

The roadmap's last section lists the folder's open issues (open and `not filed yet`, everything
not closed by `parseStatus`) with an `###` per area. An issue is listed under each area its
`Category` names, except `Bug`, which is a kind and not an area. One with no `Category` goes
under "Other". Each item links its Issues page (`hub:issues/<slug>`, public pages, so the link
works) with its status badge. A last line counts the closed ones and links the Issues section.

The issues' parser (`parseIssue`, `parseStatus`) is exported from `generated/issues.ts` for this,
not copied.

### D7. The Issues section reads both folders

- `createIssuesSection` reads `docs/issues/` and `docsApp/issues/`.
- **URLs stay flat**: `issues/<slug>/` for both, so moving an issue between the folders keeps its
  URL. Two files whose names slug alike, in either folder or across them, are the existing error.
- **The list**: when the app has issues, the page gets `## Ækasha` and `## The app`, with the
  statuses one level down (`###`). When it has none (the template), the page is as today. The
  app's issue pages get an "Of: The app" line in their meta list and the search tag `app`.
- **Public**: the app's issues are in the public Hub like the engine's, because a generated
  section's pages are public (`pages.ts`). A fork that publishes its Hub publishes its app's
  issues. The page's intro and `aek:description` say the section holds both, and
  `project/app/`'s intro says it. A switch to keep them dev only would need dev generated pages,
  which `pages.ts` refuses on purpose: left out until a fork asks.
- Its `dirs` (the watcher) gain `docsApp/issues/`.

### D8. Paths, watching and cost

- `devTools/paths.ts` gets `DOCS_DIR` and `DOCS_APP_DIR`, and `devTools/hub/paths.ts` builds
  `ISSUES_DIR`, `APP_ISSUES_DIR`, `PLANS_DIR` and `APP_PLANS_DIR` on them. `outDir.ts`'
  `SOURCE_DIRS` and `codecat.sh`'s excludes gain `docsApp`.
- The roadmap section's `files` are the plan and issue files, and its `dirs` are the four
  folders. A plan save rebuilds the Hub like an issue save does, and only the two roadmap pages
  reload (`diffBuilds`).
- Cost: the parse reads the first lines and the headings of about 100 files (under 50 ms,
  measured in Phase 4). The public `dist-hub/` is unchanged apart from the Issues section's text
  (the dev pages are removed), so the public search index doesn't grow. The dev index gains the
  two pages' sections.

### D9. The docs

- `docs/plans/CLAUDE.md`: the `## The app's plans and issues` section (D2), and the
  "Mark the plan done" step's references also mean the other folder's plans that name it.
  `project/app/`'s `aek:covers` takes the new section.
- The root `.claude/CLAUDE.md`: the Workflow line ("`docs/plans/` holds specs for unstarted
  work…") names `docsApp/plans/` too. The Ækasha Hub section's Project sentence adds the
  roadmaps. The Architecture map gets `docsApp/CLAUDE.md`'s line.
- `hub/CLAUDE.md`: the issue-file bullet names both folders and D7's flat URLs. The Project
  section bullet names the roadmap pages and their slot. `devTools/hub/CLAUDE.md`: the
  Generated sections bullet gets Roadmap (its sources, warnings and graph) and the Issues
  section's second folder.
- The Hub: `project/aekasha/workflow.md`'s Plans and Issues name both folders and link the
  roadmaps. `project/app/`'s intro gets "The app's plans and issues" (D2's rules for the app, its
  roadmap). The Issues section's intro and description name both folders (D7).
- `readme.md`: the Roadmap names both folders and the roadmap page as a dev server URL
  (`yarn dev`, then `/hub/project/aekasha/roadmap/`). Its highlights are checked against the
  open plans as p621 did. The Documentation list's "Design docs" names `docsApp/plans/`.

### D10. Branch and versions

- Branch `p809-project-roadmaps` from `main` (`86543f07`), merging into `main` (p800 §6).
- **No bump**: the Hub's generator, the docs and a new docs folder are the Project's, which has
  no version. The engine, toolkit and app versions stay. `yarn checkVersions --against main`
  still runs.
- **The changelog**: an entry of its own with a Project section, dated at the merge, right under
  "Unreleased — engine-6". p807 and p808 joined that entry because they changed the engine that
  ships in 6.0.0. This plan doesn't, so it doesn't wait for the major.

### D11. No example scene

Nothing here runs in a scene, so there's no example scene or `verify:scenes` baseline (the
question `docs/plans/CLAUDE.md` asks a plan's author). The checks are the unit tests and
`yarn hub:build` in both modes.

---

## 3. Phases

Each phase is verified with `yarn test`, `yarn lint` and `tsc` / `tsc -p hub` (the Stop hook),
plus `yarn hub:build` (public) and the dev server's Hub from Phase 2 on. Nothing changes the
app's build, so `yarn verify:scenes`, `yarn verify:baselines` and `yarn sbp` aren't needed. One
`yarn verify:baselines` run in Phase 6 confirms that.

### Phase 0: grounding — done

1. §1 checked against `main` (done when this plan was written: §1). Recheck it if `main` has
   moved.
2. The before figures: `yarn hub:build`'s time, the public search index size and the dev Hub's
   page count, in this plan.
3. p800's Blocks line already names this plan. This plan's status becomes `in progress`.

As built:

- The branch `p809-project-roadmaps` is cut from `main` at `e2ec58e5` ("Create p809 plan"). Since
  `86543f07` it has gained only this file, so §1 holds as written.
- The before figures (macOS, Node 22.13.0, the API model reused):
  - `yarn hub:build` (public): 103 pages in 6156 ms (7.5 s for the whole command). The search
    index is 485 KiB gzipped (1.73 MiB raw), with 624 page sections and 1766 API docs, and it
    warns over 450 KiB as before.
  - The dev Hub (`buildHub({ mode: 'dev', isEmbedLive: false })` into a scratch folder): 110
    pages in 6435 ms, 7 of them under `project/`.

### Phase 1: the app's folder — done

1. `docsApp/CLAUDE.md` and `docsApp/plans/.gitkeep`, `docsApp/issues/.gitkeep` (D1).
2. `DOCS_DIR`, `DOCS_APP_DIR` in `devTools/paths.ts`. `ISSUES_DIR` rebuilt on them, and
   `APP_ISSUES_DIR`, `PLANS_DIR`, `APP_PLANS_DIR` in `devTools/hub/paths.ts` (D8). `outDir.ts`'
   `SOURCE_DIRS` (its test: `--out docsApp` refused) and `codecat.sh`.
3. `docs/plans/CLAUDE.md`'s new section (D2), and `project/app/`'s `aek:covers` for it.
4. The root `CLAUDE.md`'s map line for `docsApp/CLAUDE.md` and its Workflow line (D9).

As built:

- `docsApp/CLAUDE.md` is one paragraph with no `##` section, so the coverage check has nothing of
  its own to cover.
- `docs/plans/CLAUDE.md`: besides the new section, its first line and its "Agentic coding plans
  are located in…" bullet name `docsApp/plans/`. The new section also has a **Versions** bullet
  (an app plan bumps `app_metadata.version`, with App changelog sections), which D2 didn't list.
- The Hub `CLAUDE.md` files are updated with the code rather than in Phase 6:
  `devTools/hub/CLAUDE.md`'s `--out` refusals name `docsApp/`, and `hub/CLAUDE.md`'s Project
  section bullet names `project/app/`'s new `aek:covers`.
- The three new paths (`APP_ISSUES_DIR`, `PLANS_DIR`, `APP_PLANS_DIR`) have no users until
  Phases 2-5.

### Phase 2: the Issues section reads both folders

1. `createIssuesSection` over both folders. Each issue carries its owner. The cross-folder
   slug collision is the existing error. The `## Ækasha` / `## The app` list appears only when
   the app has issues, the "Of: The app" meta line and the `app` tag are added, and `dirs` gains
   the second folder (D7).
2. `parseIssue` and `parseStatus` exported (D6).
3. `devTools/hub/issues.test.ts` (new): the header parse (title, status kinds, meta, summary),
   the two folders, the collision, the app-less page unchanged. Fixtures written to a temp
   folder.
4. The Issues page's intro and `aek:description` (D7).

### Phase 3: the plan model

1. `generated/plans.ts`' `readPlans` (D3): the fields, the references (a regex, an escaped
   `\_DONE_`, repo paths, parentheticals, `soft`), the epic membership rule, the phases and the
   warnings.
2. `plans.test.ts`: every status form in §1.1, the title suffixes, a `Blocks` line with commas
   inside its parentheticals, a soft blocker, an epic's children, a cross-folder reference, each
   warning, and a cycle.
3. A run over the real folders: no warnings (§1.1), its time noted (D8).

### Phase 4: the dependency graph

1. `generated/planGraph.ts` (D5): the layering, the points on long edges, the ordering, the
   cycle's dropped edge, and the SVG markup with its classes, links and escaping.
2. `planGraph.test.ts`: the layers and order of a fixed graph, a long edge's points, the
   outside nodes, done children muted, the `viewBox`, an escaped title.
3. The node and edge styles in a new `hub/_assets/scss/_roadmap.scss` on the Hub's tokens, in
   both themes, with `.hubStatus_progress` in `_sections.scss`.

### Phase 5: the roadmap pages

1. `project/aekasha/roadmap/` and `project/app/roadmap/` (`index.html` with `aek:order`, tags,
   description; `intro.md`).
2. `generated/roadmap.ts`' `createRoadmapSection` (D4): the sections, the table, the row ids,
   the links between the roadmaps, the issues by area (D6) and the app's empty page. Registered
   in `build.ts` after the component section, with its `files` and `dirs` (D8).
3. `PROJECT_LINKS`' two links (D4).
4. `roadmap.test.ts`: the sections from a fixture folder, the empty app page, the row ids and
   the cross-roadmap links.
5. Checked on the dev server's Hub, light and dark, at desktop and phone widths: the graphs
   scroll in their box, the nodes and links work by keyboard, a plan save reloads only the
   roadmap pages. A `yarn hub:build` check that the public output has no `project/` page.

### Phase 6: the docs

D9's list: `hub/CLAUDE.md`, `devTools/hub/CLAUDE.md`, the root `CLAUDE.md`'s Ækasha Hub
sentence, `project/aekasha/workflow.md`, `project/app/`'s intro, `readme.md`'s Roadmap and
Documentation. `yarn hub:build` (dead links, coverage) and one `yarn verify:baselines` (the
app's build unchanged).

### Phase 7: done (this plan, and p800's epic)

1. This plan's status `implemented (Phases 0-7)` and `git mv` to `_DONE_p809_…`. The references
   to the old name updated: p800's and `_DONE_p802`'s `Blocks` lines and p800's §5 entry.
2. **The epic is done with it**: p800's status becomes `implemented (p801-p809)`, its §5 p809
   entry becomes "Done" like the others, and the file is `git mv`'d to
   `_DONE_p800_debugger-ui-overhaul.md`. The 15 files outside `CHANGELOG.md` that name its file
   are updated: its nine children (`_DONE_p801` to `_DONE_p808` and this plan), `_DONE_p600`,
   `_DONE_p618`, p150, p355, p373 and p622. Past changelog entries keep the name they had. Whether the children's `_DONE_` files are
   then removed ("when the whole epic is done those plans are removed") is the user's decision,
   asked here and not assumed: p622 and p150, p355, p373 still build on what they record.
3. The roadmap built once more: p800 under Done, no warnings.
4. The `CHANGELOG.md` entry (D10) and `yarn checkVersions --against main`.
5. Time for the PR: `p809-project-roadmaps` into `main`.

---

## 4. Risks

- **The header lines are free text.** A new phrasing (a status word, a reference written
  another way) can be misread. Mitigation: the parser keeps the status as written next to its
  badge, unknown kinds fall back to `plan`, and the warnings name the file and line, so a
  misread shows on the page.
- **The graph's layout** gets crowded if an epic grows past 15 children or has many crossing
  edges. Mitigation: the scroll container, and the table, which is the full equivalent. A
  library (`dagre`, `elkjs`) is the step after, as a devTools-only dependency.
- **Rebuilds on plan saves.** Plans are saved often while a phase is marked done. Each save
  rebuilds the Hub (as an issue save does), and only the roadmap pages reload. If the rebuild
  gets in the way, the roadmap's `files` could leave out the plan bodies (only the header lines
  matter), but a watcher can't watch a file's first lines alone.
- **The app's issues are public** in a fork's published Hub (D7). The intro and the app page
  say so.

## Done when

- `docsApp/` exists with its `CLAUDE.md`, and the plan rules, the root `CLAUDE.md`, the Hub's
  `CLAUDE.md` files, the Project pages and `readme.md` describe both folders.
- The dev server's Hub has both roadmap pages, generated from the plans with the graphs, the
  tables and the issues by area, and works by keyboard and at phone width in both themes. The
  plans give no warnings.
- The Issues section reads both folders, and the public Hub is otherwise unchanged.
- p800 and this plan are `_DONE_`, with their references updated.
