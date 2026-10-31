// The asset info window's shared grid items (p806 D10): the info rows as monitors (text, never
// HTML), a section's folder, the file size with its Measure button, and the pipeline's folder.
import type { PropertyGridItem } from '../../../ui/forms/PropertyGridItems';
import { getInfoRowItem } from '../../../debug/_dbg__DebugWindowGrid';
import { formatBytes } from './_dbg__AssetStats';
import { measureFileSizeAsync, type PipelineDescription } from './_dbg__AssetsData';

/** What an info window's items call back into it: the grid's refresh, and whether the content is
 * still there (what an `await` checks). */
export type AssetInfoCtx = {
  refresh: () => void;
  isMounted: () => boolean;
};

/** Label and value pairs as info rows. */
export const toInfoRows = (rows: readonly [string, string][]): PropertyGridItem[] =>
  rows.map(([label, value]) => getInfoRowItem(label, value));

/** A section of the window: a folder, its open state saved by `id` for every info window. */
export const getInfoFolder = (
  id: string,
  title: string,
  items: PropertyGridItem[]
): PropertyGridItem => ({ type: 'folder', id, title, items });

/**
 * The file size: the size baked in by gatherAppData, else a "Measure" button in its row (a HEAD
 * request for the content-length), whose result replaces it.
 */
export const getFileSizeItems = (
  label: string,
  bakedSize: number | undefined,
  urls: string[],
  ctx: AssetInfoCtx
): PropertyGridItem[] => {
  if (bakedSize !== undefined) return [getInfoRowItem(label, formatBytes(bakedSize))];
  if (!urls.length) return [getInfoRowItem(label, '—')];
  let measured: string | null = null;
  return [
    {
      type: 'button',
      label,
      title: 'Measure (HEAD request)',
      hidden: () => measured !== null,
      onClick: async () => {
        measured = 'Measuring…';
        ctx.refresh();
        const size = await measureFileSizeAsync(urls).catch(() => undefined);
        measured = size === undefined ? 'unknown (no content-length)' : formatBytes(size);
        if (ctx.isMounted()) ctx.refresh();
      },
    },
    {
      label,
      get: () => measured ?? '',
      readonly: true,
      interval: 'refresh',
      hidden: () => measured === null,
    },
  ];
};

/** The asset pipeline's folder (its title says when the figures are a whole import's). */
export const getPipelineFolder = (pipeline: PipelineDescription | undefined): PropertyGridItem[] =>
  pipeline ? [getInfoFolder('pipeline', pipeline.title, toInfoRows(pipeline.rows))] : [];
