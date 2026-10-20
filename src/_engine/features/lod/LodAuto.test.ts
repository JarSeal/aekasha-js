import { describe, expect, test } from 'vitest';
import { LOD_AUTO_REFERENCE_HEIGHT, lodDefFromChain } from './LodAuto';
import type { LodChain } from './LodChains';

const chain = (errors: number[], extent = 2): Pick<LodChain, 'levels' | 'extent'> => ({
  extent,
  levels: errors.map((error, i) => ({
    geometryId: i === 0 ? 'base' : `base#lod${i}`,
    triangles: 100 >> i,
    error,
    vertices: 'BASE',
  })),
});

const AUTO = { auto: true } as const;

// With extent 2, radius 1 and maxPixelError 1, a level of error e is fine below 1 / (1080 e)
const fineBelow = (error: number) => 1 / (LOD_AUTO_REFERENCE_HEIGHT * error);

describe('lodDefFromChain', () => {
  test('uses each level down to where the next one projects to maxPixelError', () => {
    const def = lodDefFromChain(chain([0, 0.01, 0.02, 0.04]), 1, AUTO);

    expect(def.levels).toHaveLength(4);
    expect(def.levels[0]).toEqual({ screenSize: fineBelow(0.01) });
    expect(def.levels[1].screenSize).toBeCloseTo(fineBelow(0.02));
    expect(def.levels[1].geo).toBe('base#lod1');
    expect(def.levels[2].screenSize).toBeCloseTo(fineBelow(0.04));
    expect(def.levels[3]).toEqual({ screenSize: 0, geo: 'base#lod3' });
  });

  test('scales the screen sizes with maxPixelError', () => {
    const def = lodDefFromChain(chain([0, 0.01]), 1, { auto: true, maxPixelError: 4 });

    expect(def.levels[0].screenSize).toBeCloseTo(4 * fineBelow(0.01));
  });

  test('leaves out a level the next one is never worse than', () => {
    const def = lodDefFromChain(chain([0, 0.02, 0.02, 0.04]), 1, AUTO);

    expect(def.levels.map((level) => level.geo)).toEqual([undefined, 'base#lod2', 'base#lod3']);
  });

  test("keeps only the base for a chain that can't be measured", () => {
    expect(lodDefFromChain(chain([0, 0.01]), 0, AUTO).levels).toEqual([{ screenSize: 0 }]);
    expect(lodDefFromChain(chain([0, 0.01], 0), 1, AUTO).levels).toEqual([{ screenSize: 0 }]);
  });

  test('passes the selection settings through, and only those given', () => {
    const def = lodDefFromChain(chain([0, 0.01]), 1, {
      auto: true,
      cullScreenSize: 0.01,
      hysteresis: 0.2,
      bias: 2,
      fadeSeconds: 0.5,
    });

    expect(def).toMatchObject({ cullScreenSize: 0.01, hysteresis: 0.2, bias: 2, fadeSeconds: 0.5 });
    expect(Object.keys(lodDefFromChain(chain([0, 0.01]), 1, AUTO))).toEqual(['levels']);
  });
});
