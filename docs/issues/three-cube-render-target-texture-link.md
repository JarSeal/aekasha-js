**Title:** WebGPURenderer: a `CubeRenderTarget`'s texture has no `renderTarget` link, so a cube target sampled before its first render has its texture destroyed in place by that render ("Destroyed texture used in a submit")

Status: not filed yet
File at: https://github.com/mrdoob/three.js/issues/new?template=bug_report.yml
Category: Bug, Rendering, Dependencies
Found: 2026-11-05, p057 Phase 3 step 2 (`skyShowcase` without `initEnvBakeTarget` on r187: 100-104 × "Destroyed texture [Texture "SkyBox.envBake"] used in a submit", as on r186: `docs/plans/_DONE_p057_three-r187-migration.md`)
Our workaround: a new cube target is cleared once before anything samples it (`initEnvBakeTarget` in `src/_engine/features/skybox/SkyEnvironment.ts`, `initTarget` in `SkyStaticLayers.ts`); both can go once three links the texture

Everything below is the report, in the repository's bug report template.

### Description

#35204 (r187) creates a sampled render target texture together with its render target: `Textures.updateTexture()`
calls `updateRenderTarget( texture.renderTarget )` when the target isn't set up yet. That path needs
`texture.renderTarget`. `RenderTarget`'s constructor sets it on its own textures, but `CubeRenderTarget`'s
constructor then replaces the texture:

```js
this.texture = new CubeTexture( images );
```

and `RenderTarget`'s `texture` setter only stores the value (`this.textures[ 0 ] = value`), unlike the
`depthTexture` setter, which links its texture. So a cube target's texture has `renderTarget === null`, and a cube
target sampled before anything renders into it takes the old path: the texture is created on its own when first
sampled, and the first render into the target (`updateRenderTarget()` sets `textureNeedsUpdate` because the
target's size isn't stored yet) destroys it and creates a new one (`backend.destroyTexture()`, then
`createTexture()`).

When the cube texture is the scene's `environmentNode`, the bind group that samples it isn't refreshed after that,
so every later frame fails with:

```
Destroyed texture [Texture "sampledBeforeRendered"] used in a submit.
 - While calling [Queue].Submit([[CommandBuffer from CommandEncoder "renderContext_0"]])
```

As a material's `envNode` the texture is destroyed and created again the same way, but that bind group is
refreshed and nothing fails. We haven't traced why the scene environment's binding isn't refreshed; with the link
set, the texture is never destroyed, so the question doesn't arise.

This is the usual setup for a PMREM baked at runtime into a target allocated ahead (`fromScene( scene, …, {
renderTarget } )`), so that the environment node can exist before the first bake: in our app the first bake waits
for the scene load, and every lit material samples the environment all through the load.

### Reproduction steps

1. Open the page below (WebGPU).
2. It allocates a PMREM target as `PMREMGenerator._allocateTarget()` does (a `CubeRenderTarget`, HalfFloat, the
   prefiltered mip levels), sets `scene.environmentNode = pmremTexture( target.texture )`, and renders a metallic
   sphere for 3 frames. Then it bakes once with `PMREMGenerator.fromScene( …, { renderTarget: target } )` and
   renders 10 more frames.
3. It counts the device's `uncapturederror` events before and after the bake. `trace=1` logs the backend's
   `createTexture` / `destroyTexture` calls for the target's texture.

Results (r187.0, Chrome 156, Apple M2, macOS 26.5):

| page params | `backend` calls for the texture | validation errors before / after the bake |
| --- | --- | --- |
| (none) | create (frame 1), destroy and create (the bake) | 0 / 10 (one per frame) |
| `link=1` (`target.texture.renderTarget = target` before it's sampled) | create (frame 1) | 0 / 0 |
| `clear=1` (`setRenderTarget( target ); clear()` before it's sampled) | create (the clear, before frame 1) | 0 / 0 |
| `env=material` (`material.envNode` instead of `scene.environmentNode`) | create, destroy and create (the bake) | 0 / 0 |

(r186.1 isn't comparable: its PMREMs are CubeUV 2D textures, and the page's cube PMREM doesn't compile there.)

### Code

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>WebGPURenderer: a CubeRenderTarget sampled before its first render</title>
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
      A PMREM target allocated ahead (a <code>CubeRenderTarget</code> as <code>PMREMGenerator</code>'s own) is
      the scene's <code>environmentNode</code> for a few frames before anything renders into it, then
      <code>PMREMGenerator.fromScene</code> bakes into it once and the scene renders on. Counts the WebGPU
      validation errors (<code>uncapturederror</code>) before and after the bake.<br />
      Query params: <code>v</code> (three version, default 0.187.0), <code>link=1</code>
      (<code>target.texture.renderTarget = target</code> first: the suggested fix), <code>clear=1</code> (the
      target cleared once before it is sampled: a workaround), <code>env=material</code> (the PMREM as the
      material's <code>envNode</code> instead), <code>trace=1</code> (logs the backend's create and destroy
      calls for the target's texture).
    </p>
    <pre id="out"></pre>
    <script type="module">
      import * as THREE from 'three/webgpu';
      import { pmremTexture } from 'three/tsl';

      const params = new URLSearchParams(location.search);
      const link = params.get('link') === '1';
      const clearFirst = params.get('clear') === '1';
      const onMaterial = params.get('env') === 'material';

      const out = document.getElementById('out');
      const log = (msg) => (out.textContent += msg + '\n');
      log(`three ${THREE.REVISION}, link=${link}, clear=${clearFirst}, env=${onMaterial ? 'material' : 'scene'}`);

      const renderer = new THREE.WebGPURenderer();
      renderer.setSize(256, 256);
      document.body.append(renderer.domElement);
      await renderer.init();

      const errors = [];
      renderer.backend.device.addEventListener('uncapturederror', (e) => errors.push(e.error.message));

      // A PMREM target like PMREMGenerator._allocateTarget's, allocated ahead so the scene can sample
      // it from the start
      const size = 256;
      const target = new THREE.CubeRenderTarget(size, {
        minFilter: THREE.LinearMipmapLinearFilter,
        generateMipmaps: false,
        type: THREE.HalfFloatType,
        colorSpace: THREE.LinearSRGBColorSpace,
        depthBuffer: false,
      });
      for (let lod = 0; lod <= Math.log2(size) - 3; lod++) {
        target.texture.mipmaps.push({ width: size >> lod, height: size >> lod });
      }
      target.texture.isPMREMTexture = true;
      target.texture.name = 'sampledBeforeRendered';
      log(`target.texture.renderTarget: ${target.texture.renderTarget}`);
      if (link) target.texture.renderTarget = target;

      if (params.get('trace') === '1') {
        const backend = renderer.backend;
        for (const name of ['createTexture', 'destroyTexture']) {
          const fn = backend[name].bind(backend);
          backend[name] = (texture, ...rest) => {
            if (texture === target.texture) log(`  backend.${name}, frame ${renderer.info.frame}`);
            return fn(texture, ...rest);
          };
        }
      }

      if (clearFirst) {
        renderer.setRenderTarget(target);
        renderer.clear();
        renderer.setRenderTarget(null);
      }

      // The scene that samples it
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
      camera.position.set(0, 0, 3);
      const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.3, metalness: 1 });
      if (onMaterial) material.envNode = pmremTexture(target.texture);
      else scene.environmentNode = pmremTexture(target.texture);
      scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material));

      // What the bake renders
      const sourceScene = new THREE.Scene();
      sourceScene.background = new THREE.Color(0x3366cc);

      const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
      const frames = async (n) => {
        for (let i = 0; i < n; i++) {
          renderer.render(scene, camera);
          await nextFrame();
        }
      };

      await frames(3);
      // Validation errors arrive asynchronously
      await new Promise((r) => setTimeout(r, 300));
      const before = errors.length;

      log('bake (fromScene into the target)');
      const generator = new THREE.PMREMGenerator(renderer);
      generator.fromScene(sourceScene, 0, 0.1, 100, { size, renderTarget: target });
      generator.dispose();

      await frames(10);
      await new Promise((r) => setTimeout(r, 300));

      const after = errors.length - before;
      log(`validation errors: ${before} in the 3 frames before the bake, ${after} in the 10 frames after it`);
      if (errors.length) log(`first: ${errors[0]}`);
      window.__log = out.textContent;
      window.__result = { version: THREE.REVISION, link, clearFirst, onMaterial, before, after };
    </script>
  </body>
</html>
```

### Live example

Save the code above as an `.html` file and serve it from `localhost` or https (WebGPU needs a secure context), eg.
`npx serve`. Three is loaded from jsDelivr (`?v=` picks the version).

### Possible fix directions

- Link the texture in `RenderTarget`'s `texture` setter, as the `depthTexture` setter does (`value.renderTarget =
  this`, and unlink the previous one), so every subclass that swaps its texture keeps #35204's path.
- Or set `this.texture.renderTarget = this` in `CubeRenderTarget`'s constructor, after the swap.

And separately, maybe: refresh the scene environment's bind group when its texture's generation changes, as the
material's is.

### Version

r187.0 (`CubeRenderTarget`'s constructor and the `texture` setter are unchanged on `dev`, 2026-11-06)

### Device

Desktop

### Browser

Chrome

### OS

MacOS
