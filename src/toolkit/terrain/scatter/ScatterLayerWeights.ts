// The terrain material's layer weights on the CPU, at a scatter's points (p308 D4): the material's
// blend (its define, `userData.terrainDefine`) evaluated as its graph does, from the painted source
// (the mesh's vertex colour, or splat maps read back from the GPU) and its rules
// (`evaluateTerrainRulesCPU`, their noise from the macro texture read back), then linearly
// normalized. The height blend's sharper borders aren't modelled: a scatter's mask is soft anyway.
import {
  evaluateTerrainRulesCPU,
  type TerrainRule,
  type TerrainRulePoint,
  type TerrainRuleNoiseTexels,
} from 'aekasha/toolkit/geometry';
import {
  getPaintedLayerCount,
  getPaintedSource,
  getSplatMapCount,
  type TerrainBlendDefine,
  type TerrainRuleDefine,
} from '../material/TerrainDefine';

/**
 * How a block's layers are weighed, ready to evaluate: the material's blend, its layer count, and
 * the texels its splat maps and rules' noise read.
 * @internal
 */
export type ScatterLayerWeigher = {
  /** The material's layers (1 for a material that isn't a terrain material) */
  layerCount: number;
  /**
   * Each layer's weight at a point, normalized to sum to 1, into `out` (`layerCount` long)
   * @param color the vertex colour there, RGBA 0..1
   * @param u the block's UV there (`x / size + 0.5`), what the splat maps are read at
   * @param v the block's V (`z / size + 0.5`)
   * @param point the world position and unit normal, which the rules measure
   */
  weigh: (
    color: Float32Array,
    u: number,
    v: number,
    point: TerrainRulePoint,
    out: Float32Array
  ) => Float32Array;
};

/**
 * A resolved rule as the CPU evaluation takes it: the define's nulls left out.
 * @internal
 */
export const toTerrainRule = (rule: TerrainRuleDefine): TerrainRule => {
  const range = (r: TerrainRuleDefine['slope']) =>
    r && {
      ...(r.min !== null ? { min: r.min } : {}),
      ...(r.max !== null ? { max: r.max } : {}),
      softness: r.softness,
    };
  return {
    layer: rule.layer,
    ...(rule.slope ? { slope: range(rule.slope)! } : {}),
    ...(rule.height ? { height: range(rule.height)! } : {}),
    ...(rule.aspect ? { aspect: rule.aspect } : {}),
    ...(rule.noise ? { noise: rule.noise } : {}),
    strength: rule.strength,
  };
};

/** A texel's channel, bilinear and clamped to the edge (a splat map's sampler), 0..1 */
const sampleClamped = (texels: TerrainRuleNoiseTexels, u: number, v: number, channel: number) => {
  const { data, width, height } = texels;
  const tx = Math.min(width - 1, Math.max(0, u * width - 0.5));
  const ty = Math.min(height - 1, Math.max(0, v * height - 0.5));
  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = tx - x0;
  const fy = ty - y0;
  const at = (x: number, y: number) => data[(y * width + x) * 4 + channel];
  const upper = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * fx;
  const lower = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * fx;
  return (upper + (lower - upper) * fy) / 255;
};

/** The painted channels into `out[1..painted - 1]`, the base taking what they leave */
const writePainted = (out: Float32Array, painted: number, channel: (index: number) => number) => {
  let sum = 0;
  for (let layer = 1; layer < painted; layer++) {
    const value = channel(layer - 1);
    out[layer] = value;
    sum += value;
  }
  out[0] = Math.max(0, 1 - sum);
};

/**
 * The weigher of a terrain material's blend (`SINGLE` and a material that isn't a terrain
 * material: layer 0 everywhere).
 * @internal
 * @param blend the material's resolved blend (`readTerrainDefine`'s), or null for one that isn't a
 * terrain material
 * @param layerCount the material's layers
 * @param splatMaps a splat source's maps' texels, one per four painted layers past the base
 * @param noise the macro texture's texels, which a rule with noise reads
 * @throws for a splat source without its maps, or a rule with noise and no texels
 */
export const createScatterLayerWeigher = (
  blend: TerrainBlendDefine | null,
  layerCount: number,
  splatMaps: TerrainRuleNoiseTexels[] = [],
  noise?: TerrainRuleNoiseTexels
): ScatterLayerWeigher => {
  if (!blend || blend.source === 'SINGLE') {
    const weighBase: ScatterLayerWeigher['weigh'] = (_color, _u, _v, _point, out) => {
      out.fill(0);
      out[0] = 1;
      return out;
    };
    return { layerCount: Math.max(1, layerCount), weigh: weighBase };
  }
  const painted = getPaintedLayerCount(blend, layerCount);
  const source = getPaintedSource(blend);
  const mapCount = getSplatMapCount(blend, layerCount);
  if (splatMaps.length < mapCount) {
    throw new Error(
      `the material weighs its layers by ${mapCount} splat map${mapCount > 1 ? 's' : ''}: give their texture ids in params.splatMaps.`
    );
  }
  const rules = blend.rules.map(toTerrainRule);
  if (!noise && rules.some((rule) => rule.noise)) {
    throw new Error("a rule has noise: its macro texture's texels are needed.");
  }
  const weigh: ScatterLayerWeigher['weigh'] = (color, u, v, point, out) => {
    out.fill(0);
    if (source === 'VERTEX_COLOR') {
      writePainted(out, painted, (channel) => color[channel]);
    } else if (source === 'SPLAT_MAP') {
      writePainted(out, painted, (channel) =>
        sampleClamped(splatMaps[channel >> 2], u, v, channel & 3)
      );
    } else {
      out[0] = 1;
    }
    if (rules.length) evaluateTerrainRulesCPU(rules, point, out, noise);
    let sum = 0;
    for (let i = 0; i < layerCount; i++) sum += out[i];
    if (sum > 0) {
      for (let i = 0; i < layerCount; i++) out[i] /= sum;
    } else {
      out[0] = 1;
    }
    return out;
  };
  return { layerCount, weigh };
};
