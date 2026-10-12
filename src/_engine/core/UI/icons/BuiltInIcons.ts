/**
 * @license Bootstrap Icons, Copyright 2019-2024 The Bootstrap Authors
 * SPDX-License-Identifier: MIT (LICENSE-bootstrap-icons.txt)
 */

/**
 * The engine's built-in icons (p607 D12), each an SVG string under its name with `Icon` added
 * (`gear` → `gearIcon`). Only re-exports, so a build keeps the ones something registers: the debug
 * tools register them all (`registerBuiltInIcons`, `SvgIcon.ts`), an app the ones its UI uses.
 *
 * Every icon in `svg/` follows Bootstrap Icons' form: `<svg xmlns width="16" height="16"
 * fill="currentColor" class="bi bi-<file name>" viewBox="0 0 16 16">` and paths without
 * transforms or fixed colours, so it takes the text colour. A line icon has `fill="none"` and
 * `stroke="currentColor"` on its paths (1 wide, 0.75 for inner detail). Files without an export
 * below aren't built-ins (`github.svg` and `three-js.svg` are the Hub's brand marks, copied into
 * `hub/_assets/icons/`).
 *
 * Most of them are Bootstrap Icons' own (https://icons.getbootstrap.com, MIT, the licence in
 * `LICENSE-bootstrap-icons.txt`); the rest are drawn for the engine in the same form. A new one
 * from Bootstrap Icons is copied as it is, under its own file name, and gets an export here and a
 * name in `SvgIcon.ts`' `BUILT_IN_ICONS`.
 */
export { default as aekashaIcon } from './svg/aekasha.svg?raw';
export { default as alertIcon } from './svg/exclamation-octagon-fill.svg?raw';
export { default as arrowClockwiseIcon } from './svg/arrow-clockwise.svg?raw';
export { default as arrowCounterClockwiseIcon } from './svg/arrow-counterclockwise.svg?raw';
export { default as assetsIcon } from './svg/assets-collection.svg?raw';
export { default as aspectRatioIcon } from './svg/aspect-ratio.svg?raw';
export { default as cameraIcon } from './svg/camera2.svg?raw';
export { default as cameraReelsIcon } from './svg/camera-reels.svg?raw';
export { default as circleCheckCutoutIcon } from './svg/circle-check-cutout.svg?raw';
export { default as cloudSunIcon } from './svg/cloud-sun-fill.svg?raw';
export { default as databaseXIcon } from './svg/database-fill-x.svg?raw';
export { default as easelIcon } from './svg/easel-fill.svg?raw';
export { default as ecsIcon } from './svg/ecs-nodes.svg?raw';
export { default as eraserIcon } from './svg/eraser-fill.svg?raw';
export { default as fileAsterixIcon } from './svg/file-earmark-medical-fill.svg?raw';
export { default as fileCodeIcon } from './svg/file-earmark-code-fill.svg?raw';
export { default as gearIcon } from './svg/gear-fill.svg?raw';
export { default as geometryIcon } from './svg/geometry-cube.svg?raw';
export { default as gpuCardIcon } from './svg/gpu-card.svg?raw';
export { default as heartArrowIcon } from './svg/heart-arrow.svg?raw';
export { default as infinityIcon } from './svg/infinity.svg?raw';
export { default as infoIcon } from './svg/info-circle-fill.svg?raw';
export { default as lightBulbIcon } from './svg/lightbulb-fill.svg?raw';
export { default as lampIcon } from './svg/lamp.svg?raw';
export { default as lockIcon } from './svg/lock-fill.svg?raw';
export { default as lodIcon } from './svg/lod.svg?raw';
export { default as materialIcon } from './svg/material-sphere.svg?raw';
export { default as memoryIcon } from './svg/memory.svg?raw';
export { default as objectsCubesIcon } from './svg/cubes-wireframe.svg?raw';
export { default as pauseIcon } from './svg/pause-fill.svg?raw';
export { default as personArmsUpIcon } from './svg/person-arms-up.svg?raw';
export { default as pinIcon } from './svg/pin-angle-fill.svg?raw';
export { default as playFillIcon } from './svg/play-fill.svg?raw';
export { default as postFxIcon } from './svg/post-fx.svg?raw';
export { default as profilerIcon } from './svg/profiler-pulse.svg?raw';
export { default as redoIcon } from './svg/arrow-90deg-right.svg?raw';
export { default as rocketIcon } from './svg/rocket.svg?raw';
export { default as rocketTakeoffIcon } from './svg/rocket-takeoff-fill.svg?raw';
export { default as runtimeIcon } from './svg/runtime-view.svg?raw';
export { default as spatialGridIcon } from './svg/spatial-grid.svg?raw';
export { default as speedometerIcon } from './svg/speedometer.svg?raw';
export { default as stopIcon } from './svg/stop-fill.svg?raw';
export { default as textureIcon } from './svg/texture-image.svg?raw';
export { default as thrashIcon } from './svg/trash3-fill.svg?raw';
export { default as toolsIcon } from './svg/tools.svg?raw';
export { default as undoIcon } from './svg/arrow-90deg-left.svg?raw';
export { default as warningIcon } from './svg/exclamation-triangle-fill.svg?raw';
export { default as xIcon } from './svg/x.svg?raw';
export { default as xBoldIcon } from './svg/x-bold.svg?raw';
