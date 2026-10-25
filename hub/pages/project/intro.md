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

- **Plans first.** Work starts as a plan in `docs/plans/`, grounded in the code as it is and
  split into phases that each leave the tree working. A phase is built in sections, and each one
  is reviewed before the next starts.
- **Checks hold the line.** Hooks lint, type-check and test every change as it's made, and
  committed baselines and budgets make a regression in the bundle, the API, the docs or a scene
  deliberate.
- **Versions per part.** The engine, the toolkit and the app each have a version, bumped once
  per merge into `main`, with a `CHANGELOG.md` entry per PR.

[Developing Ækasha](hub:project/aekasha) has the details: the repo's conventions and checks, the
plan and issue workflow, and the versioning rules.

## In this section

::: cards project
:::
