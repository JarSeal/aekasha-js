## The renderer

The app creates the renderer once, first thing in its start callback (`src/index.ts`):

<<< src/index.ts#create-renderer

- [`createRenderer`](api:createRenderer) uses WebGPU when the browser gives it a GPU and
  `forceWebGL` is off, and WebGL 2 otherwise (also in a browser that has WebGPU but no adapter
  for it). Once `createRenderer` has resolved, [`isWebGPURenderer`](api:isWebGPURenderer) tells
  you which one runs.
- The options are three's: antialiasing (off unless you ask for it), tone mapping and its
  exposure, the output colour space, a transparent canvas (`alpha`), shadows and the shadow map
  type (three's PCF by default).
- In the debug env, the drawer's Renderer tab changes them and keeps the change for the next
  reload.

## Post effects

Post effects are a feature: list [`postFx()`](api:postFx), from `aekasha/postfx`, in
`InitEngine`'s `features` (see [How the app starts](hub:examples/quick-start#how-the-app-starts)).
Without it, scenes render directly, and a scene whose JSON lists `postFx` fails the boot, naming
the feature (see [the feature manifest](hub:features/scenes-and-assets#the-feature-manifest)).

A scene's post effects are an ordered chain of PostFX passes, rendered through a TSL
`RenderPipeline`. A pass is two files: a `*.postFx.json` with its params, and a `*.tsl.ts` that
builds its node, loaded with the first scene that lists it. The scene JSON lists them in order:

```json
{
  "postFx": ["heroBloom"],
  "postFxEnabled": true
}
```

The homepage image above has one pass, a bloom:

::: code-group

<<< src/app/examples/hubHero/heroBloom.tsl.ts title="heroBloom.tsl.ts"

<<< src/app/examples/hubHero/heroBloom.postFx.json title="heroBloom.postFx.json"

:::

- `fxNode` gets the pass's params and the chain so far: `ctx.colorNode` is the previous pass's
  output (the scene's colour for the first one). `ctx.sceneNormalNode` and `ctx.sceneDepthNode`
  give view-space normals and depth, from an extra scene render that only runs when a pass reads
  them.
- It returns a node, or the node with hooks: `setParam` takes a param change live, without a
  shader recompile (without it, a change rebuilds the chain), and `profileNodes` names the nodes
  the PostFX profiler times as this pass.
- `paramsMeta` gives the debugger's PostFX tab its sliders. The tab switches passes on and off
  and edits their params live, and its profiler times each pass on the GPU (WebGPU only).
- From code, [`setPostFxEnabled`](api:setPostFxEnabled) switches the whole chain,
  [`setPostFxPassEnabled`](api:setPostFxPassEnabled) one pass, and
  [`setPostFxPassParam`](api:setPostFxPassParam) sets a param.
- A change to the set of enabled passes recompiles the chain, a one-frame hitch, and so does a
  change of the active camera (see [Known issues](#known-issues)). A disabled pass costs nothing,
  and switching the whole chain off keeps it compiled.
- A mesh created with `preWarm` (and every level of its LOD) compiles in the background for the
  chain's own scene renders while the chain is on, so its first frame doesn't stall: compiled for
  the direct render, it would compile again for the chain's targets. The engine's compiles run
  one at a time, so a pre-warm can end a few frames after the mesh is created; a mesh drawn before
  then compiles on that frame, as without one.

The app has another pass to start from: ambient occlusion (GTAO) in `src/app/postFx/`.

## Snapshots

[`takeSnapshotAsync`](api:takeSnapshotAsync) renders a scene into an image off screen, at any
size: thumbnails, save game pictures, or the images on these pages, which the example scenes'
Hub tab saves with it.

```ts
const snapshot = await takeSnapshotAsync({ width: 1600, height: 1000 });
const png = await snapshotToBlobAsync(snapshot); // Or { type: 'image/webp' }
```

By default it's what the canvas shows: the active camera, through the scene's post effects,
without the viewports, the HUD or the debug helpers. Pass `scene` and `camera` to render
anything else, and `transparent: true` for a transparent background (the environment still
lights the scene). Only the canvas's own scene and camera have post effects: any other scene or
camera, `transparent` or `postFx: false` renders directly, without them. The canvas isn't
touched.

## Texture bakes

[`bakeTexture`](api:bakeTexture) renders a TSL graph into a texture once, so a material samples
it instead of running the graph for every pixel every frame: noise, a lookup table, a mask, a
procedural surface ([Terrain](hub:features/terrain#procedural-textures) has those).

```ts
import { floor, mod, vec4 } from 'three/tsl';
import { bakeTexture, createMaterial } from 'aekasha';

const baked = await bakeTexture({
  id: 'checker',
  size: 256,
  outputs: [{ name: 'albedo', colorSpace: 'SRGB' }],
  build: ({ uv }) => {
    const isOdd = mod(floor(uv.x.mul(8)).add(floor(uv.y.mul(8))), 2);
    return { albedo: vec4(isOdd.mul(0.8).add(0.1), isOdd.mul(0.8).add(0.1), 0.2, 1) };
  },
});
createMaterial({ id: 'checkerMat', type: 'STANDARD', params: { map: baked.textures.albedo } });
```

- **Each output is a registered texture,** `<id>.<name>` (`checker.albedo`), owned by the scene
  that baked it (or `isPersistent`) and released with it like any texture. It exists, cleared,
  as soon as `bakeTexture` returns, so a material can take it before the bake resolves.
- **One to four outputs** are one render (MRT), each with its own colour space and type
  (`HALF_FLOAT` for values outside 0..1). **`layers`** bakes an array texture, the graph reading
  `ctx.layer`; sample a layer with [`sampleArrayLayer`](api:sampleArrayLayer). Mips by default,
  built once after the last layer; `REPEAT` by default.
- **When it renders:** during a scene load, at once, after its pipeline compiles off the frame,
  and the loader hears of it (`updateBakeStatusFn`: the template shows "Baking textures, n / m").
  Outside a load, bakes queue: one a frame, and a rebake of one id at most every 150 ms (the last
  request always runs). So set the graph's uniforms and call `rebake()` on every slider change.
- **Memory:** uncompressed, 4 bytes a texel (8 for `HALF_FLOAT`) and a third more for the mips:
  1024² RGBA8 is 5.6 MB. [`getBakedTextureMemoryBytes`](api:getBakedTextureMemoryBytes) gives the
  figure before you bake and `memoryBytes` after. A bake you keep can be exported and committed
  as KTX2, a quarter of that.
- **Debug only:** [`getTextureBakeStats`](api:getTextureBakeStats) gives an id's bake count and
  its last CPU and GPU ms (WebGPU), and [`exportBakedTexture`](api:exportBakedTexture) writes an
  output as a PNG into the repo through the dev file server (or downloads it), ready for the
  [asset pipeline](hub:features/asset-optimization).
- **Visual only:** GPUs round floats differently, so a bake isn't the same bytes on every machine.
  Never derive gameplay or colliders from one.

A bake with the id of one that's alive returns that one: dispose it first, or rebake it. The
queued renders run in the main loop, so they wait while it's paused or an editor view is open.

## More on screen

- [Viewports](hub:features/viewports): extra rectangles over the canvas with their own scene and
  camera, drawn after the post effects.
- [Sky box](hub:features/sky-box): the background and the environment lighting.
- [LOD and impostors](hub:features/lod): fewer triangles for what's far away. An
  [instance set](hub:features/lod#instance-sets) culls its instances on the GPU inside each
  render, between the render deciding what it draws and drawing it, so every camera (a shadow,
  a viewport) draws only what's in its own view.

## Key APIs

- [`createRenderer`](api:createRenderer), [`getRenderer`](api:getRenderer) and
  [`isWebGPURenderer`](api:isWebGPURenderer).
- [`setPostFxEnabled`](api:setPostFxEnabled), [`setPostFxPassEnabled`](api:setPostFxPassEnabled),
  [`setPostFxPassParam`](api:setPostFxPassParam) and [`getPostFxPasses`](api:getPostFxPasses).
- [`takeSnapshotAsync`](api:takeSnapshotAsync) and [`snapshotToBlobAsync`](api:snapshotToBlobAsync).
- [`bakeTexture`](api:bakeTexture), [`getBakedTextureMemoryBytes`](api:getBakedTextureMemoryBytes),
  [`sampleArrayLayer`](api:sampleArrayLayer), and in the debug env
  [`getTextureBakeStats`](api:getTextureBakeStats) and [`exportBakedTexture`](api:exportBakedTexture).

## Known issues

Two three.js r186 issues of the WebGPU renderer that kept memory after a scene was gone are fixed
with three r187:

- [Disposed lights stayed in memory](hub:issues/three-bind-group-cache-light-leak) (and the
  engine's PostFX pre-pass now reuses one MRT, so at most two scene visits' lights remain).
- [A removed `InstancedMesh` leaked its instance attributes](hub:issues/three-instanced-node-attribute-leak).

Three r187 issues the engine works around, so a scene needs nothing for them:

- [A render context per MRT keeps its last camera and lights](hub:issues/three-render-list-keeps-lights):
  the PostFX pre-pass's one MRT is the workaround above.
- [A cube render target sampled before its first render loses its texture](hub:issues/three-cube-render-target-texture-link):
  the sky box clears its cube targets once when it makes them.
- [A pass compile keeps the renderer's target and MRT across frames](hub:issues/three-pass-compile-holds-renderer-state):
  the engine's compiles run one at a time and its renders without a held target. Fixed on three's
  `dev`. An app that calls `PassNode.compileAsync` itself still meets it.

One of the engine's own:

- [A camera cut rebuilds the PostFX chain](hub:issues/postfx-rebuilds-on-camera-change), a
  shader recompile.

## Read more

- The [quick start](hub:examples/quick-start): the dev environment and the smallest complete
  scene.
- The handbook's [Procedural textures](repo:docs/techniques/procedural-textures.md): bakes for
  surfaces, what they cost against an imported texture, and exporting one.
- The API reference: [`render/`](hub:documentation/aekasha/render) of `aekasha` (the renderer, snapshots and texture bakes) and
  [`aekasha/postfx`](hub:documentation/aekasha/postfx).

::: claude-md
:::
