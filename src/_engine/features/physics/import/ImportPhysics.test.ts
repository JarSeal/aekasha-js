import * as THREE from 'three/webgpu';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { parseCustomProps } from '../../../kernel/assets/import/CustomProps';
import type {
  ImportedGeometryInfo,
  ImportSpawnNode,
} from '../../../kernel/assets/import/ImportTypes';
import type { PhysicsEntityProps } from '../PhysicsEntity';
import { spawnImportedPhysics } from './ImportPhysics';

// The bodies it asks for (each call's entity id is 100 + its order), and the warnings
const fns = vi.hoisted(() => ({
  create: vi.fn<(props: PhysicsEntityProps) => Promise<number>>(),
  lwarn: vi.fn(),
}));
vi.mock(import('../PhysicsEntity'), () => ({ createPhysicsEntity: fns.create }));
vi.mock(import('../../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lwarn: fns.lwarn,
}));

beforeEach(() => {
  fns.create.mockReset();
  fns.create.mockImplementation(async () => 100 + fns.create.mock.calls.length);
  fns.lwarn.mockClear();
});

/** A spawned node: a 1 m box at x, with the given custom props; visible when `entityId` is given. */
const node = (
  localName: string,
  raw: Record<string, unknown>,
  { x = 0, entityId }: { x?: number; entityId?: number } = {}
): ImportSpawnNode => {
  const props = parseCustomProps(raw);
  return {
    info: {
      geometryId: `test/${localName}`,
      importId: 'test',
      nodeName: localName,
      parentPath: [],
      transform: {
        position: { x, y: 0, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      customProps: props,
      isDracoCompressed: false,
    } satisfies ImportedGeometryInfo,
    geometry: new THREE.BoxGeometry(1, 1, 1),
    props,
    localName,
    position: new THREE.Vector3(x, 0, 0),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(1, 1, 1),
    entityId,
  };
};

const body = (rigidType: string, extra: Record<string, unknown> = {}) => ({
  isPhysObj: true,
  keepMesh: true,
  rigidType,
  colliderType: 'BOX',
  ...extra,
});
const collider = (extra: Record<string, unknown> = {}) => ({
  isPhysObj: true,
  colliderType: 'BOX',
  ...extra,
});

const spawn = (nodes: ImportSpawnNode[]) =>
  spawnImportedPhysics({ nodes, params: {}, appIdPrefix: 'test', importId: 'test' });

/** Each body asked for: its type, the mesh entity it attaches to and its colliders' x offsets. */
const getBodies = () =>
  fns.create.mock.calls.map(([props]) => ({
    rigidType: props.body?.rigidType,
    target: props.target,
    colliders: [props.colliders].flat().map((c) => c.translation?.x ?? 0),
  }));

const getWarnings = () => fns.lwarn.mock.calls.map(([message]) => String(message));

describe('spawnImportedPhysics groups', () => {
  test('a body per node with a rigidType and no index (i030)', async () => {
    const ids = await spawn([
      node('crate', body('DYNAMIC'), { entityId: 1 }),
      node('barrel', body('DYNAMIC'), { x: 3, entityId: 2 }),
      node('ground', body('FIXED'), { x: -3, entityId: 3 }),
    ]);
    expect(ids).toEqual([101, 102, 103]);
    expect(getBodies()).toEqual([
      { rigidType: 'DYNAMIC', target: 1, colliders: [0] },
      { rigidType: 'DYNAMIC', target: 2, colliders: [0] },
      { rigidType: 'FIXED', target: 3, colliders: [0] },
    ]);
    expect(getWarnings()).toEqual([]);
  });

  test("the file's one body without an index takes the colliders without one, as before", async () => {
    await spawn([
      node('wheelL', collider(), { x: -1 }),
      node('cart', body('DYNAMIC'), { x: 2, entityId: 1 }),
      node('decor', {}, { x: 5, entityId: 2 }),
      node('wheelR', collider(), { x: 3 }),
    ]);
    expect(getBodies()).toEqual([{ rigidType: 'DYNAMIC', target: 1, colliders: [0, -3, 1] }]);
    expect(getWarnings()).toEqual([]);
  });

  test('with several bodies without an index, the colliders without one join none and warn', async () => {
    await spawn([
      node('crate', body('DYNAMIC'), { entityId: 1 }),
      node('wall', collider(), { x: 1 }),
      node('barrel', body('DYNAMIC'), { x: 3, entityId: 2 }),
    ]);
    expect(getBodies()).toEqual([
      { rigidType: 'DYNAMIC', target: 1, colliders: [0] },
      { rigidType: 'DYNAMIC', target: 2, colliders: [0] },
    ]);
    expect(getWarnings()).toEqual([
      expect.stringMatching(/^spawnImportedAsset: import "test": .*"wall".* join none/),
    ]);
  });

  test('a second node with a rigidType in an index group gets no physics and warns', async () => {
    await spawn([
      node('crate', body('DYNAMIC', { index: 1 }), { entityId: 1 }),
      node('lid', body('DYNAMIC', { index: 1 }), { x: 1, entityId: 2 }),
      node('handle', collider({ index: 1 }), { x: 2 }),
    ]);
    expect(getBodies()).toEqual([{ rigidType: 'DYNAMIC', target: 1, colliders: [0, 2] }]);
    expect(getWarnings()).toEqual([
      expect.stringMatching(/"index" 1 has more than one .*"lid" get no physics .*"crate"/),
    ]);
  });

  test('physics nodes with no body to join warn', async () => {
    const ids = await spawn([
      node('rock', collider()),
      node('post', collider({ index: 2 }), { x: 1 }),
      node('fence', {}, { x: 2, entityId: 1 }),
    ]);
    expect(ids).toEqual([]);
    expect(fns.create).not.toHaveBeenCalled();
    expect(getWarnings()).toEqual([
      expect.stringMatching(/"rock" have no "index" and no node without one has a "rigidType"/),
      expect.stringMatching(/"post" of "index" 2 have no node with a "rigidType"/),
    ]);
  });
});
