import { afterEach, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  getAssetOwnerScope,
  getAssetOwners,
  getCellOwnerKey,
} from '../../kernel/assets/AssetOwners';
import { countReleasedAssets, releaseCellOwnedAssets } from '../../kernel/assets/SceneAssetRelease';
import { getTexture, saveTexture } from '../../kernel/assets/Texture';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { packCellKey } from '../../utils/CellKey';
import * as Logger from '../../utils/Logger';
import {
  type StreamingBudgets,
  type StreamingPrimeJob,
  type StreamingPrimer,
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
  const releases: number[] = [];
  const rt = createStreamingRuntime(
    id,
    resolveStreamingSettings({ cellSize: 64 }),
    world,
    () => clock.ms,
    (cellKey) => {
      releases.push(cellKey);
      return 0;
    }
  );
  const fullBudgets: StreamingBudgets = {
    maxConcurrentLoads: 100,
    maxCreateMsPerFrame: 1000,
    ...budgets,
  };
  return { rt, world, clock, releases, pump: () => pumpStreamingCells(rt, fullBudgets) };
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

describe('cell asset ownership', () => {
  const KEY = packCellKey(0, 0, 0);
  /** Two ticks: a resolved unit's handler has run */
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  test("a unit's load runs in its cell's owner scope up to its first await, runOwned after", async () => {
    const { rt, world, pump } = setup();
    const scopes: unknown[] = [];
    add(rt, KEY, {
      load: async (ctx) => {
        scopes.push(getAssetOwnerScope());
        await Promise.resolve();
        scopes.push(getAssetOwnerScope());
        scopes.push(ctx.runOwned(getAssetOwnerScope));
        return [world.createEntity()];
      },
    });
    decideStreamingCells(rt, 32, 32);
    pump();
    await settle();
    const cellOwner = getCellOwnerKey(rt.sceneId, KEY);
    expect(scopes).toEqual([cellOwner, undefined, cellOwner]);
    expect(getAssetOwnerScope()).toBeUndefined();
  });

  test('releases a cell once per finished unload, not when the scene exit drops it', () => {
    const { rt, world, clock, releases, pump } = setup();
    fillCells(rt, 3, () => entitiesContent(world, clock));
    decideStreamingCells(rt, 32, 32);
    pump();
    decideStreamingCells(rt, 1000, 1000);
    pump();
    expect(releases).toHaveLength(25);
    expect(new Set(releases).size).toBe(25);
    expect(rt.stats.assetReleases).toBe(25);

    // The cells around (1000, 1000) unload too
    decideStreamingCells(rt, 32, 32);
    pump();
    expect(releases).toHaveLength(50);
    dropStreamingCells(rt);
    expect(releases).toHaveLength(50);
  });

  test("a cancelled load's cell is released once its late units have settled", async () => {
    const { rt, world, releases, pump } = setup();
    const pending: { resolve: (ids: number[]) => void; reject: (err: Error) => void }[] = [];
    for (let i = 0; i < 2; i++) {
      add(rt, KEY, {
        load: () => new Promise<number[]>((resolve, reject) => pending.push({ resolve, reject })),
      });
    }
    vi.spyOn(Logger, 'lerror').mockImplementation(() => {});
    decideStreamingCells(rt, 32, 32);
    pump();
    decideStreamingCells(rt, 1000, 1000);
    pump();
    expect(cellAt(rt, 0, 0)).toBeUndefined();
    expect(releases).not.toContain(KEY);
    pending[0].resolve([world.createEntity()]);
    await settle();
    expect(releases).not.toContain(KEY);
    pending[1].reject(new Error('late failure'));
    await settle();
    expect(releases.filter((key) => key === KEY)).toEqual([KEY]);
    expect(world.getEntityCount()).toBe(0);
  });

  test('a late unit of a cell loading again leaves its release to its next unload', async () => {
    const { rt, world, clock, releases, pump } = setup();
    let resolveFirst: (ids: number[]) => void = () => {};
    let calls = 0;
    add(rt, KEY, {
      load: () => {
        calls++;
        if (calls > 1) return [world.createEntity()];
        return new Promise<number[]>((resolve) => (resolveFirst = resolve));
      },
    });
    add(rt, KEY, entitiesContent(world, clock));
    decideStreamingCells(rt, 32, 32);
    pump();
    decideStreamingCells(rt, 1000, 1000);
    pump();
    decideStreamingCells(rt, 32, 32);
    pump();
    expect(cellAt(rt, 0, 0)?.phase).toBe('LOADED');
    resolveFirst([world.createEntity()]);
    await settle();
    expect(releases).not.toContain(KEY);
    decideStreamingCells(rt, 1000, 1000);
    pump();
    expect(releases.filter((key) => key === KEY)).toEqual([KEY]);
  });

  test('frees what a cancelled async unit registered for its cell before bailing out', async () => {
    const { rt, world, pump } = setup();
    let resolveFile: () => void = () => {};
    let texture: THREE.Texture | null = null;
    rt.releaseCellAssets = (cellKey) =>
      countReleasedAssets(releaseCellOwnedAssets(rt.sceneId, cellKey));
    add(rt, KEY, {
      load: async (ctx) => {
        await new Promise<void>((resolve) => (resolveFile = resolve));
        texture = ctx.runOwned(() => saveTexture(new THREE.Texture(), `${rt.sceneId}-detail`));
        if (!ctx.isCurrent()) return [];
        return [world.createEntity()];
      },
    });
    decideStreamingCells(rt, 32, 32);
    pump();
    decideStreamingCells(rt, 1000, 1000);
    pump();
    resolveFile();
    await settle();
    await settle();
    expect(texture).not.toBeNull();
    expect(getAssetOwners(texture!)).toEqual([getCellOwnerKey(rt.sceneId, KEY)]);
    expect(getTexture(`${rt.sceneId}-detail`)).toBeUndefined();
    expect(rt.stats.assetsReleased).toBe(1);
  });
});

describe('priming', () => {
  const KEY = packCellKey(0, 0, 0);

  /** A primer whose jobs finish when the test says so; it records what it was asked */
  const createFakePrimer = () => {
    const log: string[] = [];
    const held = new Set<number>();
    const jobs: { ids: readonly number[]; isDone: boolean }[] = [];
    const primer: StreamingPrimer = {
      beginFrame: () => {},
      hold: (_world, ids) => ids.forEach((id) => held.add(id)),
      release: (_world, ids) => ids.forEach((id) => held.delete(id)),
      start: (_world, ids) => {
        const job = { ids, isDone: false };
        jobs.push(job);
        log.push(`start ${ids.length}`);
        return job;
      },
      step: (job: StreamingPrimeJob) => (job as { isDone: boolean }).isDone,
      finish: () => log.push('finish'),
      cancel: () => log.push('cancel'),
    };
    return { primer, log, held, jobs };
  };

  const setupPrimed = () => {
    const base = setup();
    const fake = createFakePrimer();
    base.rt.primer = fake.primer;
    return { ...base, ...fake };
  };

  test('holds each unit as it loads, primes the cell, and shows it once the priming is done', () => {
    const { rt, world, clock, pump, held, jobs, log } = setupPrimed();
    add(rt, KEY, entitiesContent(world, clock, 2));
    add(rt, KEY, entitiesContent(world, clock, 3));
    // From two cells off: nearby, not resident
    decideStreamingCells(rt, 32 + 128, 32);
    pump();
    expect(cellAt(rt, 0, 0)?.phase).toBe('PRIMING');
    expect(held.size).toBe(5);
    expect(log).toContain('start 5');
    pump();
    expect(cellAt(rt, 0, 0)?.phase).toBe('PRIMING');
    jobs.forEach((job) => (job.isDone = true));
    pump();
    expect(cellAt(rt, 0, 0)?.phase).toBe('LOADED');
    expect(rt.stats.primesFinished).toBeGreaterThan(0);
    expect(rt.stats.primingStalls).toBe(0);
  });

  test('a cell the focus reaches while it primes is shown at once, as a stall', () => {
    const { rt, world, clock, pump, log } = setupPrimed();
    add(rt, KEY, entitiesContent(world, clock));
    decideStreamingCells(rt, 32 + 128, 32);
    pump();
    expect(cellAt(rt, 0, 0)?.phase).toBe('PRIMING');
    decideStreamingCells(rt, 32, 32);
    pump();
    expect(cellAt(rt, 0, 0)?.phase).toBe('LOADED');
    expect(log).toContain('finish');
    expect(rt.stats.primingStalls).toBeGreaterThan(0);
  });

  test('a priming cell no longer wanted cancels its priming and unloads', () => {
    const { rt, world, clock, pump, log } = setupPrimed();
    add(rt, KEY, entitiesContent(world, clock));
    decideStreamingCells(rt, 32 + 128, 32);
    pump();
    decideStreamingCells(rt, 1000, 1000);
    pump();
    expect(log).toContain('cancel');
    expect(cellAt(rt, 0, 0)).toBeUndefined();
    expect(world.getEntityCount()).toBe(0);
  });

  test("lets go of what a content's own unload leaves alive", () => {
    const { rt, world, pump, held, jobs } = setupPrimed();
    const kept = world.createEntity();
    add(rt, KEY, { load: () => [kept], unload: () => {} });
    decideStreamingCells(rt, 32 + 128, 32);
    pump();
    expect(held.has(kept)).toBe(true);
    jobs.forEach((job) => (job.isDone = true));
    pump();
    decideStreamingCells(rt, 1000, 1000);
    pump();
    expect(world.isAlive(kept)).toBe(true);
    expect(held.has(kept)).toBe(false);
  });

  test("a scene load's cells load without priming, shown with the scene", async () => {
    const { rt, world, clock, held, log } = setupPrimed();
    add(rt, KEY, entitiesContent(world, clock));
    decideStreamingCells(rt, 32, 32);
    await loadStreamingCellsNowAsync(rt);
    expect(cellAt(rt, 0, 0)?.phase).toBe('LOADED');
    expect(held.size).toBe(0);
    expect(log).toEqual([]);
  });
});

describe('data units and the barrier (p353 Phase 3)', () => {
  const KEY = packCellKey(0, 0, 0);
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  /** A cell whose data units are an async "assets" unit the test resolves, then a unit that
   * waits for it; a code unit follows */
  const setupData = () => {
    const env = setup();
    const { rt, world } = env;
    const log: string[] = [];
    let resolveAssets: () => void = () => {};
    rt.dataContent = (cellKey) =>
      cellKey !== KEY
        ? []
        : [
            {
              waits: false,
              content: {
                sceneId: rt.sceneId,
                cellKey,
                load: async () => {
                  log.push('assets');
                  await new Promise<void>((resolve) => (resolveAssets = resolve));
                  return [];
                },
              },
            },
            {
              waits: true,
              content: {
                sceneId: rt.sceneId,
                cellKey,
                load: () => {
                  log.push('entities');
                  return [world.createEntity()];
                },
              },
            },
          ];
    add(rt, KEY, {
      load: () => {
        log.push('code');
        return [];
      },
    });
    return { ...env, log, resolve: () => resolveAssets() };
  };

  test('a waiting unit, and everything after it, starts once the units before it are in', async () => {
    const { rt, log, pump, resolve } = setupData();
    decideStreamingCells(rt, 32, 32);
    pump();
    pump();
    expect(log).toEqual(['assets']);
    expect(cellAt(rt, 0, 0)?.phase).toBe('LOADING');
    resolve();
    await flush();
    pump();
    expect(log).toEqual(['assets', 'entities', 'code']);
    expect(cellAt(rt, 0, 0)?.phase).toBe('LOADED');
  });

  test('a scene load’s cells wait the same way, and resolve once all is in', async () => {
    const { rt, log, resolve } = setupData();
    decideStreamingCells(rt, 32, 32);
    const loading = loadStreamingCellsNowAsync(rt);
    await flush();
    expect(log).toEqual(['assets']);
    resolve();
    await loading;
    expect(log).toEqual(['assets', 'entities', 'code']);
    expect(cellAt(rt, 0, 0)?.phase).toBe('LOADED');
  });

  test('a load cancelled while a unit waits never runs it', async () => {
    const { rt, log, pump, resolve } = setupData();
    decideStreamingCells(rt, 32, 32);
    pump();
    decideStreamingCells(rt, 5000, 5000);
    pump();
    resolve();
    await flush();
    pump();
    expect(log).toEqual(['assets']);
    expect(rt.stats.lateResults).toBe(1);
    expect(rt.cells.has(KEY)).toBe(false);
  });
});
