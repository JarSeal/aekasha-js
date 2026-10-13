import globals from 'globals';
import prettier from 'eslint-plugin-prettier';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import jsdoc from 'eslint-plugin-jsdoc';
import importPlugin from 'eslint-plugin-import';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat();

// The layering (p606, the coding standards' "Layering"): engine ← toolkit ← app. Everything outside
// the engine reaches it through the `aekasha*` entries (devTools/aliases.ts), which the resolver
// below doesn't resolve, so only paths are checked. A glob zone's `except` isn't resolved against
// the base path: it's absolute.
const ROOT = import.meta.dirname;
// The `aekasha/toolkit/<category>` entries' folders
const TOOLKIT_CATEGORIES = ['ecs', 'geometry', 'materials'];
const ENGINE_CONSUMERS = ['src/toolkit/**', 'src/app/**', 'src/generated/**', 'src/*.ts'];
const LAYER_ZONES = [
  {
    target: 'src/_engine/**',
    from: ['src/toolkit/**', 'src/app/**', 'src/generated/**', 'src/*.ts'],
    message:
      'The engine imports only engine code. Configuration and data come in through InitEngine.',
  },
  {
    target: 'src/toolkit/**',
    from: ['src/app/**', 'src/generated/**', 'src/*.ts'],
    message: "The toolkit doesn't depend on the app.",
  },
  {
    target: ENGINE_CONSUMERS,
    from: 'src/_engine/**',
    message:
      'Import the engine through its entries (`aekasha`, `aekasha/<feature>`): a deep path is internal.',
  },
  ...TOOLKIT_CATEGORIES.map((category) => ({
    target: `src/toolkit/${category}/**`,
    from: 'src/toolkit/**',
    except: [`${ROOT}/src/toolkit/${category}/**`],
    message: 'Import another toolkit category through its entry (`aekasha/toolkit/<category>`).',
  })),
  {
    target: ['src/app/**', 'src/*.ts'],
    from: 'src/toolkit/**',
    message: 'Import the toolkit through its entries (`aekasha/toolkit/<category>`).',
  },
  {
    // The TSL material files are assets: the generated code imports them by path
    target: 'src/generated/**',
    from: 'src/toolkit/**',
    except: [`${ROOT}/src/toolkit/**/*.tsl.ts`],
    message: "The generated code imports only the toolkit's TSL material files.",
  },
];
// Static imports only: a dynamic `import()` isn't checked, and is how the debug loader reaches them
const DEBUG_MODULE_IMPORT = {
  regex: '(^|/)_dbg__',
  allowTypeImports: true,
  message:
    'A `_dbg__` module loads through the debug loader (`import()`, loadDebugModuleAsync / useDebug), so production builds drop it. `import type` is fine.',
};
const ENTRY_IMPORT = {
  regex: '^aekasha(/|$)',
  message:
    'Engine code imports engine code by relative path: an entry imported inside the engine makes barrel cycles.',
};
// Debug code is found by name, wherever its feature keeps it (p608 D4)
const DEBUG_FILES = ['src/**/_dbg__*.ts'];

// The simulation: code that runs at APP_PHYSICS_STEP or inside the physics step, on the main
// thread or in the physics worker. It must run identically on every machine, so it counts time in
// steps and draws randomness from a seeded RNG. Two feature folders, without what else they hold
// (p608 D5: the set the lint covered before the move).
const SIMULATION_FILES = [
  'src/_engine/features/physics/**/*.ts',
  'src/_engine/features/character/**/*.ts',
  'src/toolkit/ecs/gameplay/MovingPlatform.ts',
  'src/toolkit/ecs/effects/MutualGravity.ts',
];
// What the two feature folders hold besides the simulation: the installs and entries, the
// physics import extension and worker test, the debug modules
const SIMULATION_IGNORES = [
  'src/_engine/features/*/index.ts',
  'src/_engine/features/*/debug/**',
  'src/_engine/features/physics/PhysicsFeature.ts',
  'src/_engine/features/physics/import/**',
  'src/_engine/features/physics/worker/PhysicsWorker.test.ts',
];
const STEP_TIME_MESSAGE =
  'Simulation time is the step index (getPhysicsSubStepIndex), never the wall clock. Profiling reads use readStatsClock (utils/StatsClock.ts).';
const SIMULATION_RESTRICTED_PROPERTIES = [
  {
    object: 'Math',
    property: 'random',
    message:
      'Simulation randomness is seeded: createSeededRandom (toolkit/geometry/SeededRandom.ts) until the RNG service exists.',
  },
  { object: 'performance', property: 'now', message: STEP_TIME_MESSAGE },
  { object: 'Date', property: 'now', message: STEP_TIME_MESSAGE },
];
const SIMULATION_RESTRICTED_SYNTAX = [
  { selector: 'NewExpression[callee.name="Date"]', message: STEP_TIME_MESSAGE },
  { selector: 'CallExpression[callee.name="Date"]', message: STEP_TIME_MESSAGE },
];

export default [
  // Generated/vendored files (DRACO/Basis decoders copied by devTools/copyDecoders.ts, TypeDoc
  // output, the Hub's build)
  { ignores: ['src/public/draco/', 'src/public/basis/', 'docs-api/', 'dist-hub/'] },

  // Old .eslintrc config (old style for plugins that don't support flat config)
  ...compat.config({
    root: true,
    ignorePatterns: ['dist', 'node_modules'],
    plugins: ['prettier', '@typescript-eslint'],
    extends: [
      'plugin:@typescript-eslint/eslint-recommended',
      'plugin:@typescript-eslint/recommended',
      'plugin:prettier/recommended',
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': 1,
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
      // Type-only imports as a top-level `import type`, which is erased, so a type can't pull its
      // module (and three) into the physics worker. The inline `import { type X }` alone compiles
      // to `import {}` under verbatimModuleSyntax: a side-effect import that still loads it.
      // `typeof import('…')` annotations are erased too, and type the debug loader's modules.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'separate-type-imports', disallowTypeAnnotations: false },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
    },
  }),

  // Flat config (new style)
  {
    files: ['**/*.ts'],
    ignores: ['dist/*', 'node_modules/*'],
    plugins: { prettier, typescriptEslint },
    rules: {
      'no-console': 1,
      'no-var': 1,
      camelcase: 1,
      'arrow-body-style': 1,
      semi: [2, 'always'],
    },
    languageOptions: {
      ecmaVersion: 12,
      sourceType: 'module',
      globals: {
        commonjs: true,
        browser: true,
        es6: true,
        ...globals.browser,
      },
    },
  },

  // JSDoc's shape (the coding standards' JSDoc style). Only the shape: whether an export has a
  // comment at all is the documentation ratchet's (`yarn verify:baselines`), so no `require-*`
  // rule. Types live in TypeScript, never in a tag, and `@param name text` has no hyphen.
  {
    files: ['src/**/*.ts', 'devTools/**/*.ts'],
    ignores: ['src/generated/**'],
    plugins: { jsdoc },
    settings: { jsdoc: { mode: 'typescript' } },
    rules: {
      // Only where it adds: a tag may document some parameters, or one property of a destructured
      // one (`opts.id`), without the others
      'jsdoc/check-param-names': [
        'error',
        { disableMissingParamChecks: true, checkDestructured: false },
      ],
      'jsdoc/check-tag-names': [
        'error',
        {
          // TypeDoc's tags. A type parameter is `@template` (TypeDoc reads it as `@typeParam`)
          definedTags: ['remarks', 'privateRemarks', 'defaultValue', 'category'],
        },
      ],
      'jsdoc/empty-tags': 'error',
      'jsdoc/no-types': 'error',
      'jsdoc/escape-inline-tags': 'error',
      'jsdoc/check-alignment': 'error',
      'jsdoc/no-multi-asterisks': 'error',
      'jsdoc/require-asterisk-prefix': 'error',
      'jsdoc/tag-lines': ['error', 'never', { startLines: 0 }],
      'jsdoc/sort-tags': 'error',
      'jsdoc/require-hyphen-before-param-description': ['error', 'never'],
      'jsdoc/informative-docs': 'error',
    },
  },

  // The layering (see LAYER_ZONES)
  {
    files: ['src/**/*.ts'],
    plugins: { import: importPlugin },
    settings: { 'import/resolver': { node: { extensions: ['.ts', '.js', '.json'] } } },
    rules: {
      'import/no-restricted-paths': ['error', { basePath: ROOT, zones: LAYER_ZONES }],
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: [DEBUG_MODULE_IMPORT] }],
    },
  },
  // A later entry replaces the rule's options for its files, so each lists all that applies there
  {
    files: ['src/_engine/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [DEBUG_MODULE_IMPORT, ENTRY_IMPORT] },
      ],
    },
  },
  {
    files: DEBUG_FILES,
    rules: { '@typescript-eslint/no-restricted-imports': 'off' },
  },
  {
    files: ['src/_engine/**/_dbg__*.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': ['error', { patterns: [ENTRY_IMPORT] }] },
  },

  // The simulation rules (the coding standards' "The simulation")
  {
    files: SIMULATION_FILES,
    ignores: SIMULATION_IGNORES,
    rules: {
      'no-restricted-properties': ['error', ...SIMULATION_RESTRICTED_PROPERTIES],
      'no-restricted-syntax': ['error', ...SIMULATION_RESTRICTED_SYNTAX],
    },
  },
  // Known violations, each with the plan that removes it. A later entry replaces the rule's
  // options for its file, so it lists what stays restricted there.
  {
    // The tumble impulse's direction (p610: the seeded RNG)
    files: ['src/_engine/features/character/DynamicCharacter.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...SIMULATION_RESTRICTED_PROPERTIES.filter((p) => p.object !== 'Math'),
      ],
    },
  },
  {
    // The wall clock under getPhysGameTime(), which the characters read (p610: step-index time)
    files: ['src/_engine/features/physics/PhysicsWallClock.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...SIMULATION_RESTRICTED_PROPERTIES.filter((p) => p.object !== 'performance'),
      ],
    },
  },
  // The gatherer's output, written unformatted on every gather: `yarn lint --fix` reformatting it
  // would leave a diff that the next gather undoes (a long import path in generatedAppFns.ts)
  { files: ['src/generated/**'], rules: { 'prettier/prettier': 'off' } },
];
