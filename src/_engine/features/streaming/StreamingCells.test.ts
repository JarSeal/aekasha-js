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
  type StreamingFader,
  type StreamingPrimeJob,
  type StreamingPrimer,
  type StreamingRuntime,
  createStreamingRuntime,
  getStreamingCellLayer,
  decideStreamingCells,
  dropStreamingCells,
  loadStreamingCellsNowAsync,
  pumpStreamingCells,
} from './StreamingCells';
import {
  type StreamingCellContent,
  type StreamingContentRange,
  addStreamingCellContent,
  clearSceneStreamingContent,
} from './StreamingContent';
import { handOverMovedBodies } from './StreamingHandOver';
import { StreamingLevel } from './StreamingRings';
import { resolveStreamingSettings } from './StreamingSettings';

// A 64 m grid with rings 1, 2 and a 16 m margin, no FAR ring unless a test asks for one (Phase 5's
// far layers); every test gets its own scene id and world, and a clock it moves by hand
let seq = 0;
const worldIds: string[] = [];
const sceneIds: string[] = [];

const setup = (
  budgets: Partial<StreamingBudgets> = {},
  rings: { resident: number; nearby: number; far: number } = { resident: 1, nearby: 2, far: 2 }
) => {
  const id = `streaming-test-${seq++}`;
  worldIds.push(id);
  sceneIds.push(id);
  const world = new ECSWorld({ id, maxEntities: 10_000, applyGlobalPlugins: false });
  const clock = { ms: 0 };
  const releases: number[] = [];
  const layerReleases: string[] = [];
  const rt = createStreamingRuntime(
    id,
    resolveStreamingSettings({ cellSize: 64, rings }),
    world,
    () => clock.ms,
    (cellKey, layer) => {
      releases.push(cellKey);
      layerReleases.push(layer ?? 'NEAR');
      return 0;
    }
  );
  const fullBudgets: StreamingBudgets = {
    maxConcurrentLoads: 100,
    maxCreateMsPerFrame: 1000,
    ...budgets,
  };
  return {
    rt,
    world,
    clock,
    releases,
    layerReleases,
    pump: () => pumpStreamingCells(rt, fullBudgets),
  };
};

type Unit = Pick<StreamingCellContent, 'load' | 'unload' | 'loadedAt'>;

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

/** A tracked cell's layer of `range` (`NEAR` by default: the content tests register) */
const layerAt = (
  rt: StreamingRuntime,
  cx: number,
  cz: number,
  range: StreamingContentRange = 'NEAR'
) => getStreamingCellLayer(cellAt(rt, cx, cz)!, range);

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
    expect(layerAt(rt, 0, 0).generation).toBe(2);
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

    // The cells around (1000, 1000) unload too, but ran no units: nothing of theirs to release
    // (p353 Phase 5: an empty layer is neither counted nor released)
    decideStreamingCells(rt, 32, 32);
    pump();
    expect(releases).toHaveLength(25);
    expect(rt.stats.unloadsFinished).toBe(25);
    dropStreamingCells(rt);
    expect(releases).toHaveLength(25);
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
    rt.dataContent = (cellKey, range) =>
      cellKey !== KEY || range !== 'NEAR'
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

describe('bodies that move (p353 Phase 4 D1)', () => {
  // The focus starts in cell (0, 0), which loads cells -2..2; at x = 96 (cell 1, 0) column -2 is
  // over ring 2's 144 m from its edge and unloads, column -1 stays
  const START_X = 32;
  const FAR_X = 96;
  const A = { cx: -2, x: -96 };
  const B = { cx: -1, x: -32 };

  /** Bodies at the positions the test sets (any other entity doesn't move) */
  const setupBodies = () => {
    const env = setup();
    const positions = new Map<number, { x: number; z: number }>();
    env.rt.bodies = {
      handOver: handOverMovedBodies,
      locateMover: (world, entityId, out) => {
        const at = positions.get(entityId);
        if (!at || !world.isAlive(entityId)) return false;
        out.x = at.x;
        out.z = at.z;
        return true;
      },
    };
    return { ...env, positions };
  };

  /** Content in cell (cx, 0) making a body at (x, 32) and a static entity; `log` gets the ids each
   * `unload` is handed */
  const bodyContent = (
    world: ECSWorld,
    positions: Map<number, { x: number; z: number }>,
    x: number,
    log?: number[][]
  ): Unit => ({
    load: () => {
      const bodyId = world.createEntity();
      positions.set(bodyId, { x, z: 32 });
      return [bodyId, world.createEntity()];
    },
    unload: log
      ? (ids) => {
          log.push([...ids]);
          for (const id of ids) world.deleteEntity(id);
        }
      : undefined,
  });

  const loadAround = (rt: StreamingRuntime, pump: () => void, x: number) => {
    decideStreamingCells(rt, x, 32);
    pump();
  };

  test('a body that rolled into a loaded cell goes to it, and is deleted with it', () => {
    const { rt, world, positions, pump } = setupBodies();
    const unloaded: number[][] = [];
    add(rt, packCellKey(A.cx, 0, 0), bodyContent(world, positions, A.x, unloaded));
    loadAround(rt, pump, START_X);
    const [bodyId, staticId] = layerAt(rt, A.cx, 0).units[0].entityIds!;
    positions.set(bodyId, { x: B.x, z: 32 });

    loadAround(rt, pump, FAR_X);
    expect(rt.cells.has(packCellKey(A.cx, 0, 0))).toBe(false);
    // The custom unload got only what stayed
    expect(unloaded).toEqual([[staticId]]);
    expect(world.isAlive(bodyId)).toBe(true);
    expect(layerAt(rt, B.cx, 0).adopted).toEqual([bodyId]);
    expect(rt.stats.bodiesAdopted).toBe(1);

    // Far enough that B unloads too: the adopted body goes with it
    loadAround(rt, pump, FAR_X + 64);
    expect(world.isAlive(bodyId)).toBe(false);
  });

  test('a body still in its cell, or where nothing is loaded, goes with its cell', () => {
    const { rt, world, positions, pump } = setupBodies();
    add(rt, packCellKey(A.cx, 0, 0), bodyContent(world, positions, A.x));
    add(rt, packCellKey(A.cx, 0, 1), bodyContent(world, positions, A.x));
    loadAround(rt, pump, START_X);
    const [stays] = layerAt(rt, A.cx, 0).units[0].entityIds!;
    const [outside] = layerAt(rt, A.cx, 1).units[0].entityIds!;
    // Off the grid's loaded cells (x cell -4)
    positions.set(outside, { x: -230, z: 32 });

    loadAround(rt, pump, FAR_X);
    expect(world.isAlive(stays)).toBe(false);
    expect(world.isAlive(outside)).toBe(false);
    expect(rt.stats.bodiesAdopted).toBe(0);
  });

  test('a body moving on is handed over again; one deleted meanwhile is dropped', () => {
    const { rt, world, positions, pump } = setupBodies();
    add(rt, packCellKey(A.cx, 0, 0), bodyContent(world, positions, A.x));
    add(rt, packCellKey(A.cx, 0, 1), bodyContent(world, positions, A.x));
    loadAround(rt, pump, START_X);
    const [rolling] = layerAt(rt, A.cx, 0).units[0].entityIds!;
    const [deleted] = layerAt(rt, A.cx, 1).units[0].entityIds!;
    positions.set(rolling, { x: B.x, z: 32 });
    positions.set(deleted, { x: B.x, z: 32 });
    loadAround(rt, pump, FAR_X);
    expect(layerAt(rt, B.cx, 0).adopted).toEqual([rolling, deleted]);

    world.deleteEntity(deleted);
    // On into column 0 before column -1 unloads
    positions.set(rolling, { x: 32, z: 32 });
    loadAround(rt, pump, FAR_X + 64);
    expect(layerAt(rt, 0, 0).adopted).toEqual([rolling]);
    expect(world.isAlive(rolling)).toBe(true);
    expect(rt.stats.bodiesAdopted).toBe(3);
  });

  test('a body in a cell that unloads in the same decision goes with that cell', () => {
    const { rt, world, positions, pump } = setupBodies();
    add(rt, packCellKey(B.cx, 0, 0), bodyContent(world, positions, B.x));
    loadAround(rt, pump, START_X);
    const [bodyId] = layerAt(rt, B.cx, 0).units[0].entityIds!;
    positions.set(bodyId, { x: A.x, z: 32 });
    // Columns -2 and -1 both unload in one decision, whichever starts first
    loadAround(rt, pump, FAR_X + 64);
    expect(world.isAlive(bodyId)).toBe(false);
  });

  test("entities that aren't bodies stay with their cell; the scene exit deletes the adopted", () => {
    const { rt, world, positions, pump } = setupBodies();
    add(rt, packCellKey(A.cx, 0, 0), bodyContent(world, positions, A.x));
    loadAround(rt, pump, START_X);
    const [bodyId, staticId] = layerAt(rt, A.cx, 0).units[0].entityIds!;
    positions.set(bodyId, { x: B.x, z: 32 });
    loadAround(rt, pump, FAR_X);
    expect(world.isAlive(staticId)).toBe(false);
    expect(world.isAlive(bodyId)).toBe(true);
    dropStreamingCells(rt);
    expect(world.isAlive(bodyId)).toBe(false);
  });
});

describe('content layers (p353 Phase 5 D1-D3, D10)', () => {
  // Rings 1 / 2 / 4: from (32, 32) cell (3, 0) is FAR; from (96, 32) NEARBY (ring 2), and back at
  // (32, 32) FAR again (160 m from its edge, over ring 2's 144 m)
  const RINGS = { resident: 1, nearby: 2, far: 4 };
  const KEY = packCellKey(3, 0, 0);
  const NEAR_X = 96;
  const HOME_X = 32;
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  /** A unit whose load waits until the test resolves it, logging its starts */
  const heldUnit = (world: ECSWorld, loadedAt: StreamingContentRange, log: string[]) => {
    const pending: (() => void)[] = [];
    const unit: Unit = {
      loadedAt,
      load: () => {
        log.push(`load ${loadedAt}`);
        return new Promise<number[]>((resolve) =>
          pending.push(() => resolve([world.createEntity()]))
        );
      },
      unload: (ids) => {
        log.push(`unload ${loadedAt}`);
        for (const id of ids) world.deleteEntity(id);
      },
    };
    return { unit, resolveAll: () => pending.splice(0).forEach((resolve) => resolve()) };
  };

  const go = (rt: StreamingRuntime, pump: () => void, x: number) => {
    decideStreamingCells(rt, x, 32);
    pump();
  };

  test('a FAR cell loads its far and kept content; NEARBY its near and kept content', () => {
    const { rt, world, clock, pump } = setup({}, RINGS);
    add(rt, KEY, { ...entitiesContent(world, clock, 2), loadedAt: 'FAR' });
    add(rt, KEY, { ...entitiesContent(world, clock, 3), loadedAt: 'NEAR_AND_FAR' });
    add(rt, KEY, entitiesContent(world, clock, 5));
    go(rt, pump, HOME_X);
    expect(rt.cells.size).toBe(81);
    expect(cellAt(rt, 3, 0)?.level).toBe(StreamingLevel.FAR);
    expect(cellAt(rt, 3, 0)?.phase).toBe('LOADED');
    expect(world.getEntityCount()).toBe(5);
    expect(layerAt(rt, 3, 0, 'NEAR').phase).toBe('UNLOADED');

    go(rt, pump, NEAR_X);
    expect(cellAt(rt, 3, 0)?.level).toBe(StreamingLevel.NEARBY);
    expect(layerAt(rt, 3, 0, 'FAR').phase).toBe('UNLOADED');
    // The kept content never moved
    expect(layerAt(rt, 3, 0, 'NEAR_AND_FAR').generation).toBe(1);
    expect(world.getEntityCount()).toBe(8);

    go(rt, pump, 5000);
    expect(rt.cells.has(KEY)).toBe(false);
    expect(world.getEntityCount()).toBe(0);
  });

  test('a layer leaving stays drawn until the layer replacing it is shown (D2)', async () => {
    const { rt, world, pump } = setup({}, RINGS);
    const log: string[] = [];
    const far = heldUnit(world, 'FAR', log);
    const near = heldUnit(world, 'NEAR', log);
    add(rt, KEY, far.unit);
    add(rt, KEY, near.unit);
    go(rt, pump, HOME_X);
    far.resolveAll();
    await flush();
    pump();
    expect(cellAt(rt, 3, 0)?.phase).toBe('LOADED');

    // NEARBY: the near layer loads while the far one stays
    go(rt, pump, NEAR_X);
    expect(cellAt(rt, 3, 0)?.phase).toBe('LOADING');
    expect(layerAt(rt, 3, 0, 'FAR').phase).toBe('LOADED');
    pump();
    expect(log).toEqual(['load FAR', 'load NEAR']);
    near.resolveAll();
    await flush();
    pump();
    expect(log).toEqual(['load FAR', 'load NEAR', 'unload FAR']);
    expect(cellAt(rt, 3, 0)?.phase).toBe('LOADED');
    expect(layerAt(rt, 3, 0, 'FAR').phase).toBe('UNLOADED');
  });

  test('a switch cancelled before the replacement is shown keeps the layer it was leaving', async () => {
    const { rt, world, pump } = setup({}, RINGS);
    const log: string[] = [];
    const far = heldUnit(world, 'FAR', log);
    const near = heldUnit(world, 'NEAR', log);
    add(rt, KEY, far.unit);
    add(rt, KEY, near.unit);
    go(rt, pump, NEAR_X);
    near.resolveAll();
    await flush();
    pump();
    // FAR: the far layer starts loading; back NEARBY before it's in, it's cancelled
    go(rt, pump, HOME_X);
    expect(layerAt(rt, 3, 0, 'FAR').phase).toBe('LOADING');
    go(rt, pump, NEAR_X);
    expect(layerAt(rt, 3, 0, 'FAR').phase).toBe('UNLOADED');
    expect(layerAt(rt, 3, 0, 'NEAR').phase).toBe('LOADED');
    expect(layerAt(rt, 3, 0, 'NEAR').generation).toBe(1);
    expect(rt.stats.loadsCancelled).toBe(1);
    far.resolveAll();
    await flush();
    expect(rt.stats.lateResults).toBe(1);
    expect(log).toEqual(['load NEAR', 'load FAR', 'unload FAR']);
    expect(world.getEntityCount()).toBe(1);
  });

  test("a layer's units run in its own owner key, and its unload releases that key", () => {
    const { rt, world, layerReleases, pump } = setup({}, RINGS);
    const scopes: unknown[] = [];
    const scoped = (loadedAt: StreamingContentRange): Unit => ({
      loadedAt,
      load: () => {
        scopes.push(getAssetOwnerScope());
        return [world.createEntity()];
      },
    });
    add(rt, KEY, scoped('FAR'));
    add(rt, KEY, scoped('NEAR_AND_FAR'));
    add(rt, KEY, scoped('NEAR'));
    go(rt, pump, HOME_X);
    go(rt, pump, NEAR_X);
    expect(scopes).toEqual([
      getCellOwnerKey(rt.sceneId, KEY, 'kept'),
      getCellOwnerKey(rt.sceneId, KEY, 'far'),
      getCellOwnerKey(rt.sceneId, KEY),
    ]);
    expect(layerReleases).toEqual(['far']);
    go(rt, pump, 5000);
    expect(layerReleases.sort()).toEqual(['NEAR', 'far', 'kept']);
  });

  test('a cell with only near content at FAR holds nothing and costs no load', () => {
    const { rt, world, clock, pump } = setup({}, RINGS);
    add(rt, KEY, entitiesContent(world, clock, 2));
    go(rt, pump, HOME_X);
    expect(cellAt(rt, 3, 0)?.phase).toBe('LOADED');
    expect(world.getEntityCount()).toBe(0);
    expect(rt.stats.loadsStarted).toBe(0);
    go(rt, pump, NEAR_X);
    expect(world.getEntityCount()).toBe(2);
    go(rt, pump, HOME_X);
    expect(world.getEntityCount()).toBe(0);
    expect(rt.stats).toMatchObject({ loadsStarted: 1, unloadsFinished: 1 });
  });

  test("a scene load's cells load their wanted layers at once", async () => {
    const { rt, world, clock } = setup({}, RINGS);
    add(rt, KEY, { ...entitiesContent(world, clock, 2), loadedAt: 'FAR' });
    add(rt, KEY, entitiesContent(world, clock, 5));
    decideStreamingCells(rt, HOME_X, 32);
    await loadStreamingCellsNowAsync(rt);
    expect(cellAt(rt, 3, 0)?.phase).toBe('LOADED');
    expect(world.getEntityCount()).toBe(2);
  });
});

describe('fades (p353 Phase 5 D4)', () => {
  // As the layers' tests: cell (3, 0) FAR from (32, 32), NEARBY from (96, 32); fades of 250 ms
  const RINGS = { resident: 1, nearby: 2, far: 4 };
  const KEY = packCellKey(3, 0, 0);

  /** A fader recording what it's asked, by job: each job's direction and the progress it last drew */
  const setupFades = () => {
    const env = setup({}, RINGS);
    const log: string[] = [];
    const jobs: { ids: readonly number[]; direction: string; progress: number }[] = [];
    const fader: StreamingFader = {
      prepare: (_world, ids, hidden) => log.push(`prepare ${ids.length}${hidden ? ' hidden' : ''}`),
      start: (_world, ids, direction, progress) => {
        const job = { ids, direction, progress };
        jobs.push(job);
        log.push(`start ${direction} ${ids.length} at ${progress}`);
        return job;
      },
      draw: (job, progress) => {
        (job as (typeof jobs)[number]).progress = progress;
      },
      release: (_world, ids) => log.push(`release ${ids.length}`),
    };
    env.rt.fader = fader;
    const go = (x: number) => {
      decideStreamingCells(env.rt, x, 32);
      env.pump();
    };
    /** Moves the clock by `ms` and pumps a frame */
    const tick = (ms: number) => {
      env.clock.ms += ms;
      env.pump();
    };
    return { ...env, log, jobs, go, tick };
  };

  test('a layer streamed in fades in once shown, drawn hidden until then', () => {
    const { rt, world, clock, log, jobs, go, tick } = setupFades();
    add(rt, KEY, entitiesContent(world, clock, 3));
    go(96);
    expect(log).toEqual(['prepare 3 hidden', 'start IN 3 at 0']);
    tick(100);
    expect(jobs[0].progress).toBeCloseTo(0.4);
    tick(200);
    expect(jobs[0].progress).toBe(1);
    expect(layerAt(rt, 3, 0).fade).toBeNull();
    expect(rt.stats.fadesStarted).toBe(1);
  });

  test('a shown layer fades out before it unloads', () => {
    const { rt, world, clock, jobs, go, tick } = setupFades();
    add(rt, KEY, entitiesContent(world, clock, 2));
    go(96);
    tick(300);
    go(5000);
    expect(jobs[1]).toMatchObject({ direction: 'OUT', progress: 0 });
    expect(cellAt(rt, 3, 0)?.phase).toBe('UNLOADING');
    expect(world.getEntityCount()).toBe(2);
    tick(200);
    expect(world.getEntityCount()).toBe(2);
    tick(100);
    expect(rt.cells.has(KEY)).toBe(false);
    expect(world.getEntityCount()).toBe(0);
  });

  test('a near ↔ far switch fades the near layer in and the far one out at once', () => {
    const { rt, world, clock, log, go, tick } = setupFades();
    add(rt, KEY, { ...entitiesContent(world, clock, 1), loadedAt: 'FAR' });
    add(rt, KEY, entitiesContent(world, clock, 4));
    go(32);
    tick(300);
    log.length = 0;
    go(96);
    expect(log).toEqual(['prepare 4 hidden', 'start IN 4 at 0', 'start OUT 1 at 0']);
    expect(cellAt(rt, 3, 0)?.phase).toBe('LOADED');
    expect(layerAt(rt, 3, 0, 'FAR').phase).toBe('LOADED');
    tick(300);
    expect(layerAt(rt, 3, 0, 'FAR').phase).toBe('UNLOADED');
    expect(world.getEntityCount()).toBe(4);
  });

  test('a layer fading out that is wanted again fades back in from where it is', () => {
    const { rt, world, clock, jobs, go, tick } = setupFades();
    add(rt, KEY, entitiesContent(world, clock, 2));
    go(96);
    tick(300);
    go(5000);
    tick(100);
    go(96);
    expect(jobs[2]).toMatchObject({ direction: 'IN' });
    expect(jobs[2].progress).toBeCloseTo(0.6);
    expect(rt.stats.fadesReversed).toBe(1);
    tick(100);
    expect(layerAt(rt, 3, 0).fade).toBeNull();
    tick(500);
    expect(layerAt(rt, 3, 0).phase).toBe('LOADED');
    expect(world.getEntityCount()).toBe(2);
    expect(layerAt(rt, 3, 0).generation).toBe(1);
  });

  test("a scene load's cells are prepared but shown at once, and the exit drops them unfaded", async () => {
    const { rt, world, clock, log } = setupFades();
    add(rt, KEY, entitiesContent(world, clock, 2));
    decideStreamingCells(rt, 96, 32);
    await loadStreamingCellsNowAsync(rt);
    expect(log).toEqual(['prepare 2']);
    dropStreamingCells(rt);
    expect(log).toEqual(['prepare 2']);
    expect(world.getEntityCount()).toBe(0);
  });

  /** One entity the kept layers of cells (3, 0) and (4, 0) both hold (a JSON oversized mesh, D8),
   * each with one of its own: the first to load creates it, the last to unload deletes it */
  const addSharedEntity = (env: ReturnType<typeof setupFades>) => {
    const { rt, world } = env;
    const holders: number[] = [];
    let shared = -1;
    rt.sharedEntities = { getHolders: (id) => (id === shared ? holders : null) };
    for (const cellKey of [KEY, packCellKey(4, 0, 0)]) {
      add(rt, cellKey, {
        loadedAt: 'NEAR_AND_FAR',
        load: () => {
          if (!holders.length) shared = world.createEntity();
          holders.push(cellKey);
          return [world.createEntity(), shared];
        },
        unload: ([own], ctx) => {
          world.deleteEntity(own);
          holders.splice(holders.indexOf(ctx.cellKey), 1);
          if (!holders.length) world.deleteEntity(shared);
        },
      });
    }
    return { getShared: () => shared };
  };

  test('a shared entity is shown and faded in by its first holder only', () => {
    const env = setupFades();
    addSharedEntity(env);
    env.go(96);
    // (3, 0) first (nearer): its own and the shared one; (4, 0) its own
    expect(env.log).toEqual([
      'prepare 2 hidden',
      'start IN 2 at 0',
      'prepare 1 hidden',
      'start IN 1 at 0',
    ]);
  });

  test('a shared entity fades out with the last of its holders to leave', () => {
    const env = setupFades();
    const { getShared } = addSharedEntity(env);
    const { rt, world, log, go, tick } = env;
    env.go(96);
    tick(300);
    log.length = 0;
    // (4, 0) leaves: the first holder still shows it
    go(-32);
    expect(log).toEqual(['start OUT 1 at 0']);
    tick(300);
    expect(world.isAlive(getShared())).toBe(true);
    log.length = 0;
    go(5000);
    expect(log).toEqual(['start OUT 2 at 0']);
    tick(300);
    expect(world.isAlive(getShared())).toBe(false);
    expect(rt.stats.unfadedTakeDowns).toBe(0);
  });

  test('a shared entity passes to its next holder when its first one leaves', () => {
    const env = setupFades();
    const { getShared } = addSharedEntity(env);
    const { rt, world, log, go, tick } = env;
    go(96);
    tick(300);
    log.length = 0;
    // (3, 0) leaves, (4, 0) stays: it doesn't fade out what (4, 0) holds
    go(544);
    expect(log).toEqual(['start OUT 1 at 0']);
    tick(300);
    expect(rt.cells.has(KEY)).toBe(false);
    expect(world.isAlive(getShared())).toBe(true);
    log.length = 0;
    go(5000);
    expect(log).toEqual(['start OUT 2 at 0']);
    tick(300);
    expect(world.isAlive(getShared())).toBe(false);
    expect(rt.stats.unfadedTakeDowns).toBe(0);
  });

  test('fadeSeconds 0 shows and takes down at once, preparing nothing', () => {
    const { rt, world, clock, log, go } = setupFades();
    rt.settings.fadeSeconds = 0;
    add(rt, KEY, entitiesContent(world, clock, 2));
    go(96);
    go(5000);
    expect(log).toEqual([]);
    expect(rt.cells.has(KEY)).toBe(false);
  });
});
