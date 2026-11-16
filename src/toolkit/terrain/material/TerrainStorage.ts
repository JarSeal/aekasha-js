// The terrain material's texture bindings (p305 D9): a stage binds a limited number of sampled
// textures (WebGPU's default 16, which the engine requests; WebGL2's texture units, 16 on most
// GPUs), shared with three's lighting (shadow maps, the environment). `SEPARATE` storage binds
// each layer's packing slots, `ARRAY` one array per slot for all the layers (`{ textureSetArray }`).
// The setup counts what a material binds against the budget (the limit less `reservedTextures`)
// and throws listing it; the code route's `AUTO` picks `ARRAY` when `SEPARATE` would be over.
import { getRenderer } from 'aekasha';

/** The sampled textures a stage binds when the renderer can't say (WebGPU's default) */
const DEFAULT_TEXTURE_LIMIT = 16;

/** Each packing's slots: its textures per layer (`SEPARATE`) or its arrays (`ARRAY`) */
export const TERRAIN_PACKING_SLOTS = {
  FULL: ['albedoHeight', 'normal', 'orm'],
  LITE: ['albedoRough', 'normalHeight'],
  MINIMAL: ['albedoHeight'],
} as const;

/** What a material binds, by group, for the budget and its error */
export type TerrainBinding = { name: string; count: number };

type WebGpuLimits = { maxSampledTexturesPerShaderStage: number; maxSamplersPerShaderStage: number };
type BackendLike = {
  isWebGPUBackend?: boolean;
  device?: { limits: WebGpuLimits };
  gl?: { MAX_TEXTURE_IMAGE_UNITS: number; getParameter: (name: number) => unknown };
};

/**
 * The sampled textures a fragment stage binds on this renderer: WebGPU's device limits (a texture
 * and its sampler each), WebGL2's texture units; 16 before the renderer is ready
 * @internal
 */
export const getTextureBindingLimit = () => {
  const backend = getRenderer()?.backend as BackendLike | undefined;
  const limits = backend?.device?.limits;
  if (backend?.isWebGPUBackend && limits) {
    return Math.min(limits.maxSampledTexturesPerShaderStage, limits.maxSamplersPerShaderStage);
  }
  const units = backend?.gl?.getParameter(backend.gl.MAX_TEXTURE_IMAGE_UNITS);
  return typeof units === 'number' ? units : DEFAULT_TEXTURE_LIMIT;
};

/**
 * The bindings' count, and a description of each group for an error
 * @internal
 */
export const countBindings = (bindings: TerrainBinding[]) =>
  bindings.reduce((total, binding) => total + binding.count, 0);

const describeBindings = (bindings: TerrainBinding[]) =>
  bindings.map((binding) => `${binding.name}: ${binding.count}`).join('; ');

/**
 * Throws when the bindings are over the budget (the renderer's limit less `reserved`), listing
 * what's bound and what helps.
 * @internal
 * @param bindings what the material binds, by group
 * @param reserved the textures kept for the rest of the shader (shadow maps, the environment)
 * @param isArray whether the layers are already one array per slot
 */
export const checkTextureBudget = (
  bindings: TerrainBinding[],
  reserved: number,
  isArray: boolean
) => {
  const limit = getTextureBindingLimit();
  const budget = limit - reserved;
  const count = countBindings(bindings);
  if (count <= budget) return;
  const help = isArray
    ? 'fewer splat maps or no macro texture, or a lower reservedTextures if the scene has fewer shadow maps'
    : 'ARRAY storage (one array per slot: a { "textureSetArray": [ids], "packing" } input "layers"), fewer layers or a smaller packing, or a lower reservedTextures';
  throw new Error(
    `[terrain] The material binds ${count} textures, over its budget of ${budget} (${limit} a stage less ${reserved} reserved): ${describeBindings(bindings)}. Try ${help}.`
  );
};

/**
 * The code route's storage for `AUTO`: `SEPARATE` while its bindings fit the budget, else `ARRAY`
 * @internal
 * @param layerSlots each layer's packing slot count
 * @param extra the other textures (splat maps, the macro texture)
 * @param reserved the textures kept for the rest of the shader
 */
export const chooseTerrainStorage = (layerSlots: number[], extra: number, reserved: number) => {
  const separate = layerSlots.reduce((total, slots) => total + slots, 0) + extra;
  return separate <= getTextureBindingLimit() - reserved ? 'SEPARATE' : 'ARRAY';
};
