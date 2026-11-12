// Dithered LOD cross-fades (docs/plans/_DONE_p351_impostor-billboard-lod.md §2.4, Phase 2): while an entity
// changes level, both levels are drawn and dissolve into each other through a screen-space dither,
// so nothing pops and everything stays opaque (no sorting, shadows and post effects unchanged).
//
// A fade is one signed value per drawn copy: v ≥ 0 shows the pixels whose noise is ≤ v, v < 0 the
// pixels whose noise is ≥ 1 - |v|. The incoming copy at `t` and the outgoing one at `-(1 - t)`
// split the pixels between them, never both and never neither; 1 (and -1) shows every pixel.
//
// Level materials are shared (between a pool's level meshes, and with other meshes), so the fade
// can't be a fixed input of the material. Every dither-enabled material uses one mask node that
// reads the fade of what's being drawn, from one of three sources, picked when the build is set up:
// - An InstancedMesh: its per-instance `lodFade` attribute (createLodFadeAttribute), and the
//   per-object value too (setLodObjectFade: an InstancedMesh entity fades as a whole; p058 D2,
//   docs/plans/_DONE_p058_shared-instanced-builds-for-lod-fades-and-impostors.md). An InstancedMesh
//   without a fade of its own binds an opaque one (`getDrawnFadeAttribute`), so the shared build
//   always finds an attribute.
// - An object whose draws carry their own fade (setObjectLodFadeNode): an instance set's draws
//   (features/instancing/, p354 D8), whose fade comes with each drawn instance's visible list
//   entry, through the vertex stage; a batched merge group's batch (features/merging/, p375 Phase
//   2), whose fade is a texel of its fade texture at the drawn instance (`batchIndirectIndex`). It takes the place of the per-object LOD fade. It's keyed on
//   the object, not its material: the shadow pass builds the object with its own material, which
//   takes the source material's mask (three's `_getShadowNodes`), so only the object is the same
//   in both builds (p354 Phase 3 step 4).
// - Anything else (a plain mesh, a LOD fade copy): the per-object value alone.
// The attribute and the per-object value bind per object at draw time, so meshes on one material
// share one build: three r187 shares a build between InstancedMeshes with the same material and
// attributes and looks it up before any setup runs (#35007), and binds each one's attributes
// through `ReferenceAttributeNode.getAttribute(object)`. The shadow pass reads `maskNode` too:
// shadows dither with the same split.
//
// A second per-object fade, the visibility fade (setObjectVisibilityFade; p353 Phase 5 D5:
// streaming's content dithering in and out), is ANDed into the same mask on the same noise. Both
// fades split one noise, so they compose exactly: a LOD cross-fade (its copies at t and t - 1)
// under a visibility fade-in at s shows the pixels with noise ≤ s across the two copies, under a
// fade-out at progress s (drawn at s - 1) those with noise ≥ s (isDitherShown has the maths). A
// LOD fade copy reads its mesh's visibility fade.
import * as THREE from 'three/webgpu';
import { bool, dot, float, Fn, fract, screenCoordinate, select, uniform, vec2 } from 'three/tsl';

type MaskableMaterial = THREE.Material & { maskNode?: THREE.Node | null };

/** The fade value that shows every pixel: what a copy that isn't fading draws with. */
export const LOD_FADE_OPAQUE = 1;

/** Interleaved gradient noise (Jimenez 2014) on the pixel position, in [0, 1). */
const interleavedGradientNoise = Fn(() => {
  const p = screenCoordinate as unknown as THREE.Node<'vec2'>;
  return fract(float(52.9829189).mul(fract(dot(p, vec2(0.06711056, 0.00583715)))));
});

/** Whether a pixel of `noise` shows at the signed fade `fade` (a `bool` node). */
const ditherShows = (noise: THREE.Node<'float'>, fade: THREE.Node) => {
  const f = float(fade as THREE.Node<'float'>);
  return select(f.greaterThanEqual(0), noise, noise.oneMinus()).lessThanEqual(f.abs());
};

/**
 * Whether a pixel of a copy drawn with the signed fade `fade` shows (a `bool` node), for a
 * material's `maskNode`. See the top of `LodFade.ts` for the encoding. Custom node materials that
 * build their own mask can combine it; `enableLodDither` does it for any material.
 * @param fade a float node: `t` for the incoming copy, `-(1 - t)` for the outgoing one
 */
export const lodDither = (fade: THREE.Node) => ditherShows(interleavedGradientNoise(), fade);

/**
 * The dither's test on the CPU, the same as the shader's: whether a pixel of `noise` (in [0, 1))
 * shows at the signed fade `fade`. For tests and tools reasoning about the split.
 * @internal
 */
export const isDitherShown = (noise: number, fade: number) =>
  (fade >= 0 ? noise : 1 - noise) <= Math.abs(fade);

// --- WHERE A DRAWN OBJECT'S FADE COMES FROM ---

const fadeAttributes = new WeakMap<THREE.Object3D, THREE.InstancedBufferAttribute>();
/** The fade an InstancedMesh without `createLodFadeAttribute` draws with: every instance whole. */
const opaqueFadeAttributes = new WeakMap<THREE.Object3D, THREE.InstancedBufferAttribute>();
const objectFades = new WeakMap<THREE.Object3D, number>();
/** An object's own per-draw fade node (setObjectLodFadeNode). */
const objectFadeNodes = new WeakMap<THREE.Object3D, THREE.Node<'float'>>();
const visibilityFades = new WeakMap<THREE.Object3D, number>();

/** An object's visibility fade: its own, or a LOD fade copy's mesh's (the copy is its child). */
const getVisibilityFade = (object: THREE.Object3D) => {
  const own = visibilityFades.get(object);
  if (own !== undefined) return own;
  const { parent } = object;
  if (!parent || !object.userData.isLodFadeCopy) return LOD_FADE_OPAQUE;
  return visibilityFades.get(parent) ?? LOD_FADE_OPAQUE;
};

/** The drawn object's fades, x its LOD fade and y its visibility fade, written before each draw of
 * an object (three's object uniform group) into the uniform's own vector: nothing allocated. */
const objectFadePair = uniform(new THREE.Vector2(LOD_FADE_OPAQUE, LOD_FADE_OPAQUE)).onObjectUpdate(
  ({ object }, self) => {
    const fades = self.value;
    if (!object) fades.set(LOD_FADE_OPAQUE, LOD_FADE_OPAQUE);
    else fades.set(objectFades.get(object) ?? LOD_FADE_OPAQUE, getVisibilityFade(object));
    return undefined;
  }
);

/**
 * Gives `mesh` a per-instance fade (`lodFade`), every instance at {@link LOD_FADE_OPAQUE}: its
 * dither-enabled materials then read each instance's own fade. It can be called after the mesh
 * was first drawn: the fade binds per drawn object, and the mesh's builds are shared with the
 * other InstancedMeshes on its materials. The attribute isn't on the geometry, which is shared: the
 * mesh's `dispose()` disposes it (its GPU buffer), as three's does the instance matrix.
 * Moving an instance between slots moves its fade too; set `needsUpdate` after writing.
 * @param mesh the instanced mesh
 * @returns the attribute, `maxInstances` (the mesh's capacity) long
 * @example
 * ```ts
 * import * as THREE from 'three/webgpu';
 * import { createLodFadeAttribute, enableLodDither, LOD_FADE_OPAQUE } from 'aekasha/lod';
 *
 * // A custom LodTarget's level mesh: each instance dithered by its own fade
 * const mesh = new THREE.InstancedMesh(geometry, material, 1000);
 * const fades = createLodFadeAttribute(mesh);
 * enableLodDither(material);
 *
 * // In the target's setFade: the incoming copy at `progress`, the outgoing one at `progress - 1`
 * fades.setX(incomingSlot, progress >= 1 ? LOD_FADE_OPAQUE : progress);
 * fades.needsUpdate = true;
 * ```
 */
export const createLodFadeAttribute = (mesh: THREE.InstancedMesh) => {
  const existing = fadeAttributes.get(mesh);
  if (existing) return existing;
  // The opaque one a shared build already bound becomes the mesh's own: no rebinding
  const attribute = opaqueFadeAttributes.get(mesh) ?? createOpaqueFadeAttribute(mesh);
  opaqueFadeAttributes.delete(mesh);
  attribute.setUsage(THREE.DynamicDrawUsage);
  fadeAttributes.set(mesh, attribute);
  return attribute;
};

const createOpaqueFadeAttribute = (mesh: THREE.InstancedMesh) => {
  const attribute = new THREE.InstancedBufferAttribute(
    new Float32Array(mesh.instanceMatrix.count).fill(LOD_FADE_OPAQUE),
    1
  );
  attribute.name = 'lodFade';
  // Freed with the mesh, as three frees its instance matrix: three binds the attribute through a
  // node, and a render object's dispose frees only what its build bound (another mesh's, on a
  // shared build), so a deleted mesh's buffer stayed in three's totals until collected (p353
  // Phase 5: streamed far groups)
  mesh.addEventListener('dispose', () => attribute.dispose());
  return attribute;
};

/** The fade attribute a dithered InstancedMesh binds: its own, else an opaque one made once. */
const getDrawnFadeAttribute = (mesh: THREE.InstancedMesh) => {
  let attribute = fadeAttributes.get(mesh) ?? opaqueFadeAttributes.get(mesh);
  if (!attribute) {
    attribute = createOpaqueFadeAttribute(mesh);
    opaqueFadeAttributes.set(mesh, attribute);
  }
  return attribute;
};

/** The mesh's per-instance fade attribute, undefined without one. */
export const getLodFadeAttribute = (mesh: THREE.Object3D) => fadeAttributes.get(mesh);

/**
 * Sets the fade an object without a per-instance fade is drawn with (eg. a plain LOD mesh or its
 * outgoing clone). {@link LOD_FADE_OPAQUE} (or `clearLodObjectFade`) shows it whole.
 * @param object the drawn mesh
 * @param fade the signed fade (see the top of `LodFade.ts`)
 */
export const setLodObjectFade = (object: THREE.Object3D, fade: number) => {
  objectFades.set(object, fade);
};

/** Forgets an object's fade: it's drawn whole again. */
export const clearLodObjectFade = (object: THREE.Object3D) => {
  objectFades.delete(object);
};

/**
 * Sets an object's visibility fade, the second fade every dither-enabled material reads (p353
 * Phase 5 D5: streamed content dithering in and out), ANDed with its LOD fade: a LOD cross-fade
 * under it stays split right. Set it on each drawn mesh of an entity (a LOD fade copy reads its
 * mesh's). {@link LOD_FADE_OPAQUE} (or `clearObjectVisibilityFade`) shows it whole.
 * @internal
 * @param object the drawn mesh
 * @param fade the signed fade (see the top of `LodFade.ts`): 0 → 1 fading in, -1 → 0 fading out
 */
export const setObjectVisibilityFade = (object: THREE.Object3D, fade: number) => {
  visibilityFades.set(object, fade);
};

/**
 * The visibility fade an object draws with: its own, a LOD fade copy's mesh's, else
 * {@link LOD_FADE_OPAQUE} (the tests' and tools').
 * @internal
 */
export const getObjectVisibilityFade = (object: THREE.Object3D) => getVisibilityFade(object);

/**
 * Forgets an object's visibility fade: it's drawn whole again.
 * @internal
 */
export const clearObjectVisibilityFade = (object: THREE.Object3D) => {
  visibilityFades.delete(object);
};

/**
 * Gives `object` a LOD fade node of its own: its dither-enabled materials dither it by `fade`, a
 * float node holding the drawn copy's signed fade (see the top of `LodFade.ts`), in place of its
 * per-object LOD fade; its visibility fade still applies. For an object whose draws carry their
 * fade in their own data (an instance set's draws, `features/instancing/`: a visible list entry's,
 * through the vertex stage). Keyed on the object, so the shadow pass, which builds it with its own
 * material, reads it too. Set it before the object's first build: every object sharing a build
 * must read the same node (an instance set's draws of one material do).
 * @internal
 * @param fade a float node, evaluated in the fragment stage (a varying for a per-vertex value)
 */
export const setObjectLodFadeNode = (object: THREE.Object3D, fade: THREE.Node<'float'>) => {
  objectFadeNodes.set(object, fade);
};

/** An InstancedMesh's per-instance fade, bound per drawn object, so its build is shared. */
class LodFadeAttributeNode extends THREE.ReferenceAttributeNode {
  static get type() {
    return 'LodFadeAttributeNode';
  }

  constructor() {
    super('lodFade', 'float');
  }

  getAttribute(object: THREE.Object3D) {
    return getDrawnFadeAttribute(object as THREE.InstancedMesh);
  }
}

const instanceFade = new LodFadeAttributeNode() as unknown as THREE.Node<'float'>;

/** The mask every dither-enabled material shares: the drawn object's fade through lodDither. */
class LodFadeMaskNode extends THREE.Node {
  static get type() {
    return 'LodFadeMaskNode';
  }

  constructor() {
    super('bool');
  }

  setup(builder: THREE.NodeBuilder) {
    // The source is picked per build: an object with a fade node of its own (an instance set's
    // draws) shares builds only with objects of the same node (its material's position fetch is
    // its set's), in the shadow pass too. An InstancedMesh's build key differs from a plain mesh's (its
    // instance data), so each kind keeps the path it was built with. An InstancedMesh takes both
    // LOD fades: a pool level's per instance, an InstancedMesh entity's (its fade copy, its cull
    // fade) per object; the other one stays opaque, which lets every pixel through. Every object
    // takes its visibility fade too, on the same noise (so the fades compose exactly).
    const noise = interleavedGradientNoise();
    const ownFade = builder.object ? objectFadeNodes.get(builder.object) : undefined;
    if (ownFade) {
      return ditherShows(noise, ownFade).and(ditherShows(noise, objectFadePair.y));
    }
    const objectMask = ditherShows(noise, objectFadePair.x).and(
      ditherShows(noise, objectFadePair.y)
    );
    const isInstanced = (builder.object as THREE.InstancedMesh | null)?.isInstancedMesh === true;
    if (!isInstanced) return objectMask;
    return ditherShows(noise, instanceFade).and(objectMask);
  }
}

const lodFadeMask = new LodFadeMaskNode() as unknown as THREE.Node<'bool'>;

// --- MATERIALS ---

const ditherMaterials = new WeakSet<THREE.Material>();

/**
 * Lets `material` take part in LOD cross-fades: every object drawn with it is dithered by its own
 * fade (a pool instance's, or the object's), and drawn whole while it isn't fading. Idempotent; an
 * existing `maskNode` is kept (both must pass). Works on classic materials too (three converts
 * them with their `maskNode`). Instanced LOD pools call it on their level materials.
 *
 * The cost while nothing fades: one discard test per pixel, plus, for plain meshes, one float
 * uniform written per draw.
 * @param material one material, or a per-group array
 * @returns whether a material changed (its shaders are rebuilt at its next draw or compile)
 * @example
 * ```ts
 * import { enableLodDither } from 'aekasha/lod';
 *
 * // A material shared by a custom LodTarget's level meshes: they dither in and out
 * enableLodDither(leavesMaterial);
 * ```
 */
export const enableLodDither = (material: THREE.Material | THREE.Material[]) => {
  let isChanged = false;
  for (const m of Array.isArray(material) ? material : [material]) {
    if (ditherMaterials.has(m)) continue;
    ditherMaterials.add(m);
    const maskable = m as MaskableMaterial;
    maskable.maskNode = maskable.maskNode
      ? bool(maskable.maskNode as THREE.Node<'bool'>).and(lodFadeMask)
      : lodFadeMask;
    m.needsUpdate = true;
    isChanged = true;
  }
  return isChanged;
};

/** Whether {@link enableLodDither} was called on `material`. */
export const isLodDitherEnabled = (material: THREE.Material) => ditherMaterials.has(material);
