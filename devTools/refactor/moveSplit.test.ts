import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parseModuleSource, resolveSpecifier } from './importGraph';
import { buildPathMap } from './moveApply';
import type { MoveEntry } from './moveRules';
import { splitModules } from './moveSplit';

const ROOT = path.resolve(__dirname, '../..');
const E = 'src/_engine/';
const H = `${E}utils/helpers.ts`;
const C = `${E}utils/constants.ts`;

type Tree = Record<string, { to?: string | null; split?: Record<string, string>; text: string }>;

/** Splits a tree's split files; `to` moves a file, `null` keeps it */
const run = (tree: Tree, current: Record<string, string> = {}) => {
  const moveMap: Record<string, MoveEntry> = {};
  for (const [file, { to, split }] of Object.entries(tree)) {
    if (split) moveMap[file] = { to: file, action: 'split', plan: 'p608', split };
    else if (to) moveMap[file] = { to, action: 'move', plan: 'p608' };
  }
  const map = buildPathMap({ files: Object.keys(tree), moveMap, plan: 'p608' });
  expect(map.errors).toEqual([]);
  const texts = new Map(Object.entries(tree).map(([file, { text }]) => [file, text]));
  const { targets, errors } = splitModules(map, {
    texts,
    sourceText: (file) => texts.get(file) as string,
    current: (file) => current[file] ?? (texts.get(file) as string),
  });
  return { targets: Object.fromEntries(targets), errors };
};

const lines = (...l: string[]) => l.join('\n');

describe('splitModules', () => {
  it('sends each statement with its comments to its export’s target, with the imports it uses', () => {
    const { targets, errors } = run({
      [H]: {
        split: {
          isPNG: `${E}kernel/assets/AssetFiles.ts`,
          RemovalTypes: `${E}kernel/assets/Disposal.ts`,
          removeObject: `${E}kernel/assets/Disposal.ts`,
          log: `${E}kernel/config/DebugModules.ts`,
        },
        text: lines(
          "import * as THREE from 'three/webgpu';",
          "import type { Materials } from '../core/Material';",
          "import { lerror, lwarn } from './Logger';",
          "import { IS_DEBUG_ENV } from '../core/Config';",
          '',
          '/** Whether a file is a PNG */',
          "export const isPNG = (name: string) => name.endsWith('.png'); // no query",
          '',
          '// The objects a removal takes',
          'export type RemovalTypes = THREE.Mesh | THREE.Light;',
          '',
          'export const removeObject = (obj: RemovalTypes, mat?: Materials) => {',
          '  const lerror = obj.name; // a local, not the import',
          '  obj.removeFromParent();',
          '};',
          '',
          'export function log(message: string) {',
          '  if (IS_DEBUG_ENV) lerror(message, { lwarn: 1 });',
          '}',
          ''
        ),
      },
      [`${E}core/Material.ts`]: { to: `${E}kernel/assets/Material.ts`, text: '' },
      [`${E}core/Config.ts`]: { to: `${E}kernel/config/Config.ts`, text: '' },
      [`${E}utils/Logger.ts`]: { to: null, text: '' },
    });
    expect(errors).toEqual([]);
    expect(targets).toEqual({
      [`${E}kernel/assets/AssetFiles.ts`]: lines(
        '/** Whether a file is a PNG */',
        "export const isPNG = (name: string) => name.endsWith('.png'); // no query",
        ''
      ),
      [`${E}kernel/assets/Disposal.ts`]: lines(
        "import type * as THREE from 'three/webgpu';",
        "import type { Materials } from './Material';",
        '',
        '// The objects a removal takes',
        'export type RemovalTypes = THREE.Mesh | THREE.Light;',
        '',
        'export const removeObject = (obj: RemovalTypes, mat?: Materials) => {',
        '  const lerror = obj.name; // a local, not the import',
        '  obj.removeFromParent();',
        '};',
        ''
      ),
      [`${E}kernel/config/DebugModules.ts`]: lines(
        "import { lerror } from '../../utils/Logger';",
        "import { IS_DEBUG_ENV } from './Config';",
        '',
        'export function log(message: string) {',
        '  if (IS_DEBUG_ENV) lerror(message, { lwarn: 1 });',
        '}',
        ''
      ),
    });
  });

  it('imports the other parts it uses, a type as a type, and another split’s names by their target', () => {
    const { targets, errors } = run({
      [H]: {
        split: {
          scratch: `${E}kernel/render/ThreeMath.ts`,
          Shape: `${E}kernel/render/ThreeMath.ts`,
          measure: `${E}kernel/mesh/MeshUserData.ts`,
        },
        text: lines(
          "import * as THREE from 'three/webgpu';",
          "import { HALF_PI, DOWN } from './constants';",
          'export const scratch = new THREE.Vector3();',
          "export type Shape = 'BOX' | 'BALL';",
          'export const measure = (shape: Shape, mesh: THREE.Mesh) => {',
          '  mesh.rotation.x = HALF_PI;',
          '  return { scratch, DOWN };',
          '};'
        ),
      },
      [C]: {
        split: { HALF_PI: `${E}utils/Constants.ts`, DOWN: `${E}kernel/render/ThreeMath.ts` },
        text: lines(
          "import * as THREE from 'three/webgpu';",
          'export const HALF_PI = Math.PI / 2;',
          'export const DOWN = new THREE.Vector3(0, -1, 0);'
        ),
      },
    });
    expect(errors).toEqual([]);
    expect(targets[`${E}kernel/mesh/MeshUserData.ts`]).toBe(
      lines(
        "import type * as THREE from 'three/webgpu';",
        "import { HALF_PI } from '../../utils/Constants';",
        "import { DOWN, scratch } from '../render/ThreeMath';",
        "import type { Shape } from '../render/ThreeMath';",
        '',
        'export const measure = (shape: Shape, mesh: THREE.Mesh) => {',
        '  mesh.rotation.x = HALF_PI;',
        '  return { scratch, DOWN };',
        '};',
        ''
      )
    );
    // Two splits' parts in one target: the map's order, one `THREE`, neighbours kept together;
    // the source's own new name
    expect(targets[`${E}kernel/render/ThreeMath.ts`]).toBe(
      lines(
        "import * as THREE from 'three/webgpu';",
        '',
        'export const scratch = new THREE.Vector3();',
        "export type Shape = 'BOX' | 'BALL';",
        '',
        'export const DOWN = new THREE.Vector3(0, -1, 0);',
        ''
      )
    );
    expect(targets[`${E}utils/Constants.ts`]).toBe('export const HALF_PI = Math.PI / 2;\n');
  });

  it('drops a re-export that names its own target, and moves one that doesn’t', () => {
    const { targets, errors } = run({
      [H]: {
        split: {
          isOnlyObject3D: `${E}kernel/render/Object3DHelpers.ts`,
          clamp: `${E}utils/Numbers.ts`,
        },
        text: lines(
          '// Lives in a worker-safe module, re-exported here',
          "export { isOnlyObject3D } from './object3DHelpers';",
          '/** Clamps */',
          "export { clamp } from '../core/MathUtils';"
        ),
      },
      [`${E}utils/object3DHelpers.ts`]: {
        to: `${E}kernel/render/Object3DHelpers.ts`,
        text: 'export const isOnlyObject3D = () => true;\n',
      },
      [`${E}core/MathUtils.ts`]: { to: `${E}kernel/math/MathUtils.ts`, text: '' },
    });
    expect(errors).toEqual([]);
    expect(targets).toEqual({
      [`${E}utils/Numbers.ts`]:
        "/** Clamps */\nexport { clamp } from '../kernel/math/MathUtils';\n",
    });
  });

  it("appends to a moved file's text, merging the imports", () => {
    const moved = `${E}kernel/render/Object3DHelpers.ts`;
    const { targets, errors } = run(
      {
        [H]: {
          split: { cloneDeep: moved, isMesh: moved },
          text: lines(
            "import * as THREE from 'three/webgpu';",
            "import { lerror, lwarn } from './Logger';",
            "import { getMaterial } from '../core/Material';",
            'export const cloneDeep = (o: THREE.Object3D) => (lwarn(), getMaterial(o), o.clone());',
            "export const isMesh = (o: THREE.Object3D) => (lerror('x'), o instanceof THREE.Mesh);"
          ),
        },
        [`${E}utils/object3DHelpers.ts`]: { to: moved, text: '' },
        [`${E}utils/Logger.ts`]: { to: null, text: '' },
        [`${E}core/Material.ts`]: { to: `${E}kernel/assets/Material.ts`, text: '' },
      },
      {
        // The moved file's text after the rewrite
        [`${E}utils/object3DHelpers.ts`]: lines(
          '/** Worker-safe */',
          "import type * as THREE from 'three/webgpu';",
          "import { lerror } from '../../utils/Logger';",
          '',
          'export const isOnlyObject3D = (o: THREE.Object3D) => (lerror(), true);',
          ''
        ),
      }
    );
    expect(errors).toEqual([]);
    expect(targets[moved]).toBe(
      lines(
        '/** Worker-safe */',
        "import * as THREE from 'three/webgpu';",
        "import { lerror, lwarn } from '../../utils/Logger';",
        "import { getMaterial } from '../assets/Material';",
        '',
        'export const isOnlyObject3D = (o: THREE.Object3D) => (lerror(), true);',
        '',
        'export const cloneDeep = (o: THREE.Object3D) => (lwarn(), getMaterial(o), o.clone());',
        "export const isMesh = (o: THREE.Object3D) => (lerror('x'), o instanceof THREE.Mesh);",
        ''
      )
    );
  });

  it('reports what goes with no export or no target, and splits nothing', () => {
    expect(
      run({
        [H]: {
          split: { a: `${E}utils/A.ts`, gone: `${E}utils/A.ts` },
          text: lines(
            '// The header',
            "import { x } from 'pkg';",
            "import 'side-effect';",
            'const local = 1;',
            'export const a = local, b = 2;',
            "export * from 'pkg';",
            'export default a;'
          ),
        },
      })
    ).toEqual({
      targets: {},
      errors: [
        `${H}:2 a comment above an import goes with no export: move it`,
        `${H}:3 a side-effect import goes with no export`,
        `${H}:4 a statement that exports nothing goes with no export`,
        `${H}:6 \`export *\` goes with no export: re-export its names`,
        `${H}:7 a default export has no name to split by`,
        `${H}: b has no target in the split`,
        `${H}: the split names gone, which isn't exported`,
      ],
    });
  });

  it("reports a name a moved file already has, and a binding's clash", () => {
    const moved = `${E}kernel/render/Object3DHelpers.ts`;
    const { errors } = run(
      {
        [H]: {
          split: { isMesh: moved },
          text: lines(
            "import { lerror } from './Logger';",
            "export const isMesh = () => lerror('x');"
          ),
        },
        [`${E}utils/object3DHelpers.ts`]: { to: moved, text: '' },
        [`${E}utils/Logger.ts`]: { to: null, text: '' },
      },
      {
        [`${E}utils/object3DHelpers.ts`]: lines(
          "import { lerror } from './OtherLogger';",
          'export const isMesh = () => false;'
        ),
      }
    );
    expect(errors).toEqual([
      `${moved} already has isMesh`,
      `${moved} binds lerror to ./OtherLogger, a part to ${E}utils/Logger.ts`,
    ]);
  });

  it('reports an import cycle the tree before the move didn’t have', () => {
    const tree: Tree = {
      [H]: {
        split: { a: `${E}utils/A.ts`, b: `${E}utils/B.ts`, bTwice: `${E}utils/B.ts` },
        text: lines(
          'export const a = () => b();',
          'export const b = () => a();',
          'export const bTwice = () => b();'
        ),
      },
    };
    expect(run(tree).errors).toEqual([
      `the split makes a new import cycle: ${E}utils/A.ts → ${E}utils/B.ts`,
    ]);

    // One the tree had: helpers ↔ Scene, through its parts
    const { errors } = run({
      [H]: {
        split: { remove: `${E}kernel/assets/Disposal.ts` },
        text: "import { getRoot } from '../core/Scene';\nexport const remove = () => getRoot();",
      },
      [`${E}core/Scene.ts`]: {
        to: `${E}kernel/scene/Scene.ts`,
        text: "import { remove } from '../utils/helpers';\nexport const getRoot = () => remove();",
      },
    });
    expect(errors).toEqual([]);
  });
});

describe("today's split files", () => {
  it('lands every export of helpers.ts and constants.ts in its target, each import resolving', () => {
    const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf-8' })
      .trim()
      .split('\n');
    const moveMap = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'devTools/refactor/moveMap.json'), 'utf-8')
    ).files;
    const map = buildPathMap({ files, moveMap, plan: 'p608' });
    expect(map.errors).toEqual([]);
    const texts = new Map<string, string>();
    for (const file of files) {
      if (file.endsWith('.ts') && fs.existsSync(path.join(ROOT, file))) {
        texts.set(file, fs.readFileSync(path.join(ROOT, file), 'utf-8'));
      }
    }
    const read = (file: string) => texts.get(file) as string;
    const { targets, errors } = splitModules(map, { texts, sourceText: read, current: read });
    expect(errors).toEqual([]);
    expect([H, C].every((file) => map.splits.has(file))).toBe(true);

    const missing: string[] = [];
    for (const [source, split] of map.splits) {
      for (const [name, target] of Object.entries(split)) {
        // A moved file nothing was appended to keeps its own text (`isOnlyObject3D`)
        const owner = map.oldPathOf(target) as string;
        const text = targets.get(target) ?? read(owner);
        const { exports } = parseModuleSource(target, text);
        if (!exports.local.includes(name) && !exports.named[name]) {
          missing.push(`${source}: ${name} isn't exported by ${target}`);
        }
      }
    }
    expect(missing).toEqual([]);

    const unresolved: string[] = [];
    for (const [target, text] of targets) {
      for (const { specifier } of parseModuleSource(target, text).imports) {
        if (!specifier.startsWith('.')) continue;
        const found = resolveSpecifier(target, specifier, { exists: (f) => map.newFiles.has(f) });
        if (!found) unresolved.push(`${target}: '${specifier}'`);
      }
    }
    expect(unresolved).toEqual([]);
  });
});
