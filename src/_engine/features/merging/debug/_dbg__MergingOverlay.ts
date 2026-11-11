// The merge groups' highlight (docs/plans/p373_merge-debug-and-member-editing.md D3): a wire box
// around each member of the highlighted groups, in the group's colour, so a merged mesh shows what
// it's made of. A box is the member's local bounding box oriented by the matrix it's drawn with
// (`_bakedMatrix` once built: where the group draws it; its own world matrix while it waits). A
// line has one colour, so each palette colour has its own line, refilled every frame while
// something is highlighted, like the LOD overlay (`features/lod/debug/_dbg__LodOverlay.ts`).
// Default world only.
//
// "In view" is the active camera's frustum (the debug camera's too: it's what the image shows).
// Each colour holds MAX_BOXES_PER_COLOR boxes; the rest are counted, not drawn (the tab says so).
import * as THREE from 'three/webgpu';
import { markDebugHelper } from '../../../debug/Profiler';
import { getActiveCamera } from '../../../kernel/camera/Camera';
import { ECSWorld, getECSWorld } from '../../../kernel/ecs/ECS';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
import { APP_RENDER_SYNC_ORDER, ECSSystemStage } from '../../../kernel/loop/SystemStages';
import { registerOnAllSceneExits } from '../../../kernel/scene/Scene';
import { hashStringFNV1a } from '../../../utils/Hash';
import { BOX_EDGE_SEGMENT_COUNT, writeBoxEdges } from '../../lines/LineBuilders';
import type { LineObject } from '../../lines/LineObject';
import { createLines, isLinesInstalledFor } from '../../lines/Lines';
import type { LineWriter } from '../../lines/LineWriter';
import { getGroupMesh } from '../MergeState';

/** The groups' colours: red, orange, yellow, green, cyan, blue, violet, pink. */
export const MERGE_OVERLAY_COLORS = [
  0xff4d4d, 0xffa31a, 0xffe03d, 0x4ddb4d, 0x33d6d6, 0x4d8bff, 0xb366ff, 0xff66cc,
];

/** Boxes per colour's line: past it a box is counted, not drawn. */
export const MAX_BOXES_PER_COLOR = 1024;

/** Created on the first highlight, one per colour (index-aligned with MERGE_OVERLAY_COLORS). */
const lines: LineObject[] = [];
/** Each line's writer for the frame (index-aligned with `lines`). */
const writers: LineWriter[] = [];
/** The boxes written per colour in the current fill. */
const boxCounts = new Int32Array(MERGE_OVERLAY_COLORS.length);
let isSystemRegistered = false;

let isAllHighlighted = false;
/** The groups highlighted by id (a rebuild or an `AUTO` group made again keeps it). */
const highlightedIds = new Set<string>();
/** The last fill's boxes: drawn, and over their colour's cap. */
let drawnBoxes = 0;
let skippedBoxes = 0;

const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();
const _sphere = new THREE.Sphere();
const _box = new THREE.Box3();
const _center = new THREE.Vector3();
const _size = new THREE.Vector3();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();

/** A group's colour: its index in MERGE_OVERLAY_COLORS, from its id (the same on every visit). */
export const getMergeGroupColorIndex = (groupId: string) =>
  hashStringFNV1a(groupId) % MERGE_OVERLAY_COLORS.length;

/** Whether every group is highlighted (the summary pane's checkbox). */
export const isMergeHighlightAll = () => isAllHighlighted;

/** Whether a group's members are outlined: every group's are, or its own are. */
export const isMergeGroupHighlighted = (groupId: string) =>
  isAllHighlighted || highlightedIds.has(groupId);

/** The last fill's boxes: those drawn, and those over their colour's cap (not drawn). */
export const getMergeOverlayCounts = () => ({ drawn: drawnBoxes, skipped: skippedBoxes });

const isAnythingHighlighted = () => isAllHighlighted || highlightedIds.size > 0;

/**
 * Writes a box per member of the world's highlighted groups into the writer of its group's
 * colour (`targets`, index-aligned with MERGE_OVERLAY_COLORS), skipping those outside `frustum`
 * (none skipped without one) and those over their colour's cap. Allocation-free.
 */
export const writeMergeOverlayBoxes = (
  world: ECSWorld,
  frustum: THREE.Frustum | null,
  targets: LineWriter[]
) => {
  boxCounts.fill(0);
  drawnBoxes = 0;
  skippedBoxes = 0;
  if (!isAnythingHighlighted()) return;
  for (const [groupEntityId, group] of world.getStorage(ComponentType.MERGE_GROUP)) {
    if (!isMergeGroupHighlighted(group.id) || world.isDisabled(groupEntityId)) continue;
    // A built group without waiting members is inside its mesh's bounds (they only grow)
    const mesh = getGroupMesh(groupEntityId, world);
    if (frustum && mesh?.parent && group.partIndex.size === group.members.length) {
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      _sphere.copy(mesh.geometry.boundingSphere!).applyMatrix4(mesh.matrixWorld);
      if (!frustum.intersectsSphere(_sphere)) continue;
    }
    const colorIndex = getMergeGroupColorIndex(group.id);
    const writer = targets[colorIndex];
    for (const entityId of group.members) {
      const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
      if (member?.groupEntityId !== groupEntityId || world.isDisabled(entityId)) continue;
      const geometry = (
        world.getComponent(entityId, ComponentType.OBJECT3D)?.value as THREE.Mesh | undefined
      )?.geometry;
      if (!geometry) continue;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const local = geometry.boundingBox!;
      const matrix =
        member.partIndex !== -1
          ? member._bakedMatrix
          : world.getComponent(entityId, ComponentType.OBJECT3D)!.value.matrixWorld;
      if (frustum && !frustum.intersectsBox(_box.copy(local).applyMatrix4(matrix))) continue;
      if (boxCounts[colorIndex] >= MAX_BOXES_PER_COLOR) {
        skippedBoxes++;
        continue;
      }
      boxCounts[colorIndex]++;
      drawnBoxes++;
      local.getCenter(_center).applyMatrix4(matrix);
      matrix.decompose(_position, _quaternion, _scale);
      writeBoxEdges(writer, _center, local.getSize(_size).multiply(_scale), _quaternion);
    }
  }
};

/** Refills the lines from the default world: the system's frame, and a toggle's at once. */
const fillMergeOverlay = () => {
  if (lines.length === 0) return;
  for (let i = 0; i < lines.length; i++) writers[i] = lines[i].beginWrite();
  const camera = getActiveCamera();
  let frustum: THREE.Frustum | null = null;
  if (camera) {
    camera.updateMatrixWorld();
    frustum = _frustum.setFromProjectionMatrix(
      _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    );
  }
  writeMergeOverlayBoxes(getECSWorld(), frustum, writers);
  for (let i = 0; i < lines.length; i++) {
    lines[i].endWrite();
    // An empty line would still draw (0 vertices, a WebGPU warning)
    lines[i].setVisible(writers[i].segmentCount > 0);
  }
};

const mergeOverlaySystem = (world: ECSWorld) => {
  if (!isAnythingHighlighted() || world !== getECSWorld()) return;
  fillMergeOverlay();
};

const createColorLine = (index: number) => {
  const line = createLines({
    id: `MERGE_DEBUG_OVERLAY_${index}`,
    capacity: MAX_BOXES_PER_COLOR * BOX_EDGE_SEGMENT_COUNT,
    growth: 'FIXED',
    color: MERGE_OVERLAY_COLORS[index],
    // 12 segments per box; instanced quads would cost far more than 1px lines
    backend: 'THIN',
    // Created once and outlives scenes
    persistent: true,
  });
  markDebugHelper(line.object3D);
  return line;
};

/** The lines and the system, made on the first highlight; false without `lines()`. */
const ensureOverlay = () => {
  // Drawn as lines: off without the feature (one log line)
  if (!isLinesInstalledFor('merge group overlay')) return false;
  if (lines.length === 0) {
    for (let i = 0; i < MERGE_OVERLAY_COLORS.length; i++) lines.push(createColorLine(i));
  }
  if (!isSystemRegistered) {
    isSystemRegistered = true;
    // After the camera's final pose and culling, before the render (LATE_MAIN would be a frame
    // late). Like the LOD overlay, it stands still while the app loop is paused.
    ECSWorld.registerPlugin((w) => {
      w.addSystem(
        ECSSystemStage.APP_RENDER_SYNC,
        'mergeOverlaySystem',
        mergeOverlaySystem,
        APP_RENDER_SYNC_ORDER.LOD_SELECTION
      );
    });
  }
  return true;
};

/**
 * Outlines every group's members, or stops (the groups highlighted by id stay). Without the
 * `lines()` feature it logs once and stays off.
 * @returns whether every group is highlighted now
 */
export const setMergeHighlightAll = (isOn: boolean) => {
  if (isOn && !ensureOverlay()) return false;
  isAllHighlighted = isOn;
  // Filled now too: with the app loop paused, the system doesn't run
  fillMergeOverlay();
  return isAllHighlighted;
};

/**
 * Outlines a group's members, or stops. Turning one off while every group is highlighted turns
 * "all" off and keeps the world's other groups highlighted. Without the `lines()` feature it logs
 * once and stays off.
 * @returns whether the group is highlighted now
 */
export const setMergeGroupHighlighted = (groupId: string, isOn: boolean, world = getECSWorld()) => {
  if (isOn) {
    if (!ensureOverlay()) return false;
    highlightedIds.add(groupId);
  } else {
    if (isAllHighlighted) {
      isAllHighlighted = false;
      for (const [, group] of world.getStorage(ComponentType.MERGE_GROUP)) {
        highlightedIds.add(group.id);
      }
    }
    highlightedIds.delete(groupId);
  }
  fillMergeOverlay();
  return isMergeGroupHighlighted(groupId);
};

/** A scene exit: the groups highlighted by id go (an id can mean another group on the next
 * visit); "all" stays. */
const onSceneExit = () => {
  highlightedIds.clear();
  if (isAnythingHighlighted()) return;
  for (const line of lines) line.setVisible(false);
  drawnBoxes = 0;
  skippedBoxes = 0;
};

registerOnAllSceneExits('mergingOverlay', onSceneExit);
