import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import { lerror } from '../../utils/Logger';
import type { DebugModuleRef } from '../../kernel/config/DebugModules';
import { loadDebugModuleAsync, useDebug } from '../../kernel/config/DebugModules';
import { getECSWorld } from '../../kernel/ecs/ECS';
import { registerGPUMemorySource } from '../GPUMemory';
import { markDebugHelper } from '../Profiler';

const symbols: {
  camera?: THREE.Group;
  point?: THREE.Group;
  spot?: THREE.Group;
  directional?: THREE.Group;
} = {};

type SymbolsModule = DebugModuleRef<typeof import('./_dbg__Symbols')> | null;

/**
 * Loads the 3D symbols (the camera and light icons in the scene) and attaches them: the boot's
 * debug step.
 * @internal
 */
export const load3DSymbols = async () => {
  if (!IS_DEBUG_ENV) return;

  // The `import()` inside `__AEK_DEBUG__ ? … : null`, not only in the loader: a production build
  // then drops it before Rollup loads `_dbg__Symbols.ts`, so Vite never emits the GLB and the PNG
  // that module imports (p611 D5). The loader's own check, or an early return on `__AEK_DEBUG__`,
  // drops the chunk but still loads the module, and Vite emits a `?url` file when it loads one.
  const symbolsModule: SymbolsModule = __AEK_DEBUG__
    ? await loadDebugModuleAsync(() => import('./_dbg__Symbols'))
    : null;
  const symbolsDebug = useDebug(symbolsModule);
  if (!symbolsDebug) return;
  const { symbolsModelUrl, symbolsTextureUrl } = symbolsDebug;

  const modelLoader = new GLTFLoader();
  const textureLoader = new THREE.TextureLoader();

  try {
    const symbolsTexture = await textureLoader.loadAsync(symbolsTextureUrl);
    symbolsTexture.colorSpace = THREE.SRGBColorSpace;
    symbolsTexture.flipY = false;
    registerGPUMemorySource({
      id: 'debug.3dSymbols',
      label: 'Debug 3D symbols (debug only)',
      getResources: () => {
        const resources: (THREE.Texture | THREE.BufferGeometry)[] = [symbolsTexture];
        for (const group of Object.values(symbols)) {
          group.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) resources.push((o as THREE.Mesh).geometry);
          });
        }
        return resources;
      },
    });

    const symbolMaterial = new THREE.MeshBasicMaterial({
      map: symbolsTexture,
      // alphaTest: 0.5,
    });

    const outlineMaterial = new THREE.MeshBasicMaterial({
      color: 0x333333,
      side: THREE.BackSide,
    });

    const gltf = await modelLoader.loadAsync(symbolsModelUrl);

    // Create a helper to process a mesh into a double-mesh group
    const processMeshIntoGroup = (mesh: THREE.Mesh, key: string): THREE.Group => {
      const root = new THREE.Group();
      root.name = `SymbolRoot_${key}`;

      const inner = new THREE.Group();
      inner.name = `SymbolInner_${key}`;
      inner.userData.isLookAtHolder = true;
      root.add(inner);

      const icon = mesh.clone();
      icon.material = symbolMaterial;
      icon.position.set(0, 0, 0);
      icon.userData.isIcon = true;
      inner.add(icon);

      const outline = mesh.clone();
      outline.position.set(0, 0, 0);
      outline.material = outlineMaterial;
      outline.userData.isOutline = true;
      inner.add(outline);

      if (key === 'camera') {
        outline.position.set(0.01, -0.02, -0.07);
        outline.scale.set(1.1, 1.05, 1.1);
        root.userData.isCameraSymbol = true;

        // Main-camera indicator: a sphere through the icon's thinnest local axis, sized
        // and placed near the base of the icon so it clearly pokes out on both sides
        // from any viewing angle without swallowing the whole icon. Computed from the
        // icon's actual geometry so it stays correct if the GLB is ever re-exported
        // with different proportions.
        icon.updateMatrix();
        if (!icon.geometry.boundingBox) icon.geometry.computeBoundingBox();
        const box = icon.geometry.boundingBox!.clone().applyMatrix4(icon.matrix);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const radius = Math.min(size.x, size.y, size.z) * 0.8;

        const indicator = new THREE.Mesh(
          new THREE.SphereGeometry(radius, 12, 8),
          new THREE.MeshBasicMaterial({ color: 0x555555 })
        );
        indicator.name = 'mainCameraIndicator';
        // Position so the sphere's *bottom edge* sits just above the icon's base
        // (not its center) — a small gap so it doesn't touch/clip past the base.
        indicator.position.set(center.x, box.min.y + radius - size.y * 0.025, center.z * 0.88);
        indicator.visible = false; // toggled per-instance in debugSymbolSyncSystem
        inner.add(indicator); // same parent as icon/outline — sphere is rotation-invariant, no lookAt needed
      } else if (key === 'point') {
        outline.position.set(0, 0.01, 0);
        outline.scale.set(1.19, 1.12, 1.19);
        root.userData.isPointLightSymbol = true;
      } else if (key === 'directional' || key === 'spot') {
        outline.scale.set(1.1, 1.1, 1.1);
        if (key === 'directional') root.userData.isDirectionLightSymbol = true;
        if (key === 'spot') root.userData.isSpotLightSymbol = true;
      }

      return root;
    };

    gltf.scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      if (child.userData.isCamera) {
        symbols.camera = processMeshIntoGroup(child, 'camera');
      } else if (child.userData.isPointLight) {
        symbols.point = processMeshIntoGroup(child, 'point');
      } else if (child.userData.isSpotLight) {
        symbols.spot = processMeshIntoGroup(child, 'spot');
      } else if (child.userData.isDirectionalLight) {
        symbols.directional = processMeshIntoGroup(child, 'directional');
      }
    });

    // This is just to auto attach the symbols in case there were some without them.
    symbolsDebug.autoAttachSymbols(getECSWorld());
  } catch (err) {
    lerror('Failed to load engine 3D Symbol Icons GLB', err);
  }
};

// Generic internal helper for cloning symbols
const createSymbolClone = (template?: THREE.Group): THREE.Group | null => {
  if (!template) return null;
  const clone = template.clone();
  clone.userData.isHelperSymbol = true;
  markDebugHelper(clone);

  // Per-instance materials so tinting one light's gizmo (docs/plans/light-culling.md §10)
  // never affects any other — Object3D.clone() copies material references, not values,
  // so without this every symbol would share the same two template materials.
  // `transparent = true` is required for the culled-state opacity fade to have any effect.
  clone.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const mat = (child.material as THREE.Material).clone();
    mat.transparent = true;
    child.material = mat;
  });

  return clone;
};

/**
 * A camera's 3D symbol, a clone with its own materials (null before the symbols have loaded): the
 * symbols module's.
 * @internal
 */
export const createNewCameraSymbol = () => createSymbolClone(symbols.camera);
/**
 * A point light's 3D symbol, as {@link createNewCameraSymbol}: the symbols module's.
 * @internal
 */
export const createNewPointLightSymbol = () => createSymbolClone(symbols.point);
/**
 * A spot light's 3D symbol, as {@link createNewCameraSymbol}: the symbols module's.
 * @internal
 */
export const createNewSpotLightSymbol = () => createSymbolClone(symbols.spot);
/**
 * A directional light's 3D symbol, as {@link createNewCameraSymbol}: the symbols module's.
 * @internal
 */
export const createNewDirectionalLightSymbol = () => createSymbolClone(symbols.directional);
