import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import {
  clearObjectVisibilityFade,
  createLodFadeAttribute,
  enableLodDither,
  getLodFadeAttribute,
  isDitherShown,
  LOD_FADE_OPAQUE,
  setLodObjectFade,
  setObjectVisibilityFade,
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

  it("disposes a mesh's fade attribute with the mesh, its own or the opaque one", () => {
    const material = createDitheredMaterial();
    const withFade = new THREE.InstancedMesh(geometry, material, 2);
    const without = new THREE.InstancedMesh(geometry, material, 2);
    const own = createLodFadeAttribute(withFade);
    const [fade] = findNodes(setUpMask(material, without), 'LodFadeAttributeNode') as [
      FadeAttributeNode,
    ];
    const opaque = fade.getAttribute(without);
    const disposed: THREE.BufferAttribute[] = [];
    for (const attribute of [own, opaque]) {
      attribute.addEventListener('dispose', () => disposed.push(attribute));
    }

    withFade.dispose();
    without.dispose();
    expect(disposed).toEqual([own, opaque]);
  });

  it('reads the per-object fades on an InstancedMesh too (an InstancedMesh entity fades whole)', () => {
    const material = createDitheredMaterial();
    const instanced = new THREE.InstancedMesh(geometry, material, 1);
    const graph = setUpMask(material, instanced);
    const objectUniforms = findNodes(graph, 'UniformNode').filter(
      (node) => (node as THREE.UniformNode<'vec2', THREE.Vector2>).value instanceof THREE.Vector2
    );
    expect(objectUniforms.length).toBeGreaterThan(0);
  });

  it("writes an object's LOD and visibility fades before its draw, a LOD fade copy its mesh's", () => {
    const material = createDitheredMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    const [pair] = findNodes(setUpMask(material, mesh), 'UniformNode').filter(
      (node) => (node as THREE.UniformNode<'vec2', THREE.Vector2>).value instanceof THREE.Vector2
    ) as THREE.UniformNode<'vec2', THREE.Vector2>[];
    const drawn = (object: THREE.Object3D) => {
      (pair.update as (frame: { object: THREE.Object3D }) => void)({ object });
      return pair.value.toArray();
    };
    const copy = new THREE.Mesh(geometry, material);
    copy.userData.isLodFadeCopy = true;
    const child = new THREE.Mesh(geometry, material);
    mesh.add(copy, child);

    expect(drawn(mesh)).toEqual([LOD_FADE_OPAQUE, LOD_FADE_OPAQUE]);
    setLodObjectFade(mesh, 0.25);
    setObjectVisibilityFade(mesh, -0.5);
    expect(drawn(mesh)).toEqual([0.25, -0.5]);
    expect(drawn(copy)).toEqual([LOD_FADE_OPAQUE, -0.5]);
    expect(drawn(child)).toEqual([LOD_FADE_OPAQUE, LOD_FADE_OPAQUE]);
    clearObjectVisibilityFade(mesh);
    expect(drawn(copy)).toEqual([LOD_FADE_OPAQUE, LOD_FADE_OPAQUE]);
  });

  // p353 Phase 5 D5: a visibility fade ANDed with a LOD cross-fade on the same noise
  it('composes a visibility fade with a LOD cross-fade exactly', () => {
    const noises = Array.from({ length: 1000 }, (_, i) => (i + 0.5) / 1000);
    for (const t of [0, 0.2, 0.5, 0.9]) {
      for (const s of [0, 0.3, 0.7, 1]) {
        for (const noise of noises) {
          // Either LOD copy (incoming at t, outgoing at t - 1) under the visibility fade
          const shownIn = (v: number) =>
            (isDitherShown(noise, t) || isDitherShown(noise, t - 1)) && isDitherShown(noise, v);
          // The copies split the pixels: exactly one shows without a visibility fade
          expect(isDitherShown(noise, t) !== isDitherShown(noise, t - 1)).toBe(true);
          // Fading in at s shows noise ≤ s; fading out at progress s (drawn at s - 1), noise ≥ s
          expect(shownIn(s)).toBe(noise <= s);
          expect(shownIn(s - 1)).toBe(noise >= s);
        }
      }
    }
  });
});
