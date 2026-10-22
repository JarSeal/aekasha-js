import * as THREE from 'three/webgpu';
import {
  existsOrThrow,
  getGeometryRegistry,
  importAssetAsync,
  llog,
  lwarn,
  releaseImportedAsset,
} from 'aekasha';
import type { ImportedGeometryInfo } from 'aekasha';
import { deriveColliderFromGeometry } from 'aekasha/physics';
import type { ColliderParams } from 'aekasha/physics';
import type { DebuggerListItem } from 'aekasha/debug';
import { getErrorMessage } from '../../shared/verifyHarness';
import { VARIANTS_URL, getCompareSlots } from './assetCompare';
import { refreshAssetCompareTab } from './_dbg__assetCompareReport';

// The collider check: every collider copy the fixture builds (quantized, meshopt) against its
// source GLB's, with the engine's own derivation (deriveColliderFromGeometry), as
// spawnImportedAsset would build them. A copy passes when its colliders' bounds (and a
// heightfield's heights, a trimesh's triangle count) match the source's within TOLERANCE_M.

const COLLIDER_MODELS = ['stairsStraightTrimesh', 'obstacles', 'terrainSmooth'];
const COLLIDER_VARIANTS = ['source', 'quantized', 'meshopt', 'meshoptLossless'] as const;
/** Max deviation that still counts as the same collider (16-bit quantization is ~1 mm here). */
const TOLERANCE_M = 0.01;

const getColliderFile = (model: string, variant: (typeof COLLIDER_VARIANTS)[number]) =>
  variant === 'source'
    ? `/debugger/assets/testModels/${model}.glb`
    : `${VARIANTS_URL}/colliders/${model}_${variant}.glb`;

type ColliderShape = {
  nodeKey: string;
  type: string;
  /** The collider's world AABB (body at the node's position and rotation). */
  box: THREE.Box3;
  /** The visible mesh's world AABB (geometry bounds × node transform). */
  meshBox: THREE.Box3;
  /** HEIGHTFIELD: world heights, in Rapier's order. */
  worldHeights?: Float32Array;
  triangles?: number;
  /** Why the collider wasn't built (the derivation returned null or threw). */
  skipped?: string;
};

type ColliderResult = {
  model: string;
  variant: string;
  type: string;
  nodes: number;
  /** Worst AABB deviation from the source's collider (m). */
  vsSource: number;
  /** Worst AABB deviation from its own mesh (m). */
  vsMesh: number;
  /** Worst HEIGHTFIELD height deviation from the source's (m). */
  heights?: number;
  triangleMismatch?: boolean;
  skipped: number;
  failedNodes: string[];
};

let colliderResults: ColliderResult[] | null = null;
let isColliderCheckRunning = false;

export const isColliderCheckBusy = () => isColliderCheckRunning;

const boxDeviation = (a: THREE.Box3, b: THREE.Box3) =>
  Math.max(
    Math.abs(a.min.x - b.min.x),
    Math.abs(a.min.y - b.min.y),
    Math.abs(a.min.z - b.min.z),
    Math.abs(a.max.x - b.max.x),
    Math.abs(a.max.y - b.max.y),
    Math.abs(a.max.z - b.max.z)
  );

const vertex = new THREE.Vector3();

/** The shape's AABB in the body's space (the derived params already carry the node's scale). */
const getLocalShapeBox = (c: ColliderParams) => {
  const box = new THREE.Box3();
  if ((c.type === 'TRIMESH' || c.type === 'CONVEXHULL') && c.vertices) {
    const v = c.vertices;
    for (let i = 0; i < v.length; i += 3) box.expandByPoint(vertex.set(v[i], v[i + 1], v[i + 2]));
  } else if (c.type === 'HEIGHTFIELD' && c.heights && c.scale) {
    let min = Infinity;
    let max = -Infinity;
    for (const h of c.heights) {
      min = Math.min(min, h * c.scale.y);
      max = Math.max(max, h * c.scale.y);
    }
    box.set(
      new THREE.Vector3(-c.scale.x / 2, min, -c.scale.z / 2),
      new THREE.Vector3(c.scale.x / 2, max, c.scale.z / 2)
    );
  } else if (c.type === 'BOX' || c.type === 'CUBOID') {
    box.set(
      new THREE.Vector3(-(c.hx ?? 0), -(c.hy ?? 0), -(c.hz ?? 0)),
      new THREE.Vector3(c.hx ?? 0, c.hy ?? 0, c.hz ?? 0)
    );
  } else if (c.type === 'BALL' || c.type === 'SPHERE') {
    box.setFromCenterAndSize(
      new THREE.Vector3(),
      new THREE.Vector3().setScalar((c.radius ?? 0) * 2)
    );
  } else if (c.type === 'CAPSULE' || c.type === 'CYLINDER' || c.type === 'CONE') {
    const r = c.radius ?? 0;
    const hh = (c.halfHeight ?? 0) + (c.type === 'CAPSULE' ? r : 0);
    box.set(new THREE.Vector3(-r, -hh, -r), new THREE.Vector3(r, hh, r));
  }
  return box;
};

/** Every physics node's collider of an import, as spawnImportedAsset would derive it */
const describeColliders = (importId: string, geometries: ImportedGeometryInfo[]) => {
  const registry = getGeometryRegistry();
  const counts = new Map<string, number>();
  const shapes: ColliderShape[] = [];
  for (const info of geometries) {
    const count = (counts.get(info.nodeName) || 0) + 1;
    counts.set(info.nodeName, count);
    const colliderParams = info.customProps.colliderParams;
    const geometry = registry[info.geometryId]?.resource;
    if (!info.customProps.isPhysObj || !colliderParams || !geometry) continue;

    const { position: p, quaternion: q, scale: s } = info.transform;
    const position = new THREE.Vector3(p.x, p.y, p.z);
    const quaternion = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    const nodeMatrix = new THREE.Matrix4().compose(
      position,
      quaternion,
      new THREE.Vector3(s.x, s.y, s.z)
    );
    const bodyMatrix = new THREE.Matrix4().compose(
      position,
      quaternion,
      new THREE.Vector3(1, 1, 1)
    );
    geometry.computeBoundingBox();
    const meshBox = existsOrThrow(geometry.boundingBox, `${info.geometryId} has no bounds.`)
      .clone()
      .applyMatrix4(nodeMatrix);
    const nodeKey = `${info.nodeName}#${count}`;

    let collider: ColliderParams | null = null;
    let error: string | undefined;
    try {
      collider = deriveColliderFromGeometry(colliderParams, { geometry, info });
    } catch (e) {
      // spawnImportedAsset would throw here too
      error = getErrorMessage(e);
      lwarn(`[assetCompare] ${importId} ${nodeKey}: the collider derivation threw`, e);
    }
    if (!collider) {
      shapes.push({
        nodeKey,
        type: colliderParams.type,
        box: new THREE.Box3(),
        meshBox,
        skipped: error ? `threw: ${error}` : 'skipped',
      });
      continue;
    }
    const shape: ColliderShape = {
      nodeKey,
      type: collider.type,
      box: getLocalShapeBox(collider).applyMatrix4(bodyMatrix),
      meshBox,
    };
    if (collider.type === 'HEIGHTFIELD' && collider.heights && collider.scale) {
      const { y: scaleY } = collider.scale;
      shape.worldHeights = collider.heights.map((h) => p.y + h * scaleY);
    }
    if (collider.type === 'TRIMESH' && collider.indices) {
      shape.triangles = collider.indices.length / 3;
    }
    shapes.push(shape);
  }
  llog(`[assetCompare] ${importId}: ${shapes.length} colliders`);
  return shapes;
};

/** Compares a copy's shape with the source's into `result`; whether it failed */
const compareWithSource = (result: ColliderResult, shape: ColliderShape, source: ColliderShape) => {
  const deviation = boxDeviation(shape.box, source.box);
  result.vsSource = Math.max(result.vsSource, deviation);
  let isFailed = deviation > TOLERANCE_M;
  if (shape.worldHeights && source.worldHeights) {
    let maxDiff = shape.worldHeights.length === source.worldHeights.length ? 0 : Infinity;
    for (let i = 0; i < shape.worldHeights.length && maxDiff !== Infinity; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(shape.worldHeights[i] - source.worldHeights[i]));
    }
    result.heights = Math.max(result.heights ?? 0, maxDiff);
    if (maxDiff > TOLERANCE_M) isFailed = true;
  }
  if (shape.triangles !== undefined && shape.triangles !== source.triangles) {
    result.triangleMismatch = true;
    isFailed = true;
  }
  return isFailed;
};

/** One result per collider type of a model's copy, against the source's shapes by node */
const summarizeByType = (
  model: string,
  variant: string,
  shapes: ColliderShape[],
  sourceShapes: Map<string, ColliderShape> | null
) => {
  const byType = new Map<string, ColliderShape[]>();
  for (const shape of shapes) byType.set(shape.type, [...(byType.get(shape.type) || []), shape]);
  return [...byType].map(([type, typeShapes]) => {
    const result: ColliderResult = {
      model,
      variant,
      type,
      nodes: typeShapes.length,
      vsSource: 0,
      vsMesh: 0,
      skipped: 0,
      failedNodes: [],
    };
    for (const shape of typeShapes) {
      if (shape.skipped) {
        result.skipped++;
        result.failedNodes.push(`${shape.nodeKey} (${shape.skipped})`);
        continue;
      }
      result.vsMesh = Math.max(result.vsMesh, boxDeviation(shape.box, shape.meshBox));
      const source = sourceShapes?.get(shape.nodeKey);
      if (!source || source.skipped) continue;
      if (compareWithSource(result, shape, source)) result.failedNodes.push(shape.nodeKey);
    }
    return result;
  });
};

/** Imports every model's source and copies, one at a time, and compares their colliders. Stops
 * when the scene is left. */
export const runColliderCheckAsync = async () => {
  if (isColliderCheckRunning) return;
  isColliderCheckRunning = true;
  refreshAssetCompareTab();
  // The visit's slot: set to left by the scene's exit
  const visit = getCompareSlots().A;
  const results: ColliderResult[] = [];
  try {
    for (const model of COLLIDER_MODELS) {
      let sourceShapes: Map<string, ColliderShape> | null = null;
      for (const variant of COLLIDER_VARIANTS) {
        const importId = `assetCompareColliders/${model}/${variant}`;
        const manifest = await importAssetAsync({
          id: importId,
          fileName: getColliderFile(model, variant),
          throwOnError: true,
        });
        if (visit.isLeft || !manifest) {
          releaseImportedAsset(importId);
          if (visit.isLeft) return;
          throw new Error(`No manifest for ${importId}.`);
        }
        const shapes = describeColliders(importId, manifest.geometries);
        releaseImportedAsset(importId);
        if (variant === 'source') sourceShapes = new Map(shapes.map((s) => [s.nodeKey, s]));
        results.push(...summarizeByType(model, variant, shapes, sourceShapes));
      }
    }
  } catch (error) {
    if (!visit.isLeft) lwarn('[assetCompare] Collider check failed', error);
  } finally {
    isColliderCheckRunning = false;
  }
  if (visit.isLeft) return;
  colliderResults = results;
  llog('[assetCompare] Collider check', results);
  refreshAssetCompareTab();
};

const formatMeters = (m: number) =>
  !Number.isFinite(m) ? '∞' : m >= 1 ? `${m.toFixed(2)} m` : `${(m * 1000).toFixed(1)} mm`;

/** The check's list rows: one per model, copy and collider type */
export const getColliderRows = (): DebuggerListItem[] => {
  if (isColliderCheckRunning) {
    return [{ itemId: 'running', title: 'Running…', titlePlaceholder: true }];
  }
  return (colliderResults || []).map((r, i) => {
    const isSource = r.variant === 'source';
    const isOk = !r.failedNodes.length;
    return {
      itemId: `collider${i}`,
      title: `${r.model} ${r.variant}`,
      badge: r.type,
      subTitle: `${r.nodes} node${r.nodes === 1 ? '' : 's'}`,
      suffix: isSource
        ? 'source'
        : r.skipped === r.nodes
          ? '✗ not built'
          : `${isOk ? '✓' : '✗'} Δ ${formatMeters(r.vsSource)}`,
      description: [
        `vs own mesh Δ ${formatMeters(r.vsMesh)}`,
        r.heights !== undefined ? `heights Δ ${formatMeters(r.heights)}` : '',
        r.triangleMismatch ? 'triangle count differs' : '',
        r.failedNodes.length ? `failed: ${r.failedNodes.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    };
  });
};
