// A streaming scene's JSON cell content (p353 Phase 3 D7, Phase 5 D7-D9): the gatherer's manifest
// (`SceneData.__streaming`, StreamingManifest.ts) turned into the units the machine
// (StreamingCells.ts) runs ahead of a cell's code-registered ones, per content layer. Each layer:
// one async unit loading its cell-only assets in its owner key, then its entries a few a unit, the
// first of them waiting for the assets. The near layer's entries are its lights and meshes; the far
// layer's its meshes' far representations (an `InstancedMesh` per group, its instances at the near
// entries' transforms it names, p377 D3; a mesh of its own otherwise); the kept layer's the
// oversized meshes it overlaps, one entity across their cells:
// the first cell to load creates it, every holder's unit returns it, the last to unload deletes it,
// and `getHolders` tells the machine which holder shows and fades it (D8).
import * as THREE from 'three/webgpu';
import { getCellOwnerKey } from '../../kernel/assets/AssetOwners';
import { getGeometry, incGeometryRef } from '../../kernel/assets/Geometry';
import { getMaterial, incMaterialRef } from '../../kernel/assets/Material';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import type { MeshProps } from '../../kernel/mesh/Mesh';
import { getRootScene } from '../../kernel/scene/Scene';
import { createSceneObject3Ds, loadSceneAssetsAsync } from '../../kernel/scene/SceneDataLoader';
import type { StreamingCellUnitSource } from './StreamingCells';
import type { StreamingCellContent, StreamingContentRange } from './StreamingContent';
import { getStreamingLayerOwnerLayer } from './StreamingLayers';
import type {
  StreamingFarMesh,
  StreamingManifest,
  StreamingManifestCell,
  StreamingManifestLayer,
} from './StreamingManifest';

/** Entries (lights and meshes) per unit: a unit is the slice a frame's budget can't split */
const ENTRIES_PER_UNIT = 8;

const NO_UNITS: readonly StreamingCellUnitSource[] = [];

/** A shared (oversized) mesh's entity and the cells holding it, the first to load first */
type SharedEntity = { entityId: number; holders: number[] };

/**
 * A scene's JSON cell content: the units per cell and layer, built on a layer's first load and kept
 * (the data doesn't change), and its shared meshes' entities.
 * @internal
 */
export type StreamingDataContent = {
  /** The manifest it's built from. */
  readonly manifest: StreamingManifest;
  /** The cell's layer's units, run ahead of its code-registered ones (none for a cell without
   * data in that layer). */
  getUnits(cellKey: number, range: StreamingContentRange): readonly StreamingCellUnitSource[];
  /** The shared meshes' entities alive, by manifest mesh index (the debug tab's). */
  readonly shared: ReadonlyMap<number, Readonly<SharedEntity>>;
  /** The cells holding a shared mesh's entity, the first to load first; null for any other
   * entity (the machine's `sharedEntities`). */
  getHolders(entityId: number): readonly number[] | null;
};

type AssetLists = Pick<
  StreamingManifestLayer,
  'textures' | 'materials' | 'geometries' | 'importedAssets'
>;

const pick = <T>(list: readonly T[], indices: readonly number[] | undefined): T[] | undefined =>
  indices?.map((index) => list[index]);

/** A layer's cell-only assets as the loader's lists, or null without any */
const getAssetLists = (manifest: StreamingManifest, layer: AssetLists) => {
  const { assets } = manifest;
  if (!layer.textures && !layer.materials && !layer.geometries && !layer.importedAssets) {
    return null;
  }
  return {
    textures: pick(assets.textures, layer.textures),
    materials: pick(assets.materials, layer.materials),
    geometries: pick(assets.geometries, layer.geometries),
    importedAssets: pick(assets.importedAssets, layer.importedAssets),
  };
};

/** The part of a manifest cell a content range loads */
const getManifestLayer = (
  cell: StreamingManifestCell,
  range: StreamingContentRange
): (AssetLists & { meshes?: number[] }) | undefined => {
  if (range === 'NEAR') return cell;
  return range === 'FAR' ? cell.far : cell.kept;
};

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();

/** A far instance's transform: a near entry's props, or a deprecated `instances` item */
type FarTransform = Pick<MeshProps, 'position' | 'rotation' | 'quaternion' | 'scale'>;

/** Writes instance `i`'s matrix from a transform: `quaternion` over `rotation`, scale 1 by
 * default (the module's scratch objects, nothing allocated) */
const setFarInstanceMatrix = (mesh: THREE.InstancedMesh, i: number, t: FarTransform) => {
  const { position: p, rotation: r, quaternion: q, scale: s } = t;
  _position.set(p?.x ?? 0, p?.y ?? 0, p?.z ?? 0);
  if (q) _quaternion.set(q.x, q.y, q.z, q.w);
  else _quaternion.setFromEuler(_euler.set(r?.x ?? 0, r?.y ?? 0, r?.z ?? 0));
  _scale.set(s?.x ?? 1, s?.y ?? 1, s?.z ?? 1);
  mesh.setMatrixAt(i, _matrix.compose(_position, _quaternion, _scale));
};

/** Whether a far representation is a group (drawn by `createFarGroupEntity`) rather than a mesh
 * of its own: it names its entries, or has the deprecated instances */
const isFarGroup = (far: StreamingFarMesh) => !!(far.entries ?? far.instances);

/**
 * A far group's entity (p353 Phase 5 D7): one `InstancedMesh` of the group's registered geometry
 * and material, an instance per entry, holding a ref on both (the mesh tag's delete hook releases
 * them). An instance is at its near entry's transform (`far.entries`, indices into the manifest's
 * `meshes`, p377 D3), or at the deprecated `far.instances`' when the group has no `entries`. Not in
 * the ECS frustum culling (it measures one instance at the origin): three culls the mesh by its
 * bounds over every instance. Throws when its geometry or material isn't registered.
 * @internal
 */
export const createFarGroupEntity = (
  world: ECSWorld,
  far: StreamingFarMesh,
  meshes: StreamingManifest['meshes']
) => {
  const { geo, mat, castShadow, receiveShadow } = far.props;
  const geometry = typeof geo === 'string' ? getGeometry(geo) : undefined;
  const material = typeof mat === 'string' ? getMaterial(mat) : undefined;
  if (!geometry || !material) {
    throw new Error(
      `a far group's ${geometry ? `material "${String(mat)}"` : `geometry "${String(geo)}"`} isn't registered`
    );
  }
  const { entries } = far;
  // The deprecated instances, drawn until engine 7.0.0 (p377 D3)
  const instances = entries ? undefined : far.instances;
  const count = entries?.length ?? instances?.length ?? 0;
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  if (entries) {
    for (let i = 0; i < count; i++) setFarInstanceMatrix(mesh, i, meshes[entries[i]].props);
  } else if (instances) {
    for (let i = 0; i < count; i++) setFarInstanceMatrix(mesh, i, instances[i]);
  }
  mesh.computeBoundingSphere();
  mesh.castShadow = castShadow ?? false;
  mesh.receiveShadow = receiveShadow ?? false;
  if (geometry.userData.id) incGeometryRef(geometry.userData.id);
  if (material.userData.id) incMaterialRef(material.userData.id);
  const entityId = world.createEntity();
  mesh.userData.entityId = entityId;
  world.addComponent(entityId, ComponentType.OBJECT3D, { value: mesh, _lastVersion: -1 });
  world.addComponent(entityId, ComponentType.TAG_IS_MESH, true);
  getRootScene()?.add(mesh);
  return entityId;
};

/**
 * The units of a scene's JSON cell content, from its manifest.
 * @internal
 */
export const createStreamingDataContent = (
  sceneId: string,
  manifest: StreamingManifest
): StreamingDataContent => {
  const shared = new Map<number, SharedEntity>();
  const sharedByEntity = new Map<number, SharedEntity>();
  const unitsByLayer = new Map<string, readonly StreamingCellUnitSource[]>();
  const farMeshes = manifest.farMeshes ?? [];

  /** A shared (kept) mesh's unit: created by its first holder; every holder's unit returns its
   * id, and the machine asks `getHolders` which of them primes, shows and fades it. The last
   * holder's unload deletes it. */
  const createSharedMeshUnit = (cellKey: number, index: number): StreamingCellContent => ({
    sceneId,
    cellKey,
    loadedAt: 'NEAR_AND_FAR',
    load: () => {
      const alive = shared.get(index);
      if (alive) {
        if (!alive.holders.includes(cellKey)) alive.holders.push(cellKey);
        return [alive.entityId];
      }
      const [entityId] = createSceneObject3Ds({ meshes: [manifest.meshes[index]] });
      if (entityId === undefined) return [];
      const entry = { entityId, holders: [cellKey] };
      shared.set(index, entry);
      sharedByEntity.set(entityId, entry);
      return [entityId];
    },
    unload: (_entityIds, ctx) => {
      const alive = shared.get(index);
      if (!alive) return;
      const at = alive.holders.indexOf(cellKey);
      if (at !== -1) alive.holders.splice(at, 1);
      if (alive.holders.length) return;
      shared.delete(index);
      sharedByEntity.delete(alive.entityId);
      if (ctx.world.isAlive(alive.entityId)) ctx.world.deleteEntity(alive.entityId);
    },
  });

  /** A unit of far entries: each group one InstancedMesh entity, the rest meshes of their own */
  const createFarUnit = (cellKey: number, indices: readonly number[]): StreamingCellContent => ({
    sceneId,
    cellKey,
    loadedAt: 'FAR',
    load: ({ world }) =>
      indices.flatMap((index) => {
        const far = farMeshes[index];
        if (isFarGroup(far)) return [createFarGroupEntity(world, far, manifest.meshes)];
        return createSceneObject3Ds({ meshes: [{ props: far.props }] });
      }),
  });

  const buildUnits = (
    cellKey: number,
    range: StreamingContentRange
  ): readonly StreamingCellUnitSource[] => {
    const cell = manifest.cells[String(cellKey)];
    const layer = cell && getManifestLayer(cell, range);
    if (!layer) return NO_UNITS;
    const units: StreamingCellUnitSource[] = [];
    const assetLists = getAssetLists(manifest, layer);
    if (assetLists) {
      const ownerKey = getCellOwnerKey(sceneId, cellKey, getStreamingLayerOwnerLayer(range));
      units.push({
        waits: false,
        content: {
          sceneId,
          cellKey,
          loadedAt: range,
          load: async () => {
            await loadSceneAssetsAsync(assetLists, ownerKey);
            return [];
          },
        },
      });
    }
    // The first entry unit waits for the assets (and so does everything after it)
    const waits = () => !!assetLists && units.length === 1;
    const meshes = layer.meshes ?? [];
    if (range === 'NEAR_AND_FAR') {
      for (const index of meshes) {
        units.push({ waits: waits(), content: createSharedMeshUnit(cellKey, index) });
      }
      return units;
    }
    if (range === 'FAR') {
      for (let start = 0; start < meshes.length; start += ENTRIES_PER_UNIT) {
        const chunk = meshes.slice(start, start + ENTRIES_PER_UNIT);
        units.push({ waits: waits(), content: createFarUnit(cellKey, chunk) });
      }
      return units;
    }
    // Near: lights first, then the meshes, a few a unit
    const entries: ({ light: number } | { mesh: number })[] = [
      ...(cell.lights ?? []).map((light) => ({ light })),
      ...meshes.map((mesh) => ({ mesh })),
    ];
    for (let start = 0; start < entries.length; start += ENTRIES_PER_UNIT) {
      const chunk = entries.slice(start, start + ENTRIES_PER_UNIT);
      const lists = {
        lights: chunk.flatMap((e) => ('light' in e ? [manifest.lights[e.light]] : [])),
        meshes: chunk.flatMap((e) => ('mesh' in e ? [manifest.meshes[e.mesh]] : [])),
      };
      units.push({
        waits: waits(),
        content: { sceneId, cellKey, load: () => createSceneObject3Ds(lists) },
      });
    }
    return units;
  };

  return {
    manifest,
    shared,
    getHolders: (entityId) => sharedByEntity.get(entityId)?.holders ?? null,
    getUnits: (cellKey, range) => {
      const key = `${cellKey}/${range}`;
      let units = unitsByLayer.get(key);
      if (!units) {
        units = buildUnits(cellKey, range);
        unitsByLayer.set(key, units);
      }
      return units;
    },
  };
};
