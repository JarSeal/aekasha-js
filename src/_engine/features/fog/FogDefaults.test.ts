import { describe, expect, it } from 'vitest';
import { applyFogSaveEntry, FOG_DEFAULTS, resolveFogDef } from './FogDefaults';

describe('resolveFogDef', () => {
  it('fills every key in from the defaults', () => {
    expect(resolveFogDef({ id: 'f', mode: 'LINEAR' })).toEqual({
      id: 'f',
      isDefault: false,
      mode: 'LINEAR',
      ...FOG_DEFAULTS,
      sunScattering: { ...FOG_DEFAULTS.sunScattering, enabled: false },
    });
  });

  it('takes the sun glow’s switch from the mode, unless the fog gives it', () => {
    expect(resolveFogDef({ id: 'f', mode: 'HEIGHT' }).sunScattering.enabled).toBe(true);
    expect(resolveFogDef({ id: 'f', mode: 'EXP2' }).sunScattering.enabled).toBe(false);
    const glowing = resolveFogDef({ id: 'f', mode: 'EXP2', sunScattering: { enabled: true } });
    expect(glowing.sunScattering).toEqual({ enabled: true, strength: 0.5, exponent: 8 });
  });

  it('keeps the given values, key by key, and skips an undefined one', () => {
    const def = resolveFogDef({
      id: 'f',
      mode: 'EXP2',
      color: { r: 10, g: 20, b: 30 },
      linear: { far: 80 },
      height: { baseHeight: -5, falloff: undefined },
      debugData: { name: 'Fog' },
    });
    expect(def.color).toEqual({ r: 10, g: 20, b: 30 });
    expect(def.linear).toEqual({ near: 10, far: 80 });
    expect(def.height).toEqual({ ...FOG_DEFAULTS.height, baseHeight: -5 });
    expect(def.debugData).toEqual({ name: 'Fog' });
  });
});

describe('applyFogSaveEntry', () => {
  it('deep merges the entry without its __meta, changing neither argument', () => {
    const def = resolveFogDef({ id: 'f', mode: 'EXP2' });
    const entry = { mode: 'HEIGHT' as const, height: { density: 0.1 }, __meta: { date: 1 } };
    const merged = applyFogSaveEntry(def, entry);
    expect(merged.mode).toBe('HEIGHT');
    expect(merged.height).toEqual({ ...FOG_DEFAULTS.height, density: 0.1 });
    expect(merged).not.toHaveProperty('__meta');
    expect(def.mode).toBe('EXP2');
    expect(def.height.density).toBe(FOG_DEFAULTS.height.density);
    expect(entry.__meta).toEqual({ date: 1 });
    expect(applyFogSaveEntry(def)).toEqual(def);
  });
});
