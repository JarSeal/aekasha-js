import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';

const m = vi.hoisted(() => ({
  isDebug: true,
  fonts: new Map<string, unknown>(),
  lerror: vi.fn(),
  lwarn: vi.fn(),
}));
vi.mock(import('../../kernel/config/Config'), async (importOriginal) => {
  const original = await importOriginal();
  return Object.defineProperties(
    { ...original },
    { IS_DEBUG_ENV: { get: () => m.isDebug, enumerable: true } }
  );
});
vi.mock(import('../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lerror: m.lerror,
  lwarn: m.lwarn,
}));
vi.mock(import('./Fonts'), async (importOriginal) => ({
  ...(await importOriginal()),
  getFont: (id: string) => m.fonts.get(id) as FontData | undefined,
}));

import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import type { FeatureContext } from '../../kernel/init/Features';
import { createRootScene, getRootScene } from '../../kernel/scene/Scene';
import type { SceneHooks } from '../../kernel/scene/SceneHooks';
import type { FontData } from './Fonts';
import { TextLayoutBuffer } from './TextLayout';
import { TEXT_DIRTY_BATCH, TEXT_DIRTY_LAYOUT, TEXT_DIRTY_ROW, type TextObject } from './TextObject';
import { clearTextUpdateQueue, getTextUpdateQueue } from './TextRegistry';
import {
  bindTextToEntity,
  createText,
  createTextEntity,
  getText,
  getTextForEntity,
  installTexts,
} from './Texts';

/** A font of a space and two inked glyphs, `?` (the fallback) and `A`, each 0.5 em wide */
const createFont = (id: string): FontData => ({
  id,
  type: 'MTSDF',
  atlas: {} as THREE.Texture,
  atlasWidth: 64,
  atlasHeight: 64,
  size: 48,
  pxRange: 8,
  metrics: {
    ascender: 0.8,
    descender: -0.2,
    lineHeight: 1.25,
    underlineY: -0.1,
    underlineThickness: 0.05,
  },
  glyphCount: 3,
  codePoints: new Uint32Array([0x20, 0x3f, 0x41]),
  advances: new Float32Array([0.25, 0.5, 0.5]),
  planeRects: new Float32Array([0, 0, 0, 0, 0, -0.1, 0.5, 1, 0, -0.1, 0.5, 1]),
  atlasRects: new Float32Array([0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0, 0.5, 0.5]),
  glyphIndices: new Map([
    [0x20, 0],
    [0x3f, 1],
    [0x41, 2],
  ]),
  fallbackIndex: 1,
  kerning: new Map(),
});

const sans = createFont('sans');
const mono = createFont('mono');
const sceneHooks: SceneHooks[] = [];

/** Whether the text is in the update queue, with these dirty bits */
const expectQueued = (text: TextObject, flags: number) => {
  expect(getTextUpdateQueue()).toContain(text);
  expect(text.dirtyFlags).toBe(flags);
};

/** Takes the queue as the feature's system would: the bits cleared, the queue emptied */
const drain = () => {
  for (const text of getTextUpdateQueue()) text.dirtyFlags = 0;
  clearTextUpdateQueue();
};

describe('createText before the install', () => {
  test('throws naming the feature', () => {
    expect(() => createText({ font: 'sans' })).toThrow(/text\(\).*aekasha\/text/);
  });
});

describe('texts', () => {
  beforeAll(() => {
    createRootScene();
    installTexts({
      addSceneHooks: (hooks: SceneHooks) => {
        sceneHooks.push(hooks);
        return () => {};
      },
      registerComponentHooks: (type, hooks) => ECSWorld.registerComponentHooks(type, hooks),
    } as Partial<FeatureContext> as FeatureContext);
  });

  beforeEach(() => {
    m.fonts.clear();
    m.fonts.set('sans', sans);
    m.fonts.set('mono', mono);
    m.lerror.mockClear();
    m.lwarn.mockClear();
    m.isDebug = true;
    sceneHooks[0].exit?.('previous');
    drain();
  });

  test('defaults, and a generated id getText finds', () => {
    const text = createText({ font: 'sans' });
    expect(text.id).toMatch(/^text_\d+$/);
    expect(getText(text.id)).toBe(text);
    expect(text.name).toBe(text.id);
    expect(text.text).toBe('');
    expect(text.font).toBe(sans);
    expect([text.size, text.sizing, text.orientation]).toEqual([1, 'WORLD', 'PLANE']);
    expect([text.align, text.anchor, text.maxWidth]).toEqual(['CENTER', 'MIDDLE_CENTER', Infinity]);
    expect([text.lineHeight, text.letterSpacing, text.opacity]).toEqual([1.25, 0, 1]);
    expect(text.color.getHex()).toBe(0xffffff);
    expect([text.depthTest, text.renderOrder, text.blend, text.visible]).toEqual([
      true,
      0,
      'AUTO',
      true,
    ]);
    expect(text.attachment).toEqual({ to: 'WORLD' });
    expect(text.persistent).toBe(false);
    // A new text needs everything: its layout, its row and a batch
    expectQueued(text, TEXT_DIRTY_LAYOUT | TEXT_DIRTY_ROW | TEXT_DIRTY_BATCH);
    expect(createText({ font: 'sans', sizing: 'SCREEN' }).size).toBe(16);
  });

  test('the props: the transform from Euler angles or a quaternion', () => {
    const text = createText({
      font: 'sans',
      text: 'A',
      size: 0.5,
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
      scale: { x: 2, y: 2, z: 2 },
      color: '#ff0000',
      opacity: 2,
    });
    expect(text.position.toArray()).toEqual([1, 2, 3]);
    expect(text.quaternion.y).toBeCloseTo(Math.SQRT1_2, 6);
    expect(text.scale.toArray()).toEqual([2, 2, 2]);
    expect(text.color.getHex()).toBe(0xff0000);
    expect(text.opacity).toBe(1);
    const turned = createText({
      font: 'sans',
      rotation: { x: 1, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
    });
    expect(turned.quaternion.x).toBe(0);
  });

  test('throws for a font not loaded, naming it and the fixes', () => {
    expect(() => createText({ font: 'serif' })).toThrow(/"serif".*fonts.*loadFontAsync\('serif'\)/);
    expect(m.lerror).toHaveBeenCalledTimes(1);
  });

  test('throws for an id a live text has; a disposed one frees it', () => {
    const first = createText({ font: 'sans', id: 'sign' });
    expect(() => createText({ font: 'sans', id: 'sign' })).toThrow(/"sign" already exists/);
    first.dispose();
    expect(createText({ font: 'sans', id: 'sign' })).not.toBe(first);
  });

  test('each setter marks only what it changes, and queues the text once', () => {
    const text = createText({ font: 'sans', text: 'A' });
    drain();

    text.setColor('#00ff00', 0.5);
    text.setOpacity(0.25);
    text.setVisible(false);
    text.setLocalTransform({ position: { x: 0, y: 1, z: 0 } });
    expectQueued(text, TEXT_DIRTY_ROW);
    expect(getTextUpdateQueue()).toHaveLength(1);
    expect([text.color.getHex(), text.opacity, text.visible]).toEqual([0x00ff00, 0.25, false]);
    drain();

    text.setText('AA');
    text.setSize(2);
    text.setAlign('LEFT');
    text.setAnchor('TOP_LEFT');
    text.setMaxWidth(3);
    text.setLineHeight(1.5);
    text.setLetterSpacing(0.1);
    expectQueued(text, TEXT_DIRTY_LAYOUT);
    expect(text.isLayoutDirty).toBe(true);
    drain();

    text.setSizing('SCREEN');
    text.setOrientation('BILLBOARD');
    text.setBlend('BLEND');
    text.setDepthTest(false);
    text.setRenderOrder(5);
    expectQueued(text, TEXT_DIRTY_BATCH);
    drain();

    text.setFont('mono');
    expect(text.font).toBe(mono);
    expectQueued(text, TEXT_DIRTY_LAYOUT | TEXT_DIRTY_BATCH);
  });

  test('a setter given the current value marks nothing', () => {
    const text = createText({ font: 'sans', text: 'A', size: 2, align: 'LEFT' });
    drain();
    text.setText('A');
    text.setSize(2);
    text.setAlign('LEFT');
    text.setOpacity(1);
    text.setVisible(true);
    text.setFont('sans');
    text.setLineHeight(undefined);
    expect(getTextUpdateQueue()).toHaveLength(0);
    expect(text.dirtyFlags).toBe(0);
  });

  test('a size not above 0 is refused with a warning', () => {
    const text = createText({ font: 'sans', size: -1 });
    expect(text.size).toBe(1);
    drain();
    text.setSize(0);
    text.setSize(Number.NaN);
    expect(text.size).toBe(1);
    expect(m.lwarn).toHaveBeenCalledTimes(3);
    expect(getTextUpdateQueue()).toHaveLength(0);
  });

  test('setFont throws for a font not loaded and keeps the font', () => {
    const text = createText({ font: 'sans' });
    expect(() => text.setFont('serif')).toThrow(/"serif"/);
    expect(text.font).toBe(sans);
  });

  test('updateLayout lays the text out, keeps its counts and box, clears the layout bit', () => {
    const text = createText({ font: 'sans', text: 'AA\nA', anchor: 'TOP_LEFT', align: 'LEFT' });
    const out = new TextLayoutBuffer();
    expect(text.updateLayout(out)).toBe(3);
    expect([text.glyphCount, text.lineCount]).toEqual([3, 2]);
    expect(text.bounds.min.toArray()).toEqual([0, -(1 + 1.25), 0]);
    expect(text.bounds.max.toArray()).toEqual([1, 0, 0]);
    expect(text.dirtyFlags).toBe(TEXT_DIRTY_ROW | TEXT_DIRTY_BATCH);
    // The text's own line height over the font's
    text.setLineHeight(2);
    text.updateLayout(out);
    expect(text.bounds.min.y).toBeCloseTo(-3, 6);
  });

  test('a missing character warns once per character and font, in the debug env only', () => {
    const out = new TextLayoutBuffer();
    const text = createText({ font: 'sans', text: 'ÆÆ' });
    text.updateLayout(out);
    text.updateLayout(out);
    expect(m.lwarn).toHaveBeenCalledTimes(1);
    expect(m.lwarn.mock.calls[0][0]).toMatch(/"sans" has no "Æ" \(U\+00C6\).*--only sans/);
    text.setFont('mono');
    text.updateLayout(out);
    expect(m.lwarn).toHaveBeenCalledTimes(2);

    m.isDebug = false;
    text.setText('Ø');
    text.updateLayout(out);
    expect(m.lwarn).toHaveBeenCalledTimes(2);
  });

  test('attach: world, an Object3D, an entity without an Object3D throws', () => {
    const world = new ECSWorld({ id: 'textAttach' });
    const text = createText({ font: 'sans' });
    drain();
    const object3D = {} as THREE.Object3D;
    text.attach({ to: 'OBJECT3D', object3D });
    expect(text.attachment).toEqual({ to: 'OBJECT3D', object3D });
    expectQueued(text, TEXT_DIRTY_ROW);
    const entityId = world.createEntity();
    expect(() => text.attach({ to: 'ENTITY', entityId, world })).toThrow(/no Object3D/);
    expect(text.attachment.to).toBe('OBJECT3D');
  });

  test('dispose: out of the registry, queued for its glyphs to go, then inert', () => {
    const text = createText({ font: 'sans', text: 'A' });
    drain();
    text.dispose();
    text.dispose();
    expect(text.isDisposed).toBe(true);
    expect(getText(text.id)).toBeUndefined();
    expect(getTextUpdateQueue()).toEqual([text]);
    drain();
    text.setText('B');
    expect(getTextUpdateQueue()).toHaveLength(0);
  });

  test('the scene exit disposes every text but the persistent ones', () => {
    const scene = createText({ font: 'sans' });
    const kept = createText({ font: 'sans', persistent: true });
    sceneHooks[0].exit?.('scene');
    expect(scene.isDisposed).toBe(true);
    expect(kept.isDisposed).toBe(false);
    expect(getText(kept.id)).toBe(kept);
    kept.dispose();
  });

  describe('text entities', () => {
    const world = new ECSWorld({ id: 'textEntities' });

    /** The text entity's Object3D */
    const objectOf = (entityId: number) =>
      world.getComponent(entityId, ComponentType.OBJECT3D)!.value;

    test('createTextEntity: an Object3D in the scene, the TEXT component, the transform', () => {
      const entityId = createTextEntity(
        {
          text: 'EXIT',
          font: 'sans',
          position: { x: 1, y: 2, z: 3 },
          rotation: { x: 0, y: Math.PI, z: 0 },
          scale: { x: 2, y: 2, z: 2 },
        },
        { world, appId: 'exitSign' }
      );
      const text = getTextForEntity(entityId, world)!;
      expect(text.id).toBe('exitSign');
      expect(getText('exitSign')).toBe(text);
      expect(world.getComponent(entityId, ComponentType.TEXT)).toEqual({ textId: 'exitSign' });

      const obj = objectOf(entityId);
      expect(obj.constructor).toBe(THREE.Object3D);
      expect(obj.parent).toBe(getRootScene());
      expect([obj.name, obj.userData.textId, obj.userData.entityId]).toEqual([
        'exitSign',
        'exitSign',
        entityId,
      ]);
      // The text follows the entity's object; its own transform stays the identity
      expect(text.attachment).toEqual({ to: 'OBJECT3D', object3D: obj });
      expect(text.position.toArray()).toEqual([0, 0, 0]);
      expect(text.quaternion.toArray()).toEqual([0, 0, 0, 1]);

      const transform = world.getComponent(entityId, ComponentType.TRANSFORM)!;
      expect(transform.position.toArray()).toEqual([1, 2, 3]);
      expect(Math.abs(transform.quaternion.y)).toBeCloseTo(1, 6);
      expect(transform.scale.toArray()).toEqual([2, 2, 2]);
      expect(text.persistent).toBe(false);
      world.deleteEntity(entityId);
    });

    test("the entity's persistent is the text's; doNotAddToScene leaves the object out", () => {
      const entityId = createTextEntity(
        { font: 'sans' },
        { world, persistent: true, doNotAddToScene: true }
      );
      const text = getTextForEntity(entityId, world)!;
      expect(text.persistent).toBe(true);
      expect(world.hasComponent(entityId, ComponentType.PERSISTENT)).toBe(true);
      expect(objectOf(entityId).parent).toBeNull();
      text.dispose();
    });

    test('an unloaded font or a taken id throws before the entity exists', () => {
      const before = getRootScene()!.children.length;
      expect(() => createTextEntity({ font: 'serif' }, { world })).toThrow(/"serif"/);
      createText({ font: 'sans', id: 'taken' });
      expect(() => createTextEntity({ font: 'sans' }, { world, appId: 'taken' })).toThrow(
        /"taken" already exists/
      );
      expect(getRootScene()!.children.length).toBe(before);
    });

    test('deleting a text entity disposes its text and takes its object out', () => {
      const entityId = createTextEntity({ font: 'sans' }, { world });
      const text = getTextForEntity(entityId, world)!;
      const obj = objectOf(entityId);
      world.deleteEntity(entityId);
      expect(text.isDisposed).toBe(true);
      expect(text.entityBinding).toBeNull();
      expect(getText(text.id)).toBeUndefined();
      expect(obj.parent).toBeNull();
    });

    test("disposing a text entity's text deletes the entity and takes its object out", () => {
      const entityId = createTextEntity({ font: 'sans' }, { world });
      const obj = objectOf(entityId);
      getTextForEntity(entityId, world)!.dispose();
      expect(world.isAlive(entityId)).toBe(false);
      expect(obj.parent).toBeNull();
    });

    test('removing the TEXT component disposes the text; the entity stays', () => {
      const entityId = createTextEntity({ font: 'sans' }, { world });
      const text = getTextForEntity(entityId, world)!;
      world.removeComponent(entityId, ComponentType.TEXT);
      expect(text.isDisposed).toBe(true);
      expect(world.isAlive(entityId)).toBe(true);
      world.deleteEntity(entityId);
    });

    test('bindTextToEntity: the entity owns the text, the text only its component', () => {
      const entityId = world.createEntity();
      const text = createText({ font: 'sans' });
      bindTextToEntity(text, entityId, world);
      expect(getTextForEntity(entityId, world)).toBe(text);
      expect(text.entityBinding).toEqual({ world, entityId, ownsEntity: false });

      // Disposing the text keeps the entity, without its component
      text.dispose();
      expect(world.isAlive(entityId)).toBe(true);
      expect(world.hasComponent(entityId, ComponentType.TEXT)).toBe(false);

      // Deleting the entity disposes a bound text
      const second = createText({ font: 'sans' });
      bindTextToEntity(second, entityId, world);
      world.deleteEntity(entityId);
      expect(second.isDisposed).toBe(true);
    });

    test('bindTextToEntity refuses a bound or disposed text, an entity with a text or gone', () => {
      const entityId = world.createEntity();
      const text = createText({ font: 'sans' });
      bindTextToEntity(text, entityId, world);
      const other = world.createEntity();
      expect(() => bindTextToEntity(text, other, world)).toThrow(/already bound/);
      expect(() => bindTextToEntity(createText({ font: 'sans' }), entityId, world)).toThrow(
        /already has a text/
      );
      const disposed = createText({ font: 'sans' });
      disposed.dispose();
      expect(() => bindTextToEntity(disposed, other, world)).toThrow(/disposed/);
      world.deleteEntity(other);
      expect(() => bindTextToEntity(createText({ font: 'sans' }), other, world)).toThrow(/gone/);
      world.deleteEntity(entityId);
    });

    test("an entity in another world with the same id doesn't take the text", () => {
      const otherWorld = new ECSWorld({ id: 'textEntitiesOther' });
      const entityId = world.createEntity();
      const text = createText({ font: 'sans' });
      bindTextToEntity(text, entityId, world);
      const otherId = otherWorld.createEntity();
      otherWorld.addComponent(otherId, ComponentType.TEXT, { textId: text.id });
      otherWorld.deleteEntity(otherId);
      expect(text.isDisposed).toBe(false);
      world.deleteEntity(entityId);
      expect(text.isDisposed).toBe(true);
    });

    test('attach to an entity follows its Object3D, in its world', () => {
      const entityId = createTextEntity({ font: 'sans' }, { world });
      const label = createText({ font: 'sans' });
      label.attach({ to: 'ENTITY', entityId, world });
      expect(label.attachment).toEqual({ to: 'ENTITY', entityId, world });
      world.deleteEntity(entityId);
    });

    test("the scene exit leaves the entities' texts to their entities", () => {
      const entityId = createTextEntity({ font: 'sans' }, { world });
      const owned = getTextForEntity(entityId, world)!;
      const boundId = world.createEntity();
      const bound = createText({ font: 'sans' });
      bindTextToEntity(bound, boundId, world);
      sceneHooks[0].exit?.('scene');
      expect(owned.isDisposed).toBe(false);
      expect(bound.isDisposed).toBe(false);
      world.deleteEntity(entityId);
      world.deleteEntity(boundId);
      expect(owned.isDisposed && bound.isDisposed).toBe(true);
    });
  });
});
