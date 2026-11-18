// The in-engine colour-map bake (p305 D7): a block's terrain material's albedo baked into a texture
// at the block mesh's UV, for its `colorMap` (`DETAIL`: unique large-scale colour under the layers'
// detail; `FAR_ONLY`: the far surface). The engine's `bakeTexture` draws the mesh in its UV space
// (its `mesh` option), so a texel holds the material's colour at the surface point its UV maps to,
// for any UV layout (a generated block's planar one, an authored block's). The colour is the
// material's own graph built again from the inputs it was built from, without what depends on the
// camera or would read the bake itself: no distance effects (the far surface, the normals' fade),
// no colour map, no debug view, no wet response (p307: the dry surface), and the view distance 0
// (the anti-tiling's near look).
import { float, vec4 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import {
  MeshStandardNodeMaterial,
  type Material,
  type Mesh,
  type Node,
  type NodeMaterial,
} from 'three/webgpu';
import { bakeTexture, type BakedTexture } from 'aekasha';
import { readTerrainDefine } from './TerrainDefine';
import { buildTerrainGraph, getTerrainMaterialInputs } from './TerrainMaterial';

/** The bake's default size, texels */
const DEFAULT_SIZE = 1024;
/** The bake's output: its texture is `<id>.color` */
const OUTPUT = 'color';

/** What {@link bakeTerrainColorMap} bakes. */
export type BakeTerrainColorMapOpts = {
  /** The bake's id: its texture is registered as `<id>.color`. */
  id: string;
  /** The block: its geometry (with a `uv` attribute, the colour map's) and its world placement. */
  mesh: Mesh;
  /** The terrain material whose colour it bakes (default: the mesh's own, a single material). */
  material?: Material;
  /** Width and height in texels, one number for a square (default 1024). */
  size?: number | [number, number];
  /**
   * Multiplies the material's AO (its `aoNode`: the vertex AO, `FULL`'s texture AO) into the
   * colour, so the colour map carries the large-scale occlusion (default false). A material reading
   * the colour map then applies its own AO again: bake it, or keep it, not both.
   */
  ao?: boolean;
  /** Never released with its scene. */
  isPersistent?: boolean;
};

/**
 * A define without what the bake can't take: the distance effects, the colour map, a debug view,
 * and the wet response (the bake is of the dry surface: the weather at the bake's moment would
 * stay in the colour)
 */
const getBakeDefine = (define: Record<string, unknown>) => {
  const {
    distance: _distance,
    colorMap: _colorMap,
    debugView: _debugView,
    wet: _wet,
    quality,
    ...rest
  } = define;
  if (!quality) return rest;
  // A tier's distance would bring the far surface back, its wet the weather
  const tiers = Object.entries(quality as Record<string, Record<string, unknown> | undefined>).map(
    ([level, tier]) => {
      const { distance: _tierDistance, wet: _tierWet, ...fields } = tier ?? {};
      return [level, fields];
    }
  );
  return { ...rest, quality: Object.fromEntries(tiers) };
};

/** The terrain material's inputs and define, or a thrown error naming what's missing */
const getTerrainSource = (opts: BakeTerrainColorMapOpts) => {
  const material = opts.material ?? opts.mesh.material;
  if (Array.isArray(material)) {
    throw new Error(
      `[terrain] bakeTerrainColorMap "${opts.id}": the mesh has several materials; pass the terrain one (material).`
    );
  }
  const inputs = getTerrainMaterialInputs(material as NodeMaterial);
  const define = material.userData.terrainDefine as Record<string, unknown> | undefined;
  if (!inputs || !define) {
    throw new Error(
      `[terrain] bakeTerrainColorMap "${opts.id}": material "${material.name}" isn't a terrain material (createTerrainMaterial's or the JSON route's).`
    );
  }
  return { inputs, define };
};

/**
 * Bakes a terrain material's colour on a block into a texture at the block's UV (p305 D7), for the
 * block's colour map: `colorMap: { mode: 'DETAIL' }` puts it under the layers' detail (unique
 * large-scale colour, one fetch), `FAR_ONLY` makes it the far surface. The texture is
 * `<id>.color` (sRGB, mipmapped, clamped at the edges), owned by the scene loading or current
 * unless `isPersistent`; export it with `exportBakedTexture({ id, output: 'color', dir })` (debug
 * env), then encode and commit it per block. The colour is the material's graph without its
 * distance effects, colour map, debug view and wetness (the dry surface), at its near look (the
 * view distance 0), its tier the material's; its uniforms are copies taken now, so `rebake()`
 * doesn't follow the material's later edits (bake again). The mesh's triangles are drawn at their UVs: a texel no triangle covers
 * stays transparent black.
 * @param opts the bake's id, the block mesh, the material, the size and whether to bake the AO in
 * @returns the bake (`bakeTexture`'s), once rendered
 * @throws for a material that isn't a terrain material, a mesh with several materials and none
 * given, or a geometry without a `uv` attribute
 * @example
 * ```ts
 * import { getMeshByAppId } from 'aekasha';
 * import { bakeTerrainColorMap, createTerrainMaterial } from 'aekasha/toolkit/terrain';
 *
 * const block = getMeshByAppId('valleyBlock');
 * if (block) {
 *   // The block's own material, its colour into valley.color at the block's UV
 *   const baked = await bakeTerrainColorMap({ id: 'valley', mesh: block, size: 1024 });
 *   const detailed = createTerrainMaterial({
 *     id: 'valleyDetail',
 *     layers: [{ set: 'grass01' }, { set: 'rocks01' }],
 *     blend: { source: 'VERTEX_COLOR' },
 *     colorMap: { mode: 'DETAIL', texture: `${baked.id}.color` },
 *   });
 * }
 * ```
 */
export const bakeTerrainColorMap = (opts: BakeTerrainColorMapOpts): Promise<BakedTexture> => {
  const { inputs, define } = getTerrainSource(opts);
  const bakeDefine = getBakeDefine(define);
  // The colour map's input, the ripple atlas, the snow set, and the macro texture's when only the
  // wet response's puddle patches or streaks read it: the define without them refuses them
  const { colorMap: _colorMap, ripples: _ripples, snow: _snow, macro, ...rest } = inputs;
  const takesMacro = readTerrainDefine({ terrain: bakeDefine }).takesMacroTexture;
  const bakeInputs = takesMacro && macro !== undefined ? { ...rest, macro } : rest;
  const graph = new MeshStandardNodeMaterial();
  buildTerrainGraph(
    bakeInputs,
    graph,
    { terrain: bakeDefine },
    { viewDistance: float(0) as unknown as Node<'float'> }
  );
  const albedo = graph.colorNode as unknown as Node<'vec3'>;
  const ao = opts.ao ? (graph.aoNode as unknown as Node<'float'> | null) : null;
  const color = ao ? (albedo.mul(ao) as Node<'vec3'>) : albedo;
  opts.mesh.updateWorldMatrix(true, false);
  return bakeTexture({
    id: opts.id,
    size: opts.size ?? DEFAULT_SIZE,
    outputs: [{ name: OUTPUT, colorSpace: 'SRGB', node: vec4(color, 1) }],
    wrap: 'CLAMP',
    mesh: { geometry: opts.mesh.geometry, matrixWorld: opts.mesh.matrixWorld },
    isPersistent: opts.isPersistent,
  });
};
