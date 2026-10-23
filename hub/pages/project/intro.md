This section is for the people working on the repo: what Ækasha stands for, and how it is
developed. The dev server's Hub shows it; the public Hub doesn't build it, so nothing here is
published. The root [`CLAUDE.md`](repo:.claude/CLAUDE.md) and the plan rules in
[`docs/plans/CLAUDE.md`](repo:docs/plans/CLAUDE.md) are the source: this page explains them, and a
change to them is a reason to read it again.

## The brand

Ækasha is a high-performance WebGPU framework for the modern web. Driven by a modular ECS and a
threaded physics core, it acts as the "fifth element" for developers: the invisible medium where
complex data turns into immersive reality. The name is the Akasha of myth: the ether, the fifth
element, infinite and modular like the framework.

## Core principles

- **Primordial Performance.** Built from the ground up for WebGPU: the GPU is the primary canvas
  for logic and rendering, not a peripheral.
- **Modular Infinity.** You only bring into existence what you need: features opt in, and the
  "memory space" stays clean and light.
- **Threaded Reality.** Physics and asset loading run on their own threads, so the flow of the
  experience is never interrupted.
- **Smallest Build Possible.** Every byte before the first frame is a wait. A build carries only
  what the app uses, `yarn sbp` measures every build against its budgets, and a scene is light
  enough to embed in any page.

### User first

Every decision has two users, and both come first: the **developer** who builds with Ækasha (its
API, the debugger, the Hub, the error messages), and the **player or visitor** who uses what they
build (the frame rate, the load time, the UI). A change is judged by both: is it obvious, is it
fast, does it work with a keyboard, a screen reader, a gamepad, a small screen and an embed, and
does it make someone want to come back.

## How Ækasha is developed

### Plans

Work starts as a plan in `docs/plans/`: `p<number>_<name>.md`, where a lower number is a higher
priority. A plan is grounded in the code as it is (its "As found"), states its decisions, and
splits the work into phases that each leave the tree working. Large work is an **epic** whose
child plans continue its number (p800 → p801, p802, …), with one section for which branch each
child goes on and when its PR opens.

A phase is implemented in sections, each reviewed before the next starts; where the code turns out
different from the plan, the phase gets an "As built" list so later phases don't build on stale
assumptions. A finished plan is renamed `_DONE_<name>.md` and kept while its epic still needs it.
A plan is a spec for unstarted work: never a description of the current state.

### Issues

Known problems, upstream bugs and deferred fixes are files in `docs/issues/`, with a status, a
category and the workaround in use. The Hub's [Issues](hub:issues) section lists them.

### Versions

`package.json` holds four versions: the engine's (and the package's, always the same), the
toolkit's and the app's. Each part is bumped once per merge to `main`, by the size of its biggest
change, and a major gets a new codename: the sun's path for the engine, the moon's phases for the
toolkit, life stages for the app. Every PR adds a `CHANGELOG.md` entry, shown on the
[Version](hub:version) page, and `yarn checkVersions --against main` checks the bump.

### Checks

Hooks lint, type-check and test every change as it's made, and the docs ratchet keeps the
undocumented exports from growing. Before a merge: `yarn test`, the scene runner
(`yarn verify:scenes`) against its baselines, `yarn verify:baselines` for the bundle, API and docs,
and `yarn sbp` for the build's budgets. The [coding standards](hub:documentation/coding-standards)
are the rules the code follows.
