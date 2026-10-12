/**
 * The target layout as rules (p602 Phase 2): where every file of `src/_engine/` and
 * `src/toolkit/`, and the app files that move, go in p609. `moveMap.ts` applies them to the
 * tracked tree and writes `moveMap.json`, which the codemod (`applyMoveMap.ts`) reads. (p606 made
 * its own moves, the generated data and the gameplay and test code, and their rules left with
 * them; p608 moved the engine, whose rules now describe its layout, p608 D9.)
 *
 * - A rule's `from` is a repo-relative file, or a folder ending in `/`. The longest matching
 *   `from` wins, so a file rule beats its folder's rule and the order here doesn't matter.
 * - A folder rule keeps the path under it and makes each `.ts` module's name PascalCase (p602 D7:
 *   `layers/atmosphere.ts` → `layers/Atmosphere.ts`); a file rule's `to` is the final name.
 * - The exceptions to a rule are file rules with their reason in `note`: they are the "edited by
 *   hand" part of the map, kept here so the map can be generated again on a fresh `main`.
 */
import fs from 'fs';
import path from 'path';

export type MoveAction = 'keep' | 'move' | 'delete' | 'merge' | 'split';
/** The plan that applies the move */
export type MovePlan = 'p608' | 'p609';

export type MoveEntry = {
  /** Target path; `null` for a deleted file */
  to: string | null;
  action: MoveAction;
  plan: MovePlan;
  note?: string;
  /** `split` only: each export's target module */
  split?: Record<string, string>;
};

export type MoveRule = {
  from: string;
  /** Target file or folder (a folder ends in `/`); omitted for `delete` */
  to?: string;
  action?: 'delete' | 'merge' | 'split';
  plan?: MovePlan;
  note?: string;
  split?: Record<string, string>;
};

const E = 'src/_engine/';
const K = `${E}kernel/`;
const F = `${E}features/`;
const T = 'src/toolkit/';
const A = 'src/app/';

/**
 * The engine's layout since p608's move (D9): each folder keeps its files where they are, so a
 * file outside it (a new top-level folder or file) has no rule and fails `moveMap.ts`, and a
 * module name that isn't PascalCase shows as a move to its PascalCase name.
 */
const ENGINE_RULES: MoveRule[] = [
  { from: `${E}index.ts`, to: `${E}index.ts`, note: 'the `aekasha` entry (p606)' },
  {
    from: `${E}ModuleLoad.test.ts`,
    to: `${E}ModuleLoad.test.ts`,
    note: 'imports every engine module in Node (p606 Phase 5): the whole engine, so at its root',
  },
  // The kernel: what every app runs, by area (`kernel/<area>/`, its debug modules in `debug/`)
  { from: K, to: K },
  // The features: one folder each, its entry, install, worker jobs and debug modules in it
  { from: F, to: F },
  // The UI kit, the debugger framework, pure utilities, the schemas, the declarations (p602 D4-D6)
  { from: `${E}ui/`, to: `${E}ui/` },
  { from: `${E}debug/`, to: `${E}debug/` },
  { from: `${E}utils/`, to: `${E}utils/` },
  { from: `${E}schemas/`, to: `${E}schemas/` },
  { from: `${E}types/`, to: `${E}types/` },
];

/** The toolkit's categories (p609 D1, from the p450 prompt) */
const TOOLKIT_RULES: MoveRule[] = [
  ...['ecs', 'geometry', 'materials'].map(
    (category): MoveRule => ({
      from: `${T}${category}/index.ts`,
      to: `${T}${category}/index.ts`,
      plan: 'p609',
      note: `the \`aekasha/toolkit/${category}\` entry (p606)`,
    })
  ),
  { from: `${T}ecs/effects/`, to: `${T}ecs/effects/`, plan: 'p609' },
  {
    from: `${T}ecs/FollowObjectCameraRig.ts`,
    to: `${T}ecs/gameplay/FollowObjectCameraRig.ts`,
    plan: 'p609',
    note: 'moved from the engine (p606 Phase 7, p602 D6); a gameplay piece (p609 D1)',
  },
  {
    from: `${T}ecs/MovingPlatform.ts`,
    to: `${T}ecs/gameplay/MovingPlatform.ts`,
    plan: 'p609',
    note: 'moved from the engine (p606 Phase 7, p602 D6); a gameplay piece (p609 D1)',
  },
  {
    from: `${T}geometry/generateAsteroid.ts`,
    to: `${T}geometry/generate/Asteroid.ts`,
    plan: 'p609',
  },
  { from: `${T}geometry/generateFoliage.ts`, to: `${T}geometry/generate/Foliage.ts`, plan: 'p609' },
  { from: `${T}geometry/generateTerrain.ts`, to: `${T}geometry/generate/Terrain.ts`, plan: 'p609' },
  {
    from: `${T}geometry/scatterOnSurface.ts`,
    to: `${T}geometry/scatter/ScatterOnSurface.ts`,
    plan: 'p609',
  },
  { from: `${T}geometry/seededRandom.ts`, to: `${T}geometry/SeededRandom.ts`, plan: 'p609' },
  {
    from: `${T}materials/triplanarProjection.ts`,
    to: `${T}materials/TriplanarProjection.ts`,
    plan: 'p609',
  },
  {
    from: `${T}models/aekashaSymbol/`,
    to: `${T}models/brand/aekashaSymbol/`,
    plan: 'p609',
    note: 'models by category (p609 D1): brand/, later reference/ and nature/ (p450)',
  },
];

/** A toolkit material is a folder named by its asset id: `materials/<id>/` (p609) */
const getToolkitMaterialRules = (files: string[]): MoveRule[] =>
  files
    .filter((f) => /^src\/toolkit\/materials\/[^/]+\.(material\.json|tsl\.ts)$/.test(f))
    .map((f) => {
      const base = path.basename(f);
      const id = base.split('.')[0];
      return { from: f, to: `${T}materials/${id}/${base}`, plan: 'p609' };
    });

/**
 * The asset files only one scene uses, which go into its folder (p609 D2), by scene id; paths
 * from `src/app/`. A path ending `/` is a folder, one ending `.*` every file of that name (an
 * impostor's JSON, atlas and images). The rest stay in their type folders: a second user (scene
 * JSON, scene code, another asset) makes an asset shared.
 */
const SCENE_ONLY_ASSETS: Record<string, string[]> = {
  largeWorld: [
    'cameras/largeWorldOverview.camera.json',
    'lights/largeWorldAmbient.light.json',
    'lights/largeWorldSun.light.json',
    'impostors/largeWorldTreeCross.*',
  ],
  lodShowcase: [
    'cameras/lodShowcaseCamera.camera.json',
    'impostors/lodShowcaseKnotImpostor.*',
    'impostors/lodShowcaseTreeCross.*',
  ],
  physicsTest: [
    'cameras/physicsTestCamera.camera.json',
    'lights/physicsTestAmbient.light.json',
    'lights/physicsTestSun.light.json',
  ],
  physicsTiers: [
    'cameras/physicsTiersOverview.camera.json',
    'lights/physicsTiersAmbient.light.json',
    'lights/physicsTiersSun.light.json',
  ],
  skyShowcase: ['cameras/skyShowcaseCamera.camera.json'],
  space: ['cameras/spaceCamera.camera.json'],
  thirdPersonGymScene: [
    'cameras/thirdPersonGymCamera.camera.json',
    'lights/thirdPersonGymAmbient.light.json',
    'lights/thirdPersonGymSun.light.json',
  ],
  topDownTestScene: [
    'cameras/topDownTestCamera.camera.json',
    'lights/topDownTestAmbient.light.json',
    'lights/topDownTestSun.light.json',
  ],
  assetCompare: ['skyboxes/assetCompare.skybox.json'],
  textureArrays: [
    'textures/p299TestArray.textureArray.json',
    'textures/p299TestArray1.textureArray.json',
  ],
  textureAtlases: [
    'textures/p299TestAtlas.textureAtlas.json',
    'textures/p299TestAtlasImage.textureAtlas.json',
    'textures/source/p299Atlas/',
  ],
  sceneTestECS: [
    'cameras/mainCamera.camera.json',
    'lights/ambientLight.light.json',
    'materials/testMaterial.material.json',
    'materials/testTslMat.material.json',
    'materials/testTslMat.tsl.ts',
    'meshes/testMesh.mesh.json',
    'meshes/testImportedMesh.mesh.json',
    'geometries/testSphere.geometry.json',
    'importedAssets/testImport.importedAsset.json',
  ],
};

/** `SCENE_ONLY_ASSETS`' rules; a path that names no file throws (the list is out of date) */
const getSceneOnlyAssetRules = (files: string[]): MoveRule[] =>
  Object.entries(SCENE_ONLY_ASSETS).flatMap(([id, paths]) =>
    paths.flatMap((rel): MoveRule[] => {
      const note = `used only by the scene ${id} (p609 D2)`;
      const folder = `${A}scenes/${id}/`;
      const from = `${A}${rel}`;
      if (rel.endsWith('/')) {
        if (!files.some((f) => f.startsWith(from)))
          throw new Error(`SCENE_ONLY_ASSETS: no ${from}`);
        const to = `${folder}${rel.split('/').slice(1).join('/')}`;
        return [{ from, to, plan: 'p609', note }];
      }
      const matches = rel.endsWith('.*')
        ? files.filter((f) => f.startsWith(from.slice(0, -1)))
        : files.filter((f) => f === from);
      if (!matches.length) throw new Error(`SCENE_ONLY_ASSETS: no ${from}`);
      return matches.map((f) => ({
        from: f,
        to: `${folder}${path.posix.basename(f)}`,
        plan: 'p609',
        note,
      }));
    })
  );

/**
 * The app: one folder per scene, `src/app/scenes/<sceneId>/` with its scene JSON, scene file,
 * `_dbg__` module, Hub image and the assets only it uses, named by the scene id (p602 D7, p609
 * D2). The examples keep their folders (the Hub's example rule reads `src/app/examples/`); the
 * shared asset JSONs stay in their type folders.
 */
const getAppSceneRules = (root: string, files: string[]): MoveRule[] => {
  const rules: MoveRule[] = [];
  const sceneJsons = files.filter((f) => /^src\/app\/[^/]+\.scene\.json$/.test(f));
  const dbgModules: Record<string, string> = {
    assetCompare: `${A}_dbg__assetCompare.ts`,
    lodShowcase: `${A}_dbg__lodShowcase.ts`,
    space: `${A}_dbg__spaceDemo.ts`,
  };
  for (const jsonFile of sceneJsons) {
    const json = JSON.parse(fs.readFileSync(path.join(root, jsonFile), 'utf8'));
    const id: string = json.id;
    const folder = `${A}scenes/${id}/`;
    const note = 'the codemod rewrites its `$schema` and `sceneFile` (moveJson.ts)';
    rules.push({ from: jsonFile, to: `${folder}${id}.scene.json`, plan: 'p609', note });
    if (typeof json.sceneFile === 'string') {
      let sceneFile = path.posix.join(A, json.sceneFile);
      if (!sceneFile.endsWith('.ts')) sceneFile += '.ts';
      rules.push({ from: sceneFile, to: `${folder}${id}.ts`, plan: 'p609' });
    }
    const hubImage = `${A}${id}.hub.png`;
    if (files.includes(hubImage)) {
      rules.push({ from: hubImage, to: `${folder}${id}.hub.png`, plan: 'p609' });
    }
    const dbg = dbgModules[id];
    if (dbg) rules.push({ from: dbg, to: `${folder}${path.basename(dbg)}`, plan: 'p609' });
  }
  rules.push({ from: `${A}lodShowcase/`, to: `${A}scenes/lodShowcase/`, plan: 'p609' });
  rules.push({
    from: `${A}characterVisual.ts`,
    to: `${A}scenes/thirdPersonGymScene/characterVisual.ts`,
    plan: 'p609',
    note: 'with the gym (p609); the top-down test imports it from there',
  });
  return rules;
};

export const getMoveRules = (root: string, files: string[]): MoveRule[] => [
  ...ENGINE_RULES,
  ...TOOLKIT_RULES,
  ...getToolkitMaterialRules(files),
  ...getAppSceneRules(root, files),
  ...getSceneOnlyAssetRules(files),
];

/** Whether a `.ts` file keeps its name: an asset-id file (`asteroid.tsl.ts`), an entry, a declaration */
const isNameExempt = (base: string) =>
  base === 'index.ts' || base.endsWith('.d.ts') || /^[^.]+\.(?!test\.)[^.]+\.ts$/.test(base);

/** p602 D7: PascalCase, after a `_dbg__` or `_` prefix; a test follows its module */
export const toModuleFileName = (base: string): string => {
  if (!base.endsWith('.ts') || isNameExempt(base)) return base;
  const prefix = base.startsWith('_dbg__') ? '_dbg__' : base.startsWith('_') ? '_' : '';
  const rest = base.slice(prefix.length);
  return prefix + rest.charAt(0).toUpperCase() + rest.slice(1);
};

export const isPascalModuleName = (base: string) =>
  !base.endsWith('.ts') || isNameExempt(base) || toModuleFileName(base) === base;

const isPascalScope = (target: string) => target.startsWith(E) || target.startsWith(T);

/** The entry for a file, or undefined when no rule matches it */
export const applyMoveRules = (rules: MoveRule[], file: string): MoveEntry | undefined => {
  let best: MoveRule | undefined;
  for (const rule of rules) {
    const matches = rule.from.endsWith('/') ? file.startsWith(rule.from) : file === rule.from;
    if (matches && (!best || rule.from.length > best.from.length)) best = rule;
  }
  if (!best) return undefined;
  const plan = best.plan ?? 'p608';
  const note = best.note ? { note: best.note } : {};
  if (best.action === 'delete') return { to: null, action: 'delete', plan, ...note };
  if (best.action === 'split')
    return { to: file, action: 'split', plan, ...note, split: best.split };
  let to = best.to as string;
  if (best.from.endsWith('/')) {
    const rest = file.slice(best.from.length);
    const dir = path.posix.dirname(rest);
    const base = path.posix.basename(rest);
    const name = isPascalScope(to) ? toModuleFileName(base) : base;
    to = to + (dir === '.' ? '' : `${dir}/`) + name;
  }
  const action = best.action ?? (to === file ? 'keep' : 'move');
  return { to, action, plan, ...note };
};
