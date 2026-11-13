/**
 * The streaming cell manifest (p353 §3.1-3.2, Phase 3 D1-D5, Phase 5 D7-D9): a streaming scene's
 * resolved meshes and point and spot lights go into the cells their positions are in (the cells'
 * near content), an oversized mesh into every cell it overlaps (their kept content, loaded from
 * `FAR` in), a cell's mesh gets a far representation (p377 D1-D2: with explicit LOD levels its
 * coarsest level; without `lod` itself, when it groups and `streaming.farEntries` isn't
 * `'LOD_LEVELS'`; a cell's alike ones one instanced group naming its near entries, p377 D3), and
 * the assets only cell content uses
 * move out of the scene's lists with them, into `__streaming`, listed per layer. What stays in the
 * scene's lists is its base, loaded with the scene.
 */
import type {
  StreamingFarMesh,
  StreamingManifest,
  StreamingManifestCell,
  StreamingManifestLayer,
} from '../../src/_engine/schemas';
import { isCellInRange, packCellKey } from '../../src/_engine/utils/CellKey';
import type { GatherContext } from './context';
import type { SceneJSON } from './sceneAssets';

type List<K extends keyof SceneJSON> = NonNullable<SceneJSON[K]>;
type MeshEntry = List<'meshes'>[number];
type LightEntry = List<'lights'>[number];
type AssetKind = 'textures' | 'materials' | 'geometries' | 'importedAssets';

const ASSET_KINDS: readonly AssetKind[] = ['textures', 'materials', 'geometries', 'importedAssets'];
/** The light types with a position that matters (D1): the others light everything */
const CELL_LIGHT_TYPES = new Set(['POINT', 'SPOT']);

type Vec3 = { x?: number; y?: number; z?: number };
type GeoLike = { type?: string; params?: Record<string, unknown> };
/** The ids an entry (or the base) references, per asset kind */
type Refs = Record<AssetKind, Set<string>>;

const createRefs = (): Refs => ({
  textures: new Set(),
  materials: new Set(),
  geometries: new Set(),
  importedAssets: new Set(),
});

const getEntryId = (entry: unknown): string | undefined => {
  if (typeof entry === 'string') return entry;
  const id = (entry as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id : undefined;
};

const num = (value: unknown, fallback: number) => (typeof value === 'number' ? value : fallback);

/**
 * A primitive geometry's bounding sphere radius from its params (three's defaults for those left
 * out), or null for a geometry the gather can't measure.
 */
export const getPrimitiveGeometryRadius = (geo: GeoLike): number | null => {
  const p = geo.params ?? {};
  switch (geo.type) {
    case 'BOX':
      return Math.hypot(num(p.width, 1), num(p.height, 1), num(p.depth, 1)) / 2;
    case 'SPHERE':
      return num(p.radius, 1);
    case 'CYLINDER':
      return Math.hypot(
        Math.max(num(p.radiusTop, 1), num(p.radiusBottom, 1)),
        num(p.height, 1) / 2
      );
    case 'CAPSULE':
      return num(p.radius, 1) + num(p.height, 1) / 2;
    case 'CONE':
      return Math.hypot(num(p.radius, 1), num(p.height, 1) / 2);
    default:
      return null;
  }
};

/** The scene's listed assets by kind: id → its entry's index (entries without an id aren't
 * referable, so they stay base) */
const indexListedAssets = (scene: SceneJSON) => {
  const listed = {} as Record<AssetKind, Map<string, number>>;
  for (const kind of ASSET_KINDS) {
    listed[kind] = new Map();
    (scene[kind] ?? []).forEach((entry, index) => {
      const id = getEntryId(entry);
      if (id !== undefined && typeof entry !== 'string') listed[kind].set(id, index);
    });
  }
  return listed;
};

type Listed = ReturnType<typeof indexListedAssets>;

/** The scene's resolved listed entry of `kind` by id */
const getListedEntry = (scene: SceneJSON, listed: Listed, kind: AssetKind, id: string) => {
  const index = listed[kind].get(id);
  return index === undefined ? undefined : (scene[kind] as unknown[])[index];
};

/** Every listed texture id among `value`'s strings, at any depth: a material's `params`,
 * `inputs` and `nodes` (a texture map key or a TSL input takes a texture id, an object-form
 * texture ref's `texture` too) */
const addTextureRefs = (value: unknown, listed: Listed, refs: Refs) => {
  if (typeof value === 'string') {
    if (listed.textures.has(value)) refs.textures.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) addTextureRefs(item, listed, refs);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) addTextureRefs(item, listed, refs);
  }
};

const addMaterialFieldRefs = (mat: unknown, listed: Listed, refs: Refs) => {
  const { params, inputs, nodes } = (mat ?? {}) as {
    params?: unknown;
    inputs?: unknown;
    nodes?: unknown;
  };
  addTextureRefs(params, listed, refs);
  addTextureRefs(inputs, listed, refs);
  addTextureRefs(nodes, listed, refs);
};

/** A geometry id's references: a listed geometry (a LOD level `<geo>#lod<n>` names its base), or
 * the listed import whose `<id>/<node>` it is; a listed MERGED geometry's parts' too (p371 D2), so
 * they load with it (in the base, or each cell that loads it) */
const addGeometryRef = (
  scene: SceneJSON,
  geoId: string,
  listed: Listed,
  refs: Refs,
  isPart = false
) => {
  const baseId = geoId.replace(/#lod\d+$/, '');
  if (listed.geometries.has(baseId)) {
    refs.geometries.add(baseId);
    const geo = getListedEntry(scene, listed, 'geometries', baseId) as GeoLike | undefined;
    // One level: a MERGED part is a gather error, and two merging each other would never end
    if (geo?.type === 'MERGED' && !isPart) {
      for (const part of (geo.params?.parts ?? []) as { geo: string }[]) {
        addGeometryRef(scene, part.geo, listed, refs, true);
      }
    }
  }
  for (const importId of listed.importedAssets.keys()) {
    if (baseId.startsWith(`${importId}/`)) refs.importedAssets.add(importId);
  }
};

const addMaterialRef = (
  scene: SceneJSON,
  matId: string,
  listed: Listed,
  refs: Refs,
  isBase: boolean
) => {
  if (!listed.materials.has(matId)) return;
  refs.materials.add(matId);
  // A cell material's textures go with it unless the base holds them; a base material's are base
  // (addBaseMaterialRefs adds every material that stays base)
  if (!isBase)
    addMaterialFieldRefs(getListedEntry(scene, listed, 'materials', matId), listed, refs);
};

/** What a mesh entry references: its `geo`, `mat`, `matOverrides` and `lod` levels */
const addMeshRefs = (
  scene: SceneJSON,
  mesh: MeshEntry,
  listed: Listed,
  refs: Refs,
  isBase: boolean
) => {
  if (typeof mesh === 'string') return;
  const props = mesh.props as Record<string, unknown>;
  if (typeof props.geo === 'string') addGeometryRef(scene, props.geo, listed, refs);
  if (typeof props.mat === 'string') addMaterialRef(scene, props.mat, listed, refs, isBase);
  else addMaterialFieldRefs(props.mat, listed, refs);
  addMaterialFieldRefs(props.matOverrides, listed, refs);
  const levels = (props.lod as { levels?: { geo?: unknown; mat?: unknown }[] } | undefined)?.levels;
  for (const level of Array.isArray(levels) ? levels : []) {
    if (typeof level.geo === 'string') addGeometryRef(scene, level.geo, listed, refs);
    if (typeof level.mat === 'string') addMaterialRef(scene, level.mat, listed, refs, isBase);
  }
};

const getMeshAppId = (mesh: MeshEntry) =>
  typeof mesh === 'string' ? mesh : mesh.props.appId ?? mesh.entityOpts?.appId;

const getLightAppId = (light: LightEntry) =>
  typeof light === 'string'
    ? light
    : (light.lightProps as { appId?: string }).appId ?? light.entityOpts?.appId;

/** An entry's half extents on x and z, in metres */
type Extent = { hx: number; hz: number };

const NO_EXTENT: Extent = { hx: 0, hz: 0 };

/** Whether a mesh has no rotation (none given, all zero, or the identity quaternion) */
const isUnrotated = (props: Record<string, unknown>) => {
  const r = props.rotation as Vec3 | undefined;
  const q = props.quaternion as { x?: number; y?: number; z?: number; w?: number } | undefined;
  const isZero = (v: number | undefined) => !v;
  return (
    (!r || (isZero(r.x) && isZero(r.y) && isZero(r.z))) &&
    (!q || (isZero(q.x) && isZero(q.y) && isZero(q.z)))
  );
};

/** A mesh's half extents on x/z: `streaming.radii`'s radius, an unrotated box's own sides (a long
 * wall reaches along its length only), else its primitive geometry's bounding sphere, else a
 * point */
const getMeshExtent = (
  scene: SceneJSON,
  mesh: Exclude<MeshEntry, string>,
  listed: Listed,
  radii: Record<string, number>
): Extent => {
  const appId = getMeshAppId(mesh);
  if (appId !== undefined && radii[appId] !== undefined) {
    return { hx: radii[appId], hz: radii[appId] };
  }
  const geo = mesh.props.geo;
  const geoDef = (
    typeof geo === 'string' ? getListedEntry(scene, listed, 'geometries', geo) : geo
  ) as GeoLike | undefined;
  if (!geoDef) return NO_EXTENT;
  if (geoDef.type === 'BOX' && isUnrotated(mesh.props as Record<string, unknown>)) {
    const p = geoDef.params ?? {};
    return { hx: num(p.width, 1) / 2, hz: num(p.depth, 1) / 2 };
  }
  const radius = getPrimitiveGeometryRadius(geoDef) ?? 0;
  return { hx: radius, hz: radius };
};

/** A cell's far or kept layer while it's built: its meshes and what they reference */
type LayerBuild = { meshes: number[]; refs: Refs };

type CellBuild = {
  cell: StreamingManifestCell;
  /** What its near content references */
  refs: Refs;
  far: LayerBuild & {
    /** Its far groups' indices in the manifest's `farMeshes`, by `getFarGroupKey` */
    groups: Map<string, number>;
  };
  kept: LayerBuild;
};

/** A build's three reference sets: its near, far and kept layers' */
const getBuildRefs = (build: CellBuild) => [build.refs, build.far.refs, build.kept.refs];

/** The streaming settings the runtime reads: the build-time `base`, `radii` and `farEntries`
 * dropped (D3; p377 D2) */
const toRuntimeSettings = (settings: NonNullable<SceneJSON['streaming']>) => {
  const { base, radii, farEntries, ...runtime } = settings;
  return runtime;
};

const getCellBuild = (cells: Map<number, CellBuild>, cellKey: number): CellBuild => {
  let build = cells.get(cellKey);
  if (!build) {
    build = {
      cell: { bounds: [Infinity, Infinity, -Infinity, -Infinity], bytesEstimate: 0 },
      refs: createRefs(),
      far: { meshes: [], refs: createRefs(), groups: new Map() },
      kept: { meshes: [], refs: createRefs() },
    };
    cells.set(cellKey, build);
  }
  return build;
};

const growBounds = (cell: StreamingManifestCell, x: number, z: number, { hx, hz }: Extent) => {
  const b = cell.bounds;
  b[0] = Math.min(b[0], x - hx);
  b[1] = Math.min(b[1], z - hz);
  b[2] = Math.max(b[2], x + hx);
  b[3] = Math.max(b[3], z + hz);
};

const pushIndex = (cell: StreamingManifestCell, key: 'meshes' | 'lights', index: number) => {
  (cell[key] ??= []).push(index);
};

/** Whether an entry is oversized (D4): a half extent over `cellSize / 2`. */
const isOversizedExtent = ({ hx, hz }: Extent, cellSize: number) => Math.max(hx, hz) > cellSize / 2;

/** The cell keys an entry at (x, z) with `extent` goes into: its position's cell, or every cell
 * its box overlaps when it's oversized. Null outside the cell keys' range. */
const getEntryCellKeys = (x: number, z: number, extent: Extent, cellSize: number) => {
  const { hx, hz } = extent;
  const isOversized = isOversizedExtent(extent, cellSize);
  const reachX = isOversized ? hx : 0;
  const reachZ = isOversized ? hz : 0;
  const minCx = Math.floor((x - reachX) / cellSize);
  const maxCx = Math.floor((x + reachX) / cellSize);
  const minCz = Math.floor((z - reachZ) / cellSize);
  const maxCz = Math.floor((z + reachZ) / cellSize);
  if (!isCellInRange(minCx, 0, minCz) || !isCellInRange(maxCx, 0, maxCz)) return null;
  const keys: number[] = [];
  for (let cz = minCz; cz <= maxCz; cz++) {
    for (let cx = minCx; cx <= maxCx; cx++) keys.push(packCellKey(cx, 0, cz));
  }
  return keys;
};

const getVramBytes = (entry: unknown) => {
  const vram = (entry as { __vramBytes?: { out?: unknown } } | undefined)?.__vramBytes;
  return typeof vram?.out === 'number' ? vram.out : 0;
};

type LodLike = { levels?: unknown; cullScreenSize?: unknown; auto?: unknown };
type LevelLike = { geo?: unknown; mat?: unknown; castShadow?: unknown };
/** A scene's `streaming.farEntries` (p377 D2): which cell meshes get a far entry */
type FarEntries = NonNullable<NonNullable<SceneJSON['streaming']>['farEntries']>;

/** A mesh's far entry: its props (its transform included), and whether it's the mesh itself
 * (`SELF`, a mesh without `lod`) or its coarsest explicit level (`LEVELS`) */
type FarMeshProps = {
  props: Record<string, unknown>;
  kind: 'SELF' | 'LEVELS';
};

/**
 * A mesh's far representation (p353 Phase 5 D7, p377 D1-D4), its transform kept, without its `lod`,
 * app id and `merge` (a far copy never joins a merge group): with explicit `lod.levels`, its
 * coarsest level (each omitted `geo`, `mat` and `castShadow` the levels' before it, level 0's the
 * mesh's own); without `lod`, and `farEntries` `'ALL'` (the default), the mesh itself (`SELF`:
 * the caller keeps it only when it groups, `getFarGroupKey`). None for `AUTO` (its chain isn't
 * known here), a LOD that hides the mesh at a distance (`cullScreenSize` over 0), or a mesh without
 * `lod` under `'LOD_LEVELS'`.
 */
export const getFarMeshProps = (
  props: Record<string, unknown>,
  farEntries: FarEntries = 'ALL'
): FarMeshProps | null => {
  const lod = props.lod as LodLike | undefined;
  let { geo, mat, castShadow } = props;
  let kind: FarMeshProps['kind'] = 'SELF';
  if (lod === undefined) {
    if (farEntries === 'LOD_LEVELS') return null;
  } else {
    if (typeof lod !== 'object' || lod.auto || !Array.isArray(lod.levels)) return null;
    if (!lod.levels.length || num(lod.cullScreenSize, 0) > 0) return null;
    kind = 'LEVELS';
    for (const level of lod.levels as LevelLike[]) {
      if (level.geo !== undefined) geo = level.geo;
      if (level.mat !== undefined) mat = level.mat;
      if (level.castShadow !== undefined) castShadow = level.castShadow;
    }
  }
  const { lod: _lod, appId: _appId, merge: _merge, ...rest } = props;
  return { props: { ...rest, geo, mat, castShadow }, kind };
};

/** The key a far entry groups by in its cell: registered geometry and material ids, its shadows;
 * null for one that's a mesh of its own (an inline `geo` or `mat`, or `matOverrides`). */
const getFarGroupKey = (props: Record<string, unknown>) =>
  typeof props.geo === 'string' && typeof props.mat === 'string' && !props.matOverrides
    ? `${props.geo}|${props.mat}|${props.castShadow ? 1 : 0}|${props.receiveShadow ? 1 : 0}`
    : null;

/** What a far entry references: its `geo`, `mat` and `matOverrides` */
const addFarMeshRefs = (
  scene: SceneJSON,
  props: Record<string, unknown>,
  listed: Listed,
  refs: Refs
) => {
  if (typeof props.geo === 'string') addGeometryRef(scene, props.geo, listed, refs);
  if (typeof props.mat === 'string') addMaterialRef(scene, props.mat, listed, refs, false);
  else addMaterialFieldRefs(props.mat, listed, refs);
  addMaterialFieldRefs(props.matOverrides, listed, refs);
};

/** Adds a mesh's far representation to the cell's far layer: into the cell's group of its kind,
 * by the mesh's index in the manifest's `meshes` (p377 D3: the group names its near entries, whose
 * transforms are its instances), or, for a coarsest explicit level, as a mesh of its own (at its
 * transform). A mesh's own (`SELF`) entry that wouldn't group is none (p377 D1: a far mesh of its
 * own is no fewer draws than its near one). */
const addFarEntry = (
  scene: SceneJSON,
  build: CellBuild,
  mesh: Exclude<MeshEntry, string>,
  meshIndex: number,
  listed: Listed,
  farMeshes: StreamingFarMesh[],
  farEntries: FarEntries | undefined
) => {
  const far = getFarMeshProps(mesh.props as Record<string, unknown>, farEntries);
  if (!far) return;
  const { props, kind } = far;
  const groupKey = getFarGroupKey(props);
  if (groupKey === null && kind === 'SELF') return;
  addFarMeshRefs(scene, props, listed, build.far.refs);
  if (groupKey === null) {
    build.far.meshes.push(farMeshes.length);
    farMeshes.push({ props: props as StreamingFarMesh['props'] });
    return;
  }
  let index = build.far.groups.get(groupKey);
  if (index === undefined) {
    index = farMeshes.length;
    build.far.groups.set(groupKey, index);
    build.far.meshes.push(index);
    const { geo, mat, castShadow, receiveShadow } = props;
    farMeshes.push({
      props: {
        geo,
        mat,
        castShadow: !!castShadow,
        receiveShadow: !!receiveShadow,
      } as StreamingFarMesh['props'],
      entries: [],
    });
  }
  farMeshes[index].entries?.push(meshIndex);
};

/** A built far or kept layer, or undefined when it holds nothing. */
const toManifestLayer = (layer: StreamingManifestLayer): StreamingManifestLayer | undefined => {
  const isEmpty =
    !layer.meshes &&
    !layer.textures &&
    !layer.materials &&
    !layer.geometries &&
    !layer.importedAssets;
  return isEmpty ? undefined : layer;
};

/** Warns about the `base` and `radii` ids that name nothing the scene has */
const warnUnusedIds = (
  ctx: GatherContext,
  sceneId: string,
  field: string,
  ids: Iterable<string>,
  known: Set<string>
) => {
  const unknown = [...ids].filter((id) => !known.has(id));
  if (unknown.length) {
    ctx.log.warn(
      `Scene "${sceneId}": streaming.${field} names ${unknown.map((id) => `"${id}"`).join(', ')}, which the scene has no ${field === 'radii' ? 'mesh' : 'mesh, light or asset'} for.`
    );
  }
};

/**
 * Cuts a resolved streaming scene's JSON content into cells: the scene with only its base in its
 * lists, its cell content in `__streaming` (left out when no entry goes into a cell), and its
 * `streaming` without the build-time `base` and `radii`. A scene without `streaming` is returned
 * as it is.
 */
export const buildStreamingManifest = <S extends SceneJSON>(
  ctx: GatherContext,
  sceneId: string,
  scene: S
): S & { __streaming?: StreamingManifest } => {
  const settings = scene.streaming;
  if (!settings) return scene;
  const { cellSize } = settings;
  const baseIds = new Set(settings.base ?? []);
  const radii = settings.radii ?? {};
  const listed = indexListedAssets(scene);
  const out: S & { __streaming?: StreamingManifest } = {
    ...scene,
    streaming: toRuntimeSettings(settings),
  };

  // D1: which entries go into cells
  const baseMeshes: MeshEntry[] = [];
  const cellMeshes: Exclude<MeshEntry, string>[] = [];
  const knownIds = new Set<string>();
  for (const mesh of scene.meshes ?? []) {
    const appId = getMeshAppId(mesh);
    if (appId !== undefined) knownIds.add(appId);
    if (typeof mesh === 'string' || (appId !== undefined && baseIds.has(appId))) {
      baseMeshes.push(mesh);
    } else {
      cellMeshes.push(mesh);
    }
  }
  const meshIds = new Set(knownIds);
  const baseLights: LightEntry[] = [];
  const cellLights: Exclude<LightEntry, string>[] = [];
  for (const light of scene.lights ?? []) {
    const appId = getLightAppId(light);
    if (appId !== undefined) knownIds.add(appId);
    const isCellType = typeof light !== 'string' && CELL_LIGHT_TYPES.has(light.lightProps.type);
    if (!isCellType || (appId !== undefined && baseIds.has(appId))) baseLights.push(light);
    else cellLights.push(light as Exclude<LightEntry, string>);
  }
  for (const kind of ASSET_KINDS) for (const id of listed[kind].keys()) knownIds.add(id);
  warnUnusedIds(ctx, sceneId, 'base', baseIds, knownIds);
  warnUnusedIds(ctx, sceneId, 'radii', Object.keys(radii), meshIds);
  if (!cellMeshes.length && !cellLights.length) return out;

  // D2: what the base references (its meshes, the background, the ids `base` names), then each
  // cell's entries
  const baseRefs = createRefs();
  for (const mesh of baseMeshes) addMeshRefs(scene, mesh, listed, baseRefs, true);
  if (scene.backgroundTexture) baseRefs.textures.add(scene.backgroundTexture);
  for (const kind of ASSET_KINDS) {
    for (const id of baseIds) if (listed[kind].has(id)) baseRefs[kind].add(id);
  }

  const cells = new Map<number, CellBuild>();
  const manifest: StreamingManifest = {
    cellSize,
    meshes: [],
    lights: [],
    assets: { textures: [], materials: [], geometries: [], importedAssets: [] },
    cells: {},
  };
  const farMeshes: StreamingFarMesh[] = [];
  /** The cells an entry goes into, their bounds grown by it ([] outside the keys' range) */
  const placeEntry = (kind: 'mesh' | 'light', at: Vec3, extent: Extent) => {
    const x = at.x ?? 0;
    const z = at.z ?? 0;
    const keys = getEntryCellKeys(x, z, extent, cellSize);
    if (!keys) {
      ctx.log.error(
        `Scene "${sceneId}": a streamed ${kind} at (${x}, ${z}) is outside the cell keys' range (±65,536 cells of ${cellSize} m).`
      );
      return [];
    }
    const builds = keys.map((cellKey) => getCellBuild(cells, cellKey));
    for (const build of builds) growBounds(build.cell, x, z, extent);
    return builds;
  };
  cellMeshes.forEach((mesh, index) => {
    manifest.meshes.push(mesh as StreamingManifest['meshes'][number]);
    const extent = getMeshExtent(scene, mesh, listed, radii);
    const builds = placeEntry('mesh', (mesh.props.position ?? {}) as Vec3, extent);
    // Phase 5 D8: an oversized mesh is kept content (one entity, while any of its cells is
    // loaded), drawn far away by its own LOD; one cell's mesh is near content with a far one
    const isKept = isOversizedExtent(extent, cellSize);
    for (const build of builds) {
      if (isKept) {
        build.kept.meshes.push(index);
        addMeshRefs(scene, mesh, listed, build.kept.refs, false);
        continue;
      }
      pushIndex(build.cell, 'meshes', index);
      addMeshRefs(scene, mesh, listed, build.refs, false);
      addFarEntry(scene, build, mesh, index, listed, farMeshes, settings.farEntries);
    }
  });
  cellLights.forEach((light, index) => {
    manifest.lights.push(light as StreamingManifest['lights'][number]);
    const at = ((light.lightProps as { position?: Vec3 }).position ?? {}) as Vec3;
    for (const build of placeEntry('light', at, NO_EXTENT)) pushIndex(build.cell, 'lights', index);
  });

  // A material that stays base keeps its textures base: it's created with the scene
  const cellRefMaterials = new Set<string>();
  for (const build of cells.values()) {
    for (const refs of getBuildRefs(build))
      for (const id of refs.materials) cellRefMaterials.add(id);
  }
  for (const [matId] of listed.materials) {
    if (baseRefs.materials.has(matId) || !cellRefMaterials.has(matId)) {
      addMaterialFieldRefs(getListedEntry(scene, listed, 'materials', matId), listed, baseRefs);
    }
  }

  // The assets that move: referenced by a cell and not by the base, each written once
  for (const kind of ASSET_KINDS) {
    const moved = new Map<string, number>();
    const list = scene[kind] as unknown[] | undefined;
    if (!list) continue;
    const kept: unknown[] = [];
    for (const entry of list) {
      const id = getEntryId(entry);
      const isCellOnly =
        typeof entry !== 'string' &&
        id !== undefined &&
        !baseRefs[kind].has(id) &&
        [...cells.values()].some((build) => getBuildRefs(build).some((refs) => refs[kind].has(id)));
      if (!isCellOnly) {
        kept.push(entry);
        continue;
      }
      moved.set(id, manifest.assets[kind].length);
      (manifest.assets[kind] as unknown[]).push(entry);
    }
    (out as Record<string, unknown>)[kind] = kept.length ? kept : undefined;
    if (!kept.length) delete (out as Record<string, unknown>)[kind];
    for (const build of cells.values()) {
      // Each layer lists the moved assets it references (a cell's near and far layers can both)
      const layers: [Refs, StreamingManifestCell | StreamingManifestLayer][] = [
        [build.refs, build.cell],
        [build.far.refs, (build.cell.far ??= { bytesEstimate: 0 })],
        [build.kept.refs, (build.cell.kept ??= { bytesEstimate: 0 })],
      ];
      for (const [refs, layer] of layers) {
        const indices = [...refs[kind]]
          .map((id) => moved.get(id))
          .filter((index): index is number => index !== undefined)
          .sort((a, b) => a - b);
        if (!indices.length) continue;
        layer[kind] = indices;
        if (kind === 'textures' || kind === 'importedAssets') {
          for (const index of indices) {
            layer.bytesEstimate += getVramBytes(manifest.assets[kind][index]);
          }
        }
      }
    }
  }

  out.meshes = baseMeshes.length ? baseMeshes : undefined;
  out.lights = baseLights.length ? baseLights : undefined;
  if (!baseMeshes.length) delete out.meshes;
  if (!baseLights.length) delete out.lights;
  for (const [cellKey, build] of [...cells].sort((a, b) => a[0] - b[0])) {
    const { cell } = build;
    if (build.far.meshes.length) (cell.far ??= { bytesEstimate: 0 }).meshes = build.far.meshes;
    if (build.kept.meshes.length) (cell.kept ??= { bytesEstimate: 0 }).meshes = build.kept.meshes;
    cell.far = cell.far && toManifestLayer(cell.far);
    cell.kept = cell.kept && toManifestLayer(cell.kept);
    if (!cell.far) delete cell.far;
    if (!cell.kept) delete cell.kept;
    manifest.cells[String(cellKey)] = cell;
  }
  if (farMeshes.length) manifest.farMeshes = farMeshes;
  out.__streaming = manifest;
  return out;
};
