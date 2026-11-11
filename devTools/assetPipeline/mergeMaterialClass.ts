import path from 'path';
import {
  MERGE_MATERIAL_SLOTS,
  ORM_SOURCE_MAP_KEYS,
  type MaterialAsset,
  type MergeMaterialAsset,
  type MergeMaterialEntry,
  type MergeMaterialSlot,
} from '../../src/_engine/schemas';
import { textureMapKeys } from '../../src/_engine/utils/Constants';
import { stableStringify } from '../../src/_engine/utils/StableStringify';
import { toRepoPath } from './sources';

/**
 * A merge material palette's compatibility class (p374 D1), checked from its members' material
 * JSONs: every member a `STANDARD` material, opaque or alpha-tested, with only the maps the
 * palette has a slot for, agreeing on every parameter that is one draw's state (`side`,
 * `alphaTest`, …). The parameter table's (D3: colour, opacity, emissive, roughness, metalness,
 * normal and AO scales) may differ. The gatherer fails a palette with an error; the asset pipeline
 * leaves it out. Each member is read from its own JSON: a scene's save entry over its `params` isn't
 * (a warning).
 */

/** A material JSON by id, as the pipeline or the gatherer has it */
export type MaterialLookup = (
  id: string
) => { jsonFile: string; data: Pick<MaterialAsset, 'type' | 'params' | '__saveData'> } | undefined;

/** A palette member that passed its own checks: a `STANDARD` material's id, JSON and `params` */
export type MergeMaterialMember = {
  id: string;
  /** Absolute */
  jsonFile: string;
  params: Record<string, unknown>;
};

/** A palette's class check: its problems, and each member's maps by slot */
export type MergeMaterialClass = {
  /** Each names the member (its palette index, id and JSON) and the property */
  errors: string[];
  warnings: string[];
  /** By palette index: undefined for an id that isn't a material JSON's, or a member of another
   * type */
  members: (MergeMaterialMember | undefined)[];
  /** By palette index: each member's parameter table entry (undefined as in `members`) */
  entries: (MergeMaterialEntry | undefined)[];
  /**
   * Per slot the palette has, each member's maps in it by key (a texture's id), by palette index:
   * `{}` for a member without one. `orm` holds only the keys its `from` lists.
   */
  maps: Partial<Record<MergeMaterialSlot, Record<string, string>[]>>;
};

/** The table's parameters (D3), one entry per member, so they may differ: three's
 * `MeshStandardMaterial` values for the ones a member's JSON leaves out */
const ENTRY_DEFAULTS: MergeMaterialEntry = {
  color: 0xffffff,
  opacity: 1,
  emissive: 0x000000,
  emissiveIntensity: 1,
  roughness: 1,
  metalness: 0,
  normalScale: [1, 1],
  aoMapIntensity: 1,
};

const ENTRY_PARAMS = new Set(Object.keys(ENTRY_DEFAULTS));

/** Not the material's state */
const IGNORED_PARAMS = new Set(['name']);

const MAP_KEYS = new Set<string>(textureMapKeys);

/** Each slot's material maps */
const SLOT_MAP_KEYS: Record<MergeMaterialSlot, readonly string[]> = {
  map: ['map'],
  normalMap: ['normalMap'],
  orm: ORM_SOURCE_MAP_KEYS,
  emissiveMap: ['emissiveMap'],
};

/** three's values for the state parameters a member's JSON may leave out (`Material`,
 * `MeshStandardMaterial`): a missing one is its default */
const STATE_DEFAULTS: Record<string, unknown> = {
  side: 0,
  shadowSide: null,
  transparent: false,
  alphaTest: 0,
  alphaHash: false,
  alphaToCoverage: false,
  premultipliedAlpha: false,
  blending: 1,
  depthTest: true,
  depthWrite: true,
  colorWrite: true,
  polygonOffset: false,
  polygonOffsetFactor: 0,
  polygonOffsetUnits: 0,
  dithering: false,
  toneMapped: true,
  visible: true,
  forceSinglePass: false,
  vertexColors: false,
  flatShading: false,
  fog: true,
  wireframe: false,
  wireframeLinewidth: 1,
  envMapIntensity: 1,
  normalMapType: 0,
  bumpScale: 1,
  displacementScale: 1,
  displacementBias: 0,
  lightMapIntensity: 1,
};

const ALPHA_PARAMS = new Set(['alphaTest', 'alphaHash', 'alphaToCoverage', 'premultipliedAlpha']);

const getStateReason = (key: string) =>
  key === 'side' || key === 'shadowSide'
    ? 'culling is per draw'
    : ALPHA_PARAMS.has(key)
      ? 'a draw has one alpha mode'
      : 'a draw has one material state';

/** A colour parameter's value is black (three's `emissive` default when it's missing) */
const isBlack = (value: unknown): boolean => {
  if (value === undefined || value === null) return true;
  if (typeof value === 'number') return value === 0;
  if (typeof value === 'string') return /^(#0{3}|#0{6}|0x0+|black)$/i.test(value.trim());
  if (Array.isArray(value)) return value.every((v) => v === 0);
  if (typeof value === 'object') return Object.values(value).every((v) => v === 0);
  return false;
};

const isEmissive = (params: Record<string, unknown>) =>
  (!!params.emissiveMap || !isBlack(params.emissive)) && params.emissiveIntensity !== 0;

const formatValue = (value: unknown) => (value === undefined ? 'unset' : stableStringify(value));

const formatIds = (ids: string[]) => ids.map((id) => `"${id}"`).join(', ');

/** The slot a map key belongs to, whatever the palette has */
const findSlotOf = (key: string) =>
  MERGE_MATERIAL_SLOTS.find((slot) => SLOT_MAP_KEYS[slot].includes(key));

/** A member's maps: problems with a map key (no slot, not in `from`, not a merge material's) */
const checkMemberMaps = (
  palette: MergeMaterialAsset,
  params: Record<string, unknown>,
  label: string,
  errors: string[]
) => {
  const ormFrom: readonly string[] = palette.slots.orm?.from ?? ORM_SOURCE_MAP_KEYS;
  for (const [key, value] of Object.entries(params)) {
    if (!MAP_KEYS.has(key) || value === null || value === undefined) continue;
    if (typeof value !== 'string') {
      errors.push(`${label}: params.${key} isn't a texture's id`);
      continue;
    }
    const slot = findSlotOf(key);
    if (!slot) {
      errors.push(
        `${label}: params.${key}: a merge material has no ${key} (its slots: ${MERGE_MATERIAL_SLOTS.join(', ')})`
      );
    } else if (!palette.slots[slot]) {
      errors.push(`${label}: params.${key}: the palette has no ${slot} slot (slots.${slot})`);
    } else if (slot === 'orm' && !ormFrom.includes(key)) {
      errors.push(`${label}: params.${key}: slots.orm's "from" leaves ${key} out`);
    }
  }
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** A `normalScale` as `[x, y]`: an array or `{ x, y }` of two numbers, else undefined */
const readNormalScale = (value: unknown): [number, number] | undefined => {
  const [x, y] = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? [(value as { x?: unknown }).x, (value as { y?: unknown }).y]
      : [];
  if (Array.isArray(value) && value.length !== 2) return undefined;
  return isFiniteNumber(x) && isFiniteNumber(y) ? [x, y] : undefined;
};

/** A member's table entry from its `params` (three's default for a missing one); an error for a
 * value of the wrong kind */
const readEntry = (
  params: Record<string, unknown>,
  label: string,
  errors: string[]
): MergeMaterialEntry => {
  const entry: MergeMaterialEntry = { ...ENTRY_DEFAULTS, normalScale: [1, 1] };
  const fail = (key: string, expected: string) =>
    errors.push(`${label}: params.${key} is ${formatValue(params[key])}: ${expected}`);
  for (const key of ['color', 'emissive'] as const) {
    const value = params[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' || isFiniteNumber(value)) entry[key] = value;
    else fail(key, "a colour (a '#rrggbb' or CSS string, or a hex number)");
  }
  const numberKeys = [
    'opacity',
    'emissiveIntensity',
    'roughness',
    'metalness',
    'aoMapIntensity',
  ] as const;
  for (const key of numberKeys) {
    const value = params[key];
    if (value === undefined || value === null) continue;
    if (isFiniteNumber(value)) entry[key] = value;
    else fail(key, 'a number');
  }
  if (params.normalScale !== undefined && params.normalScale !== null) {
    const normalScale = readNormalScale(params.normalScale);
    if (normalScale) entry.normalScale = normalScale;
    else fail('normalScale', 'two numbers, [x, y] or { x, y }');
  }
  return entry;
};

/** A member's own checks; returns it when it can join (a `STANDARD` material) */
const checkMember = (
  palette: MergeMaterialAsset,
  index: number,
  findMaterial: MaterialLookup,
  result: MergeMaterialClass
): MergeMaterialMember | undefined => {
  const id = palette.materials[index];
  const found = findMaterial(id);
  if (!found) {
    result.errors.push(`materials[${index}] "${id}": not a material JSON's id (*.material.json)`);
    return undefined;
  }
  const label = `materials[${index}] "${id}" (${toRepoPath(path.resolve(found.jsonFile))})`;
  const { type } = found.data;
  if (type !== 'STANDARD') {
    result.errors.push(
      `${label}: type ${type}: ${
        type.endsWith('NODEMATERIAL')
          ? "a TSL material's sockets are its file's, unknown to the merge material, so it isn't merged (p374 open question 1)"
          : type === 'PHYSICAL'
            ? 'clearcoat, sheen and transmission aren’t in a merge material: use STANDARD'
            : 'a merge material shades as STANDARD (MeshStandardMaterial): only STANDARD materials join it'
      }`
    );
    return undefined;
  }
  const params = (found.data.params ?? {}) as Record<string, unknown>;
  if (params.transparent === true) {
    result.errors.push(
      `${label}: params.transparent: a merge material is opaque or alpha-tested, never transparent`
    );
  }
  checkMemberMaps(palette, params, label, result.errors);
  result.entries[index] = readEntry(params, label, result.errors);
  const scenes = Object.entries(found.data.__saveData ?? {})
    .filter(([, entries]) => entries?.[0] && 'params' in entries[0] && entries[0].params)
    .map(([sceneId]) => sceneId);
  if (scenes.length) {
    result.warnings.push(
      `${label}: the save entries of ${formatIds(scenes)} change its params, and the palette reads the JSON's own`
    );
  }
  return { id, jsonFile: found.jsonFile, params };
};

/** Every state parameter the members don't agree on: one error each, naming every value's members */
const checkSharedState = (members: MergeMaterialMember[], errors: string[]) => {
  const keys = new Set<string>();
  for (const { params } of members) {
    for (const key of Object.keys(params)) {
      if (ENTRY_PARAMS.has(key) || IGNORED_PARAMS.has(key) || MAP_KEYS.has(key)) continue;
      // Refused on its own
      if (key === 'transparent' && params[key] === true) continue;
      keys.add(key);
    }
  }
  for (const key of keys) {
    const byValue = new Map<string, string[]>();
    for (const { id, params } of members) {
      const value = params[key] ?? STATE_DEFAULTS[key];
      const text = formatValue(value);
      byValue.set(text, [...(byValue.get(text) ?? []), id]);
    }
    if (byValue.size < 2) continue;
    const values = [...byValue].map(([value, ids]) => `${value} in ${formatIds(ids)}`);
    errors.push(
      `params.${key} differs: ${values.join('; ')} (${getStateReason(key)}: the members must agree${key in STATE_DEFAULTS ? `; unset is three's ${formatValue(STATE_DEFAULTS[key])}` : ''})`
    );
  }
};

/** Each slot's maps by member, and the warnings about a slot no member or one member uses */
const collectSlotMaps = (
  palette: MergeMaterialAsset,
  members: (MergeMaterialMember | undefined)[],
  result: MergeMaterialClass
) => {
  const ormFrom: readonly string[] = palette.slots.orm?.from ?? ORM_SOURCE_MAP_KEYS;
  for (const slot of MERGE_MATERIAL_SLOTS) {
    if (!palette.slots[slot]) continue;
    const keys = slot === 'orm' ? ormFrom : SLOT_MAP_KEYS[slot];
    const maps = members.map((member) => {
      const entry: Record<string, string> = {};
      for (const key of keys) {
        const value = member?.params[key];
        if (typeof value === 'string') entry[key] = value;
      }
      return entry;
    });
    result.maps[slot] = maps;
    const users = members.filter((member, index) => member && Object.keys(maps[index]).length);
    const names = keys.join(', ');
    if (!users.length) {
      result.warnings.push(
        `slots.${slot}: no member has a map for it (${names}), so no array is built`
      );
    } else if (users.length === 1 && slot !== 'emissiveMap') {
      result.warnings.push(
        `slots.${slot}: only "${users[0]!.id}" has a map for it (${names}), and every member's shader samples it (D1: is the slot worth it?)`
      );
    }
  }
  const emissive = members.filter((member) => member && isEmissive(member.params));
  if (emissive.length === 1 && members.length > 1) {
    result.warnings.push(
      `only "${emissive[0]!.id}" is emissive, and the merge material adds emissive for every member (D1)`
    );
  }
};

/**
 * Checks a palette's members against the merge material's class (p374 D1). Errors (each naming
 * the member and the property): an id that isn't a material JSON's, a type other than `STANDARD`,
 * `transparent`, a map without its slot (or left out of `orm`'s `from`), a map a merge material
 * doesn't have, a table parameter of the wrong kind (a colour, a number, `normalScale`'s two
 * numbers), and a state parameter the members don't agree on (a missing one is three's
 * default). Warnings: a slot no member uses, a feature (a slot, emissive) only one member uses, a
 * member whose scene save entries change its params.
 */
export const checkMergeMaterialClass = (
  palette: MergeMaterialAsset,
  findMaterial: MaterialLookup
): MergeMaterialClass => {
  const result: MergeMaterialClass = {
    errors: [],
    warnings: [],
    members: [],
    entries: [],
    maps: {},
  };
  result.members = palette.materials.map((_, index) =>
    checkMember(palette, index, findMaterial, result)
  );
  const members = result.members.filter((member): member is MergeMaterialMember => !!member);
  checkSharedState(members, result.errors);
  collectSlotMaps(palette, result.members, result);
  return result;
};
