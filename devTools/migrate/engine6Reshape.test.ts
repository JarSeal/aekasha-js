import { describe, expect, it } from 'vitest';
import type { ReshapeRule } from './engine6Rules';
import { lines, migrate, ofKind, reportsOf } from './engine6TestHarness';

const RESHAPE_RULES: ReshapeRule[] = ofKind('reshape');

// Each reshape rule's fixture: a call in the old shape with every argument, and the new shape
const RESHAPE_FIXTURES: Record<string, { imports: string; before: string; after: string }> = {
  'reshape:createPhysicsEntity': {
    imports: "import { createPhysicsEntity } from 'aekasha/physics';\ndeclare const w: object;",
    before: "createPhysicsEntity({ type: 'BALL' }, { rigidType: 'DYNAMIC' }, 1, { id: 'b' }, w);",
    after:
      "createPhysicsEntity({ colliders: { type: 'BALL' }, body: { rigidType: 'DYNAMIC' }, target: 1 }, { id: 'b', world: w });",
  },
  ...Object.fromEntries(
    ['createMeshEntity', 'createCameraEntity', 'createGroupEntity', 'createLightEntity'].map(
      (name) => [
        `reshape:${name}`,
        {
          imports: `import { ${name}, type ECSWorld } from 'aekasha';\ndeclare const w: ECSWorld;`,
          before: `${name}({ id: 'p' }, { appId: 'e' }, w);`,
          after: `${name}({ id: 'p' }, { appId: 'e', world: w });`,
        },
      ]
    )
  ),
  'reshape:createLineEntity': {
    imports:
      "import { type ECSWorld } from 'aekasha';\nimport { createLineEntity } from 'aekasha/lines';\ndeclare const w: ECSWorld;",
    before: "createLineEntity(undefined, { appId: 'l' }, w);",
    after: "createLineEntity(undefined, { appId: 'l', world: w });",
  },
  'reshape:getScene': {
    imports: "import { getScene } from 'aekasha';",
    before: "getScene('s', false, true);",
    after: "getScene('s', { silent: false, throwOnError: true });",
  },
  'reshape:createSceneLoader': {
    imports: "import { createSceneLoader } from 'aekasha';",
    before: "createSceneLoader({ id: 'l' }, false);",
    after: "createSceneLoader({ id: 'l' }, { isCurrent: false });",
  },
  'reshape:setLightEnabled': {
    imports:
      "import { setLightEnabled, type ECSWorld } from 'aekasha';\ndeclare const w: ECSWorld;",
    before: 'setLightEnabled(1, true, w);',
    after: 'setLightEnabled(w, 1, true);',
  },
  'reshape:getLightTargetId': {
    imports:
      "import { getLightTargetId, type ECSWorld } from 'aekasha';\ndeclare const w: ECSWorld;",
    before: 'getLightTargetId(1, w);',
    after: 'getLightTargetId(w, 1);',
  },
  'reshape:createEntity': {
    imports: "import { createEntity, type ECSWorld } from 'aekasha';\ndeclare const w: ECSWorld;",
    before: "createEntity({ appId: 'e' }, w);",
    after: "createEntity({ appId: 'e', world: w });",
  },
};

describe('the reshape rules', () => {
  it.each(RESHAPE_RULES.map((rule) => [rule.id, rule] as const))(
    '%s: its fixture, and the old arguments each used once',
    (_, rule) => {
      const used = rule.args.flatMap((arg) =>
        'param' in arg ? [arg.param] : arg.props.map((p) => ('key' in p ? p.param : p.spread))
      );
      expect([...used].sort()).toEqual([...rule.params].sort());
      const fixture = RESHAPE_FIXTURES[rule.id];
      expect(fixture, rule.id).toBeDefined();
      expect(migrate(lines(fixture.imports, fixture.before))).toBe(
        lines(fixture.imports, fixture.after)
      );
    }
  );
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

  it("the creators: the entity's options and the world folded into one, a new-shaped call left", () => {
    const imports = lines(
      "import { createEntity, createMeshEntity, type CreateEntityOpts, type ECSWorld } from 'aekasha';",
      "import { createLineEntity } from 'aekasha/lines';",
      'declare const world: ECSWorld;',
      'declare const opts: CreateEntityOpts;'
    );
    expect(
      migrate(
        lines(
          imports,
          'createMeshEntity({}, undefined, world);',
          'createMeshEntity({}, opts, world);',
          "createMeshEntity({}, { appId: 'a' }, undefined);",
          'createMeshEntity({}, opts);',
          "createMeshEntity({}, { appId: 'b', world });",
          'createEntity(undefined, world);',
          'createEntity(opts, world);',
          'createEntity(opts);',
          'createLineEntity(undefined, undefined, world);'
        )
      )
    ).toBe(
      lines(
        imports,
        'createMeshEntity({}, { world });',
        'createMeshEntity({}, { ...opts, world });',
        "createMeshEntity({}, { appId: 'a' });",
        'createMeshEntity({}, opts);',
        "createMeshEntity({}, { appId: 'b', world });",
        'createEntity({ world });',
        'createEntity({ ...opts, world });',
        'createEntity(opts);',
        'createLineEntity(undefined, { world });'
      )
    );
  });

  it('getScene and createSceneLoader: a flag where the options go now, a new-shaped call left', () => {
    const imports = lines(
      "import { createSceneLoader, getScene } from 'aekasha';",
      'declare const flag: boolean;',
      'declare const isCurrent: boolean | undefined;'
    );
    expect(
      migrate(
        lines(
          imports,
          "getScene('a', true);",
          "getScene('a', undefined, true);",
          "getScene('a', flag);",
          "getScene('a', { silent: true });",
          "getScene('a', undefined);",
          "getScene('a');",
          "createSceneLoader({ id: 'l' }, isCurrent);",
          "createSceneLoader({ id: 'l' }, { isCurrent: false });"
        )
      )
    ).toBe(
      lines(
        imports,
        "getScene('a', { silent: true });",
        "getScene('a', { throwOnError: true });",
        "getScene('a', { silent: flag });",
        "getScene('a', { silent: true });",
        "getScene('a', undefined);",
        "getScene('a');",
        "createSceneLoader({ id: 'l' }, { isCurrent });",
        "createSceneLoader({ id: 'l' }, { isCurrent: false });"
      )
    );
  });

  it('setLightEnabled: the world first when the arguments commute, a new-shaped call left', () => {
    const imports = lines(
      "import { getECSWorld, setLightEnabled, type ECSWorld } from 'aekasha';",
      'declare const world: ECSWorld;',
      'declare const ids: { lamp: number };',
      'declare const makeWorld: () => ECSWorld;',
      'declare const on: boolean;'
    );
    expect(
      migrate(
        lines(
          imports,
          'setLightEnabled(ids.lamp, !on, world);',
          'setLightEnabled(ids.lamp, false, getECSWorld());',
          'setLightEnabled(1, true, makeWorld());',
          'setLightEnabled(world, ids.lamp, on);'
        )
      )
    ).toBe(
      lines(
        imports,
        'setLightEnabled(world, ids.lamp, !on);',
        'setLightEnabled(getECSWorld(), ids.lamp, false);',
        'setLightEnabled(makeWorld(), 1, true);',
        'setLightEnabled(world, ids.lamp, on);'
      )
    );
  });

  it('reports a reorder past an argument with side effects', () => {
    expect(
      reportsOf(
        lines(
          "import { setLightEnabled, type ECSWorld } from 'aekasha';",
          'declare const makeWorld: () => ECSWorld;',
          'declare const nextId: () => number;',
          'let id = 0;',
          'setLightEnabled(id, true, makeWorld());',
          'setLightEnabled(nextId(), true, makeWorld());',
          'setLightEnabled(id++, true, makeWorld());'
        )
      ).map((r) => r.slice(0, r.indexOf(':', r.indexOf('`'))))
    ).toEqual([
      'app/a.ts:5 `setLightEnabled`',
      'app/a.ts:6 `setLightEnabled`',
      'app/a.ts:7 `setLightEnabled`',
    ]);
  });
});
