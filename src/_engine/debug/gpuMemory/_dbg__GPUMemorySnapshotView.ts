// The GPU memory tab's snapshot section on the UI kit (p807 D8, D9), out of
// `_dbg__GPUMemoryView.ts` so it stays under 800 lines: since the snapshot, the categories that
// changed, what earlier scene visits left behind and the registered assets that changed. Built once
// per mount on the tab's scheduler; `update` reads the diff into the rows the tables read and writes
// the texts in place.
import type { Renderer } from 'three/webgpu';
import { CMP } from '../../ui/core/CMP';
import { createTable } from '../../ui/data/Table';
import type { TableColumn, TableTone } from '../../ui/data/TableTypes';
import type { BindingScheduler } from '../../ui/forms/binding/BindingScheduler';
import { formatBytes, formatNumber } from '../../kernel/assets/debug/_dbg__AssetStats';
import {
  createNameCell,
  createNote,
  createTextWriter,
  writeSub,
  type TwoLineRow,
} from '../profiler/_dbg__ProfilerParts';
import { ALLOCATION_KIND_LABELS } from './_dbg__GPUMemoryAllocations';
import type { GPUAssetRow } from './_dbg__GPUMemoryOwners';
import {
  getGPUMemoryDiff,
  getGPUMemorySnapshot,
  type AllocationGroup,
  type GPUMemoryDiff,
} from './_dbg__GPUMemorySnapshots';
import { createRowPool, formatTime, getOwnerLabel, MEMORY_CATEGORIES } from './_dbg__GPUMemoryView';
import styles from './GPUMemory.module.scss';

/** Rows per diff table; "Log diff" prints them all. */
const DIFF_MAX_ROWS = 12;

const formatDelta = (delta: number, format: (n: number) => string) =>
  delta === 0 ? '0' : `${delta > 0 ? '+' : '−'}${format(Math.abs(delta))}`;
const formatBytesDelta = (delta: number) => formatDelta(delta, formatBytes);
const formatCountDelta = (delta: number) => formatDelta(delta, formatNumber);

/** What the snapshot section reads from the tab (`_dbg__GPUMemory.ts`). */
export type GPUMemorySnapshotViewOpts = {
  getRenderer: () => Renderer | null | undefined;
  /** "Call sites" is on: the allocations made from then on have their call site */
  isRecordingSites: () => boolean;
};

/** A diff table's "+N more" footer row (Log diff lists them all) and its total, when it has one:
 * the row header's text alone, the figures empty */
type FooterRow = TwoLineRow & { id: string; isMore?: boolean };

const moreLabel = (total: number) =>
  `+${formatNumber(total - DIFF_MAX_ROWS)} more (Log diff lists all)`;

const footerTone = (row: { isMore?: boolean }): TableTone | null => (row.isMore ? 'muted' : null);

// --- THE CATEGORIES ---

type CategoryChange = { id: string; label: string; size: number; count: number };

/** One row per `info.memory` category that changed, by its size and count keys. */
const readCategoryChanges = (diff: GPUMemoryDiff) => {
  const delta = (key: string) => {
    const change = diff.memory.find((c) => c.key === key);
    return change ? change.after - change.before : 0;
  };
  const rows: CategoryChange[] = [
    ...MEMORY_CATEGORIES.map((c) => ({
      id: c.count,
      label: c.label,
      size: delta(c.size),
      count: delta(c.count),
    })),
    { id: 'renderTargets', label: 'Render targets', size: 0, count: delta('renderTargets') },
    { id: 'geometries', label: 'Geometries', size: 0, count: delta('geometries') },
  ];
  return { total: delta('total'), rows: rows.filter((row) => row.size !== 0 || row.count !== 0) };
};

// --- LEFT BEHIND ---

type LeftRow = FooterRow & { count: number | null; bytes: number | null };

const getLeftKey = (group: AllocationGroup, seen: Map<string, number>) => {
  const base = `${group.kind}:${group.scene}:${group.visit}:${group.label}:${group.site ?? ''}`;
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n ? `${base}#${n}` : base;
};

const getLeftSub = (group: AllocationGroup) =>
  `${getOwnerLabel(group.scene)}, visit ${group.visit}${group.site ? ` · ${group.site}` : ''}${group.collected ? ` · ${formatNumber(group.collected)} collected` : ''}`;

// --- THE ASSETS ---

type AssetRow = FooterRow & { before: number | null; after: number | null };

// --- THE SECTION ---

/**
 * The tab's snapshot section, built once per mount: a note while there's no snapshot, else the
 * diff since it. `update` reads the diff (once) into what its tables read and writes its texts.
 * @internal
 */
export const createGPUMemorySnapshotView = (
  opts: GPUMemorySnapshotViewOpts,
  scheduler: BindingScheduler
) => {
  const section = CMP({ class: ['profilerSection', styles.gpuMemorySection] });
  const writeHeading = createTextWriter(
    section.add({ tag: 'h4' }).elem.appendChild(document.createTextNode('Snapshot'))
  );
  const none = createNote();
  section.add(none.cmp);
  const body = section.add({ class: styles.gpuMemorySnapshot });

  const head = body.add({ class: styles.gpuMemoryTotalRow });
  head.add({ tag: 'span', text: 'Total' });
  const writeTotal = createTextWriter(
    head.add({ tag: 'strong' }).elem.appendChild(document.createTextNode(''))
  );

  let categories: CategoryChange[] = [];
  const categoriesTable = createTable<CategoryChange>({
    caption: 'GPU memory categories since the snapshot',
    captionHidden: true,
    class: 'gpuMemorySnapshotCategories',
    columns: [
      { key: 'label', label: 'Category', rowHeader: true },
      {
        key: 'size',
        label: 'Size',
        align: 'end',
        // The two counted elsewhere have no size of their own
        format: (size, row) =>
          row.id === 'renderTargets' || row.id === 'geometries'
            ? ''
            : formatBytesDelta(size as number),
      },
      { key: 'count', label: 'Count', align: 'end', format: (n) => formatCountDelta(n as number) },
    ],
    rows: () => categories,
    empty: 'No category changed.',
    scheduler,
  });
  body.add(categoriesTable.cmp);

  // Left behind: at most DIFF_MAX_ROWS, then "+N more" and the total in the footer
  const leftRows = createRowPool(
    (id): LeftRow => ({ id, label: '', sub: '', subNode: null, count: 0, bytes: 0 })
  );
  let shownLeft: LeftRow[] = [];
  const leftMore: LeftRow = {
    id: 'more',
    label: '',
    sub: '',
    subNode: null,
    isMore: true,
    count: null,
    bytes: null,
  };
  const leftTotal: LeftRow = {
    id: 'total',
    label: 'Total',
    sub: '',
    subNode: null,
    count: 0,
    bytes: 0,
  };
  const noLeftFooter: LeftRow[] = [];
  const leftTotalFooter = [leftTotal];
  const leftMoreFooter = [leftMore, leftTotal];
  let leftFooter = noLeftFooter;
  const optionalNumber = (format: (n: number) => string) => (value: unknown) =>
    value === null ? '' : format(value as number);
  const leftTable = createTable<LeftRow>({
    caption: 'Left behind since the snapshot',
    captionHidden: true,
    class: 'gpuMemoryLeftBehind',
    columns: [
      {
        key: 'label',
        label: 'Left behind (scene, visit)',
        rowHeader: true,
        cell: createNameCell,
        tone: footerTone,
      },
      { key: 'count', label: 'Count', align: 'end', format: optionalNumber(formatNumber) },
      { key: 'bytes', label: 'Size', align: 'end', format: optionalNumber(formatBytes) },
    ],
    rows: () => shownLeft,
    footer: () => leftFooter,
    empty: 'No earlier scene visit since the snapshot left anything allocated.',
    scheduler,
  });
  body.add(leftTable.cmp);

  // The assets: their counts on a line above (a column's label is fixed), at most DIFF_MAX_ROWS,
  // then "+N more" in the footer
  const assetCounts = createNote();
  body.add(assetCounts.cmp);
  const assetRows = createRowPool(
    (id): AssetRow => ({ id, label: '', sub: '', subNode: null, before: 0, after: 0 })
  );
  let shownAssets: AssetRow[] = [];
  const assetMore: AssetRow = {
    id: 'more',
    label: '',
    sub: '',
    subNode: null,
    isMore: true,
    before: null,
    after: null,
  };
  const noAssetFooter: AssetRow[] = [];
  const assetMoreFooter = [assetMore];
  let assetFooter = noAssetFooter;
  const assetColumns: TableColumn<AssetRow>[] = [
    {
      key: 'label',
      label: 'Registered asset',
      rowHeader: true,
      cell: createNameCell,
      tone: footerTone,
    },
    {
      key: 'before',
      label: 'Then',
      align: 'end',
      format: (bytes) => (bytes === null ? '' : bytes ? formatBytes(bytes as number) : 'new'),
    },
    {
      key: 'after',
      label: 'Now',
      align: 'end',
      format: (bytes) => (bytes === null ? '' : bytes ? formatBytes(bytes as number) : 'gone'),
    },
    {
      key: 'change',
      label: 'Change',
      align: 'end',
      value: (row) => (row.isMore ? null : (row.after ?? 0) - (row.before ?? 0)),
      format: (delta) => (delta === null ? '' : formatBytesDelta(delta as number)),
    },
  ];
  const assetsTable = createTable<AssetRow>({
    caption: 'Registered assets since the snapshot',
    captionHidden: true,
    class: 'gpuMemoryAssetDiff',
    columns: assetColumns,
    rows: () => shownAssets,
    footer: () => assetFooter,
    empty: 'No registered asset changed.',
    scheduler,
  });
  body.add(assetsTable.cmp);
  const note = createNote();
  body.add(note.cmp);

  const writeLeft = (diff: GPUMemoryDiff) => {
    leftRows.begin();
    const seen = new Map<string, number>();
    let count = 0;
    let bytes = 0;
    for (let i = 0; i < diff.leftBehind.length; i++) {
      const group = diff.leftBehind[i];
      count += group.count;
      bytes += group.bytes;
      if (i >= DIFF_MAX_ROWS) continue;
      const row = leftRows.take(getLeftKey(group, seen));
      row.label = `${ALLOCATION_KIND_LABELS[group.kind]}: ${group.label}`;
      writeSub(row, getLeftSub(group));
      row.count = group.count;
      row.bytes = group.bytes;
    }
    shownLeft = leftRows.end();
    leftTotal.count = count;
    leftTotal.bytes = bytes;
    leftMore.label = moreLabel(diff.leftBehind.length);
    leftFooter = !shownLeft.length
      ? noLeftFooter
      : diff.leftBehind.length > DIFF_MAX_ROWS
        ? leftMoreFooter
        : leftTotalFooter;
  };

  const writeAssets = (diff: GPUMemoryDiff) => {
    assetRows.begin();
    let added = 0;
    let gone = 0;
    let net = 0;
    for (let i = 0; i < diff.assets.length; i++) {
      const change = diff.assets[i];
      if (!change.before) added++;
      if (!change.after) gone++;
      net += change.after - change.before;
      if (i >= DIFF_MAX_ROWS) continue;
      const row = assetRows.take(change.key);
      row.label = change.id;
      // Its key is its kind and id (`texture:${id}`): nothing more to say
      writeSub(row, `${change.kind}, ${getOwnerLabel(change.owner)}`);
      row.before = change.before;
      row.after = change.after;
    }
    shownAssets = assetRows.end();
    assetMore.label = moreLabel(diff.assets.length);
    assetFooter = diff.assets.length > DIFF_MAX_ROWS ? assetMoreFooter : noAssetFooter;
    assetCounts.write(
      diff.assets.length
        ? `Registered assets: ${formatNumber(added)} new, ${formatNumber(gone)} gone, net ${formatBytesDelta(net)}.`
        : ''
    );
  };

  // `assets`: the live view's, read in the same refresh (else the diff collects them)
  const update = (assets?: readonly GPUAssetRow[] | null) => {
    const renderer = opts.getRenderer();
    const snapshot = getGPUMemorySnapshot();
    const diff = renderer && snapshot ? getGPUMemoryDiff(renderer, assets ?? undefined) : null;
    if (body.elem.hidden !== !diff) body.elem.toggleAttribute('hidden', !diff);
    none.write(
      diff
        ? ''
        : 'No snapshot. For leak hunting: take one in scene A, go to scene B and back to A, and the diff lists what B left allocated.'
    );
    if (!diff || !snapshot) {
      writeHeading('Snapshot');
      categories = [];
      shownLeft = [];
      leftFooter = noLeftFooter;
      shownAssets = [];
      assetFooter = noAssetFooter;
      return;
    }
    writeHeading(
      `Since the snapshot in ${getOwnerLabel(snapshot.sceneId)} at ${formatTime(snapshot.at)}`
    );
    const changes = readCategoryChanges(diff);
    writeTotal(formatBytesDelta(changes.total));
    categories = changes.rows;
    writeLeft(diff);
    writeAssets(diff);
    note.write(
      `Since the snapshot: ${formatNumber(diff.currentVisit.count)} allocations (${formatBytes(diff.currentVisit.bytes)}) made in this scene visit are still live, and ${formatNumber(diff.freed.count)} that existed at the snapshot (${formatBytes(diff.freed.bytes)}) were freed. "Left behind" lists what the snapshot's scene visit and the visits after it, up to this one, created and is still counted: what a scene left behind, or something long-lived it created first (a new visit starts on every scene load, so the same scene twice is two visits). Collected ones were garbage collected without being destroyed, so three counts them for good.${opts.isRecordingSites() ? '' : ' Turn on "Call sites" to see where each one was created (from the next allocation on).'}`
    );
  };

  update();
  // The tab host's first refresh comes an interval after the mount (as the live sections')
  categoriesTable.refresh();
  leftTable.refresh();
  assetsTable.refresh();
  return { cmp: section, update };
};
