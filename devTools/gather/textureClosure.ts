/**
 * The scene pass's texture closure (p302 D6): the textures a scene's data names without listing
 * them are added to its `textures`, so a scene lists a material and gets that material's
 * textures. They come from its materials (listed, a mesh's inline `mat`, a mesh's `matOverrides`):
 * their `params` texture slots and their TSL `inputs` and `nodes` values that name a texture (a
 * bare id, a texture ref, a texture array layer's array, an atlas cell's slot); and from its spot
 * lights' cookies (`map`) and its `backgroundTexture`. Appended after the listed ids, so they
 * resolve, ship-check and stream as listed ones do; an id no asset JSON has fails the gather as a
 * listed one does (p619 G12), naming what names it. A texture array layer or atlas cell input
 * whose layer, slot or cell its asset doesn't have fails it too (p299 D5). A texture set input
 * (p303 D1) adds its packing's textures and writes the set into the scene's `textureSets`, where
 * the `textureSets()` feature reads it; a set no JSON has, or a packing it lacks, fails the gather.
 */
import {
  type AtlasCellInputRef,
  getAtlasCellInputDependencies,
  getAtlasSlotTextureId,
  getTextureArrayInputDependencies,
  getTextureInputDependencies,
  isAtlasCellInputRef,
  isTextureArrayInputRef,
  type MaterialInputDependency,
  type TextureArrayInputRef,
} from '../../src/_engine/kernel/assets/MaterialInputRefs';
import {
  getTextureSetInputDependencies,
  isTextureSetInputRef,
  type TextureSetInputRef,
} from '../../src/_engine/features/texturesets/TextureSetRefs';
import { textureMapKeys } from '../../src/_engine/utils/Constants';
import type { Registries } from './context';
import type { SceneRun } from './sceneAssets';
import { appendSceneTextureSets } from './textureSets';

/**
 * The dependency functions of the TSL input forms the gather knows: the runtime resolvers' own
 * (import-free modules, `devTools/engineImports.test.ts`), a texture set's reading pass 1's
 * registry. A resolver with a texture form (p303's texture sets, p299's arrays and atlases) adds
 * its function here. An app's own resolver isn't known here: its values need none, or its scene
 * lists their textures.
 */
const INPUT_DEPENDENCY_FNS: readonly ((
  value: unknown,
  reg: Registries
) => MaterialInputDependency[])[] = [
  getTextureInputDependencies,
  getTextureArrayInputDependencies,
  getAtlasCellInputDependencies,
  (value, reg) => getTextureSetInputDependencies(value, (id) => reg.textureSets[id]),
];

/** The texture ids by the first thing naming each, for the error; the texture set ids alike;
 * the inputs that don't fit their asset; and pass 1's registries */
type Named = Map<string, string>;
type Collect = { named: Named; sets: Named; errors: string[]; reg: Registries };

const addId = (named: Named, id: string, by: string) => {
  if (id && !named.has(id)) named.set(id, by);
};

/** Whether the id is a texture of another kind than an array or atlas (the error says so) */
const isOtherTexture = (reg: Registries, id: string) =>
  Boolean(
    reg.textures[id] || reg.textureArrays[id] || reg.atlasSlots[id] || reg.mergeMaterialSlots[id]
  );

/** Why a texture array layer input doesn't fit its array asset, or undefined. An array no asset
 * JSON has is left to the closure's unknown id; a palette slot's array (built at runtime) isn't
 * checked. */
const getArrayLayerError = (reg: Registries, { textureArray: id, layer }: TextureArrayInputRef) => {
  const array = reg.textureArrays[id];
  if (!array) {
    return reg.textures[id] || reg.atlasSlots[id] || reg.atlasSlotIds[id]
      ? `"${id}" isn't a texture array (a *.textureArray.json's id)`
      : undefined;
  }
  const layers = array.__layers ?? [];
  if (typeof layer === 'number') {
    return Number.isInteger(layer) && layer >= 0 && layer < layers.length
      ? undefined
      : `the texture array "${id}" has layers 0-${layers.length - 1}, not ${layer}`;
  }
  if (typeof layer !== 'string') return `its "layer" is neither an index nor a layer name`;
  return layers.includes(layer)
    ? undefined
    : `the texture array "${id}" has no layer "${layer}" (layers: ${layers.join(', ')})`;
};

/** Why an atlas cell input doesn't fit its atlas, or undefined */
const getAtlasCellError = (reg: Registries, { atlas, slot, cell }: AtlasCellInputRef) => {
  const slotIds = reg.atlasSlotIds[atlas];
  if (!slotIds) {
    return isOtherTexture(reg, atlas)
      ? `"${atlas}" isn't a texture atlas (a *.textureAtlas.json's id)`
      : `no texture atlas (a *.textureAtlas.json) has the id "${atlas}"`;
  }
  if (typeof slot !== 'string' || typeof cell !== 'string') {
    return `an atlas cell needs a "slot" and a "cell" besides its "atlas"`;
  }
  const slotId = getAtlasSlotTextureId(atlas, slot);
  if (!slotIds.includes(slotId)) {
    const slots = slotIds.map((id) => id.slice(atlas.length + 1));
    return `the texture atlas "${atlas}" has no slot "${slot}" (slots: ${slots.join(', ')})`;
  }
  const cells = Object.keys(reg.atlasSlots[slotId].__atlas.cells);
  return cells.includes(cell)
    ? undefined
    : `the texture atlas "${atlas}" has no cell "${cell}" (cells: ${cells.join(', ')})`;
};

/** Why a texture set input doesn't fit its set, or undefined (the schema checks the packing's
 * name) */
const getTextureSetError = (reg: Registries, { textureSet: id, packing }: TextureSetInputRef) => {
  const set = reg.textureSets[id];
  if (!set) return `no texture set (a *.textureSet.json) has the id "${id}"`;
  return packing === undefined || set.packings[packing]
    ? undefined
    : `the texture set "${id}" has no packing "${packing}" (packings: ${Object.keys(set.packings).join(', ')})`;
};

/** An input value's error against its asset (a texture array layer, an atlas cell, a texture
 * set), or undefined */
const getInputRefError = (reg: Registries, value: unknown) => {
  if (isTextureArrayInputRef(value)) return getArrayLayerError(reg, value);
  if (isAtlasCellInputRef(value)) return getAtlasCellError(reg, value);
  if (isTextureSetInputRef(value)) return getTextureSetError(reg, value);
  return undefined;
};

/** An input group's values (`inputs`, or a socket of `nodes`): `staticDefines` merges into the
 * defines, so it isn't an input. A value that doesn't fit its asset adds an error, not its id. */
const addInputGroupIds = (group: unknown, { named, sets, errors, reg }: Collect, by: string) => {
  if (!group || typeof group !== 'object') return;
  for (const [key, value] of Object.entries(group)) {
    if (key === 'staticDefines') continue;
    const error = getInputRefError(reg, value);
    if (error) {
      errors.push(`${by}'s input "${key}": ${error}`);
      continue;
    }
    if (isTextureSetInputRef(value)) addId(sets, value.textureSet, by);
    for (const getDependencies of INPUT_DEPENDENCY_FNS) {
      for (const dependency of getDependencies(value, reg)) {
        if (dependency.type === 'texture') addId(named, dependency.id, by);
      }
    }
  }
};

/** A material's (or its overrides') textures: its `params` slots, its `inputs` and `nodes` */
const addMaterialIds = (mat: unknown, collect: Collect, by: string) => {
  if (!mat || typeof mat !== 'object') return;
  const { params, inputs, nodes } = mat as { params?: unknown; inputs?: unknown; nodes?: unknown };
  if (params && typeof params === 'object') {
    for (const key of textureMapKeys) {
      const id = (params as Record<string, unknown>)[key];
      if (typeof id === 'string') addId(collect.named, id, by);
    }
  }
  addInputGroupIds(inputs, collect, by);
  if (nodes && typeof nodes === 'object') {
    for (const socket of Object.values(nodes)) addInputGroupIds(socket, collect, by);
  }
};

/** Every texture id the scene's resolved data names, by what names it, and the inputs that don't
 * fit their asset */
const getNamedTextureIds = ({ scene, reg }: SceneRun): Collect => {
  const collect: Collect = { named: new Map(), sets: new Map(), errors: [], reg };
  const { named } = collect;
  for (const mat of scene.materials ?? []) {
    if (typeof mat !== 'string') addMaterialIds(mat, collect, `the material "${mat.id}"`);
  }
  for (const mesh of scene.meshes ?? []) {
    if (typeof mesh === 'string') continue;
    const by = `the mesh "${mesh.props.appId ?? mesh.entityOpts?.appId ?? '(no appId)'}"`;
    addMaterialIds(mesh.props.mat, collect, by);
    addMaterialIds(mesh.props.matOverrides, collect, `${by}'s matOverrides`);
  }
  for (const light of scene.lights ?? []) {
    if (typeof light === 'string') continue;
    const { map, appId } = light.lightProps as { map?: unknown; appId?: string };
    if (typeof map === 'string') addId(named, map, `the light "${appId ?? '(no appId)'}"`);
  }
  if (scene.backgroundTexture) addId(named, scene.backgroundTexture, 'backgroundTexture');
  return collect;
};

/** The ids the scene's `textures` gives already: listed or inline, and a listed atlas's slots */
const getListedTextureIds = ({ reg, scene }: SceneRun) => {
  const listed = new Set<string>();
  for (const tex of scene.textures ?? []) {
    const id = typeof tex === 'string' ? tex : tex.id;
    if (!id) continue;
    listed.add(id);
    for (const slotId of reg.atlasSlotIds[id] ?? []) listed.add(slotId);
  }
  return listed;
};

/** Whether an asset JSON registers the texture id (as the scene pass resolves a listed one) */
const isKnownTextureId = ({ reg }: SceneRun, id: string) =>
  Boolean(
    reg.textures[id] ||
      reg.textureArrays[id] ||
      reg.atlasSlots[id] ||
      reg.atlasSlotIds[id] ||
      reg.mergeMaterialSlots[id]
  );

/**
 * Appends the textures the scene's materials, spot light cookies and background name, and its
 * `textures` doesn't list, to its `textures` (each once, in the order they're named). Runs after
 * the materials, lights and meshes are resolved (their save entries applied), before the
 * textures are. An id no asset JSON has, and a texture array layer, atlas cell or texture set
 * input its asset doesn't have, is logged, naming what names it, and fails the gather. The texture
 * sets the inputs name are written into the scene's `textureSets` (after its own, each once).
 */
export const addTextureClosure = (run: SceneRun) => {
  const listed = getListedTextureIds(run);
  const added: string[] = [];
  const { named, sets, errors } = getNamedTextureIds(run);
  appendSceneTextureSets(run, [...sets.keys()]);
  for (const error of errors) run.ctx.log.error(`Scene "${run.sceneId}": ${error}.`);
  for (const [id, by] of named) {
    if (listed.has(id)) continue;
    if (!isKnownTextureId(run, id)) {
      run.ctx.log.error(
        `Scene "${run.sceneId}": ${by} names the texture "${id}", which no asset JSON (or only an invalid one) has, and the scene doesn't list it inline.`
      );
      continue;
    }
    added.push(id);
  }
  if (added.length) run.scene.textures = [...(run.scene.textures ?? []), ...added];
};
