import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeHeightmapR16, getHeightmapShape } from './heightmapShape';

describe("terrainBlockTest's heightmap", () => {
  it('is the committed file', () => {
    const file = readFileSync(path.resolve(__dirname, 'terrainBlockTestHeightmap.r16'));
    expect(new Uint8Array(file)).toEqual(encodeHeightmapR16());
  });

  it('stays within the 16 bits', () => {
    for (let u = 0; u <= 1; u += 1 / 64) {
      for (let v = 0; v <= 1; v += 1 / 64) {
        const share = getHeightmapShape(u, v);
        expect(share >= 0 && share <= 1).toBe(true);
      }
    }
  });
});
