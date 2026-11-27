import { describe, expect, it } from 'vitest';
import { FogAssetSchema, fogSchemaPart } from './FogSchema';

describe('FogAssetSchema', () => {
  it('passes a fog with only its id and mode', () => {
    expect(FogAssetSchema.safeParse({ id: 'f', mode: 'HEIGHT' }).success).toBe(true);
  });

  it.each([
    ['no mode', { id: 'f' }],
    ['an unknown mode', { id: 'f', mode: 'VOLUMETRIC' }],
    ['an empty id', { id: '', mode: 'EXP2' }],
    ['a far not past its near', { id: 'f', mode: 'LINEAR', linear: { near: 50, far: 50 } }],
    ['a far under the default near', { id: 'f', mode: 'LINEAR', linear: { far: 5 } }],
    ['a negative density', { id: 'f', mode: 'EXP2', exp2: { density: -0.1 } }],
    ['a max opacity over 1', { id: 'f', mode: 'HEIGHT', height: { maxOpacity: 1.5 } }],
    ['a glow strength over 1', { id: 'f', mode: 'HEIGHT', sunScattering: { strength: 2 } }],
    ['an unknown key', { id: 'f', mode: 'EXP2', exp2: { densitty: 0.1 } }],
    ['an unknown background', { id: 'f', mode: 'EXP2', background: 'SKY' }],
  ])('refuses %s', (_case, fog) => {
    expect(FogAssetSchema.safeParse(fog).success).toBe(false);
  });

  it('checks a save entry’s values too', () => {
    const fog = (entry: Record<string, unknown>) => ({
      id: 'f',
      mode: 'EXP2',
      __saveData: { scene: [entry] },
    });
    expect(FogAssetSchema.safeParse(fog({ exp2: { density: 0.2 } })).success).toBe(true);
    expect(FogAssetSchema.safeParse(fog({ exp2: { density: -1 } })).success).toBe(false);
  });

  it('is the fogs scene field’s, ids or inline fogs, for the fog feature', () => {
    const field = fogSchemaPart.scene.fogs;
    expect(fogSchemaPart.feature).toBe('fog');
    expect(field.safeParse(['valley', { id: 'mist', mode: 'HEIGHT' }]).success).toBe(true);
    expect(field.safeParse([{ mode: 'HEIGHT' }]).success).toBe(false);
  });
});
