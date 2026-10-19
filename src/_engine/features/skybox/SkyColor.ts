import * as THREE from 'three/webgpu';
import { toThreeColor } from '../../kernel/render/ThreeMath';
import type { ColorJSON } from '../../schemas/_HelperSchemas';

/**
 * A JSON colour (`'#rrggbb'`, or `{ r, g, b }` in 0-255) as a THREE.Color in the working colour
 * space (linear). Both forms are sRGB, as the kernel reads them (`toThreeColor`): one colour
 * written either way renders the same. A new Color per call: for activation and updates, never
 * the per-frame path.
 * @internal
 */
export const toSkyColor = (color: ColorJSON) => new THREE.Color(toThreeColor(color));
