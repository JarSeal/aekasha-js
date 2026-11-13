import {
  cross,
  dFdx,
  dFdy,
  dot,
  faceDirection,
  float,
  mix,
  normalMap,
  normalView,
  positionView,
  uv,
} from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { MeshStandardNodeMaterial, Node, TextureNode } from 'three/webgpu';
import type { TextureSetInput } from 'aekasha/texturesets';
import { applyLiteSurface } from './liteSurface';

/** The MINIMAL packing's roughness: it has no roughness map */
const MINIMAL_ROUGHNESS = 0.8;

/**
 * A view-space normal bumped by a height in metres (Mikkelsen, "Bump Mapping Unparametrized
 * Surfaces on the GPU", as the toolkit's asteroid material): screen-space derivatives, no extra
 * fetch. Not three's `bumpMap`: it normalizes the surface derivatives, so its scale is height per
 * screen pixel and the bump changes with the distance.
 */
const bumpNormal = (height: Node<'float'>) => {
  const sigmaX = dFdx(positionView);
  const sigmaY = dFdy(positionView);
  const n = normalView;
  const r1 = cross(sigmaY, n);
  const r2 = cross(n, sigmaX);
  const det = dot(sigmaX, r1).mul(faceDirection);
  const grad = det.sign().mul(r1.mul(dFdx(height)).add(r2.mul(dFdy(height))));
  return det.abs().mul(n).sub(grad).normalize();
};

/**
 * The graph of the `textureSets` scene's three materials (`p303SetLiteMat`, `p303SetFullMat`,
 * `p303SetMinimalMat`), p303 Phase 1's exit: `surface` is `{ "textureSet": "p303TestSet" }` with
 * each material's packing, so the bundle holds that packing's slots only (D2's table) and the set's
 * uniforms. One tile covers `physicalSize` metres at the mesh's UV (a quad of 1 × 1 UV is a metre
 * square); the surface fields scale what they name.
 * - `FULL`: albedo × `tint`, the `normal` map at `normalStrength`, `orm`'s AO (`aoStrength`) and
 *   roughness.
 * - `LITE`: albedo × AO × `tint`, roughness from its alpha, the normal's X and Y (Z reconstructed).
 * - `MINIMAL`: albedo × AO × `tint`, a bump from its alpha's height (`heightScale` metres of
 *   relief, screen-space derivatives: `bumpNormal`), a constant roughness.
 */
export const setup = (inputs: { surface: TextureSetInput }, material: MeshStandardNodeMaterial) => {
  const set = inputs.surface;
  const tileUv = (uv() as unknown as Node<'vec2'>).div(set.physicalSize);
  const sample = (node: TextureNode) => node.sample(tileUv) as unknown as Node<'vec4'>;
  const strength = set.normalStrength as unknown as Node<'float'>;
  const roughnessScale = set.roughnessScale as unknown as Node<'float'>;
  const tint = set.tint as unknown as Node<'vec3'>;
  material.metalnessNode = float(0);

  if (set.normal && set.orm && set.albedoHeight) {
    const orm = sample(set.orm);
    material.colorNode = sample(set.albedoHeight).rgb.mul(tint);
    material.normalNode = normalMap(sample(set.normal).rgb, strength);
    material.aoNode = mix(float(1), orm.r, set.aoStrength as unknown as Node<'float'>);
    material.roughnessNode = orm.g.mul(roughnessScale);
  } else if (set.albedoRough && set.normalHeight) {
    // The set array's material shades a layer with the same graph (p303SetArrayMat.tsl.ts)
    applyLiteSurface(material, {
      albedoRough: sample(set.albedoRough),
      normalHeight: sample(set.normalHeight),
      tint,
      normalStrength: strength,
      roughnessScale,
    });
  } else if (set.albedoHeight) {
    const albedoHeight = sample(set.albedoHeight);
    material.colorNode = albedoHeight.rgb.mul(tint);
    material.roughnessNode = roughnessScale.mul(MINIMAL_ROUGHNESS);
    // Height × heightScale is metres of relief, the view's units
    const heightScale = set.heightScale as unknown as Node<'float'>;
    material.normalNode = bumpNormal(albedoHeight.a.mul(heightScale).mul(strength));
  }
};
