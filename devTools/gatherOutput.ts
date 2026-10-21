/**
 * The gatherer's output (`devTools/gatherAppData.ts`): the generated data's three files, written
 * for the app into `src/generated/` and for each embed profile (p611 D7, `sbp.config.ts`) into
 * `src/generated/profiles/<id>/`, holding only that profile's scenes and their loaders.
 */
import fs from 'fs';
import path from 'path';
import { APP_ENTRY, type SbpProfile } from './sbp/config';

export const GENERATED_APP_DATA_FILENAME = 'generatedAppData.json';
export const GENERATED_APP_FNS_FILENAME = 'generatedAppFns.ts';
export const GENERATED_INDEX_FILENAME = 'index.ts';

const INDEX_FILE_CONTENT = `// THIS IS AN AUTO-GENERATED FILE, DO NOT MODIFY!
import type { AppData } from 'aekasha';
import json from './${GENERATED_APP_DATA_FILENAME}';
import { postFxFileObjects, sceneFileObjects, tslMaterialFileObjects } from './${GENERATED_APP_FNS_FILENAME.replace(/\.ts$/, '')}';

/** The app's gathered data: \`InitEngine({ data: appData })\` hands it to the engine. */
export const appData: AppData = {
  json,
  sceneFiles: sceneFileObjects,
  tslMaterialFiles: tslMaterialFileObjects,
  postFxFiles: postFxFileObjects,
};
`;

/** The files the generated code loads on demand, each by id, as a path from `src/` */
export type GeneratedLoaders = {
  /** A scene's `sceneFile` */
  scenes: Record<string, string>;
  /** A material's `tslFile` */
  tslMaterials: Record<string, string>;
  /** A PostFX pass's `tslFile` */
  postFx: Record<string, string>;
};

/** The generated data of one output folder: the JSON (the scenes, and in the app's development
 * data the asset registries) and its loaders */
export type GeneratedOutput = {
  json: { scenes: Record<string, unknown>; [section: string]: unknown };
  loaders: GeneratedLoaders;
};

/** A single-quoted TS string literal (the lint's quotes) of any text: a path or an id */
const toStringLiteral = (text: string) =>
  `'${JSON.stringify(text).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")}'`;

/**
 * An id as an object key: bare when it's an identifier, else quoted (the schemas allow `-`, `.`, a
 * space or a leading digit, p619 §1.4 G4)
 */
const toKey = (id: string) => (/^[A-Za-z_$][\w$]*$/.test(id) ? id : toStringLiteral(id));

const formatLoaderObject = (name: string, loaders: Record<string, string>, prefix: string) => {
  const entries = Object.entries(loaders);
  if (!entries.length) return `export const ${name} = {};\n`;
  return `export const ${name} = {\n${entries
    .map(([id, file]) => `  ${toKey(id)}: () => import(${toStringLiteral(prefix + file)}),\n`)
    .join('')}};\n`;
};

/**
 * `generatedAppFns.ts`: a loader per scene, TSL material and PostFX pass, each an `import()` of its
 * file (one chunk each in a build).
 * @param prefix the path from the output folder to `src/` (`../` for `src/generated/`)
 */
export const formatGeneratedAppFns = (loaders: GeneratedLoaders, prefix: string) => {
  const scenes = Object.entries(loaders.scenes);
  let header = `// THIS IS AN AUTO-GENERATED FILE, DO NOT MODIFY!\n// ALSO, DO NOT MODIFY THE '${GENERATED_APP_DATA_FILENAME}' FILE)!\n`;
  let sceneObject = 'export const sceneFileObjects = {};\n';
  if (scenes.length) {
    header += "import type { SceneData, ScenePrimitiveAssets } from 'aekasha';\n";
    sceneObject =
      'export const sceneFileObjects: {\n' +
      '  [sceneId: string]: (sceneData: {\n' +
      '    sceneData: SceneData;\n' +
      '    assets: ScenePrimitiveAssets;\n' +
      '  }) => Promise<void>;\n' +
      '} = {\n' +
      scenes
        .map(
          ([sceneId, file]) =>
            `  ${toKey(sceneId)}: async ({ sceneData, assets }) => {\n` +
            `    const module = await import(${toStringLiteral(prefix + file)});\n` +
            `    await (\n` +
            `      module as {\n` +
            `        scene: (sceneData: { sceneData: SceneData; assets: ScenePrimitiveAssets }) => Promise<void>;\n` +
            `      }\n` +
            `    ).scene({ sceneData, assets });\n` +
            `  },\n`
        )
        .join('') +
      '};\n';
  }
  return `${header}\n${sceneObject}\n${formatLoaderObject('tslMaterialFileObjects', loaders.tslMaterials, prefix)}\n${formatLoaderObject('postFxFileObjects', loaders.postFx, prefix)}`;
};

/** Writes an output folder's three files */
export const writeGeneratedOutput = (dir: string, output: GeneratedOutput, srcDir: string) => {
  fs.mkdirSync(dir, { recursive: true });
  const prefix = `${path.relative(dir, srcDir).split(path.sep).join('/')}/`;
  fs.writeFileSync(
    path.join(dir, GENERATED_APP_DATA_FILENAME),
    JSON.stringify(output.json, null, 2),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(dir, GENERATED_APP_FNS_FILENAME),
    formatGeneratedAppFns(output.loaders, prefix),
    'utf-8'
  );
  fs.writeFileSync(path.join(dir, GENERATED_INDEX_FILENAME), INDEX_FILE_CONTENT, 'utf-8');
};

/** The profiles that get their own data: every one but the template app's full-page build */
export const getEmbedProfiles = (profiles: readonly SbpProfile[]) =>
  profiles.filter((profile) => profile.entry !== APP_ENTRY);

/** The folder of an embed profile's data under the generated folder */
export const PROFILES_DIR_NAME = 'profiles';

/** The ids a scene lists in a section, resolved (`{ id }`) or not (a string) */
const listIds = (list: unknown) =>
  Array.isArray(list)
    ? list.flatMap((item: unknown) =>
        typeof item === 'string'
          ? [item]
          : item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
            ? [(item as { id: string }).id]
            : []
      )
    : [];

const pick = (record: Record<string, string>, ids: Set<string>) =>
  Object.fromEntries(Object.entries(record).filter(([id]) => ids.has(id)));

/**
 * An embed profile's data: its scenes (in the profile's order, so its first is
 * `mountAekasha`'s default `sceneId`), their scene files, and the TSL material and PostFX files
 * those scenes list. `{ scenes }` in every mode, as a production build has it: the dev registries
 * are for the debugger's asset lists, which an embed doesn't have.
 * @param opts.app the app's output (the resolved scenes and every loader)
 * @param opts.debugSceneIds the scenes marked `isDebugScene` (a production build leaves them out)
 * @returns the output, or the problems (a scene that isn't in the data, a debug scene)
 */
export const selectProfileOutput = (opts: {
  profile: SbpProfile;
  app: GeneratedOutput;
  debugSceneIds: ReadonlySet<string>;
}): { output: GeneratedOutput; errors: string[] } => {
  const { profile, app } = opts;
  const errors: string[] = [];
  const scenes: Record<string, unknown> = {};
  for (const sceneId of profile.scenes ?? []) {
    if (opts.debugSceneIds.has(sceneId)) {
      errors.push(`profile ${profile.id}: scene ${sceneId} is a debug scene (isDebugScene)`);
    } else if (!(sceneId in app.json.scenes)) {
      errors.push(`profile ${profile.id}: no scene ${sceneId} in the gathered data`);
    } else {
      scenes[sceneId] = app.json.scenes[sceneId];
    }
  }
  const sceneData = Object.values(scenes) as { materials?: unknown; postFx?: unknown }[];
  const materialIds = new Set(sceneData.flatMap((scene) => listIds(scene.materials)));
  const postFxIds = new Set(sceneData.flatMap((scene) => listIds(scene.postFx)));
  return {
    output: {
      json: { scenes },
      loaders: {
        scenes: pick(app.loaders.scenes, new Set(Object.keys(scenes))),
        tslMaterials: pick(app.loaders.tslMaterials, materialIds),
        postFx: pick(app.loaders.postFx, postFxIds),
      },
    },
    errors,
  };
};

/** Removes the profile folders under `profilesDir` that no embed profile writes anymore, and the
 * folder itself once it's empty */
export const removeStaleProfileOutputs = (profilesDir: string, profileIds: readonly string[]) => {
  if (!fs.existsSync(profilesDir)) return [];
  const removed: string[] = [];
  for (const entry of fs.readdirSync(profilesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || profileIds.includes(entry.name)) continue;
    fs.rmSync(path.join(profilesDir, entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }
  if (!fs.readdirSync(profilesDir).length) fs.rmdirSync(profilesDir);
  return removed;
};
