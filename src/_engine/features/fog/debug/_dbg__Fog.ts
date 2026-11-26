// The fog's debug tab (p106 D8): the scene's fogs and the master switch, then the fog showing's
// values as the UI kit's fields (only its mode's parameters shown), its colour (the sky's live
// one under `SKY`, a colour of its own under `MANUAL`, seeded from the sky's when switched), its
// sun glow and background, and the fog factor view. Every field reads the live fog, so the tab
// keeps across scenes. Edits are undoable overrides saved into the fog's file (`_dbg__FogEdits.ts`,
// `_dbg__FogSave.ts`); the master switch and the view are runtime only, like the sky box's
// day-night transport.
import * as THREE from 'three/webgpu';
import { Fn, output, vec3, vec4 } from 'three/tsl';
import {
  createDebuggerTab,
  DEBUG_TOASTER_ID,
  type DebuggerPaneBindingProps,
  type DebuggerPaneItem,
  updateDebuggerTab,
} from '../../../debug/DebuggerGUI';
import {
  confirmClearScope,
  createClearListLSButton,
  createClearTabLSButton,
  lsKeyHasData,
} from '../../../debug/_dbg__ClearLSButtons';
import { getNoteItem } from '../../../debug/_dbg__DebugWindowGrid';
import { toThreeColor } from '../../../kernel/render/ThreeMath';
import { getCurrentSceneId } from '../../../kernel/scene/Scene';
import { addToast } from '../../../ui/overlays/Toaster';
import { lsRemoveItem } from '../../../utils/LocalAndSessionStorage';
import { llog, lwarn } from '../../../utils/Logger';
import {
  _getFogViewNode,
  _getSceneFogs,
  _isFogSkyColorLive,
  _setFogViewNode,
  FOG_DEBUG_OVERRIDES_LS_KEY,
  getFog,
  getFogNodes,
  isFogEnabled,
  onFogChange,
  setFogEnabled,
} from '../Fog';
import type { FogColorSource, FogMode } from '../FogTypes';
import {
  clearFogOverrides,
  FOG_TAB_ID,
  getPathValue,
  getSceneIdsWithFogOverrides,
  isSceneFogShown,
  selectSceneFog,
  setFogValue,
  setFogValues,
} from './_dbg__FogEdits';
import { registerFogSaveSource } from './_dbg__FogSave';

const LS_KEY_UI = 'AEK_debugFogUI';
/** The fog select's value for none */
const NO_FOG_ID = '__noFog';

const noFog = () => !getFog();
const isNotMode = (mode: FogMode) => () => getFog()?.mode !== mode;
const isNotColorSource = (source: FogColorSource) => () => getFog()?.colorSource !== source;

/** Scratch for the colours' hex */
const scratchColor = new THREE.Color();
/** A colour as `#rrggbb` (sRGB; an HDR colour clipped) */
const toHex = (color: THREE.Color) => `#${color.getHexString()}`;

/** A field over one value of the fog showing (`path` in its definition), its edits undoable. */
const fogField = (
  path: string,
  label: string,
  props?: DebuggerPaneBindingProps & { get?: () => unknown }
): DebuggerPaneItem => ({
  get: () => getPathValue(getFog(), path),
  set: (value: unknown) => setFogValue(path, label, value),
  label,
  disabled: noFog,
  ...props,
});

/** A segmented control's options. */
const segments = <T extends string>(options: readonly [T, string][]) =>
  options.map(([value, label]) => ({ value, label }));

// Scene's fogs

const buildSelectFolder = (): DebuggerPaneItem => ({
  type: 'folder',
  id: 'sceneFogs',
  title: "Scene's fogs",
  content: [
    {
      label: 'Fog showing',
      // The scene's fogs, and one made in code while it shows
      options: () => {
        const sceneFogs = _getSceneFogs();
        const defaultId = sceneFogs?.fogs.find((fog) => fog.isDefault)?.id;
        const options = (sceneFogs?.fogs ?? []).map((fog) => ({
          text: `${fog.debugData?.name || fog.id}${fog.id === defaultId ? ' [*default]' : ''}`,
          value: fog.id,
        }));
        const fog = getFog();
        if (fog && !options.some((option) => option.value === fog.id)) {
          options.push({ text: `${fog.id} [code]`, value: fog.id });
        }
        return [...options, { text: '[No fog]', value: NO_FOG_ID }];
      },
      get: () => getFog()?.id ?? NO_FOG_ID,
      set: (value: unknown) => selectSceneFog(value === NO_FOG_ID ? null : String(value)),
    },
    {
      label: 'Fog on (all scenes, runtime)',
      kind: 'switch',
      get: () => isFogEnabled() ?? false,
      set: (value: unknown) => setFogEnabled(Boolean(value)),
    },
    getNoteItem(() => {
      if (!getFog()) return "No fog shows. A scene lists its fogs in its JSON's fogs.";
      return isSceneFogShown()
        ? ''
        : "Made in code (setFog): its edits show, but they aren't kept or saved.";
    }),
  ],
});

// The fog showing

const buildFogFolder = (): DebuggerPaneItem => ({
  type: 'folder',
  id: 'fogValues',
  title: 'Fog',
  content: [
    fogField('enabled', 'Enabled'),
    fogField('mode', 'Mode', {
      kind: 'segmented',
      fill: true,
      options: segments<FogMode>([
        ['LINEAR', 'Linear'],
        ['EXP2', 'Exp²'],
        ['HEIGHT', 'Height'],
      ]),
    }),
    fogField('linear.near', 'Near', { min: 0, step: 1, unit: 'm', hidden: isNotMode('LINEAR') }),
    fogField('linear.far', 'Far', { min: 0, step: 1, unit: 'm', hidden: isNotMode('LINEAR') }),
    fogField('exp2.density', 'Density', {
      min: 0,
      max: 0.05,
      step: 0.0001,
      hidden: isNotMode('EXP2'),
    }),
    fogField('height.density', 'Density (/m)', {
      min: 0,
      max: 0.2,
      step: 0.001,
      hidden: isNotMode('HEIGHT'),
    }),
    fogField('height.baseHeight', 'Base height', {
      step: 0.5,
      unit: 'm',
      hidden: isNotMode('HEIGHT'),
    }),
    fogField('height.falloff', 'Falloff (/m)', {
      min: 0,
      max: 1,
      step: 0.005,
      hidden: isNotMode('HEIGHT'),
    }),
    fogField('height.startDistance', 'Start distance', {
      min: 0,
      step: 1,
      unit: 'm',
      hidden: isNotMode('HEIGHT'),
    }),
    fogField('height.maxOpacity', 'Max opacity', {
      min: 0,
      max: 1,
      step: 0.01,
      hidden: isNotMode('HEIGHT'),
    }),
  ],
});

/** Switches the colour's source; to `MANUAL` the colour starts as the sky's showing (one undo
 * step). */
const setColorSource = (value: unknown) => {
  const fog = getFog();
  const nodes = getFogNodes();
  if (!fog || !nodes || value === fog.colorSource) return;
  const next = value as FogColorSource;
  if (next === 'MANUAL' && _isFogSkyColorLive()) {
    setFogValues(
      'colour source',
      { colorSource: fog.colorSource, color: fog.color },
      { colorSource: next, color: toHex(nodes.color.value) }
    );
  } else {
    setFogValue('colorSource', 'colour source', next);
  }
};

const buildColorFolder = (): DebuggerPaneItem => ({
  type: 'folder',
  id: 'fogColor',
  title: 'Colour',
  content: [
    {
      label: 'Source',
      kind: 'segmented',
      fill: true,
      options: segments<FogColorSource>([
        ['SKY', 'Sky'],
        ['MANUAL', 'Manual'],
      ]),
      get: () => getFog()?.colorSource ?? 'SKY',
      set: setColorSource,
      disabled: noFog,
    },
    {
      label: 'Sky colour',
      readonly: true,
      get: () => {
        const nodes = getFogNodes();
        if (!nodes) return '-';
        return _isFogSkyColorLive()
          ? toHex(nodes.color.value)
          : 'none (no sky source, or no sky box): the fallback';
      },
      hidden: isNotColorSource('SKY'),
    },
    // Under `SKY` the colour is the fallback (no sky source wired, or a sky without a colour)
    ...(['MANUAL', 'SKY'] as const).map((source) =>
      fogField('color', source === 'MANUAL' ? 'Colour' : 'Fallback colour', {
        get: () => {
          const fog = getFog();
          return fog ? toHex(scratchColor.set(toThreeColor(fog.color))) : '#000000';
        },
        hidden: isNotColorSource(source),
      })
    ),
    fogField('background', 'Background', {
      kind: 'segmented',
      fill: true,
      options: segments([
        ['NONE', 'None'],
        ['FOG_COLOR', 'Fog colour'],
      ]),
    }),
  ],
});

const buildSunGlowFolder = (): DebuggerPaneItem => ({
  type: 'folder',
  id: 'fogSunGlow',
  title: 'Sun glow',
  content: [
    fogField('sunScattering.enabled', 'Enabled'),
    fogField('sunScattering.strength', 'Strength', { min: 0, max: 1, step: 0.01 }),
    fogField('sunScattering.exponent', 'Exponent', { min: 0, max: 64, step: 0.5 }),
    {
      label: 'Sun colour',
      readonly: true,
      get: () => {
        const nodes = getFogNodes();
        if (!nodes || nodes.sunDirection.value.lengthSq() === 0) return 'none (no sun source)';
        return toHex(nodes.sunColor.value);
      },
    },
  ],
});

// The fog factor view: the factor in grey, in the graph's place (a different fog node: every
// material in the scene recompiles on each switch, fine in the debugger)

let factorViewNode: THREE.Node | null = null;

const getFactorViewNode = () => {
  const nodes = getFogNodes();
  if (!nodes) return null;
  factorViewNode ??= Fn(() => vec4(vec3(nodes.factor), output.a))();
  return factorViewNode;
};

const buildViewFolder = (): DebuggerPaneItem => ({
  type: 'folder',
  id: 'fogView',
  title: 'View',
  content: [
    {
      label: 'Fog factor',
      hint: "The fog factor in grey, 0 black to 1 white. Each switch recompiles the scene's materials.",
      kind: 'switch',
      get: () => _getFogViewNode() !== null,
      set: (value: unknown) => _setFogViewNode(value ? getFactorViewNode() : null),
    },
  ],
});

// Copy JSON

const copyFogJSON = async () => {
  const fog = getFog();
  if (!fog) return;
  const json = JSON.stringify(fog, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    addToast({ toasterId: DEBUG_TOASTER_ID, title: 'Copied fog JSON', message: fog.id });
  } catch {
    lwarn('Could not copy the fog JSON to the clipboard, logging it instead:');
    llog(json);
  }
};

// Clear LS

const createClearOverridesButton = () =>
  createClearListLSButton({
    hasData: () => getSceneIdsWithFogOverrides().length > 0,
    watchKey: FOG_DEBUG_OVERRIDES_LS_KEY,
    onClear: () => {
      const sceneIds = getSceneIdsWithFogOverrides();
      if (sceneIds.length > 1) {
        confirmClearScope({
          onClearAllScenes: () => clearFogOverrides(sceneIds),
          onClearThisScene: () => {
            const sceneId = getCurrentSceneId();
            if (sceneId) clearFogOverrides([sceneId]);
          },
        });
      } else {
        clearFogOverrides(sceneIds);
      }
    },
  });

/**
 * Creates the fog's drawer tab and registers its save source (the `fog()` feature's `onDebug`).
 * @internal
 */
export const _createFogDebugTab = () => {
  // "Save scene" saves the overrides into the fog files
  registerFogSaveSource();
  // Another fog, an update or the master switch from anywhere shows in the fields
  onFogChange(() => updateDebuggerTab(FOG_TAB_ID));
  createDebuggerTab({
    id: FOG_TAB_ID,
    title: 'Fog',
    icon: 'fog',
    // The overrides are scene-scoped (module-owned); the tab's own data is only its UI state,
    // so both clear buttons are custom
    uiLsKey: LS_KEY_UI,
    clearLSButton: false,
    headerButtons: () => [
      createClearTabLSButton({
        hasData: () => lsKeyHasData(LS_KEY_UI),
        watchKey: LS_KEY_UI,
        onClear: () => lsRemoveItem(LS_KEY_UI),
      }),
      createClearOverridesButton(),
    ],
    // The sky's colour and the sun move on their own
    refreshIntervalMs: 250,
    // Everything is read through getters: nothing to rebuild on a scene change
    keepOnSceneChange: true,
    content: () => [
      {
        pane: true,
        content: [
          buildSelectFolder(),
          buildFogFolder(),
          buildColorFolder(),
          buildSunGlowFolder(),
          buildViewFolder(),
          {
            type: 'button',
            title: 'Copy JSON',
            disabled: noFog,
            onClick: () => void copyFogJSON(),
          },
        ],
      },
    ],
  });
};
