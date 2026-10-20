import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import { lwarn } from '../../utils/Logger';
import { CELL_AXIS_OFFSET, cellBounds, isCellInRange, packCellKey, worldToCell } from './CellKey';

// The spatial grid (docs/plans/_DONE_p050_spatial-index.md for the design): a standalone
// "what's near this point or volume" structure with no ECS of its own. Positions and radii are
// pushed in through addMember / updatePosition / updateRadius; the spatial index's domains
// (SpatialDomains.ts, SpatialIndexSystem.ts) keep one grid per domain current from the members'
// Transforms.

/** An `items` entry whose member was removed since the last rebuild; queries skip it. */
const REMOVED_ITEM = 0xffffffff;

/** A query's point or corner: any `{ x, y, z }`, a `THREE.Vector3` among them. */
export interface ReadonlyVec3 {
  /** World x. */
  readonly x: number;
  /** World y. */
  readonly y: number;
  /** World z. */
  readonly z: number;
}

/** What a {@link SpatialGrid} is built with: its cell size, capacity and oversized threshold. */
export interface SpatialGridOptions {
  /** World-space edge length of one grid cell. Tune against the occupancy histogram (§9 of the plan). */
  cellSize: number;
  /** Fixed capacity: how many members this grid instance can hold at once. */
  maxMembers: number;
  /** Members whose radius exceeds `cellSize * oversizedRadiusMultiplier` go into the oversized tier instead of a grid cell (default 2, per §4). */
  oversizedRadiusMultiplier?: number;
}

/** A grid's counts, from {@link SpatialGrid.getStats}. */
export interface SpatialGridStats {
  /** Members, oversized ones included. */
  memberCount: number;
  /** Members in the oversized tier: in no cell, a candidate of every query. */
  oversizedCount: number;
  /** Cells holding at least one member, as of the last rebuild. */
  occupiedCellCount: number;
  /** The largest radius of a member in a cell, which queries expand by. Exact after a rebuild; can
   * be high between rebuilds. */
  maxIndexedRadius: number;
}

/**
 * A uniform grid over world space that answers "which members are near this point or box" with
 * candidates, not results: a query returns every member within range and maybe a few more, and
 * the caller does the exact test. Members are entity ids with a position and a radius. A member
 * whose radius is over `cellSize × oversizedRadiusMultiplier` goes into an oversized tier that
 * every query returns. The cells are rebuilt from the members' positions by
 * {@link SpatialGrid.rebuild} (sparse, as flat arrays); queries allocate nothing.
 *
 * Read a domain's grid with `getSpatialDomain` / `getSpatialGrid`, where it's used: the spatial
 * index keeps it current (its update policy) and replaces it when the domain's settings change.
 * @remarks Between rebuilds a removed member is gone at once, but a member added or moved since is
 * found only where the last rebuild put it (an oversized one is always found).
 */
export class SpatialGrid {
  private readonly _cellSize: number;
  private readonly invCellSize: number;
  private readonly maxMembers: number;
  private readonly oversizedRadiusThreshold: number;
  private hasWarnedOutOfRange = false;

  private readonly entityToSlot = new Map<number, number>();
  private readonly slotToEntity: Int32Array;
  private liveCount = 0;

  private readonly posX: Float32Array;
  private readonly posY: Float32Array;
  private readonly posZ: Float32Array;
  private readonly radius: Float32Array;
  private readonly isOversized: Uint8Array;
  private readonly oversizedSlots = new Set<number>();
  /**
   * Largest non-oversized radius, which queries expand by. Exact after `rebuild()`; between
   * rebuilds, add/remove/updateRadius only ever raise it (O(1)), so it can overestimate (more
   * candidates) but never underestimate (missed candidates).
   */
  private maxIndexedRadius = 0;

  /**
   * Packed world-cell key of the cell holding each slot's `items` entry, set by the last rebuild
   * (NaN for a member in no cell: oversized at the rebuild, or added since). `removeMember`
   * finds the entries it patches through it, and moves it with the slot. A plain number, not a
   * fixed-width typed array, because the packed key intentionally exceeds 32 bits (see
   * CELL_AXIS_BITS in CellKey.ts).
   */
  private readonly lastCell: number[];

  // CSR rebuild artifacts, reallocated only when they need to grow.
  private readonly cellOfCompact: Uint32Array; // compact (non-oversized) member index -> dense cell index
  private readonly memberSlotByCompactIndex: Uint32Array; // compact member index -> slot
  private compactCount = 0;
  private readonly cellKeyToIndex = new Map<number, number>();
  private counts: Uint32Array;
  private cellStart: Uint32Array;
  private readonly items: Uint32Array; // dense cell index's members, as slots
  private occupiedCellCount = 0;

  // Dedup stamps, for a member in several cells: the multi-cell insert of p050 §11's Phase 4, an
  // optimization that plan defers until measured. A member is in one cell (its centre's) today,
  // so they filter nothing; they're here so that insert needs no data-model change.
  private readonly queryStamp: Uint32Array;
  private currentStamp = 0;

  // Bound once so queryInto/queryAABBInto never allocate a closure per call.
  private queryIntoOut: Uint32Array | null = null;
  private queryIntoCount = 0;
  private readonly queryIntoVisitor = (entityId: number): void => {
    if (this.queryIntoCount < this.queryIntoOut!.length) {
      this.queryIntoOut![this.queryIntoCount] = entityId;
    }
    this.queryIntoCount++;
  };

  // Bound once so getOccupiedCellBoundsInto never allocates a closure per call.
  private cellBoundsOut: Float32Array | null = null;
  private readonly cellBoundsVisitor = (cellIndex: number, key: number): void => {
    const out = this.cellBoundsOut!;
    const i = cellIndex * 6;
    if (i + 6 > out.length) return;
    cellBounds(key, this._cellSize, out, i);
  };

  // Bound once so getOversizedBoundsInto never allocates a closure per call.
  private oversizedBoundsOut: Float32Array | null = null;
  private oversizedBoundsCount = 0;
  private readonly oversizedBoundsVisitor = (slot: number): void => {
    const r = this.radius[slot];
    if (!Number.isFinite(r)) return;
    const out = this.oversizedBoundsOut!;
    const i = this.oversizedBoundsCount++ * 6;
    if (i + 6 > out.length) return;
    out[i] = this.posX[slot] - r;
    out[i + 1] = this.posY[slot] - r;
    out[i + 2] = this.posZ[slot] - r;
    out[i + 3] = this.posX[slot] + r;
    out[i + 4] = this.posY[slot] + r;
    out[i + 5] = this.posZ[slot] + r;
  };

  /** Allocates every per-member array for `opts.maxMembers` members at once. */
  constructor(opts: SpatialGridOptions) {
    this._cellSize = opts.cellSize;
    this.invCellSize = 1 / opts.cellSize;
    this.maxMembers = opts.maxMembers;
    this.oversizedRadiusThreshold = opts.cellSize * (opts.oversizedRadiusMultiplier ?? 2);

    this.slotToEntity = new Int32Array(this.maxMembers).fill(-1);
    this.posX = new Float32Array(this.maxMembers);
    this.posY = new Float32Array(this.maxMembers);
    this.posZ = new Float32Array(this.maxMembers);
    this.radius = new Float32Array(this.maxMembers);
    this.isOversized = new Uint8Array(this.maxMembers);
    this.lastCell = new Array(this.maxMembers).fill(NaN);

    this.cellOfCompact = new Uint32Array(this.maxMembers);
    this.memberSlotByCompactIndex = new Uint32Array(this.maxMembers);
    this.counts = new Uint32Array(0);
    this.cellStart = new Uint32Array(1);
    this.items = new Uint32Array(this.maxMembers);

    this.queryStamp = new Uint32Array(this.maxMembers);
  }

  /**
   * Adds a member, or updates its position and radius when it's one already.
   * @remarks Queries find a new member only after the next `rebuild()`, unless it's oversized.
   */
  addMember(entityId: number, x: number, y: number, z: number, radius: number): void {
    if (this.entityToSlot.has(entityId)) {
      this.updatePosition(entityId, x, y, z);
      this.updateRadius(entityId, radius);
      return;
    }
    if (this.liveCount >= this.maxMembers) {
      throw new Error(`SpatialGrid capacity (${this.maxMembers}) exceeded`);
    }
    const slot = this.liveCount++;
    this.entityToSlot.set(entityId, slot);
    this.slotToEntity[slot] = entityId;
    this.posX[slot] = x;
    this.posY[slot] = y;
    this.posZ[slot] = z;
    this.lastCell[slot] = NaN;
    this._setRadius(slot, radius);
  }

  /**
   * Removes a member. Queries stop returning it at once and find every other member where the
   * last `rebuild()` put it: the slot move patches the two cell entries it touches (one scan of
   * each cell).
   */
  removeMember(entityId: number): void {
    const slot = this.entityToSlot.get(entityId);
    if (slot === undefined) return;

    const lastSlot = this.liveCount - 1;
    // The cells keep pointing at the right members: the removed member's entry first, so a cell
    // holding both entries can't match the moved one's after it was pointed at `slot`
    this._replaceCellItem(this.lastCell[slot], slot, REMOVED_ITEM);
    if (slot !== lastSlot) {
      this._replaceCellItem(this.lastCell[lastSlot], lastSlot, slot);
      this.posX[slot] = this.posX[lastSlot];
      this.posY[slot] = this.posY[lastSlot];
      this.posZ[slot] = this.posZ[lastSlot];
      this.radius[slot] = this.radius[lastSlot];
      this.isOversized[slot] = this.isOversized[lastSlot];
      this.lastCell[slot] = this.lastCell[lastSlot];
      if (this.oversizedSlots.has(lastSlot)) {
        this.oversizedSlots.delete(lastSlot);
        this.oversizedSlots.add(slot);
      } else {
        this.oversizedSlots.delete(slot);
      }
      const movedEntity = this.slotToEntity[lastSlot];
      this.slotToEntity[slot] = movedEntity;
      this.entityToSlot.set(movedEntity, slot);
    } else {
      this.oversizedSlots.delete(slot);
    }

    this.slotToEntity[lastSlot] = -1;
    this.lastCell[lastSlot] = NaN;
    this.entityToSlot.delete(entityId);
    this.liveCount--;
    // maxIndexedRadius may now overestimate; the next rebuild() makes it exact
  }

  /** Points the entry `from` of the cell `key` at `to`: one scan of that cell, nothing for a member in no cell. */
  private _replaceCellItem(key: number, from: number, to: number): void {
    // NaN is no cell's key
    const cellIndex = this.cellKeyToIndex.get(key);
    if (cellIndex === undefined) return;
    const end = this.cellStart[cellIndex + 1];
    for (let k = this.cellStart[cellIndex]; k < end; k++) {
      if (this.items[k] === from) {
        this.items[k] = to;
        return;
      }
    }
  }

  /** Moves a member (a no-op for a non-member). Queries see the move after the next rebuild. */
  updatePosition(entityId: number, x: number, y: number, z: number): void {
    const slot = this.entityToSlot.get(entityId);
    if (slot !== undefined) this.updatePositionAt(slot, x, y, z);
  }

  /**
   * {@link SpatialGrid.updatePosition} for the member at `index` (as {@link SpatialGrid.memberAt}'s),
   * without the entity lookup: for a loop over the members.
   */
  updatePositionAt(index: number, x: number, y: number, z: number): void {
    this.posX[index] = x;
    this.posY[index] = y;
    this.posZ[index] = z;
  }

  /** O(1); a shrinking radius leaves `maxIndexedRadius` high until the next rebuild(). */
  updateRadius(entityId: number, radius: number): void {
    const slot = this.entityToSlot.get(entityId);
    if (slot !== undefined) this.updateRadiusAt(slot, radius);
  }

  /**
   * {@link SpatialGrid.updateRadius} for the member at `index` (as {@link SpatialGrid.memberAt}'s),
   * without the entity lookup: for a loop over the members.
   */
  updateRadiusAt(index: number, radius: number): void {
    // Unchanged (as stored, in float32): already counted in maxIndexedRadius and the tiers
    if (this.radius[index] === Math.fround(radius)) return;
    this._setRadius(index, radius);
  }

  /** The member's radius as last set, or undefined for a non-member. */
  getRadius(entityId: number): number | undefined {
    const slot = this.entityToSlot.get(entityId);
    return slot === undefined ? undefined : this.radius[slot];
  }

  /** Whether `entityId` is a member. */
  has(entityId: number): boolean {
    return this.entityToSlot.has(entityId);
  }

  /**
   * The member at `index` (`0 <= index < memberCount`), for iterating the members without an
   * allocation. The order is unspecified, and `removeMember` changes it.
   */
  memberAt(index: number): number {
    return this.slotToEntity[index];
  }

  /** How many members the grid holds (the bound of {@link SpatialGrid.memberAt}'s index). */
  get memberCount(): number {
    return this.liveCount;
  }

  /** World-space edge length of one grid cell, fixed at construction. */
  get cellSize(): number {
    return this._cellSize;
  }

  /** The grid's counts, in a new object: for the debug tools, not a per-frame read. */
  getStats(): SpatialGridStats {
    return {
      memberCount: this.liveCount,
      oversizedCount: this.oversizedSlots.size,
      occupiedCellCount: this.occupiedCellCount,
      maxIndexedRadius: this.maxIndexedRadius,
    };
  }

  /** Debug tooling only (§9 of the plan) — per-occupied-cell member counts as of the last rebuild, for tuning cellSize against an occupancy histogram. */
  getCellOccupancyCounts(): number[] {
    const counts = new Array<number>(this.occupiedCellCount);
    for (let c = 0; c < this.occupiedCellCount; c++) {
      counts[c] = this.cellStart[c + 1] - this.cellStart[c];
    }
    return counts;
  }

  /**
   * Debug tooling only — every occupied cell's world-space AABB as of the last rebuild,
   * written as 6 floats per cell (`minX, minY, minZ, maxX, maxY, maxZ`) at the cell's
   * dense index. Returns the occupied cell count, which may exceed `out.length / 6`;
   * cells that don't fit are dropped (same convention as queryInto). Oversized members
   * have no cell and don't appear here.
   */
  getOccupiedCellBoundsInto(out: Float32Array): number {
    this.cellBoundsOut = out;
    this.cellKeyToIndex.forEach(this.cellBoundsVisitor);
    this.cellBoundsOut = null;
    return this.occupiedCellCount;
  }

  /**
   * Debug tooling only — the oversized tier's members as world-space AABBs (position ±
   * radius), 6 floats each like getOccupiedCellBoundsInto. Members with an infinite radius
   * (eg. a never-attenuating light) have no finite bounds and are skipped. Returns the
   * number of finite members, which may exceed `out.length / 6`; extras are dropped.
   */
  getOversizedBoundsInto(out: Float32Array): number {
    this.oversizedBoundsOut = out;
    this.oversizedBoundsCount = 0;
    this.oversizedSlots.forEach(this.oversizedBoundsVisitor);
    this.oversizedBoundsOut = null;
    return this.oversizedBoundsCount;
  }

  private _setRadius(slot: number, radius: number): void {
    this.radius[slot] = radius;
    const oversized = radius > this.oversizedRadiusThreshold;
    this.isOversized[slot] = oversized ? 1 : 0;
    if (oversized) this.oversizedSlots.add(slot);
    else {
      this.oversizedSlots.delete(slot);
      if (radius > this.maxIndexedRadius) this.maxIndexedRadius = radius;
    }
  }

  private _packCellKey(cx: number, cy: number, cz: number): number {
    if (IS_DEBUG_ENV && !this.hasWarnedOutOfRange && !isCellInRange(cx, cy, cz)) {
      this.hasWarnedOutOfRange = true;
      lwarn(
        `SpatialGrid: cell coordinate (${cx}, ${cy}, ${cz}) is outside the packable range ` +
          `(±${CELL_AXIS_OFFSET} per axis at cellSize ${this.cellSize}). Entities out here will ` +
          `silently misbucket. Increase cellSize or split into a per-domain grid (plan §5.1).`
      );
    }
    return packCellKey(cx, cy, cz);
  }

  /** Rebuilds the CSR buckets from current member positions and makes `maxIndexedRadius` exact. Call once per frame for a dynamic grid (§8). */
  rebuild(): void {
    this.compactCount = 0;
    let maxRadius = 0;
    for (let slot = 0; slot < this.liveCount; slot++) {
      if (this.isOversized[slot]) {
        this.lastCell[slot] = NaN;
        continue;
      }
      this.memberSlotByCompactIndex[this.compactCount++] = slot;
      if (this.radius[slot] > maxRadius) maxRadius = this.radius[slot];
    }
    this.maxIndexedRadius = maxRadius;

    this.cellKeyToIndex.clear();
    let nextCellIndex = 0;
    for (let i = 0; i < this.compactCount; i++) {
      const slot = this.memberSlotByCompactIndex[i];
      const cx = worldToCell(this.posX[slot], this.invCellSize);
      const cy = worldToCell(this.posY[slot], this.invCellSize);
      const cz = worldToCell(this.posZ[slot], this.invCellSize);
      const key = this._packCellKey(cx, cy, cz);
      this.lastCell[slot] = key;
      let cellIndex = this.cellKeyToIndex.get(key);
      if (cellIndex === undefined) {
        cellIndex = nextCellIndex++;
        this.cellKeyToIndex.set(key, cellIndex);
      }
      this.cellOfCompact[i] = cellIndex;
    }
    this.occupiedCellCount = nextCellIndex;

    if (this.counts.length < this.occupiedCellCount) {
      this.counts = new Uint32Array(this.occupiedCellCount);
      this.cellStart = new Uint32Array(this.occupiedCellCount + 1);
    } else {
      this.counts.fill(0, 0, this.occupiedCellCount);
    }

    for (let i = 0; i < this.compactCount; i++) {
      this.counts[this.cellOfCompact[i]]++;
    }
    let sum = 0;
    for (let c = 0; c < this.occupiedCellCount; c++) {
      this.cellStart[c] = sum;
      sum += this.counts[c];
    }
    this.cellStart[this.occupiedCellCount] = sum;

    // Reuse `counts` as per-cell write cursors — no extra allocation.
    const cursor = this.counts;
    for (let c = 0; c < this.occupiedCellCount; c++) cursor[c] = this.cellStart[c];
    for (let i = 0; i < this.compactCount; i++) {
      const cell = this.cellOfCompact[i];
      this.items[cursor[cell]++] = this.memberSlotByCompactIndex[i];
    }
  }

  /**
   * Zero-allocation candidate visit for a sphere query. Candidates only — caller does the exact test (§7).
   * @param visit called once per candidate; returning `true` stops the visit (an existence check
   * needs no more candidates). Pass a function made once, not a closure per call.
   * @returns whether `visit` stopped it
   */
  queryVisit(p: ReadonlyVec3, r: number, visit: (entityId: number) => boolean | void): boolean {
    const expanded = r + this.maxIndexedRadius;
    return this._walkCellRange(
      p.x - expanded,
      p.x + expanded,
      p.y - expanded,
      p.y + expanded,
      p.z - expanded,
      p.z + expanded,
      visit
    );
  }

  /**
   * Zero-allocation candidate visit for an AABB query. Candidates only — caller does the exact test (§7).
   * @param visit as {@link SpatialGrid.queryVisit}'s: returning `true` stops the visit
   * @returns whether `visit` stopped it
   */
  queryAABBVisit(
    min: ReadonlyVec3,
    max: ReadonlyVec3,
    visit: (entityId: number) => boolean | void
  ): boolean {
    const e = this.maxIndexedRadius;
    return this._walkCellRange(
      min.x - e,
      max.x + e,
      min.y - e,
      max.y + e,
      min.z - e,
      max.z + e,
      visit
    );
  }

  /** Same as queryVisit but writes into `out` and returns the candidate count (may exceed out.length; extras are dropped). */
  queryInto(p: ReadonlyVec3, r: number, out: Uint32Array): number {
    this.queryIntoOut = out;
    this.queryIntoCount = 0;
    this.queryVisit(p, r, this.queryIntoVisitor);
    return this.queryIntoCount;
  }

  /** Same as queryAABBVisit but writes into `out` and returns the candidate count (may exceed out.length; extras are dropped). */
  queryAABBInto(min: ReadonlyVec3, max: ReadonlyVec3, out: Uint32Array): number {
    this.queryIntoOut = out;
    this.queryIntoCount = 0;
    this.queryAABBVisit(min, max, this.queryIntoVisitor);
    return this.queryIntoCount;
  }

  private _walkCellRange(
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    minZ: number,
    maxZ: number,
    visit: (entityId: number) => boolean | void
  ): boolean {
    this.currentStamp++;
    const stamp = this.currentStamp;

    const minCx = worldToCell(minX, this.invCellSize);
    const maxCx = worldToCell(maxX, this.invCellSize);
    const minCy = worldToCell(minY, this.invCellSize);
    const maxCy = worldToCell(maxY, this.invCellSize);
    const minCz = worldToCell(minZ, this.invCellSize);
    const maxCz = worldToCell(maxZ, this.invCellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        for (let cz = minCz; cz <= maxCz; cz++) {
          const cellIndex = this.cellKeyToIndex.get(this._packCellKey(cx, cy, cz));
          if (cellIndex === undefined) continue;
          const start = this.cellStart[cellIndex];
          const end = this.cellStart[cellIndex + 1];
          for (let k = start; k < end; k++) {
            const slot = this.items[k];
            if (slot === REMOVED_ITEM || this.queryStamp[slot] === stamp) continue;
            this.queryStamp[slot] = stamp;
            if (visit(this.slotToEntity[slot]) === true) return true;
          }
        }
      }
    }

    for (const slot of this.oversizedSlots) {
      if (this.queryStamp[slot] === stamp) continue;
      this.queryStamp[slot] = stamp;
      if (visit(this.slotToEntity[slot]) === true) return true;
    }
    return false;
  }
}
