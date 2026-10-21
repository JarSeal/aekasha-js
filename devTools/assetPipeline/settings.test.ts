import { describe, expect, it } from 'vitest';
import type { AssetsConfig } from '../../src/_engine/schemas';
import { BUILTIN_DEFAULTS, createSettingsResolver } from './settings';

// p619 D14: the settings resolver, level by level (the built-in defaults, the config's defaults,
// the matching rules, the profile, the collider default, the asset JSON's own)

const CONFIG: AssetsConfig = {
  defaults: { textures: { default: { maxSize: 2048 } } },
  profiles: {
    hero: { textures: { default: { maxSize: 4096 } }, budget: { vramMB: 64 } },
    small: { textures: { default: { codec: 'etc1s' } } },
  },
  rules: [
    { glob: 'src/app/**/*.png', profile: 'small', slot: 'orm' },
    { glob: 'src/app/heroes/**', profile: 'hero' },
    { glob: 'src/app/raw/**', optimize: false },
    { glob: 'src/app/meshOnly/**', textures: false },
  ],
};

const resolve = (input: Parameters<ReturnType<typeof createSettingsResolver>>[0]) =>
  createSettingsResolver(CONFIG)(input);

describe('createSettingsResolver', () => {
  it('merges the built-in defaults, the config defaults and the slot', () => {
    const settings = resolve({ sourcePath: 'src/other/a.png' });
    expect(settings.slot).toBe('default');
    expect(settings.profile).toBeNull();
    expect(settings.textures && settings.textures.default).toMatchObject({
      codec: 'uastc',
      maxSize: 2048,
      rdo: BUILTIN_DEFAULTS.textures.default.rdo,
    });
    // A slot's own built-in setting goes over the default slot's
    expect(settings.textures && settings.textures.normal).toMatchObject({ rdo: 1 });
    expect(settings.textures && settings.textures.data).toEqual({ codec: 'none', maxSize: 2048 });
  });

  it('takes the last matching rule’s profile, and a rule’s slot', () => {
    const settings = resolve({ sourcePath: 'src/app/heroes/a.png' });
    expect(settings.rules).toEqual(['src/app/**/*.png', 'src/app/heroes/**']);
    expect(settings.profile).toBe('hero');
    expect(settings.slot).toBe('orm');
    expect(settings.textures && settings.textures.default).toMatchObject({ maxSize: 4096 });
    expect(settings.budget.vramMB).toEqual({ mb: 64, from: 'the profile "hero"' });
  });

  it('lets the asset JSON’s own settings, profile and budget win', () => {
    const settings = resolve({
      sourcePath: 'src/app/heroes/a.png',
      optimize: {
        profile: 'small',
        slot: 'default',
        textures: { default: { maxSize: 512 } },
        budget: { vramMB: null },
      },
    });
    expect(settings.profile).toBe('small');
    expect(settings.slot).toBe('default');
    expect(settings.textures && settings.textures.default).toMatchObject({
      codec: 'etc1s',
      maxSize: 512,
    });
    expect(settings.budget).toMatchObject({ vramMB: null, isOwn: true });
  });

  it('passes a side through, naming the first reason', () => {
    expect(resolve({ sourcePath: 'src/app/raw/a.glb' })).toMatchObject({
      textures: false,
      mesh: false,
      passThrough: {
        textures: 'optimize: false in the rule "src/app/raw/**"',
        mesh: 'optimize: false in the rule "src/app/raw/**"',
      },
    });
    const meshOnly = resolve({ sourcePath: 'src/app/meshOnly/a.glb' });
    expect(meshOnly.textures).toBe(false);
    expect(meshOnly.mesh).toMatchObject({ codec: 'meshopt' });
    expect(resolve({ sourcePath: 'src/other/a.glb', optimize: false }).passThrough).toEqual({
      textures: 'optimize: false in the asset JSON',
      mesh: 'optimize: false in the asset JSON',
    });
  });

  it('puts the project switches first', () => {
    const settings = createSettingsResolver(CONFIG, { textures: 'off in src/CONFIG.ts' })({
      sourcePath: 'src/app/raw/a.png',
    });
    expect(settings.passThrough.textures).toBe('off in src/CONFIG.ts');
  });

  it('gives a collider source lossless geometry, unless the asset JSON says otherwise', () => {
    expect(resolve({ sourcePath: 'src/a.glb', isColliderSource: true }).mesh).toMatchObject({
      quantize: false,
      simplify: null,
    });
    const own = resolve({
      sourcePath: 'src/a.glb',
      isColliderSource: true,
      optimize: { mesh: { quantize: true } },
    });
    expect(own.mesh).toMatchObject({ quantize: true });
  });

  it('throws for an unknown profile, in a rule or an asset', () => {
    expect(() => createSettingsResolver({ rules: [{ glob: '**', profile: 'nope' }] })).toThrow(
      /rules\[0\] names an unknown profile "nope"/
    );
    expect(() => resolve({ sourcePath: 'src/a.png', optimize: { profile: 'nope' } })).toThrow(
      /Unknown optimization profile "nope"/
    );
  });
});
