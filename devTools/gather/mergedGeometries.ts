/**
 * A `MERGED` geometry's parts (p371 D2), checked: each part names a geometry JSON that isn't
 * `MERGED` itself, or an imported asset's piece (`<importId>/<nodeName>`; the node isn't known
 * before the import runs, so only the import is checked). Either fails the gather. A part the
 * scene doesn't list only warns: a persistent asset registered earlier can still be merged.
 */
import type { GeoAsset } from '../../src/_engine/schemas';
import type { GatherContext, Registries } from './context';
import type { SceneJSON } from './sceneAssets';

type MergedProps = Extract<GeoAsset['geoProps'], { type: 'MERGED' }>;

/** The import a part id is a piece of, or undefined */
const getPartImportId = (reg: Registries, partId: string) =>
  Object.keys(reg.importedAssets).find((importId) => partId.startsWith(`${importId}/`));

/** Logs (and fails the gather for) each part no asset JSON has, and each `MERGED` one */
const checkPartIds = (ctx: GatherContext, reg: Registries, where: string, props: MergedProps) => {
  props.params.parts.forEach(({ geo }, i) => {
    const geometry = reg.geometries[geo];
    if (geometry?.geoProps.type === 'MERGED') {
      ctx.log.error(
        `${where}: part ${i} "${geo}" is a MERGED geometry; list its parts instead (a merge doesn't nest).`
      );
    } else if (!geometry && !getPartImportId(reg, geo)) {
      ctx.log.error(
        `${where}: part ${i} "${geo}" is no geometry JSON's id, nor a piece (<importId>/<nodeName>) of an imported asset.`
      );
    }
  });
};

/** Pass 1's check: every `MERGED` geometry JSON's parts, whether a scene lists it or not */
export const checkMergedGeometryJsons = (ctx: GatherContext, reg: Registries) => {
  for (const [geoId, { geoProps, __sourcePath }] of Object.entries(reg.geometries)) {
    if (geoProps.type !== 'MERGED') continue;
    checkPartIds(ctx, reg, `Geometry "${geoId}" (${__sourcePath})`, geoProps);
  }
};

const getListedIds = (list: unknown[] | undefined) =>
  new Set(
    (list ?? []).flatMap((entry) => {
      const id = typeof entry === 'string' ? entry : (entry as { id?: unknown } | null)?.id;
      return typeof id === 'string' ? [id] : [];
    })
  );

/**
 * The scene pass's check, on a scene's resolved geometries: an inline `MERGED` geometry's part
 * ids (a geometry JSON's were checked in pass 1), and a warning for each part whose geometry or
 * import the scene doesn't list.
 */
export const checkSceneMergedGeometries = (
  ctx: GatherContext,
  reg: Registries,
  sceneId: string,
  scene: SceneJSON
) => {
  const geometries = scene.geometries ?? [];
  const listedGeometries = getListedIds(geometries);
  const listedImports = getListedIds(scene.importedAssets);
  geometries.forEach((entry, index) => {
    if (typeof entry === 'string' || entry.type !== 'MERGED') return;
    const geoId = entry.id ?? `geometry-${index}`;
    if (!entry.id || !reg.geometries[entry.id]) {
      checkPartIds(ctx, reg, `Scene "${sceneId}": inline geometry "${geoId}"`, entry);
    }
    for (const { geo } of entry.params.parts) {
      const importId = reg.geometries[geo] ? undefined : getPartImportId(reg, geo);
      const isListed = importId ? listedImports.has(importId) : listedGeometries.has(geo);
      if (isListed || (!importId && !reg.geometries[geo])) continue;
      ctx.log.warn(
        `Scene "${sceneId}": the MERGED geometry "${geoId}" merges "${geo}", but the scene doesn't list ${importId ? `the imported asset "${importId}"` : 'that geometry'}: it merges only if a persistent asset registered it earlier.`
      );
    }
  });
};
