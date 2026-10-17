export interface PhysVector {
  x: number;
  y: number;
  z: number;
}
export interface PhysRotation {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * Transforms an engine interface into a Main Thread Proxy interface.
 * - Methods returning 'void' stay 'void' (Fire-and-forget).
 * - Methods returning a value become 'Promise<value>' (Request-Response).
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
 */
export type OmitSync<T> = {
  [K in keyof T as K extends `${string}Sync` ? never : K]: T[K];
};
