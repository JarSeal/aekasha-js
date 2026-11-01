// The light edit window (p806 D10): a debug window per light on the UI kit's property grid, the
// editor of a light or the live readout of a managed one. An edit applies on every write and is
// saved per scene (`AEK_debugLights`) and recorded for undo when its gesture ends.
import * as THREE from 'three/webgpu';
import { getECSWorld, getEntityIdByAppId, getStableAppId, type ECSWorld } from '../../ecs/ECS';
import { ComponentType } from '../../ecs/ECSCoreComponents';
import { CMP } from '../../../ui/core/CMP';
import type { PropertyGridItem } from '../../../ui/forms/PropertyGridItems';
import { openDebuggerTab, updateDebuggerTab } from '../../../debug/DebuggerGUI';
import {
  closeDraggableWindow,
  getKindWindowId,
} from '../../../ui/overlays/windows/DraggableWindow';
import { createDebugWindowGrid, getEntityInfoItems } from '../../../debug/_dbg__DebugWindowGrid';
import {
  setLightEnabled,
  setLightFrustumCullingEnabled,
  setLightObjectCullingEnabled,
} from '../Light';
import { getLightCharacteristics } from '../LightHelpers';
import { refreshSpatialRadius } from '../../../features/spatial/SpatialIndexSystem';
import { updateOnScreenTools } from '../../../debug/OnScreenTools';
import { _getEntityManagerInfo } from '../../../debug/_dbg__ManagedEntities';
import {
  EDIT_LIGHT_WIN_ID,
  LIGHTS_TAB_ID,
  clearLightFromLS,
  getLightDebugVisibilityPref,
  loadLightDebugData,
  saveLightToLS,
  setLightHelperVisible,
  updateLightsDebuggerGUI,
} from './_dbg__LightDebugState';
import { onLightChange, type LightPos, type LightWindowContext } from './_dbg__LightUndo';
import {
  SHADOW_CAMERA_FOLDER_ID,
  SHADOW_FOLDER_ID,
  getLightShadowItems,
} from './_dbg__LightShadowItems';

type EntityManagerInfo = NonNullable<ReturnType<typeof _getEntityManagerInfo>>;

/** The read rate of a managed light's live values (its manager keeps changing them) */
const MANAGED_READ_MS = 250;

/** A light's "Show helper" toggle, when it has a helper (`refresh` re-reads the window after it) */
const getHelperItems = (
  entityId: number,
  world: ECSWorld,
  light: THREE.Light,
  refresh?: () => void
): PropertyGridItem[] =>
  world.getComponent(entityId, ComponentType.DEBUG_LIGHT_HELPER) &&
  getLightCharacteristics(light).hasHelper
    ? [
        {
          label: 'Show helper',
          get: () => getLightDebugVisibilityPref(entityId, world).helper,
          set: (show) => setLightHelperVisible(entityId, world, show as boolean),
          onChange: () => {
            refresh?.();
            updateDebuggerTab(LIGHTS_TAB_ID);
          },
        },
      ]
    : [];

/**
 * The edit window of a managed light (MANAGED_BY): a read-only live summary, since its manager
 * owns and drives it. Only the helper (cosmetic) can be toggled; nothing is saved to LS or
 * recorded for undo, and it can't be deleted here.
 */
const createManagedLightContent = (
  entityId: number,
  world: ECSWorld,
  light: THREE.Light,
  info: EntityManagerInfo
) => {
  // Ambient and hemisphere lights have no shadow
  const shadow = (light as THREE.Light & { shadow?: THREE.LightShadow }).shadow;
  const live = { readonly: true as const, interval: MANAGED_READ_MS };
  const tabId = info.tabId;
  const items: PropertyGridItem[] = [
    { label: 'Enabled', get: () => light.visible, ...live },
    { label: 'Intensity', get: () => light.intensity, precision: 2, ...live },
    { label: 'Color', get: () => `#${light.color.getHexString()}`, ...live },
    { label: 'Position', get: () => light.position, precision: 2, ...live },
    ...(shadow
      ? [
          { label: 'Cast shadow', get: () => light.castShadow, ...live },
          { label: 'Shadow intensity', get: () => shadow.intensity, precision: 2, ...live },
        ]
      : []),
    ...getHelperItems(entityId, world, light),
    ...(tabId
      ? [
          {
            type: 'button' as const,
            title: `Open in ${info.label} tab`,
            onClick: () => openDebuggerTab(tabId),
          },
        ]
      : []),
    ...getEntityInfoItems({
      entityId,
      appId: world.getComponent(entityId, ComponentType.APP_ID)?.id,
      type: light.type,
    }),
    {
      label: 'Managed by',
      value: `${info.label} (${info.ownerId}, ${info.role})`,
      readonly: true,
      interval: 'refresh',
      hint: "Edit it in its manager's tab: here it's read-only.",
    },
  ];
  queueMicrotask(() => updateDebuggerTab(LIGHTS_TAB_ID));
  return createDebugWindowGrid({ items }).cmp;
};

/** The enabled, helper and symbol toggles, the colours, intensity, distance and decay, and the
 * culling toggles */
const getLightItems = (ctx: LightWindowContext, light: THREE.Light): PropertyGridItem[] => {
  const { world, entityId } = ctx;
  const chars = getLightCharacteristics(light);
  const items: PropertyGridItem[] = [
    {
      target: light,
      key: 'visible',
      label: 'Enabled',
      onChange: onLightChange(ctx, 'enabled', (value: boolean) => {
        setLightEnabled(entityId, value, world);
        updateDebuggerTab(LIGHTS_TAB_ID);
      }),
    },
    ...getHelperItems(entityId, world, light, ctx.refresh),
  ];
  const symbolComp = world.getComponent(entityId, ComponentType.DEBUG_SYMBOL);
  if (symbolComp && chars.hasSymbol) {
    symbolComp.value.visible = getLightDebugVisibilityPref(entityId, world).symbol;
    items.push({
      target: symbolComp,
      key: 'userVisible',
      label: 'Show symbol',
      onChange: (show) => {
        saveLightToLS(entityId, 'symbolVisible', show as boolean);
        ctx.refresh();
        updateOnScreenTools('SWITCH');
      },
    });
  }
  // A hemisphere light's `color` is its sky colour
  const sky = chars.isHemisphereLight ? (light as THREE.HemisphereLight) : null;
  items.push({
    label: sky ? 'Sky color' : 'Color',
    kind: 'color',
    get: () => light.color.getHex(),
    set: (hex) => light.color.setHex(hex as number),
    onChange: onLightChange(ctx, 'color'),
  });
  if (sky) {
    items.push({
      label: 'Ground color',
      kind: 'color',
      get: () => sky.groundColor.getHex(),
      set: (hex) => sky.groundColor.setHex(hex as number),
      onChange: onLightChange(ctx, 'groundColor'),
    });
  }
  items.push({
    target: light,
    key: 'intensity',
    label: 'Intensity',
    min: 0,
    step: 0.01,
    onChange: onLightChange(ctx, 'intensity'),
  });
  const ranged = light as THREE.PointLight | THREE.SpotLight;
  if (chars.hasDistance) {
    items.push({
      target: ranged,
      key: 'distance',
      label: 'Distance',
      min: 0,
      step: 0.01,
      // The spatial index reads a light's range only when it joins
      onChange: onLightChange(ctx, 'distance', () => refreshSpatialRadius(entityId, world)),
    });
  }
  if (chars.hasDecay) {
    items.push({
      target: ranged,
      key: 'decay',
      label: 'Decay',
      min: 0,
      step: 0.01,
      onChange: onLightChange(ctx, 'decay'),
    });
  }
  // Opt-in, ECS-only states
  if (chars.supportsFrustumCulling) {
    items.push(
      {
        label: 'Frustum culling',
        get: () => world.hasComponent(entityId, ComponentType.FRUSTUM_CULLING_ENABLED),
        set: (on) => setLightFrustumCullingEnabled(entityId, on as boolean, world),
        onChange: onLightChange(ctx, 'frustumCullingEnabled'),
      },
      {
        label: 'Object culling',
        get: () => world.hasComponent(entityId, ComponentType.OBJECT_CULLING_ENABLED),
        set: (on) => setLightObjectCullingEnabled(entityId, on as boolean, world),
        onChange: onLightChange(ctx, 'objectCullingEnabled'),
      }
    );
  }
  return items;
};

/** The position and the target's, each an ECS transform moved on every write */
const getPositionItems = (ctx: LightWindowContext, light: THREE.Light): PropertyGridItem[] => {
  const { world, entityId } = ctx;
  const chars = getLightCharacteristics(light);
  const items: PropertyGridItem[] = [];
  const transform = world.getComponent(entityId, ComponentType.TRANSFORM);
  if (transform && chars.hasPosition) {
    items.push({
      label: 'Position',
      get: () => transform.position,
      set: (pos) => {
        world.setTransform(entityId, { pos: pos as LightPos });
        world.getComponent(entityId, ComponentType.DEBUG_LIGHT_HELPER)?.value.update();
      },
      onChange: onLightChange(ctx, 'position'),
    });
  }
  const targetLink = world.getComponent(entityId, ComponentType.TARGET_LINK);
  const targetId = targetLink?.targetId;
  const targetTransform =
    targetId !== undefined ? world.getComponent(targetId, ComponentType.TRANSFORM) : undefined;
  if (targetId !== undefined && targetTransform && chars.hasTarget) {
    items.push({
      label: 'Target position',
      get: () => targetTransform.position,
      set: (pos) => world.setTransform(targetId, { pos: pos as LightPos }),
      onChange: onLightChange(ctx, 'targetPos'),
    });
  }
  return items;
};

/** The clear and delete buttons */
const getButtonItems = (
  ctx: LightWindowContext,
  appId: string | undefined,
  winId: string
): PropertyGridItem[] => [
  {
    type: 'button',
    title: 'Clear local storage',
    disabled: () => !loadLightDebugData(appId),
    onClick: () => {
      if (appId) clearLightFromLS(appId);
      ctx.refresh();
    },
  },
  {
    type: 'button',
    title: 'Delete light',
    onClick: () => {
      closeDraggableWindow(winId);
      ctx.world.deleteEntity(ctx.entityId);
      // deleteEntity fires disposeLight's onDeleteEntity hook (which already refreshes this list)
      // before clearing the entity's component storages, so that refresh still sees the entity
      // in TAG_IS_LIGHT. Refresh again now that deletion has fully completed.
      updateLightsDebuggerGUI('LIST');
    },
  },
];

/** Content for the Edit Light Draggable Window */
export const createEditLightContent = (data?: { [key: string]: unknown }) => {
  const d = data as { id: string };
  const winId = getKindWindowId(EDIT_LIGHT_WIN_ID, d.id);
  const world = getECSWorld();
  const entityId = getEntityIdByAppId(d.id);
  if (!entityId) return CMP();

  if (!world.isAlive(entityId)) return CMP({ text: 'Entity no longer exists' });

  const objComp = world.getComponent(entityId, ComponentType.OBJECT3D);
  const appId = world.getComponent(entityId, ComponentType.APP_ID)?.id;
  const debugData = world.getComponent(entityId, ComponentType.DEBUG_DATA);

  if (!objComp || !(objComp.value instanceof THREE.Light)) return CMP();
  const light = objComp.value;
  const managerInfo = _getEntityManagerInfo(entityId, world);
  if (managerInfo) return createManagedLightContent(entityId, world, light, managerInfo);

  let refreshGrid = () => {};
  const ctx: LightWindowContext = {
    world,
    entityId,
    stableAppId: getStableAppId(entityId, world),
    refresh: () => refreshGrid(),
  };
  const items = [
    ...getLightItems(ctx, light),
    ...getPositionItems(ctx, light),
    ...(light.castShadow !== undefined && getLightCharacteristics(light).canCastShadows
      ? getLightShadowItems(ctx, light)
      : []),
    ...getButtonItems(ctx, appId, winId),
    ...getEntityInfoItems({
      entityId,
      appId,
      type: light.type,
      name: debugData?.name,
      description: debugData?.description,
    }),
  ];

  const saved = loadLightDebugData(appId);
  const folderKeys = {
    [SHADOW_FOLDER_ID]: '_shadowFolderOpen',
    [SHADOW_CAMERA_FOLDER_ID]: '_shadowCameraFolderOpen',
  } as const;
  const { cmp, grid } = createDebugWindowGrid({
    items,
    folderExpanded: {
      [SHADOW_FOLDER_ID]: saved?._shadowFolderOpen ?? false,
      [SHADOW_CAMERA_FOLDER_ID]: saved?._shadowCameraFolderOpen ?? false,
    },
    onFolderExpandedChange: (id, expanded) => {
      const key = folderKeys[id as keyof typeof folderKeys];
      if (!key) return;
      saveLightToLS(entityId, key, expanded);
      ctx.refresh();
    },
  });
  refreshGrid = grid.refresh;

  // The content is built before the window state is open: refresh the list selection after it
  queueMicrotask(() => updateDebuggerTab(LIGHTS_TAB_ID));
  return cmp;
};
