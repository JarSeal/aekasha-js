**Title:** WebGPURenderer: `PassNode.compileAsync()` (and any compile in a pass's target and MRT) keeps the renderer's target and MRT set across the frames it yields to

Status: open | fixed upstream on dev ([#35359](https://github.com/mrdoob/three.js/pull/35359), 2026-11-05), not in a release yet: no report to file
Category: Bug, Rendering, Dependencies
Found: 2026-11-06, p057 Phase 3 step 3 (finding 4: the PostFX output quad built with the pre-pass's MRT into the scene pass's target, `docs/plans/_DONE_p057_three-r187-migration.md`)
Our workaround: the engine's compiles run one at a time and every engine render runs with no target and no MRT set (`src/_engine/kernel/render/CompileQueue.ts`, `src/_engine/kernel/render/CLAUDE.md`'s Pre-warm compiles)

### What happens (three r187)

`PassNode.compileAsync( renderer )` (#35168, r187) sets the renderer's target and MRT to the pass's, awaits
`renderer.compileAsync( scene, camera )` and puts them back after it resolves. `compileAsync()` yields to the next
frame every 8 ms (`CompileScheduler`), and at each yield `_finishPreCompile()` puts back the MRT that was set at the
call (the pass's) and leaves a non-canvas target as it is (the pass's). So every frame the app's animation loop
renders while the compile runs starts with the pass's target and MRT set. Node builds read them
(`MRTNode.setup`, `NodeBuilder.getOutputType`), so the caller can't restore them early either: on r187 a caller
that sets the pass's state by hand and restores it right after the synchronous call still gets the pass's MRT
back at the first yield.

With a `RenderPipeline` the result is worse than a wrong build: the pipeline's output quad renders into the pass's
own target while sampling its texture, so each of those frames fails validation and draws nothing:

```
[Texture "output"] usage (TextureBinding|RenderAttachment) includes writable usage and another usage in the same synchronization scope.
 - While validating render pass usage.
 - While finishing [CommandEncoder "renderContext_3"].
```

### What #35359 changes (dev, after r187)

`_beginPreCompile()` saves the renderer's current target, MRT and context node in the precompilation state and
applies the work item's own; `_finishPreCompile()` puts the saved ones back. So each yield restores what was set
when the work resumed, and `PassNode.compileAsync()` puts its state back right after the synchronous
`renderer.compileAsync()` call, before awaiting it. A caller that holds the pass's state until the compile resolves
still holds it across the yields: the fix needs the caller to restore right after the call.

### Repro and results

The page below renders a `RenderPipeline` whose scene pass has an MRT every frame (`setAnimationLoop`), then
pre-warms 40 meshes with new materials through the pass (the loop hides them around its own render, so only the
compile builds them), and records the state each frame starts with while the compile runs, the node builds those
frames make, and the device's validation errors. Chrome 156 headless, Apple M2, macOS 26.5, warm shader cache (the
first run of a fresh shader set took 1.4 s instead of ~140 ms); `src=/three/src` serves three's `src/` at
`7d4a7890fc` (#35359) from a local sparse checkout.

| three | page params | frames during the compile | of them with the pass's state | builds in those frames | validation errors |
| --- | --- | --- | --- | --- | --- |
| r187.0 | (none: `scenePass.compileAsync`) | 9 | 9 | 1 (the output quad, pass target and MRT) | 18 (2 a frame) |
| r187.0 | `guard=1` (each frame renders with no target and MRT set, as the engine does) | 9 | 9 | 0 | 0 |
| r187.0 | `compile=hold` (state set by hand, restored after the compile) | 8 | 8 | 1 | 16 |
| r187.0 | `compile=sync` (state set by hand, restored right after the call) | 10 | 10 | 1 | 20 |
| #35359 | (none) | 8 | 0 | 0 | 0 |
| #35359 | `compile=hold` | 8 | 8 | 1 | 16 |
| #35359 | `compile=hold&guard=1` | 9 | 9 | 0 | 0 |
| #35359 | `compile=sync` | 6 | 0 | 0 | 0 |

### When a release has #35359

- `compileInScenePassAsync` (`src/_engine/features/postfx/PostFX.ts`) holds the pass's target and MRT until its
  compile resolves (`compile=hold`): restore them right after the synchronous `compileAsync` call instead
  (`compile=sync`), as three's `PassNode.compileAsync` then does.
- After that, `runWithClearRenderState` around the engine's renders should be unneeded; re-measure with p057's
  probe (the Gym, a pre-warm through the passes: no build in the frames during the compile) before removing it.
  `runCompileAsync` (one compile at a time) needs its own check: #35359 stacks the precompilation states
  (`previousPrecompilationState`), which may make overlapping compiles safe.

### Code

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>WebGPURenderer: PassNode.compileAsync holds the renderer's target and MRT</title>
    <style>
      body { font: 13px/1.4 monospace; margin: 12px; }
      pre { white-space: pre-wrap; }
    </style>
    <script>
      // Some versions' three.tsl.js import the bare 'three/webgpu': map both to the version asked for
      {
        const query = new URLSearchParams(location.search);
        const v = query.get('v') || '0.187.0';
        const src = query.get('src'); // a commit of three's repository: its sources instead of a release build
        const base = `https://cdn.jsdelivr.net/npm/three@${v}/build`;
        const gh = src?.startsWith('/') ? src : `https://cdn.jsdelivr.net/gh/mrdoob/three.js@${src}/src`;
        const map = src
          ? { imports: { 'three/webgpu': `${gh}/Three.WebGPU.js`, 'three/tsl': `${gh}/Three.TSL.js` } }
          : { imports: { 'three/webgpu': `${base}/three.webgpu.js`, 'three/tsl': `${base}/three.tsl.js` } };
        document.write(`<script type="importmap">${JSON.stringify(map)}<\/script>`);
      }
    </script>
  </head>
  <body>
    <p>
      A RenderPipeline whose scene pass has an MRT renders every frame (<code>setAnimationLoop</code>). Then
      <code>count</code> meshes with new materials are pre-warmed with the pass's <code>compileAsync</code> (the
      loop hides them around its own render, so only the compile builds them). Records, for each frame rendered
      while the compile runs, the render target and MRT the renderer has when the frame starts, and the node
      builds the frame makes.<br />
      Query params: <code>v</code> (three version, default 0.187.0), <code>src</code> (three's
      <code>src/</code> folder at a commit: a path on this server, or a commit loaded through jsDelivr), <code>count</code> (default 40),
      <code>compile=hold</code> / <code>compile=sync</code> (<code>renderer.compileAsync</code> with the
      pass's target and MRT set by hand, put back after the compile or right after the call, instead of the
      pass's <code>compileAsync</code>), <code>guard=1</code> (each frame renders with no target and no MRT set and puts back what was: a
      workaround).
    </p>
    <pre id="out"></pre>
    <script type="module">
      import * as THREE from 'three/webgpu';
      import { pass, mrt, output, normalView, vec3, float } from 'three/tsl';

      const params = new URLSearchParams(location.search);
      const count = Number(params.get('count') || 40);
      const guard = params.get('guard') === '1';

      const out = document.getElementById('out');
      const log = (msg) => (out.textContent += msg + '\n');
      log(`three ${THREE.REVISION}, count=${count}, guard=${guard}, compile=${params.get('compile') || 'pass'}`);

      const renderer = new THREE.WebGPURenderer();
      renderer.setSize(256, 256);
      document.body.append(renderer.domElement);
      await renderer.init();

      const errors = [];
      renderer.backend.device.addEventListener('uncapturederror', (e) => errors.push(e.error.message));

      const scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 0.3));
      const sun = new THREE.DirectionalLight(0xffffff, 2);
      sun.position.set(2, 4, 3);
      scene.add(sun);
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardNodeMaterial()));
      const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
      camera.position.set(0, 1, 6);
      camera.lookAt(0, 0, 0);

      // An MRT scene pass, eg. normals for AO
      const scenePass = pass(scene, camera);
      const passMRT = mrt({ output, normal: normalView });
      scenePass.setMRT(passMRT);
      const pipeline = new THREE.RenderPipeline(renderer);
      pipeline.outputNode = scenePass.getTextureNode('output');

      // The meshes to pre-warm: the loop hides them around its own render
      const warm = new THREE.Group();
      const geometry = new THREE.SphereGeometry(0.2, 16, 8);
      for (let i = 0; i < count; i++) {
        const material = new THREE.MeshPhysicalNodeMaterial();
        // A constant of its own: a shader of its own
        material.colorNode = vec3(float(i / count), 0.5, float(1 - i / count));
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set((i % 8) - 3.5, Math.floor(i / 8) - 2, 0);
        warm.add(mesh);
      }

      // Node builds, with the state they are made in
      let phase = 'idle';
      let inFrame = false;
      const builds = [];
      const nodes = renderer._nodes;
      const createNodeBuilder = nodes._createNodeBuilder.bind(nodes);
      nodes._createNodeBuilder = (renderObject, material) => {
        builds.push({
          phase,
          inFrame,
          material: material.type,
          target: renderer.getRenderTarget() === scenePass.renderTarget ? 'pass' : String(renderer.getRenderTarget()),
          mrt: renderer.getMRT() === passMRT ? 'pass' : String(renderer.getMRT()),
        });
        return createNodeBuilder(renderObject, material);
      };

      const frames = [];
      renderer.setAnimationLoop(() => {
        if (phase === 'compiling') {
          frames.push({
            target: renderer.getRenderTarget() === scenePass.renderTarget ? 'pass' : String(renderer.getRenderTarget()),
            mrt: renderer.getMRT() === passMRT ? 'pass' : String(renderer.getMRT()),
          });
        }
        inFrame = true;
        warm.visible = false;
        const heldTarget = renderer.getRenderTarget();
        const heldMRT = renderer.getMRT();
        if (guard) {
          renderer.setRenderTarget(null);
          renderer.setMRT(null);
        }
        pipeline.render();
        if (guard) {
          renderer.setRenderTarget(heldTarget);
          renderer.setMRT(heldMRT);
        }
        warm.visible = true;
        inFrame = false;
      });

      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await wait(500);

      scene.add(warm);
      phase = 'compiling';
      const start = performance.now();
      const compileMode = params.get('compile') || 'pass';
      if (compileMode === 'pass') {
        await scenePass.compileAsync(renderer);
      } else {
        // The pass's target and MRT set by hand around renderer.compileAsync (as a caller compiling
        // for a pass would), put back after the compile ('hold') or right after the call ('sync')
        const prevTarget = renderer.getRenderTarget();
        const prevMRT = renderer.getMRT();
        scenePass.renderTarget.samples = renderer.samples;
        renderer.setRenderTarget(scenePass.renderTarget);
        renderer.setMRT(passMRT);
        const promise = renderer.compileAsync(scene, camera);
        if (compileMode === 'sync') {
          renderer.setRenderTarget(prevTarget);
          renderer.setMRT(prevMRT);
        }
        await promise;
        renderer.setRenderTarget(prevTarget);
        renderer.setMRT(prevMRT);
      }
      const ms = performance.now() - start;
      phase = 'after';
      await wait(300);
      renderer.setAnimationLoop(null);

      const held = frames.filter((f) => f.target === 'pass' || f.mrt === 'pass').length;
      const compileBuilds = builds.filter((b) => b.phase === 'compiling' && !b.inFrame).length;
      const frameBuilds = builds.filter((b) => b.phase === 'compiling' && b.inFrame);
      log(`compile: ${ms.toFixed(0)} ms, ${compileBuilds} node builds`);
      log(`frames during the compile: ${frames.length}, ${held} of them started with the pass's target or MRT set`);
      log(`node builds in those frames: ${frameBuilds.length}`);
      for (const b of frameBuilds) log(`  ${b.material} (target ${b.target}, mrt ${b.mrt})`);
      log(`validation errors: ${errors.length}`);
      if (errors.length) log(`first: ${errors[0]}`);
      window.__log = out.textContent;
      window.__result = {
        version: THREE.REVISION,
        guard,
        compile: params.get('compile') || 'pass',
        ms: Math.round(ms),
        frames: frames.length,
        held,
        frameBuilds: frameBuilds.length,
        errors: errors.length,
      };
    </script>
  </body>
</html>
```

Serve it from `localhost` or https (WebGPU needs a secure context). Three is loaded from jsDelivr (`?v=` picks the
release); `?src=` takes a path on the same server holding three's `src/` at a commit (jsDelivr refuses three's
repository through its GitHub proxy).
