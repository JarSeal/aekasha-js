// The texture baker (p304 D1): a TSL node graph rendered once into a mipmapped render target that
// is then sampled like any texture, so a material pays one fetch a pixel instead of the graph's
// noise maths every frame.
//
// A bake is a full-screen triangle (three's `QuadMesh`) whose material's `fragmentNode` is the
// graph, rendered into a target that is registered as a texture per output (`<id>.<name>`) and
// owned like any other: released with the scene loading it (or current), unless persistent.
// Deleting the registered texture (the scene's release, `deleteTexture`) disposes the target, the
// material and the bake. The target is cleared once on allocation (`clearBakeTarget`), so nothing
// samples an unallocated texture, and the pipeline compiles (`compileAsync`, in the bake's target)
// before the first render, so the render doesn't stall a frame.
//
// Phase 1: one output and one layer; the render follows the compile at once. Several outputs
// (MRT), array layers, the bake queue with its throttle, the scene load's hold and the GPU timing
// are Phase 2 (docs/plans/p304_procedural-texture-baker.md).
import * as THREE from 'three/webgpu';
import { array, float, uniform, uv, vec2, vec4, vertexIndex } from 'three/tsl';
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
  /** The array layer being written (an int; 0 for a 2D bake). */
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
  /** The textures it writes. One output for now (several, MRT, come with the bake queue). */
  outputs: BakeOutput[];
  /** Array layers. 1 for now (more come with the bake queue). */
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
  /** Each output's texture by name, registered as `<id>.<name>`. */
  readonly textures: Readonly<Record<string, THREE.Texture>>;
  /** The GPU memory of every output with its mips, in bytes (see
   * {@link getBakedTextureMemoryBytes}). */
  readonly memoryBytes: number;
  /** Renders the graph again, with its uniforms' current values (set them first), into the same
   * textures. Resolves once rendered; a no-op after `dispose`. A call while the first bake is still
   * compiling waits for it (that bake reads the latest values). */
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
  if (outputs.length !== 1) {
    throw new Error(
      `bakeTexture: "${id}" has ${outputs.length} outputs; one is supported for now.`
    );
  }
  if (layers !== 1) {
    throw new Error(`bakeTexture: "${id}" has ${layers} layers; one is supported for now.`);
  }
  for (const output of outputs) {
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

const createBakeTarget = (
  renderer: THREE.Renderer,
  opts: BakeTextureOpts,
  width: number,
  height: number
) => {
  const output = opts.outputs[0];
  const mipmaps = opts.mipmaps ?? true;
  const wrapping =
    (opts.wrap ?? 'REPEAT') === 'REPEAT' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  const target = new THREE.RenderTarget(width, height, {
    type: output.type === 'HALF_FLOAT' ? THREE.HalfFloatType : THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    colorSpace: output.colorSpace === 'SRGB' ? THREE.SRGBColorSpace : THREE.NoColorSpace,
    magFilter: THREE.LinearFilter,
    minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
    wrapS: wrapping,
    wrapT: wrapping,
    generateMipmaps: mipmaps,
    anisotropy: opts.anisotropy === 'MAX' ? renderer.getMaxAnisotropy() : opts.anisotropy ?? 1,
    depthBuffer: false,
  });
  target.texture.name = `${opts.id}.${output.name}`;
  return target;
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

const renderBake = (renderer: THREE.Renderer, state: BakeState) => {
  withBakeRendererState(renderer, () => {
    renderer.setRenderTarget(state.target);
    renderer.autoClear = false;
    renderer.render(state.quad, state.quad.camera);
  });
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
  const ctx: BakeBuildContext = {
    uv: uv() as unknown as THREE.Node<'vec2'>,
    layer: uniform(0, 'int') as unknown as THREE.Node<'int'>,
    texel: vec2(1 / width, 1 / height) as unknown as THREE.Node<'vec2'>,
  };
  const nodes = resolveOutputNodes(opts, ctx);

  const target = createBakeTarget(renderer, opts, width, height);
  const material = createBakeMaterial(opts.id, nodes[0]);
  const quad = new THREE.QuadMesh(material);
  quad.name = `TextureBaker.${opts.id}`;
  quad.frustumCulled = false;

  const textures: Record<string, THREE.Texture> = {};
  const state = {
    id: opts.id,
    target,
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

  // Registered before the first await, so the scene loading now owns it
  const { name } = opts.outputs[0];
  const textureId = `${opts.id}.${name}`;
  textures[name] = saveTexture(target.texture, textureId, opts.isPersistent);
  state.registered.push([textureId, target.texture]);
  target.texture.addEventListener('dispose', state.onTextureDispose);
  bakes.set(opts.id, state);

  try {
    withBakeRendererState(renderer, () => clearBakeTarget(renderer, target));
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
