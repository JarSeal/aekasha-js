import { deepMerge } from '../../utils/DeepMerge';
import type { FogInput, FogOverrides } from './FogSchema';
import type { FogDef, FogSunScattering } from './FogTypes';

// A fog's defaults and its resolve (p106 D2), out of FogSchema.ts so the runtime (`setFog`, the
// debug overrides) never imports a zod module: FogSchema.ts' schemas would bring zod into the
// first download (Phase 7's SBP run). The gatherer reaches them through `aekasha/schemas`.

/**
 * A fog's defaults, but `sunScattering.enabled`, which is the mode's (on for `HEIGHT`, off for
 * `LINEAR` and `EXP2`, which then look like three's fog).
 */
export const FOG_DEFAULTS: Readonly<
  Omit<FogDef, 'id' | 'isDefault' | 'mode' | 'sunScattering' | 'debugData'> & {
    sunScattering: Omit<FogSunScattering, 'enabled'>;
  }
> = {
  enabled: true,
  colorSource: 'SKY',
  color: '#b4c0cc',
  linear: { near: 10, far: 500 },
  exp2: { density: 0.005 },
  height: { density: 0.02, baseHeight: 0, falloff: 0.1, startDistance: 0, maxOpacity: 1 },
  sunScattering: { strength: 0.5, exponent: 8 },
  background: 'NONE',
};

/**
 * A fog with every key filled in from {@link FOG_DEFAULTS}, `sunScattering.enabled` from its mode
 * (on for `HEIGHT`). The gatherer resolves each fog once, so a save entry that changes the mode
 * keeps the glow as it was. Changes nothing it's given.
 */
export const resolveFogDef = (input: FogInput): FogDef => {
  const def: FogDef = {
    id: input.id,
    isDefault: input.isDefault ?? false,
    enabled: input.enabled ?? FOG_DEFAULTS.enabled,
    mode: input.mode,
    colorSource: input.colorSource ?? FOG_DEFAULTS.colorSource,
    color: input.color ?? FOG_DEFAULTS.color,
    linear: deepMerge(FOG_DEFAULTS.linear, input.linear),
    exp2: deepMerge(FOG_DEFAULTS.exp2, input.exp2),
    height: deepMerge(FOG_DEFAULTS.height, input.height),
    sunScattering: deepMerge(
      { ...FOG_DEFAULTS.sunScattering, enabled: input.mode === 'HEIGHT' },
      input.sunScattering
    ),
    background: input.background ?? FOG_DEFAULTS.background,
  };
  if (input.debugData) def.debugData = input.debugData;
  return def;
};

/**
 * A resolved fog with a scene's save entry deep merged over it, without the entry's `__meta`
 * stamp. Changes neither argument.
 * @param def the resolved fog ({@link resolveFogDef})
 * @param entry the scene's latest save entry (`__saveData[sceneId][0]`), if there is one
 */
export const applyFogSaveEntry = (def: FogDef, entry?: FogOverrides): FogDef => {
  const overrides: Partial<FogOverrides> = { ...entry };
  delete overrides.__meta;
  return deepMerge(def, overrides);
};
