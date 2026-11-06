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
// reads the fade of the object being drawn: an InstancedMesh's per-instance `lodFade` attribute
// (createLodFadeAttribute), else a per-object value (setLodObjectFade). Both bind per object at
// draw time, so meshes on one material share one build: three r187 shares a build between
// InstancedMeshes with the same material and attributes and looks it up before any setup runs
// (#35007), and binds each one's attributes through `ReferenceAttributeNode.getAttribute(object)`.
// An InstancedMesh without a fade of its own binds an opaque one (`getDrawnFadeAttribute`), so
// the shared build always finds an attribute, and it reads the per-object uniform too (an
// InstancedMesh entity fades as a whole; p058 D2,
// docs/plans/_DONE_p058_shared-instanced-builds-for-lod-fades-and-impostors.md). Plain meshes take
// the uniform alone. The shadow pass reads `maskNode` too: shadows dither with the
// same split.
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

/**
 * Whether a pixel of a copy drawn with the signed fade `fade` shows (a `bool` node), for a
 * material's `maskNode`. See the top of `LodFade.ts` for the encoding. Custom node materials that
 * build their own mask can combine it; `enableLodDither` does it for any material.
 * @param fade a float node: `t` for the incoming copy, `-(1 - t)` for the outgoing one
 */
export const lodDither = (fade: THREE.Node) => {
  const f = float(fade as THREE.Node<'float'>);
  const noise = interleavedGradientNoise();
  return select(f.greaterThanEqual(0), noise, noise.oneMinus()).lessThanEqual(f.abs());
};

// --- WHERE A DRAWN OBJECT'S FADE COMES FROM ---

const fadeAttributes = new WeakMap<THREE.Object3D, THREE.InstancedBufferAttribute>();
/** The fade an InstancedMesh without `createLodFadeAttribute` draws with: every instance whole. */
const opaqueFadeAttributes = new WeakMap<THREE.Object3D, THREE.InstancedBufferAttribute>();
const objectFades = new WeakMap<THREE.Object3D, number>();

/** The per-object fade, written before each draw of an object (three's object uniform group). */
const objectFade = uniform(LOD_FADE_OPAQUE).onObjectUpdate(
  ({ object }) => (object && objectFades.get(object)) ?? LOD_FADE_OPAQUE
);

/**
 * Gives `mesh` a per-instance fade (`lodFade`), every instance at {@link LOD_FADE_OPAQUE}: its
 * dither-enabled materials then read each instance's own fade. It can be called after the mesh
 * was first drawn: the fade binds per drawn object, and the mesh's builds are shared with the
 * other InstancedMeshes on its materials. The attribute isn't on the geometry, which is shared, and
 * three frees its GPU buffer with the mesh's render objects, like the instance matrix.
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
    // An InstancedMesh's build key differs from a plain mesh's (its instance data), so each kind
    // keeps the path it was built with. An InstancedMesh takes both fades: a pool level's per
    // instance, an InstancedMesh entity's (its fade copy, its cull fade) per object; the other one
    // stays opaque, which lets every pixel through.
    const isInstanced = (builder.object as THREE.InstancedMesh | null)?.isInstancedMesh === true;
    if (!isInstanced) return lodDither(objectFade);
    return lodDither(instanceFade).and(lodDither(objectFade));
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
