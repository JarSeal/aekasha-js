import {
  Primitive,
  PropertyType,
  type Accessor,
  type Document,
  type Material,
  type Mesh,
  type Node,
  type Scene,
} from '@gltf-transform/core';
import {
  compactPrimitive,
  dequantizePrimitive,
  joinPrimitives,
  prune,
} from '@gltf-transform/functions';
import { Matrix3, Matrix4, Vector3, Vector4 } from 'three';
import { globToRegExp } from './glob';
import type { GLTFMergeStats, ResolvedMergeOptions } from './gltfMergeOptions';

/**
 * The GLB step's `merge` (p371 D3): joins a file's static pieces into one node per glTF material
 * (`BY_MATERIAL`) or one in all (`ALL`), before the geometry's compression (so a LOD chain is
 * built from the joined mesh, open question 2).
 *
 * Not gltf-transform's `flatten` + `join`, which the plan named: `flatten` moves every node, the
 * kept ones included, to the scene root and prunes the empty ones, so the runtime's import root
 * (a single empty root node, `GLTFExtract.ts`) and the kept nodes' transforms and parent paths
 * would change; `join` keeps the first piece's node, name and transform, and its
 * `transformPrimitive` neither negates a mirrored piece's tangent `w` nor transforms a tangent
 * right (it reads a component it has already written). So the pieces are baked here, into the
 * import root's space, and joined with `joinPrimitives`: a kept node keeps its place, name,
 * transform and parent, and a merged node is a child of the import root with no transform.
 */

/** GLTFLoader's name rule (`PropertyBinding.sanitizeNodeName`): a node's id is this */
const sanitizeName = (name: string) => name.replace(/\s/g, '_').replace(/[[\].:/]/g, '');

type KeptReason = keyof GLTFMergeStats['kept'];

/** Node extras win over mesh extras, as in CustomProps.ts */
const isPhysicsNode = (node: Node, mesh: Mesh | null) => {
  const extras = { ...mesh?.getExtras(), ...node.getExtras() } as Record<string, unknown>;
  return !!extras.isPhysObj || !!extras.colliderType;
};

/**
 * The runtime's import root (`GLTFExtract.ts`' `getImportRoot`): a scene's single child that
 * three loads as a plain `Object3D` (no mesh, camera, light or joint), else the scene.
 */
const getImportRoot = (scene: Scene, joints: Set<Node>): Node | null => {
  const children = scene.listChildren();
  if (children.length !== 1) return null;
  const [node] = children;
  const isPlain =
    !node.getMesh() &&
    !node.getCamera() &&
    !node.getExtension('KHR_lights_punctual') &&
    !joints.has(node);
  return isPlain ? node : null;
};

const scratch = { v3: new Vector3(), v4: new Vector4() };

/**
 * Bakes a matrix into a primitive's float attributes (dequantized first): positions, normals
 * by the normal matrix, tangents' `xyz` by the upper 3×3 (both normalized). A mirrored matrix
 * reverses the triangles' winding and negates tangent `w`, as `mergeGeometryParts` does (D1).
 */
const bakePrimitive = (prim: Primitive, matrix: Matrix4) => {
  const { v3, v4 } = scratch;
  const position = prim.getAttribute('POSITION');
  const normal = prim.getAttribute('NORMAL');
  const tangent = prim.getAttribute('TANGENT');
  const normalMatrix = new Matrix3().getNormalMatrix(matrix);
  const directionMatrix = new Matrix3().setFromMatrix4(matrix);
  const isMirrored = matrix.determinant() < 0;
  const each = (accessor: Accessor | null, fn: (element: number[]) => void) => {
    if (!accessor) return;
    const element: number[] = [];
    for (let i = 0, count = accessor.getCount(); i < count; i++) {
      accessor.getElement(i, element);
      fn(element);
      accessor.setElement(i, element);
    }
  };
  each(position, (e) => v3.fromArray(e).applyMatrix4(matrix).toArray(e));
  each(normal, (e) => v3.fromArray(e).applyMatrix3(normalMatrix).normalize().toArray(e));
  each(tangent, (e) => {
    v4.fromArray(e);
    v3.set(v4.x, v4.y, v4.z).applyMatrix3(directionMatrix).normalize().toArray(e);
    if (isMirrored) e[3] = -v4.w;
  });
  const indices = prim.getIndices();
  if (isMirrored && indices) {
    for (let i = 0, count = indices.getCount(); i + 2 < count; i += 3) {
      const a = indices.getScalar(i);
      indices.setScalar(i, indices.getScalar(i + 2));
      indices.setScalar(i + 2, a);
    }
  }
};

/** The attributes' layout: pieces join only when it's the same (joinPrimitives' rule) */
const getLayoutKey = (prim: Primitive) =>
  prim
    .listSemantics()
    .sort()
    .map((semantic) => {
      const attribute = prim.getAttribute(semantic)!;
      const normalized = attribute.getNormalized() ? 'n' : '';
      return `${semantic}:${attribute.getElementSize()}:${attribute.getComponentType()}${normalized}`;
    })
    .join('+');

const describeLayout = (key: string) => key.replace(/:\d+:\d+n?/g, '').replace(/\+/g, ', ');

type Group = { material: Material | null; layout: string; prims: Primitive[] };

/**
 * Every name GLTFLoader makes unique together (nodes, the meshes a node uses, scenes, cameras),
 * sanitized
 */
const listUsedNames = (doc: Document) => {
  const root = doc.getRoot();
  const usedMeshes = root
    .listMeshes()
    .filter((mesh) =>
      mesh.listParents().some((parent) => parent.propertyType === PropertyType.NODE)
    );
  return new Set(
    [...root.listNodes(), ...usedMeshes, ...root.listScenes(), ...root.listCameras()]
      .map((property) => sanitizeName(property.getName()))
      .filter(Boolean)
  );
};

/**
 * Joins a document's static mesh nodes in its default scene, in place. Kept as they are, with
 * their subtrees: a node whose name an `exclude` glob matches, a physics node (`isPhysObj` or
 * `colliderType` in its or its mesh's extras), a skin's joints and animated nodes; kept alone: a
 * skinned or GPU-instanced node and one with a morph-target or non-triangle primitive. A merged
 * piece's node is removed when nothing else hangs on it. Each joined primitive is a new node, a
 * child of the import root with no transform.
 * @returns What it did; `merged` is empty when nothing qualified
 */
export const mergeGLTFNodes = async (
  doc: Document,
  options: ResolvedMergeOptions,
  warn: (message: string) => void
): Promise<GLTFMergeStats> => {
  const stats: GLTFMergeStats = {
    mode: options.mode,
    merged: [],
    kept: { excluded: 0, physics: 0, unsupported: 0 },
  };
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) return stats;

  const excludes = options.exclude.map((glob) => globToRegExp(glob));
  const joints = new Set(root.listSkins().flatMap((skin) => skin.listJoints()));
  const animated = new Set(
    root
      .listAnimations()
      .flatMap((animation) => animation.listChannels())
      .filter((channel) => channel.getTargetPath() !== 'weights')
      .flatMap((channel) => channel.getTargetNode() ?? [])
  );
  const importRoot = getImportRoot(scene, joints);
  const rootInverse = new Matrix4();
  if (importRoot) rootInverse.fromArray(importRoot.getWorldMatrix()).invert();

  // Which mesh nodes merge, which are kept and why (a subtree reason passes to the children)
  const pieces: Node[] = [];
  const unsupported: string[] = [];
  const visit = (node: Node, inherited: KeptReason | null) => {
    const name = node.getName();
    const mesh = node.getMesh();
    let subtree = inherited;
    if (!subtree && excludes.some((regExp) => regExp.test(name))) subtree = 'excluded';
    if (!subtree && isPhysicsNode(node, mesh)) subtree = 'physics';
    if (!subtree && (joints.has(node) || animated.has(node))) {
      subtree = 'unsupported';
      if (mesh) unsupported.push(`"${name}" (animated or a joint)`);
    }
    if (mesh) {
      let reason = subtree;
      if (!reason) {
        const prims = mesh.listPrimitives();
        const why = node.getSkin()
          ? 'skinned'
          : node.getExtension('EXT_mesh_gpu_instancing')
            ? 'GPU-instanced'
            : prims.some((prim) => prim.listTargets().length)
              ? 'morph targets'
              : prims.some((prim) => prim.getMode() !== Primitive.Mode.TRIANGLES)
                ? 'not triangles'
                : null;
        if (why) {
          reason = 'unsupported';
          unsupported.push(`"${name}" (${why})`);
        }
      }
      if (reason) stats.kept[reason]++;
      else pieces.push(node);
    }
    for (const child of node.listChildren()) visit(child, subtree);
  };
  for (const node of scene.listChildren()) visit(node, null);
  if (unsupported.length) {
    warn(`merge: kept as they are, unsupported: ${unsupported.join(', ')}`);
  }
  if (!pieces.length) {
    warn('merge: no node to merge');
    return stats;
  }

  // Each piece's primitives, copied (a mesh can be shared), baked into the import root's space
  const materials = root.listMaterials();
  const groups = new Map<string, Group>();
  const matrix = new Matrix4();
  for (const node of pieces) {
    matrix.fromArray(node.getWorldMatrix()).premultiply(rootInverse);
    for (const source of node.getMesh()!.listPrimitives()) {
      const prim = compactPrimitive(source.clone());
      dequantizePrimitive(prim);
      bakePrimitive(prim, matrix);
      const material = prim.getMaterial();
      const layout = getLayoutKey(prim);
      const materialKey = options.mode === 'ALL' ? '' : String(materials.indexOf(material!));
      const key = `${materialKey}|${layout}`;
      let group = groups.get(key);
      if (!group) groups.set(key, (group = { material, layout, prims: [] }));
      group.prims.push(prim);
    }
  }

  // The pieces' nodes lose their meshes; a node nothing else hangs on goes, and so does an
  // empty parent it leaves childless (a file's own empty leaves aren't touched)
  const isEmpty = (node: Node) =>
    !node.getMesh() &&
    !node.listChildren().length &&
    !node.getCamera() &&
    !node.listExtensions().length;
  for (const node of pieces) {
    node.setMesh(null);
    let current: Node | null = node;
    while (current && current !== importRoot && isEmpty(current)) {
      const parent: Node | null = current.getParentNode();
      current.dispose();
      current = parent;
    }
  }

  // One node per group, named after its material (BY_MATERIAL); a layout split adds `_2`, …
  const usedNames = listUsedNames(doc);
  const byBase = new Map<string, Group[]>();
  for (const group of groups.values()) {
    const { material } = group;
    const materialName = material
      ? material.getName() || `material${materials.indexOf(material)}`
      : null;
    const base =
      options.mode === 'ALL'
        ? '__merged'
        : `__merged_${materialName === null ? 'nomaterial' : sanitizeName(materialName)}`;
    byBase.set(base, [...(byBase.get(base) ?? []), group]);
  }
  const parent = importRoot ?? scene;
  for (const [base, baseGroups] of byBase) {
    if (baseGroups.length > 1) {
      warn(
        `merge: ${base}'s pieces make ${baseGroups.length} nodes (other attribute sets, or materials of one name): ${baseGroups
          .map(
            (group, index) =>
              `${index ? `${base}_${index + 1}` : base} (${describeLayout(group.layout)})`
          )
          .join('; ')}`
      );
    }
    for (const [index, group] of baseGroups.entries()) {
      let name = index ? `${base}_${index + 1}` : base;
      if (usedNames.has(name)) {
        let n = 2;
        while (usedNames.has(`${name}_${n}`)) n++;
        warn(`merge: the file already has the name "${name}": the merged node is "${name}_${n}"`);
        name = `${name}_${n}`;
      }
      usedNames.add(name);
      const { prims } = group;
      if (options.mode === 'ALL') for (const prim of prims) prim.setMaterial(group.material);
      const joined = prims.length > 1 ? joinPrimitives(prims) : prims[0];
      if (joined !== prims[0]) for (const prim of prims) prim.dispose();
      parent.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(joined)));
      const material = joined.getMaterial();
      stats.merged.push({
        name,
        material: material ? material.getName() || `material${materials.indexOf(material)}` : null,
        parts: prims.length,
        vertices: joined.getAttribute('POSITION')!.getCount(),
        triangles: Math.floor((joined.getIndices()?.getCount() ?? 0) / 3),
      });
    }
  }
  // The pieces' meshes no node uses any more, and the accessors left by them and the join
  await doc.transform(
    prune({
      propertyTypes: [PropertyType.MESH, PropertyType.PRIMITIVE, PropertyType.ACCESSOR],
      keepAttributes: true,
      keepIndices: true,
    })
  );
  return stats;
};
