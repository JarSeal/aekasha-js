import { lwarn } from '../../../utils/Logger';
import * as builtIn from './BuiltInIcons';
import '../../styles/kit.scss';

/**
 * The icon registry (p607 D12): `getSvgIcon` renders only a registered icon, so a build holds the
 * SVGs that something registers and no others. The debug tools register every built-in in
 * InitEngine (debug env and prod test mode); a production build registers none unless the app does.
 */

/** The name of an engine built-in icon (each is exported as `<name>Icon`, `gear` → `gearIcon`). */
export type BuiltInIconName =
  | 'aekasha'
  | 'alert'
  | 'arrowClockwise'
  | 'arrowCounterClockwise'
  | 'assets'
  | 'aspectRatio'
  | 'camera'
  | 'cameraReels'
  | 'circleCheckCutout'
  | 'cloudSun'
  | 'databaseX'
  | 'easel'
  | 'ecs'
  | 'eraser'
  | 'fileAsterix'
  | 'fileCode'
  | 'gear'
  | 'geometry'
  | 'gpuCard'
  | 'heartArrow'
  | 'infinity'
  | 'info'
  | 'lightBulb'
  | 'lamp'
  | 'lock'
  | 'lod'
  | 'material'
  | 'memory'
  | 'objectsCubes'
  | 'pause'
  | 'personArmsUp'
  | 'pin'
  | 'playFill'
  | 'postFx'
  | 'profiler'
  | 'redo'
  | 'rocket'
  | 'rocketTakeoff'
  | 'runtime'
  | 'spatialGrid'
  | 'speedometer'
  | 'stop'
  | 'texture'
  | 'thrash'
  | 'tools'
  | 'undo'
  | 'warning'
  | 'x'
  | 'xBold';

/** The built-ins by name (read only by registerBuiltInIcons: a build without it drops them) */
const BUILT_IN_ICONS = {
  aekasha: builtIn.aekashaIcon,
  alert: builtIn.alertIcon,
  arrowClockwise: builtIn.arrowClockwiseIcon,
  arrowCounterClockwise: builtIn.arrowCounterClockwiseIcon,
  assets: builtIn.assetsIcon,
  aspectRatio: builtIn.aspectRatioIcon,
  camera: builtIn.cameraIcon,
  cameraReels: builtIn.cameraReelsIcon,
  circleCheckCutout: builtIn.circleCheckCutoutIcon,
  cloudSun: builtIn.cloudSunIcon,
  databaseX: builtIn.databaseXIcon,
  easel: builtIn.easelIcon,
  ecs: builtIn.ecsIcon,
  eraser: builtIn.eraserIcon,
  fileAsterix: builtIn.fileAsterixIcon,
  fileCode: builtIn.fileCodeIcon,
  gear: builtIn.gearIcon,
  geometry: builtIn.geometryIcon,
  gpuCard: builtIn.gpuCardIcon,
  heartArrow: builtIn.heartArrowIcon,
  infinity: builtIn.infinityIcon,
  info: builtIn.infoIcon,
  lightBulb: builtIn.lightBulbIcon,
  lamp: builtIn.lampIcon,
  lock: builtIn.lockIcon,
  lod: builtIn.lodIcon,
  material: builtIn.materialIcon,
  memory: builtIn.memoryIcon,
  objectsCubes: builtIn.objectsCubesIcon,
  pause: builtIn.pauseIcon,
  personArmsUp: builtIn.personArmsUpIcon,
  pin: builtIn.pinIcon,
  playFill: builtIn.playFillIcon,
  postFx: builtIn.postFxIcon,
  profiler: builtIn.profilerIcon,
  redo: builtIn.redoIcon,
  rocket: builtIn.rocketIcon,
  rocketTakeoff: builtIn.rocketTakeoffIcon,
  runtime: builtIn.runtimeIcon,
  spatialGrid: builtIn.spatialGridIcon,
  speedometer: builtIn.speedometerIcon,
  stop: builtIn.stopIcon,
  texture: builtIn.textureIcon,
  thrash: builtIn.thrashIcon,
  tools: builtIn.toolsIcon,
  undo: builtIn.undoIcon,
  warning: builtIn.warningIcon,
  x: builtIn.xIcon,
  xBold: builtIn.xBoldIcon,
} satisfies Record<BuiltInIconName, string>;

/**
 * A registered icon's name: a built-in's ({@link BuiltInIconName}, autocompleted) or any name an
 * app registers with {@link registerIcon}.
 */
export type SvgIconKey = BuiltInIconName | (string & {});

const icons = new Map<string, string>();
/** The unregistered names getSvgIcon has warned about, once each */
const warnedNames = new Set<string>();

/**
 * Registers an icon under a name for {@link getSvgIcon} (and every `icon` option that takes an
 * {@link SvgIconKey}, eg. a draggable window's). A name registered again gets the new SVG, so an
 * app can restyle a built-in. The SVG should take the text colour (`fill="currentColor"`).
 * @param svg the SVG markup
 * @example
 * ```ts
 * import { gearIcon, registerIcon } from 'aekasha/ui';
 * import shieldSvg from './icons/shield.svg?raw';
 *
 * registerIcon('gear', gearIcon); // a built-in the app's UI uses
 * registerIcon('shield', shieldSvg); // the app's own
 * ```
 */
export const registerIcon = (name: SvgIconKey, svg: string) => {
  icons.set(name, svg);
};

/**
 * Registers every built-in icon under its {@link BuiltInIconName} (about 10 kB gzip of SVG). The
 * engine does it for the debug tools; an app that wants only some registers those with
 * {@link registerIcon}.
 */
export const registerBuiltInIcons = () => {
  for (const name in BUILT_IN_ICONS) {
    registerIcon(name, BUILT_IN_ICONS[name as BuiltInIconName]);
  }
};

/**
 * An icon's size from the type scale (p803 D5): `--aek-icon-size-sm`, `-md` or `-lg` (12, 16 and
 * 20 px at the defaults, smaller in the compact density). Without one an icon is `1em`: it follows
 * its text.
 */
export type SvgIconSize = 'sm' | 'md' | 'lg';

/**
 * A registered icon as HTML: `<span class="aekIcon">` around the SVG (also `uiIcon`, and with
 * `'sm'` `smallIcon`: the debugger's classes until p806), `1em` square so it follows its text, or
 * at a `size` from the type scale (`data-size`). An unregistered name renders `??` and warns
 * once.
 * - Parts: `.aekIcon` (`data-size`) and its SVG, which takes the text colour when it's drawn with
 *   `currentColor` (the built-ins are).
 * - Custom properties: `--aek-icon-size-sm`, `-md`, `-lg`.
 * @param size `'sm'`, `'md'` or `'lg'` (default: `1em`); `'small'` is the deprecated name of
 * `'sm'` (removed in engine 6.0.0)
 * @example
 * ```ts
 * import { CMP, getSvgIcon } from 'aekasha/ui';
 *
 * const button = CMP({ tag: 'button', html: `${getSvgIcon('shield')} Defend` });
 * const badge = CMP({ html: getSvgIcon('shield', 'lg') });
 * ```
 */
export const getSvgIcon = (name: SvgIconKey, size?: SvgIconSize | 'small') => {
  let icon = icons.get(name);
  if (icon === undefined) {
    if (!warnedNames.has(name)) {
      warnedNames.add(name);
      lwarn(`No icon "${name}" is registered (registerIcon, or registerBuiltInIcons).`);
    }
    icon = '??';
  }
  const resolved = size === 'small' ? 'sm' : size;
  if (!resolved) return `<span class="aekIcon uiIcon">${icon}</span>`;
  const debugClass = resolved === 'sm' ? ' smallIcon' : '';
  return `<span class="aekIcon uiIcon${debugClass}" data-size="${resolved}">${icon}</span>`;
};
