import { describe, expect, it } from 'vitest';
import { float, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import {
  doesPackingStoreNormal,
  getSurfacePackingOutputs,
  packSurfaceOutputs,
  type PackableSurface,
} from './PackSurface';

const surface: PackableSurface = {
  albedo: vec3(0.5, 0.4, 0.3) as unknown as Node<'vec3'>,
  height: float(0.6) as unknown as Node<'float'>,
  roughness: float(0.8) as unknown as Node<'float'>,
  ao: float(0.9) as unknown as Node<'float'>,
  normal: vec3(0, 0, 1) as unknown as Node<'vec3'>,
};

describe('packSurfaceOutputs', () => {
  it("writes each packing's slots (p303 D2), in the packing's order", () => {
    expect(Object.keys(packSurfaceOutputs(surface, 'FULL'))).toEqual([
      'albedoHeight',
      'normal',
      'orm',
    ]);
    expect(Object.keys(packSurfaceOutputs(surface, 'LITE'))).toEqual([
      'albedoRough',
      'normalHeight',
    ]);
    expect(Object.keys(packSurfaceOutputs(surface, 'MINIMAL'))).toEqual(['albedoHeight']);
  });

  it('needs a normal for FULL and LITE only', () => {
    const flat = { ...surface, normal: undefined };
    expect(() => packSurfaceOutputs(flat, 'FULL')).toThrow(/FULL packing stores a normal/);
    expect(() => packSurfaceOutputs(flat, 'LITE')).toThrow(/LITE packing stores a normal/);
    expect(() => packSurfaceOutputs(flat, 'MINIMAL')).not.toThrow();
    expect(doesPackingStoreNormal('MINIMAL')).toBe(false);
    expect(doesPackingStoreNormal('LITE')).toBe(true);
  });
});

describe('getSurfacePackingOutputs', () => {
  it('bakes the albedo slots sRGB and the rest linear', () => {
    expect(getSurfacePackingOutputs('FULL')).toEqual([
      { name: 'albedoHeight', colorSpace: 'SRGB' },
      { name: 'normal', colorSpace: 'LINEAR' },
      { name: 'orm', colorSpace: 'LINEAR' },
    ]);
    expect(getSurfacePackingOutputs('LITE').map((output) => output.colorSpace)).toEqual([
      'SRGB',
      'LINEAR',
    ]);
  });
});
