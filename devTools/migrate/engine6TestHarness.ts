/**
 * The engine 6 codemod's tests' program (p622 D10): virtual modules against stand-in entries in
 * engine 6's shape, migrated twice (the second run must change nothing). `engine6.test.ts` and
 * `engine6Reshape.test.ts` share it.
 */
import path from 'node:path';
import ts from 'typescript';
import { expect } from 'vitest';
import { createMigrationProgram, migrateEngine6 } from './engine6';
import { ENGINE6_RULES } from './engine6Rules';

// The modules live in a folder that doesn't exist; the entries are stand-ins in engine 6's shape
// (the old names gone), as an app sees them after taking the new engine
const VIRTUAL = path.resolve('/__engine6__');
const abs = (file: string) => path.join(VIRTUAL, file);

const ENTRIES: Record<string, { file: string; text: string }> = {
  aekasha: {
    file: 'engine/index.ts',
    text: [
      "export const ComponentType = { A: 'a' } as const;",
      'export const registerOnAllSceneEnters = () => {};',
      'export const createSeededRandom = (seed: number) => () => seed;',
      'export const getX = () => 1;',
      'export type SceneHooks = { loadStart?: () => void };',
      'export type LoadSceneProps = { sceneId: string };',
      'export type AppConfig = { name?: string };',
      'export const addSceneHooks = (hooks: SceneHooks) => hooks;',
      'export const removeFromGroupEntity = (id: number, o: string, opts?: { deleteMeshes?: boolean }) => id;',
      'export type ECSWorld = { addComponent(id: number): void };',
      'export const getECSWorld = (): ECSWorld => ({ addComponent: () => {} });',
      'export type CreateEntityOpts = { appId?: string; world?: ECSWorld };',
      'export const getScene = (id: string, opts?: { silent?: boolean; throwOnError?: boolean }) => id;',
      'export const createSceneLoader = (l: { id: string }, opts?: { isCurrent?: boolean }) => l;',
      'export const setLightEnabled = (world: ECSWorld, lightId: number, enabled: boolean) => {};',
      'export const getLightTargetId = (world: ECSWorld, lightId: number): number | undefined => 1;',
      'export const createEntity = (opts?: CreateEntityOpts) => 1;',
      ...['createMeshEntity', 'createCameraEntity', 'createGroupEntity', 'createLightEntity'].map(
        (name) => `export const ${name} = (props: object, opts?: CreateEntityOpts) => 1;`
      ),
    ].join('\n'),
  },
  'aekasha/lines': {
    file: 'engine/lines.ts',
    text: [
      "import type { CreateEntityOpts } from 'aekasha';",
      'export const createLineEntity = (props: object = {}, opts?: CreateEntityOpts) => 1;',
    ].join('\n'),
  },
  'aekasha/physics': {
    file: 'engine/physics.ts',
    text: [
      'export type PhysicsState = { timestep: number };',
      'export const getPhysicsState = (): PhysicsState => ({ timestep: 60 });',
      'export type ColliderParams = { type: string; radius?: number; userData?: object };',
      'export type RigidBodyParams = { rigidType: string };',
      'export type PhysicsEntityProps = {',
      '  colliders: ColliderParams | ColliderParams[];',
      '  body?: RigidBodyParams;',
      '  target?: number;',
      '};',
      'export type PhysicsEntityOpts = { id?: string; tierPolicy?: boolean };',
      'export type WorldAPI = { setMaxCcdSubsteps(n: number): void };',
      'export const getPhysicsWorld = (): WorldAPI => ({ setMaxCcdSubsteps: () => {} });',
      'export const createPhysicsEntity = (',
      '  props: PhysicsEntityProps,',
      '  opts?: PhysicsEntityOpts & { world?: object }',
      '): number => 1;',
      'export const physicsTiers = () => ({ id: "physicsTiers" });',
      'export const requestPhysicsTier = (id: number, tier: string) => true;',
      'export const setPhysicsTierPolicy = (policy: object | null) => {};',
      'export const setPhysicsTierPolicyMember = (id: number, member: boolean) => true;',
    ].join('\n'),
  },
  'aekasha/spatial': {
    file: 'engine/spatial.ts',
    text: [
      "import type { ECSWorld } from 'aekasha';",
      ...['joinSpatialDomain', 'leaveSpatialDomain', 'isInSpatialDomain'].map(
        (name) => `export const ${name} = (world: ECSWorld, id: number, domainId: string) => true;`
      ),
      'export const refreshSpatialRadius = (world: ECSWorld, id: number) => {};',
    ].join('\n'),
  },
  'aekasha/lod': {
    file: 'engine/lod.ts',
    text: [
      "import type { ECSWorld } from 'aekasha';",
      'export type LodData = { level: number };',
      'export const getLodWorldSphere = (world: ECSWorld, id: number, lod: LodData, out: object) => true;',
    ].join('\n'),
  },
  'aekasha/instancing': {
    file: 'engine/instancing.ts',
    text: [
      "import type { CreateEntityOpts, ECSWorld } from 'aekasha';",
      'export type InstancePlacement = { x: number };',
      ...['InstancedMeshPool', 'InstancedLodPool'].map((name) =>
        [
          `export interface ${name} {`,
          '  spawn: (placements: InstancePlacement[], opts?: CreateEntityOpts) => number[];',
          '  despawn: (id: number) => boolean;',
          '}',
        ].join('\n')
      ),
      'export const createInstancedMeshPool = (o: { world: ECSWorld }): InstancedMeshPool =>',
      '  ({ spawn: () => [], despawn: () => true });',
    ].join('\n'),
  },
  'aekasha/skybox': {
    file: 'engine/skybox.ts',
    text: [
      'export type SkyBoxDef = { id: string; base?: { type: string } };',
      'export const createSkyBox = (def: SkyBoxDef) => def;',
      'export const setActiveSkyBox = (id: string | null, opts?: { sceneId?: string }) => id;',
      'export type SkyBodyOpts = { index?: number };',
      'export type Vec = { y: number };',
      'export const getSunDirection = (out: Vec, opts?: SkyBodyOpts) => out;',
      'export const getMoonDirection = (out: Vec, opts?: SkyBodyOpts) => out;',
      'export const getSunElevation = (opts?: SkyBodyOpts) => 0;',
      'export const getMoonPhase = (opts?: SkyBodyOpts) => 0;',
    ].join('\n'),
  },
  'aekasha/debug': {
    file: 'engine/debug.ts',
    text: 'export const createDebuggerTab = (def: { id: string }) => def;',
  },
  'aekasha/ui': {
    file: 'engine/ui.ts',
    text: [
      ...[
        'CMPHandle',
        'CMPProps',
        'CMPSettings',
        'CMPListener',
        'CMPListenerCache',
        'CMPListenerCreator',
        'CMPStyle',
        'CMPAttr',
        'CMPClassAction',
        'CMPAnimChain',
        'CMPAnimState',
        'DropDown',
        'AddToastResponse',
      ].map((name) => `export type ${name} = { kind: '${name}' };`),
      'export const createCMP = () => ({});',
      'export type Kbd = { keys: string };',
      'export const createKbd = (o: { keys: string }): Kbd => o;',
      'export type ButtonProps = { label: string; kbd?: Kbd };',
      'export type SplitButtonProps = { label: string; kbd?: Kbd; items: unknown[] };',
      'export type MenuActionItem = { label: string; kbd?: Kbd };',
      "export type MenuCheckboxItem = { type: 'checkbox'; label: string; kbd?: Kbd };",
      'export const createMenu = (items: (MenuActionItem | MenuCheckboxItem)[]) => items;',
      'export const addToast = (): AddToastResponse => ({ kind: "AddToastResponse" });',
      "export const getSvgIcon = (name: string, size?: 'sm' | 'md' | 'lg') => name;",
    ].join('\n'),
  },
  'aekasha/character': {
    file: 'engine/character.ts',
    text: [
      "export type PlayerBrainHoldMode = 'HOLD' | 'TOGGLE';",
      'export type CharacterObject = { id: string; bodyKind: string };',
      'export type CreateCharacterOpts = { id: string; bodyKind: string };',
      'export type DynamicCharacterParams = { config?: { maxVelocity?: number } };',
      'export type DynamicCharacterOpts = DynamicCharacterParams & { id: string };',
      'export type DynamicCharacter = { character: CharacterObject };',
      'export type CharacterCastRecord = { resolvedAtStep: number };',
      'export type CharacterBodyKindField = { bodyKind: string };',
      'export type CharacterBodyPlan<D = number> = CharacterBodyKindField & { dims?: D };',
      'export const createDynamicCharacter = (opts: DynamicCharacterOpts): DynamicCharacter =>',
      "  ({ character: { id: opts.id, bodyKind: '' } });",
    ].join('\n'),
  },
  'aekasha/toolkit/ecs': {
    file: 'toolkit/ecs.ts',
    text: 'export type MovingPlatformPhysicsParams = { mass: number };',
  },
  'aekasha/toolkit/geometry': {
    file: 'toolkit/geometry.ts',
    text: 'export const createAsteroid = () => 1;',
  },
};

const OPTIONS: ts.CompilerOptions = {
  noLib: true,
  types: [],
  noEmit: true,
  strict: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  paths: Object.fromEntries(
    Object.entries(ENTRIES).map(([entry, { file }]) => [entry, [abs(file)]])
  ),
};

// What `noLib` leaves out and the checker needs: an array literal's elements get their contextual
// type through the global `Array`
const GLOBALS = [
  'interface Array<T> { length: number; [n: number]: T }',
  ...['Boolean', 'CallableFunction', 'Function', 'IArguments', 'NewableFunction', 'Number'].map(
    (name) => `interface ${name} {}`
  ),
  ...['Object', 'RegExp', 'String'].map((name) => `interface ${name} {}`),
].join('\n');

/** Migrates the modules (`app/…` → source) once */
export const runOnce = (modules: Record<string, string>) => {
  const texts = new Map<string, string>([[abs('globals.d.ts'), GLOBALS]]);
  for (const { file, text } of Object.values(ENTRIES)) texts.set(abs(file), text);
  for (const [file, text] of Object.entries(modules)) texts.set(abs(file), text);
  const files = Object.keys(modules).map(abs);
  const program = createMigrationProgram({
    rootNames: [...files, abs('globals.d.ts')],
    options: OPTIONS,
    texts,
    baseHost: ts.createCompilerHost(OPTIONS),
  });
  const result = migrateEngine6({ program, files, rules: ENGINE6_RULES });
  const rel = (file: string) => path.relative(VIRTUAL, file);
  const finding = (f: { file: string; line: number; message: string }) =>
    `${rel(f.file)}:${f.line} ${f.message}`;
  return {
    changed: Object.fromEntries([...result.changed].map(([file, text]) => [rel(file), text])),
    errors: result.errors.map(finding),
    reports: result.reports.map(finding),
    anchors: result.reports.map((r) => r.anchor),
  };
};

/** Migrates the modules, then migrates the output again: a migrated module is left alone */
export const run = (modules: Record<string, string>) => {
  const first = runOnce(modules);
  const second = runOnce({ ...modules, ...first.changed });
  expect(second.changed).toEqual({});
  return first;
};

/** The one module's reports (its text unchanged, no error) */
export const reportsOf = (text: string) => {
  const { changed, errors, reports } = run({ 'app/a.ts': text });
  expect(errors).toEqual([]);
  expect(changed).toEqual({});
  return reports;
};

/** The one module's output */
export const migrate = (text: string) => {
  const { changed, errors } = run({ 'app/a.ts': text });
  expect(errors).toEqual([]);
  return changed['app/a.ts'] ?? text;
};

export const lines = (...l: string[]) => l.join('\n');

export const ofKind = <K extends (typeof ENGINE6_RULES)[number]['kind']>(kind: K) =>
  ENGINE6_RULES.filter((rule) => rule.kind === kind) as Extract<
    (typeof ENGINE6_RULES)[number],
    { kind: K }
  >[];
