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
  MergeGroupSettings,
  MergeMemberData,
  MergeMemberEditPose,
  MeshMergeDef,
  MeshMergeOptions,
  SceneAutoMergeEntry,
  SceneMergeGroupEntry,
} from './MergeTypes';
export { merging } from './MergingFeature';
