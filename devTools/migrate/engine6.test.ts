import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ENTRY_FILES } from '../aliases';
import { parseModuleSource } from '../layout/importGraph';
import { ROOT } from '../paths';
import { createMigrationProgram, migrateEngine6 } from './engine6';
import {
  ENGINE6_RULES,
  type CallArgRule,
  type ImportRule,
  type RemovedImportRule,
  type RemovedMemberRule,
  type RenamedMemberRule,
  type ReshapeRule,
} from './engine6Rules';

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
    ].join('\n'),
  },
  'aekasha/skybox': {
    file: 'engine/skybox.ts',
    text: [
      'export type SkyBoxDef = { id: string; base?: { type: string } };',
      'export const createSkyBox = (def: SkyBoxDef) => def;',
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
const runOnce = (modules: Record<string, string>) => {
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
const run = (modules: Record<string, string>) => {
  const first = runOnce(modules);
  const second = runOnce({ ...modules, ...first.changed });
  expect(second.changed).toEqual({});
  return first;
};

/** The one module's reports (its text unchanged, no error) */
const reportsOf = (text: string) => {
  const { changed, errors, reports } = run({ 'app/a.ts': text });
  expect(errors).toEqual([]);
  expect(changed).toEqual({});
  return reports;
};

/** The one module's output */
const migrate = (text: string) => {
  const { changed, errors } = run({ 'app/a.ts': text });
  expect(errors).toEqual([]);
  return changed['app/a.ts'] ?? text;
};

const lines = (...l: string[]) => l.join('\n');

const ofKind = <K extends (typeof ENGINE6_RULES)[number]['kind']>(kind: K) =>
  ENGINE6_RULES.filter((rule) => rule.kind === kind) as Extract<
    (typeof ENGINE6_RULES)[number],
    { kind: K }
  >[];
const IMPORT_RULES: ImportRule[] = ofKind('import');
const REMOVED_IMPORT_RULES: RemovedImportRule[] = ofKind('removedImport');
const MEMBER_RULES: RemovedMemberRule[] = ofKind('removedMember');
const CALL_RULES: CallArgRule[] = ofKind('callArg');
const RESHAPE_RULES: ReshapeRule[] = ofKind('reshape');
const RENAMED_MEMBER_RULES: RenamedMemberRule[] = ofKind('renamedMember');

// Each reshape rule's fixture: a call in the old shape with every argument, and the new shape
const RESHAPE_FIXTURES: Record<string, { imports: string; before: string; after: string }> = {
  'reshape:createPhysicsEntity': {
    imports: "import { createPhysicsEntity } from 'aekasha/physics';\ndeclare const w: object;",
    before: "createPhysicsEntity({ type: 'BALL' }, { rigidType: 'DYNAMIC' }, 1, { id: 'b' }, w);",
    after:
      "createPhysicsEntity({ colliders: { type: 'BALL' }, body: { rigidType: 'DYNAMIC' }, target: 1 }, { id: 'b', world: w });",
  },
};

describe('the rules', () => {
  it.each(IMPORT_RULES.map((rule) => [rule.id, rule] as const))(
    '%s: the import and its references',
    (_, rule) => {
      const input = lines(
        `import { ${rule.from.name} } from '${rule.from.entry}';`,
        `export const used = [${rule.from.name}];`
      );
      expect(migrate(input)).toBe(
        lines(
          `import { ${rule.to.name} } from '${rule.to.entry}';`,
          `export const used = [${rule.to.name}];`
        )
      );
    }
  );

  it('have unique ids', () => {
    const ids = ENGINE6_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("name what the repo's entries export today, and not the names they removed", () => {
    const exported = (entry: string) => {
      const file = ENTRY_FILES[entry as keyof typeof ENTRY_FILES];
      expect(file, entry).toBeDefined();
      const { exports } = parseModuleSource(file, fs.readFileSync(path.join(ROOT, file), 'utf8'));
      return [...exports.local, ...Object.keys(exports.named)];
    };
    for (const rule of IMPORT_RULES) {
      expect(exported(rule.to.entry), `${rule.id} → ${rule.to.entry}`).toContain(rule.to.name);
    }
    for (const rule of REMOVED_IMPORT_RULES) {
      for (const name of Object.keys(rule.names)) {
        expect(exported(rule.entry), `${rule.id}: ${name}`).not.toContain(name);
      }
    }
    for (const rule of [...MEMBER_RULES, ...RENAMED_MEMBER_RULES]) {
      for (const t of rule.types) expect(exported(t.entry), rule.id).toContain(t.name);
    }
    for (const rule of [...CALL_RULES, ...RESHAPE_RULES]) {
      expect(exported(rule.callee.entry), rule.id).toContain(rule.callee.name);
    }
  });

  it.each(RENAMED_MEMBER_RULES.map((rule) => [rule.id, rule] as const))(
    '%s: a read on a value of each type, and a call of it',
    (_, rule) => {
      for (const t of rule.types) {
        for (const [from, to] of Object.entries(rule.members)) {
          const before = (name: string) =>
            lines(
              `import type { ${t.name} } from '${t.entry}';`,
              `declare const x: ${t.name};`,
              `export const read = x.${name};`,
              `x?.${name}(1);`
            );
          expect(migrate(before(from)), `${t.name}.${from}`).toBe(before(to));
        }
      }
    }
  );

  it.each(RESHAPE_RULES.map((rule) => [rule.id, rule] as const))(
    '%s: its fixture, and the old arguments each used once in their order',
    (_, rule) => {
      const used = rule.args.flatMap((arg) =>
        'param' in arg ? [arg.param] : arg.props.map((p) => ('key' in p ? p.param : p.spread))
      );
      expect(used).toEqual(rule.params);
      const fixture = RESHAPE_FIXTURES[rule.id];
      expect(fixture, rule.id).toBeDefined();
      expect(migrate(lines(fixture.imports, fixture.before))).toBe(
        lines(fixture.imports, fixture.after)
      );
    }
  );

  it.each(REMOVED_IMPORT_RULES.map((rule) => [rule.id, rule] as const))(
    '%s: each import is reported',
    (_, rule) => {
      for (const name of Object.keys(rule.names)) {
        const reports = reportsOf(
          lines(`import { ${name} } from '${rule.entry}';`, `export const used = [${name}];`)
        );
        expect(reports, name).toEqual([
          `app/a.ts:1 \`${name}\` (${rule.entry}): ${rule.names[name]}`,
        ]);
      }
    }
  );

  it.each(MEMBER_RULES.map((rule) => [rule.id, rule] as const))(
    '%s: a read and an object literal are reported',
    (_, rule) => {
      for (const t of rule.types) {
        for (const member of Object.keys(rule.members)) {
          const value = rule.onlyString ? "'x'" : '1';
          const reports = reportsOf(
            lines(
              `import type { ${t.name} } from '${t.entry}';`,
              `declare const x: ${t.name};`,
              `export const read = x.${member};`,
              `export const written: ${t.name} = { ${member}: ${value} };`
            )
          );
          const message = `\`${t.name}.${member}\`: ${rule.members[member]}`;
          // An `onlyString` member's read is its new type's
          const expected = rule.onlyString ? [4] : [3, 4];
          expect(reports, `${t.name}.${member}`).toEqual(
            expected.map((line) => `app/a.ts:${line} ${message}`)
          );
        }
      }
    }
  );
});

describe('renames by import', () => {
  it('keeps an aliased import’s local name', () => {
    expect(migrate("import type { TCMP as Handle } from 'aekasha/ui';\nlet h: Handle;")).toBe(
      "import type { CMPHandle as Handle } from 'aekasha/ui';\nlet h: Handle;"
    );
  });

  it('renames several names of one import, inline types kept', () => {
    expect(
      migrate(
        lines(
          "import type { TCMP, TProps, CMPStyle } from 'aekasha/ui';",
          "import { type TDropDown, createCMP } from 'aekasha/ui';",
          'let a: TCMP | TProps | CMPStyle | TDropDown;'
        )
      )
    ).toBe(
      lines(
        "import type { CMPHandle, CMPProps, CMPStyle } from 'aekasha/ui';",
        "import { type DropDown, createCMP } from 'aekasha/ui';",
        'let a: CMPHandle | CMPProps | CMPStyle | DropDown;'
      )
    );
  });

  it('merges into an import of the new name, under its local name', () => {
    expect(
      migrate(
        lines(
          "import { CoreComponentType, ComponentType as CT, getX } from 'aekasha';",
          'const a = [CoreComponentType.A, CT.A, getX];'
        )
      )
    ).toBe(
      lines("import { ComponentType as CT, getX } from 'aekasha';", 'const a = [CT.A, CT.A, getX];')
    );
  });

  it('keeps the value import when the new name was imported as a type', () => {
    expect(
      migrate(
        lines(
          "import { CoreComponentType } from 'aekasha';",
          "import type { ComponentType } from 'aekasha';",
          'type T = typeof ComponentType;',
          'const a = CoreComponentType.A;'
        )
      )
    ).toBe(
      lines(
        "import { ComponentType } from 'aekasha';",
        'type T = typeof ComponentType;',
        'const a = ComponentType.A;'
      )
    );
  });

  it('leaves a local or a property of the same name alone', () => {
    expect(
      migrate(
        lines(
          "import { CoreComponentType } from 'aekasha';",
          'const f = (CoreComponentType: number) => CoreComponentType;',
          'const o = { CoreComponentType: 1 };',
          'const a = [o.CoreComponentType, CoreComponentType.A, f];'
        )
      )
    ).toBe(
      lines(
        "import { ComponentType } from 'aekasha';",
        'const f = (CoreComponentType: number) => CoreComponentType;',
        'const o = { CoreComponentType: 1 };',
        'const a = [o.CoreComponentType, ComponentType.A, f];'
      )
    );
  });

  it("keeps the module's own names: a shorthand property, a local export", () => {
    expect(
      migrate(
        lines(
          "import { CoreComponentType } from 'aekasha';",
          'export const o = { CoreComponentType };',
          'export { CoreComponentType };',
          'export { CoreComponentType as Types };'
        )
      )
    ).toBe(
      lines(
        "import { ComponentType } from 'aekasha';",
        'export const o = { CoreComponentType: ComponentType };',
        'export { ComponentType as CoreComponentType };',
        'export { ComponentType as Types };'
      )
    );
  });

  it("renames an `export … from` and keeps the module's exported name", () => {
    expect(
      migrate(
        lines(
          "export { TCMP } from 'aekasha/ui';",
          "export type { TProps as Props } from 'aekasha/ui';",
          "export { createSeededRandom } from 'aekasha/toolkit/geometry';"
        )
      )
    ).toBe(
      lines(
        "export { CMPHandle as TCMP } from 'aekasha/ui';",
        "export type { CMPProps as Props } from 'aekasha/ui';",
        "export { createSeededRandom } from 'aekasha';"
      )
    );
  });

  it('renames through a namespace import and an `import()` type', () => {
    expect(
      migrate(
        lines(
          "import * as ui from 'aekasha/ui';",
          'let a: ui.TCMP;',
          "type B = import('aekasha/ui').TProps;",
          "type C = import('aekasha/toolkit/geometry').createSeededRandom;"
        )
      )
    ).toBe(
      lines(
        "import * as ui from 'aekasha/ui';",
        'let a: ui.CMPHandle;',
        "type B = import('aekasha/ui').CMPProps;",
        "type C = import('aekasha').createSeededRandom;"
      )
    );
  });

  it('leaves a module that imports none of the names, or imports them from elsewhere, alone', () => {
    const { changed, errors } = run({
      'app/a.ts': "import { TCMP } from './mine';\nlet a: TCMP;",
      'app/b.ts': "import { CMPHandle } from 'aekasha/ui';\nlet a: CMPHandle;",
      'app/mine.ts': 'export type TCMP = {};',
    });
    expect(errors).toEqual([]);
    expect(changed).toEqual({});
  });
});

describe('moves by import', () => {
  it("merges into the new entry's import", () => {
    expect(
      migrate(
        lines(
          "import { getX } from 'aekasha';",
          "import { createSeededRandom, createAsteroid } from 'aekasha/toolkit/geometry';",
          'const a = [getX, createSeededRandom, createAsteroid];'
        )
      )
    ).toBe(
      lines(
        "import { getX, createSeededRandom } from 'aekasha';",
        "import { createAsteroid } from 'aekasha/toolkit/geometry';",
        'const a = [getX, createSeededRandom, createAsteroid];'
      )
    );
  });

  it("goes next to the old import when the new entry's is type-only, keeping an alias", () => {
    expect(
      migrate(
        lines(
          "import type { ComponentType } from 'aekasha';",
          "import { createSeededRandom as rng, createAsteroid } from 'aekasha/toolkit/geometry';",
          'const a: [typeof ComponentType, unknown, unknown] = [ComponentType, rng, createAsteroid];'
        )
      )
    ).toBe(
      lines(
        "import type { ComponentType } from 'aekasha';",
        "import { createAsteroid } from 'aekasha/toolkit/geometry';",
        "import { createSeededRandom as rng } from 'aekasha';",
        'const a: [typeof ComponentType, unknown, unknown] = [ComponentType, rng, createAsteroid];'
      )
    );
  });

  it('drops the old import when the name was imported from both', () => {
    expect(
      migrate(
        lines(
          "import { createSeededRandom } from 'aekasha';",
          "import { createSeededRandom as rng } from 'aekasha/toolkit/geometry';",
          'const a = [createSeededRandom, rng];'
        )
      )
    ).toBe(
      lines(
        "import { createSeededRandom } from 'aekasha';",
        'const a = [createSeededRandom, createSeededRandom];'
      )
    );
  });
});

describe('errors', () => {
  it('a renamed reference another declaration would shadow', () => {
    const { changed, errors } = run({
      'app/a.ts': lines(
        "import { CoreComponentType } from 'aekasha';",
        'export const f = () => {',
        '  const ComponentType = 1;',
        '  return [ComponentType, CoreComponentType];',
        '};'
      ),
    });
    expect(changed).toEqual({});
    expect(errors).toEqual([
      'app/a.ts:4 `CoreComponentType` → `ComponentType`: another `ComponentType` is in scope here',
    ]);
  });

  it('a module that declares the new name itself', () => {
    const { changed, errors } = run({
      'app/a.ts': lines(
        "import { CoreComponentType } from 'aekasha';",
        'const ComponentType = 1;',
        'export const a = [ComponentType, CoreComponentType];'
      ),
      'app/b.ts': "import { TCMP } from 'aekasha/ui';\nexport let b: TCMP;",
    });
    expect(changed).toEqual({
      'app/b.ts': "import { CMPHandle } from 'aekasha/ui';\nexport let b: CMPHandle;",
    });
    expect(errors).toEqual([
      'app/a.ts:1 `CoreComponentType` → `ComponentType`: the module has another `ComponentType`',
      'app/a.ts:3 `CoreComponentType` → `ComponentType`: another `ComponentType` is in scope here',
    ]);
  });

  it('a move through a namespace import', () => {
    const { changed, errors } = run({
      'app/a.ts': lines(
        "import * as geo from 'aekasha/toolkit/geometry';",
        'export const r = geo.createSeededRandom(1);'
      ),
    });
    expect(changed).toEqual({});
    expect(errors).toEqual([
      "app/a.ts:2 `geo.createSeededRandom`: import `createSeededRandom` from 'aekasha'",
    ]);
  });
});

describe('reports', () => {
  it('a removed name through a namespace import, with its anchor', () => {
    const { reports, anchors } = run({
      'app/a.ts': lines(
        "import * as debug from 'aekasha/debug';",
        'export const a = debug.AEK_GATHER_EVENT;',
        'export type B = debug.DebugGUIOpts;'
      ),
    });
    expect(reports.map((r) => r.split(' ')[0] + ' ' + r.split(' ')[1])).toEqual([
      'app/a.ts:2 `AEK_GATHER_EVENT`',
      'app/a.ts:3 `DebugGUIOpts`',
    ]);
    expect(anchors).toEqual(['the-debug-entry-s-names', 'the-debug-entry-s-names']);
  });

  it('members through calls, destructuring and a union of item types', () => {
    expect(
      reportsOf(
        lines(
          "import { addSceneHooks } from 'aekasha';",
          "import { getPhysicsState } from 'aekasha/physics';",
          "import { createDynamicCharacter } from 'aekasha/character';",
          "import { createMenu, createKbd } from 'aekasha/ui';",
          'addSceneHooks({ loadStart: () => {}, sceneDeleted: () => {} });',
          'export const paused = getPhysicsState().pausedTime;',
          "const { data, character } = createDynamicCharacter({ id: 'a', input: {} });",
          'export const k = [data, character.kind];',
          "createMenu([{ label: 'a', kbd: 'Ctrl+S' }, { label: 'b', kbd: createKbd({ keys: 'x' }) }]);"
        )
      ).map((r) => r.slice(0, r.indexOf(':', r.indexOf('`'))))
    ).toEqual([
      'app/a.ts:5 `SceneHooks.sceneDeleted`',
      'app/a.ts:6 `PhysicsState.pausedTime`',
      'app/a.ts:7 `DynamicCharacter.data`',
      'app/a.ts:7 `DynamicCharacterOpts.input`',
      'app/a.ts:8 `CharacterObject.kind`',
      'app/a.ts:9 `MenuActionItem.kbd`',
    ]);
  });

  it('leaves a member of another type, and a Kbd handle, alone', () => {
    expect(
      reportsOf(
        lines(
          "import { createKbd, type ButtonProps } from 'aekasha/ui';",
          'const local = { data: 1, kind: 2, timeout: 3 };',
          'export const a = [local.data, local.kind, local.timeout];',
          "export const b: ButtonProps = { label: 'Save', kbd: createKbd({ keys: 'Ctrl+S' }) };"
        )
      )
    ).toEqual([]);
  });

  it("an entry function's argument: options, a second argument, a legacy sky box", () => {
    expect(
      reportsOf(
        lines(
          "import { removeFromGroupEntity } from 'aekasha';",
          "import { createDebuggerTab } from 'aekasha/debug';",
          "import { createSkyBox } from 'aekasha/skybox';",
          "removeFromGroupEntity(1, 'a', { deleteMeshes: true, deleteTextures: true });",
          "createDebuggerTab({ id: 'a' }, { drawerBtnPlace: 'TOP' });",
          "createDebuggerTab({ id: 'b' });",
          "createSkyBox({ id: 's', type: 'COLOR', params: {} });",
          "createSkyBox({ id: 't', base: { type: 'COLOR' } });"
        )
      ).map((r) => r.slice(0, r.indexOf(':', r.indexOf('`'))))
    ).toEqual([
      "app/a.ts:4 `removeFromGroupEntity`'s `deleteTextures`",
      "app/a.ts:5 `createDebuggerTab`'s argument 2",
      "app/a.ts:7 `createSkyBox`'s `type`",
      "app/a.ts:7 `createSkyBox`'s `params`",
    ]);
  });

  it("rewrites getSvgIcon's 'small', and leaves a local function of the name alone", () => {
    expect(
      migrate(
        lines(
          "import { getSvgIcon } from 'aekasha/ui';",
          "import * as ui from 'aekasha/ui';",
          "export const a = [getSvgIcon('gear', 'small'), ui.getSvgIcon('gear', \"small\")];",
          'const own = (name: string, size: string) => name + size;',
          "export const b = own('gear', 'small');"
        )
      )
    ).toBe(
      lines(
        "import { getSvgIcon } from 'aekasha/ui';",
        "import * as ui from 'aekasha/ui';",
        "export const a = [getSvgIcon('gear', 'sm'), ui.getSvgIcon('gear', \"sm\")];",
        'const own = (name: string, size: string) => name + size;',
        "export const b = own('gear', 'small');"
      )
    );
  });
});

describe('member renames', () => {
  it('renames on a call result, and leaves a member of another type alone', () => {
    expect(
      migrate(
        lines(
          "import { getPhysicsWorld } from 'aekasha/physics';",
          'getPhysicsWorld().setMaxCcdSubstepsSync(2);',
          'const mine = { setMaxCcdSubstepsSync: (n: number) => n };',
          'mine.setMaxCcdSubstepsSync(2);'
        )
      )
    ).toBe(
      lines(
        "import { getPhysicsWorld } from 'aekasha/physics';",
        'getPhysicsWorld().setMaxCcdSubsteps(2);',
        'const mine = { setMaxCcdSubstepsSync: (n: number) => n };',
        'mine.setMaxCcdSubstepsSync(2);'
      )
    );
  });
});

describe('call reshapes', () => {
  const IMPORTS = lines(
    "import { createPhysicsEntity } from 'aekasha/physics';",
    "import * as physics from 'aekasha/physics';",
    'declare const world: object;',
    'declare const colliders: { type: string }[];',
    'declare const isNew: boolean;'
  );
  const reshape = (...body: string[]) => {
    const out = migrate(lines(IMPORTS, ...body));
    expect(out.startsWith(`${IMPORTS}\n`)).toBe(true);
    return out.slice(IMPORTS.length + 1);
  };

  it('createPhysicsEntity: the props, the options merged with the world, the placeholders dropped', () => {
    expect(
      reshape(
        "createPhysicsEntity({ type: 'BOX' }, { rigidType: 'FIXED' }, 1);",
        'createPhysicsEntity(colliders);',
        "createPhysicsEntity(colliders, undefined, 2, { tierPolicy: true, id: 'a' });",
        "createPhysicsEntity(colliders, { rigidType: 'FIXED' }, 3, undefined, world);",
        "physics.createPhysicsEntity(colliders, undefined, undefined, isNew ? { id: 'b' } : undefined);",
        "createPhysicsEntity(colliders, undefined, undefined, isNew ? { id: 'c' } : undefined, world);",
        'createPhysicsEntity(colliders, undefined, undefined, {}, world);'
      )
    ).toBe(
      lines(
        "createPhysicsEntity({ colliders: { type: 'BOX' }, body: { rigidType: 'FIXED' }, target: 1 });",
        'createPhysicsEntity({ colliders });',
        "createPhysicsEntity({ colliders, target: 2 }, { tierPolicy: true, id: 'a' });",
        "createPhysicsEntity({ colliders, body: { rigidType: 'FIXED' }, target: 3 }, { world });",
        "physics.createPhysicsEntity({ colliders }, isNew ? { id: 'b' } : undefined);",
        "createPhysicsEntity({ colliders }, { ...(isNew ? { id: 'c' } : undefined), world });",
        'createPhysicsEntity({ colliders }, { world });'
      )
    );
  });

  it('leaves a new-shaped call and a local function of the name alone', () => {
    const input = lines(
      "createPhysicsEntity({ colliders: { type: 'BOX' } }, { world });",
      'const props = { colliders };',
      'createPhysicsEntity(props);',
      'const own = (a: object, b?: object, c?: number) => c;',
      "own({ type: 'BOX' }, { rigidType: 'FIXED' }, 1);"
    );
    expect(reshape(input)).toBe(input);
  });

  it("keeps the arguments' comments, a dropped placeholder's with the next argument", () => {
    expect(
      reshape(
        'createPhysicsEntity(',
        "  { type: 'BALL' }, // the radius comes from the sphere",
        "  { rigidType: 'DYNAMIC' },",
        '  1',
        ');',
        'createPhysicsEntity(',
        '  // the ground',
        "  { type: 'BOX' },",
        '  undefined,',
        '  2 /* its mesh */',
        ');',
        'createPhysicsEntity(',
        '  colliders,',
        '  undefined,',
        '  // No mesh: its own entity',
        '  undefined,',
        "  { id: 'sensor' }",
        ');'
      )
    ).toBe(
      lines(
        'createPhysicsEntity({',
        "colliders: { type: 'BALL' }, // the radius comes from the sphere",
        "body: { rigidType: 'DYNAMIC' },",
        'target: 1,',
        '});',
        'createPhysicsEntity({',
        '// the ground',
        "colliders: { type: 'BOX' },",
        'target: 2, /* its mesh */',
        '});',
        'createPhysicsEntity(',
        '{ colliders },',
        '// No mesh: its own entity',
        "{ id: 'sensor' },",
        ');'
      )
    );
  });

  it('takes in the edits inside its arguments: a rename, a nested call', () => {
    expect(
      migrate(
        lines(
          "import { createPhysicsEntity } from 'aekasha/physics';",
          "import { registerOnAllSceneEnterings } from 'aekasha';",
          'createPhysicsEntity(',
          "  { type: 'BOX', userData: { f: registerOnAllSceneEnterings } },",
          '  undefined,',
          "  createPhysicsEntity({ type: 'BALL' })",
          ');'
        )
      )
    ).toBe(
      lines(
        "import { createPhysicsEntity } from 'aekasha/physics';",
        "import { registerOnAllSceneEnters } from 'aekasha';",
        "createPhysicsEntity({ colliders: { type: 'BOX', userData: { f: registerOnAllSceneEnters } }, target: createPhysicsEntity({ colliders: { type: 'BALL' } }) });"
      )
    );
  });

  it('reports a call it cannot tell or reshape: an `any` argument, a spread', () => {
    expect(
      reportsOf(
        lines(
          IMPORTS,
          'declare const loose: any;',
          'declare const all: [{ type: string }];',
          'createPhysicsEntity(loose);',
          'createPhysicsEntity(colliders, ...([] as []));'
        )
      ).map((r) => r.slice(0, r.indexOf(':', r.indexOf('`'))))
    ).toEqual(['app/a.ts:8 `createPhysicsEntity`', 'app/a.ts:9 `createPhysicsEntity`']);
  });
});
