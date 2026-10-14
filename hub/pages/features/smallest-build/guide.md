## The numbers

Measured by `yarn sbp` on the build this Hub was made from: gzip sizes in KiB (1,024 bytes).
"Before the first frame" is the entry chunk, the chunks it imports statically and its CSS; the
rest of the build's files load later, or never.

| Build                                            | Before the first frame | Later, when needed                                    |
| ------------------------------------------------ | ---------------------- | ----------------------------------------------------- |
| The banner: the kernel alone, one scene          | {{sbp:banner.initial}} | {{sbp:banner.lazy}} in {{sbp:banner.lazyFiles}} files |
| The template app: all nine features, every scene | {{sbp:app.initial}}    | {{sbp:app.lazy}} in {{sbp:app.lazyFiles}} files       |

### Where the floor comes from

Most of the banner is three.js. three's `WebGPURenderer` brings its node system (TSL) whatever
the material, so the same scene in a plain page, without the engine, still needs **237.7 KiB**
(three r186, measured on 2026-10-14). The rest is the kernel every app runs: the ECS, the scenes,
the asset registry, the loop, cameras and lights. Part of it a mount without a HUD or a model
doesn't need yet (the UI kit, the glTF import path): moving those behind an `import()` is planned,
and helps every build.

### Each feature's share

What each feature adds to the template app's first download. These are the features' modules
measured one by one before minification, as `yarn sbp` groups them, so they add up to more than
their share of the minified chunk.

| Feature                                     | Before the first frame                        | Loaded later                               |
| ------------------------------------------- | --------------------------------------------- | ------------------------------------------ |
| [Physics](hub:features/physics)             | {{sbp:app.group:_engine/features/physics}}    | Rapier, {{sbp:app.chunk:assets/rapier.js}} |
| [Sky box](hub:features/sky-box)             | {{sbp:app.group:_engine/features/skybox}}     |                                            |
| Lines                                       | {{sbp:app.group:_engine/features/lines}}      |                                            |
| [Spatial index](hub:features/spatial-index) | {{sbp:app.group:_engine/features/spatial}}    |                                            |
| [LOD](hub:features/lod)                     | {{sbp:app.group:_engine/features/lod}}        | the mesh simplifier, on first use          |
| [Characters](hub:features/characters)       | {{sbp:app.group:_engine/features/character}}  |                                            |
| Instancing                                  | {{sbp:app.group:_engine/features/instancing}} |                                            |
| Post effects                                | {{sbp:app.group:_engine/features/postfx}}     | each pass with its scene                   |
| [Viewports](hub:features/viewports)         | {{sbp:app.group:_engine/features/viewports}}  |                                            |

## How a build stays small

- **Features are opt-in.** `InitEngine`'s `features` lists the ones the app installs, and the
  bundle has only those: an app without `physics()` loads no physics module and no Rapier. `[]`
  is the kernel alone, the banner's list.
- **Nothing runs at import.** Every engine module is free of side effects (`package.json`'s
  `sideEffects`), and everything registers when it's installed, never when it's loaded. So the
  bundler keeps only what's used of each entry, and a test fails on a module that registers on
  import.
- **Heavy parts load on first use.** Rapier loads when physics starts; the glTF, KTX2, Draco and
  HDR loaders when a scene loads such an asset; each scene's code with the scene, its TSL
  materials with its assets and its post effects when it's created; the assets worker's jobs on
  their first job.
- **Debug code folds away.** The debugger, its panels and its assets are behind a flag a
  production build sets to `false`, so the bundler removes them. `yarn verify:baselines` fails on
  any debug module or debug asset left in a production build.

## What a build deploys but rarely downloads

Lazy files ship with the build even when no scene loads them, since kernel code can ask for them
at runtime. The banner's {{sbp:banner.lazy}} are the assets worker and its jobs, the loaders, and
the Basis and Draco decoders ({{sbp:banner.chunk:assets/basis_transcoder.wasm}} for Basis alone):
a scene that loads a KTX2 texture or a model gets them on demand, and the banner never asks for
them.

## Measuring: `yarn sbp`

`yarn sbp` builds a profile, then reports what loads before the first frame and what later, each
group's share, each engine feature's size, why each feature is in the first download, and the
change from the committed baseline. It then checks the profile's budgets. `yarn build` runs it on
the app it just built, and builds and checks the embeds too.

- `--profile <id>[,<id>…] | all`: the profiles to build (`app` by default).
- `--no-build` measures the last builds; `--no-app-build` measures the app's last build and
  builds the embeds.
- `--why <group | file>`: the chain of static imports that puts something in the build, for
  example `yarn sbp --why physics`:
  `src/index.ts → aekasha/physics (features/physics/index.ts) → PhysicsAPITypes.ts`.
- `--json` prints one profile's report; `--brief` only the totals and the budgets.
- `AEK_SBP=false` skips it, in `yarn build` too.

The whole report goes to `.cache/sbp/progress.log`, and the data to `.cache/sbp/report.json`,
which this page's numbers come from.

## Profiles and budgets

A profile is a build to measure, in `sbp.config.ts` at the repo root: the template app, and each
embed (an entry module, its scenes and nothing else). Its budgets are gzip bytes: what loads
before the first frame, single files, groups (`three`, a kernel area, a feature) and modules. The
banner's promise is that no feature reaches it:

<<< sbp.config.ts#banner-profile

Over a budget fails `yarn sbp` and `yarn build`, naming the file or group, its size and its
budget: shrink the build, or raise the budget in the change that explains the growth. Well under
a budget is reported with a tighter value to set, so budgets follow the build down and never
drift.

## Embedding

An embed profile builds as an ES module a site imports from its own origin, and its `mount()`
puts the engine into an element of a page it doesn't own: an `INLINE` panel like the one above,
or a `BACKGROUND` behind the page's content. The page's own styles and input stay its own, and
the engine pauses out of view. One engine mounts per page load. The
[embedding example](hub:examples/embed) walks through the banner, from its scene to the page.

## A lighter renderer?

three's classic `WebGLRenderer` draws the banner's scene, its look rewritten in GLSL, in
128.3 KiB: about 110 KiB less than the WebGPU path. We measured it and chose not to build it now:
that path can't run node materials, so every TSL material, the sky box, post effects, LOD fades,
impostors, fat lines and viewports would need a second implementation, and a second engine to
verify. Ækasha is engineered for WebGPU first. The engine's own share is the better first cut,
and it helps every build; the classic path comes back when three ships its node system apart from
`WebGPURenderer`, or when an embed needs to be well under 200 KiB.

## Key APIs

- [`InitEngine`](api:InitEngine) with its `features`, and [`EngineFeature`](api:EngineFeature).
- [`mountAekasha`](api:mountAekasha), [`MountAekashaOptions`](api:MountAekashaOptions) and
  [`AekashaMount`](api:AekashaMount).

::: claude-md
:::
