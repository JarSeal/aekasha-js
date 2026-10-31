// The Spatial index tab's overlays (docs/plans/_DONE_p125_spatial-index-system-visualizer.md;
// p806 D11: out of _dbg__SpatialGrid.ts). Two per domain, each one line created on the domain's
// first use and then only hidden: the occupied cells, and the oversized tier's members (which
// bypass the grid, so they have no cell to draw). Each domain has its own colors, so several can
// be shown at once. A toggle only flips visibility and the `enabled` flag the refill system reads,
// so nothing is recreated per toggle.
import * as THREE from 'three/webgpu';
import { markDebugHelper } from '../../../debug/Profiler';
import { ECSWorld, getECSWorld } from '../../../kernel/ecs/ECS';
import { ECSSystemStage } from '../../../kernel/loop/SystemStages';
import type { SpatialGrid } from '../SpatialGrid';
import { BOX_EDGE_SEGMENT_COUNT, writeBox3Edges } from '../../lines/LineBuilders';
import type { LineObject } from '../../lines/LineObject';
import { createLines, isLinesInstalledFor } from '../../lines/Lines';
import { DEFAULT_SPATIAL_DOMAIN, getSpatialDomain } from '../SpatialDomains';
import { getDomainSettings } from './_dbg__SpatialGridSettings';

type BoxOverlay = {
  line: LineObject;
  enabled: boolean;
  bounds: Float32Array;
  /** Writes 6 floats per box into `out`, returns the box count (see SpatialGrid). */
  getBoundsInto: (grid: SpatialGrid, out: Float32Array) => number;
};

type DomainOverlays = { domainId: string; cells: BoxOverlay; oversized: BoxOverlay };

// Ceilings for the FIXED line buffers. Occupied cells are bounded only by a domain's
// maxMembers (100k for DEFAULT by default), far too much to pre-allocate for a debug overlay;
// past these a line drops the extra boxes and warns once.
const VISUALIZER_MAX_CELLS = 4096;
const VISUALIZER_MAX_OVERSIZED = 256;

const domainOverlays: DomainOverlays[] = [];
const scratchBox = new THREE.Box3();

const setOverlayEnabled = (overlay: BoxOverlay, enabled: boolean) => {
  overlay.enabled = enabled;
  overlay.line.setVisible(enabled);
};

/** `grid` undefined: the domain isn't registered (any more), so the line is emptied. */
const refillOverlay = (overlay: BoxOverlay, grid: SpatialGrid | undefined) => {
  if (!overlay.enabled) return;
  const line = overlay.line;
  if (!grid) {
    line.beginWrite();
    line.endWrite();
    return;
  }

  let count = overlay.getBoundsInto(grid, overlay.bounds);
  if (count * 6 > overlay.bounds.length) {
    // Rare (only when the count first outgrows the buffer). Everything past the line's
    // capacity is dropped by the FIXED line, with its own warning.
    overlay.bounds = new Float32Array(count * 6 * 2);
    count = overlay.getBoundsInto(grid, overlay.bounds);
  }

  const b = overlay.bounds;
  const writer = line.beginWrite();
  for (let c = 0; c < count; c++) {
    const i = c * 6;
    scratchBox.min.set(b[i], b[i + 1], b[i + 2]);
    scratchBox.max.set(b[i + 3], b[i + 4], b[i + 5]);
    writeBox3Edges(writer, scratchBox);
  }
  line.endWrite();
};

/** Refills the shown overlays from their domain's last rebuild. LATE_MAIN, so after the
 * APP_POST_PHYSICS rebuild. Only the default world is drawn — there is one line each. */
const spatialGridVisualizerSystem = (world: ECSWorld) => {
  if (domainOverlays.length === 0 || world !== getECSWorld()) return;
  for (let i = 0; i < domainOverlays.length; i++) {
    const overlays = domainOverlays[i];
    if (!overlays.cells.enabled && !overlays.oversized.enabled) continue;
    // Re-read every frame: re-registering a domain replaces its grid, unregistering drops it
    const grid = getSpatialDomain(world, overlays.domainId);
    refillOverlay(overlays.cells, grid);
    refillOverlay(overlays.oversized, grid);
  }
};

const createOverlayLine = (id: string, maxBoxes: number) => {
  const line = createLines({
    id,
    capacity: maxBoxes * BOX_EDGE_SEGMENT_COUNT,
    growth: 'FIXED',
    // 12 segments per box; instanced quads would cost far more than 1px lines.
    backend: 'THIN',
    // Created once and outlives scenes, so a scene switch must not dispose it.
    persistent: true,
  });
  markDebugHelper(line.object3D);
  return line;
};

const getOverlays = (domainId: string) => domainOverlays.find((o) => o.domainId === domainId);

const ensureOverlays = (domainId: string): DomainOverlays => {
  const existing = getOverlays(domainId);
  if (existing) return existing;
  // DEFAULT keeps the line ids it had before domains
  const suffix = domainId === DEFAULT_SPATIAL_DOMAIN ? '' : `_${domainId}`;
  const overlays: DomainOverlays = {
    domainId,
    cells: {
      line: createOverlayLine(`SPATIAL_GRID_DEBUG_VISUALIZER${suffix}`, VISUALIZER_MAX_CELLS),
      enabled: false,
      bounds: new Float32Array(VISUALIZER_MAX_CELLS * 6),
      getBoundsInto: (grid, out) => grid.getOccupiedCellBoundsInto(out),
    },
    oversized: {
      line: createOverlayLine(
        `SPATIAL_GRID_DEBUG_VISUALIZER_OVERSIZED${suffix}`,
        VISUALIZER_MAX_OVERSIZED
      ),
      enabled: false,
      bounds: new Float32Array(VISUALIZER_MAX_OVERSIZED * 6),
      getBoundsInto: (grid, out) => grid.getOversizedBoundsInto(out),
    },
  };
  domainOverlays.push(overlays);
  return overlays;
};

/** Applies a domain's saved overlay settings. Its lines are created on the first one shown. */
export const syncSpatialGridOverlays = (domainId: string) => {
  const settings = getDomainSettings(domainId);
  if (!settings.showCells && !settings.showOversized && !getOverlays(domainId)) return;
  // Drawn as lines: none without the feature
  if (!isLinesInstalledFor('spatial grid overlay')) return;
  const overlays = ensureOverlays(domainId);
  // Color writes are uniform writes, no geometry rebuild
  overlays.cells.line.setColor(settings.cellsColor);
  setOverlayEnabled(overlays.cells, settings.showCells);
  overlays.oversized.line.setColor(settings.oversizedColor);
  setOverlayEnabled(overlays.oversized, settings.showOversized);
};

/** Applies every domain's settings to the overlays it has (the clear-LS button's reset). */
export const syncCreatedSpatialGridOverlays = () => {
  for (let i = 0; i < domainOverlays.length; i++) {
    syncSpatialGridOverlays(domainOverlays[i].domainId);
  }
};

/** Adds the overlays' refill system to every world: the tab's creation. */
export const registerSpatialGridVisualizer = () => {
  ECSWorld.registerPlugin((w) => {
    w.addSystem(
      ECSSystemStage.LATE_MAIN,
      'spatialGridVisualizerSystem',
      spatialGridVisualizerSystem
    );
  });
};
