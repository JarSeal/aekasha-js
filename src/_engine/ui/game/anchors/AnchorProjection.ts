/** The camera a world anchor layer's `update` projects with, as plain numbers (no three
 * import): keep one object and write it each frame, so the update allocates nothing. */
export type WorldAnchorView = {
  /** The camera's view-projection matrix as 16 numbers, column-major: a `THREE.Matrix4`'s
   * `elements` as they are (`projectionMatrix × matrixWorldInverse`). */
  viewProjection: ArrayLike<number>;
  /** The width of what the camera renders into, in CSS px (`getCanvasSize().width`). */
  width: number;
  /** Its height, in CSS px. */
  height: number;
  /** The camera's world position: the anchors' distances are measured from it. */
  cameraPosition: { x: number; y: number; z: number };
};

/**
 * What `projectWorldPoint` found: the point on the screen inside the bounds.
 * @internal
 */
export const PROJECTED_SHOWN = 0;
/**
 * The point is off the screen (or behind the camera), placed on the padded edge toward it.
 * @internal
 */
export const PROJECTED_CLAMPED = 1;
/**
 * The point isn't shown: off the screen without clamping, or past its distance.
 * @internal
 */
export const PROJECTED_HIDDEN = 2;

/**
 * A point `projectWorldPoint` projects: an anchor's record has these fields.
 * @internal
 */
export type AnchorPoint = {
  /** Its world position */
  x: number;
  /** Its world position */
  y: number;
  /** Its world position */
  z: number;
  /** Moves it onto the padded edge when it's off the screen, instead of hiding it */
  clamp: boolean;
  /** Hidden past this distance from the camera */
  maxDistance: number;
};

/** A `w` at or under this is behind the camera (or on its plane) */
const BEHIND_W = 1e-6;

/**
 * Projects a world point for the anchor layer (p808 D7), writing `out[0]` and `out[1]` (the
 * screen position from the top left, CSS px), `out[2]` (a clamped point's direction from the
 * screen's centre, radians, 0 to the right, clockwise: y down) and `out[3]` (its distance from
 * the camera), and returns `PROJECTED_*`. No allocation: a frame calls it for every anchor.
 * - In front and inside the screen: shown (with `clamp`, only inside the edge padding; between
 *   the padding and the edge it's clamped).
 * - Off the screen or behind the camera: hidden, or with `clamp` moved onto the padded edge along
 *   its direction from the centre. Behind the camera the clip coordinates are used undivided,
 *   since dividing by a negative `w` mirrors them; straight behind points down.
 * - Past `maxDistance`: hidden, clamped or not.
 * @internal
 */
export const projectWorldPoint = (
  view: WorldAnchorView,
  point: AnchorPoint,
  padding: number,
  out: Float64Array
) => {
  const { x, y, z } = point;
  const camera = view.cameraPosition;
  const dx = x - camera.x;
  const dy = y - camera.y;
  const dz = z - camera.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  out[3] = distance;
  if (distance > point.maxDistance) return PROJECTED_HIDDEN;

  const e = view.viewProjection;
  const clipX = e[0] * x + e[4] * y + e[8] * z + e[12];
  const clipY = e[1] * x + e[5] * y + e[9] * z + e[13];
  const clipW = e[3] * x + e[7] * y + e[11] * z + e[15];
  const halfW = view.width / 2;
  const halfH = view.height / 2;

  // Relative to the screen's centre, y down
  let sx: number;
  let sy: number;
  if (clipW > BEHIND_W) {
    sx = (clipX / clipW) * halfW;
    sy = -(clipY / clipW) * halfH;
    const isOnScreen = Math.abs(sx) <= halfW && Math.abs(sy) <= halfH;
    if (!point.clamp) {
      if (!isOnScreen) return PROJECTED_HIDDEN;
      out[0] = halfW + sx;
      out[1] = halfH + sy;
      return PROJECTED_SHOWN;
    }
    if (isOnScreen && Math.abs(sx) <= halfW - padding && Math.abs(sy) <= halfH - padding) {
      out[0] = halfW + sx;
      out[1] = halfH + sy;
      return PROJECTED_SHOWN;
    }
  } else {
    if (!point.clamp) return PROJECTED_HIDDEN;
    // Undivided: the direction stays the right way round behind the camera
    sx = clipX * halfW;
    sy = -clipY * halfH;
    if (sx === 0 && sy === 0) sy = 1;
  }

  // Onto the padded rectangle along the direction from the centre
  const limitX = Math.max(0, halfW - padding);
  const limitY = Math.max(0, halfH - padding);
  const absX = Math.abs(sx);
  const absY = Math.abs(sy);
  const scaleX = absX > 0 ? limitX / absX : Infinity;
  const scaleY = absY > 0 ? limitY / absY : Infinity;
  const scale = Math.min(scaleX, scaleY);
  out[0] = halfW + sx * scale;
  out[1] = halfH + sy * scale;
  // + 0: a -0 (a point level with the centre) would turn a left arrow to -180°
  out[2] = Math.atan2(sy + 0, sx);
  return PROJECTED_CLAMPED;
};
