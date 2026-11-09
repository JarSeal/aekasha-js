import * as THREE from 'three/webgpu';
import { mat4, referenceAttribute } from 'three/tsl';

// The drawn object's instance matrix, for a material that positions its own instances
// (docs/plans/p354_gpu-driven-culling.md D8, Phase 5 step 4): the octahedral impostor's billboard
// turns each instance's quad to face the camera from the instance's centre, so it reads the
// instance's matrix itself, in its `positionNode`. Which matrix depends on what draws the material:
//
// - An InstancedMesh: its `instanceMatrix`, through three r187's `referenceAttribute`, bound per
//   drawn mesh at draw time, so every InstancedMesh on the material shares one build (p058 D1).
//   three multiplies `positionLocal` by it before `positionNode` runs (`NodeMaterial.setupPosition`),
//   so such a material reads `positionGeometry` and applies the matrix itself.
// - An object given a matrix node (`setObjectInstanceMatrixNode`): an instance set's draws, plain
//   meshes whose instances are fetched from the set's buffers (features/instancing).
// - Anything else: the identity.
//
// Resolved at setup by the drawn object, the shadow pass's builds included (they build the drawn
// object with the shadow pass's material). Here in the kernel so the impostors (`lod()`) and the
// instance sets (`instancing()`) both reach it without importing each other.

const IDENTITY = new THREE.Matrix4();
/** three's own per-object binding of an InstancedMesh's matrices (r187). */
const instanceMatrixReference = referenceAttribute('instanceMatrix', 'mat4');

/** Per object: the node its instance matrix comes from (an instance set's draws). */
const objectMatrixNodes = new WeakMap<THREE.Object3D, THREE.Node<'mat4'>>();
/** Materials whose `positionNode` places each instance from `drawnInstanceMatrix` itself. */
const instancePositioningMaterials = new WeakSet<THREE.Material>();

/**
 * The drawn object's instance matrix: an InstancedMesh's per instance, an object's own node (an
 * instance set's draws), else the identity.
 * @internal
 */
class DrawnInstanceMatrixNode extends THREE.Node {
  static get type() {
    return 'DrawnInstanceMatrixNode';
  }

  constructor() {
    super('mat4');
  }

  setup(builder: THREE.NodeBuilder) {
    const object = builder.object as (THREE.Object3D & { isInstancedMesh?: boolean }) | null;
    if (!object) return mat4(IDENTITY);
    if (object.isInstancedMesh) return instanceMatrixReference;
    return objectMatrixNodes.get(object) ?? mat4(IDENTITY);
  }
}

/**
 * The drawn object's instance matrix, for a material's `positionNode` that places each instance
 * itself (read `positionGeometry`, not `positionLocal`, which an InstancedMesh's matrix already
 * moved): an InstancedMesh's per instance, an instance set's fetched one, else the identity.
 * Resolved per drawn object at setup. Mark the material with `setMaterialPositionsInstances`.
 * @internal
 */
export const drawnInstanceMatrix = new DrawnInstanceMatrixNode() as unknown as THREE.Node<'mat4'>;

/**
 * Gives an object the node its instance matrix comes from (an instance set's draws: the fetched
 * instance's matrix), read by `drawnInstanceMatrix`. Set before the object's first build.
 * @internal
 */
export const setObjectInstanceMatrixNode = (object: THREE.Object3D, node: THREE.Node<'mat4'>) => {
  objectMatrixNodes.set(object, node);
};

/**
 * Marks a material whose `positionNode` places each instance itself from `drawnInstanceMatrix`
 * (the octahedral impostor's billboard): an instance set keeps such a `positionNode` and gives its
 * draws their matrices, where it replaces any other with its own fetch.
 * @internal
 */
export const setMaterialPositionsInstances = (material: THREE.Material) => {
  instancePositioningMaterials.add(material);
};

/**
 * Whether a material places each instance itself (`setMaterialPositionsInstances`).
 * @internal
 */
export const doesMaterialPositionInstances = (material: THREE.Material) =>
  instancePositioningMaterials.has(material);
