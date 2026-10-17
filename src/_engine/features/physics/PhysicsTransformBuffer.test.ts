import { describe, expect, it } from 'vitest';
import { PHYSICS_TRANSFORM_FIELD_COUNT, PhysicsTransformBuffer } from './PhysicsTransformBuffer';
import type { PoseArray } from './types/PhysicsBodyTypes';

/** A body whose pose and velocities are its id, offset per field. */
const fakeBody = (id: number) => ({
  readPoseInto: (out: PoseArray, offset = 0) => {
    for (let i = 0; i < 7; i++) out[offset + i] = id * 100 + i;
  },
  readVelocitiesInto: (out: PoseArray, offset = 0) => {
    for (let i = 0; i < 6; i++) out[offset + i] = id * 100 + 7 + i;
  },
});

describe('PhysicsTransformBuffer', () => {
  it('walks the used slots by id, a freed one as -1', () => {
    const worker = new PhysicsTransformBuffer(8);
    worker.allocateSlot(10);
    worker.allocateSlot(11);
    worker.allocateSlot(12);
    worker.freeSlot(11);
    expect(worker.getUsedSlotCount()).toBe(3);
    expect([0, 1, 2].map((slot) => worker.getSlotId(slot))).toEqual([10, -1, 12]);
    // A freed slot is reused first
    expect(worker.allocateSlot(13)).toBe(1);
    expect(worker.getSlotId(1)).toBe(13);
  });

  it('writes a body straight into its slot (writeSlotFrom)', () => {
    const worker = new PhysicsTransformBuffer(4);
    const slot = worker.allocateSlot(3);
    worker.writeSlotFrom(slot, fakeBody(3));
    worker.publish(1);
    const pose = new Float32Array(7);
    const velocities = new Float32Array(6);
    worker.readPoseInto(slot, pose);
    worker.readVelocitiesInto(slot, velocities);
    expect([...pose]).toEqual([300, 301, 302, 303, 304, 305, 306]);
    expect([...velocities]).toEqual([307, 308, 309, 310, 311, 312]);
  });

  it('pushes only the used slots, which the main thread copies in with the step stamp', () => {
    const worker = new PhysicsTransformBuffer(2048);
    for (const id of [5, 6, 7]) worker.writeSlotFrom(worker.allocateSlot(id), fakeBody(id));
    worker.publish(42);
    const push = worker.copyUsedBank();
    // 3 slots and the header, not the whole bank
    expect(push.byteLength).toBe(3 * PHYSICS_TRANSFORM_FIELD_COUNT * 4 + 2 * 4);

    const main = new PhysicsTransformBuffer(2048);
    main.receiveUsedBank(push);
    expect(main.getStepIndex()).toBe(42);
    expect(main.getPosition(2)).toEqual({ x: 700, y: 701, z: 702 });
    expect(main.getAngvel(0)).toEqual({ x: 510, y: 511, z: 512 });

    // A later, larger push replaces it
    worker.writeSlotFrom(worker.allocateSlot(8), fakeBody(8));
    worker.writeSlotFrom(0, fakeBody(9));
    worker.publish(43);
    main.receiveUsedBank(worker.copyUsedBank());
    expect(main.getStepIndex()).toBe(43);
    expect(main.getPosition(0)).toEqual({ x: 900, y: 901, z: 902 });
    expect(main.getPosition(3)).toEqual({ x: 800, y: 801, z: 802 });
  });
});
