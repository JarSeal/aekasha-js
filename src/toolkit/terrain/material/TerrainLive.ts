// The terrain material's live layers (p305 Phase 8, D1's `source: 'PROCEDURAL_LIVE'`): a layer
// whose procedural set's generator runs in the material (p304's live mode) instead of sampling
// the set's bake. The layer's input is the set's `{ textureSet }` bundle as for a sampled layer
// (its uniforms the layer's params; the bake, which the scene makes as for any material naming the
// set, is what a tier samples instead); its generator comes through the engine
// (`getTextureSetOfInput`, `getTextureSetGenerator`), loaded by the set's bake or by code first.
// The generator's params and seed are uniforms of the layer, shared by every point it's built at
// (each projection plane builds the whole graph again). Its sample is shaped as the material's
// packing shapes a sampled one: `FULL`'s AO apart (1 without a cavity), `LITE`'s and `MINIMAL`'s
// in the albedo. Its normal, where the generator gives none: `TAPS` a bake's central differences,
// else the layer's bump of its height (`MINIMAL` always: its layers bump together), which a branch
// can't take (no derivatives there): in the far branch, two taps at the UV's gradients.
import { float, max, min, select, vec2, vec3 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node, NodeMaterial } from 'three/webgpu';
import {
  getTextureSetGenerator,
  getTextureSetOfInput,
  type TextureSetDef,
  type TextureSetInput,
  type TextureSetPacking,
} from 'aekasha/texturesets';
import type { LayerSampler } from '../nodes/AntiTiling';
import { heightToCavity, heightToNormal, type HeightFunction } from '../nodes/noise/HeightMaps';
import type { TextureSetSample } from '../nodes/SampleTextureSet';
import {
  prepareSurfaceGraph,
  type PreparedSurfaceGraph,
  type SurfaceGenerator,
} from '../procedural/SurfaceGenerator';
import type { TerrainLiveDefine } from './TerrainDefine';
import { keepUniform } from './TerrainLayers';

/** The Jacobian's floor: a UV whose gradients are parallel (edge-on) has no footprint */
const FOOTPRINT_DET_FLOOR = 1e-12;

/** A live layer's set and its generator, as its input gives them */
export type LiveLayerSource = {
  set: TextureSetDef & { procedural: NonNullable<TextureSetDef['procedural']> };
  generator: SurfaceGenerator;
};

/**
 * A live layer's set and generator from its `{ textureSet }` input: the set must be procedural
 * and its generator loaded and a toolkit one (`build`).
 * @internal
 * @param bundle the layer's input as resolved
 * @param key the input's key, for an error
 * @throws for an input the `textureSets()` feature didn't resolve, a set that isn't procedural, a
 * generator that isn't loaded, or one without `build`
 */
export const readLiveSource = (bundle: TextureSetInput, key: string): LiveLayerSource => {
  const where = `[terrain] Input "${key}" (a live layer, source PROCEDURAL_LIVE)`;
  const set = getTextureSetOfInput(bundle);
  if (!set) {
    throw new Error(`${where} isn't a { "textureSet": id } input the textureSets() feature made.`);
  }
  const { procedural } = set;
  if (!procedural) {
    throw new Error(
      `${where}: the texture set "${set.id}" isn't procedural; a live layer runs its set's generator (a set JSON with "procedural").`
    );
  }
  const generatorId = procedural.generator;
  const generator = getTextureSetGenerator(generatorId);
  if (!generator) {
    throw new Error(
      `${where}: the generator "${generatorId}" of the texture set "${set.id}" isn't loaded. A scene that lists the set or names it in a material bakes it, which loads it; from code, await loadTextureSetAsync("${set.id}") or loadTextureSetGeneratorAsync("${generatorId}") (aekasha/texturesets) before creating the material.`
    );
  }
  if (typeof (generator as Partial<SurfaceGenerator>).build !== 'function') {
    throw new Error(
      `${where}: the generator "${generatorId}" has no build: only a toolkit generator (defineSurfaceGenerator's) runs live.`
    );
  }
  return {
    set: set as LiveLayerSource['set'],
    generator: generator as unknown as SurfaceGenerator,
  };
};

/**
 * A live layer prepared for a material: its generator's surface over the uniforms of its params
 * and seed (`terrain_l<i>_live_<param>`, `terrain_l<i>_live_seed`).
 * @internal
 */
export type LiveLayer = {
  source: LiveLayerSource;
  settings: TerrainLiveDefine;
  prepared: PreparedSurfaceGraph<SurfaceGenerator['params']>;
};

/**
 * Prepares a live layer: its generator at its set's values (params, seed, `physicalSize`,
 * `heightScale`), the uniforms kept at `userData.uniforms.terrain_l<i>_live_<param>` (the numbers
 * and colours; a static param or toggle is the graph's) and `terrain_l<i>_live_seed`.
 * @internal
 * @throws for a param or value the generator refuses (the set's JSON)
 */
export const createLiveLayer = (
  material: NodeMaterial,
  index: number,
  source: LiveLayerSource,
  settings: TerrainLiveDefine
): LiveLayer => {
  const { set, generator } = source;
  const prepared = prepareSurfaceGraph(generator, {
    isLive: true,
    params: set.procedural.params as never,
    seed: set.procedural.seed,
    physicalSize: set.physicalSize,
    heightScale: set.heightScale,
  });
  const keep = (name: string, node: unknown) =>
    keepUniform(material, `l${index}_live_${name}`, node);
  keep('seed', prepared.seed);
  for (const [name, node] of Object.entries(prepared.params.nodes as Record<string, unknown>)) {
    if (typeof node === 'object') keep(name, node);
  }
  return { source, settings, prepared };
};

/** A UV's screen-space gradients */
type UvGradients = { dx: Node<'vec2'>; dy: Node<'vec2'> };

/**
 * The tangent normal from two taps at the UV's screen-space gradients: the height's screen
 * differences through the UV's Jacobian back into UV slopes, × the relief over the tile (what the
 * layer's bump of its height gives, without a derivative)
 */
const getFootprintNormal = (
  heightAt: HeightFunction,
  uv: Node<'vec2'>,
  height: Node<'float'>,
  grad: UvGradients,
  slopeScale: Node<'vec2'>
) => {
  const { dx, dy } = grad;
  const hx = heightAt(uv.add(dx) as Node<'vec2'>).sub(height);
  const hy = heightAt(uv.add(dy) as Node<'vec2'>).sub(height);
  const det = dx.x.mul(dy.y).sub(dx.y.mul(dy.x));
  const safe = select(
    det.lessThan(0),
    min(det, -FOOTPRINT_DET_FLOOR),
    max(det, FOOTPRINT_DET_FLOOR)
  );
  const slopeU = hx.mul(dy.y).sub(hy.mul(dx.y)).div(safe);
  const slopeV = hy.mul(dx.x).sub(hx.mul(dy.x)).div(safe);
  return vec3(
    slopeU.mul(slopeScale.x).negate(),
    slopeV.mul(slopeScale.y).negate(),
    1
  ).normalize() as unknown as Node<'vec3'>;
};

/** How a layer's samples of a live layer are shaped */
export type LiveSamplerOpts = {
  /** The material's packing: where the AO goes, and whether the layers bump (`MINIMAL`) */
  packing: TextureSetPacking;
  /** The layer's tile in metres (the set's `physicalSize` × its tiling): the footprint's slopes */
  tileSize: Node<'vec2'>;
  /** The set's `heightScale` (its bundle's uniform) */
  heightScale: Node<'float'>;
  /**
   * The layer is built in a branch (the far surface's), where no derivative is taken: a bumped
   * normal comes from two taps at the UV's gradients instead
   */
  isInBranch: boolean;
};

/**
 * A live layer as a sampler: each sample its generator's whole graph at the UV (a plane's, the
 * layer's), shaped as the packing shapes a sampled one. The normal, where the generator gives
 * none: `TAPS` 4 more height evaluations; else null for the layer's bump of its height, or in a
 * branch (`LITE`, `FULL`) the footprint's 2 taps; `MINIMAL` always null (its layers bump
 * together). The AO, where the generator gives none: `CAVITY` 8 more height evaluations, `FULL`
 * apart (1 without), else in the albedo.
 * @internal
 */
export const createLiveSampler = (layer: LiveLayer, opts: LiveSamplerOpts): LayerSampler => {
  const { prepared, settings, source } = layer;
  const [width] = prepared.physicalSize;
  const isFull = opts.packing === 'FULL';
  const hasNormalMaps = opts.packing !== 'MINIMAL';
  const slopeScale = vec2(opts.heightScale, opts.heightScale).div(
    opts.tileSize
  ) as unknown as Node<'vec2'>;
  return {
    isLayerSampler: true,
    sample: (uv, grad): TextureSetSample => {
      const { surface, ctx } = prepared.surfaceAt(uv);
      // The taps' height; the point's own is the surface's
      const tapHeight: HeightFunction = (at) =>
        at === uv ? surface.height : prepared.heightAt(at);
      let normalTS: Node<'vec3'> | null = null;
      if (hasNormalMaps) {
        if (surface.normal) normalTS = surface.normal;
        else if (settings.normal === 'TAPS') {
          normalTS = heightToNormal(tapHeight, {
            uv,
            texel: ctx.texel,
            heightScale: prepared.heightScale / width,
          });
        } else if (opts.isInBranch) {
          if (!grad) throw new Error('[terrain] A live layer in a branch samples with gradients.');
          normalTS = getFootprintNormal(tapHeight, uv, surface.height, grad, slopeScale);
        }
      }
      const cavity =
        surface.ao ??
        (settings.ao === 'CAVITY'
          ? heightToCavity(tapHeight, {
              uv,
              radius: source.generator.cavity.radius / width,
              strength: source.generator.cavity.strength,
            })
          : null);
      return {
        packing: opts.packing,
        albedo: cavity && !isFull ? (surface.albedo.mul(cavity) as Node<'vec3'>) : surface.albedo,
        normalTS,
        roughness: surface.roughness,
        ao: isFull ? cavity ?? (float(1) as unknown as Node<'float'>) : null,
        isAoBaked: !isFull,
        height: surface.height,
      };
    },
  };
};
