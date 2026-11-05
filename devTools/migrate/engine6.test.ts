import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENTRY_FILES } from '../aliases';
import { parseModuleSource } from '../layout/importGraph';
import { ROOT } from '../paths';
import {
  ENGINE6_RULES,
  type CallArgRule,
  type ImportRule,
  type KeyTypeRule,
  type RemovedImportRule,
  type RemovedMemberRule,
  type RenamedMemberRule,
  type ReshapeRule,
} from './engine6Rules';
import { lines, migrate, ofKind, reportsOf, run } from './engine6TestHarness';

const IMPORT_RULES: ImportRule[] = ofKind('import');
const REMOVED_IMPORT_RULES: RemovedImportRule[] = ofKind('removedImport');
const MEMBER_RULES: RemovedMemberRule[] = ofKind('removedMember');
const CALL_RULES: CallArgRule[] = ofKind('callArg');
const RESHAPE_RULES: ReshapeRule[] = ofKind('reshape');
const RENAMED_MEMBER_RULES: RenamedMemberRule[] = ofKind('renamedMember');
const KEY_TYPE_RULES: KeyTypeRule[] = ofKind('keyType');

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
      // The old name is gone from its entry (toolkit 3.0.0's were the last, p622 Phase 7)
      expect(exported(rule.from.entry), `${rule.id}: ${rule.from.entry}`).not.toContain(
        rule.from.name
      );
    }
    for (const rule of REMOVED_IMPORT_RULES) {
      for (const name of Object.keys(rule.names)) {
        // A name that needs a feature stays on its entry
        if (rule.withoutFeature)
          expect(exported(rule.entry), `${rule.id}: ${name}`).toContain(name);
        else expect(exported(rule.entry), `${rule.id}: ${name}`).not.toContain(name);
      }
    }
    for (const rule of [...REMOVED_IMPORT_RULES, ...CALL_RULES]) {
      const feature = rule.withoutFeature;
      if (feature) expect(exported(feature.entry), rule.id).toContain(feature.name);
    }
    for (const rule of KEY_TYPE_RULES) {
      expect(exported(rule.key.entry), rule.id).toContain(rule.key.name);
    }
    for (const rule of [...MEMBER_RULES, ...RENAMED_MEMBER_RULES]) {
      for (const t of rule.types) expect(exported(t.entry), rule.id).toContain(t.name);
    }
    for (const rule of [...CALL_RULES, ...RESHAPE_RULES]) {
      expect(exported(rule.callee.entry), rule.id).toContain(rule.callee.name);
    }
    for (const rule of RESHAPE_RULES) {
      for (const d of Object.values(rule.defaults ?? {})) {
        expect(exported(d.entry), rule.id).toContain(d.name);
      }
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

describe('a feature the project lists', () => {
  const USES = lines(
    "import { createPhysicsEntity, requestPhysicsTier } from 'aekasha/physics';",
    "createPhysicsEntity({ colliders: { type: 'BALL' } }, { id: 'a', tierPolicy: true });",
    "export const ok = requestPhysicsTier(1, 'STATIC');"
  );
  const BOOT = lines(
    "import { physicsTiers } from 'aekasha/physics';",
    'export const features = [physicsTiers()];'
  );

  it("the tiers' API is reported when no module calls `physicsTiers()`", () => {
    const { reports, anchors } = run({ 'app/a.ts': USES });
    expect(reports.map((r) => r.slice(0, r.indexOf(':', r.indexOf('`'))))).toEqual([
      'app/a.ts:1 `requestPhysicsTier` (aekasha/physics)',
      "app/a.ts:2 `createPhysicsEntity`'s `tierPolicy`",
    ]);
    expect(anchors).toEqual(['physicstiers', 'physicstiers']);
  });

  it('nothing is reported when one does, in another module; a test or a mention does not count', () => {
    expect(run({ 'app/a.ts': USES, 'app/boot.ts': BOOT }).reports).toEqual([]);
    const notCalled = run({
      'app/a.ts': USES,
      'app/boot.test.ts': BOOT,
      'app/other.ts': lines(
        "import { physicsTiers } from 'aekasha/physics';",
        'export const later = physicsTiers;',
        'const own = { physicsTiers: () => 1 };',
        'own.physicsTiers();'
      ),
    });
    expect(notCalled.reports).toHaveLength(2);
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

describe('component keys named as types', () => {
  it.each(KEY_TYPE_RULES.map((rule) => [rule.id, rule] as const))(
    '%s: a member gets `typeof`, a value is left',
    (_, rule) => {
      const before = (type: string) =>
        lines(
          `import { ${rule.key.name} } from '${rule.key.entry}';`,
          `export type T = ${type}.X | Record<${type}.X, ${type}.X[]>;`,
          `export const value = ${rule.key.name}.X;`
        );
      expect(migrate(before(rule.key.name))).toBe(before(`typeof ${rule.key.name}`));
    }
  );

  it('a bare key becomes its values’ union; `ComponentType` still names a type', () => {
    expect(
      migrate(
        lines(
          "import { ComponentType } from 'aekasha';",
          "import { HoverToolComponentType as Hover } from 'aekasha/toolkit/ecs';",
          'export type T = Hover | ComponentType;'
        )
      )
    ).toBe(
      lines(
        "import { ComponentType } from 'aekasha';",
        "import { HoverToolComponentType as Hover } from 'aekasha/toolkit/ecs';",
        'export type T = (typeof Hover)[keyof typeof Hover] | ComponentType;'
      )
    );
  });

  it('`CoreComponentType` is renamed too, a namespace and an `import()` type followed', () => {
    expect(
      migrate(
        lines(
          "import { CoreComponentType } from 'aekasha';",
          "import * as toolkit from 'aekasha/toolkit/ecs';",
          'export type A = CoreComponentType.TRANSFORM | CoreComponentType;',
          'export type B = toolkit.FollowToolComponentType.FOLLOW;',
          "export type C = import('aekasha/toolkit/ecs').SunShadowFitComponentType.SUN_SHADOW_FIT;",
          "export type D = import('aekasha').CoreComponentType.TRANSFORM;"
        )
      )
    ).toBe(
      lines(
        "import { ComponentType } from 'aekasha';",
        "import * as toolkit from 'aekasha/toolkit/ecs';",
        'export type A = typeof ComponentType.TRANSFORM | ComponentType;',
        'export type B = typeof toolkit.FollowToolComponentType.FOLLOW;',
        "export type C = typeof import('aekasha/toolkit/ecs').SunShadowFitComponentType.SUN_SHADOW_FIT;",
        "export type D = typeof import('aekasha').ComponentType.TRANSFORM;"
      )
    );
  });

  it('leaves `typeof`, a computed key, and a local key of the same name alone', () => {
    reportsOf(
      lines(
        "import { HoverToolComponentType } from 'aekasha/toolkit/ecs';",
        'export type T = typeof HoverToolComponentType.HOVER;',
        "declare module 'aekasha' {",
        '  interface ComponentDataMap {',
        '    [HoverToolComponentType.HOVER]: { speed: number };',
        '  }',
        '}',
        'export const f = () => {',
        '  enum HoverToolComponentType { HOVER = "mine" }',
        '  const k: HoverToolComponentType.HOVER = HoverToolComponentType.HOVER;',
        '  return k;',
        '};'
      )
    );
  });
});
