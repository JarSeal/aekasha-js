// Its own module: `lod()`'s install reaches it (the prebuilt LOD chains' keys), and a module
// another chunk imports goes into the main chunk whole, so GLTFExtract.ts stays out of it.

/**
 * A mesh primitive's key in a glTF file (its mesh index and primitive index): what prebuilt
 * per-primitive data, like the LOD chains (`GLTFLodChains`), is keyed by.
 * @internal
 */
export const getGLTFPrimitiveKey = (mesh: number, primitive: number) => `${mesh}:${primitive}`;
