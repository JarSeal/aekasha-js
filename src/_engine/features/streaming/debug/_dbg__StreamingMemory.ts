// What the streaming cells hold (docs/plans/p353_macro-streaming-grid.md §7): each cell's GPU bytes
// from the GPU memory tab's owners (three's own per-object bytes, an asset several cells share
// counted under their scene, `getMemoryOwner`), and the registered assets a cell's owner key is on.
// Both walk every registered asset: read once per refresh, for the Streaming tab and cell window.
import { collectGPUAssets } from '../../../debug/gpuMemory/_dbg__GPUMemoryOwners';
import { getAssetOwners } from '../../../kernel/assets/AssetOwners';
import { getGeometryRegistry } from '../../../kernel/assets/Geometry';
import { getMaterialRegistry } from '../../../kernel/assets/Material';
import { getTextureRegistry } from '../../../kernel/assets/Texture';
import { getRenderer } from '../../../kernel/render/Renderer';

/** GPU bytes per owner key, the cells' among them (empty before the renderer exists). */
export const getOwnerGPUBytes = (): Map<string, number> => {
  const bytes = new Map<string, number>();
  const renderer = getRenderer();
  if (!renderer) return bytes;
  for (const row of collectGPUAssets(renderer)) {
    if (row.bytes) bytes.set(row.owner, (bytes.get(row.owner) ?? 0) + row.bytes);
  }
  return bytes;
};

/** The registered assets an owner key is on, by kind: what the cell's release would look at. */
export const getOwnedAssetIds = (ownerKey: string) => {
  const ids = { textures: [] as string[], geometries: [] as string[], materials: [] as string[] };
  const isOwned = (asset: object) => getAssetOwners(asset).includes(ownerKey);
  for (const [id, entry] of Object.entries(getTextureRegistry())) {
    if (isOwned(entry.resource)) ids.textures.push(id);
  }
  for (const [id, entry] of Object.entries(getGeometryRegistry())) {
    if (isOwned(entry.resource)) ids.geometries.push(id);
  }
  for (const [id, entry] of Object.entries(getMaterialRegistry())) {
    if (isOwned(entry.resource)) ids.materials.push(id);
  }
  return ids;
};
