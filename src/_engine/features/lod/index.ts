export { registerLodTarget } from '../../kernel/ecs/LodTargets';
export {
  createLodFadeAttribute,
  enableLodDither,
  LOD_FADE_OPAQUE,
} from '../../kernel/render/LodFade';
export { generateCrossQuads } from './impostors/CrossQuads';
export type { CrossQuads, CrossQuadsOptions } from './impostors/CrossQuads';
export type { ImpostorShading } from './impostors/ImpostorBake';
export { IMPOSTOR_EXPORT_FORMAT_VERSION, getImpostorDefSlots } from './impostors/ImpostorFormat';
export type { ImpostorKind } from './impostors/ImpostorFormat';
export { generateOctahedralImpostor } from './impostors/OctahedralImpostor';
export type {
  OctahedralImpostor,
  OctahedralImpostorLayout,
  OctahedralImpostorOptions,
} from './impostors/OctahedralImpostor';
export { resolveAutoLod } from './LodAuto';
export { GLTF_LOD_EXTRAS_KEY } from './LodChainGLTF';
export type { GLTFLodChainsExtras } from './LodChainGLTF';
export {
  GLTF_LOD_FORMAT_VERSION,
  LOD_SIMPLIFY_VERSION,
  resolveLodChainOptions,
} from './LodChainOptions';
export type { LodChainOptions, LodLevelVertices, ResolvedLodChainOptions } from './LodChainOptions';
export { generateLodChain, getLodChain } from './LodChains';
export type { LodChain, LodChainLevel } from './LodChains';
export { lod } from './LodFeature';
export { getLodWorldSphere } from './LodMeasure';
export {
  getLodBias,
  getLodFadeSeconds,
  getLodFrameStats,
  getLodMaxSelectionsPerFrame,
  setLodBias,
  setLodFadeSeconds,
  setLodMaxSelectionsPerFrame,
} from './LodSettings';
export type { LodFrameStats } from './LodSettings';
export { simplifyLodChain } from './LodSimplify';
export type { SimplifiedLevel, SimplifiedLodChain } from './LodSimplify';
export { DEFAULT_LOD_HYSTERESIS, refreshLodBounds } from './LodSystem';
export type {
  LodAutoDef,
  LodData,
  LodDef,
  LodLevelDef,
  LodResolvedLevel,
  LodTarget,
  MeshLodDef,
} from './LodTypes';
