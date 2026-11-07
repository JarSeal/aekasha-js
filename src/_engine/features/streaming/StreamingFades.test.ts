import * as THREE from 'three/webgpu';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import {
  getObjectVisibilityFade,
  isLodDitherEnabled,
  LOD_FADE_OPAQUE,
} from '../../kernel/render/LodFade';
import { createStreamingFader } from './StreamingFades';

let world: ECSWorld;
let seq = 0;

beforeEach(() => {
  world = new ECSWorld({ id: `fades-test-${seq++}`, maxEntities: 100, applyGlobalPlugins: false });
});

afterEach(() => {
  ECSWorld.deleteWorld(world.id);
});

/** A mesh entity of `material`, with a child mesh and a LOD fade copy */
const meshEntity = (material: THREE.Material) => {
  const id = world.createEntity();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
  const child = new THREE.Mesh(new THREE.BoxGeometry(), material);
  const copy = new THREE.Mesh(new THREE.BoxGeometry(), material);
  copy.userData.isLodFadeCopy = true;
  mesh.add(child, copy);
  world.addComponent(id, ComponentType.OBJECT3D, { value: mesh, _lastVersion: 0 });
  return { id, mesh, child, copy };
};

const isHeld = (id: number) => world.hasComponent(id, ComponentType.TAG_DRAW_HELD);

describe('the streaming fader (p353 Phase 5 D4-D6)', () => {
  test('prepare dithers the materials (each changed one told once) and hides when asked', () => {
    const dithered: THREE.Material[] = [];
    const fader = createStreamingFader((material) => dithered.push(material));
    const material = new THREE.MeshStandardNodeMaterial();
    const shown = meshEntity(material);
    const hidden = meshEntity(material);
    fader.prepare(world, [shown.id], false);
    fader.prepare(world, [hidden.id, world.createEntity()], true);
    expect(isLodDitherEnabled(material)).toBe(true);
    expect(dithered).toEqual([material]);
    expect(getObjectVisibilityFade(shown.mesh)).toBe(LOD_FADE_OPAQUE);
    expect(getObjectVisibilityFade(hidden.mesh)).toBe(0);
    expect(getObjectVisibilityFade(hidden.child)).toBe(0);
    // The copy reads its mesh's
    expect(getObjectVisibilityFade(hidden.copy)).toBe(0);
  });

  test('a fade in draws its progress, lifts a hold left on its entities, and ends whole', () => {
    const fader = createStreamingFader(() => {});
    const entity = meshEntity(new THREE.MeshBasicNodeMaterial());
    world.addComponent(entity.id, ComponentType.TAG_DRAW_HELD, true);
    const job = fader.start(world, [entity.id], 'IN', 0.25);
    expect(isHeld(entity.id)).toBe(false);
    expect(getObjectVisibilityFade(entity.mesh)).toBe(0.25);
    fader.draw(job, 0.5);
    expect(getObjectVisibilityFade(entity.child)).toBe(0.5);
    fader.draw(job, 1);
    expect(getObjectVisibilityFade(entity.mesh)).toBe(LOD_FADE_OPAQUE);
  });

  test('a fade out draws progress - 1 and ends held from drawing; release lets go', () => {
    const fader = createStreamingFader(() => {});
    const entity = meshEntity(new THREE.MeshBasicNodeMaterial());
    const job = fader.start(world, [entity.id], 'OUT', 0);
    expect(getObjectVisibilityFade(entity.mesh)).toBe(-1);
    fader.draw(job, 0.75);
    expect(getObjectVisibilityFade(entity.mesh)).toBe(-0.25);
    fader.draw(job, 1);
    expect(isHeld(entity.id)).toBe(true);
    expect(getObjectVisibilityFade(entity.mesh)).toBe(LOD_FADE_OPAQUE);
    fader.release(world, [entity.id]);
    expect(isHeld(entity.id)).toBe(false);
  });
});
