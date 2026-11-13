// The texture baker (p304 D1): a TSL node graph rendered once into a mipmapped render target that
// is then sampled like any texture, so a material pays one fetch a pixel instead of the graph's
// noise maths every frame.
//
// A bake is a full-screen triangle (three's `QuadMesh`) whose material's `fragmentNode` is the
// graph (several outputs: `mrt()` keyed by the target's texture names, which is how three matches
// an MRT output to its attachment), rendered into one target with a texture per output, each
// registered as `<id>.<name>` and owned like any other: released with the scene loading it (or
// current), unless persistent. An array bake (`layers` > 1) renders its layers one by one into an
// array target (`setRenderTarget(target, layer)`, both backends on three r187), the graph reading
// the layer from an int uniform, with the mips generated once, after the last layer.
// Deleting the registered texture (the scene's release, `deleteTexture`) disposes the target, the
// material and the bake. The target is cleared once on allocation (`clearBakeTarget`), so nothing
// samples an unallocated texture, and the pipeline compiles (`compileAsync`, in the bake's target)
// before the first render, so the render doesn't stall a frame.
//
// The render follows the compile at once; the bake queue with its throttle, the scene load's hold
// and the GPU timing are Phase 2's second step (docs/plans/p304_procedural-texture-baker.md).
import * as THREE from 'three/webgpu';
import { array, float, mrt, uniform, uv, vec2, vec4, vertexIndex } from 'three/tsl';
import { lwarn } from '../../utils/Logger';
import { IS_DEBUG_ENV } from '../config/Config';
import { deleteTexture, doesTextureExist, getTexture, saveTexture } from '../assets/Texture';
import { clearBakeTarget, getBakeRenderer, withBakeRendererState } from './BakeRenderer';
import { runCompileAsync } from './CompileQueue';
import { getBakedTextureMemoryBytes, getBakeSize, type BakeOutputType } from './TextureBakeMemory';

/** One texture a bake writes. */
export type BakeOutput = {
  /** The output's name: its texture is registered as `<id>.<name>` and found in
   * `BakedTexture.textures` under it. */
  name: string;
  /** The graph writing it, a vec4 (three converts a float or vec3 to one, a float to all four
   * channels). Optional when the bake's `build` returns a node for the name. */
  node?: THREE.Node;
  /** `SRGB`: colour, encoded to sRGB on write and decoded on sample (needs `UNSIGNED_BYTE`).
   * `LINEAR`: data or HDR, written as it is. Default `LINEAR`. */
  colorSpace?: 'SRGB' | 'LINEAR';
  /** The texel type. Default `UNSIGNED_BYTE`. */
  type?: BakeOutputType;
};

/** What a bake's `build` gets: the nodes a graph reads to know which texel it writes. */
export type BakeBuildContext = {
  /** The texel's centre in 0..1, (0, 0) the texture's first texel: a material sampling the baked
   * texture at a uv reads what the graph wrote at the same uv. */
  uv: THREE.Node<'vec2'>;
  /** The array layer being written, an int (0 for a 2D bake): the graph is built once and
   * renders every layer. */
  layer: THREE.Node<'int'>;
  /** One texel's size in uv, `1 / width` and `1 / height` (central differences, ring taps). */
  texel: THREE.Node<'vec2'>;
};

/** What {@link bakeTexture} bakes. */
export type BakeTextureOpts = {
  /** The bake's id: each output's texture is registered as `<id>.<name>`. */
  id: string;
  /** Width and height in texels, one number for a square. A power of two is recommended (mips,
   * the KTX2 export). */
  size: number | [number, number];
  /** The textures it writes, 1 to 4 (several are one MRT render), each named once. */
  outputs: BakeOutput[];
  /** Array layers, 1 to 256 (default 1). More than one makes each output an array texture (sample
   * it with `sampleArrayLayer`), every layer rendered by the same graph, which reads the layer from
   * `build`'s `layer`. */
  layers?: number;
  /** The graphs by output name, for the outputs without a `node`, built once from the bake's
   * context (the texel's uv, layer and size). */
  build?: (ctx: BakeBuildContext) => Record<string, THREE.Node>;
  /** A full mip chain, generated after the render. Default true. */
  mipmaps?: boolean;
  /** `REPEAT` for a tiling texture (its graph must tile too), `CLAMP` for the edges. Default
   * `REPEAT`. */
  wrap?: 'REPEAT' | 'CLAMP';
  /** The textures' anisotropic filtering, or `MAX` for the renderer's largest. Default 1. */
  anisotropy?: number | 'MAX';
  /** Never released with its scene. */
  isPersistent?: boolean;
};

/** A bake's textures and its controls, from {@link bakeTexture}. */
export type BakedTexture = {
  /** The bake's id. */
  readonly id: string;
  /** Each output's texture by name, registered as `<id>.<name>`: an array texture when the bake
   * has layers. */
  readonly textures: Readonly<Record<string, THREE.Texture>>;
  /** The GPU memory of every output with its mips, in bytes (see
   * {@link getBakedTextureMemoryBytes}). */
  readonly memoryBytes: number;
  /** Renders the graph again (every layer), with its uniforms' current values (set them first),
   * into the same textures. Resolves once rendered; a no-op after `dispose`. A call while the first
   * bake is still compiling waits for it (that bake reads the latest values). */
  rebake: () => Promise<void>;
  /** Whether the bake is disposed (by `dispose` or its texture's deletion). */
  isDisposed: () => boolean;
  /** Deletes the textures from the registry and frees the target and the material. Idempotent. A
   * bake still compiling then never renders. */
  dispose: () => void;
};

type BakeState = {
  id: string;
  target: THREE.RenderTarget;
  /** `BakeBuildContext.layer`: set before each layer's render. */
  layerNode: THREE.UniformNode<'int', number>;
  quad: THREE.QuadMesh;
  material: THREE.NodeMaterial;
  registered: [string, THREE.Texture][];
  onTextureDispose: (event: { target: THREE.Texture }) => void;
  isDisposed: boolean;
  /** The first bake's compile and render; settled once rendered or disposed. */
  ready: Promise<BakedTexture>;
  handle: BakedTexture;
};

/** The live bakes by id: a second `bakeTexture` of an id returns its bake. */
const bakes = new Map<string, BakeState>();

/** WebGPU's default `maxColorAttachmentBytesPerSample` is 32, and an RGBA8 attachment counts 8
 * bytes there like an RGBA16F one (its render target pixel byte cost), so 4 outputs of any type. */
const MAX_OUTPUTS = 4;
/** WebGPU's default `maxTextureArrayLayers`, and WebGL 2's minimum `MAX_ARRAY_TEXTURE_LAYERS`. */
const MAX_LAYERS = 256;

const createFullScreenVertexNode = () =>
  // three's QuadMesh triangle: it sets its own on `render()`, which the compile wouldn't see
  vec4(
    array([float(-1), float(-1), float(3)]).element(vertexIndex),
    array([float(3), float(-1), float(-1)]).element(vertexIndex),
    0,
    1
  );

const resolveOutputNodes = (opts: BakeTextureOpts, ctx: BakeBuildContext) => {
  const built = opts.build?.(ctx) ?? {};
  return opts.outputs.map(({ name, node }) => {
    const resolved = node ?? built[name];
    if (!resolved) {
      throw new Error(
        `bakeTexture: output "${name}" of "${opts.id}" has no node (give it one, or return it from build).`
      );
    }
    return resolved;
  });
};

const validateOpts = (opts: BakeTextureOpts) => {
  const { id, outputs, layers = 1 } = opts;
  if (outputs.length < 1 || outputs.length > MAX_OUTPUTS) {
    throw new Error(
      `bakeTexture: "${id}" has ${outputs.length} outputs; it takes 1 to ${MAX_OUTPUTS}.`
    );
  }
  if (!Number.isInteger(layers) || layers < 1 || layers > MAX_LAYERS) {
    throw new Error(
      `bakeTexture: "${id}" has ${layers} layers; it takes a whole number from 1 to ${MAX_LAYERS}.`
    );
  }
  const names = new Set<string>();
  for (const output of outputs) {
    if (!output.name || names.has(output.name)) {
      throw new Error(
        `bakeTexture: "${id}" has ${output.name ? `two outputs named "${output.name}"` : 'an output without a name'}; each output needs a name of its own.`
      );
    }
    names.add(output.name);
    if (output.colorSpace === 'SRGB' && (output.type ?? 'UNSIGNED_BYTE') !== 'UNSIGNED_BYTE') {
      throw new Error(
        `bakeTexture: output "${output.name}" of "${id}" is SRGB, which needs the UNSIGNED_BYTE type.`
      );
    }
    const textureId = `${id}.${output.name}`;
    if (doesTextureExist(textureId)) {
      throw new Error(
        `bakeTexture: a texture is registered as "${textureId}" already (delete it first, or bake under another id).`
      );
    }
  }
};

// One target for every output (`count`) and layer (`depth`, an array texture past 1). The shared
// options are the target's; each texture gets its output's type, colour space and registry id as
// its name (the MRT key)
const createBakeTarget = (
  renderer: THREE.Renderer,
  opts: BakeTextureOpts,
  width: number,
  height: number
) => {
  const mipmaps = opts.mipmaps ?? true;
  const wrapping =
    (opts.wrap ?? 'REPEAT') === 'REPEAT' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  const target = new THREE.RenderTarget(width, height, {
    count: opts.outputs.length,
    depth: opts.layers ?? 1,
    format: THREE.RGBAFormat,
    magFilter: THREE.LinearFilter,
    minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
    wrapS: wrapping,
    wrapT: wrapping,
    generateMipmaps: mipmaps,
    anisotropy: opts.anisotropy === 'MAX' ? renderer.getMaxAnisotropy() : opts.anisotropy ?? 1,
    depthBuffer: false,
  });
  opts.outputs.forEach((output, i) => {
    const texture = target.textures[i];
    texture.type = output.type === 'HALF_FLOAT' ? THREE.HalfFloatType : THREE.UnsignedByteType;
    texture.colorSpace = output.colorSpace === 'SRGB' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.name = `${opts.id}.${output.name}`;
  });
  return target;
};

// One output writes the node as it is; several write `mrt()` keyed by the target's texture names
// (three's `MRTNode` finds each output's attachment by its texture's name)
const createOutputNode = (target: THREE.RenderTarget, nodes: THREE.Node[]) => {
  if (nodes.length === 1) return nodes[0];
  const outputs: Record<string, THREE.Node> = {};
  nodes.forEach((node, i) => {
    outputs[target.textures[i].name] = node;
  });
  return mrt(outputs);
};

const createBakeMaterial = (id: string, node: THREE.Node) => {
  const material = new THREE.NodeMaterial();
  material.name = `TextureBaker.${id}`;
  material.blending = THREE.NoBlending;
  material.depthTest = false;
  material.depthWrite = false;
  material.fog = false;
  material.vertexNode = createFullScreenVertexNode();
  material.fragmentNode = node;
  return material;
};

// The mips are generated after every render into a mipped target (WebGPU's `finishRender`, the
// WebGL backend's), every layer's at once: off until the last render, so they're built once
// (three r187, #34630)
const setMipmapsAutoUpdate = (target: THREE.RenderTarget, isOn: boolean) => {
  for (const texture of target.textures) texture.mipmapsAutoUpdate = isOn;
};

// Clears every layer once on allocation (`clearBakeTarget`, the clear-once rule), the mips left
// for the first bake
const clearBake = (renderer: THREE.Renderer, state: BakeState) => {
  const layers = state.target.depth;
  setMipmapsAutoUpdate(state.target, false);
  try {
    withBakeRendererState(renderer, () => {
      for (let layer = 0; layer < layers; layer++) clearBakeTarget(renderer, state.target, layer);
    });
  } finally {
    setMipmapsAutoUpdate(state.target, true);
  }
};

const renderBake = (renderer: THREE.Renderer, state: BakeState) => {
  const { target, layerNode, quad } = state;
  const layers = target.depth;
  try {
    withBakeRendererState(renderer, () => {
      renderer.autoClear = false;
      for (let layer = 0; layer < layers; layer++) {
        setMipmapsAutoUpdate(target, layer === layers - 1);
        layerNode.value = layer;
        renderer.setRenderTarget(target, layer);
        renderer.render(quad, quad.camera);
      }
    });
  } finally {
    setMipmapsAutoUpdate(target, true);
  }
};

// Compiles in the bake's target (the build reads the target's colour space and type), one engine
// compile at a time (`runCompileAsync`, the renderer state trap in kernel/render/CLAUDE.md)
const compileBakeAsync = (renderer: THREE.Renderer, state: BakeState) =>
  runCompileAsync(async () => {
    if (state.isDisposed) return;
    const prevTarget = renderer.getRenderTarget();
    const prevFace = renderer.getActiveCubeFace();
    const prevLevel = renderer.getActiveMipmapLevel();
    const prevMRT = renderer.getMRT() as THREE.MRTNode | null;
    renderer.setRenderTarget(state.target);
    renderer.setMRT(null);
    try {
      await renderer.compileAsync(state.quad, state.quad.camera);
    } finally {
      renderer.setRenderTarget(prevTarget, prevFace, prevLevel);
      renderer.setMRT(prevMRT);
    }
  });

// One owner frees everything once: `dispose`, or the registered texture's deletion (`skip`, which
// is being disposed already)
const disposeBake = (state: BakeState, skip?: THREE.Texture) => {
  if (state.isDisposed) return;
  state.isDisposed = true;
  if (bakes.get(state.id) === state) bakes.delete(state.id);
  for (const [textureId, texture] of state.registered) {
    texture.removeEventListener('dispose', state.onTextureDispose);
    if (texture !== skip && getTexture(textureId) === texture) deleteTexture(textureId);
  }
  // three (r186, r187) destroys a target's GPU textures with the target, never through
  // texture.dispose()
  state.target.dispose();
  state.material.dispose();
};

/**
 * Bakes a TSL node graph into a registered, mipmapped texture: the graph runs once per texel
 * instead of every frame for every pixel it covers. The texture is `<id>.<name>` in the texture
 * registry (`getTexture`), owned by the scene loading (or current) unless `isPersistent`, and
 * deleting it (the scene's release, `deleteTexture`) disposes the bake.
 *
 * The texture exists (cleared to transparent black) as soon as this returns its promise, so a
 * material can take it at once; the promise resolves once the pipeline has compiled and the graph
 * has rendered. Change the graph's uniforms and call `rebake()` to render it again.
 *
 * The baked textures are uncompressed (see {@link getBakedTextureMemoryBytes}), and their content
 * is visual only: GPUs differ in float precision, so never derive gameplay or colliders from it.
 * @param opts the bake: its id, size, outputs and graph
 * @returns the bake, once rendered (or disposed meanwhile)
 * @remarks Needs an initialized renderer (after `InitEngine`), and throws before. A call with the
 * id of a bake that's alive returns that bake, its options ignored (the debug env warns): dispose
 * it first, or `rebake` it. A texture registered under an output's id by anything else throws.
 * @example
 * ```ts
 * import { floor, mod, vec4 } from 'three/tsl';
 * import { bakeTexture, createMaterial } from 'aekasha';
 *
 * const baked = await bakeTexture({
 *   id: 'checker',
 *   size: 256,
 *   outputs: [{ name: 'albedo', colorSpace: 'SRGB' }],
 *   build: ({ uv }) => {
 *     const cell = floor(uv.mul(8));
 *     const isOdd = mod(cell.x.add(cell.y), 2);
 *     return { albedo: vec4(isOdd.mul(0.8).add(0.1), isOdd.mul(0.8).add(0.1), 0.2, 1) };
 *   },
 * });
 * const material = createMaterial({
 *   id: 'checkerMat',
 *   type: 'STANDARD',
 *   params: { map: baked.textures.albedo },
 * });
 * ```
 * @example
 * Two outputs (one MRT render) and four layers, sampled with `sampleArrayLayer`:
 * ```ts
 * import * as THREE from 'three/webgpu';
 * import { float, sin, uv, vec4 } from 'three/tsl';
 * import { bakeTexture, sampleArrayLayer } from 'aekasha';
 *
 * const { textures } = await bakeTexture({
 *   id: 'waves',
 *   size: 512,
 *   layers: 4,
 *   outputs: [{ name: 'albedo', colorSpace: 'SRGB' }, { name: 'height' }],
 *   build: ({ uv: texelUv, layer }) => {
 *     const height = sin(texelUv.x.mul(float(layer).add(1).mul(12.566))).mul(0.5).add(0.5);
 *     return { albedo: vec4(height, height, 1, 1), height: vec4(height, 0, 0, 1) };
 *   },
 * });
 * const material = new THREE.MeshStandardNodeMaterial();
 * material.colorNode = sampleArrayLayer(textures.albedo, uv() as unknown as THREE.Node<'vec2'>, 2);
 * ```
 */
export const bakeTexture = (opts: BakeTextureOpts): Promise<BakedTexture> => {
  const existing = bakes.get(opts.id);
  if (existing && !existing.isDisposed) {
    if (IS_DEBUG_ENV) {
      lwarn(
        `bakeTexture: "${opts.id}" is baked already, so that bake is returned and these options are ignored (dispose it first, or rebake it).`
      );
    }
    return existing.ready;
  }
  const renderer = getBakeRenderer('bakeTexture');
  validateOpts(opts);
  const { width, height } = getBakeSize(opts.size, 'bakeTexture');
  const layerNode = uniform(0, 'int') as THREE.UniformNode<'int', number>;
  const ctx: BakeBuildContext = {
    uv: uv() as unknown as THREE.Node<'vec2'>,
    layer: layerNode as unknown as THREE.Node<'int'>,
    texel: vec2(1 / width, 1 / height) as unknown as THREE.Node<'vec2'>,
  };
  const nodes = resolveOutputNodes(opts, ctx);

  const target = createBakeTarget(renderer, opts, width, height);
  const material = createBakeMaterial(opts.id, createOutputNode(target, nodes));
  const quad = new THREE.QuadMesh(material);
  quad.name = `TextureBaker.${opts.id}`;
  quad.frustumCulled = false;

  const textures: Record<string, THREE.Texture> = {};
  const state = {
    id: opts.id,
    target,
    layerNode,
    quad,
    material,
    registered: [],
    isDisposed: false,
    onTextureDispose: (event: { target: THREE.Texture }) => disposeBake(state, event.target),
  } as unknown as BakeState;
  state.handle = {
    id: opts.id,
    textures,
    memoryBytes: getBakedTextureMemoryBytes({
      size: [width, height],
      outputs: opts.outputs,
      layers: opts.layers,
      mipmaps: opts.mipmaps,
    }),
    rebake: async () => {
      await state.ready;
      if (!state.isDisposed) renderBake(renderer, state);
    },
    isDisposed: () => state.isDisposed,
    dispose: () => disposeBake(state),
  };

  // Registered before the first await, so the scene loading now owns them
  opts.outputs.forEach(({ name }, i) => {
    const texture = target.textures[i];
    const textureId = `${opts.id}.${name}`;
    textures[name] = saveTexture(texture, textureId, opts.isPersistent);
    state.registered.push([textureId, texture]);
    texture.addEventListener('dispose', state.onTextureDispose);
  });
  bakes.set(opts.id, state);

  try {
    clearBake(renderer, state);
  } catch (err) {
    disposeBake(state);
    throw err;
  }

  state.ready = (async () => {
    try {
      await compileBakeAsync(renderer, state);
    } catch (err) {
      disposeBake(state);
      throw err;
    }
    // Disposed meanwhile (`dispose`, or the scene released the texture): nothing to render
    if (!state.isDisposed) renderBake(renderer, state);
    return state.handle;
  })();
  return state.ready;
};
