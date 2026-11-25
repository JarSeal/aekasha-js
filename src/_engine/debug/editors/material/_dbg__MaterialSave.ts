// The material editor's save source (p355 §2.1, Phase 6): the overrides of
// `AEK_debugMatEditorMat_<id>` aren't bound to a scene, so each is a change of the current scene,
// saved as that scene's entry when its JSON lists the material and Not saveable otherwise (its
// editor changes stay). The entry is the latest one with the overrides over it, `params` and
// `inputs` by key and `nodes` by socket then input (the gather's merge), without the values the
// file has already, each value compared whole: the gather replaces a value whole, so a vector cut
// down to its changed components would lose the others.
import { getCurrentSceneId } from '../../../kernel/scene/Scene';
import { registerSaveSource, type SaveChange } from '../../SaveData';
import {
  findSceneAssetFile,
  getLatestSaveEntry,
  getSceneListItem,
  pruneFlatSaveEntry,
  toSaveEntryWrite,
} from '../../_dbg__SaveEntries';
import { getMaterialAssets } from './_dbg__MaterialEditorAssets';
import { SETUP_INPUTS } from './_dbg__MaterialEditorParams';
import {
  getMaterialRecordIds,
  readMaterialOverrides,
  setMaterialOverride,
  type MaterialEditorOverrides,
  type MaterialOverrideSection,
} from './_dbg__MaterialEditorStore';

/** The save source's id */
export const MATERIAL_SAVE_SOURCE_ID = 'material';

/** A Not saveable material change's reason when the current scene doesn't list it */
export const NOT_IN_THIS_SCENE = 'not in this scene';

type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** An override's place in the record, as `setMaterialOverride` takes it */
type OverridePath = { section: MaterialOverrideSection; path: string };

/** Each collected change's material and overrides, for `onSaved` */
const changeKeys = new WeakMap<SaveChange, { materialId: string; paths: OverridePath[] }>();

/** The overrides' places, in the record's terms (`setup.<key>` for `inputs`) and as the change's
 * summary ('params.roughness', 'inputs.glow', 'nodes.colorNode.gridScale') */
const getOverridePaths = ({ params = {}, nodes = {}, inputs = {} }: MaterialEditorOverrides) => [
  ...Object.keys(params).map((key) => ({
    record: { section: 'params' as const, path: key },
    summary: `params.${key}`,
  })),
  ...Object.keys(inputs).map((key) => ({
    record: { section: 'nodes' as const, path: `${SETUP_INPUTS}.${key}` },
    summary: `inputs.${key}`,
  })),
  ...Object.entries(nodes).flatMap(([socket, socketInputs]) =>
    Object.keys(socketInputs).map((input) => ({
      record: { section: 'nodes' as const, path: `${socket}.${input}` },
      summary: `nodes.${socket}.${input}`,
    }))
  ),
];

/** The latest entry with the overrides over it: `params` and `inputs` by key, `nodes` by socket
 * then input, each value replaced whole */
export const mergeMaterialEntry = (latest: Obj, overrides: MaterialEditorOverrides): Obj => {
  const entry: Obj = { ...latest };
  for (const key of ['params', 'inputs'] as const) {
    const values = overrides[key];
    if (values && Object.keys(values).length) {
      const latestValues = latest[key];
      entry[key] = { ...(isObj(latestValues) ? latestValues : {}), ...values };
    }
  }
  if (overrides.nodes && Object.keys(overrides.nodes).length) {
    const nodes: Obj = isObj(latest.nodes) ? { ...latest.nodes } : {};
    for (const [socket, socketInputs] of Object.entries(overrides.nodes)) {
      const latestInputs = nodes[socket];
      nodes[socket] = { ...(isObj(latestInputs) ? latestInputs : {}), ...socketInputs };
    }
    entry.nodes = nodes;
  }
  return entry;
};

/** The values of `values` that differ from `base`'s, each compared whole; undefined when none */
const pruneValues = (values: unknown, base: unknown) => {
  if (!isObj(values)) return values;
  const kept = Object.entries(values).filter(
    ([key, value]) => !isObj(base) || !(key in base) || !isEqual(value, base[key])
  );
  return kept.length ? Object.fromEntries(kept) : undefined;
};

/**
 * An entry without the values the file has already (`file`: its JSON without the entry): a
 * `params` or `inputs` value and a `nodes` socket's input compared whole, any other key flat; an
 * emptied group or socket is dropped.
 */
export const pruneMaterialEntry = (entry: Obj, file: unknown): Obj => {
  const fileObj = isObj(file) ? file : {};
  const { params, inputs, nodes, ...rest } = entry;
  const result: Obj = pruneFlatSaveEntry(rest, fileObj);
  const prunedParams = pruneValues(params, fileObj.params);
  if (prunedParams !== undefined) result.params = prunedParams;
  const prunedInputs = pruneValues(inputs, fileObj.inputs);
  if (prunedInputs !== undefined) result.inputs = prunedInputs;
  if (isObj(nodes)) {
    const fileNodes = isObj(fileObj.nodes) ? fileObj.nodes : {};
    const kept = Object.entries(nodes)
      .map(([socket, socketInputs]) => [socket, pruneValues(socketInputs, fileNodes[socket])])
      .filter(([, socketInputs]) => socketInputs !== undefined);
    if (kept.length) result.nodes = Object.fromEntries(kept);
  } else if (nodes !== undefined) {
    result.nodes = nodes;
  }
  return result;
};

/** The material's file for the scene, or why there's none */
const findMaterialFile = (sceneId: string | null, materialId: string) => {
  if (!getMaterialAssets()[materialId]) return { unsaveable: 'material not found' };
  if (!sceneId || getSceneListItem('materials', sceneId, materialId) === undefined) {
    return { unsaveable: NOT_IN_THIS_SCENE };
  }
  return findSceneAssetFile({ list: 'materials', registry: 'materials' }, sceneId, materialId);
};

const collectMaterialChanges = (): SaveChange[] => {
  const sceneId = getCurrentSceneId();
  const changes: SaveChange[] = [];
  for (const materialId of getMaterialRecordIds()) {
    const overrides = readMaterialOverrides(materialId);
    const paths = getOverridePaths(overrides);
    if (!paths.length) continue;
    const file = findMaterialFile(sceneId, materialId);
    const change: SaveChange = {
      id: `${sceneId}:${materialId}`,
      label: `Material "${materialId}"`,
      scope: 'SCENE',
      ...(sceneId ? { sceneId } : {}),
      path: 'path' in file ? file.path : null,
      ...('unsaveable' in file ? { unsaveable: file.unsaveable } : {}),
      summary: paths.map((item) => item.summary),
      build: ({ json }) => {
        // A saveable change has its scene
        const id = sceneId as string;
        const { __saveData: _saveData, ...fileValues } = json as Obj;
        const merged = mergeMaterialEntry(getLatestSaveEntry(json, id) ?? {}, overrides);
        return toSaveEntryWrite(json, id, pruneMaterialEntry(merged, fileValues));
      },
    };
    changeKeys.set(change, { materialId, paths: paths.map((item) => item.record) });
    changes.push(change);
  }
  return changes;
};

/** Drops the saved overrides from the records: the settings and the camera stay, and so does an
 * override of another value added after the collect. The editor's copy shows the saved values
 * already: the reload makes it again from the scene's new entry (made again now, it would show
 * the dev data from before the save until then). */
const onMaterialsSaved = (changes: SaveChange[]) => {
  for (const change of changes) {
    const saved = changeKeys.get(change);
    if (!saved) continue;
    for (const { section, path } of saved.paths) {
      setMaterialOverride(saved.materialId, section, path, undefined);
    }
  }
};

/** Registers the material editor's save source (its view's registration, at the boot). */
export const registerMaterialSaveSource = () =>
  registerSaveSource({
    id: MATERIAL_SAVE_SOURCE_ID,
    label: 'Materials',
    collect: collectMaterialChanges,
    onSaved: onMaterialsSaved,
  });
