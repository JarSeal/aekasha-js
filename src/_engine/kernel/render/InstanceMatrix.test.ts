import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { mat4 } from 'three/tsl';
import {
  doesMaterialPositionInstances,
  drawnInstanceMatrix,
  setMaterialPositionsInstances,
  setObjectInstanceMatrixNode,
} from './InstanceMatrix';

// p354 Phase 5 step 4 (D8): the drawn object's instance matrix, resolved at setup by the object a
// build is for, the shadow pass's included (it builds the drawn object with its own material).

/** What `drawnInstanceMatrix` sets up as for a build of `object`. */
const setUpFor = (object: THREE.Object3D | null, material?: THREE.Material) =>
  (drawnInstanceMatrix as unknown as THREE.Node).setup({
    object,
    material,
  } as unknown as THREE.NodeBuilder) as THREE.Node;

const typeOf = (node: THREE.Node) => (node.constructor as unknown as { type: string }).type;

describe('drawnInstanceMatrix', () => {
  const geometry = new THREE.PlaneGeometry();
  const material = new THREE.MeshBasicNodeMaterial();

  it("is an InstancedMesh's instanceMatrix, bound per drawn mesh", () => {
    const a = setUpFor(new THREE.InstancedMesh(geometry, material, 2));
    const b = setUpFor(new THREE.InstancedMesh(geometry, material, 3));
    expect(typeOf(a)).toBe('ReferenceAttributeNode');
    // One node for every InstancedMesh: the meshes share the build, each binding its own matrices
    expect(b).toBe(a);
  });

  it("is an object's own node (an instance set's draw), in the shadow pass's build too", () => {
    const draw = new THREE.Mesh(geometry, material);
    const fetched = mat4(new THREE.Matrix4().makeTranslation(1, 2, 3));
    setObjectInstanceMatrixNode(draw, fetched);
    expect(setUpFor(draw, material)).toBe(fetched);
    expect(setUpFor(draw, new THREE.MeshBasicNodeMaterial())).toBe(fetched);
  });

  it('is the identity on anything else', () => {
    for (const object of [new THREE.Mesh(geometry, material), null]) {
      const node = setUpFor(object) as THREE.Node & { value?: THREE.Matrix4 };
      expect(node.value?.equals(new THREE.Matrix4())).toBe(true);
    }
  });

  it('marks the materials that place each instance themselves', () => {
    const impostor = new THREE.MeshBasicNodeMaterial();
    setMaterialPositionsInstances(impostor);
    expect(doesMaterialPositionInstances(impostor)).toBe(true);
    expect(doesMaterialPositionInstances(material)).toBe(false);
  });
});
