## Code conventions

The [coding standards](hub:documentation/coding-standards) are the rules every line of the engine,
the toolkit and the app follows: layering, the public API, naming, size, async and disposal,
per-frame code, the smallest build, the simulation, type hygiene, the dev tools and JSDoc. They're
public because an app built on Ækasha follows them too. What follows is only for this repo.

### The tools

- **Node from `.nvmrc`** (22.13.0). The shell's default Node can be older than `package.json`'s
  `engines`: yarn then refuses to run, and a check can fail or quietly do nothing. Every command
  that runs `yarn`, `npx`, `node` or `tsx` starts with `source .claude/hooks/use-node.sh &&`,
  and the hooks source it too. A check result from another Node version doesn't count.
- **Long runs go in the background**, with their output in a log under the gitignored `.cache/`:
  the verify commands write `.cache/verify/progress.log`, `yarn sbp` writes
  `.cache/sbp/progress.log`, and anything else goes to `.cache/runs/<name>.log`. `yarn test`
  takes about a second, so it runs in the foreground.

### The hooks

Two hooks run as you work, and the tree should pass both before you stop:

- **On every edit** of a `.ts` file (`.claude/hooks/tool-lint.sh`): ESLint with `--fix` on that
  file, which then lists the errors it couldn't fix.
- **On stop** (`.claude/hooks/verify.sh`), for what changed: lint (`--fix`, then fail on the
  errors left; warnings don't block) and `tsc` plus `tsc -p hub` when `src/`, `hub/`,
  `devTools/` or `vite.config.ts` changed; the unit tests when `src/`, `devTools/` or
  `vitest.config.ts` did; the docs ratchet when the engine or the toolkit did; the version
  check when `package.json` did.

::: warning The JSDoc fixers delete text
Because the hooks run `--fix`, `eslint-plugin-jsdoc`'s `empty-tags` and `no-types` fixers run on
every edit. Write an `@internal` reason in the summary, never after the tag, and give
`@returns` words first: `@returns {@link X}` reads as a type, and the fixer leaves `@returns`
empty.
:::

### Ratchets, baselines and budgets

Some checks compare the code with a committed record of how it was, so a regression has to be
deliberate:

| Check                                        | What it holds                                                                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `yarn test`                                  | The unit tests and the structural ones: no module reads a browser global at load, no module-level side effects, the folder layout, the entries' shape, the `@example` code compiles. |
| `yarn verify:baselines`                      | The bundle (a chunk whose gzip grew over 1 % or 2 kB, a new chunk), the public API (an export added, removed or moved), no debug code in the production build, and the docs ratchet. |
| The docs ratchet (`verify:baselines --docs`) | A folder's undocumented exports may not grow: it names each new one with its file and line.                                                                                          |
| `yarn verify:scenes`                         | Every scene in four configurations: errors, the determinism hash, a snapshot, the system order and the characters' paths against their baselines.                                    |
| `yarn sbp`                                   | Each build's first download and lazy chunks against the budgets in `sbp.config.ts`.                                                                                                  |
| `yarn verify:embed`                          | Each embed profile mounted into a plain page: its size, unmount, and no host style changed.                                                                                          |

`--update` (`yarn verify:baselines --update`, `yarn verify:scenes --update`) records the current
state. Commit it with the change that moved it, and say why in the PR. A refactoring records the
scene baselines on `main` before its branch's first run, so the run compares against the code
before it.

### The docs move with the code

A change updates what describes it, in the same branch:

- **The nested `CLAUDE.md`** of the subsystem it touches (the map in the root file's
  Architecture). A new nested file starts with a line naming what it covers, and its `##`
  sections need a Hub page's `aek:covers`.
- **The Hub**: an engine or toolkit feature or public API that's added, changed or removed
  updates its feature page, its example page and scene, and the snippets they include. Then run
  `yarn hub:build`, which fails on a dead `hub:` link or a moved `#region`.
- **`readme.md`**, the project's public face, when its lists change: a subsystem, an asset JSON
  type, a command or URL flag, a requirement, an API its examples use, or a Roadmap item that
  lands.

### The Hub

The Hub's pages are in `hub/pages/` and its generator is in `devTools/hub/`.
[`docs/techniques/hub-authoring.md`](repo:docs/techniques/hub-authoring.md) is the authoring
guide, and [`hub/CLAUDE.md`](repo:hub/CLAUDE.md) and
[`devTools/hub/CLAUDE.md`](repo:devTools/hub/CLAUDE.md) are the reference. Two rules catch people
out:

- **A `#region` marker in the code is part of a page.** Renaming, removing or moving one fails
  `yarn hub:build` with the page and line, so the marker's note names its page
  (`// #region dynamic-box (shown in the Hub: …)`).
- **Pages like this one are dev pages** (`aek:dev`): only the dev server's Hub has them. A public
  page can link one only inside a `::: dev-only` block.
