// The member window's pose fields (docs/plans/_DONE_p373_merge-debug-and-member-editing.md D2, D4): the
// position, rotation (degrees) and scale of a merge member's `TRANSFORM`, editable through an edit
// session. The first write of a gesture opens it (the member drawn on its own, its range
// collapsed), every write moves the member (`setTransform`, so a body follows; the scale on the
// `TRANSFORM`), and the gesture's end (the field's `last: true`) or the window's close ends it: its
// range written once in place, no rebuild, and one undo entry with the poses before and after.
// A body's colliders don't scale, so a member with one has its scale read-only.
import * as THREE from 'three/webgpu';
import { updateDebuggerTab } from '../../../debug/DebuggerGUI';
import type { ECSWorld } from '../../../kernel/ecs/ECS';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
import type { PropertyGridItem } from '../../../ui/forms/PropertyGridItems';
import type { FieldChange } from '../../../ui/forms/Field';
import { beginMergeMemberEdit, endMergeMemberEdit, isMergeMemberInEdit } from '../MergeMemberEdit';
import { MERGING_TAB_ID } from './_dbg__MergingInfo';
import { recordMergeMemberTransform, type MergeMemberPose } from './_dbg__MergingUndo';

type Vec3 = { x: number; y: number; z: number };

/** A pose as an undo entry's plain JSON. */
const toPose = (position: Vec3, quaternion: THREE.Quaternion, scale: Vec3): MergeMemberPose => ({
  position: [position.x, position.y, position.z],
  quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
  scale: [scale.x, scale.y, scale.z],
});

const isSamePose = (a: MergeMemberPose, b: MergeMemberPose) =>
  (['position', 'quaternion', 'scale'] as const).every((key) =>
    a[key].every((value, i) => value === b[key][i])
  );

/** Quaternions within float noise (a typed store keeps 32-bit floats). */
const isNearQuaternion = (a: THREE.Quaternion, b: THREE.Quaternion) =>
  Math.abs(a.x - b.x) < 1e-6 &&
  Math.abs(a.y - b.y) < 1e-6 &&
  Math.abs(a.z - b.z) < 1e-6 &&
  Math.abs(a.w - b.w) < 1e-6;

/** What the window's pose fields and its close share. */
export type MergeMemberPoseItems = {
  items: PropertyGridItem[];
  /** The window's close: ends a session a gesture left open. */
  onRemove: () => void;
};

/**
 * The member window's position, rotation and scale fields, each moving the member through an edit
 * session that its gesture's end (or `onRemove`) ends and records for undo.
 */
export const getMergeMemberPoseItems = (
  entityId: number,
  world: ECSWorld
): MergeMemberPoseItems => {
  const getTransform = () => world.getComponent(entityId, ComponentType.TRANSFORM);
  const getMember = () => world.getComponent(entityId, ComponentType.MERGE_MEMBER);
  const isEditable = () => world.isAlive(entityId) && Boolean(getMember());
  const hasBody = () => world.hasComponent(entityId, ComponentType.BODY_STATIC);

  /** The rotation shown: kept while the quaternion is the one it made, so typed angles stay (an
   * angle past 90° on the middle axis reads back as another triple). */
  const shownEuler = new THREE.Euler();
  const shownFor = new THREE.Quaternion(NaN, NaN, NaN, NaN);
  const readEuler = () => {
    const quaternion = getTransform()?.quaternion;
    if (quaternion && !isNearQuaternion(quaternion, shownFor)) {
      shownEuler.setFromQuaternion(quaternion);
      shownFor.copy(quaternion);
    }
    return shownEuler;
  };

  /** A session open for this gesture (the first write opens it). */
  const ensureSession = () => {
    if (!isMergeMemberInEdit(entityId, world)) beginMergeMemberEdit(entityId, world);
  };

  /** Ends the open session and records the move (nothing when the pose didn't change). */
  const finish = () => {
    const member = getMember();
    const begin = member?._editPose;
    if (!member || !begin) return;
    endMergeMemberEdit(entityId, world);
    const transform = getTransform();
    if (transform) {
      const prev = toPose(begin.position, begin.quaternion, begin.scale);
      const next = toPose(transform.position, transform.quaternion, transform.scale);
      if (!isSamePose(prev, next)) recordMergeMemberTransform(entityId, member.groupId, prev, next);
    }
    // The tab's in-place update count
    updateDebuggerTab(MERGING_TAB_ID);
  };

  const onChange = (_value: unknown, e: FieldChange<unknown>) => {
    if (e.last) finish();
  };
  const disabled = () => !isEditable();

  const items: PropertyGridItem[] = [
    {
      label: 'Position',
      get: () => getTransform()?.position ?? { x: 0, y: 0, z: 0 },
      set: (value) => {
        if (!isEditable()) return;
        ensureSession();
        world.setTransform(entityId, { pos: value as Vec3 });
      },
      onChange,
      disabled,
    },
    {
      label: 'Rotation',
      kind: 'rotation',
      get: readEuler,
      set: (value) => {
        if (!isEditable()) return;
        ensureSession();
        const { x, y, z } = value as Vec3;
        shownEuler.set(x, y, z);
        shownFor.setFromEuler(shownEuler);
        world.setTransform(entityId, { rot: shownFor });
      },
      onChange,
      disabled,
    },
    {
      label: 'Scale',
      get: () => getTransform()?.scale ?? { x: 1, y: 1, z: 1 },
      set: (value) => {
        const transform = getTransform();
        if (!isEditable() || hasBody() || !transform) return;
        ensureSession();
        const { x, y, z } = value as Vec3;
        transform.scale.set(x, y, z);
        transform.setDirty();
        world.commitTransform(entityId, transform);
      },
      onChange,
      disabled: () => disabled() || hasBody(),
      hint: hasBody() ? 'Read-only: its physics body’s colliders don’t scale.' : undefined,
    },
  ];
  return { items, onRemove: finish };
};
