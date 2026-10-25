## From a plan to a merge

### Plans

Work that isn't a quick fix starts as a plan in `docs/plans/`. The file name is
`p<number>_<name>.md`, and a lower number means a higher priority. A plan is a spec for work
that hasn't started: it describes what to build, not how the code is today. Implement one only
when it's the task.

A plan opens with header lines: `Status` (required: `draft | not-implemented`,
`in progress | Phases 1-2 implemented`, `implemented`), and where they apply `Category`,
`Epic`, `Blocked by`, `Blocks` and `Related`. Below the header:

- **As found:** the code as the plan's author read it, with the commit. If the code has moved
  since, the plan says so before anything is built on it.
- **Decisions:** numbered (D1, D2, …), so later plans, commits and code comments can refer to
  them.
- **Phases:** each one leaves the tree working and is reviewed and committed on its own.
- **Risks** and **Done when.**

A large piece of work is an **epic**: a plan whose child plans continue its number (p800 → p801,
p802, …). Its "Branches and PRs" section says which child plans share a branch, what each branch
merges into, and when each PR opens. Each merge into `main` is one version bump, so several
children that share one major need an integration branch.

### Implementing a phase

- **Read the plan and the files it names first.** If the code has moved since the plan was
  written, say so instead of following the plan blindly.
- **One section at a time.** A phase is built in sections, and each one stops for review before
  the next starts. Nothing is committed without being asked.
- **"As built".** Where the code turns out different from the plan, the phase gets an "As built"
  list, so later phases don't build on stale assumptions.
- **Marking a phase done:** ` — done` on its heading, and the Status line counts it
  (`in progress | Phases 1-3 implemented`).
- **New session or continue?** At the end of a phase, decide whether the next one starts in a new
  session or continues in this one. Start a new session when the next phase works in other files,
  this session is already long, or the next phase won't start within the hour. Continue when it
  builds on what's already in context. For a new session, write everything decided into the plan
  first: the plan is the handoff, never the chat.
- **The Hub phase.** A plan's second-to-last phase usually updates the Hub and builds its
  examples, and the plan's author asks whether the work deserves an example scene.

### Finishing a plan

The last phase marks the plan done:

1. Set the Status line to `implemented` (with its phases: `implemented (Phases 1-4)`).
2. `git mv` the file to `_DONE_<same name>`, and update the references to it: other plans'
   `Blocked by` and `Blocks` lines and the `CLAUDE.md` files.
3. Update the root `CLAUDE.md`, the nested `CLAUDE.md` files and `readme.md` where the change
   alters what they describe.
4. Bump the versions, add the `CHANGELOG.md` entry, and run `yarn checkVersions --against main`.

Then it's time for the PR: the plan's branch (or the epic's, from its section) into `main` or
into its integration branch. It opens only when asked. A finished plan is kept while its epic
still needs it, and removed when the epic is done.

### Issues

A known problem that isn't being fixed now gets a file in `docs/issues/`, such as an upstream bug,
a workaround in use, or a deferred fix. Line 1 is `**Title:** …`. From line 3 comes a block of
`Key: value` lines: `Status:` first (`open`, `not filed yet`, `fixed`, …, with a detail after a
`|`), then `File at`, `Category`, `Found` and `Our workaround` where they apply. A blank line
follows, then the issue itself. The Hub's [Issues](hub:issues) section lists them by status. A
`TODO` in the code names its issue file or plan.

### Versions and the changelog

`package.json` holds four semver versions, each bumped on its own:

| Version                    | Covers                                                                           | A major's codename                           |
| -------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------- |
| `engine_metadata.version`  | `src/_engine/`                                                                   | The sun's path: Dawn → Sunrise → Morning → … |
| `toolkit_metadata.version` | `src/toolkit/`: additions are minor, fixes patch, a major only with the engine's | The moon's phases: Crescent → Half Moon → …  |
| `app_metadata.version`     | `src/app/` and `src/AppECSPlugins.ts`, `AppECSRegistry.ts`, `CONFIG.ts`          | Life stages: Toddler → Preschooler → …       |
| `version`                  | Always the engine's                                                              | The engine's                                 |

- **Once per merge into `main`**, in the PR rather than per commit, at the level of the biggest
  change on that side since the last merge. The lower parts reset to 0 (`1.4.2` → `1.5.0`), and
  a part with no changes keeps its version.
- **A `CHANGELOG.md` entry per PR**, with a section per part it bumped (Engine, Toolkit, App)
  and Project for the repo's tooling, which has no version. The [Version](hub:version) page
  shows it.
- **`yarn checkVersions --against main`** before opening the PR. After the merge,
  `yarn tagRelease` on `main` tags each part's version (`engine-v…`, `toolkit-v…`, `app-v…`) and
  prints the push command.
