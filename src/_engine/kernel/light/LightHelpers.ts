import type * as THREE from 'three/webgpu';

/**
 * A light's type and what it supports: a shadow, a position, distance and decay, a debug helper
 * and 3D symbol, a target, frustum culling and the spatial index.
 * @internal
 */
export const getLightCharacteristics = (light: THREE.Light) => {
  const c = {
    isAmbientLight: false,
    isHemisphereLight: false,
    isPointLight: false,
    isSpotLight: false,
    isDirectionalLight: false,
    canCastShadows: false,
    hasPosition: false,
    hasDistance: false,
    hasDecay: false,
    hasHelper: false,
    hasSymbol: false,
    hasTarget: false,
    supportsFrustumCulling: false,
    canBeSpatiallyIndexed: false,
  };

  // Type
  c.isAmbientLight = light.type === 'AmbientLight';
  c.isHemisphereLight = light.type === 'HemisphereLight';
  c.isPointLight = light.type === 'PointLight';
  c.isSpotLight = light.type === 'SpotLight';
  c.isDirectionalLight = light.type === 'DirectionalLight';

  // Shadow
  if (!c.isAmbientLight && !c.isHemisphereLight) c.canCastShadows = true;

  // Position
  if (c.isPointLight || c.isSpotLight || c.isDirectionalLight) {
    c.hasPosition = true;
  }

  // Distance and decay
  if (c.isPointLight || c.isSpotLight) {
    c.hasDistance = true;
    c.hasDecay = true;
  }

  // Frustum culling: point and spot lights only (a directional or ambient light lights everything)
  c.supportsFrustumCulling = c.isPointLight || c.isSpotLight;

  // Spatial index (point/spot only — see docs/plans/_DONE_p050_spatial-index.md §3.1/§9.1). Same
  // condition as supportsFrustumCulling today (a directional light has no bounded influence
  // volume to place in a grid cell, same reason it's excluded from frustum culling), kept as
  // its own flag since the two concepts could diverge for a future light type.
  c.canBeSpatiallyIndexed = c.isPointLight || c.isSpotLight;

  // Helper
  if (c.isPointLight || c.isSpotLight || c.isDirectionalLight) {
    c.hasHelper = true;
  }

  // Symbol
  if (c.isPointLight || c.isSpotLight || c.isDirectionalLight) {
    c.hasSymbol = true;
  }

  // Target
  if ('target' in light) c.hasTarget = true;

  return c;
};
