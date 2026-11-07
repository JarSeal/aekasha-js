// Which owners hold each registered asset (geometry, texture, material, import record). An owner
// key is a scene id (what the scene loaded) or `sceneId#cellKey` (what a streaming cell's content
// loaded, p353: `getCellOwnerKey`). A registration takes the current owner: the owner scope's
// (`runInAssetOwnerScope`, a streaming cell's content units), else the scene that was loading, or
// current, when the asset was registered. A cache hit adds the current owner to the asset's
// (`retagAssetOwner`), so an asset two scenes or cells got is held by both, and SceneAssetRelease.ts
// frees it only once neither holds it. Assets registered before the first scene load have no owner,
// and no release frees them.
//
// A scope lasts for a synchronous call: an async load captures it at its call
// (`getAssetOwnerScope`) and registers under it after its awaits (`runInAssetOwnerScope`), so the
// assets it registers go to the cell that started it. Without a scope, a registration after an
// await takes the scene owner of that moment, as before owner keys.
//
// Keyed by the registered object itself, not its id or userData: setTextureOpts replaces a
// texture's userData, a clone copies it, and a deleted asset's entry goes with its object.
// This module has no imports: SceneLoader pushes the owner scene in with setAssetOwnerScene().

/** One owner (the common case: no array), or several, the latest last */
type Owners = string | string[];

const owners = new WeakMap<object, Owners>();
let ownerSceneId: string | null = null;
/** The scope's owner while `runInAssetOwnerScope` runs: undefined outside one, null for none */
let scopeOwner: string | null | undefined;

const NO_OWNERS: readonly string[] = [];

/**
 * Sets the scene that new registrations (and cache hits) belong to. SceneLoader calls this when a
 * load starts, with the scene being loaded, which then stays the owner while it is current.
 * @internal
 */
export const setAssetOwnerScene = (sceneId: string | null) => {
  ownerSceneId = sceneId;
};

/**
 * The owner key of a streaming cell's assets: `sceneId#cellKey`, or `sceneId#cellKey/layer` for
 * one of the cell's other content layers (p353 Phase 5 D10: `far`, `kept`), so a layer's release
 * frees nothing another layer of the cell still loads. The GPU memory tab groups the keys by the
 * part before `#`.
 * @internal
 */
export const getCellOwnerKey = (sceneId: string, cellKey: number, layer?: string) =>
  layer ? `${sceneId}#${cellKey}/${layer}` : `${sceneId}#${cellKey}`;

const HASH = 35; // '#'

/**
 * Whether an owner key is the scene's own or one of its streaming cells'.
 * @internal
 */
export const isSceneOwnerKey = (owner: string, sceneId: string) =>
  owner.startsWith(sceneId) &&
  (owner.length === sceneId.length || owner.charCodeAt(sceneId.length) === HASH);

/** The owner a registration takes now: the scope's, else the scene's. */
const getCurrentOwner = () => (scopeOwner !== undefined ? scopeOwner : ownerSceneId);

/**
 * The owner scope in force (undefined outside one): what an async load captures at its call, to
 * register under after its awaits with {@link runInAssetOwnerScope}.
 * @internal
 */
export const getAssetOwnerScope = (): string | null | undefined => scopeOwner;

/**
 * Runs `fn` with `owner` as the owner of what it registers or gets from the cache, over the
 * scene's: synchronously (a scope ends at an `await` inside `fn`). `undefined` runs `fn` with no
 * scope (the scene's owner); `null`, with no owner. Scopes nest.
 * @internal
 */
export const runInAssetOwnerScope = <T>(owner: string | null | undefined, fn: () => T): T => {
  if (owner === undefined && scopeOwner === undefined) return fn();
  const prev = scopeOwner;
  scopeOwner = owner;
  try {
    return fn();
  } finally {
    scopeOwner = prev;
  }
};

/**
 * Records the owner of a newly registered asset (none before the first scene load).
 * @internal
 */
export const recordAssetOwner = (asset: object) => {
  const owner = getCurrentOwner();
  if (owner) owners.set(asset, owner);
};

/**
 * Adds the current owner to an asset returned from the cache (the latest owner, so a scene's
 * release keeps what the next scene got). An asset without an owner (registered before the first
 * scene load) is never claimed.
 * @internal
 */
export const retagAssetOwner = (asset: object) => {
  const owner = getCurrentOwner();
  const current = owners.get(asset);
  if (!owner || current === undefined || current === owner) return;
  if (typeof current === 'string') {
    owners.set(asset, [current, owner]);
    return;
  }
  const at = current.indexOf(owner);
  if (at !== -1) current.splice(at, 1);
  current.push(owner);
};

/**
 * Gives an asset derived from another (eg. a LOD level from its base geometry) the same owners,
 * or none.
 * @internal
 */
export const copyAssetOwner = (from: object, to: object) => {
  const current = owners.get(from);
  if (current === undefined) owners.delete(to);
  else owners.set(to, typeof current === 'string' ? current : current.slice());
};

/**
 * The asset's latest owner (the one that last registered it or got it from the cache), or
 * undefined if it has no owner.
 * @internal
 */
export const getAssetOwner = (asset: object): string | undefined => {
  const current = owners.get(asset);
  return typeof current === 'string' ? current : current?.[current.length - 1];
};

/**
 * Every owner of the asset, the latest last (empty without one). A new array unless empty: debug
 * code's.
 * @internal
 */
export const getAssetOwners = (asset: object): readonly string[] => {
  const current = owners.get(asset);
  if (current === undefined) return NO_OWNERS;
  return typeof current === 'string' ? [current] : current.slice();
};

/**
 * A release's step for one asset: when owners `isReleased` doesn't match hold it too, the matched
 * ones are dropped and it returns false (the asset stays theirs). Returns true when the matched
 * owners alone hold it, keeping them: the caller frees the asset, or leaves it with them while
 * it's still in use, so their next release tries again. False for an asset none of them holds.
 * @internal
 */
export const releaseAssetOwners = (
  asset: object,
  isReleased: (owner: string) => boolean
): boolean => {
  const current = owners.get(asset);
  if (current === undefined) return false;
  if (typeof current === 'string') return isReleased(current);
  let kept: string[] | null = null;
  for (let i = 0; i < current.length; i++) {
    if (!isReleased(current[i])) (kept ??= []).push(current[i]);
  }
  if (!kept) return true;
  if (kept.length !== current.length) owners.set(asset, kept.length === 1 ? kept[0] : kept);
  return false;
};
