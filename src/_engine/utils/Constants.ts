/** The power-of-two sizes from 4 to 8192 px as drop-down options (the debug GUIs' shadow map
 * sizes). */
export const FOUR_PX_TO_8K_LIST = [
  { value: 4, text: '4px' },
  { value: 8, text: '8px' },
  { value: 16, text: '16px' },
  { value: 32, text: '32px' },
  { value: 64, text: '64px' },
  { value: 128, text: '128px' },
  { value: 256, text: '256px' },
  { value: 512, text: '512px' },
  { value: 1024, text: '1024px' },
  { value: 2048, text: '2048px' },
  { value: 4096, text: '4096px' },
  { value: 8192, text: '8192px' },
];

/**
 * The texture slots of three's materials (`map`, `normalMap`, …): the keys whose value is a
 * texture, which the material registry resolves from texture ids and releases with a material.
 * @internal
 */
export const textureMapKeys = [
  'map',
  'alphaMap',
  'aoMap',
  'bumpMap',
  'envMap',
  'emissiveMap',
  'lightMap',
  'matcap',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'specularMap',
  'displacementMap',
  'anisotropyMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'sheenRoughnessMap',
  'sheenColorMap',
  'specularIntensityMap',
  'specularColorMap',
  'thicknessMap',
  'transmissionMap',
] as const;
