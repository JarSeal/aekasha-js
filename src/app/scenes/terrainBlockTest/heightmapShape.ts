// The heightmap block's map (p306 Phase 4): `terrainBlockTestHeightmap.r16`, written from
// `encodeHeightmapR16()` (`heightmapShape.test.ts` fails when the two differ). Its shape is
// asymmetric in x and z, a ramp up towards +x and a mound in the (−x, +z) quarter, so the scene's
// check catches a map read flipped either way.

/** The map's texels per side: a vertex each on the 64 m block */
export const HEIGHTMAP_SIZE = 65;
export const HEIGHTMAP_EXTENT = 64;
/** The world heights the texels' 0..65535 map onto */
export const HEIGHTMAP_RANGE: [number, number] = [-1, 11];

/** The map's height at (u, v), 0..1 each (u along +x, v along +z), as a share of the range */
export const getHeightmapShape = (u: number, v: number) =>
  0.4 * u + 0.55 * Math.exp(-((u - 0.25) ** 2 + (v - 0.7) ** 2) / 0.03);

/** The map's texel at (col, row), 0..65535, the file's rounding */
export const getHeightmapTexel = (col: number, row: number) =>
  Math.round(getHeightmapShape(col / (HEIGHTMAP_SIZE - 1), row / (HEIGHTMAP_SIZE - 1)) * 65535);

/** The raw R16 file: row 0 at −z, column 0 at −x, little-endian */
export const encodeHeightmapR16 = () => {
  const view = new DataView(new ArrayBuffer(HEIGHTMAP_SIZE * HEIGHTMAP_SIZE * 2));
  for (let row = 0; row < HEIGHTMAP_SIZE; row++) {
    for (let col = 0; col < HEIGHTMAP_SIZE; col++) {
      view.setUint16((row * HEIGHTMAP_SIZE + col) * 2, getHeightmapTexel(col, row), true);
    }
  }
  return new Uint8Array(view.buffer);
};
