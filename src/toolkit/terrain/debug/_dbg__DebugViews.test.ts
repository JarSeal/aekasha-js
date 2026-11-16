import { describe, expect, it } from 'vitest';
import { texture, uniform, vec2, vec3 } from 'three/tsl';
import {
  MeshStandardNodeMaterial,
  Texture,
  Vector2,
  type Node,
  type TextureNode,
} from 'three/webgpu';
import { applyTerrainDebugView, type TerrainDebugViewContext } from './_dbg__DebugViews';

const ctx: TerrainDebugViewContext = {
  coords: vec2(1, 2) as unknown as Node<'vec2'>,
  tileSize: uniform(new Vector2(3, 3)) as unknown as Node<'vec2'>,
  colorTexture: texture(new Texture()) as unknown as TextureNode,
  normal: vec3(0, 1, 0) as unknown as Node<'vec3'>,
};

describe('applyTerrainDebugView', () => {
  it('replaces the shading with an unlit view', () => {
    for (const view of ['TEXEL_DENSITY', 'NORMALS'] as const) {
      const material = new MeshStandardNodeMaterial();
      material.aoNode = vec3(1) as never;
      applyTerrainDebugView(material, view, ctx);
      expect(material.emissiveNode, view).toBeTruthy();
      expect(material.colorNode).toBeTruthy();
      expect(material.roughnessNode).toBeTruthy();
      expect(material.aoNode).toBeNull();
    }
  });
});
