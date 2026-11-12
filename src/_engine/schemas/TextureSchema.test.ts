import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { TEXTURE_CONSTANTS, TexOptsSchema } from './TextureSchema';

/** three's constant for each table name, by the name three exports it under */
const THREE_NAMES: { [K in keyof typeof TEXTURE_CONSTANTS]: Record<string, string> } = {
  mapping: {
    UV: 'UVMapping',
    CUBE_REFLECTION: 'CubeReflectionMapping',
    CUBE_REFRACTION: 'CubeRefractionMapping',
    EQUIRECTANGULAR_REFLECTION: 'EquirectangularReflectionMapping',
    EQUIRECTANGULAR_REFRACTION: 'EquirectangularRefractionMapping',
  },
  wrapping: {
    REPEAT: 'RepeatWrapping',
    CLAMP_TO_EDGE: 'ClampToEdgeWrapping',
    MIRRORED_REPEAT: 'MirroredRepeatWrapping',
  },
  magFilter: { NEAREST: 'NearestFilter', LINEAR: 'LinearFilter' },
  minFilter: {
    NEAREST: 'NearestFilter',
    NEAREST_MIPMAP_NEAREST: 'NearestMipmapNearestFilter',
    NEAREST_MIPMAP_LINEAR: 'NearestMipmapLinearFilter',
    LINEAR: 'LinearFilter',
    LINEAR_MIPMAP_NEAREST: 'LinearMipmapNearestFilter',
    LINEAR_MIPMAP_LINEAR: 'LinearMipmapLinearFilter',
  },
  type: {
    UNSIGNED_BYTE: 'UnsignedByteType',
    BYTE: 'ByteType',
    SHORT: 'ShortType',
    UNSIGNED_SHORT: 'UnsignedShortType',
    INT: 'IntType',
    UNSIGNED_INT: 'UnsignedIntType',
    FLOAT: 'FloatType',
    HALF_FLOAT: 'HalfFloatType',
    UNSIGNED_SHORT_4444: 'UnsignedShort4444Type',
    UNSIGNED_SHORT_5551: 'UnsignedShort5551Type',
    UNSIGNED_INT_248: 'UnsignedInt248Type',
    UNSIGNED_INT_5999: 'UnsignedInt5999Type',
    UNSIGNED_INT_101111: 'UnsignedInt101111Type',
  },
  format: {
    ALPHA: 'AlphaFormat',
    RGB: 'RGBFormat',
    RGBA: 'RGBAFormat',
    DEPTH: 'DepthFormat',
    DEPTH_STENCIL: 'DepthStencilFormat',
    RED: 'RedFormat',
    RED_INTEGER: 'RedIntegerFormat',
    RG: 'RGFormat',
    RG_INTEGER: 'RGIntegerFormat',
    RGB_INTEGER: 'RGBIntegerFormat',
    RGBA_INTEGER: 'RGBAIntegerFormat',
  },
};

describe('TEXTURE_CONSTANTS', () => {
  test("each name's number is three's constant", () => {
    for (const [field, table] of Object.entries(TEXTURE_CONSTANTS)) {
      const names = THREE_NAMES[field as keyof typeof TEXTURE_CONSTANTS];
      expect(Object.keys(table)).toEqual(Object.keys(names));
      for (const [name, value] of Object.entries(table)) {
        expect(value, `${field}.${name}`).toBe((THREE as Record<string, unknown>)[names[name]]);
      }
    }
  });
});

describe('TexOptsSchema', () => {
  test('parses a name to its number and keeps a number', () => {
    const parsed = TexOptsSchema.parse({
      wrapS: 'REPEAT',
      wrapT: 1002,
      minFilter: 'LINEAR_MIPMAP_LINEAR',
      magFilter: 'NEAREST',
      mapping: 'EQUIRECTANGULAR_REFLECTION',
      type: 'HALF_FLOAT',
      format: 'RG',
    });
    expect(parsed).toEqual({
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.MirroredRepeatWrapping,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.NearestFilter,
      mapping: THREE.EquirectangularReflectionMapping,
      type: THREE.HalfFloatType,
      format: THREE.RGFormat,
    });
    // The gathered data parses again to the same
    expect(TexOptsSchema.parse(parsed)).toEqual(parsed);
  });

  test("refuses a name or number that isn't the field's, and anisotropy below 1", () => {
    expect(TexOptsSchema.safeParse({ wrapS: 'LINEAR' }).success).toBe(false);
    expect(TexOptsSchema.safeParse({ magFilter: 1008 }).success).toBe(false);
    expect(TexOptsSchema.safeParse({ anisotropy: 0 }).success).toBe(false);
    expect(TexOptsSchema.safeParse({ repeat: [1, 2, 3] }).success).toBe(false);
    expect(TexOptsSchema.safeParse({ anisotropy: 'MAX', repeat: [4, 4] }).success).toBe(true);
  });
});
