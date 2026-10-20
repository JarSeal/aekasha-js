import * as THREE from 'three/webgpu';
import { getRootScene } from '../kernel/scene/Scene';
import { getDebugToolsState } from './DebugTools';

// Global helpers and won't be deleted on scene change. A create* call replaces its helper and
// keeps its visibility (the "Show" setting while there is none), so a size or colour change of a
// hidden helper leaves it hidden.
let axesHelper: THREE.AxesHelper | null = null;
let gridHelper: THREE.GridHelper | null = null;
let polarGridHelper: THREE.PolarGridHelper | null = null;

// Axes helper
export const createAxesHelper = (size?: number) => {
  const rootScene = getRootScene();
  if (!rootScene) return;
  const visible = axesHelper ? axesHelper.visible : getDebugToolsState().helpers.showAxesHelper;
  if (axesHelper) {
    axesHelper.removeFromParent();
    axesHelper.dispose();
  }
  if (!size) size = getDebugToolsState().helpers.axesHelperSize;
  axesHelper = new THREE.AxesHelper(size);
  axesHelper.visible = visible;
  rootScene.add(axesHelper);
};
export const toggleAxesHelperVisibility = (show: boolean) => {
  if (!axesHelper && show) createAxesHelper();
  if (axesHelper) axesHelper.visible = show;
};

// Grid helper
export const createGridHelper = (
  gridSize: number,
  gridDivisionsSize: number,
  centerLineColor: number,
  gridColor: number
) => {
  const rootScene = getRootScene();
  if (!rootScene) return;
  const visible = gridHelper ? gridHelper.visible : getDebugToolsState().helpers.showGridHelper;
  if (gridHelper) {
    gridHelper.removeFromParent();
    gridHelper.dispose();
  }
  gridHelper = new THREE.GridHelper(gridSize, gridDivisionsSize, centerLineColor, gridColor);
  gridHelper.visible = visible;
  rootScene.add(gridHelper);
};
export const toggleGridHelperVisibility = (show: boolean) => {
  if (!gridHelper && show) {
    const debugToolsState = getDebugToolsState();
    createGridHelper(
      debugToolsState.helpers.gridSize,
      debugToolsState.helpers.gridDivisionsSize,
      debugToolsState.helpers.gridColorCenterLine,
      debugToolsState.helpers.gridColorGrid
    );
  }
  if (gridHelper) gridHelper.visible = show;
};

// Polar grid helper
export const createPolarGridHelper = (
  radius: number,
  sectors: number,
  rings: number,
  divisions: number
) => {
  const rootScene = getRootScene();
  if (!rootScene) return;
  const visible = polarGridHelper
    ? polarGridHelper.visible
    : getDebugToolsState().helpers.showPolarGridHelper;
  if (polarGridHelper) {
    polarGridHelper.removeFromParent();
    polarGridHelper.dispose();
  }
  polarGridHelper = new THREE.PolarGridHelper(radius, sectors, rings, divisions);
  polarGridHelper.visible = visible;
  rootScene.add(polarGridHelper);
};
export const togglePolarGridHelperVisibility = (show: boolean) => {
  if (!polarGridHelper && show) {
    const debugToolsState = getDebugToolsState();
    createPolarGridHelper(
      debugToolsState.helpers.polarGridRadius,
      debugToolsState.helpers.polarGridSectors,
      debugToolsState.helpers.polarGridRings,
      debugToolsState.helpers.polarGridDivisions
    );
  }
  if (polarGridHelper) polarGridHelper.visible = show;
};
