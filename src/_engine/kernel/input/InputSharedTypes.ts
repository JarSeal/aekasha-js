// NOTE! Type-only file: everything here is erased at build time, so importing it broadly
// does not defeat the file-boundary tree-shaking (one file per input device, no barrel).
import type * as THREE from 'three/webgpu';

/** Whether a binding or an action map fires while the debug (orbit) camera is active (debug env
 * only; outside it, always): always (`ENABLED_IN_DEBUG`, a binding's default), only then, or never
 * then. An action map's default is its context's (`ActionMapOpts.enabledInDebugCam`). */
export type EnabledInDebugCam =
  | 'ENABLED_IN_DEBUG'
  | 'ENABLED_ONLY_IN_DEBUG'
  | 'NOT_ENABLED_IN_DEBUG';

/** The modifier keys a {@link _engine/kernel/input/KeyboardInput!KeyChord} needs held (each one
 * not set must be up). */
export type Modifiers = {
  /** Control */
  ctrl?: boolean;
  /** Shift */
  shift?: boolean;
  /** Alt (Option on macOS) */
  alt?: boolean;
  /** Meta (Command on macOS, the Windows key on Windows) */
  meta?: boolean;
};

/** Optional metadata every binding type carries, for a shortcut list or a rebinding screen. */
export type BindingMeta = {
  /** A short name to show */
  name?: string;
  /** What the binding does */
  description?: string;
  /** Raw SVG strings, as the icon registry takes them (`registerIcon`, `aekasha/ui`). */
  icons?: string[];
};

/** A static list of raycast targets, or a getter evaluated at raycast time (Mouse/Touch). */
export type TargetList = THREE.Object3D[] | (() => THREE.Object3D[]);
