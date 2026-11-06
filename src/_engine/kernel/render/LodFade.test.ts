import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import {
  createLodFadeAttribute,
  enableLodDither,
  getLodFadeAttribute,
  LOD_FADE_OPAQUE,
} from './LodFade';

type FadeAttributeNode = THREE.Node & {
  getAttribute: (object: THREE.Object3D) => THREE.InstancedBufferAttribute;
};

/** The mask's graph for `object`, as a build for it would set it up. */
const setUpMask = (material: THREE.Material, object: THREE.Object3D) => {
  const mask = (material as THREE.Material & { maskNode: THREE.Node }).maskNode;
  return mask.setup({ object } as unknown as THREE.NodeBuilder) as THREE.Node;
};

/** The nodes of `type` in a graph. */
const findNodes = (root: THREE.Node, type: string) => {
  const found: THREE.Node[] = [];
  root.traverse((node) => {
    // three's static `type` names a node's class (its typings leave it off)
    if ((node.constructor as unknown as { type: string }).type === type) found.push(node);
  });
  return found;
};

const createDitheredMaterial = () => {
  const material = new THREE.MeshBasicNodeMaterial();
  enableLodDither(material);
  return material;
};

const geometry = new THREE.PlaneGeometry();

describe('LodFade', () => {
  // p058 D2 (docs/plans/_DONE_p058_shared-instanced-builds-for-lod-fades-and-impostors.md): three
  // r187 shares one build between InstancedMeshes on a material, so the fade binds per drawn object
  it('binds an InstancedMesh fade per drawn object, a plain mesh none', () => {
    const material = createDitheredMaterial();
    const plain = new THREE.Mesh(geometry, material);
    expect(findNodes(setUpMask(material, plain), 'LodFadeAttributeNode')).toHaveLength(0);

    const instanced = new THREE.InstancedMesh(geometry, material, 4);
    const [fade] = findNodes(setUpMask(material, instanced), 'LodFadeAttributeNode');
    expect(fade).toBeInstanceOf(THREE.ReferenceAttributeNode);
  });

  it('binds an opaque fade on an InstancedMesh without one, and each mesh its own', () => {
    const material = createDitheredMaterial();
    const withFade = new THREE.InstancedMesh(geometry, material, 3);
    const without = new THREE.InstancedMesh(geometry, material, 5);
    const own = createLodFadeAttribute(withFade);
    const [fade] = findNodes(setUpMask(material, withFade), 'LodFadeAttributeNode') as [
      FadeAttributeNode,
    ];

    expect(fade.getAttribute(withFade)).toBe(own);
    const opaque = fade.getAttribute(without);
    expect(opaque).not.toBe(own);
    expect(opaque.count).toBe(5);
    expect([...(opaque.array as Float32Array)]).toEqual(Array(5).fill(LOD_FADE_OPAQUE));
    expect(fade.getAttribute(without)).toBe(opaque);
    expect(getLodFadeAttribute(without)).toBeUndefined();
  });

  it('adopts the bound opaque fade when createLodFadeAttribute comes after the first draw', () => {
    const material = createDitheredMaterial();
    const mesh = new THREE.InstancedMesh(geometry, material, 2);
    const [fade] = findNodes(setUpMask(material, mesh), 'LodFadeAttributeNode') as [
      FadeAttributeNode,
    ];
    const bound = fade.getAttribute(mesh);

    const created = createLodFadeAttribute(mesh);
    expect(created).toBe(bound);
    expect(getLodFadeAttribute(mesh)).toBe(bound);
    expect(fade.getAttribute(mesh)).toBe(bound);
  });

  it('reads the per-object fade on an InstancedMesh too (an InstancedMesh entity fades whole)', () => {
    const material = createDitheredMaterial();
    const instanced = new THREE.InstancedMesh(geometry, material, 1);
    const graph = setUpMask(material, instanced);
    const objectUniforms = findNodes(graph, 'UniformNode').filter(
      (node) => (node as THREE.UniformNode<'float', number>).value === LOD_FADE_OPAQUE
    );
    expect(objectUniforms.length).toBeGreaterThan(0);
  });
});
