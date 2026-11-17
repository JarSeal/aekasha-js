/**
 * The terrain feature's install state, which its API reads (a leaf: imports nothing).
 * @internal
 */
export const terrainState = {
  /** `terrain()` was installed */
  isInstalled: false,
  /** `physics()` was installed before it: a block's collider can be made */
  hasPhysics: false,
  /** Counts the scene exits: a spawn whose count changed while it awaited was left behind */
  sceneVisit: 0,
};

/**
 * Throws naming `terrain()` when it isn't installed (its API without its feature says so).
 * @internal
 */
export const assertTerrainInstalled = (caller: string) => {
  if (terrainState.isInstalled) return;
  throw new Error(
    `${caller}: the terrain feature isn't installed. List terrain() from 'aekasha/terrain' in InitEngine's features.`
  );
};
