// The world bounds' drawing (p102 Phase 3): the current world's box (the Physics API tab's toggle)
// and an entity's own box (its edit window's toggle), each closed side a grid, an open side not
// drawn and the closed ones clipped OPEN_EXTENT past it. A line per box, refilled only when its
// definition changes (a set stores a copy, so a reference compare per frame finds it), from a
// LATE_MAIN system registered on the first toggle. Default world only; drawn with the lines()
// feature, its toggles left out without it. Imports neither the tab nor the window: both import it.
import { markDebugHelper } from '../../../debug/Profiler';
import { ECSWorld, getECSWorld } from '../../../kernel/ecs/ECS';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
import { ECSSystemStage } from '../../../kernel/loop/SystemStages';
import type { LineObject } from '../../lines/LineObject';
import { createLines, isLinesInstalledFor } from '../../lines/Lines';
import type { LineWriter } from '../../lines/LineWriter';
import { toWireBodyWorldBounds } from '../PhysicsMessaging';
import { getActiveWorldBoundsDef } from '../PhysicsWorldBounds';
import type {
  EntityWorldBounds,
  WorldBoundsBox,
  WorldBoundsDef,
} from '../types/PhysicsWorldBoundsTypes';

const AXES = ['x', 'y', 'z'] as const;

/** A coordinate as text: at most three decimals, no trailing zeros. */
export const formatBoundsNumber = (v: number) => String(Number(v.toFixed(3)));

/**
 * A box as text, an axis per part: `-10 ≤ x ≤ 10, y ≥ -50` (an open axis left out), or "Open on
 * every side". A side that isn't a finite number reads as given (a NaN side takes every body out).
 */
export const formatWorldBoundsBox = (box: Readonly<WorldBoundsBox>) => {
  const parts: string[] = [];
  for (const axis of AXES) {
    const min = box.min?.[axis];
    const max = box.max?.[axis];
    const hasMin = min !== undefined && min !== -Infinity;
    const hasMax = max !== undefined && max !== Infinity;
    if (hasMin && hasMax)
      parts.push(`${formatBoundsNumber(min)} ≤ ${axis} ≤ ${formatBoundsNumber(max)}`);
    else if (hasMin) parts.push(`${axis} ≥ ${formatBoundsNumber(min)}`);
    else if (hasMax) parts.push(`${axis} ≤ ${formatBoundsNumber(max)}`);
  }
  return parts.length ? parts.join(', ') : 'Open on every side';
};

/** An entity's own world bounds as text (its edit window): its box, ignored, or the scene's box
 * with its own action; and its action. */
export const describeEntityWorldBounds = (own: Readonly<EntityWorldBounds> | undefined) => {
  if (!own) return "None: the scene's box and action";
  const wire = toWireBodyWorldBounds(own);
  if (wire === 'IGNORE') return 'Ignored: never taken out';
  const action = own.action ? `, ${own.action}` : ", the scene's action";
  return wire ? `${formatWorldBoundsBox(wire)}${action}` : `The scene's box${action}`;
};

/** How far an open axis is drawn past the closed side (or past the origin), in metres. */
const OPEN_EXTENT = 250;
/** Each closed side's grid: this many cells a side. */
const GRID_DIVISIONS = 10;
/** Segments of a box with every side closed: a grid of (GRID_DIVISIONS + 1) lines each way. */
const BOX_SEGMENTS = 6 * 2 * (GRID_DIVISIONS + 1);

/** The current world's box orange, an entity's own magenta. */
export const WORLD_BOUNDS_DRAW_COLORS = { GLOBAL: 0xff7a1a, ENTITY: 0xe040d0 } as const;

/** The drawn range per axis, [lo x, lo y, lo z, hi x, hi y, hi z], and which sides are closed. */
const range = new Float64Array(6);
const closed = [false, false, false, false, false, false];
/** A grid line's two ends, by axis index. */
const a = new Float64Array(3);
const b = new Float64Array(3);

const resolveRange = (box: Readonly<WorldBoundsBox>) => {
  for (let i = 0; i < 3; i++) {
    const min = box.min?.[AXES[i]];
    const max = box.max?.[AXES[i]];
    const hasMin = min !== undefined && Number.isFinite(min);
    const hasMax = max !== undefined && Number.isFinite(max);
    closed[i] = hasMin;
    closed[i + 3] = hasMax;
    range[i] = hasMin ? min : (hasMax ? Math.min(max, 0) : 0) - OPEN_EXTENT;
    range[i + 3] = hasMax ? max : (hasMin ? Math.max(min, 0) : 0) + OPEN_EXTENT;
  }
};

/** One closed side's grid: the plane `axis` = `value`, over the other two axes' ranges. */
const writeSideGrid = (writer: LineWriter, axis: number, value: number) => {
  const u = (axis + 1) % 3;
  const v = (axis + 2) % 3;
  a[axis] = b[axis] = value;
  for (let k = 0; k <= GRID_DIVISIONS; k++) {
    const s = k / GRID_DIVISIONS;
    // A line along v at this u, then one along u at this v
    a[u] = b[u] = range[u] + (range[u + 3] - range[u]) * s;
    a[v] = range[v];
    b[v] = range[v + 3];
    writer.segment(a[0], a[1], a[2], b[0], b[1], b[2]);
    a[v] = b[v] = range[v] + (range[v + 3] - range[v]) * s;
    a[u] = range[u];
    b[u] = range[u + 3];
    writer.segment(a[0], a[1], a[2], b[0], b[1], b[2]);
  }
};

/** Refills `line` with `box`'s closed sides, or hides it for none. */
const fillBoxLine = (line: LineObject, box: Readonly<WorldBoundsBox> | null) => {
  if (!box) {
    line.setVisible(false);
    return;
  }
  resolveRange(box);
  const writer = line.beginWrite();
  let count = 0;
  for (let side = 0; side < 6; side++) {
    if (!closed[side]) continue;
    writeSideGrid(writer, side % 3, range[side]);
    count++;
  }
  line.endWrite();
  // Open on every side: nothing to draw (a line of no vertices is hidden)
  line.setVisible(count > 0);
};

const createBoxLine = (name: string, color: number) => {
  const line = createLines({
    name,
    capacity: BOX_SEGMENTS,
    growth: 'FIXED',
    color,
    opacity: 0.8,
    // 2 px, which a 1 px line's antialiasing over a light ground washes out
    backend: 'FAT',
    width: 2,
    // Seen through the level it bounds (a kill height is under the ground)
    depthTest: false,
    // This module owns it: a scene switch keeps the global box and its entities' delete their own
    persistent: true,
  });
  markDebugHelper(line.object3D);
  line.setVisible(false);
  return line;
};

let globalLine: LineObject | null = null;
let isGlobalShown = false;
/** The definition globalLine shows; undefined: none drawn yet (null is "no bounds"). */
let drawnDef: Readonly<WorldBoundsDef> | null | undefined;

type EntityBoxLine = {
  world: ECSWorld;
  line: LineObject;
  /** The WORLD_BOUNDS the line shows; undefined: none drawn yet. */
  drawn: Readonly<EntityWorldBounds> | null | undefined;
};
/** The entities whose own box is shown, by entity id (the default world's). */
const entityLines = new Map<number, EntityBoxLine>();

const worldBoundsDrawSystem = (world: ECSWorld) => {
  if (world !== getECSWorld()) return;
  if (isGlobalShown) {
    const def = getActiveWorldBoundsDef();
    if (def !== drawnDef) {
      drawnDef = def;
      fillBoxLine(globalLine!, def);
    }
  }
  if (!entityLines.size) return;
  for (const [entityId, entry] of entityLines) {
    if (entry.world !== world || !world.isAlive(entityId)) {
      entry.line.dispose();
      entityLines.delete(entityId);
      continue;
    }
    const own = world.getComponent(entityId, ComponentType.WORLD_BOUNDS) ?? null;
    if (own === entry.drawn) continue;
    entry.drawn = own;
    const wire = own && toWireBodyWorldBounds(own);
    fillBoxLine(entry.line, wire && wire !== 'IGNORE' ? wire : null);
  }
};

let isSystemRegistered = false;
const ensureSystem = () => {
  if (isSystemRegistered) return;
  isSystemRegistered = true;
  ECSWorld.registerPlugin((w) => {
    w.addSystem(ECSSystemStage.LATE_MAIN, 'worldBoundsDrawSystem', worldBoundsDrawSystem);
  });
};

/** Whether the world bounds can be drawn: the lines() feature is installed (logs once when not). */
export const canDrawWorldBounds = () => isLinesInstalledFor('world bounds drawing');

/** Whether the current world's box is drawn. */
export const isWorldBoundsBoxShown = () => isGlobalShown;

/** Draws the current world's box (from the next frame, and again whenever the bounds change), or
 * hides it. Without the lines() feature it stays off. */
export const setWorldBoundsBoxShown = (shown: boolean) => {
  if (shown && !canDrawWorldBounds()) return;
  isGlobalShown = shown;
  if (!shown) {
    globalLine?.setVisible(false);
    drawnDef = undefined;
    return;
  }
  globalLine ??= createBoxLine('worldBoundsBox', WORLD_BOUNDS_DRAW_COLORS.GLOBAL);
  ensureSystem();
};

/** Whether an entity's own box is drawn. */
export const isEntityWorldBoundsBoxShown = (entityId: number) => entityLines.has(entityId);

/** Draws an entity's own box (the default world's entity; none while it has no box of its own), or
 * hides it. The line goes when the entity does. Without the lines() feature it stays off. */
export const setEntityWorldBoundsBoxShown = (entityId: number, shown: boolean) => {
  const entry = entityLines.get(entityId);
  if (!shown) {
    entry?.line.dispose();
    entityLines.delete(entityId);
    return;
  }
  if (entry || !canDrawWorldBounds()) return;
  const line = createBoxLine(`worldBoundsBox_${entityId}`, WORLD_BOUNDS_DRAW_COLORS.ENTITY);
  entityLines.set(entityId, { world: getECSWorld(), line, drawn: undefined });
  ensureSystem();
};
