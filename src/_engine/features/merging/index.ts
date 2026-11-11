export {
  addToMergeGroup,
  createMergeGroup,
  dissolveMergeGroup,
  getMergeGroupOf,
  rebuildMergeGroup,
  removeFromMergeGroup,
  updateMergeMember,
} from './MergeGroups';
export type { CreateMergeGroupOptions } from './MergeGroups';
export {
  beginMergeMemberEdit,
  cancelMergeMemberEdit,
  endMergeMemberEdit,
  getMergeMemberAtFace,
  isMergeMemberInEdit,
} from './MergeMemberEdit';
export type {
  MergeGroupData,
  MergeGroupMode,
  MergeGroupSettings,
  MergeMemberData,
  MergeMemberEditPose,
  MeshMergeDef,
  MeshMergeOptions,
  SceneAutoMergeEntry,
  SceneMergeGroupEntry,
} from './MergeTypes';
export type {
  MergeMaterialEntry,
  MergeMaterialSlotInfo,
  SceneMergeMaterial,
} from './MergeMaterialSchema';
export { createMergeMaterialAsync } from './MergeMaterialLoad';
export { merging } from './MergingFeature';
