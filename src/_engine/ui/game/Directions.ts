// The compass's and the minimap frame's directions (p808 D7), without styles, so either imports
// it alone.

/**
 * The eight directions spoken, from north clockwise: the default 'Facing …' words.
 * @internal
 */
export const DIRECTION_NAMES: readonly string[] = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
];

/**
 * Radians to degrees.
 * @internal
 */
export const RAD_TO_DEG = 180 / Math.PI;

/**
 * Degrees in [0, 360).
 * @internal
 */
export const wrapDegrees = (degrees: number) => {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
};

/**
 * The nearest of the eight directions to a bearing in degrees: 0 north, 1 north-east, … 7
 * north-west.
 * @internal
 */
export const getDirectionIndex = (degrees: number) => Math.round(wrapDegrees(degrees) / 45) % 8;
