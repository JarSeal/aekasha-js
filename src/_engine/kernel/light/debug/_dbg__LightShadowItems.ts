// A light edit window's shadow items (p806 D10): the cast shadow toggle and the shadow and shadow
// camera folders, each field disabled while the light casts none.
import * as THREE from 'three/webgpu';
import { ComponentType } from '../../ecs/ECSCoreComponents';
import type { PropertyGridFieldItem, PropertyGridItem } from '../../../ui/forms/PropertyGridItems';
import { FOUR_PX_TO_8K_LIST } from '../../../utils/Constants';
import { getRendererOptions } from '../../render/Renderer';
import { reconcileDebugVisuals, refreshLightShadows } from './_dbg__LightDebugState';
import { onLightChange, type LightWindowContext, type ShadowLight } from './_dbg__LightUndo';

/** The shadow folders' ids, which the window saves as `_shadowFolderOpen` and
 * `_shadowCameraFolderOpen` */
export const SHADOW_FOLDER_ID = 'shadow';
export const SHADOW_CAMERA_FOLDER_ID = 'shadowCamera';

const DEFAULT_MAP_SIZE = 512;

/** A shadow map size's select (Tweakpane's `view: 'list'` blade, an unbound select: D4) */
const getMapSizeItem = (
  ctx: LightWindowContext,
  l: ShadowLight,
  axis: 'width' | 'height',
  disabled: () => boolean
): PropertyGridFieldItem => {
  const toSize = (value: number): [number, number] =>
    axis === 'width' ? [value, l.shadow.mapSize.height] : [l.shadow.mapSize.width, value];
  return {
    label: `Shadow map ${axis}`,
    value: l.shadow.mapSize[axis] || DEFAULT_MAP_SIZE,
    options: FOUR_PX_TO_8K_LIST,
    disabled,
    onChange: onLightChange(
      ctx,
      'shadowMapSize',
      (value: number) => {
        l.shadow.mapSize[axis] = value;
        // A perspective shadow camera's aspect follows the map size
        if (l.shadow.camera instanceof THREE.PerspectiveCamera) {
          const [width, height] = toSize(value);
          l.shadow.camera.aspect = (width || DEFAULT_MAP_SIZE) / (height || DEFAULT_MAP_SIZE);
          l.shadow.camera.updateProjectionMatrix();
        }
        // Rebuilds the light and then this window
        refreshLightShadows(l, ctx.entityId, ctx.world);
      },
      toSize
    ),
  };
};

/** The shadow camera folder's items: near and far, and an orthographic camera's frustum */
const getShadowCameraItems = (
  ctx: LightWindowContext,
  l: ShadowLight,
  disabled: () => boolean
): PropertyGridItem[] => {
  const cam = l.shadow.camera;
  const update = () => {
    cam.updateProjectionMatrix();
    ctx.world.getComponent(ctx.entityId, ComponentType.DEBUG_LIGHT_HELPER)?.camHelper?.update();
  };
  const nearFarItem = (key: 'near' | 'far', label: string, step: number): PropertyGridItem => ({
    target: cam,
    key,
    label,
    step,
    disabled,
    onChange: onLightChange(ctx, 'shadowCameraNearFar', update, (value: number) =>
      key === 'near' ? [value, cam.far] : [cam.near, value]
    ),
  });
  const items = [
    nearFarItem('near', 'Near', 0.01),
    nearFarItem('far', `Far${l.type === 'SpotLight' ? ' (tied to distance)' : ''}`, 1),
  ];
  // Orthographic: a directional light's
  if (cam instanceof THREE.OrthographicCamera) {
    const sides = ['left', 'right', 'top', 'bottom'] as const;
    for (let i = 0; i < sides.length; i++) {
      const side = sides[i];
      items.push({
        target: cam,
        key: side,
        label: `${side[0].toUpperCase()}${side.slice(1)}`,
        step: 0.01,
        disabled,
        onChange: onLightChange(ctx, 'shadowCameraFrustum', update, (value: number) => {
          const frustum: [number, number, number, number] = [
            cam.left,
            cam.right,
            cam.top,
            cam.bottom,
          ];
          frustum[i] = value;
          return frustum;
        }),
      });
    }
  }
  return items;
};

/**
 * The shadow items of a light that can cast shadows: the toggle, then the shadow folder (bias,
 * intensity, the VSM parameters, the map size, the shadow camera folder). A field is disabled
 * while the light casts no shadow, read again when the toggle changes.
 */
export const getLightShadowItems = (
  ctx: LightWindowContext,
  light: THREE.Light
): PropertyGridItem[] => {
  const l = light as ShadowLight;
  const isVSM = getRendererOptions().shadowMapType === THREE.VSMShadowMap;
  const noShadow = () => !l.castShadow;
  const noVSMShadow = () => !isVSM || !l.castShadow;
  return [
    {
      target: light,
      key: 'castShadow',
      label: 'Cast shadow',
      onChange: onLightChange(ctx, 'castShadow', () =>
        reconcileDebugVisuals(ctx.entityId, ctx.world)
      ),
    },
    {
      type: 'folder',
      id: SHADOW_FOLDER_ID,
      title: 'Shadow',
      items: [
        {
          target: l.shadow,
          key: 'bias',
          label: 'Shadow bias',
          step: 0.00001,
          disabled: noShadow,
          onChange: onLightChange(ctx, 'shadowBias'),
        },
        {
          target: l.shadow,
          key: 'normalBias',
          label: 'Normal bias',
          step: 0.00001,
          disabled: noShadow,
          onChange: onLightChange(ctx, 'shadowNormalBias'),
        },
        {
          target: l.shadow,
          key: 'intensity',
          label: 'Shadow intensity',
          min: 0,
          max: 10,
          step: 0.001,
          disabled: noShadow,
          onChange: onLightChange(ctx, 'shadowIntensity'),
        },
        {
          target: l.shadow,
          key: 'blurSamples',
          label: 'Blur samples (VSM only)',
          min: 0,
          max: 64,
          step: 1,
          disabled: noVSMShadow,
          onChange: onLightChange(ctx, 'shadowBlurSamples'),
        },
        {
          target: l.shadow,
          key: 'radius',
          label: 'Shadow radius (VSM only)',
          min: 0,
          disabled: noVSMShadow,
          onChange: onLightChange(ctx, 'shadowRadius'),
        },
        getMapSizeItem(ctx, l, 'width', noShadow),
        getMapSizeItem(ctx, l, 'height', noShadow),
        {
          type: 'folder',
          id: SHADOW_CAMERA_FOLDER_ID,
          title: 'Shadow camera',
          items: getShadowCameraItems(ctx, l, noShadow),
        },
      ],
    },
  ];
};
