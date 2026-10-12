/**
 * The target layout as rules (p602 Phase 2): where every file of `src/_engine/`, `src/toolkit/`
 * and `src/app/` goes. `moveMap.ts` applies them to the tracked tree and writes `moveMap.json`,
 * which the codemod (`applyMoveMap.ts`) reads. (p606 made its own moves, the generated data and
 * the gameplay and test code, and their rules left with them; p608 moved the engine and p609 the
 * toolkit and the app, whose rules now describe their layouts, p608 D9 and p609 D5.)
 *
 * - A rule's `from` is a repo-relative file, or a folder ending in `/`. The longest matching
 *   `from` wins, so a file rule beats its folder's rule and the order here doesn't matter.
 * - A folder rule keeps the path under it and makes each `.ts` module's name PascalCase (p602 D7:
 *   `layers/atmosphere.ts` → `layers/Atmosphere.ts`); a file rule's `to` is the final name.
 * - The exceptions to a rule are file rules with their reason in `note`: they are the "edited by
 *   hand" part of the map, kept here so the map can be generated again on a fresh `main`.
 * - A file no rule maps is outside the layout, which fails `moveMap.ts`: a new folder gets a rule
 *   here, with the layout's docs (the root `CLAUDE.md`'s Three-folder split, the Hub).
 */
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

/**
 * Keep rules for the folders one level below `prefix` (`materials/<id>/`, `scenes/<sceneId>/`),
 * or two (`models/<category>/<id>/`): a file directly in `prefix`, or above that depth, has no
 * rule and fails `moveMap.ts`.
 */
const getSubfolderRules = (prefix: string, depth: number, files: string[]): MoveRule[] => {
  const folders = new Set<string>();
  for (const f of files) {
    if (!f.startsWith(prefix)) continue;
    const parts = f.slice(prefix.length).split('/');
    if (parts.length > depth) folders.add(`${prefix}${parts.slice(0, depth).join('/')}/`);
  }
  return [...folders].map((folder) => ({ from: folder, to: folder, plan: 'p609' }));
};

/**
 * The toolkit's layout since p609's move (D1, D5): code by category, each with its entry, and the
 * assets by id. Models, textures and sky boxes are asset JSONs reached by id, so no entry.
 */
const getToolkitRules = (files: string[]): MoveRule[] => [
  ...['ecs', 'geometry', 'materials'].map(
    (category): MoveRule => ({
      from: `${T}${category}/index.ts`,
      to: `${T}${category}/index.ts`,
      plan: 'p609',
      note: `the \`aekasha/toolkit/${category}\` entry (p606)`,
    })
  ),
  // A component and its system, put on an entity
  { from: `${T}ecs/effects/`, to: `${T}ecs/effects/`, plan: 'p609' },
  { from: `${T}ecs/gameplay/`, to: `${T}ecs/gameplay/`, plan: 'p609' },
  { from: `${T}geometry/generate/`, to: `${T}geometry/generate/`, plan: 'p609' },
  { from: `${T}geometry/scatter/`, to: `${T}geometry/scatter/`, plan: 'p609' },
  {
    from: `${T}geometry/SeededRandom.ts`,
    to: `${T}geometry/SeededRandom.ts`,
    plan: 'p609',
    note: 'the generators share it; the simulation lint points at it until p610',
  },
  {
    from: `${T}materials/TriplanarProjection.ts`,
    to: `${T}materials/TriplanarProjection.ts`,
    plan: 'p609',
    note: 'the TSL helper the triplanar materials share',
  },
  // One folder per material (`<id>.material.json`, `<id>.tsl.ts`), texture or sky box; a model
  // folder per category (`brand/`, later p450's `reference/` and `nature/`)
  ...getSubfolderRules(`${T}materials/`, 1, files),
  ...getSubfolderRules(`${T}models/`, 2, files),
  ...getSubfolderRules(`${T}textures/`, 1, files),
  ...getSubfolderRules(`${T}skyboxes/`, 1, files),
];

/**
 * The asset type folders of the app's shared assets (p609 D2): an asset two scenes use sits in
 * its type's folder, one only a scene uses in that scene's folder.
 */
const APP_ASSET_FOLDERS = [
  'cameras',
  'geometries',
  'importedAssets',
  'impostors',
  'lights',
  'materials',
  'meshes',
  'postFx',
  'skyboxes',
  'textures',
];

/**
 * The app's layout since p609's move (D2, D5): one folder per scene, `scenes/<sceneId>/` (its
 * scene JSON, scene file, `_dbg__` module, Hub image, its own modules and the assets only it
 * uses), the examples (the Hub's example rule reads `examples/<name>/`) and the shared assets'
 * type folders. A file anywhere else has no rule and fails `moveMap.ts`.
 */
const getAppRules = (files: string[]): MoveRule[] => [
  ...getSubfolderRules(`${A}scenes/`, 1, files),
  { from: `${A}examples/`, to: `${A}examples/`, plan: 'p609' },
  ...APP_ASSET_FOLDERS.map((f): MoveRule => ({ from: `${A}${f}/`, to: `${A}${f}/`, plan: 'p609' })),
];

export const getMoveRules = (files: string[]): MoveRule[] => [
  ...ENGINE_RULES,
  ...getToolkitRules(files),
  ...getAppRules(files),
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
