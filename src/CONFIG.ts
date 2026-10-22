// Type imports only: the asset pipeline imports this file in Node
import type { AppConfig } from 'aekasha';

const config: AppConfig = {
  // Debug-only key bindings. An engine default is changed by its id (only the given fields
  // change, `enabled: false` turns one off): { id: 'sc-toggle-debug-drawer', chord: { key: 'j' } }
  // moves the debug drawer from h to j. Any other id adds a debug key (needs `chord` and `fn`).
  debugKeys: [],
  physics: {
    enabled: true,
    worldStepEnabled: true,
    visualizerEnabled: false,
    gravity: { x: 0, y: -9.81, z: 0 },
    timestep: 60,
    solverIterations: 10,
    internalPgsIterations: 1,
    // 'RENDERER' for WORKER_THREAD; 'FIXED_PHYSICS' is only valid with 'MAIN_THREAD'.
    interpolationMode: 'RENDERER',
    workerTarget: 'WORKER_THREAD',
    useSAB: true,
  },
  // Per-state colors (0xrrggbb) for the physics collider wireframes, switched on per
  // entity from the Physics API debugger tab. Omit the whole section, or any single key,
  // to take the engine defaults instead.
  debugPhysicsWireframe: {
    colors: {
      disabled: 0x555555, // dark grey
      sensor: 0xb8a000, // dark yellow
      sleeping: 0x8b0000, // dark red
      kinematic: 0x2266ff, // blue
      fixed: 0xdddddd, // light grey
      awake: 0xff0000, // red
    },
    lineThickness: 1,
  },
  // Build-time asset optimization (KTX2 textures, meshopt geometry). Off passes the source
  // files through as they are, and needs no `ktx` encoder. Profiles are in assets.config.json.
  assets: {
    optimization: {
      enabled: true,
      textures: true,
      meshes: true,
    },
  },
  // Debug tools writing into the repo while `yarn dev` runs (debug env only). saveHistorySize:
  // the `__saveData` entries a save keeps per scene in an asset JSON (-1 = all, 0 = saving off).
  // The Debug tools tab's "File server" folder overrides it per browser.
  devFiles: {
    saveHistorySize: 20,
  },
  debugCamera: {
    position: { x: 3, y: 3, z: 1.5 },
    target: { x: 0, y: 0, z: 0 },
    fov: 60,
    near: 0.1,
    far: 1000,
    zoom: 1,
  },
};

export default config;
