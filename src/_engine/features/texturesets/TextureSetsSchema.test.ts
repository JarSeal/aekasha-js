import { describe, expect, it } from 'vitest';
import { textureSetsSchemaPart } from './TextureSetsSchema';

describe('textureSetsSchemaPart', () => {
  it("gives a scene's textureSets as ids", () => {
    const schema = textureSetsSchemaPart.scene.textureSets;
    expect(schema.safeParse(['sand01', 'mud02']).success).toBe(true);
    expect(schema.safeParse([{ id: 'sand01' }]).success).toBe(false);
  });
});
