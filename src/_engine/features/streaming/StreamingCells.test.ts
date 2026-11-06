import { afterEach, describe, expect, test, vi } from 'vitest';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { packCellKey } from '../../utils/CellKey';
import * as Logger from '../../utils/Logger';
import {
  type StreamingBudgets,
  type StreamingRuntime,
  createStreamingRuntime,
  decideStreamingCells,
  dropStreamingCells,
  loadStreamingCellsNowAsync,
  pumpStreamingCells,
} from './StreamingCells';
import {
  type StreamingCellContent,
  addStreamingCellContent,
  clearSceneStreamingContent,
} from './StreamingContent';
import { StreamingLevel } from './StreamingRings';
import { resolveStreamingSettings } from './StreamingSettings';

// A 64 m grid with rings 1, 2 (5: FAR, which loads nothing yet) and a 16 m margin; every test gets
// its own scene id and world, and a clock it moves by hand
let seq = 0;
const worldIds: string[] = [];
const sceneIds: string[] = [];

const setup = (budgets: Partial<StreamingBudgets> = {}) => {
  const id = `streaming-test-${seq++}`;
  worldIds.push(id);
  sceneIds.push(id);
  const world = new ECSWorld({ id, maxEntities: 10_000, applyGlobalPlugins: false });
  const clock = { ms: 0 };
  const rt = createStreamingRuntime(
    id,
    resolveStreamingSettings({ cellSize: 64 }),
    world,
    () => clock.ms
  );
  const fullBudgets: StreamingBudgets = {
    maxConcurrentLoads: 100,
    maxCreateMsPerFrame: 1000,
    ...budgets,
  };
  return { rt, world, clock, pump: () => pumpStreamingCells(rt, fullBudgets) };
};

type Unit = Pick<StreamingCellContent, 'load' | 'unload'>;

const add = (rt: StreamingRuntime, cellKey: number, unit: Unit) =>
  addStreamingCellContent({ sceneId: rt.sceneId, cellKey, ...unit });

/** Content creating `count` entities, each costing `msEach` on the clock */
const entitiesContent = (world: ECSWorld, clock: { ms: number }, count = 1, msEach = 0): Unit => ({
  load: () => {
    clock.ms += msEach;
    return Array.from({ length: count }, () => world.createEntity());
  },
});

/** Registers `content` for every cell in [-r, r]² */
const fillCells = (rt: StreamingRuntime, r: number, make: () => Unit) => {
  for (let cz = -r; cz <= r; cz++) {
    for (let cx = -r; cx <= r; cx++) add(rt, packCellKey(cx, 0, cz), make());
  }
};

const cellAt = (rt: StreamingRuntime, cx: number, cz: number) =>
  rt.cells.get(packCellKey(cx, 0, cz));

const phases = (rt: StreamingRuntime) => {
  const counts: Record<string, number> = {};
  for (const cell of rt.cells.values()) counts[cell.phase] = (counts[cell.phase] ?? 0) + 1;
  return counts;
};

afterEach(() => {
  for (const id of worldIds.splice(0)) ECSWorld.deleteWorld(id);
  for (const id of sceneIds.splice(0)) clearSceneStreamingContent(id);
  vi.restoreAllMocks();
});

describe('decideStreamingCells', () => {
  test('tracks the cells within the loaded rings, nearest first', () => {
    const { rt } = setup();
    decideStreamingCells(rt, 32, 32);
    expect(rt.cells.size).toBe(25);
    const levels = [...rt.cells.values()].map((cell) => cell.level);
    expect(levels.filter((level) => level === StreamingLevel.RESIDENT)).toHaveLength(9);
    expect(levels.filter((level) => level === StreamingLevel.NEARBY)).toHaveLength(16);
    expect(rt.order[0]).toBe(cellAt(rt, 0, 0));
    expect(rt.order.map((cell) => cell.ring)).toEqual(
      [...rt.order.map((cell) => cell.ring)].sort()
    );
  });

  test('a focus hovering on a cell boundary loads and unloads nothing', () => {
    const { rt, world, clock, pump } = setup();
    fillCells(rt, 6, () => entitiesContent(world, clock));
    decideStreamingCells(rt, 63, 32);
    pump();
    const loaded = rt.stats.loadsStarted;
    for (const x of [65, 63, 65, 50, 70, 63]) {
      decideStreamingCells(rt, x, 32);
      pump();
    }
    // The first crossing loads the new far column; the hovering after it changes nothing
    expect(rt.stats.loadsStarted).toBe(loaded + 5);
    expect(rt.stats.unloadsFinished).toBe(0);
  });
});

describe('pumpStreamingCells', () => {
  test('loads at most maxConcurrentLoads cells at once, nearest first', () => {
    const { rt, world, clock, pump } = setup({ maxConcurrentLoads: 2 });
    fillCells(rt, 2, () => entitiesContent(world, clock));
    decideStreamingCells(rt, 32, 32);
    pump();
    expect(rt.stats.loadsFinished).toBe(2);
    expect(cellAt(rt, 0, 0)?.phase).toBe('LOADED');
    for (let i = 0; i < 20; i++) pump();
    expect(phases(rt)).toEqual({ LOADED: 25 });
    expect(world.getEntityCount()).toBe(25);
  });

  test('spreads a cell over frames by maxCreateMsPerFrame, at least one unit a frame', () => {
    const { rt, world, clock, pump } = setup({ maxCreateMsPerFrame: 2 });
    const key = packCellKey(0, 0, 0);
    // A unit over the whole budget still runs, alone
    add(rt, key, entitiesContent(world, clock, 1, 10));
    for (let i = 0; i < 5; i++) {
      add(rt, key, entitiesContent(world, clock, 1, 1));
    }
    decideStreamingCells(rt, 32, 32);
    const counts: number[] = [];
    for (let i = 0; i < 4; i++) {
      pump();
      counts.push(world.getEntityCount());
    }
    expect(counts).toEqual([1, 3, 5, 6]);
    expect(cellAt(rt, 0, 0)?.phase).toBe('LOADED');
  });

  test('unloads a cell past its ring plus the margin, deleting its entities', () => {
    const { rt, world, clock, pump } = setup();
    fillCells(rt, 4, () => entitiesContent(world, clock, 2));
    decideStreamingCells(rt, 32, 32);
    pump();
    expect(world.getEntityCount()).toBe(50);
    // One cell east: the west column (cx = -2, [-128, -64)) is ring 3, 138 m from its edge: kept
    // (to 2 × 64 + 16 = 144 m), while the new east column (cx = 3) loads
    decideStreamingCells(rt, 74, 32);
    pump();
    expect(cellAt(rt, -2, 0)?.phase).toBe('LOADED');
    expect(world.getEntityCount()).toBe(60);
    // 145 m: unloaded
    decideStreamingCells(rt, 81, 32);
    pump();
    expect(cellAt(rt, -2, 0)).toBeUndefined();
    expect(world.getEntityCount()).toBe(50);
    expect(rt.stats.unloadsFinished).toBe(5);
  });

  test("calls a content's own unload with what its load returned", () => {
    const { rt, world, pump } = setup();
    const unload = vi.fn();
    const ids = [world.createEntity(), world.createEntity()];
    add(rt, packCellKey(0, 0, 0), { load: () => ids, unload });
    decideStreamingCells(rt, 32, 32);
    pump();
    decideStreamingCells(rt, 1000, 1000);
    pump();
    expect(unload).toHaveBeenCalledOnce();
    expect(unload.mock.calls[0][0]).toEqual(ids);
    expect(unload.mock.calls[0][1]).toMatchObject({ cx: 0, cz: 0, cellSize: 64 });
  });

  test('cancels a load no longer wanted, and unloads its late result', async () => {
    const { rt, world, pump } = setup();
    let resolveLoad: (ids: number[]) => void = () => {};
    let isCurrent: () => boolean = () => true;
    add(rt, packCellKey(0, 0, 0), {
      load: (ctx) => {
        isCurrent = ctx.isCurrent;
        return new Promise((resolve) => (resolveLoad = resolve));
      },
    });
    decideStreamingCells(rt, 32, 32);
    pump();
    expect(cellAt(rt, 0, 0)?.phase).toBe('LOADING');
    decideStreamingCells(rt, 1000, 1000);
    pump();
    expect(cellAt(rt, 0, 0)).toBeUndefined();
    expect(rt.stats.loadsCancelled).toBe(1);
    expect(isCurrent()).toBe(false);
    resolveLoad([world.createEntity()]);
    await Promise.resolve();
    await Promise.resolve();
    expect(rt.stats.lateResults).toBe(1);
    expect(world.getEntityCount()).toBe(0);
  });

  test('a cell wanted again while it unloads loads again after the unload', () => {
    const { rt, world, clock, pump } = setup({ maxCreateMsPerFrame: 1 });
    const key = packCellKey(0, 0, 0);
    for (let i = 0; i < 3; i++) {
      add(rt, key, {
        ...entitiesContent(world, clock, 1, 1),
        unload: (ids) => {
          clock.ms += 1;
          for (const id of ids) world.deleteEntity(id);
        },
      });
    }
    decideStreamingCells(rt, 32, 32);
    for (let i = 0; i < 3; i++) pump();
    expect(cellAt(rt, 0, 0)?.phase).toBe('LOADED');
    decideStreamingCells(rt, 1000, 1000);
    pump();
    expect(cellAt(rt, 0, 0)?.phase).toBe('UNLOADING');
    expect(world.getEntityCount()).toBe(2);
    decideStreamingCells(rt, 32, 32);
    for (let i = 0; i < 6; i++) pump();
    expect(cellAt(rt, 0, 0)?.phase).toBe('LOADED');
    expect(world.getEntityCount()).toBe(3);
    // Its second load (a load bumps the generation; an unload of a loaded cell doesn't)
    expect(cellAt(rt, 0, 0)?.generation).toBe(2);
  });

  test('a content load that throws is logged, and the cell still loads the rest', () => {
    const { rt, world, clock, pump } = setup();
    const error = vi.spyOn(Logger, 'lerror').mockImplementation(() => {});
    const key = packCellKey(0, 0, 0);
    add(rt, key, {
      load: () => {
        throw new Error('no');
      },
    });
    add(rt, key, entitiesContent(world, clock));
    decideStreamingCells(rt, 32, 32);
    pump();
    expect(cellAt(rt, 0, 0)?.phase).toBe('LOADED');
    expect(world.getEntityCount()).toBe(1);
    expect(rt.stats.unitErrors).toBe(1);
    expect(error).toHaveBeenCalledOnce();
  });
});

describe('a load that returns no ids', () => {
  test('fails its unit, sync or async, and the cell still loads', async () => {
    const { rt, pump } = setup();
    const error = vi.spyOn(Logger, 'lerror').mockImplementation(() => {});
    add(rt, packCellKey(0, 0, 0), { load: () => undefined as never });
    add(rt, packCellKey(1, 0, 0), { load: async () => 5 as never });
    decideStreamingCells(rt, 32, 32);
    pump();
    await Promise.resolve();
    await Promise.resolve();
    expect(cellAt(rt, 0, 0)?.phase).toBe('LOADED');
    expect(cellAt(rt, 1, 0)?.phase).toBe('LOADED');
    expect(rt.stats.unitErrors).toBe(2);
    expect(String(error.mock.calls[0][1])).toMatch(/not the array of entity ids/);
  });
});

describe('loadStreamingCellsNowAsync and dropStreamingCells', () => {
  test('a scene load loads every wanted cell at once, awaiting the async ones', async () => {
    const { rt, world, clock } = setup({ maxConcurrentLoads: 1, maxCreateMsPerFrame: 0 });
    fillCells(rt, 2, () => ({
      load: async () => {
        await Promise.resolve();
        return entitiesContent(world, clock, 2, 5).load({} as never);
      },
    }));
    decideStreamingCells(rt, 32, 32);
    await loadStreamingCellsNowAsync(rt);
    expect(phases(rt)).toEqual({ LOADED: 25 });
    expect(world.getEntityCount()).toBe(50);
  });

  test('the scene exit unloads everything and forgets every cell', () => {
    const { rt, world, clock, pump } = setup();
    fillCells(rt, 2, () => entitiesContent(world, clock));
    decideStreamingCells(rt, 32, 32);
    pump();
    dropStreamingCells(rt);
    expect(rt.cells.size).toBe(0);
    expect(world.getEntityCount()).toBe(0);
  });
});
