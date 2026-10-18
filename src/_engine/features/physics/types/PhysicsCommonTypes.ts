/** A vector as the Physics API reads and returns it: plain data, so a `THREE.Vector3` passes. */
export interface PhysVector {
  /** The x component. */
  x: number;
  /** The y component. */
  y: number;
  /** The z component. */
  z: number;
}

/**
 * A rotation quaternion as the Physics API reads and returns it: plain data, so a
 * `THREE.Quaternion` passes on MAIN_THREAD (the facade copies one to plain fields before it crosses
 * to the worker).
 */
export interface PhysRotation {
  /** The x component. */
  x: number;
  /** The y component. */
  y: number;
  /** The z component. */
  z: number;
  /** The w (scalar) component. */
  w: number;
}

/**
 * Transforms an engine interface into a Main Thread Proxy interface.
 * - Methods returning 'void' stay 'void' (Fire-and-forget).
 * - Methods returning a value become 'Promise<value>' (Request-Response).
 * @template T the engine interface
 * @internal
 */
export type PhysicsBridge<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => void
    ? (...args: A) => void // Setters stay void
    : T[K] extends (...args: infer A) => infer R
      ? (...args: A) => Promise<Awaited<R>> // Getters become Promises
      : T[K]; // Non-functions stay as-is
};

/**
 * Removes all properties and methods that end with the suffix "Sync".
 * @template T the interface to remove them from
 * @internal
 */
export type OmitSync<T> = {
  [K in keyof T as K extends `${string}Sync` ? never : K]: T[K];
};
