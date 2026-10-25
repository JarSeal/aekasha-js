/**
 * The repo's layout as rules: the folders every file of `src/_engine/`, `src/toolkit/` and
 * `src/app/` belongs in (the root `CLAUDE.md`'s Three-folder split). p602 wrote them as the
 * target of p600's restructure and p608 and p609 moved the files there, so each rule now keeps
 * its files where they are. `layout.test.ts` fails on a file no rule covers.
 *
 * - A rule's `from` is a repo-relative file, or a folder ending in `/`. The longest matching
 *   `from` wins, so a file rule beats its folder's rule and the order here doesn't matter.
 * - A file outside every rule is outside the layout: a new folder gets a rule here, with the
 *   layout's docs (the root `CLAUDE.md`'s Three-folder split, the Hub).
 * - In the engine and the toolkit a `.ts` module's name is PascalCase (p602 D7), after a `_dbg__`
 *   or `_` prefix; an asset-id file (`asteroid.tsl.ts`), an entry and a declaration keep theirs.
 */

export type LayoutRule = {
  from: string;
  /** Why a file rule exists (its folder has no rule) */
  note?: string;
};

const E = 'src/_engine/';
const K = `${E}kernel/`;
const F = `${E}features/`;
const T = 'src/toolkit/';
const A = 'src/app/';

/**
 * The UI kit's groups (p803 D2): `core/` (CMP, the HUD root, the bounds, motion, icons),
 * `components/` (one module per component), `overlays/` (the windows, the toaster, the overlay
 * layer), `forms/` (the drop-down, p804's fields), `styles/`, `fonts/` and `testing/` (the tests'
 * shared helpers). p805 adds `data/`, p808 `game/`.
 */
const UI_KIT_FOLDERS = ['core', 'components', 'overlays', 'forms', 'styles', 'fonts', 'testing'];

/**
 * The engine's layout since p608's move (D9): a file outside these folders (a new top-level
 * folder or file) has no rule.
 */
const ENGINE_RULES: LayoutRule[] = [
  { from: `${E}index.ts`, note: 'the `aekasha` entry (p606)' },
  {
    from: `${E}ModuleLoad.test.ts`,
    note: 'imports every engine module in Node (p606 Phase 5): the whole engine, so at its root',
  },
  // The kernel: what every app runs, by area (`kernel/<area>/`, its debug modules in `debug/`)
  { from: K },
  // The features: one folder each, its entry, install, worker jobs and debug modules in it
  { from: F },
  // The UI kit by group (p803 D2): a module directly in `ui/` has no rule
  { from: `${E}ui/index.ts`, note: 'the `aekasha/ui` entry (p606)' },
  { from: `${E}ui/CLAUDE.md`, note: "the kit's notes" },
  ...UI_KIT_FOLDERS.map((folder): LayoutRule => ({ from: `${E}ui/${folder}/` })),
  // The debugger framework, pure utilities, the schemas, the declarations (p602 D4-D6)
  { from: `${E}debug/` },
  { from: `${E}utils/` },
  { from: `${E}schemas/` },
  { from: `${E}types/` },
];

/**
 * Rules for the folders one level below `prefix` (`materials/<id>/`, `scenes/<sceneId>/`), or two
 * (`models/<category>/<id>/`): a file directly in `prefix`, or above that depth, has no rule.
 */
const getSubfolderRules = (prefix: string, depth: number, files: string[]): LayoutRule[] => {
  const folders = new Set<string>();
  for (const f of files) {
    if (!f.startsWith(prefix)) continue;
    const parts = f.slice(prefix.length).split('/');
    if (parts.length > depth) folders.add(`${prefix}${parts.slice(0, depth).join('/')}/`);
  }
  return [...folders].map((folder) => ({ from: folder }));
};

/**
 * The toolkit's layout since p609's move (D1, D5): code by category, each with its entry, and the
 * assets by id. Models, textures and sky boxes are asset JSONs reached by id, so no entry.
 */
const getToolkitRules = (files: string[]): LayoutRule[] => [
  ...['ecs', 'geometry', 'materials'].map(
    (category): LayoutRule => ({
      from: `${T}${category}/index.ts`,
      note: `the \`aekasha/toolkit/${category}\` entry (p606)`,
    })
  ),
  // A component and its system, put on an entity
  { from: `${T}ecs/effects/` },
  { from: `${T}ecs/gameplay/` },
  { from: `${T}geometry/generate/` },
  { from: `${T}geometry/scatter/` },
  {
    from: `${T}geometry/SeededRandom.ts`,
    note: "`createSeededRandom`'s deprecated toolkit name (p620 D5), removed in toolkit 3.0.0",
  },
  {
    from: `${T}materials/TriplanarProjection.ts`,
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
 * uses), the examples (the Hub's example rule reads `examples/<name>/`), `shared/` (code several
 * scenes use, a copied toolkit piece among them), the shared assets' type folders and the SBP
 * embed profiles (p611 D7, `profiles/<id>/`: the entry module, its scene and that scene's assets).
 * A file anywhere else has no rule.
 */
const getAppRules = (files: string[]): LayoutRule[] => [
  ...getSubfolderRules(`${A}scenes/`, 1, files),
  { from: `${A}examples/` },
  { from: `${A}shared/` },
  ...getSubfolderRules(`${A}profiles/`, 1, files),
  ...APP_ASSET_FOLDERS.map((f): LayoutRule => ({ from: `${A}${f}/` })),
];

/** Every rule, the subfolder rules read from the files */
export const getLayoutRules = (files: string[]): LayoutRule[] => [
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

/** Whether a file's name follows p602 D7 (anything but a `.ts` module does) */
export const isPascalModuleName = (base: string) =>
  !base.endsWith('.ts') || isNameExempt(base) || toModuleFileName(base) === base;

/** Whether the naming rule applies to a file: the engine's and the toolkit's modules */
export const isPascalScope = (file: string) => file.startsWith(E) || file.startsWith(T);

/** The rule that covers a file (the longest matching `from`); undefined when none does */
export const findLayoutRule = (rules: LayoutRule[], file: string): LayoutRule | undefined => {
  let best: LayoutRule | undefined;
  for (const rule of rules) {
    const matches = rule.from.endsWith('/') ? file.startsWith(rule.from) : file === rule.from;
    if (matches && (!best || rule.from.length > best.from.length)) best = rule;
  }
  return best;
};
