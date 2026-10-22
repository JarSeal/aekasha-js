import { lwarn } from 'aekasha';
import { updateDebuggerTab } from 'aekasha/debug';
import { VARIANTS_URL, type CompareTexture } from './assetCompare';

// What the Asset compare tab's sections share: the tab's id, the fixture's report.json (the file
// sizes and quality metrics assetCompareVariants.ts measured) and the byte format.

export const ASSET_COMPARE_TAB_ID = 'assetCompare';

/** Rebuilds the tab's content, its lists' rows included */
export const refreshAssetCompareTab = () =>
  updateDebuggerTab(ASSET_COMPARE_TAB_ID, { rebuild: true });

/** A texture in report.json (the fields read here) */
export type ReportTexture = {
  file: string;
  kind: string;
  bytes: number;
  vramBytes: { rgba8: number; bc7Astc: number; etc2: number };
  metrics?: {
    psnr?: Record<string, number>;
    normalErrorDeg?: { mean: number; p99: number; max: number };
  };
};
type ReportModel = { file: string; bytes: number; textures?: ReportTexture[] };
type Report = { textures: ReportTexture[]; models: ReportModel[] };

let report: Report | null = null;
let reportRequest: Promise<void> | null = null;

/** Loads report.json, once: a load that failed (the fixture not run yet) is tried again on the
 * next call. The tab refreshes when it arrives. */
export const loadReportAsync = () => {
  reportRequest ??= fetch(`${VARIANTS_URL}/report.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // A missing file gets the dev server's index.html, which doesn't parse
      return res.json() as Promise<Report>;
    })
    .then((json) => {
      report = json;
      updateDebuggerTab(ASSET_COMPARE_TAB_ID);
    })
    .catch((error) => {
      reportRequest = null;
      lwarn('[assetCompare] Could not load report.json', error);
    });
  return reportRequest;
};

/** A texture's report entry: a standalone file's, or the prop GLB's texture of the same kind */
export const findReportTexture = ({ file, reportKind }: CompareTexture) => {
  if (!report) return undefined;
  if (!reportKind) return report.textures.find((t) => t.file === file);
  const glb = file.split('#')[0];
  return report.models.find((m) => m.file === glb)?.textures?.find((t) => t.kind === reportKind);
};

/** A prop GLB's file size in the report */
export const findReportModelBytes = (file: string | null) =>
  file ? report?.models.find((m) => m.file === file)?.bytes : undefined;

export const formatBytes = (bytes?: number) => {
  if (bytes === undefined) return '—';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
};
