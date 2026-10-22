import { describe, expect, it } from 'vitest';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { normalNode } from './triplanarGrid.tsl';

describe('triplanarGrid normalNode', () => {
  it('names a missing seamNormalStrength while seamNormals is on', () => {
    const inputs = {} as Parameters<typeof normalNode>[0];
    expect(() => normalNode(inputs, new MeshStandardNodeMaterial())).toThrow(
      /Missing normalNode input "seamNormalStrength"/
    );
  });

  it('keeps the default normal without seamNormals, inputs or not', () => {
    const inputs = {} as Parameters<typeof normalNode>[0];
    const material = new MeshStandardNodeMaterial();
    expect(normalNode(inputs, material, { seamNormals: false })).toBeNull();
  });
});
