import * as THREE from 'three/webgpu';
import type { LodResolvedLevel, LodTarget } from '../../features/lod/LodTypes';
import type { ECSWorld } from './ECS';
import type { ComponentType } from './ECSCoreComponents';

// The LOD seams in the kernel, so a feature reaches the LOD selection without importing `lod()`:
// - The LOD targets (p607 D5): a registry the LOD system reads, so a feature with entities that
//   aren't plain meshes (instancing's LOD pools) registers its target. A target registered without
//   `lod()` is never read.
// - The frame inputs (p354 D3): what the selection measured a frame with (the camera's terms, the
//   global settings, the debug options), written once a frame by `lod()`'s `lodSelectionSystem`,
//   read by LOD content that has no `LOD` entity (instancing's instance sets). Without `lod()`
//   they're never written: their `frame` stays -1.
// - The debug sources (p354 D11): LOD content without entities, as the LOD tab lists it. A feature
//   registers one from its `onDebug` (instancing's sets); only debug code calls either function,
//   so a production build drops them.
// - The mesh draw delegate (p375 Phase 2): what draws a plain mesh's levels while the mesh itself
//   isn't drawn (merging's batched members, drawn by their batch). `lod()` keeps the levels, their
//   refs and the selection, and asks the delegate on every apply, cull and fade step.

/**
 * A registered LOD target, with the component type it's for.
 * @internal
 */
export type LodTargetEntry = { componentType: ComponentType; target: LodTarget };

const lodTargets: LodTargetEntry[] = [];

/**
 * Lets `LOD` work on entities with `componentType` that have no plain mesh (eg. the
 * instanced LOD pool). See {@link LodTarget}. Registering a type again replaces its target.
 */
export const registerLodTarget = (componentType: ComponentType, target: LodTarget) => {
  const index = lodTargets.findIndex((e) => e.componentType === componentType);
  if (index >= 0) lodTargets[index].target = target;
  else lodTargets.push({ componentType, target });
};

/**
 * The registered LOD targets, in registration order (the first an entity has wins).
 * @internal
 */
export const getLodTargets = (): readonly LodTargetEntry[] => lodTargets;

/**
 * What draws a plain mesh's LOD levels while the mesh itself isn't drawn (p375 Phase 2: a batched
 * merge member, drawn by its group's batch). `lod()` resolves the levels, holds their refs,
 * selects, and sets each applied level on the mesh as for any plain mesh (so a mesh drawn on its
 * own again shows the right one); for an entity the delegate draws, it calls the delegate in place
 * of its own fade copies and per-object fades. Asked per call, so an entity can start or stop
 * being drawn by it between two calls: a fade it started then goes on without it (the delegate
 * drops what it drew for the entity when it stops drawing it).
 * @internal
 */
export type LodMeshDrawDelegate = {
  /** Whether it draws the entity's levels now. */
  isDrawing: (entityId: number, world: ECSWorld) => boolean;
  /** The mesh shows `level` now (set on the mesh already). With `fade`, what it drew for the
   * entity until now stays drawn as the outgoing copy, and `level` starts hidden. */
  applyLevel: (entityId: number, world: ECSWorld, level: LodResolvedLevel, fade: boolean) => void;
  /** `TAG_LOD_CULLED` was added (true) or is being removed (false: the remove hook runs before
   * it's gone). Without `fade` the entity hides or shows at once; with it, hiding keeps it drawn as
   * the outgoing copy until the fade ends, and showing starts it hidden. */
  setCulled: (entityId: number, world: ECSWorld, isCulled: boolean, fade: boolean) => void;
  /** Draws its running fade at `progress` (0 → 1): the incoming copy at the signed fade
   * `progress`, the outgoing one at `progress - 1` (`kernel/render/LodFade.ts`). 1 ends it: the
   * outgoing copy goes, and an entity faded out to LOD culled is hidden. Also called for a fade it
   * didn't start (the entity came to it mid-fade, whose copies `lod()` ends itself) and with 1 by
   * the `LOD`'s delete hook: without a fade of its own it has nothing to draw. */
  setFade: (entityId: number, world: ECSWorld, progress: number) => void;
};

let meshDrawDelegate: LodMeshDrawDelegate | null = null;

/**
 * Sets the mesh draw delegate (`merging()`'s install), or clears it with `null`.
 * @internal
 */
export const setLodMeshDrawDelegate = (delegate: LodMeshDrawDelegate | null) => {
  meshDrawDelegate = delegate;
};

/**
 * The mesh draw delegate when it draws the entity now, else undefined (the LOD's plain-mesh
 * apply, cull and fades).
 * @internal
 */
export const getLodMeshDrawDelegateFor = (entityId: number, world: ECSWorld) =>
  meshDrawDelegate?.isDrawing(entityId, world) ? meshDrawDelegate : undefined;

/**
 * A frame's LOD selection inputs (p354 D3): what `lodSelectionSystem` measures and selects with,
 * for LOD content without a `LOD` entity, which applies the same rules (`utils/LodRules.ts`).
 * @internal
 */
export type LodFrameInputs = {
  /** The main loop frame they were written in (`getMainLoopFrame`); -1 before the first write,
   * and for good without `lod()`. Written only while the app loop plays: a paused frame keeps the
   * last ones, and the levels and fades hold, as the ECS path's do. */
  frame: number;
  /** The selection camera (`getLodSelectionCamera`: the main camera, or the active one with the
   * `useActiveCamera` debug option) was found and measurable. Without it nothing is selected. */
  hasCamera: boolean;
  /** The selection camera's world position. */
  cameraPosition: THREE.Vector3;
  /** A sphere's screen size is its world radius × `k` / its distance (perspective), or × `k`
   * (orthographic); `k` includes the global bias. */
  k: number;
  isOrtho: boolean;
  /** The global bias (`setLodBias`), already in `k`. */
  bias: number;
  /** The global fade seconds (`setLodFadeSeconds`), for content whose definition has none. */
  fadeSeconds: number;
  /** The fades' step this frame, in seconds: the frame's delta × the `fadeTimeScale` debug
   * option (0 holds the fades). */
  fadeStep: number;
  /** The `freeze` debug option: the levels hold (the fades still run). */
  isFrozen: boolean;
  /** The `forceLevel` debug option, -1 when off: every instance at that level (the last one past
   * it), none culled. */
  forceLevel: number;
};

const lodFrameInputs: LodFrameInputs = {
  frame: -1,
  hasCamera: false,
  cameraPosition: new THREE.Vector3(),
  k: 0,
  isOrtho: false,
  bias: 1,
  fadeSeconds: 0,
  fadeStep: 0,
  isFrozen: false,
  forceLevel: -1,
};

/**
 * Sets the frame's LOD selection inputs, copied (`lodSelectionSystem`'s, once a frame).
 * @internal
 */
export const setLodFrameInputs = (inputs: Readonly<LodFrameInputs>) => {
  const to = lodFrameInputs;
  to.frame = inputs.frame;
  to.hasCamera = inputs.hasCamera;
  to.cameraPosition.copy(inputs.cameraPosition);
  to.k = inputs.k;
  to.isOrtho = inputs.isOrtho;
  to.bias = inputs.bias;
  to.fadeSeconds = inputs.fadeSeconds;
  to.fadeStep = inputs.fadeStep;
  to.isFrozen = inputs.isFrozen;
  to.forceLevel = inputs.forceLevel;
};

/**
 * The last frame's LOD selection inputs (one object, rewritten in place: copy what must outlast
 * the frame). Its `frame` tells whether they're this frame's.
 * @internal
 */
export const getLodFrameInputs = (): Readonly<LodFrameInputs> => lodFrameInputs;

/**
 * LOD content without entities (an instance set), as the LOD tab lists it (p354 D11).
 * @internal
 */
export type LodContentDebugInfo = {
  /** What it is, for the tab (a set's owning entity's app id, or its entity id). */
  label: string;
  /** What draws it (a set's `backend`). */
  backend: string;
  /** Its levels: the tab's forced level options cover them. */
  levelCount: number;
  /** Its instances. */
  instanceCount: number;
  /** The cameras drawing it now (a set's slots): the tab's line count. */
  cameraCount: number;
  /** Its last debug readback, null before the first (and for a backend without one). */
  stats: LodContentDebugStats | null;
};

/**
 * What LOD content without entities drew and selected, as its last debug readback had it.
 * @internal
 */
export type LodContentDebugStats = {
  /** Per level: the copies the main camera's last dispatch drew (a fading instance's two in both
   * its levels). */
  drawn: number[];
  /** Per level: every instance's selected level (in view or not; a fading one in both). */
  selected: number[];
  /** Beyond the last level. */
  culled: number;
  /** Cross-fading. */
  fading: number;
  /** In view past a visible list's budget, every camera's: not drawn. */
  overflow: number;
  /** The triangles every camera's drawn copies make, as three's `info.render` counts every
   * render's (it doesn't count indirect draws). */
  triangles: number;
  /** Each camera drawing it (a set's slots, in slot order): its name and its drawn copies per
   * level. */
  cameras: { name: string; drawn: number[] }[];
};

/**
 * A debug option of a feature's LOD content, as a checkbox in the LOD tab's Instance sets folder
 * (eg. the instance sets' forced CPU backend).
 * @internal
 */
export type LodContentDebugToggle = {
  /** The checkbox's label. */
  readonly label: string;
  /** The option: an accessor the source defines, which the tab reads on its refresh and writes. */
  value: boolean;
};

/**
 * A feature's LOD content without entities, for the LOD tab: `getInfos` is read on the tab's
 * refresh, `toggles` when the tab builds.
 * @internal
 */
export type LodContentDebugSource = {
  getInfos: () => readonly LodContentDebugInfo[];
  /** Its debug options, shown above its content. */
  toggles?: readonly LodContentDebugToggle[];
};

const lodContentDebugSources: LodContentDebugSource[] = [];

/**
 * Lists a feature's LOD content without entities in the LOD tab (a feature's `onDebug`).
 * @internal
 * @returns the remover
 */
export const registerLodContentDebugSource = (source: LodContentDebugSource) => {
  lodContentDebugSources.push(source);
  return () => {
    const index = lodContentDebugSources.indexOf(source);
    if (index >= 0) lodContentDebugSources.splice(index, 1);
  };
};

/**
 * The registered debug sources of LOD content without entities, in registration order.
 * @internal
 */
export const getLodContentDebugSources = (): readonly LodContentDebugSource[] =>
  lodContentDebugSources;
