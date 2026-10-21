import { describe, expect, it } from 'vitest';
import { hasColliderNodes, type GLTFJson } from './gltfJson';

// p619 §1.4 A6: three's GLTFLoader puts a mesh's extras on its object's userData and the node's
// over them, so the runtime sees a `colliderType` authored on either
describe('hasColliderNodes', () => {
  const json = (node: object, meshExtras?: object): GLTFJson => ({
    nodes: [node],
    meshes: [meshExtras ? { extras: meshExtras } : {}],
  });

  it('finds a node’s own colliderType', () => {
    expect(hasColliderNodes(json({ mesh: 0, extras: { colliderType: 'TRIMESH' } }))).toBe(true);
  });

  it('finds a colliderType on the node’s mesh', () => {
    expect(hasColliderNodes(json({ mesh: 0 }, { colliderType: 'HEIGHTFIELD' }))).toBe(true);
  });

  it('lets the node’s own (empty) value win over the mesh’s', () => {
    expect(
      hasColliderNodes(json({ mesh: 0, extras: { colliderType: '' } }, { colliderType: 'BOX' }))
    ).toBe(false);
  });

  it('ignores a node without a mesh, and a mesh no node uses', () => {
    expect(hasColliderNodes(json({ extras: { colliderType: 'BOX' } }))).toBe(false);
    expect(hasColliderNodes({ nodes: [], meshes: [{ extras: { colliderType: 'BOX' } }] })).toBe(
      false
    );
  });
});
