/**
 * The scene pass's texture closure (p302 D6): the textures a scene's data names without listing
 * them are added to its `textures`, so a scene lists a material and gets that material's
 * textures. They come from its materials (listed, a mesh's inline `mat`, a mesh's `matOverrides`):
 * their `params` texture slots and their TSL `inputs` and `nodes` values that name a texture; and
 * from its spot lights' cookies (`map`) and its `backgroundTexture`. Appended after the listed ids,
 * so they resolve, ship-check and stream as listed ones do; an id no asset JSON has fails the
 * gather as a listed one does (p619 G12), naming what names it.
 */
import {
  getTextureInputDependencies,
  type MaterialInputDependency,
} from '../../src/_engine/kernel/assets/MaterialInputRefs';
import { textureMapKeys } from '../../src/_engine/utils/Constants';
import type { SceneRun } from './sceneAssets';

/**
 * The dependency functions of the TSL input forms the gather knows: the runtime resolvers' own
 * (import-free modules, `devTools/engineImports.test.ts`). A resolver with a texture form
 * (p303's texture sets, p299's arrays and atlases) adds its function here. An app's own
 * resolver isn't known here: its values need none, or its scene lists their textures.
 */
const INPUT_DEPENDENCY_FNS: readonly ((value: unknown) => MaterialInputDependency[])[] = [
  getTextureInputDependencies,
];

/** The texture ids by the first thing naming each, for the error */
type Named = Map<string, string>;

const addId = (named: Named, id: string, by: string) => {
  if (id && !named.has(id)) named.set(id, by);
};

/** An input group's values (`inputs`, or a socket of `nodes`): `staticDefines` merges into the
 * defines, so it isn't an input */
const addInputGroupIds = (group: unknown, named: Named, by: string) => {
  if (!group || typeof group !== 'object') return;
  for (const [key, value] of Object.entries(group)) {
    if (key === 'staticDefines') continue;
    for (const getDependencies of INPUT_DEPENDENCY_FNS) {
      for (const dependency of getDependencies(value)) {
        if (dependency.type === 'texture') addId(named, dependency.id, by);
      }
    }
  }
};

/** A material's (or its overrides') textures: its `params` slots, its `inputs` and `nodes` */
const addMaterialIds = (mat: unknown, named: Named, by: string) => {
  if (!mat || typeof mat !== 'object') return;
  const { params, inputs, nodes } = mat as { params?: unknown; inputs?: unknown; nodes?: unknown };
  if (params && typeof params === 'object') {
    for (const key of textureMapKeys) {
      const id = (params as Record<string, unknown>)[key];
      if (typeof id === 'string') addId(named, id, by);
    }
  }
  addInputGroupIds(inputs, named, by);
  if (nodes && typeof nodes === 'object') {
    for (const socket of Object.values(nodes)) addInputGroupIds(socket, named, by);
  }
};

/** Every texture id the scene's resolved data names, by what names it */
const getNamedTextureIds = ({ scene }: SceneRun): Named => {
  const named: Named = new Map();
  for (const mat of scene.materials ?? []) {
    if (typeof mat !== 'string') addMaterialIds(mat, named, `the material "${mat.id}"`);
  }
  for (const mesh of scene.meshes ?? []) {
    if (typeof mesh === 'string') continue;
    const by = `the mesh "${mesh.props.appId ?? mesh.entityOpts?.appId ?? '(no appId)'}"`;
    addMaterialIds(mesh.props.mat, named, by);
    addMaterialIds(mesh.props.matOverrides, named, `${by}'s matOverrides`);
  }
  for (const light of scene.lights ?? []) {
    if (typeof light === 'string') continue;
    const { map, appId } = light.lightProps as { map?: unknown; appId?: string };
    if (typeof map === 'string') addId(named, map, `the light "${appId ?? '(no appId)'}"`);
  }
  if (scene.backgroundTexture) addId(named, scene.backgroundTexture, 'backgroundTexture');
  return named;
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
 * textures are. An id no asset JSON has is logged, naming what names it, and fails the gather.
 */
export const addTextureClosure = (run: SceneRun) => {
  const listed = getListedTextureIds(run);
  const added: string[] = [];
  for (const [id, by] of getNamedTextureIds(run)) {
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
