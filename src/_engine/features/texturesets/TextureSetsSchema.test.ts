import { describe, expect, it } from 'vitest';
import { textureSetsSchemaPart } from './TextureSetsSchema';

describe('textureSetsSchemaPart', () => {
  it("gives a scene's textureSets as ids", () => {
    const schema = textureSetsSchemaPart.scene.textureSets;
    expect(schema.safeParse(['sand01', 'mud02']).success).toBe(true);
    expect(schema.safeParse([{ id: 'sand01' }]).success).toBe(false);
  });

  it("gives a scene's textureSetArrays as sets, a packing, an id and swappable", () => {
    const schema = textureSetsSchemaPart.scene.textureSetArrays;
    expect(
      schema.safeParse([
        { sets: ['sand01', 'mud02'], packing: 'LITE' },
        { id: 'gallery', sets: ['sand01'], packing: 'FULL', swappable: true },
      ]).success
    ).toBe(true);
    for (const bad of [
      { sets: [], packing: 'LITE' },
      { sets: ['sand01'] },
      { sets: ['sand01'], packing: 'LITE', layer: 0 },
    ]) {
      expect(schema.safeParse([bad]).success).toBe(false);
    }
  });
});
