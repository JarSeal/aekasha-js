// What createMaterial and createGeometry tell the debug env when an id is taken (i050): they
// return the registered asset and build nothing, so the props of a call that differ from those the
// id was created with are ignored. Only called behind IS_DEBUG_ENV, so a production build has none.
import { lwarn } from '../../utils/Logger';

/** Props the comparison skips: `debugData` doesn't change what's built, `id` is the same one */
const SKIPPED_KEYS = new Set(['debugData', 'id']);

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
};

/** A prop value as what it builds from: a texture as its registry id (the scene loader resolves a
 * material's texture ids, code passes them), a colour as its hex, a vector as its components. Any
 * other value as it is (a TSL node or another object is compared by identity) */
const toComparable = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') return value;
  const v = value as {
    isTexture?: boolean;
    isColor?: boolean;
    isVector2?: boolean;
    isVector3?: boolean;
    isVector4?: boolean;
    userData?: { id?: unknown };
    getHexString?: () => string;
    toArray?: () => number[];
  };
  if (v.isTexture) return typeof v.userData?.id === 'string' ? v.userData.id : value;
  if (v.isColor && v.getHexString) return `#${v.getHexString()}`;
  if ((v.isVector2 || v.isVector3 || v.isVector4) && v.toArray) return v.toArray();
  return value;
};

const isEqualProp = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  const ca = toComparable(a);
  const cb = toComparable(b);
  if (ca === cb) return true;
  if (Array.isArray(ca) && Array.isArray(cb)) {
    return ca.length === cb.length && ca.every((item, i) => isEqualProp(item, cb[i]));
  }
  if (isPlainObject(ca) && isPlainObject(cb)) {
    const keys = new Set([...Object.keys(ca), ...Object.keys(cb)]);
    for (const key of keys) if (!isEqualProp(ca[key], cb[key])) return false;
    return true;
  }
  return false;
};

/**
 * The paths of the props that differ between two asset props (`type`, `params.color`): a key
 * whose values are both plain objects (`params`, `inputs`, `nodes`, `staticDefines`, `userData`)
 * by its own keys (a missing one as an empty object), any other by its value. Textures compare by their registry id, colours by their
 * hex, vectors by their components, plain data deeply and anything else by identity; an
 * `undefined` value is a missing key. `debugData` and `id` are skipped.
 * @internal
 * @param created the props the asset was created with
 * @param given the props of a later call
 * @returns the differing paths, empty when none differ
 */
export const getChangedPropPaths = (created: object, given: object): string[] => {
  const a = created as Record<string, unknown>;
  const b = given as Record<string, unknown>;
  const paths: string[] = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (SKIPPED_KEYS.has(key)) continue;
    // A plain object against a missing key is against an empty one: its keys are named
    const av = a[key] === undefined && isPlainObject(b[key]) ? {} : a[key];
    const bv = b[key] === undefined && isPlainObject(a[key]) ? {} : b[key];
    if (isPlainObject(av) && isPlainObject(bv)) {
      const subKeys = new Set([...Object.keys(av), ...Object.keys(bv)]);
      for (const subKey of subKeys) {
        if (!isEqualProp(av[subKey], bv[subKey])) paths.push(`${key}.${subKey}`);
      }
    } else if (!isEqualProp(av, bv)) {
      paths.push(key);
    }
  }
  return paths;
};

/**
 * Warns when a `create*` call's props are ignored because its id is registered already: they
 * differ from those it was created with (naming the paths), or it was registered without any (by
 * `saveMaterial` or `saveBufferGeometry`). Call it behind `IS_DEBUG_ENV`.
 * @internal
 * @param fnName the call, eg. `createMaterial`
 * @param kind the asset's kind in the message, eg. `material`
 * @param id the taken id
 * @param created the props the id was created with, undefined when it was saved without
 * @param given the call's props
 */
export const warnIfAssetPropsIgnored = (
  fnName: string,
  kind: string,
  id: string,
  created: object | undefined,
  given: object
) => {
  if (created === given) return;
  if (!created) {
    lwarn(
      `${fnName}: "${id}" is registered already, by a save without props, so the registered ${kind} is returned and these props are ignored (give this ${kind} an id of its own).`
    );
    return;
  }
  const paths = getChangedPropPaths(created, given);
  if (!paths.length) return;
  lwarn(
    `${fnName}: "${id}" is registered already with other props (${paths.join(', ')}), so the registered ${kind} is returned and these props are ignored (give this ${kind} an id of its own).`
  );
};
