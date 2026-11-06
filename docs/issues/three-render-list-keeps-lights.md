**Title:** WebGPURenderer: a render context per MRT keeps its last camera, and an idle `RenderList` keeps its lights, so an MRT per scene keeps every scene's camera and lights

Status: not filed yet
File at: https://github.com/mrdoob/three.js/issues/new?template=bug_report.yml
Category: Bug, Rendering, Dependencies
Found: 2026-11-05, p057 D4 (with three's #34707 in, the app still kept every Gym visit's lights: `docs/plans/_DONE_p057_three-r187-migration.md`)
Our workaround: one pre-pass MRT node for every PostFX build (`prePassMRT`, `src/_engine/features/postfx/PostFX.ts`), so the render contexts stay bounded; the lights of the first and the latest Gym visit stay (p057 D4's table)

Everything below is the report, in the repository's bug report template.

### Description

Since #34707 (r187) a disposed light can be collected, but an app that makes a new `RenderPipeline` per scene,
with a scene pass that has an MRT, still keeps every scene's camera and lights. Two things together:

1. `RenderContexts.get()` keys a context by attachment state, **MRT id**, camera type and call depth, and never
   removes one. A new `mrt()` node per pipeline is a new context per pipeline, kept for the renderer's lifetime.
   `Renderer._renderScene()` sets `renderContext.camera = camera`, so each of these contexts keeps the last camera
   it rendered with (and its `mrt` node).
2. `RenderLists.update()` clears a list that has been idle for more than 10 frames, but `RenderList.clear()` resets
   the render items and the opaque / transparent / bundle arrays, not `lightsArray` (`begin()` does). The lists are
   in a `ChainMap` keyed `[scene, camera, lighting]`: with a long-lived scene and the camera kept by its context,
   the idle list stays reachable, and its `lightsArray` holds the lights of its last render.

So each scene visit adds one render context, one camera and that scene's lights (with `castShadow`, their shadow
data too). The GPU side is freed correctly; the JS heap grows.

```
renderer._renderContexts._renderContexts['<attachments>-<mrt id>-perspective-<depth>']
  -> RenderContext.camera (the last camera rendered with that context)
renderer._renderLists.lists (ChainMap [scene, camera, lighting])
  -> RenderList for [the long-lived scene, that camera, renderer.lighting]
  -> lightsArray -> the disposed lights
```

(Heap snapshot of our app on r187.0, following WeakMap edges only when both the key and the table are reachable.)

Either part alone is harmless: with one MRT node for every pipeline the contexts are reused, and each one's camera
is replaced by the next scene's; with `lightsArray` emptied on `clear()` the lights go, but each context still
keeps a camera.

### Reproduction steps

1. Open the page below in Chrome started with `--js-flags=--expose-gc` (or press "Collect garbage" in DevTools >
   Memory, then "Check").
2. It renders a long-lived scene with a long-lived camera every frame. Each visit adds a camera, a
   `DirectionalLight`, a `PointLight` and a mesh, renders them for 3 frames through a new `RenderPipeline` whose
   scene pass has a new `mrt({ output, normal: normalView })`, then removes and disposes all of it (the mesh's
   geometry and material, the lights, the pass, the pipeline) and renders the long-lived scene for 15 frames, so
   the visit's render list goes idle and is cleared. It repeats this 10 times, then renders one more visit that is
   kept.
3. A `FinalizationRegistry` counts how many of the disposed lights and cameras were collected.

Results (Chrome 156, Apple M2, macOS 26.5), 10 visits:

| three | page params | disposed lights collected | disposed cameras collected | cached render contexts |
| --- | --- | --- | --- | --- |
| r187.0 | (none) | 0 / 20 | 0 / 10 | 13 |
| r187.0 | `patch=clear` (`RenderList.clear()` also empties `lightsArray`) | 20 / 20 | 0 / 10 | 13 |
| r187.0 | `patch=camera` (every cached context's `camera` set to null after each removal) | 20 / 20 | 10 / 10 | 13 |
| r187.0 | `mrt=shared` (one MRT node for every visit's pass) | 20 / 20 | 10 / 10 | 3 |
| r186.1 | (none) | 0 / 20 | 0 / 10 | 13 |
| r186.1 | `mrt=shared` | 0 / 20 | 9 / 10 | 3 |

On r186.1 every light is also kept by `_bindingGroupsCache` (#34705, fixed by #34707), so this shows from r187.
The context count grows by one per visit in every row with an MRT per visit, the patched ones too.

`mrt=shared` is the app-side workaround: reuse one MRT node across pipelines that render with the same outputs.

### Code

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>WebGPURenderer: a render context per MRT keeps each camera's lights</title>
    <style>
      body { font: 13px/1.4 monospace; margin: 12px; }
      pre { white-space: pre-wrap; }
    </style>
    <script>
      // Some versions' three.tsl.js import the bare 'three/webgpu': map both to the version asked for
      {
        const v = new URLSearchParams(location.search).get('v') || '0.187.0';
        const base = `https://cdn.jsdelivr.net/npm/three@${v}/build`;
        const map = { imports: { 'three/webgpu': `${base}/three.webgpu.js`, 'three/tsl': `${base}/three.tsl.js` } };
        document.write(`<script type="importmap">${JSON.stringify(map)}<\/script>`);
      }
    </script>
  </head>
  <body>
    <p>
      A long-lived scene, rendered every frame with a long-lived camera. Each visit adds a camera, two lights
      and a mesh and renders them for 3 frames through a RenderPipeline whose scene pass has its own MRT,
      then removes and disposes all of it and renders the long-lived scene for 15 frames (so the visit's
      render list goes idle and is cleared). Repeats <code>visits</code> times, then renders one more visit
      that is kept, waits for GC and counts how many of the disposed lights and cameras were collected.<br />
      Query params: <code>v</code> (three version, default 0.187.0), <code>visits</code> (default 10),
      <code>mrt=shared</code> (every visit's pass uses one MRT node instead of its own),
      <code>patch=clear</code> (<code>RenderList.clear()</code> also empties <code>lightsArray</code>),
      <code>patch=camera</code> (every cached <code>RenderContext</code>'s <code>camera</code> set to null after
      each removal).<br />
      Run Chrome with <code>--js-flags=--expose-gc</code>, or click "Collect garbage" in DevTools &gt; Memory
      when asked and then press "Check".
    </p>
    <button id="check" disabled>Check</button>
    <pre id="out"></pre>
    <script type="module">
      import * as THREE from 'three/webgpu';
      import { pass, mrt, output, normalView } from 'three/tsl';

      const params = new URLSearchParams(location.search);
      const visits = Number(params.get('visits') || 10);
      const sharedMRT = params.get('mrt') === 'shared';
      const patch = params.get('patch') || 'none';

      const out = document.getElementById('out');
      const log = (msg) => (out.textContent += msg + '\n');
      log(`three ${THREE.REVISION}, visits=${visits}, mrt=${sharedMRT ? 'shared' : 'per visit'}, patch=${patch}`);

      const renderer = new THREE.WebGPURenderer();
      renderer.setSize(256, 256);
      document.body.append(renderer.domElement);
      await renderer.init();

      // Long-lived, like an app's root scene and its main camera
      const scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 0.2));
      const mainCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
      mainCamera.position.set(0, 2, 6);
      mainCamera.lookAt(0, 0, 0);

      const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
      const idleFrames = async (n) => {
        for (let i = 0; i < n; i++) {
          renderer.render(scene, mainCamera);
          await nextFrame();
        }
      };

      if (patch === 'clear') {
        // RenderList isn't exported: take its prototype from a live list
        renderer.render(scene, mainCamera);
        const proto = Object.getPrototypeOf(renderer._renderLists._activeLists.values().next().value);
        const clear = proto.clear;
        proto.clear = function () {
          clear.call(this);
          this.lightsArray.length = 0;
        };
      }

      const collected = new Set();
      const registry = new FinalizationRegistry((label) => collected.add(label));
      const sharedMRTNode = mrt({ output, normal: normalView });

      const addVisit = () => {
        const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
        camera.position.set(3, 3, 5);
        camera.lookAt(0, 0, 0);
        const sun = new THREE.DirectionalLight(0xffffff, 2);
        sun.position.set(3, 6, 2);
        const lamp = new THREE.PointLight(0xffaa66, 5);
        lamp.position.set(-2, 1, 2);
        const box = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardNodeMaterial());
        scene.add(sun, lamp, box);

        // An app's per-scene render pipeline: a scene pass with an MRT (a normal buffer, eg. for AO),
        // made new with the pipeline
        const scenePass = pass(scene, camera);
        scenePass.setMRT(sharedMRT ? sharedMRTNode : mrt({ output, normal: normalView }));
        const pipeline = new THREE.RenderPipeline(renderer);
        pipeline.outputNode = scenePass.getTextureNode('output');
        return { camera, lights: [sun, lamp], box, scenePass, pipeline };
      };

      const renderVisit = async (visit, n) => {
        for (let i = 0; i < n; i++) {
          visit.pipeline.render();
          await nextFrame();
        }
      };

      const removeVisit = ({ lights, box, scenePass, pipeline }) => {
        scene.remove(...lights, box);
        box.geometry.dispose();
        box.material.dispose();
        for (const light of lights) light.dispose();
        scenePass.dispose();
        pipeline.dispose();
      };

      // A function of its own: the module's suspended top-level frame would keep the loop's last visit
      const runVisits = async () => {
        for (let i = 0; i < visits; i++) {
          const visit = addVisit();
          await renderVisit(visit, 3);
          removeVisit(visit);
          visit.lights.forEach((light, j) => registry.register(light, `light ${i}.${j}`));
          registry.register(visit.camera, `camera ${i}`);
          // Makes the disposed lights easy to find in a heap snapshot
          visit.lights[0].userData.marker = new (class DisposedLightMarker {})();
          if (patch === 'camera') {
            for (const context of Object.values(renderer._renderContexts._renderContexts)) context.camera = null;
          }
          // More than 10 frames: RenderLists.update() clears the visit's list as idle
          await idleFrames(15);
        }
      };
      await runVisits();

      // One more visit, kept, so the pass's latest render context (with mrt=shared, the one every visit
      // used) points at a live camera, not a disposed one
      const kept = addVisit();
      await renderVisit(kept, 3);
      await idleFrames(15);

      const check = async () => {
        if (typeof gc === 'function') {
          for (let i = 0; i < 3; i++) {
            gc();
            await new Promise((r) => setTimeout(r, 100));
          }
        }
        const lights = [...collected].filter((l) => l.startsWith('light')).length;
        const cameras = [...collected].filter((l) => l.startsWith('camera')).length;
        const contexts = Object.keys(renderer._renderContexts._renderContexts).length;
        log(
          `collected: ${lights}/${visits * 2} disposed lights, ${cameras}/${visits} disposed cameras; ` +
            `${contexts} cached render contexts`
        );
        window.__result = { version: THREE.REVISION, sharedMRT, patch, visits, lights, cameras, contexts };
      };

      const button = document.getElementById('check');
      button.disabled = false;
      button.onclick = check;
      if (typeof gc === 'function') await check();
      else log('Collect garbage in DevTools > Memory, then press "Check".');
    </script>
  </body>
</html>
```

### Live example

Save the code above as an `.html` file and serve it from `localhost` or https (WebGPU needs a secure context), eg.
`npx serve`. Three is loaded from jsDelivr, so `?v=0.186.1` or any other version can be compared on the same page.

### Possible fix directions

- `this.lightsArray.length = 0` in `RenderList.clear()`, as `begin()` does. That releases the lights; the cameras
  stay.
- Don't let a cached context outlive its MRT: key the contexts made with an MRT by the `MRTNode` itself (a
  `WeakMap`) rather than by its id in a plain object, or drop them on the node's `dispose` event. Or drop a context's
  `camera` when nothing renders with it any more (as `RenderLists` does for an idle list).

### Version

r187.0 (`RenderList.clear()` and `RenderContexts` are unchanged on `dev`, 2026-11-06)

### Device

Desktop

### Browser

Chrome

### OS

MacOS
