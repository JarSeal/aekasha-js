// The Spatial index tab's live figures (p806 D11: out of _dbg__SpatialGrid.ts): the shown
// domain's stats and cell occupancy, and every domain's policy and rebuilds, read on the tab's
// refresh.
import type { DebuggerPaneItem } from '../../../debug/DebuggerGUI';
import type { ECSWorld } from '../../../kernel/ecs/ECS';
import {
  getLastRebuildDurationMs,
  getSpatialDomain,
  getSpatialDomainOptions,
  getSpatialDomainRebuildStats,
} from '../SpatialDomains';
import { getOracleCheckedQueryCount, getOracleMismatchCount } from '../SpatialOracle';
import type { SpatialGridTabState } from './_dbg__SpatialGridSettings';

type Item = DebuggerPaneItem<SpatialGridTabState>;

/** The shown domain's figures, synced on every refresh. */
export type SpatialStatsReadout = {
  memberCount: number;
  oversizedCount: number;
  occupiedCellCount: number;
  maxIndexedRadius: number;
  lastRebuildMs: number;
  rebuilds: string;
  lastRebuilt: string;
  oracleChecked: number;
  oracleMismatches: number;
  /** The occupied cells' count and spread (formatOccupancy) */
  cells: string;
  /** The histogram's lines (formatOccupancy) */
  histogram: string;
};

/** A readout of the shown domain's figures, before its first sync. */
export const createSpatialStatsReadout = (): SpatialStatsReadout => ({
  memberCount: 0,
  oversizedCount: 0,
  occupiedCellCount: 0,
  maxIndexedRadius: 0,
  lastRebuildMs: 0,
  rebuilds: '',
  lastRebuilt: '',
  oracleChecked: 0,
  oracleMismatches: 0,
  cells: '',
  histogram: '',
});

/** The histogram's longest bar, in characters: a line fits the drawer's value column. */
const HISTOGRAM_BAR_LENGTH = 10;
/** The histogram's height in lines. */
const HISTOGRAM_ROWS = 8;

/**
 * Debug-only occupancy: the occupied cells' count and spread, and a histogram of how many members
 * each occupied cell holds, bucketed by exact count, a line per count (the count, a bar, the
 * cells). Meant to guide cellSize tuning (§9 of docs/plans/_DONE_p050_spatial-index.md): a
 * handful of very full cells next to many single-member ones is the signal that cellSize is too
 * large (or an area is genuinely dense and belongs in the oversized tier instead).
 */
export const formatOccupancy = (counts: number[]) => {
  if (counts.length === 0) return { cells: 'None occupied', histogram: '' };

  const freq = new Map<number, number>();
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const c of counts) {
    freq.set(c, (freq.get(c) ?? 0) + 1);
    if (c < min) min = c;
    if (c > max) max = c;
    sum += c;
  }
  const avg = sum / counts.length;
  const maxFreq = Math.max(...freq.values());
  const range = min === max ? `${min}` : `${min}-${max}`;

  const lines: string[] = [];
  for (const k of [...freq.keys()].sort((a, b) => a - b)) {
    const f = freq.get(k) ?? 0;
    const barLen = Math.max(1, Math.round((f / maxFreq) * HISTOGRAM_BAR_LENGTH));
    lines.push(`${String(k).padStart(3)} ${'#'.repeat(barLen).padEnd(HISTOGRAM_BAR_LENGTH)} ${f}`);
  }
  return {
    cells: `${counts.length}, ${range} members each, ${avg.toFixed(2)} on average`,
    histogram: lines.join('\n'),
  };
};

const formatFramesSinceRebuild = (frames: number) =>
  frames < 0 ? 'never' : frames === 0 ? 'this frame' : `${frames} frames ago`;

/** Syncs `stats` to domain `id`'s figures in `world`. */
export const syncSpatialStats = (world: ECSWorld, id: string, stats: SpatialStatsReadout) => {
  const grid = getSpatialDomain(world, id);
  const gridStats = grid?.getStats();
  stats.memberCount = gridStats?.memberCount ?? 0;
  stats.oversizedCount = gridStats?.oversizedCount ?? 0;
  stats.occupiedCellCount = gridStats?.occupiedCellCount ?? 0;
  stats.maxIndexedRadius = gridStats?.maxIndexedRadius ?? 0;
  stats.lastRebuildMs = getLastRebuildDurationMs(world, id);
  const rebuildStats = getSpatialDomainRebuildStats(world, id);
  stats.rebuilds = rebuildStats
    ? `${rebuildStats.rebuildCount} in ${rebuildStats.frameCount} frames`
    : '-';
  stats.lastRebuilt = rebuildStats
    ? formatFramesSinceRebuild(rebuildStats.framesSinceRebuild)
    : '-';
  stats.oracleChecked = getOracleCheckedQueryCount(world, id);
  stats.oracleMismatches = getOracleMismatchCount(world, id);
  const occupancy = formatOccupancy(grid?.getCellOccupancyCounts() ?? []);
  stats.cells = occupancy.cells;
  stats.histogram = occupancy.histogram;
};

const formatInt = (v: number) => v.toFixed(0);
const formatMs = (v: number) => v.toFixed(3);

/** "Live stats": the shown domain's members, cells, rebuilds and oracle checks. */
export const getLiveStatsFolder = (stats: SpatialStatsReadout): Item => {
  const figure = (
    key: keyof SpatialStatsReadout,
    label: string,
    format?: (v: number) => string
  ): Item => ({
    key,
    target: stats,
    label,
    readonly: true,
    ...(format ? { format } : {}),
    interval: 'refresh',
  });
  return {
    type: 'folder',
    title: 'Live stats',
    content: [
      figure('memberCount', 'Members', formatInt),
      figure('oversizedCount', 'Oversized', formatInt),
      figure('occupiedCellCount', 'Occupied cells', formatInt),
      figure('maxIndexedRadius', 'Max indexed radius'),
      figure('lastRebuildMs', 'Last rebuild (ms)', formatMs),
      figure('rebuilds', 'Rebuilds'),
      figure('lastRebuilt', 'Last rebuilt'),
      figure('oracleChecked', 'Oracle queries', formatInt),
      figure('oracleMismatches', 'Oracle mismatches', formatInt),
    ],
  };
};

/** "Occupancy": the shown domain's occupied cells and the histogram of their members. */
export const getOccupancyFolder = (stats: SpatialStatsReadout): Item => ({
  type: 'folder',
  title: 'Occupancy',
  content: [
    { key: 'cells', target: stats, label: 'Occupied cells', readonly: true, interval: 'refresh' },
    {
      key: 'histogram',
      target: stats,
      label: 'Members per cell',
      hint: 'A line per member count: its bar, then the cells that hold that many.',
      readonly: true,
      multiline: true,
      rows: HISTOGRAM_ROWS,
      interval: 'refresh',
    },
  ],
});

/**
 * Domain `id`'s policy and members, then its rebuilds out of the frames since it was registered
 * and the last rebuild's cost: which domains rebuild every frame, at a glance (p346 Phase 3).
 */
const describeDomain = (world: ECSWorld, id: string) => {
  const opts = getSpatialDomainOptions(world, id);
  if (!opts) return 'Not registered';
  const stats = getSpatialDomainRebuildStats(world, id);
  // DEFAULT has settings without a grid (p349 §3.6)
  if (!stats) return `${opts.update}, no grid`;
  const members = getSpatialDomain(world, id)?.memberCount ?? 0;
  return (
    `${opts.update}, ${members} members\n` +
    `${stats.rebuildCount} rebuilds in ${stats.frameCount} frames, ` +
    `${stats.lastRebuildMs.toFixed(3)} ms`
  );
};

/** "All domains": a row per listed domain (`ids`: the tab is rebuilt when they change). */
export const getAllDomainsFolder = (world: ECSWorld, ids: readonly string[]): Item => ({
  type: 'folder',
  title: 'All domains',
  content: ids.map(
    (id): Item => ({
      get: () => describeDomain(world, id),
      label: id,
      readonly: true,
      interval: 'refresh',
    })
  ),
});
