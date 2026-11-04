import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ENTRY_FILES } from '../aliases';
import { parseModuleSource } from '../layout/importGraph';
import { ROOT } from '../paths';
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
    ].join('\n'),
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
      ].map((name) => `export type ${name} = { kind: '${name}' };`),
      'export const createCMP = () => ({});',
    ].join('\n'),
  },
  'aekasha/character': {
    file: 'engine/character.ts',
    text: "export type PlayerBrainHoldMode = 'HOLD' | 'TOGGLE';",
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

/** Migrates the modules (`app/…` → source) once */
const runOnce = (modules: Record<string, string>) => {
  const texts = new Map<string, string>();
  for (const { file, text } of Object.values(ENTRIES)) texts.set(abs(file), text);
  for (const [file, text] of Object.entries(modules)) texts.set(abs(file), text);
  const files = Object.keys(modules).map(abs);
  const program = createMigrationProgram({
    rootNames: files,
    options: OPTIONS,
    texts,
    baseHost: ts.createCompilerHost(OPTIONS),
  });
  const result = migrateEngine6({ program, files, rules: ENGINE6_RULES });
  const rel = (file: string) => path.relative(VIRTUAL, file);
  return {
    changed: Object.fromEntries([...result.changed].map(([file, text]) => [rel(file), text])),
    errors: result.errors.map((e) => `${rel(e.file)}:${e.line} ${e.message}`),
  };
};

/** Migrates the modules, then migrates the output again: a migrated module is left alone */
const run = (modules: Record<string, string>) => {
  const first = runOnce(modules);
  const second = runOnce({ ...modules, ...first.changed });
  expect(second.changed).toEqual({});
  return first;
};

/** The one module's output */
const migrate = (text: string) => {
  const { changed, errors } = run({ 'app/a.ts': text });
  expect(errors).toEqual([]);
  return changed['app/a.ts'] ?? text;
};

const lines = (...l: string[]) => l.join('\n');

describe('the rules', () => {
  it.each(ENGINE6_RULES.map((rule) => [rule.id, rule] as const))(
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

  it("name what the repo's entries export today", () => {
    const exported = (entry: string) => {
      const file = ENTRY_FILES[entry as keyof typeof ENTRY_FILES];
      expect(file, entry).toBeDefined();
      const { exports } = parseModuleSource(file, fs.readFileSync(path.join(ROOT, file), 'utf8'));
      return [...exports.local, ...Object.keys(exports.named)];
    };
    for (const rule of ENGINE6_RULES) {
      expect(exported(rule.to.entry), `${rule.id} → ${rule.to.entry}`).toContain(rule.to.name);
    }
  });
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
