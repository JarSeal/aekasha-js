import {
  mix,
  normalView,
  normalWorld,
  positionLocal,
  positionViewDirection,
  smoothstep,
  time,
} from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';

// The banner's material (p611 D8): every input arrives as a uniform from the material JSON
// (`bannerAether.material.json`), numbers as floats, hex strings as colours. The shape's flat
// faces (a polyhedron's normals are its faces') give each face one tint of the gradient and rim.

/** Indigo at the bottom to teal at the top, in the shape's own space (it turns with it) */
export const colorNode = (inputs: { colorLow: Node<'color'>; colorHigh: Node<'color'> }) =>
  mix(inputs.colorLow, inputs.colorHigh, smoothstep(-1, 1, positionLocal.y));

/** A cyan rim that glows where a face turns away from the camera, breathing slowly, and a warm
 * glow on the faces turned upward, which travels over the shape as it turns */
export const emissiveNode = (inputs: {
  rimColor: Node<'color'>;
  rimPower: Node<'float'>;
  rimIntensity: Node<'float'>;
  pulseSpeed: Node<'float'>;
  warmColor: Node<'color'>;
  warmIntensity: Node<'float'>;
}) => {
  const facing: Node<'float'> = normalView.dot(positionViewDirection).abs();
  const pulse: Node<'float'> = time.mul(inputs.pulseSpeed).sin().mul(0.15).add(0.85);
  const strength: Node<'float'> = facing
    .oneMinus()
    .pow(inputs.rimPower)
    .mul(inputs.rimIntensity)
    .mul(pulse);
  const warmth: Node<'float'> = normalWorld.y.smoothstep(0.4, 1).mul(inputs.warmIntensity);
  return inputs.rimColor.mul(strength).add(inputs.warmColor.mul(warmth));
};
