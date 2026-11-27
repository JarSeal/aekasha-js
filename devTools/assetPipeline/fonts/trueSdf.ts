import type { Contour } from './outline';

/**
 * The true signed distance field (p391 D1): an MTSDF's alpha, and an SDF's one channel. Phase 1's
 * method: each pixel centre's distance to the nearest outline segment, signed by non-zero winding
 * (inside positive), mapped as msdfgen maps its channels (`distance / range + 0.5`, the byte
 * `clamp(256 x)`), in the projection msdfgen-wasm's `computeGlpyhMsdfData` gives the glyph's tile.
 * Brute force over every segment: a Latin 1 font at 48 px is about a tenth of a second.
 */

/** Where a glyph's tile is in em space: msdfgen-wasm's `MsdfData` (`scale` px per em, `range` in em) */
export type SdfProjection = {
  scale: number;
  xTranslate: number;
  yTranslate: number;
  range: number;
};

/**
 * A glyph's true SDF, one byte per pixel, its rows top first (as msdfgen-wasm's bitmaps are):
 * pixel (x, row) samples the em point `((x + 0.5) / scale − xTranslate, (height − row − 0.5) /
 * scale − yTranslate)`.
 * @param contours The outline in em units, y up (`flattenOutline`)
 */
export const generateTrueSdf = (
  contours: readonly Contour[],
  projection: SdfProjection,
  width: number,
  height: number
): Uint8Array => {
  // A Uint8ClampedArray rounds as msdfgen-wasm's bitmap does
  const out = new Uint8ClampedArray(width * height);
  const { scale, xTranslate, yTranslate, range } = projection;
  for (let row = 0; row < height; row++) {
    const py = (height - row - 0.5) / scale - yTranslate;
    for (let x = 0; x < width; x++) {
      const px = (x + 0.5) / scale - xTranslate;
      let nearest = Infinity;
      let winding = 0;
      for (const contour of contours) {
        const n = contour.length;
        let ax = contour[n - 2];
        let ay = contour[n - 1];
        for (let i = 0; i < n; i += 2) {
          const bx = contour[i];
          const by = contour[i + 1];
          const ex = bx - ax;
          const ey = by - ay;
          const wx = px - ax;
          const wy = py - ay;
          const lengthSq = ex * ex + ey * ey;
          const t = lengthSq ? Math.min(1, Math.max(0, (wx * ex + wy * ey) / lengthSq)) : 0;
          const dx = wx - t * ex;
          const dy = wy - t * ey;
          const distanceSq = dx * dx + dy * dy;
          if (distanceSq < nearest) nearest = distanceSq;
          const side = ex * wy - wx * ey;
          if (ay <= py) {
            if (by > py && side > 0) winding++;
          } else if (by <= py && side < 0) {
            winding--;
          }
          ax = bx;
          ay = by;
        }
      }
      const distance = Math.sqrt(nearest);
      const signed = winding !== 0 ? distance : -distance;
      out[row * width + x] = (signed / range + 0.5) * 256;
    }
  }
  return new Uint8Array(out.buffer);
};
