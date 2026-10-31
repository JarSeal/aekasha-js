// The ray tester windows' pane items (p806 D11: out of _dbg__RayTester.ts): the aim every kind
// has, each kind's params and the helper folder, bound to the ray's params through the pane
// builder's state paths.
import type { DebuggerPaneItem } from '../../../debug/DebuggerGUI';
import { setOriginFromCamera } from './_dbg__RayTesterFire';
import { togglePick } from './_dbg__RayTesterPick';
import {
  ALL_INTERACTION_GROUPS,
  persistTesterState,
  testerResults,
  type AimedRay,
  type PhysicsRayParams,
  type PhysicsRayQuery,
  type RayAimMode,
  type RayTesterDepthTest,
  type RayTesterHelperParams,
  type RayTesterKind,
  type ThreeRayParams,
  type ThreeRayTargetType,
} from './_dbg__RayTesterState';

const AIM_MODE_OPTIONS: { value: RayAimMode; text: string }[] = [
  { value: 'DIRECTION', text: 'Origin + direction' },
  { value: 'TARGET_POINT', text: 'Origin → target point' },
  { value: 'CAMERA_FORWARD', text: 'Active camera forward' },
];
const DEPTH_TEST_OPTIONS: { value: RayTesterDepthTest; text: string }[] = [
  { value: 'KIND', text: 'Tab setting' },
  { value: 'ON', text: 'On' },
  { value: 'OFF', text: 'Off' },
];
const THREE_TARGET_OPTIONS: { value: ThreeRayTargetType; text: string }[] = [
  { value: 'CURRENT_SCENE', text: 'Current scene' },
  { value: 'ENTITY', text: 'Entity (app id)' },
];
const PHYSICS_QUERY_OPTIONS: { value: PhysicsRayQuery; text: string }[] = [
  { value: 'CAST_RAY', text: 'castRay' },
  { value: 'CAST_RAY_AND_GET_NORMAL', text: 'castRayAndGetNormal' },
  { value: 'INTERSECTIONS_WITH_RAY', text: 'intersectionsWithRay' },
];

/** What a kind's items call back into its window: the grid's refresh and the fire. */
export type RayTesterItemsCtx = {
  refreshPane: () => void;
  fire: () => void;
};

/** Wraps every binding's onChange to call `persist` on committed changes (not drag ticks). */
export const persistOnCommit = <S extends object>(
  items: DebuggerPaneItem<S>[],
  persist: () => void
): DebuggerPaneItem<S>[] =>
  items.map((item) => {
    if (item.type === 'folder') return { ...item, content: persistOnCommit(item.content, persist) };
    if (item.type === 'button' || item.type === 'separator' || item.type === 'custom') return item;
    const { onChange } = item;
    return {
      ...item,
      onChange: (value, e) => {
        onChange?.(value, e);
        if (e.last) persist();
      },
    } as DebuggerPaneItem<S>;
  });

/** The aim bindings every kind has; a button's edit (a camera's origin, a pick) saves too. */
const aimItems = (
  kind: RayTesterKind,
  ray: AimedRay,
  { refreshPane }: RayTesterItemsCtx
): DebuggerPaneItem<AimedRay>[] => {
  const onEdited = () => {
    refreshPane();
    persistTesterState(kind);
  };
  return [
    { key: 'aim.mode', label: 'Aim', options: AIM_MODE_OPTIONS, onChange: refreshPane },
    { key: 'origin', label: 'Origin', hidden: () => ray.aim.mode === 'CAMERA_FORWARD' },
    {
      type: 'button',
      title: 'Set origin from active camera',
      hidden: () => ray.aim.mode === 'CAMERA_FORWARD',
      onClick: () => {
        if (setOriginFromCamera(ray)) onEdited();
      },
    },
    {
      type: 'button',
      title: 'Pick origin (click the scene)',
      hidden: () => ray.aim.mode === 'CAMERA_FORWARD',
      onClick: () => togglePick(kind, 'ORIGIN', ray, onEdited),
    },
    { key: 'aim.dir', label: 'Direction', hidden: () => ray.aim.mode !== 'DIRECTION' },
    {
      type: 'button',
      title: 'Aim at a picked point',
      hidden: () => ray.aim.mode !== 'DIRECTION',
      onClick: () => togglePick(kind, 'TARGET', ray, onEdited),
    },
    { key: 'aim.point', label: 'Target point', hidden: () => ray.aim.mode !== 'TARGET_POINT' },
    {
      type: 'button',
      title: 'Pick target point (click the scene)',
      hidden: () => ray.aim.mode !== 'TARGET_POINT',
      onClick: () => togglePick(kind, 'TARGET', ray, onEdited),
    },
  ];
};

const helperFolder = (): DebuggerPaneItem<{ helper: RayTesterHelperParams }> => ({
  type: 'folder',
  id: 'helper',
  title: 'Helper',
  expanded: false,
  content: [
    { key: 'helper.color', label: 'Color', kind: 'color' },
    { key: 'helper.inactiveColor', label: 'Inactive color', kind: 'color' },
    { key: 'helper.width', label: 'Width (px)', min: 1, max: 20, step: 0.5 },
    { key: 'helper.holdMs', label: 'Hold (ms)', min: 0, max: 10000, step: 50 },
    { key: 'helper.depthTest', label: 'Respect depth', options: DEPTH_TEST_OPTIONS },
  ],
});

/** The Three.js tester's items: Fire, the aim, the cast's range and target, the helper. */
export const getThreeRayItems = (
  ray: ThreeRayParams,
  ctx: RayTesterItemsCtx
): DebuggerPaneItem<ThreeRayParams>[] => [
  { type: 'button', title: 'Fire', onClick: ctx.fire },
  { type: 'separator' },
  ...aimItems('THREE', ray, ctx),
  { key: 'near', label: 'Near', min: 0, step: 0.1 },
  { key: 'far', label: 'Far', min: 0, step: 0.1 },
  { key: 'recursive', label: 'Recursive' },
  {
    key: 'target.type',
    label: 'Target',
    options: THREE_TARGET_OPTIONS,
    onChange: ctx.refreshPane,
  },
  { key: 'target.appId', label: 'Entity app id', hidden: () => ray.target.type !== 'ENTITY' },
  helperFolder(),
];

/** The physics tester's items: Fire (disabled while a fire is in flight), the query, the aim,
 * the cast's range, the filters, the helper. */
export const getPhysicsRayItems = (
  ray: PhysicsRayParams,
  ctx: RayTesterItemsCtx
): DebuggerPaneItem<PhysicsRayParams>[] => [
  {
    type: 'button',
    title: 'Fire',
    disabled: () => testerResults.isPhysicsFiring,
    onClick: ctx.fire,
  },
  { type: 'separator' },
  { key: 'query', label: 'Query', options: PHYSICS_QUERY_OPTIONS },
  ...aimItems('PHYSICS', ray, ctx),
  { key: 'maxToi', label: 'Max toi', min: 0, step: 0.1 },
  { key: 'solid', label: 'Solid' },
  {
    type: 'folder',
    id: 'filters',
    title: 'Filters',
    expanded: false,
    content: [
      { key: 'filterFlags.excludeFixed', label: 'Exclude fixed' },
      { key: 'filterFlags.excludeKinematic', label: 'Exclude kinematic' },
      { key: 'filterFlags.excludeDynamic', label: 'Exclude dynamic' },
      { key: 'filterFlags.excludeSensors', label: 'Exclude sensors' },
      { key: 'filterFlags.excludeSolids', label: 'Exclude solids' },
      { key: 'useFilterGroups', label: 'Use filter groups', onChange: ctx.refreshPane },
      {
        key: 'filterGroups',
        label: 'Filter groups (u32)',
        min: 0,
        max: ALL_INTERACTION_GROUPS,
        step: 1,
        hidden: () => !ray.useFilterGroups,
      },
      { key: 'excludeAppId', label: 'Exclude entity (app id)' },
    ],
  },
  helperFolder(),
];
