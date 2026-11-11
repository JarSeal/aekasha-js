import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

// The tab's definition, captured
const tab = vi.hoisted(() => ({ def: null as unknown }));
vi.mock(import('../../../debug/DebuggerGUI'), async (importOriginal) => ({
  ...(await importOriginal()),
  createDebuggerTab: (def: unknown) => {
    tab.def = def;
  },
  debuggerListCMP: vi.fn() as never,
}));
const fns = vi.hoisted(() => ({ lwarn: vi.fn() }));
vi.mock(import('../../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lwarn: fns.lwarn,
}));

import * as THREE from 'three/webgpu';
import type { AnyDebuggerTabDef } from '../../../debug/DebuggerGUI';
import { getConfig, initEnvironment } from '../../../kernel/config/Config';
import { ECSWorld } from '../../../kernel/ecs/ECS';
import { installCoreSystems } from '../../../kernel/ecs/ECSCoreSystems';
import { createFeatureHost } from '../../../kernel/init/Features';
import { createGeometry } from '../../../kernel/assets/Geometry';
import { createMaterial } from '../../../kernel/assets/Material';
import { createMeshEntity, installMeshes } from '../../../kernel/mesh/Mesh';
import { createRootScene } from '../../../kernel/scene/Scene';
import {
  addToMergeGroup,
  buildPendingMergeGroupsAsync,
  installMergeGroups,
  removeFromMergeGroup,
  updateMergeMember,
} from '../MergeGroups';
import { getMergeDebugStats, MAX_MERGE_REFUSALS, noteMergeRefusal } from '../MergeState';
import {
  _createMergingDebugGUI,
  formatMergeSummary,
  getMergeGroupListData,
  getMergeRefusalListData,
} from './_dbg__Merging';
import {
  createMergeRateMeter,
  getAutoCellLabel,
  getMergeSummary,
  getStandingRefusals,
} from './_dbg__MergingInfo';

let world: ECSWorld;
beforeAll(() => {
  // The merging code records its debug figures in the debug env only
  initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
  world = new ECSWorld();
  createRootScene();
  const { ctx } = createFeatureHost(getConfig());
  installCoreSystems(ctx);
  installMeshes(ctx);
  installMergeGroups(ctx);
  createGeometry({
    id: 'mergingTabBox',
    type: 'BOX',
    params: { width: 1, height: 1, depth: 1 },
    isPersistent: true,
  });
  createMaterial({ id: 'mergingTabMat', type: 'BASIC', params: {}, isPersistent: true });
});

afterEach(() => {
  world.clearWorld();
  fns.lwarn.mockClear();
  const stats = getMergeDebugStats(world);
  stats.builds = 0;
  stats.inPlaceUpdates = 0;
  stats.lastBuild = null;
  stats.refusals.clear();
});

let seq = 0;
const createBox = (x: number, props: { castShadow?: boolean; merge?: string } = {}) =>
  createMeshEntity({
    geo: 'mergingTabBox',
    mat: 'mergingTabMat',
    position: { x, y: 0, z: 0 },
    ...props,
  });

/** A built group of `count` boxes 2 m apart. */
const createGroupAsync = async (count = 3, castShadow = false) => {
  const groupId = `tabGroup${seq++}`;
  const members = Array.from({ length: count }, (_, i) => createBox(i * 2, { castShadow }));
  addToMergeGroup(groupId, members);
  await buildPendingMergeGroupsAsync();
  return { groupId, members };
};

describe('the debug figures', () => {
  test('count the builds and in-place updates, and keep the last build', async () => {
    const { groupId, members } = await createGroupAsync();
    const stats = getMergeDebugStats(world);
    expect(stats.builds).toBe(1);
    expect(stats.lastBuild).toMatchObject({ groupId, isWorker: false });
    expect(stats.lastBuild!.ms).toBeGreaterThanOrEqual(0);

    // A move, a disable and its enable, a remove: four range writes, no build
    world.setTransform(members[0], { pos: { x: -1, y: 0, z: 0 } });
    updateMergeMember(members[0]);
    world.setDisabled(members[1], true);
    world.setDisabled(members[1], false);
    removeFromMergeGroup([members[2]]);
    expect(stats.inPlaceUpdates).toBe(4);
    expect(stats.builds).toBe(1);
  });

  test("record the refusals: a group's, AUTO's and an invalid merge", async () => {
    const { groupId } = await createGroupAsync(1);
    const transparent = createMeshEntity({
      geo: 'mergingTabBox',
      mat: new THREE.MeshBasicNodeMaterial({ transparent: true }),
    });
    addToMergeGroup(groupId, [transparent]);
    const autoTransparent = createMeshEntity({
      geo: 'mergingTabBox',
      mat: new THREE.MeshBasicNodeMaterial({ transparent: true }),
      merge: 'AUTO',
    });
    const invalid = createBox(9, { merge: 'auto:taken' });
    await buildPendingMergeGroupsAsync();

    const rows = getStandingRefusals(world);
    // Newest first
    expect(rows.map((row) => row.entityId)).toEqual([autoTransparent, invalid, transparent]);
    expect(rows[0]).toMatchObject({
      groupId: 'AUTO',
      reason: expect.stringContaining('transparent'),
    });
    expect(rows[1]).toMatchObject({
      groupId: 'auto:taken',
      reason: expect.stringContaining('invalid'),
    });
    expect(rows[2]).toMatchObject({ groupId, reason: expect.stringContaining('transparent') });

    // A deleted one, and one that joined a group since, no longer stand
    world.deleteEntity(transparent);
    world.addComponent(invalid, 'CORE_MERGE_MEMBER' as never, {} as never);
    expect(getStandingRefusals(world).map((row) => row.entityId)).toEqual([autoTransparent]);
  });

  test(`keeps the newest ${MAX_MERGE_REFUSALS} refusals, a repeated one moved to the newest`, () => {
    for (let i = 0; i < MAX_MERGE_REFUSALS + 5; i++) noteMergeRefusal(world, i, 'g', 'r');
    noteMergeRefusal(world, 10, 'g', 'again');
    const { refusals } = getMergeDebugStats(world);
    expect(refusals.size).toBe(MAX_MERGE_REFUSALS);
    expect([...refusals.keys()][0]).toBe(5);
    expect([...refusals.entries()].at(-1)).toEqual([10, { groupId: 'g', reason: 'again' }]);
  });
});

describe('the summary', () => {
  test('counts the groups, members, vertices and draws per pass', async () => {
    await createGroupAsync(3, true);
    const other = await createGroupAsync(2);
    // A member disabled draws in neither; one joined and not built yet draws on its own
    world.setDisabled(other.members[0], true);
    const waiting = createBox(20);
    addToMergeGroup(other.groupId, [waiting]);

    const summary = getMergeSummary(world);
    expect(summary).toMatchObject({
      groups: 2,
      drawnGroups: 2,
      pendingGroups: 1,
      members: 6,
      builtMembers: 5,
      queued: 0,
      // A box is 24 vertices
      mergedVertices: 5 * 24,
      wastedVertices: 0,
      drawsNow: 3,
      drawsUnmerged: 5,
      shadowDrawsNow: 1,
      shadowDrawsUnmerged: 3,
    });
    const text = formatMergeSummary(world, { builds: 2, updates: 1 });
    expect(text.groups).toBe('2 (2 drawn, 1 pending)');
    expect(text.members).toBe('6 (5 merged, 1 waiting, 0 queued)');
    expect(text.draws).toBe('3 now · 5 unmerged');
    expect(text.shadowDraws).toBe('1 now · 3 unmerged');
    expect(text.builds).toBe('2 (2 in total)');
    expect(text.lastBuild).toMatch(/^\d+\.\d ms, main thread: tabGroup\d+$/);
  });

  test('counts a removed member as wasted until a rebuild', async () => {
    const { members } = await createGroupAsync(4);
    removeFromMergeGroup([members[0]]);
    expect(getMergeSummary(world)).toMatchObject({ mergedVertices: 96, wastedVertices: 24 });
    expect(formatMergeSummary(world, { builds: 0, updates: 0 }).wasted).toBe('24 (25 %)');
  });
});

describe('the rate meter', () => {
  test('counts since the newest sample at least a second old', () => {
    const stats = getMergeDebugStats(world);
    const meter = createMergeRateMeter();
    expect(meter.read(world, 0)).toEqual({ builds: 0, updates: 0 });
    stats.builds = 3;
    expect(meter.read(world, 500)).toEqual({ builds: 3, updates: 0 });
    stats.builds = 5;
    stats.inPlaceUpdates = 2;
    // At 1.2 s the sample at 0.5 s isn't a second old: the base is still the one at 0; at 1.6 s
    // it is, and it becomes the base
    expect(meter.read(world, 1200)).toEqual({ builds: 5, updates: 2 });
    expect(meter.read(world, 1600)).toEqual({ builds: 2, updates: 2 });
    meter.reset();
    expect(meter.read(world, 1700)).toEqual({ builds: 0, updates: 0 });
  });
});

describe('the tab', () => {
  test('lists a row per group: its id, AUTO badge and cell, material, members and vertices', async () => {
    const { groupId } = await createGroupAsync(2);
    for (let i = 0; i < 3; i++) createBox(100 + i, { merge: 'AUTO' });
    await buildPendingMergeGroupsAsync();

    const rows = getMergeGroupListData(world);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      title: groupId,
      description: 'mergingTabMat',
      suffix: '2 members, 48 v',
    });
    expect(rows[0].badge).toBeUndefined();
    expect(rows[1]).toMatchObject({ badge: 'AUTO', suffix: '3 members, 72 v' });
    expect(rows[1].title).toMatch(/^auto:/);
    expect(rows[1].description).toBe(`mergingTabMat · cell ${getAutoCellLabel(rows[1].title)}`);
  });

  test('reads an AUTO id’s cell', () => {
    expect(getAutoCellLabel('auto:1abc:3,-2:1')).toBe('3, -2 (#1)');
    expect(getAutoCellLabel('ruins')).toBeNull();
  });

  test('lists the standing refusals by name with their group and reason', () => {
    const entityId = createBox(0);
    noteMergeRefusal(world, entityId, 'ruins', 'its material is transparent');
    expect(getMergeRefusalListData(world)).toEqual([
      {
        itemId: String(entityId),
        title: `Entity ${entityId}`,
        subTitle: `[${entityId}]`,
        description: 'ruins: its material is transparent',
      },
    ]);
  });

  test('refreshes its readouts from the default world', async () => {
    _createMergingDebugGUI();
    const def = tab.def as AnyDebuggerTabDef;
    expect(def).toMatchObject({ id: 'mergingControls', icon: 'merge', keepOnSceneChange: true });
    await createGroupAsync(2);
    def.onRefresh!();
    const sections = def.content!({} as never) as { content?: { target?: { groups: string } }[] }[];
    expect(sections[0].content![0].target!.groups).toBe('1 (1 drawn, 0 pending)');
  });
});
