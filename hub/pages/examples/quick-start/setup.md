## Requirements

- Node.js 22.13.0, the version in the repo's `.nvmrc`. With [nvm](https://github.com/nvm-sh/nvm),
  `nvm use` in the repo picks it (`nvm install` first if you don't have it).
- Yarn 1 (`>= 1.22.15`).
- A browser with WebGPU: a recent Chrome, Edge or Safari, or Firefox with WebGPU enabled. Other
  browsers fall back to WebGL 2.

## Install and run

```bash
git clone https://github.com/JarSeal/aekasha-js.git my-game
cd my-game
nvm use
yarn
yarn dev
```

The dev server runs at `http://localhost:8080`. Open `http://localhost:8080/?isDebug=true` for
the full debug tooling, then press `h` to open the debug drawer.

::: tip On a phone
A phone on your network needs a secure context for WebGPU and `SharedArrayBuffer`, which a plain
`http://` address isn't. `yarn dev:https` serves the app over HTTPS on port 8443 with a
self-signed certificate: open `https://<your computer's address>:8443/?isDebug=true` on the phone
and accept the certificate.
:::

## How the app starts

`src/index.ts` is the app's entry. It hands the engine everything it needs in one call,
[`InitEngine`](api:InitEngine):

<<< src/index.ts collapse

- `config` is your configuration (`src/CONFIG.ts`): physics, debug keys, the debug camera and
  more. A key you leave out keeps its default, set by the part of the engine that reads it (see
  [`AppConfig`](api:AppConfig)).
- `data` is your scenes and assets, gathered from their JSON files into `src/generated/`. The
  gatherer writes it before `yarn dev` and `yarn build` and on every save, so you never edit it.
- `features` lists what the engine installs besides its kernel (the ECS, meshes, cameras, lights,
  input and scenes), in this order: each engine feature from its entry (`physics()` from
  `aekasha/physics`, …), then `appECSPlugins`, the app's own feature, which registers your systems
  and the toolkit's (see the [ECS example](hub:examples/ecs#4-registering-it)). The template lists
  all nine engine features.
- `start` runs once the engine is ready: it creates the renderer and the scene loader and loads
  the first scene. In the debug env it also gives the example scenes their Hub tab, from a
  `_dbg__` module it `import()`s behind `IS_DEBUG_ENV`, so a production build leaves it out (see
  the [debug tab example](hub:examples/debug-tab)). An app without the example scenes drops those
  lines.
- Everything comes from the engine's public entries: `aekasha`, `aekasha/ui`, and for a feature
  its own (`aekasha/physics`, `aekasha/skybox`, …). A path into `src/_engine/` is a lint error
  outside the engine.

A feature you don't list isn't installed, and isn't in a production build: without `physics()`,
no Rapier is loaded. Drop the ones your game doesn't use. If a scene's JSON uses one you dropped
(a sky box, post effects, a mesh's levels of detail), `InitEngine` fails at boot and names it
(see [the feature manifest](hub:features/scenes-and-assets#the-feature-manifest)).

`InitEngine` reads the environment first (the build's env vars, `?isDebug` and `?isProdTest`), so
`IS_DEBUG_ENV` reads as a production build until it runs: check it in `start` or later, never at
a module's top level.

::: dev-only

## Check your changes

```bash
yarn test               # unit tests (Vitest), about a second
yarn verify:baselines   # bundle sizes, API surface, JSDoc coverage
yarn verify:scenes      # every scene vs. your last good run
```

- `yarn test` runs the `*.test.ts` files next to the modules they test. The agents' Stop hook runs
  it after every change in `src/` or `devTools/`.
- `yarn verify:baselines` builds the app and diffs `devTools/verify/baselines/`. When a change
  grows a chunk, adds or moves an export or drops a folder's JSDoc coverage on purpose, record it
  with `--update` and commit the files with that change.
- `yarn verify:scenes` loads every scene in debug (with the physics worker over a
  `SharedArrayBuffer`, over messages, and on the main thread) and in prod test mode, and fails on
  console errors, a changed determinism hash or a snapshot that looks different. Its baselines
  are kept on your machine (`.cache/verify/scenes/`), because snapshots depend on the GPU: record
  them on `main` with `--update`, then run it on your branch. `--only <scene id>` and
  `--config quick` keep a run short; the full run takes up to an hour.
- `yarn verify:scenes --browser firefox` runs the debug configurations in Firefox (WebGL2) and
  compares only their determinism hashes, with your Chromium baseline: a difference means the
  simulation depends on the JavaScript engine. Run it after changing simulation code, once the
  Chromium run passes (so a difference is the browser's, not your change's). It needs
  Playwright's Firefox once: `npx playwright-core install firefox`.

Both verify commands write to one log, which you can follow from any terminal:

```bash
tail -f .cache/verify/progress.log
```

:::
